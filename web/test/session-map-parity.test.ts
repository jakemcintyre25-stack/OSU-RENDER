import { describe, expect, it } from 'vitest';
import { ScoreEncoder } from 'osu-parsers';
import { Score, Replay, LegacyReplayFrame, Vector2 } from 'osu-classes';
import { sessionFromReplay } from '../src/session';
import type { OszArchive, Difficulty } from '../src/load/osz';

const hash = '0123456789abcdef0123456789abcdef';
const osuText = `osu file format v14

[General]
Mode: 0
[Metadata]
Title:Parity Contract
Artist:Test
Creator:Tests
Version:Normal
BeatmapID:4444
[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
100,100,1000,1,0,0:0:0:0:
`;

function fakeArchive(md5: string): OszArchive {
  const difficulty: Difficulty = {
    fileName: 'map.osu',
    md5, text: osuText, version: 'Normal', mode: 0, beatmapId: 4444,
  };
  return { files: new Map(), difficulties: [difficulty] };
}

async function replayBytes(): Promise<Uint8Array> {
  const score = new Score();
  score.info.username = 'Fixture';
  score.info.rulesetId = 0;
  score.info.beatmapHashMD5 = hash;
  score.info.rawMods = 0;
  score.info.count300 = 1;
  score.info.maxCombo = 1;
  score.replay = new Replay();
  score.replay.frames.push(new LegacyReplayFrame(1000, 1000, new Vector2(100, 100), 1 as never));
  return new Uint8Array(await new ScoreEncoder().encodeToBuffer(score));
}

describe('replay -> beatmap provenance', () => {
  it('rejects the same beatmap ID when the archived difficulty checksum differs', async () => {
    await expect(sessionFromReplay(await replayBytes(), fakeArchive('a'.repeat(32)), null, 4444))
      .rejects.toThrow(/checksum|MD5|updated/i);
  });

  it('accepts a genuinely checksum-matched archived difficulty', async () => {
    const session = await sessionFromReplay(await replayBytes(), fakeArchive(hash), null, 4444);
    expect(session.replay?.beatmapMD5).toBe(hash);
    expect(session.map.objects).toHaveLength(1);
    expect(session.warnings.some((w) => /checksum|does not match/i.test(w))).toBe(false);
  });

  it('labels .osu-only fallback as unverified rather than claiming an exact match', async () => {
    const session = await sessionFromReplay(await replayBytes(), null, osuText, 4444);
    expect(session.map.objects).toHaveLength(1);
    expect(session.warnings.join(' ')).toMatch(/not verified|unverified/i);
  });
});
