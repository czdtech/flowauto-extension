import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';

describe('chain mode types', () => {
  it('should default chainMode to false', () => {
    expect(DEFAULT_SETTINGS.chainMode).toBe(false);
  });
});
