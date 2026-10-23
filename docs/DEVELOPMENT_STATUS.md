# OSU-RENDER — development and verification status

Updated: 23 October 2026. The 12-milestone specification in `osu-render-chatgpt-prompt.md` is the acceptance contract. This checklist reflects **verified features**, not the existence of scaffolding or partial code.

**Estimated project completion: ~25% by remaining engineering effort (rough planning judgement, not a measured or verified completion metric).** Large unresolved deliverables include exact real-replay parity, complete HP/score, hitsounds/audio, skins, video export and deployment acceptance. Only individual rows marked PASS have satisfied their named criteria.

## Milestone acceptance checklist

| Milestone | Status | Verification and outstanding work |
|---|---|---|
| M1 Judgement harness | **PASS** | `npm run judge-check`, verbose diagnostics and CI implemented. Empty optional fixtures exit zero. Real replay fixtures stay local. |
| M2 Stable judgement parity | **IN PROGRESS** | Strict checksum matching rejects updated beatmaps with unchanged IDs; `.osu`-only fallback labels uncertainty. Strict parity mode fails when no stable replay is checked. Slider timing, combo breaks, hit-window edges and 2B autoplay have synthetic tests. Spinner judgement now uses stable's half-spin requirement, one-half-spin-per-frame accumulation and 300/100/50/miss thresholds. Note-lock now ignores input on later overlapping objects while the earliest head is unjudged, with stable's 3 ms simultaneous-object tolerance. Stable's spinner acceleration smoothing and exact real-replay parity remain unverified. |
| M3 HP and fail | **IN PROGRESS** | Verified SD/PF failure timestamps from circle grades and slider-head/tick/repeat combo breaks, with NF precedence. `hp-stable.ts` now ports stable's drain search, normal/combo-end health gains, slider/spinner nested health, break pauses and negative-judgement HP-zero failure; `Session.hp` carries the computed trace. The player now renders a 200-unit HP bar and pauses at the calibrated negative-judgement failure with a fail overlay; seeking before the failure clears it. Real-replay HP parity remains unverified. |
| M4 Score V1 | **IN PROGRESS** | Running ScoreV1, mod multipliers and slider/spinner part scoring exist; HUD now displays calculated score and details panel compares against the replay header. Spinner points now follow stable's half-spin ticks and 1.5-spin bonus gap. The difficulty multiplier now uses stable's summed-break drain length, banker's rounding and no 2–6 clamp. Per-object combo bonuses now truncate combo × difficulty × mod before applying the hit value, matching stable's integer cast. ScoreV2 replays are detected from mod bit 29 and skipped by `judge-check` rather than compared as ScoreV1. It is labelled provisional; real header parity remains unverified. |
| M5 Audio timing and hitsounds | **IN PROGRESS** | Chart/user .osk hitsounds, successful spinner completion, user-skin spinner loops/bonus clips and judged tracked slider loops are scheduled on shared Web Audio time; independent music/FX gains, AudioLeadIn and map-before-skin WAV/MP3/OGG precedence are tested. Browser acoustic parity, licensed defaults and pitch-preserving DT/HT remain. See docs/M5-FINDINGS.md. |
| M6 Default skin and visual parity | **IN PROGRESS** | Procedural Pixi rendering covers circles, sliders, spinners, cursor/key HUD and a default-skin hit-light bloom. Full sprite parity, follow points, shaders, Flashlight and real-browser screenshot comparison remain OPEN. |
| M7 Custom skins | **IN PROGRESS** | Optional .osk WAV/MP3/OGG hitsounds and slider loops are recognized in root-level archive entries; LayeredHitSounds honored. Visual skin.ini layout, sprites, persistence and default licensed sound set remain OPEN. |
| M8 Player page | **IN PROGRESS** | Calculated ScoreV1 HUD, Sync and persisted 0.25×–2× speed, separate music/FX levels, persisted cursor-trail/key-overlay toggles, audio-outro seek range, clickable accessible miss/100 review markers, share-link action and latest-request-wins cancellation. Unit, abort and build checks pass; actual browser/mobile acceptance remains. |
| M9 MP4 export | **IN PROGRESS** | Two paths exist: bounded real-time WebM capture with synchronized audio, and a deterministic full-length exporter that steps fixed-FPS map time, mixes music/hitsounds in an OfflineAudioContext, and muxes MP4 (H.264/AAC) or WebM (VP9/VP8 + Opus) through Mediabunny. Export dialog, progress, cancel, codec probing and video-only fallback are implemented with 28 automated export tests. A real headless-Chrome run produced and re-parsed a 1280×720/30 fps MP4: 60 H.264 frames (2.000 s) plus 48 kHz stereo AAC (2.005 s), both starting at 0. Long-duration 1080p60, real-replay content, memory profiling and mobile acceptance remain OPEN. |
| M10 Lazer | **IN PROGRESS** | Lazer-origin replays are now detected from their `30000000+` game-version field and rejected with an explicit unsupported message; `judge-check` uses the same real detection. Lazer hit windows, scoring (including judgment and mod settings), replay semantics, skin parity and real lazer fixtures remain OPEN. |
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

