# OSU-RENDER — development and verification status

Updated: 23 October 2026. The 12-milestone specification in `osu-render-chatgpt-prompt.md` is the acceptance contract. This checklist reflects **verified features**, not the existence of scaffolding or partial code.

**Estimated project completion: ~25% by remaining engineering effort (rough planning judgement, not a measured or verified completion metric).** Large unresolved deliverables include exact real-replay parity, complete HP/score, hitsounds/audio, skins, video export and deployment acceptance. Only individual rows marked PASS have satisfied their named criteria.

## Milestone acceptance checklist

| Milestone | Status | Verification and outstanding work |
|---|---|---|
| M1 Judgement harness | **PASS** | `npm run judge-check`, verbose diagnostics and CI implemented. Empty optional fixtures exit zero. Real replay fixtures stay local. |
| M2 Stable judgement parity | **IN PROGRESS** | Strict checksum matching rejects updated beatmaps with unchanged IDs; `.osu`-only fallback labels uncertainty. Strict parity mode fails when no stable replay is checked. Slider timing, combo breaks, hit-window edges and 2B autoplay have synthetic tests; exact real-replay parity, spinner smoothing and complex note-lock remain unverified. |
| M3 HP and fail | **IN PROGRESS** | Verified SD/PF failure timestamps from circle grades and slider-head/tick/repeat combo breaks, with NF precedence. Exact stable HP drain, hit gains, break pauses, HP timeline and HP-zero failure remain. |
| M4 Score V1 | **IN PROGRESS** | Running ScoreV1, mod multipliers, slider/spinner part scoring implemented. Fixed 30-point slider heads, clamped difficulty multiplier to 2–6, and normalized NC/DT and DC/HT speed-mod aliases. Real header parity remains unverified; older M4 replay comparison values are stale. |
| M5 Audio timing and hitsounds | **IN PROGRESS** | Implemented beatmap and optional user-supplied .osk layered samples for circles/sliders and spinner completion, bounded decoding and seek-safe Web Audio scheduling; honors LayeredHitSounds in the chosen skin. Synthetic ZIP and AudioContext tests pass. Bundled defaults, slider/spinner loops, acoustic real-browser parity and pitch-preserving DT/HT remain. See docs/M5-FINDINGS.md. |
| M6 Default skin and visual parity | **OPEN** | Basic Pixi renderer exists; sprite parity, shader, HUD, FL and effects remain. |
| M7 Custom skins | **IN PROGRESS** | Users can import an .osk ZIP from the homepage for actual WAV/MP3/OGG Normal/Soft/Drum hitsounds, including the LayeredHitSounds skin.ini setting. No skin.ini visual layout, sprite replacement, persistence, full visual skin integration or default bundled sound set yet. |
| M8 Player page | **IN PROGRESS** | Basic browsing, replay loading and controls exist; audio/visual Sync slider and music-outro-aware seek/end range now tested. Settings, mobile/browser acceptance, loading recovery and richer timeline remain. |
| M9 MP4 export | **OPEN** | No WebCodecs/offline audio export yet. |
| M10 Lazer | **OPEN** | Legacy/stable only; lazer detection and rule set remain. |
| M11 Hardening | **IN PROGRESS** | Added ZIP central-directory resource/path checks, CRC32, bounded replay frames, streaming byte limits for .osz/.osr/.osu, and browser pre-read size caps for local .osr/.osz/.osk uploads. Backend checks mirror ZIP contents and retries invalid archives. Negative-case tests pass; R2, a stateful mirror breaker, deeper decompression limits, security review and production load tests remain. |
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
- `7a0fc0b`: wire beatmap-provided hitsound samples to the music AudioContext; judged .osu metadata, custom file paths, playable circle/slider cues and nested archive support. `web/test/hitsounds.test.ts` validates the genuine archive parser and replay judgement integration.
- `0417b35`: verify exact sample set selection for early hits near timing point changes, preserving actual sound trigger timestamp.
- `ed5a847`: cap concurrent sample decoding, reject stale/disposed audio loads, and enforce active voice limits with instrumented AudioContext tests.
- `77ec204`: keep music outros accessible beyond last hit object in player seek/timing controls.
- `b9fc495`: verify Clock-to-hitsound node integration with pause/seek cleanup; both tests and typecheck passed on the push CI run (PR workflow acceptance tracked separately). Details and outstanding acoustic/browser acceptance: `docs/M5-FINDINGS.md`.
- `d056cc7`: actual spinner-completion Normal/Finish/Clap samples conditional on judgement; tests cover success, miss and missing asset.
- `ae50e1b`: load user .osk through homepage and apply unindexed skin audio in session playback, preserving map-asset priority and explicitly named sample behaviour. CI passed both workflows. `dbc7172` adds the session-level integration test.
- `f778ca7`: reject oversized local .osr/.osz/.osk files before File.arrayBuffer() allocation. `d568635` tests file-type ceilings and invalid size metadata; both implementation workflows passed.
- `06b4140`, `5321845`: implement and test skin.ini LayeredHitSounds=0/1 to respect normal/addition layer selection; implementation CI passed both workflows.

GitHub Actions covers Node web+worker tests, TypeScript checks, web build and the ordinary no-fixture judge-check. The latest verified code head recorded here is `b9fc495e547d139e0a2d693951f470795a8ce24f` (GitHub Actions push tests, TypeScript and build passed; see Actions for both push and PR conclusions). This is **not proof of human-replay parity, browser audio quality, Windows EXE correctness or complete security**.

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
