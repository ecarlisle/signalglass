import { describe, it, expect } from 'vitest';
import { estimateTokens, approximateTokenEstimator } from './tokenEstimator.js';

describe('token estimation', () => {
  it('approximates one token per four characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });

  it('uses a custom estimator when provided', () => {
    const custom = { estimate: () => 42 };
    expect(estimateTokens('hello', custom)).toBe(42);
  });

  it('exposes the default approximation', () => {
    expect(approximateTokenEstimator.estimate('12345678')).toBe(2);
  });
});