### M3 HP event engine integration (23 October 2026)

- `d3aaeba1`, `4f4f81e6`: deterministic HP event engine with caller-provided coefficients, break-aware drain, clamped gains/losses, exact first zero-crossing and invalid-input checks. Both CI workflows passed on the test commit.
- `ec4c8382`, `ac671172`, `9025bad3`: bridge the **real judgement timeline** into the HP engine, preserving early-click and post-object miss times while excluding pre/post-object drain. Both CI workflows passed for the initial bridge; follow-up changes are subject to their own CI.
- `0fa8b1c7`: integration tests exercising real judged circle results, break-paused HP, early press misses, and invalid calibration; CI pending at time of writing.
- **M3 remains IN PROGRESS.** The HP engine is intentionally not enabled as a visible stable HP bar and does not alter `judge().failTime`. osu!stable HP coefficients, per-object nested HP gains, break refills, HP-zero failure and parity tests remain OPEN. No coefficients were guessed or labeled as verified.

### M3 nested slider HP integration (23 October 2026)

- `5e106ed9`: extend calibrated HP replay to consume **actual judged slider head, tick, repeat and tail outcomes** with independently configurable positive/negative changes. Existing callers without nested calibration retain previous behavior.
- `4bf812af`: real slider judgement integration regression test for a collected tick and missed tail, expected HP trace, and invalid nested calibration rejection. CI pending; do not mark PASS until both workflows succeed.
- **M3 IN PROGRESS:** These are explicit calibration inputs, not validated osu!stable coefficients. Slider HP result mapping, reference replay parity, break recovery and HP-zero gameplay failure remain OPEN.

### M3 nested HP correctness follow-up (23 October 2026)

- **Verified:** Both GitHub Actions workflows passed at `970c44b3`, including nested slider HP source and its first integration test.
- `c7a7c229`: Tag slider final judgement events so HP can distinguish the accuracy result from head/tick/repeat/tail events.
- `caff96b9`: Suppress duplicate slider final-result HP gains when nested calibration is active, and require every explicit nested coefficient to be finite (including missing keys).
- `473add18`: Add real-judgement regression tests for double-counting and omitted calibration values. CI must pass before this follow-up is considered verified.
- **Still IN PROGRESS:** Real osu!stable HP coefficient reference, break recovery, spinner HP events, HP-zero failure and authorized replay parity. No unvalidated calibration has been enabled in the player.

### M3 HP seeking support (23 October 2026)

- Previous checkpoint `d72023d0` verified: both GitHub Actions workflows passed, including slider HP double-counting regressions.
- `1ea4fd45`, `5ae764a3`: add `hpAt(trace, mapTime)` to query deterministic HP between judgement events, on break intervals, and after simultaneous event deltas; HP traces now preserve normalized active drain intervals and calibration rate. Regression tests cover seeking backward, overlapping breaks, zero crossings, bounds, and invalid times. CI pending for these changes.
- **M3 IN PROGRESS:** Seekable HP is an internal engine, not a reference-validated stable HP meter. Coefficients, break recovery, spinner events, and HP-zero failure remain OPEN.

### M3 HP break validation and drain-index optimization (23 October 2026)

