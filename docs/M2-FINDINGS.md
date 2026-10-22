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
