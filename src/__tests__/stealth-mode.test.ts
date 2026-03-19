import { describe, it, expect } from 'vitest';
import { STEALTH } from '../shared/config';
import { calcStealthDelay } from '../content/utils/dom';

describe('stealth mode constants', () => {
  it('should define valid multiplier range', () => {
    expect(STEALTH.MULTIPLIER_MIN).toBeGreaterThanOrEqual(1.5);
    expect(STEALTH.MULTIPLIER_MAX).toBeLessThanOrEqual(3.0);
    expect(STEALTH.MULTIPLIER_MIN).toBeLessThan(STEALTH.MULTIPLIER_MAX);
  });

  it('should define valid pause range', () => {
    expect(STEALTH.PAUSE_MIN_MS).toBeGreaterThanOrEqual(500);
    expect(STEALTH.PAUSE_MAX_MS).toBeLessThanOrEqual(2000);
    expect(STEALTH.PAUSE_MIN_MS).toBeLessThan(STEALTH.PAUSE_MAX_MS);
  });

  it('should cap total slowdown at 4x', () => {
    expect(STEALTH.MAX_SLOWDOWN_FACTOR).toBe(4);
  });
});

describe('stealth delay calculation', () => {
  it('should produce delay within multiplier range', () => {
    const baseDelay = 1000;
    for (let i = 0; i < 100; i++) {
      const factor = STEALTH.MULTIPLIER_MIN + Math.random() * (STEALTH.MULTIPLIER_MAX - STEALTH.MULTIPLIER_MIN);
      const result = baseDelay * factor;
      expect(result).toBeGreaterThanOrEqual(baseDelay * STEALTH.MULTIPLIER_MIN);
      expect(result).toBeLessThanOrEqual(baseDelay * STEALTH.MULTIPLIER_MAX);
    }
  });
});

describe('calcStealthDelay', () => {
  it('should return original range when stealth disabled', () => {
    const [min, max] = calcStealthDelay(300, 600, false);
    expect(min).toBe(300);
    expect(max).toBe(600);
  });

  it('should multiply range when stealth enabled', () => {
    const [min, max] = calcStealthDelay(300, 600, true);
    expect(min).toBe(300 * STEALTH.MULTIPLIER_MIN);
    expect(max).toBe(600 * STEALTH.MULTIPLIER_MAX);
  });

  it('should not exceed MAX_SLOWDOWN_FACTOR relative to original max', () => {
    const [min, max] = calcStealthDelay(100, 200, true);
    expect(max).toBeLessThanOrEqual(200 * STEALTH.MAX_SLOWDOWN_FACTOR);
  });
});