- Both workflows passed at prior `0e4bbc56` checkpoint.
- `400e1ef3`, `4a30aa69`: fix zero-duration HP traces incorrectly accepting malformed break ranges, with regression coverage.
- `bf0e70fc`: replace repeated break-union traversal per judgement event with an indexed cumulative-drain lookup, preserving deterministic HP semantics. This improves simulation scaling on maps with many breaks and judgements; the seek query still builds an index per call and is not claimed to be globally O(log n).
- `6ecda751`: independently compare indexed drain to direct break arithmetic on 120 breaks and 300 events. CI pending at time of writing.
- **M3 IN PROGRESS:** No verified osu!stable HP coefficients, HP-zero player failure, or real-replay parity. Optimization and synthetic tests do not satisfy these acceptance criteria.

### Larger M6 implementation batch — indexed Pixi visibility (23 October 2026)

- Previous HP optimization `586e3976` passed both GitHub Actions workflows.
- `84e218dd`: add a seekable visibility index for sorted hit objects, preserving long overlapping sliders/spinners via prefix maximum end times.
- `1761afe5`: integrate indexed candidates into the real Pixi render loop, while retaining existing judgement-specific fade and hit handling.
- `6e584ba9`, `90a6f538`: test arbitrary backward/forward seeks, overlap boundaries and compare against exhaustive visibility over 4,000 mixed objects and hundreds of timestamps. CI pending; do not claim frame-rate improvements without browser profiling.
- **M6 IN PROGRESS:** Visual sprite parity, shaders, custom skin layout, Flashlight and browser performance profiling remain OPEN.

### Larger M7 implementation batch — real .osk hitcircle sprites (23 October 2026)

- Previous M6 renderer indexing checkpoint `fd8b4fa4` passed both GitHub Actions workflows.
- `3db89b0a`: add root-level .osk PNG visual asset resolution, including @2x preference and per-sprite decode failure isolation.
- `933f4191`: integrate actual custom hitcircle and overlay textures into the Pixi renderer, retaining fallback graphics for unsupported assets.
- `358b2d38`: wire visual-only .osk acceptance and image decoding to the real replay startup lifecycle with request-gate cancellation.
- `9bbe7f3d`: tests for case-insensitive matching, retina precedence, path exclusion, corrupt sprites and visual-only archives.
- **M7 IN PROGRESS:** Only hitcircle and hitcircleoverlay sprites are rendered so far; remaining enumerated assets are parsed but not rendered. Image alignment, tint semantics, @2x pixel density, animated sprites, complete skin.ini settings and real-browser visual parity are OPEN. CI pending for integration and tests.

### M7 visual-skin follow-up (23 October 2026)

- Prior full M7 checkpoint `bc07d7ec` passed both GitHub Actions workflows.
- `3b7eb6d1`: draw custom cursor sprites from user .osk skins with fallback cursor and press feedback.
- `43edafb1`: correct cursor press scaling so a 64-unit normalized custom cursor retains its intended size.
- `e309fe54`: draw custom approach-circle sprites with timing, fade and Hidden mod handling, preserving graphics fallback.
- **Verification:** new changes pushed to development branch; CI pending. Browser screenshot comparisons, custom cursor animation, skin.ini semantics and remaining slider/spinner sprite support are OPEN. M7 stays IN PROGRESS.

### M7 extended sprite-rendering batch (23 October 2026)

- Previous checkpoint `9fab8bda` passed both CI workflows.
- `efb8ec05`: custom slider-ball and tracking-follow sprites are now drawn during real slider playback; both CI workflows passed.
- `64cc06ec`: custom spinner-circle and spinner-approach sprites are drawn with replay cursor rotation and timing. CI pending.
- `ee6058c0`: custom cursor-trail sprites are drawn along replay positions, respecting the existing trail toggle. CI pending.
- **M7 IN PROGRESS:** Full skin.ini interpretation, slider end/reverse arrow graphics, stable sprite alignment, @2x handling beyond size normalization, browser visual comparison and animation remain OPEN. No deployment or main-branch merge.

### M7 reverse-arrow implementation (23 October 2026)

- Prior `2edf4fcf` checkpoint passed both CI workflows.
- `b2bdff72`: render .osk reverse-arrow sprites at active slider repeat endpoints, rotated to point into the return path; retain vector arrow fallback.
- `c27b269a`: align custom reverse-arrow alpha with Hidden and slider fades.
- **Verification:** CI pending on these new changes; no real-browser visual comparison. M7 remains IN PROGRESS. Next: fix any CI failures, add real renderer regression coverage and verify skin.ini and sprite geometry.

### M7 skin.ini configuration integration (23 October 2026)

