# M4 findings: Score V1

Status: **partly done.** The formula is implemented and matches headers on the HD replays where
the judgement counts are right. Judge-check still reports MISMATCH for score because of the
replays below. The M4 "done when" (every non-lazer replay matches) is **not met yet**.

## Formula (osu! wiki, ScoreV1 osu!standard)

- Judged hit (circle result, slider overall 300/100/50, spinner overall 300/100/50):
  `base + floor(base × max(0, comboBefore − 1) × difficulty × mod / 25)`
- Slider ticks: 10 flat. Repeats and tail: 30 flat. Slider head has no points of its own.
- Spinner spins: 100 per spin up to the required count, 1100 per bonus spin (100 + 1000).
- Difficulty multiplier: `round((HP + CS + OD + clamp(objects / drainSeconds × 8, 0, 16)) / 38 × 5)`
  using the map's **original** (unmodded) values. Drain time excludes breaks.
- Mod multiplier: product of EZ 0.5, NF 0.5, HT 0.3, HR 1.06, HD 1.06, DT/NC 1.12, FL 1.12, SO 0.9.

Two earlier mistakes, now fixed: the combo multiplier is `comboBefore − 1`, not `comboBefore`,
and the difficulty used mod-adjusted HP/CS/OD.

## Results (headers from fixtures, 13 replays, 10 unique maps)

Counts exact, max combo exact:

| Replay | Mods | Ours | Header | Diff |
|---|---|---|---|---|
| 1907933 | HD | 82,591,662 | 82,597,802 | −0.007% |
| 908042 | HD | 154,315,838 | 154,324,578 | −0.006% |
| 4019123 | HD+HR | 18,855,885 | 18,861,705 | −0.03% |

Counts close (small judge error):

| Replay | Mods | Ours | Header | Diff |
|---|---|---|---|---|
| 1029562 | HD | 12,164,946 | 12,136,395 | +0.24% |
| 1128411 | HD | 115,683,435 | 115,397,637 | +0.25% |
| 5080973 | HD | 184,212,865 | 183,465,136 | +0.41% |

Not explained yet (ours is far higher than the header):

| Replay | Mods | Ours | Header | Ratio | Notes |
|---|---|---|---|---|---|
| 16558c56 | NM | 19,252,932 | 832,275 | 23× | 1 miss, combo 704 vs 706 |
| 2c6d18da | NM | 3,866,060 | 527,104 | 7× | 20 misses, count error from M2 |
| 3f4e99ff | HD | 2,287,365 | 743,975 | 3× | combo 262 matches, 330 objects |
| 5053251 | HD | 12,492,844 | 23,613,716 | 0.53× | combo 592 vs 986 (judge error) |

The three replays with the 3–23× gap have headers below 1,000,000. ScoreV2 is capped at 1,000,000,
but the mods bitmask has no ScoreV2 flag (bit 29), so that is not the explanation. Next step:
check whether these replays use a different ruleset, build or difficulty than the map we
matched by MD5.

## Open items

- Explain the NM and 3f4e99ff gap above before calling M4 done.
- Residual −0.006% on exact-count replays: probably per-hit rounding or spinner points. Check
  whether stable floors the total or each part.
- Judge count errors (M2) now dominate the score error on near-match replays.
- HP (M3) is still not implemented.
