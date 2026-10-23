import { describe, expect, it } from 'vitest';
import { ScoreEncoder } from 'osu-parsers';
import { Score, Replay, LegacyReplayFrame, Vector2 } from 'osu-classes';
import { decodeReplay, FIRST_LAZER_GAME_VERSION, isLazerGameVersion } from '../src/load/replay';
import { sessionFromReplay } from '../src/session';

async function encodedReplay(gameVersion: number): Promise<Uint8Array> {
  const score = new Score();
  score.info.rulesetId = 0;
  score.info.username = 'Version Test';
  score.info.beatmapHashMD5 = 'A'.repeat(32);
  score.info.count300 = 1;
  score.info.maxCombo = 1;
  score.replay = new Replay();
  score.replay.gameVersion = gameVersion;
  score.replay.frames.push(new LegacyReplayFrame(1000, 1000, new Vector2(100, 100), 1 as never));
  return new Uint8Array(await new ScoreEncoder().encodeToBuffer(score));
}

describe('M10 lazer replay detection', () => {
  it('classifies only the lazer 30000000+ header range as lazer', () => {
    expect(FIRST_LAZER_GAME_VERSION).toBe(30_000_000);
    expect(isLazerGameVersion(20230621)).toBe(false);
    expect(isLazerGameVersion(29_999_999)).toBe(false);
    expect(isLazerGameVersion(30_000_000)).toBe(true);
    expect(isLazerGameVersion(30_000_019)).toBe(true);
    expect(isLazerGameVersion(Number.NaN)).toBe(false);
  });

  it('reads a stable build date as a non-lazer replay', async () => {
    const replay = await decodeReplay(await encodedReplay(20230621));
    expect(replay.gameVersion).toBe(20230621);
    expect(replay.isLazer).toBe(false);
  });

  it('reads lazer TotalScoreVersion as a lazer replay', async () => {
    const replay = await decodeReplay(await encodedReplay(30_000_019));
    expect(replay.gameVersion).toBe(30_000_019);
    expect(replay.isLazer).toBe(true);
  });

  it('refuses to build a stable-parity session from a lazer replay', async () => {
    await expect(sessionFromReplay(await encodedReplay(30_000_019), null, null))
      .rejects.toThrow(/osu!lazer replay.*not supported/i);
  });
});