- Prior reverse-arrow checkpoint `f1d681e6` passed both CI workflows.
- `970771db`: parse bounded, explicitly supported [General] skin.ini cursor and slider settings; both CI workflows passed.
- `fad2a984`: apply CursorRotate and CursorExpand in the actual renderer (other parsed settings not yet applied).
- `f1502bd4`: wire parsed settings from the selected .osk into player startup.
- `e7633264`: regression coverage for boolean values, out-of-section overrides and malformed settings.
- **M7 IN PROGRESS:** CursorCentre and slider options are parsed but not yet implemented; complete skin.ini parity, real browser sprite comparison and remaining skin assets are OPEN. Latest CI pending.

### M7 CI repair and further skin.ini renderer support (23 October 2026)

- `54c237dd` failed both CI workflows: skin.ini test fixture used literal backslash-n rather than newline escapes; 178 other tests passed, 12 intentionally skipped.
- `2e96b78a`: repair skin.ini fixture; CI pending.
- `685fdc45`: apply CursorCentre anchor and SliderBallFlip direction changes in the actual renderer, in addition to CursorRotate and CursorExpand.
- `e03e00b2`: additional BOM, comments, case-insensitive sections, input bounds and animation-count regression tests. CI pending.
- **M7 IN PROGRESS:** SliderBallFrames is parsed but animated frame sequences are not implemented. No real browser visual parity or MP4 export. Do not mark PASS until CI and acceptance checks complete.

### M9 video capture — independent implementation batch (23 October 2026)

- Deferred real-browser skin screenshot comparisons and unavailable private osu!stable fixtures; no parity claims.
- Fixed broken M7 BOM fixture and excessive-compression-ratio test interaction (`e9ae91b2`, `7b136cdf`), without weakening archive security checks.
- `4bce4659`: browser MediaRecorder WebM capture with supported codec negotiation, 30 fps, 60-second duration limit, 256 MiB memory ceiling, explicit cancellation and safe filenames.
- `05ebabea`, `425b25da`: player button and capture/download lifecycle; records the existing Pixi canvas and cancels on navigation. Video-only by design, **not MP4** and no synchronized audio.
- `55a1be86`, `90513f5c`: capture boundary and filename tests, plus syntax correction.
- `f8d84e55`: auto-save the recording at 59 seconds, before the hard 60-second safety stop.
- **M9 IN PROGRESS:** CI on final batch pending. Browser encoder acceptance, synchronized audio, deterministic fixed-FPS offline rendering, full replay export, MP4 container/codec and download-quality tests are OPEN. This is a limited video-only capture, not a completed export milestone.

### M9 browser recorder lifecycle hardening (23 October 2026)

- Prior `af9b7aa6` checkpoint passed both CI workflows after M9 WebM capture implementation.
- `478992cf`: safely handle the duration safety-timer's asynchronous stop rejection and clear pending callback state after encoder startup failure.
- `f35184e9`: integration-style fake browser recorder tests covering captured Blob data, stream-track release, stopped state and encoder startup errors.
- **M9 IN PROGRESS:** CI for this hardening pending. Browser device/codec acceptance, capture playback, synchronized audio, deterministic fixed-frame-rate full replay and MP4 encoding are OPEN. WebM remains video-only.

### M9 capture-stream robustness (23 October 2026)

- Prior recorder lifecycle checkpoint `1f750e7b` passed both CI workflows.
- `c1d473af`: reject canvas streams with no video track and stop their stray tracks; check incoming Blob size against remaining capture budget before retaining it.
- `cf4cc5d9`: adapt browser recorder mocks and add empty-video-track regression.
- **M9 IN PROGRESS:** New CI pending. Browser recording acceptance, synchronized audio, long-duration deterministic rendering and MP4 export remain OPEN. No user-provided fixture required for independent recorder hardening.

### M9 CI regression recovery (23 October 2026)

- `c1d473af` introduced a valid new guard for empty canvas video tracks, but the recorder-stop error test still supplied a partial fake stream without `getVideoTracks()`. GitHub Actions at `842a7c4c` failed **1 of 199 tests** with `TypeError: stream.getVideoTracks is not a function`; typecheck/build did not run in those failed jobs.
- `c3473cb8`: corrected the recorder-stop test fixture to provide a video track, preserving the production guard and the intended stop-failure assertion. **Both GitHub Actions runs passed** on `c3473cb84798aed45581900d580cbac298a4a541` (IDs `39911773354` and `39911780104`).
- M9 is now **IN PROGRESS**, not OPEN or PASS. WebM recorder tests are instrumented mocks; no real-browser codec, audio-sync or MP4 acceptance has occurred.

