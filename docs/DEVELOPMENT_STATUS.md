# OSU-RENDER — development and verification status

Updated: 23 October 2026. The 12-milestone specification in `osu-render-chatgpt-prompt.md` is the acceptance contract. This checklist reflects **verified features**, not the existence of scaffolding or partial code.

**Estimated project completion: ~25% by remaining engineering effort (rough planning judgement, not a measured or verified completion metric).** Large unresolved deliverables include exact real-replay parity, complete HP/score, hitsounds/audio, skins, video export and deployment acceptance. Only individual rows marked PASS have satisfied their named criteria.

## Milestone acceptance checklist

| Milestone | Status | Verification and outstanding work |
|---|---|---|
| M1 Judgement harness | **PASS** | `npm run judge-check`, verbose diagnostics and CI implemented. Empty optional fixtures exit zero. Real replay fixtures stay local. |
| M2 Stable judgement parity | **IN PROGRESS** | Strict checksum matching rejects updated beatmaps with unchanged IDs; `.osu`-only fallback labels uncertainty. Strict parity mode fails when no stable replay is checked. Slider timing, combo breaks, hit-window edges and 2B autoplay have synthetic tests; exact real-replay parity, spinner smoothing and complex note-lock remain unverified. |
| M3 HP and fail | **IN PROGRESS** | Verified SD/PF failure timestamps from circle grades and slider-head/tick/repeat combo breaks, with NF precedence. Exact stable HP drain, hit gains, break pauses, HP timeline and HP-zero failure remain. |
| M4 Score V1 | **IN PROGRESS** | Running ScoreV1, mod multipliers and slider/spinner part scoring exist; HUD now displays calculated score and details panel compares against the replay header. It is labelled provisional. Real header parity remains unverified. |
| M5 Audio timing and hitsounds | **IN PROGRESS** | Chart/user .osk hitsounds, successful spinner completion and judged tracked slider loops are scheduled on shared Web Audio time; independent music/FX gains, AudioLeadIn and map-before-skin WAV/MP3/OGG precedence are tested. Browser acoustic parity, spin/bonus sounds, licensed defaults and pitch-preserving DT/HT remain. See docs/M5-FINDINGS.md. |
| M6 Default skin and visual parity | **OPEN** | Basic Pixi renderer exists; sprite parity, shader, HUD, FL and effects remain. |
| M7 Custom skins | **IN PROGRESS** | Optional .osk WAV/MP3/OGG hitsounds and slider loops are recognized in root-level archive entries; LayeredHitSounds honored. Visual skin.ini layout, sprites, persistence and default licensed sound set remain OPEN. |
| M8 Player page | **IN PROGRESS** | Calculated ScoreV1 HUD, Sync and persisted 0.25×–2× speed, separate music/FX levels, persisted cursor-trail/key-overlay toggles, audio-outro seek range, clickable accessible miss/100 review markers, share-link action and latest-request-wins cancellation. Unit, abort and build checks pass; actual browser/mobile acceptance remains. |
| M9 MP4 export | **OPEN** | No WebCodecs/offline audio export yet. |
| M10 Lazer | **OPEN** | Legacy/stable only; lazer detection and rule set remain. |
| M11 Hardening | **IN PROGRESS** | ZIP/CRC32 limits, bounded replay frames, browser and Worker streamed `.osr` / `.osz` / `.osu` downloads, plus local-upload pre-read caps. The Worker replay upstream now uses a 64 MiB streaming ceiling rather than unrestricted allocation. Tested per-isolate mirror breaker: 3 failures → 10-minute cooldown; 404 not counted. R2/global breaker, security audit, decompression testing and production loads remain. |
| M12 One Miss Merchants links | **IN PROGRESS** | Validated `?user=<osu ID>` auto-list and `?score=<score ID>` playback, canonical copy-link action, documented OMM read-only external-link contract in docs/INTEGRATION.md. OMM-side profile/match links, actual hostname, API/live-browser acceptance and rollback work remain OPEN. |

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
- `f4d76e7`, `20dd797`: looping chart/skin sliderslide and sliderwhistle samples follow judged tracking intervals; fix mid-slider seek alignment to Web Audio start, both workflows pass. `c954d60` accepts .osk files that contain only slider audio.
- `1bfe12c`: check indexed WAV/MP3/OGG inside beatmap before skin; exact custom filenames remain strict.
- `8b65e9f`, `c899315`: reconstructed running ScoreV1 HUD and replay header comparison (explicitly provisional) with seek and formatting tests.
- `0e733f1`: enable validated `?user` and `?score` deep links and Share replay control, both GitHub Actions workflows passed. See `docs/INTEGRATION.md` for OMM-side unfinished contract.
- `a513431`: parse and use real AudioLeadIn while retaining compatibility with test maps; both workflows passed after fixing negative-zero and optional-property cases.
- `c77741e`, `c53da26`: latest-request-wins cancellation over web score/replay/map API, avoiding stale player takeover; gate and fetch signal tests pass.
- `5d264ee`: persistent viewer speed selector (0.25×–2×), combined multiplicatively with DT/HT map rate; both GitHub Actions checks pass.
- `da33a5c`: interactive keyboard/pointer review of miss/100 timeline markers, seeking two seconds earlier in map time. Tests `web/test/marker-review.test.ts`; both workflows passed.
- `cdf88ca`, `13d3860`: split music and hitsound volume into independent persisted Web Audio buses, with timing/volume isolation and clamping tests.
- `a9ace61`, `163443c`: three-strike, ten-minute **per-isolate** mirror breaker with HTTP 404 exception, healthy mirror fallback and state-isolated tests. Both workflows pass on `a9ace61`.
- `6408f44`, `fe22125`, `9ac9516`, `55cdf83`: cancel stale AudioContext resume after dispose/seek/speed, coalesce concurrent resume calls, and regression-test all paths. The first test commit timed out, then production coalescing fixed the race; both final workflows passed on `55cdf83`.
- `333ac20`, `3fb4f6d`: add independent persisted UI toggles for cursor trail and key-press overlay; test missing/invalid saved preferences. Check final CI on `333ac20`.
- `d9d7fbe`, `5a74b49`: Worker-side osu! replay fetch now uses shared bounded response streaming with 64 MiB cap; tests reject dishonest declared/actual replay body lengths without buffering the full payload. Source CI passed at `d9d7fbe`; inspect Actions for final added tests at `5a74b49`.

