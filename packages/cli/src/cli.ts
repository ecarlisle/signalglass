#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSignalglassJson } from '@signalglass/parsers';
import { analyzeRun } from '@signalglass/core';
import { renderTerminal, renderJson, renderHtml } from '@signalglass/reports';
import { loadConfig, startIngressServer } from '@signalglass/ingress';

function printAnalyzeUsage() {
  console.error('Usage: signalglass analyze <file> [--report terminal|json|html] [--output <file>]');
}

function printIngressUsage() {
  console.error('Usage: signalglass ingress --config <file> [--port <port>]');
}

function printUsage() {
  console.error('Usage: signalglass <command> [options]');
  console.error('Commands:');
  console.error('  analyze <file> [--report terminal|json|html] [--output <file>]');
  console.error('  ingress --config <file> [--port <port>]');
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

async function ingressCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      port: { type: 'string' },
    },
  });

  if (!values.config) {
    console.error('Error: missing --config');
    printIngressUsage();
    process.exit(1);
  }

  const config = await loadConfig(values.config);
  const port = values.port ? Number.parseInt(values.port, 10) : undefined;

  const server = await startIngressServer({ config, port });
  const address = server.address();
  const listeningPort = address && typeof address === 'object' ? address.port : port;

  console.log(`Signalglass ingress listening on http://localhost:${listeningPort}/v1`);
}

async function main() {
  let args = process.argv.slice(2);
  // pnpm sometimes passes a leading `--` separator through to the script.
  if (args[0] === '--') {
    args = args.slice(1);
  }

  const { positionals, values: _values } = parseArgs({
    args,
    allowPositionals: true,
    options: {},
  });

  const command = positionals[0];
  const commandArgs = positionals.slice(1);

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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
