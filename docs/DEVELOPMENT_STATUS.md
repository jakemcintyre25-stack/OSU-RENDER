# OSU-RENDER — development and verification status

Updated: 22 October 2026. The 12-milestone specification in `osu-render-chatgpt-prompt.md` is the acceptance contract. This checklist reflects **verified features**, not the existence of scaffolding or partial code.

**Estimated project completion: ~25% by remaining engineering effort (rough planning judgement, not a measured or verified completion metric).** Large unresolved deliverables include exact real-replay parity, complete HP/score, hitsounds/audio, skins, video export and deployment acceptance. Only individual rows marked PASS have satisfied their named criteria.

## Milestone acceptance checklist

| Milestone | Status | Verification and outstanding work |
|---|---|---|
| M1 Judgement harness | **PASS** | `npm run judge-check`, verbose diagnostics and CI implemented. Empty optional fixtures exit zero. Real replay fixtures stay local. |
| M2 Stable judgement parity | **IN PROGRESS** | Strict checksum matching rejects updated beatmaps with unchanged IDs; `.osu`-only fallback labels uncertainty. Strict parity mode fails when no stable replay is checked. Slider timing, combo breaks, hit-window edges and 2B autoplay have synthetic tests; exact real-replay parity, spinner smoothing and complex note-lock remain unverified. |
| M3 HP and fail | **IN PROGRESS** | Verified SD/PF failure timestamps from circle grades and slider-head/tick/repeat combo breaks, with NF precedence. Exact stable HP drain, hit gains, break pauses, HP timeline and HP-zero failure remain. |
| M4 Score V1 | **IN PROGRESS** | Running ScoreV1, mod multipliers, slider/spinner part scoring implemented. Fixed 30-point slider heads, clamped difficulty multiplier to 2–6, and normalized NC/DT and DC/HT speed-mod aliases. Real header parity remains unverified; older M4 replay comparison values are stale. |
| M5 Audio timing and hitsounds | **IN PROGRESS** | Fixed offset-aware play/pause/seek/rate continuity with instrumented AudioContext tests; added persisted player Sync control. Real-browser acoustic sync, hitsounds and pitch-preserving DT/HT remain unverified/open. |
| M6 Default skin and visual parity | **OPEN** | Basic Pixi renderer exists; sprite parity, shader, HUD, FL and effects remain. |
| M7 Custom skins | **OPEN** | .osk and skin.ini support, IndexedDB and fallbacks remain. |
| M8 Player page | **IN PROGRESS** | Basic browsing, replay loading and controls exist. Settings, timeline enhancements, loading retries and mobile acceptance remain. |
| M9 MP4 export | **OPEN** | No WebCodecs/offline audio export yet. |
| M10 Lazer | **OPEN** | Legacy/stable only; lazer detection and rule set remain. |
| M11 Hardening | **IN PROGRESS** | Added ZIP central-directory resource/path checks, CRC32, bounded replay frames, and streaming byte limits for .osz, .osr and .osu. Backend now checks a mirror ZIP's central directory and that it contains a .osu difficulty before returning/caching it; corrupt or irrelevant ZIPs trigger the next mirror. Negative-case tests pass; R2, a stateful mirror breaker, deeper decompression limits, security review and production load tests remain. |
| M12 One Miss Merchants links | **OPEN** | Parameterized integration and INTEGRATION.md remain. |

## Verified recent commits

- `d786ab0`: missed slider ticks/repeats break combo; tail does not. Tests for part timing.
- `594f4f7`: explicit early slider-head miss keeps its own press timestamp.
- `27c3485`: add 30 flat ScoreV1 points for a successfully hit slider head; helper and full synthetic slider tests.
- `1f51c09`: correct the synthetic mixed-object map test, allowing map → replay generator → judge → ScoreV1 integration to pass.
- `13ab6e8`: optional Renatus acceptance test across *all* standard difficulties. Requires local copyrighted fixture, so is skipped in CI.
- `20d0eca`: prevent backwards replay frames for two simultaneous 2B circles.
- `9165d17`: clamp ScoreV1 difficulty multiplier to the specified 2–6 range.
- `6a0bbc5`: replace the fitted 1ms window reduction with stable's officially documented rounded-error, truncated-window and strict-less-than judgement. Synthetic fractional-boundary tests pass.
- `ba15f41`: expose SD/PF failTime on the event timeline, including missed slider ticks/repeats but not dropped tails; No Fail prevents failures. Additional regression tests verify repeats, spinner misses and early head misses.
- `e86ec6d`: avoid double score multiplication when speed-mod aliases appear together (NC+DT or DC+HT).

