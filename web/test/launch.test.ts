import { describe, expect, it } from 'vitest';
import { parseLaunchTarget, scoreShareUrl, userShareUrl } from '../src/launch';

describe('M12 One Miss Merchants entrypoints', () => {
  it('loads a public osu! numeric user ID without opening a score', () => {
    expect(parseLaunchTarget('?user=123456')).toEqual({ kind: 'user', id: 123456 });
    expect(parseLaunchTarget('?user=1&foo=bar')).toEqual({ kind: 'user', id: 1 });
  });
  it('prefers score links when score and user are both supplied', () => {
    expect(parseLaunchTarget('?user=123&score=987654')).toEqual({ kind: 'score', id: 987654 });
    expect(parseLaunchTarget('?score=3&score=4')).toEqual({ kind: 'score', id: 3 });
  });
  it('fails closed for malformed, unsafe or imprecise query IDs', () => {
    for (const raw of ['-1', '0', '0001', 'NaN', '1.5', '12x', 'abc', '1234567890123', '999999999999999999999', '']) {
      expect(parseLaunchTarget('?score=' + raw)).toEqual({ kind: 'home' });
    }
    for (const raw of ['0', '99999999999', 'alice', '../42', '1%2F2', '']) {
      expect(parseLaunchTarget('?user=' + raw)).toEqual({ kind: 'home' });
    }
    expect(parseLaunchTarget('?')).toEqual({ kind: 'home' });
    expect(parseLaunchTarget('?score=bad&user=123')).toEqual({ kind: 'home' });
  });
  it('generates a clean shareable score URL without stale user params or fragments', () => {
    expect(scoreShareUrl('https://replays.example.nz/player?user=72&old=value#secret', 67890))
      .toBe('https://replays.example.nz/player?score=67890');
    expect(parseLaunchTarget(new URL(scoreShareUrl('https://host.test/', 78)).search))
      .toEqual({ kind: 'score', id: 78 });
  });
  it('generates a clean link for OMM to use on profiles', () => {
    expect(userShareUrl('https://replays.example.nz/?score=99#old', 42))
      .toBe('https://replays.example.nz/?user=42');
  });
  it('rejects invalid output IDs and unsafe URL schemes', () => {
    for (const id of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => scoreShareUrl('https://example.com/', id)).toThrow();
      expect(() => userShareUrl('https://example.com/', id)).toThrow();
    }
    expect(() => scoreShareUrl('javascript:alert(1)', 42)).toThrow();
  });
});