### M9 synchronized-audio capture (23 October 2026)

- Prior checkpoint `ff75aaa` kept the recorder lifecycle green. `8d72fad` adds a real-time audio tap without changing preview playback or the master clock.
- `Clock.createCaptureAudio()` connects the independent music and hit-effect buses to one `MediaStreamAudioDestinationNode`, returns its audio track, and releases the graph/track idempotently on recorder stop, cancellation or player disposal.
- `ReplayVideoCapture` negotiates Opus WebM codecs when an audio tap is supplied, adds the track to the canvas stream, reports whether audio was actually captured, and falls back to the existing video-only path when the browser cannot mux Opus. Every success, error and stop-throw path now releases both media tracks and the audio tap.
- Player copy distinguishes “WebM with synchronized audio” from video-only fallback, and the download filename follows the negotiated container.
- Automated evidence: **192 web tests passed, 12 skipped** (5 new audio-capture tests), **42 worker tests passed**, web typecheck passed, production build passed. This sandbox could not use Vitest's default forked pool or the `judge-check` child-process test (piped child-process spawn is denied); those were run as far as the sandbox allows with `--pool=threads`.
- **Both GitHub Actions runs passed** on `a147a75` (push `39935520244`, pull request `39935524449`), covering the full test, typecheck and build jobs including the child-process `judge-check` test that this sandbox cannot spawn.
- **Still OPEN:** this is real-time MediaRecorder capture, not deterministic fixed-FPS rendering; it is WebM-only, capped at 60 seconds/256 MiB, and has not been acoustically verified on a real browser or device. Native MP4, offline audio mixing, full-length export, frame-drop resistance and A/V timestamp inspection remain M9 acceptance work.

### M2/M4 stable spinner parity (23 October 2026)

