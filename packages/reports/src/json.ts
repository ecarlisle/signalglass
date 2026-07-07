import type { AnalysisResult } from '@signalglass/core';

export function renderJson(analysis: AnalysisResult): string {
  return JSON.stringify(analysis, null, 2);
}
