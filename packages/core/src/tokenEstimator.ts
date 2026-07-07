/**
 * Token estimator interface.
 * Replace with a real tokenizer when needed.
 */
export interface TokenEstimator {
  estimate(content: string): number;
}

/**
 * Simple approximation used by the first scaffold.
 * Not intended to match any specific model tokenizer.
 */
export const approximateTokenEstimator: TokenEstimator = {
  estimate(content) {
    if (!content) return 0;
    return Math.ceil(content.length / 4);
  },
};

export function estimateTokens(
  content: string,
  estimator: TokenEstimator = approximateTokenEstimator,
): number {
  return estimator.estimate(content);
}