GitHub Actions covers Node web+worker tests, TypeScript checks, web build and the ordinary no-fixture judge-check. Latest verified audio lifecycle checkpoint: `55cdf8356b5433f873c724a326c43e8ebfc96707` (both push and PR workflow runs passed following the original 30s concurrent-resume test failure). Subsequent M8 settings commits are covered by their own GitHub Actions checks. Automated suite success is not real replay parity, browser audio acceptance, or a Windows EXE test. This is **not proof of human-replay parity, browser audio quality, Windows EXE correctness or complete security**.

The critical real-data acceptance command is now `npm run judge-check:strict` after placing exact-MD5-matched real files in gitignored `fixtures/replays/` and `fixtures/maps/`. It deliberately fails in normal CI without those private fixtures.

### Additional M11 stream-hardening checkpoint (23 October 2026)

- `dcbc9787`: reject malformed, negative, fractional, exponent and unsafe `Content-Length` hints; cancel upstream bodies immediately when a declared size exceeds the ceiling.
- `09b11fd0`: add dedicated `worker/test/bounded-stream.test.ts` cases for exact byte ceilings, streamed overruns and invalid declared lengths.
- **IN PROGRESS:** Both commits are pushed to `development/m2-slider-tracking`; GitHub Actions must be checked before marking this checkpoint verified. The prior `05363632` checkpoint passed both push and PR workflows.
- **OPEN:** Independent production memory/load profiling, globally coordinated provider breaker and real upstream network acceptance.

### M3 HP timeline groundwork (23 October 2026)

- `0d6029d2`, `79884e49`: Implement and test break-excluded, nonoverlapping active HP time intervals with sorted/overlapping breaks, clipping, and invalid timestamp rejection.
- **IN PROGRESS:** This is the exact *time-domain* prerequisite for HP simulation; it does **not** supply osu!stable's HP drain coefficients, hit gain, break refill, or HP-zero fail. Those remain OPEN and require reference rules and acceptance.
- Verification: GitHub Actions checks for `79884e49` pending; do not mark M3 complete on synthetic interval tests alone.

### M3/M4 integration checkpoint (23 October 2026)

- `62e5ba47`: Replace the real beatmap ScoreV1 density calculation's naïve sum of break lengths with the tested union/clipping of actual map breaks. This corrects overlapping/duplicated breaks without changing the existing first-to-last-start convention. Both CI workflows passed on this commit.
- `e7e63ca3`: Add integration tests that parse actual `.osu` source text with overlapping breaks and compare the resulting difficulty multiplier with a merged equivalent. CI pending at time of entry.
- **M3 IN PROGRESS:** Break-aware timing is wired into ScoreV1, not yet the HP meter. Reference HP drain/gain and HP-zero failure remain OPEN. **M4 IN PROGRESS:** ScoreV1 density break handling is improved; replay-header parity remains unverified.

## Immediate next implementation work

1. **Independent:** finish M3's calibrated HP drain/gain, no-drain-during-breaks and HP-zero failure checks. Maintain explicit stable parity uncertainty until real evidence exists.
2. **Independent:** fill out M8 timeline marker interactions, additional tested controls, and M5/M7 sound/skin semantics without distributing copyrighted samples.
3. **Requires local rights-cleared fixtures:** run `npm run judge-check:strict` on exact-MD5-matched real osu!stable `.osr`/`.osz` pairs and the optional all-difficulties Renatus autoplay test. Resolve counts/combo/score parity before declaring M2/M4 PASS.
4. **Requires integration environment:** run a real-browser/audio and Windows standalone EXE smoke test; establish the separate renderer hostname and OMM profile/match link contract. OMM-side deployment/merges remain unauthorized and are not prerequisites for independent work.
5. Open beyond those: default/custom visual skin parity, DT/HT pitch-preserving stretch, full video/audio MP4 export, lazer rules and production hardening.

## GitHub recovery and safety

- Development branch: `development/m2-slider-tracking`
- Draft PR: https://github.com/jakemcintyre25-stack/OSU-RENDER/pull/1
- Do not merge this draft or deploy unfinished changes.
- Never commit .osz, .osr, audio, skin assets, or user credentials.
