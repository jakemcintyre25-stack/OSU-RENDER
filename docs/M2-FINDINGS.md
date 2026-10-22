# M2 findings: first judgement comparison against real replays

Date: 22 October 2026. Commit base: `d18c23a` (M1).

## Test set (local, not committed)

| Replay | Map | Mods | Header 300 / 100 / 50 / miss | Header max combo | Ours (judge v0) 300 / 100 / 50 / miss | Ours max combo |
|---|---|---|---|---|---|---|
| `16558c56-…_1.osr` | Super Affection, Venyera's Extra | NM | 1114 / 12 / 0 / 1 | 706 | 1113 / 10 / 0 / 4 | 703 |
| `2c6d18da-….osr` | Aoi Chou, Transient | NM | 789 / 44 / 3 / 22 | 282 | 802 / 30 / 1 / 25 | 284 |
| `3f4e99ff-….osr` | Ultimate Crescendo (quaver), Monstrata's | HD | 307 / 15 / 0 / 8 | 262 | 312 / 10 / 0 / 8 | 262 |

Header counts are aggregates only. No per-object truth exists, so every conclusion below is inferred from totals.

## Finding 1: hit radius (one clear case)

In `16558c56`, object 566 (t = 126084 ms, circle radius 37.8 px) was hit by a press at t = 126110 ms, 26 ms late, with the cursor 39.6 px from the centre. The header has only one miss, so stable accepted this click.

Our note-lock then causes a cascade. 566 stays unjudged, so presses for 567, 568 and 569 are compared only against 566. Those presses were within the radius of their own circles (31, 26 and 10 px), but they are rejected. That accounts for all four of our misses on this map.

Raising the radius to ×1.05 clears all four misses. It does not fix the other two replays, so radius alone isn't the cause.

## Finding 2: 300 window is probably too wide

Scaling all three hit windows by 0.9 cuts the total count error across the three replays from 48 to 18. Two of the three replays improve:

- `2c6d18da`: ours has 564 circle 300s. The header's 789 300s minus our 238 slider 300s implies about 551 circle 300s in stable.

This is a fit to three replays, not a confirmed rule.

## Finding 3: slider results look close

- `16558c56`: 241 slider 300s, 3 slider 100s.
- `2c6d18da`: 238 slider 300s, 7 slider 100s, 1 slider miss.

The gap on the slider-heavy map is mostly in circles, not sliders. That is evidence against a slider rule change for now.

## Finding 4: combo is not a bug

Max combo of 1397 appeared during an experiment. That is correct for our model: with no misses, the combo runs through every slider tick, repeat and tail (1400 in total). The header max combo only looks low because each replay has misses.

## Do not ship yet

- The 0.9 window and ×1.05 radius are fits to three replays. Adopting them would overfit.
- Counts are aggregates. Per-object truth is needed before any single rule can be confirmed.

## Suggested next steps

1. Collect more replays, aiming for circle-heavy, low-combo plays and several more mod combinations. Target 15+ standard replays.
2. Check whether stable's hit-circle check uses the centre distance against the radius exactly, or a slightly larger effective radius. Confirm in danser-go's stable logic (read only, no copying).
3. Test whether replay press times are stamped one frame late. Replay frames are about 16 ms apart, so a half-frame shift could explain the 300/100 mismatch.
4. Re-run `npm run judge-check` after each change. Keep one change per commit so each effect stays visible.

---

## Round 2: 10 unique replays (22 October 2026, later)

Thirteen replay files, ten unique plays. Two replays are duplicates of the same play. Maps came from the uploads folder.

### What changed in the judge

1. **Click matching (structural).** A click now goes to the earliest still-open circle it lands on, inside its radius and window. It no longer waits for the first open object. Evidence: in `16558c56`, circle 567 was clicked while 566 was still open. The header shows that as a hit, not a miss, which the old note-lock rejected. Covered by `web/test/judge-matching.test.ts`.
2. **Slider part misses no longer break combo (structural).** Stable only resets combo on a missed head or a whole-slider miss. Evidence: `5053251` has one slider with a missed tick and a header max combo of 986 with no misses.
3. **300 window offset of 1 ms (provisional).** `PROVISIONAL_WINDOW300_OFFSET_MS = 1` in `judge.ts`. The 300 window at OD 8–10 is 28–32 ms, so 1 ms is about 3%. This is a fit to ten replays, not a confirmed rule. Multiplying all windows by 0.95 fits worse, because on the FC replays the error changes sign.
4. **Options added** for experiments: `windowScale`, `radiusScale`, `window300Offset`. `scripts/sweep-judge.mjs` sweeps them across the local fixtures.

### Sweep results (count error = sum of absolute differences in 300/100/50/miss across ten replays)

| radius | window | 300 offset (ms) | count error | combo error |
|---|---|---|---|---|
| 1 | 1 | 0 | 158 | 409 |
| 1 | 1 | 1 | 54 | 409 |
| 1 | 0.95 | 0 | 98 | 409 |
| 1.05 | 0.95 | 0 | 92 | 737 |
| 1.02 | 1 | 1 | 56 | 37 |

A radius of 1.02 cuts combo error from 409 to 37, but only because it removes one miss in `5053251` (a single click 37.8–38.6 px from centre). That is one click, so the radius stays at 1.0.

### Current results with the provisional default

| Replay | Mods | Ours 300/100/50/miss | Header | Max combo ours / header |
|---|---|---|---|---|
| 1907933 | HD | 1336/34/0/0 | 1336/34/0/0 | 1888 / 1888 — **exact** |
| 4019123 | HD+HR | 624/8/0/0 | 624/8/0/0 | 850 / 850 — **exact** |
| 908042 | HD | 1973/51/0/0 | 1973/51/0/0 | 2987 / 2987 — **exact** |
| 1029562 | HD | 541/25/0/0 | 540/26/0/0 | 693 / 692 |
| 3f4e99ff | HD | 310/12/0/8 | 307/15/0/8 | 262 / 262 |
| 16558c56 | NM | 1113/13/0/1 | 1114/12/0/1 | 704 / 706 |
| 2c6d18da | NM | 800/35/3/20 | 789/44/3/22 | 284 / 282 |
| 5053251 | HD | 745/17/0/1 | 744/19/0/0 | 592 / 986 — one click, see above |
| 5080973 | HD | 2090/31/0/0 | 2084/37/0/0 | 2740 / 2734 |
| 1128411 | HD | 1853/52/1/1 | 1850/55/1/1 | 2569 / 2565 |

### Combo model confirmed

On every replay with no misses, our max combo equals the header's, or is within a few. Sliders contribute head, ticks, repeats and tail as combo, which is why a full combo on the 1907933 map is 1888. Combo errors come only from misses.

### Still open

- `2c6d18da` (NM, 20 misses vs 22): the largest remaining error, with 35 100s vs 44 and 800 300s vs 789. This points at circle hit windows or early-click handling, not sliders.
- `5053251`: one click, see above. Needs more replays to decide whether the radius is 1.0 or slightly larger.
- The 1 ms offset is provisional. It should be replaced once the rule is identified, ideally from osu! source (read-only) plus more replays.
- Score (M4) and HP (M3) are still not implemented.

### Caveat

Ten replays is still a small set, and every test here compares totals, not individual objects. The provisional offset and the sweep numbers may not hold on new maps. Re-run `npm run judge-check` and `node scripts/sweep-judge.mjs` every time new replays arrive.
