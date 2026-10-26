import { describe, expect, it } from 'vitest';
import { classifyQuality } from './quality';

describe('classifyQuality', () => {
  it('is unknown until there is data', () => {
    expect(classifyQuality(null)).toBe('unknown');
    expect(classifyQuality({ rttMs: null, lossPct: null })).toBe('unknown');
  });
  it('rates good, fair and poor connections', () => {
    expect(classifyQuality({ rttMs: 40, lossPct: 0 })).toBe('good');
    expect(classifyQuality({ rttMs: 150, lossPct: 3 })).toBe('good'); // boundary values are still good
    expect(classifyQuality({ rttMs: 220, lossPct: 0 })).toBe('fair');
    expect(classifyQuality({ rttMs: 40, lossPct: 5 })).toBe('fair');
    expect(classifyQuality({ rttMs: 600, lossPct: 0 })).toBe('poor');
    expect(classifyQuality({ rttMs: 40, lossPct: 12 })).toBe('poor');
  });
  it('uses whichever metric is available', () => {
    expect(classifyQuality({ rttMs: null, lossPct: 10 })).toBe('poor');
    expect(classifyQuality({ rttMs: 80, lossPct: null })).toBe('good');
  });
});
