#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseSignalglassJson } from '@signalglass/parsers';
import { analyzeRun } from '@signalglass/core';
import type { Trace } from '@signalglass/core';
import { renderTerminal, renderJson, renderHtml, renderTraceTerminal, renderTraceJson, renderTraceHtml, renderTraceListSummary, renderTraceListJson } from '@signalglass/reports';
import { loadConfig, startIngressServer } from '@signalglass/ingress';
import { TraceStorage } from '@signalglass/storage';
import { fileURLToPath, pathToFileURL } from 'node:url';

function printAnalyzeUsage() {
  console.error('Usage: signalglass analyze <file> [--report terminal|json|html] [--output <file>]');
}

function printIngressUsage() {
  console.error('Usage: signalglass ingress --config <file> [--port <port>] [--storage <path>]');
}

function printTracesUsage() {
  console.error('Usage: signalglass traces --storage <path> <command> [options]');
  console.error('Commands:');
  console.error('  list [--report terminal|json] [--output <file>]           List all stored traces');
  console.error('  show <trace-id> [--report terminal|json|html] [--output <file>]');
}

function printUsage() {
  console.error('Usage: signalglass <command> [options]');
  console.error('Commands:');
  console.error('  analyze <file> [--report terminal|json|html] [--output <file>]');
  console.error('  ingress --config <file> [--port <port>] [--storage <path>]');
  console.error('  traces --storage <path> list|show <trace-id>');
}

function analyzeCommand(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      report: { type: 'string', short: 'r', default: 'terminal' },
      output: { type: 'string', short: 'o' },
    },
  });

  const filePath = positionals[0];
  if (!filePath) {
    console.error('Error: missing file path');
    printAnalyzeUsage();
    process.exit(1);
  }

  const raw = readFileSync(filePath, 'utf8');
  const input = JSON.parse(raw);
  const run = parseSignalglassJson(input);
  const analysis = analyzeRun(run);

  const reportType = values.report ?? 'terminal';
  let output = '';

  switch (reportType) {
    case 'terminal':
      output = renderTerminal(analysis);
      break;
    case 'json':
      output = renderJson(analysis);
      break;
    case 'html':
      output = renderHtml(analysis);
      break;
    default:
      console.error(`Unknown report type: ${reportType}`);
      process.exit(1);
  }

  writeOutput(output, values.output);
}

function writeOutput(output: string, outputPath?: string): void {
  if (outputPath) {
    writeFileSync(outputPath, output);
    console.log(`Report written to ${outputPath}`);
  } else {
    console.log(output);
  }
}

export function validatePort(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid port: "${raw}"`);
  }
  const port = Number.parseInt(raw, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Port must be an integer between 1 and 65535, got: ${raw}`);
  }
  return port;
}

async function ingressCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      port: { type: 'string' },
      storage: { type: 'string' },
    },
  });

  if (!values.config) {
    console.error('Error: missing --config');
    printIngressUsage();
    process.exit(1);
  }

  let port: number | undefined;
  if (values.port !== undefined) {
    try {
      port = validatePort(values.port);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      printIngressUsage();
      process.exit(1);
    }
  }

  const config = await loadConfig(values.config);

  // Initialize storage if --storage option is provided
  let storage: TraceStorage | undefined;
  let onTrace: ((trace: Trace) => void | Promise<void>) | undefined;

  if (values.storage) {
    try {
      storage = new TraceStorage({ databasePath: values.storage });
      onTrace = async (trace: Trace) => {
        try {
          storage!.saveTrace(trace);
        } catch (error) {
          console.error('Error saving trace:', error);
        }
      };
      console.log(`Storage enabled: ${values.storage}`);
    } catch (error) {
      console.error(`Error initializing storage: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  let server;
  try {
    server = await startIngressServer({ config, port, onTrace });
  } catch (error) {
    if (storage) {
      storage.close();
    }
    throw error;
  }
  const address = server.address();
  const listeningPort = address && typeof address === 'object' ? address.port : port;

  console.log(`Signalglass ingress listening on http://localhost:${listeningPort}/v1`);

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    server.close(() => {
      if (storage) {
        storage.close();
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function tracesCommand(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      storage: { type: 'string' },
      report: { type: 'string', default: 'terminal' },
      output: { type: 'string', short: 'o' },
    },
  });

  if (!values.storage) {
    console.error('Error: --storage <path> is required for trace commands');
    printTracesUsage();
    process.exit(1);
  }

  if (!existsSync(values.storage)) {
    console.error(`Error: storage database not found: ${values.storage}`);
    process.exit(1);
  }

  const subcommand = positionals[0];

  if (!subcommand) {
    console.error('Error: missing trace subcommand (list|show)');
    printTracesUsage();
    process.exit(1);
  }

  let storage: TraceStorage;
  try {
    storage = new TraceStorage({ databasePath: values.storage });
  } catch (error) {
    console.error(`Error opening storage: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  switch (subcommand) {
    case 'list': {
      const traces = storage.listTraces();
      storage.close();
      const reportType = values.report ?? 'terminal';
      let output = '';
      switch (reportType) {
        case 'json':
          output = renderTraceListJson(traces);
          break;
        case 'terminal':
          output = renderTraceListSummary(traces);
          break;
        default:
          console.error(`Unknown report type: ${reportType}`);
          process.exit(1);
      }
      writeOutput(output, values.output);
      break;
    }
    case 'show': {
      const traceId = positionals[1];
      if (!traceId) {
        console.error('Error: missing trace-id argument');
        storage.close();
        printTracesUsage();
        process.exit(1);
      }
      const trace = storage.getTrace(traceId);
      storage.close();
      if (!trace) {
        console.error(`Trace not found: ${traceId}`);
        process.exit(1);
      }
      const reportType = values.report ?? 'terminal';
      let output = '';
      switch (reportType) {
        case 'json':
          output = renderTraceJson(trace);
          break;
        case 'html':
          output = renderTraceHtml(trace);
          break;
        case 'terminal':
          output = renderTraceTerminal(trace);
          break;
        default:
          console.error(`Unknown report type: ${reportType}`);
          process.exit(1);
      }
      writeOutput(output, values.output);
      break;
    }
    default:
      console.error(`Unknown trace subcommand: ${subcommand}`);
      storage.close();
      printTracesUsage();
      process.exit(1);
  }
}

async function main() {
  let args = process.argv.slice(2);
  // pnpm sometimes passes a leading `--` separator through to the script.
  if (args[0] === '--') {
    args = args.slice(1);
  }

  const { positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {},
  });

  const command = positionals[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'analyze':
      analyzeCommand(commandArgs);
      break;
    case 'ingress':
      await ingressCommand(commandArgs);
      break;
    case 'traces':
      tracesCommand(commandArgs);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
