#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSignalglassJson } from '@signalglass/parsers';
import { analyzeRun } from '@signalglass/core';
import { renderTerminal, renderJson, renderHtml } from '@signalglass/reports';
import { loadConfig, startIngressServer } from '@signalglass/ingress';
import { TraceStorage } from '@signalglass/storage';
import { fileURLToPath, pathToFileURL } from 'node:url';

function printAnalyzeUsage() {
  console.error('Usage: signalglass analyze <file> [--report terminal|json|html] [--output <file>]');
}

function printIngressUsage() {
  console.error('Usage: signalglass ingress --config <file> [--port <port>] [--storage <path>]');
}

function printUsage() {
  console.error('Usage: signalglass <command> [options]');
  console.error('Commands:');
  console.error('  analyze <file> [--report terminal|json|html] [--output <file>]');
  console.error('  ingress --config <file> [--port <port>] [--storage <path>]');
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

  if (values.output) {
    writeFileSync(values.output, output);
    console.log(`Report written to ${values.output}`);
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
  let onTrace: ((trace: any) => void | Promise<void>) | undefined;

  if (values.storage) {
    try {
      storage = new TraceStorage({ databasePath: values.storage });
      onTrace = async (trace) => {
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

  const server = await startIngressServer({ config, port, onTrace });
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
