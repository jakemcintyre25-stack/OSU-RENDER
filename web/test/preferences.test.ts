import { describe, expect, it } from 'vitest';
import { storedToggle } from '../src/render/preferences';

describe('persisted renderer preference parsing', () => {
  it('restores literal booleans rather than treating false as truthy', () => {
    expect(storedToggle('false')).toBe(false);
    expect(storedToggle('true')).toBe(true);
  });
  it('defaults to enabled for missing or malformed saved settings', () => {
    for (const v of [null, '0', '1', 'yes', '', 'False']) {
      expect(storedToggle(v)).toBe(true);
    }
    expect(storedToggle(null, false)).toBe(false);
  });
});
