import { describe, expect, it } from 'vitest';
import { formatUtcOffset } from '../src/ui/format';

describe('formatUtcOffset', () => {
  it('formats whole-hour offsets east of UTC', () => {
    expect(formatUtcOffset(480)).toBe('UTC+8');
    expect(formatUtcOffset(0)).toBe('UTC+0');
    expect(formatUtcOffset(60)).toBe('UTC+1');
  });

  it('formats offsets west of UTC', () => {
    expect(formatUtcOffset(-300)).toBe('UTC-5');
    expect(formatUtcOffset(-540)).toBe('UTC-9');
  });

  it('keeps half-hour and quarter-hour offsets', () => {
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(345)).toBe('UTC+5:45');
    expect(formatUtcOffset(-210)).toBe('UTC-3:30');
  });

  it('rounds fractional minutes', () => {
    expect(formatUtcOffset(479.6)).toBe('UTC+8');
  });
});
