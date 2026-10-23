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

## Slider-head ScoreV1 correction (22 October 2026)

The earlier implementation accidentally awarded **zero** flat points for a successfully hit slider head. Stable grants **30 flat points** for the head (plus 10 for each tick and 30 for each repeat/tail), independently of the slider's final 300/100/50 judgement.

- Fixed `sliderPartPoints('head')` to return 30 in commit `27c3485`.
- Added fixture-independent helper and full slider-judgement tests, including the running score at the head timestamp.
- GitHub Actions tests, typecheck, build, and empty-fixture judge-check pass for the correction.
- **The score comparison tables above are historical** and predate this fix; these scores have not been recomputed against real replay files.
- The previous observation of near-exact scores differing by ~6,140 to ~8,740 points may reflect hundreds of omitted 30-point slider heads, but this explanation still needs replay-by-replay verification.

## Open items

- Explain the NM and 3f4e99ff gap above before calling M4 done.
- Residual −0.006% on exact-count replays (historical, before slider-head fix): recompute with updated head points; then check
  whether stable floors the total or each part.
- Judge count errors (M2) now dominate the score error on near-match replays.
- HP (M3) is still not implemented.

## Spinner ScoreV1 correction: half-spins and the 1.5-spin bonus gap (23 October 2026)

The previous helper awarded `100` per full spin up to the requirement and switched to `1100` immediately after it. Stable's actual `SpinnerOsu.GetScorePoints()` instead counts half-spins and awards:

- `1100` when `count > requirement + 3` and the parity condition matches;
- otherwise `100` on the other even half-spin counts;
- nothing on the remaining odd half-spins.

This means the first bonus arrives after a 1.5-spin gap beyond completion, not on the first spin after completion. It also means an even/odd half-spin asymmetry that a full-spin model cannot reproduce.

Implemented in `spinnerSpinPoints(halfSpins, requiredHalfSpins)`, fed by the real judged half-spin total. Synthetic tests cover counts before, at and after the bonus threshold.

**Still open:** no historical replay score table above has been recomputed because the rights-cleared replays are not in this environment. The correction is source-derived and unit-tested, not proven against real headers. Spinner bonus points should now stop inflating scores on spinner-heavy maps, but M4 remains IN PROGRESS until the local fixture set is rerun.

## Difficulty multiplier correction: stable drain quirks and banker's rounding (23 October 2026)

Source: [`OsuLegacyScoreSimulator`](https://github.com/ppy/osu/blob/master/osu.Game.Rulesets.Osu/Difficulty/OsuLegacyScoreSimulator.cs) and the stable-compatibility notes in [ppy/osu@02975b9](https://github.com/ppy/osu/commit/02975b94985b5327bd2c953013ed4e6c01bc385d).

The previous implementation used the union of clipped breaks, a floating-point drain time with a one-second floor, `Math.round`, and a 2–6 clamp. None of those match stable's score path:

- Every break is summed, including overlapping and out-of-range breaks. Stable does **not** union or clip them.
- Break and object endpoints use banker's rounding (`Math.Round` default), then the first-to-last span minus summed breaks is integer-divided by 1000.
- A zero drain length means density 16, not a divide-by-one guard.
- The final multiplier uses banker's rounding.
- The stable path has **no 2–6 clamp**; the rounded value is used directly.

Implemented as `roundTiesEven`, `stableDrainSeconds` and a rewritten `difficultyMultiplier`. Integration tests parse a real `.osu` with three overlapping breaks and assert the 29-second summed drain, not the previous 50-second union.

**Still open:** the exact-count replay score tables have not been recomputed, and the 3–23× `16558c56` / `2c6d18da` / `3f4e99ff` gap remains unexplained. The no-clamp and banker's-rounding changes are source-derived but still need real-header confirmation. M4 remains IN PROGRESS.
