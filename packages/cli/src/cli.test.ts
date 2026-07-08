import { describe, it, expect } from 'vitest';
import { validatePort } from './cli.js';

describe('validatePort', () => {
  it('accepts a valid port', () => {
    expect(validatePort('8080')).toBe(8080);
    expect(validatePort('1')).toBe(1);
    expect(validatePort('65535')).toBe(65535);
  });

  it('rejects non-numeric ports', () => {
    expect(() => validatePort('123abc')).toThrow('Invalid port');
    expect(() => validatePort('abc')).toThrow('Invalid port');
    expect(() => validatePort('')).toThrow('Invalid port');
  });

  it('rejects out-of-range ports', () => {
    expect(() => validatePort('0')).toThrow('Port must be an integer between 1 and 65535');
    expect(() => validatePort('65536')).toThrow('Port must be an integer between 1 and 65535');
  });

  it('rejects partial numeric ports', () => {
    expect(() => validatePort('12.34')).toThrow('Invalid port');
    expect(() => validatePort(' 123 ')).toThrow('Invalid port');
  });
});
