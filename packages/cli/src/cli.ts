#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSignalglassJson } from '@signalglass/parsers';
import { analyzeRun } from '@signalglass/core';
import { renderTerminal, renderJson, renderHtml } from '@signalglass/reports';

function printUsage() {
  console.error('Usage: signalglass analyze <file> [--report terminal|json|html] [--output <file>]');
}

function main() {
  let args = process.argv.slice(2);
  // pnpm sometimes passes a leading `--` separator through to the script.
  if (args[0] === '--') {
    args = args.slice(1);
  }

  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      report: { type: 'string', short: 'r', default: 'terminal' },
      output: { type: 'string', short: 'o' },
    },
  });

  const command = positionals[0];
  if (command !== 'analyze') {
    printUsage();
    process.exit(1);
  }

  const filePath = positionals[1];
  if (!filePath) {
    console.error('Error: missing file path');
    printUsage();
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

main();
