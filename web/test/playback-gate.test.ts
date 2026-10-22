import { describe, expect, it } from 'vitest';
import { PlaybackRequestGate } from '../src/playback-gate';

describe('latest-user-request-wins replay navigation', () => {
  it('keeps only the newest request eligible to update playback', () => {
    const gate = new PlaybackRequestGate();
    const first = gate.begin();
    expect(first.isCurrent()).toBe(true);
    const second = gate.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    gate.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(false);
  });

  it('prevents late network completions from taking over a newly selected score', async () => {
    const gate = new PlaybackRequestGate();
    const published: string[] = [];
    let completeOld!: () => void;
    const first = gate.begin();
    const oldWork = new Promise<void>(resolve => { completeOld = resolve; }).then(() => {
      if (first.isCurrent()) published.push('old');
    });
    const second = gate.begin();
    const newWork = Promise.resolve().then(() => {
      if (second.isCurrent()) published.push('new');
    });
    completeOld();
    await Promise.all([oldWork, newWork]);
    expect(published).toEqual(['new']);
  });

  it('provides an abort signal that rejects abort-aware fetch operations', async () => {
    const gate = new PlaybackRequestGate();
    const lease = gate.begin();
    const download = new Promise((_, reject) => {
      lease.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    gate.begin();
    await expect(download).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not allow a stale release to invalidate the current lease', () => {
    const gate = new PlaybackRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    const third = gate.begin();
    expect(second.isCurrent()).toBe(false);
    expect(third.isCurrent()).toBe(true);
  });
});