- Source-derived from the stable `SpinnerOsu` excerpts in [ppy/osu#24661](https://github.com/ppy/osu/pull/24661), not fitted to the previous ten replay totals.
- `spinnerHalfSpinsRequired` implements stable's `MapDifficultyRange(OD, 3, 5, 7.5)` half-spins-per-second requirement, truncated per spinner duration.
- `judgeSpinner` now accumulates at most one half-spin per held replay frame and uses stable's threshold order: requirement zero auto-clears, below 25% misses, `> requirement` is 300, `> requirement - 2` is 100, otherwise 50.
- `spinnerSpinPoints` awards 100 on ordinary even half-spins and 1100 only after the `requirement + 3` half-spin threshold, reproducing stable's 1.5-spin bonus gap.
- `judge-check` verbose output shows half-spin counts and the stable requirement.
- Automated evidence: **193 tracked web tests passed, 12 skipped**, web typecheck passed, production build passed. The concurrent M9 worktree also had 23 untracked export tests; those passed but are not part of this commit.
- **Both GitHub Actions runs passed** on `5997702` (push `39937721422`, pull request `39937727347`), including the full test, typecheck and build jobs.
- **M2/M4 remain IN PROGRESS:** stable's acceleration smoothing is not reconstructed and no rights-cleared real replay set was available to rerun `judge-check:strict`. Synthetic tests prove the quoted rules, not real header parity.

### M4 stable difficulty multiplier and drain quirks (23 October 2026)

- Source: `OsuLegacyScoreSimulator` and `CalculateDifficultyPeppyStars` in [ppy/osu](https://github.com/ppy/osu/blob/master/osu.Game.Rulesets.Osu/Difficulty/OsuLegacyScoreSimulator.cs), including the x87/precision rationale in [ppy/osu@02975b9](https://github.com/ppy/osu/commit/02975b94985b5327bd2c953013ed4e6c01bc385d).
- `stableDrainSeconds` now sums **every** break using banker-rounded endpoints, then integer-divides the first-to-last span. Overlapping breaks are deliberately counted twice, matching stable rather than the previous union/clipping model.
- `difficultyMultiplier` now treats `drainSeconds === 0` as density 16, uses banker's rounding, and no longer applies the unverified 2–6 clamp.
- Integration tests parse a real `.osu` with three overlapping breaks and assert the 29-second summed drain; unit tests cover banker rounding and the zero-drain branch.
- `hitPoints()` now truncates `combo × difficulty × mod` to an integer before applying the hit value, matching stable's integer cast; a fractional 42.4 multiplier now awards 804, not 808.
- `decodeReplay()` exposes `scoreV2` from mod bit 29, and `judge-check` skips ScoreV2 fixtures instead of comparing them against ScoreV1. The unexplained 3–23× headers had no ScoreV2 bit, so that gap remains open.
- Automated evidence: **211 web tests passed, 12 skipped**, web typecheck passed, production build passed. CI remains authoritative.
- **M4 remains IN PROGRESS:** the historical replay score tables were not recomputed because the rights-cleared fixtures are unavailable, and the unexplained NM/`3f4e99ff` 3–23× score gap is still open. Source alignment is not real-header proof.

### M3 stable HP calibration and failure engine (23 October 2026)

- Source: McOsu's stable-compatible `OsuBeatmapStandard::computeDrainRate()`, `OsuScore::getHealthIncrease()` and `OsuSlider`/`OsuSpinner` health paths, which mirror the stable client.
- `computeStableHpCoefficients()` ports stable's simulated-perfect-play drain search: 200-unit bar, `lowestHpEver`/`lowestHpComboEnd`/`lowestHpEnd` targets, recovery check, break handling, and the normal/combo-end multiplier adjustments.
- `stableHpGains()` covers miss, 50/100/300, slider-break, slider head/tick/repeat, spinner spin/bonus, and combo-end geki/katu/MU gains.
- `stableHpFromJudgement()` builds a real HP trace with nested slider/spinner events, combo-end bonuses, breaks and first negative-judgement failure. No Fail suppresses failure.
- Synthetic coverage: 11 HP tests (calibration monotonicity, 200-unit bar, zero-object map, gain signs, all-300 survival, miss failure, NF suppression, slider/spinner nested health, missed-tick loss, combo-end gain).
- Automated evidence: **211 web tests passed, 12 skipped**, web typecheck passed, production build passed. CI remains authoritative.
- **M3 remains IN PROGRESS:** the visible HP bar and player failure presentation require changes to `main.ts`/`style.css`, currently owned by the M9 export worker. No rights-cleared replay HP comparison has been run, so calibration parity is source-derived, not measured.

### M2 stable note-lock correction (23 October 2026)

- Reference: [Notelock wiki](https://osu.ppy.sh/wiki/en/Gameplay/Judgement/Notelock).
- Reverted round 2's later-object matching. Only the earliest live head can receive a press; input on a later overlapping object or empty space is wasted until the earlier object's MEH window passes.
- A hit slider head still releases the lock so later objects can be hit while the slider body is active.
- Tests in `judge-matching.test.ts` and `judge-head.test.ts` now cover the lock, the release after judging, the 3 ms simultaneous-object tolerance and the unchanged first-hit behaviour.
- Automated evidence: **211 web tests passed, 12 skipped**, web typecheck passed, production build passed.
- **M2 remains IN PROGRESS:** stable's spinner acceleration smoothing is not specialised, and no real-replay rerun was possible.
### M10 lazer replay detection and gating (23 October 2026)

- Source: osu!lazer's `LegacyScoreEncoder` writes its database version (`30000000+`) into the legacy header's game-version field; stable writes a `YYYYMMDD` build date. `FIRST_LAZER_GAME_VERSION = 30_000_000` is therefore a reliable origin boundary, unlike filename heuristics or the ScoreV2 mod bit.
- `LoadedReplay` now exposes `gameVersion` and `isLazer`; `sessionFromReplay` rejects lazer replays with a specific message instead of presenting a stable-parity judgement that does not apply.
- `judge-check` already skipped `replay.isLazer`; that path now works from decoded header data rather than only from filenames.
- Synthetic coverage: stable and lazer encoded `.osr` headers, the version boundary, and the session rejection path.
- Automated evidence: **211 web tests passed, 12 skipped**, web typecheck passed, production build passed. CI remains authoritative.
- **M10 remains IN PROGRESS:** lazer hit windows, judgements, score model, mod settings, replay semantics, skin parity and real lazer fixtures are still required. Detection is not lazer support.

### M9 deterministic full-length export (23 October 2026)

- This branch adds the implemented pipeline. New pure layers: `render/export/timeline.ts` (fixed frame count and exact map/output timestamps), `render/export/frames.ts` (ordered render/add loop with abort and progress) and `render/export/codecs.ts` (MP4-first codec policy).
- `audio/offline-mix.ts` plans and renders music plus hitsound events/loops on an `OfflineAudioContext`. Negative AudioLeadIn becomes a delayed music start; a positive export start becomes a seek offset; loop phase is preserved when the export begins inside a tracked slider.
- `render/export/export-video.ts` probes real encoders with Mediabunny (`canEncodeVideo`/`canEncodeAudio`), adds a fixed-rate `CanvasSource`, optionally an AAC/Opus `AudioBufferSource`, and finalises MP4/H.264 or WebM/VP9/VP8. It is lazy-loaded as a separate ~255 KB chunk.
- The player now has an **Export video** dialog with 720p/1080p, 30/60 fps, codec capability text, an estimated frame count, progress, cancel and a local download. Export uses a hidden 1280×720/1920×1080 renderer at resolution 1 and pauses preview playback; the preview is rebuilt after the export renderer is destroyed.
- Design and acceptance detail: `docs/M9-EXPORT.md`. Dependency note: Mediabunny is MPL-2.0 and is bundled locally, not hotlinked.
- Automated evidence: **28 export-focused tests** across timeline, frame loop, codec policy, offline mix and mux orchestration. On the rebased tree the full web suite passed **239 tests (12 skipped)**, worker tests passed **42**, web typecheck passed and the production build passed.
- Real-browser check: headless Chrome 155 (Windows) produced a **1280×720/30 fps MP4** from a synthetic canvas and tone in 426 ms (444,500 bytes). It re-opened in `HTMLVideoElement` and was parsed with Mediabunny: **60 H.264 packets, 2.000 s; 94 AAC stereo 48 kHz packets, 2.005 s; both first timestamps 0; end delta 5.33 ms** (AAC padding). This run found and fixed a real deadlock: `Output.getMimeType()` was awaited before the first frame, so no codec metadata could ever arrive (the codec-metadata ordering fix in this branch). This branch also makes `@types/node` explicit so clean-install CI typechecks.
- **Still OPEN:** 3-minute 1080p60, real replay/audio content, peak-memory profiling, mobile browsers and DT/HT acoustic acceptance. M9 is not PASS; no deployment.

### M6 default hit lighting (24 October 2026)

- `render/hit-light.ts` adds a bounded 160 ms white bloom with expansion and fade, used by the Pixi renderer behind hit circles and slider heads.
- `hit-light.test.ts` covers hidden-before/after, fade/scale and invalid-duration cases.
- Automated evidence: full web suite and build run after the change (see the integration branch CI).
- **M6 remains IN PROGRESS:** follow points, full default-skin sprite parity, shaders, Flashlight and real-browser screenshots remain OPEN.

## Immediate next implementation work

1. **Independent:** wire the stable HP trace into the player once `main.ts`/`style.css` ownership is free; add the visible HP bar and fail overlay with M8 accessibility checks. Maintain explicit stable parity uncertainty until real evidence exists.
2. **Independent:** fill out M8 timeline marker interactions, additional tested controls, and M5/M7 sound/skin semantics without distributing copyrighted samples.
3. **Requires local rights-cleared fixtures:** run `npm run judge-check:strict` on exact-MD5-matched real osu!stable `.osr`/`.osz` pairs and the optional all-difficulties Renatus autoplay test. Resolve counts/combo/score parity before declaring M2/M4 PASS.
4. **Requires integration environment:** run a real-browser/audio and Windows standalone EXE smoke test; establish the separate renderer hostname and OMM profile/match link contract. OMM-side deployment/merges remain unauthorized and are not prerequisites for independent work.
5. Open beyond those: default/custom visual skin parity, DT/HT pitch-preserving stretch, deterministic full-length WebCodecs/MP4 export (real-time WebM with synchronized audio now exists), lazer rules and production hardening.

## GitHub recovery and safety

- Development branch: `development/m2-slider-tracking`
- Draft PR: https://github.com/jakemcintyre25-stack/OSU-RENDER/pull/1
- Do not merge this draft or deploy unfinished changes.
- Never commit .osz, .osr, audio, skin assets, or user credentials.
