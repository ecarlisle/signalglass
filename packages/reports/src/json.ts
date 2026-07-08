import type { AnalysisResult } from '@signalglass/core';
import { sanitizeReportValue } from './sanitize.js';

export function renderJson(analysis: AnalysisResult): string {
  return JSON.stringify(sanitizeReportValue(analysis), null, 2);
}
