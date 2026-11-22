import { describe, expect, it } from 'vitest';
import { formatDelta, formatDuration, ordinal, rankPercentile } from '../src/core/format';

describe('format', () => {
  it('formats signed deltas', () => {
    expect(formatDelta(42.4)).toBe('+42');
    expect(formatDelta(-42.6)).toBe('-43');
    expect(formatDelta(0)).toBe('+0');
    expect(formatDelta(-7, false)).toBe('7');
  });

  it('formats durations as clocks', () => {
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('00:00');
  });

  it('computes percentile from rank', () => {
    expect(rankPercentile(1, 100)).toBeCloseTo(0.01, 5);
    expect(rankPercentile(200, 100)).toBe(1);
  });

  it('produces English ordinals', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(23)).toBe('23rd');
  });
});