## Verification and recovery — 22 October 2026, continuation

- `4584e1b`: ZIP central-directory inspection and extraction size/path protections; 8 new archive tests.
- `8403e66`: checksum verification for extracted ZIP files; corrupted and forged CRC test cases.
- `06dc3ae`: fail-closed replay frame validation, including finite positions, valid key masks and frame limits.
- `7bd0f1e`: corrected playback clock offset/seek/pause/rate continuity with 4 instrumented AudioContext tests.
- `c474837`: persisted in-player audio/visual Sync control; web build passes, hands-on browser acceptance remains.
- `7cd860a`: exact replay/map checksum matching and explicit unverified fallback, with generated .osr integration tests.
- `3eebade`, `6ec900c`: capped streamed download sizes in worker and browser even when Content-Length is wrong or absent; streamed mock tests.
- `6e47153`: added `npm run judge-check:strict`. It must check at least one real stable replay and fails otherwise; the ordinary `npm run judge-check` remains CI-friendly for missing optional fixtures.
- `b45c27c`: completed 8 MiB streamed limits for .osu-only fallback text on browser and worker, with valid-text and oversized-input tests.
- `26bf17e`: validate central-directory metadata in fetched mirror ZIPs before accepting response for caching; retry next provider if malformed; Worker-compatible UTF-8 validation. `1242e81` adds comprehensive corrupt-metadata tests. Both GitHub Actions checks passed on `1242e81`; this is only structural envelope validation, not full decompression/CRC/authenticity verification.
- `1d38c1d`: reject and retry mirror archives with zero `.osu` difficulties. `5e35961` tests actual fallback behaviour, `b0b32d5` adds a negative envelope test. Both CI runs passed on the implementation commit. No claim of cryptographic authenticity or end-to-end download availability.

GitHub Actions covers Node web+worker tests, TypeScript checks, web build and the ordinary no-fixture judge-check. The latest verified implementation head recorded here is `b45c27ca7d81758f5f3a95b1970740a9b765db14` (GitHub Actions push checks passed; PR check was still in progress when this line was written). This is **not proof of human-replay parity, browser audio quality, Windows EXE correctness or complete security**.

The critical real-data acceptance command is now `npm run judge-check:strict` after placing exact-MD5-matched real files in gitignored `fixtures/replays/` and `fixtures/maps/`. It deliberately fails in normal CI without those private fixtures.

## Immediate next implementation work

1. Run `npm run judge-check:strict` and `npm run judge-check -- --require-fixtures --verbose <replay.osr>` using the local exact-MD5-matched real osu!stable replay fixture set (not committed); resolve count/combo mismatches before marking M2 PASS.
2. Validate the now documented-and-unit-tested strict rounded-error 300/100/50 windows against the real replay set; independently establish exact stable spinner velocity/RPM smoothing.
3. Run the optional all-difficulties Renatus autoplay acceptance test locally and fix any map-specific issues.
4. Complete M3's exact stable HP drain/gain and no-drain-during-break algorithm (failTime for SD/PF/NF is already verified). Then complete M4 ScoreV1 header parity and the audio/skin/export milestones.

## GitHub recovery and safety

- Development branch: `development/m2-slider-tracking`
- Draft PR: https://github.com/jakemcintyre25-stack/OSU-RENDER/pull/1
- Do not merge this draft or deploy unfinished changes.
- Never commit .osz, .osr, audio, skin assets, or user credentials.
