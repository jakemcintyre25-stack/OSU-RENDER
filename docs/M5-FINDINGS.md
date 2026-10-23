# M5 — Sound / audio timing: implemented subset and acceptance evidence

Updated 23 October 2026. **Status: IN PROGRESS, not full osu!stable audio parity.** Verified tests demonstrate event extraction, scheduling and integration under synthetic sample files and instrumented Web Audio. They are not real-device listening tests.

## Implemented

- The .osu file's General/TimingPoints/HitObjects sample metadata is used for real Normal, Soft, Drum, addition layers, sample numbers, volumes and custom filenames.
- Judged successful circles, slider heads, ticks/repeats and physical tail edges produce sample events. Successful spinner completion emits genuine .osu samples; failed spinner completion does not. A chart/skin `spinnerspin` sample now loops across the spinner interval when supplied; missing spin audio is optional and is not counted as an unavailable completion sample. The slider's early tail judgement timestamp is distinct from the audible end edge.
- For indexed auto-generated samples, the beatmap's WAV, MP3 and OGG encodings are checked **before** any skin fallback. Explicit custom sample filenames match exactly and never silently substitute another extension.
- Real chart/skin `sliderslide` and `sliderwhistle` clips now loop **only over actual judge tracking intervals**. A seek into an existing interval resumes its loop at the appropriate clip phase and aligns with the music source's 50ms startup scheduling lead-in. Loop voice nodes stop at the tracked interval boundary.
- The selected map's `[General] AudioLeadIn` is parsed with an explicit operational input ceiling and honored at playback start. Existing synthetic PreparedMap fixtures can omit this optional field; actual prepared beatmaps set it.
- An optional user-imported .osk supplies real root-level WAV/MP3/OGG hit sounds and slider loops when absent from the map. Limited `skin.ini` `LayeredHitSounds` is applied. No default skin sounds, skins, replays or beatmaps are distributed in this repository.
- The music Web Audio clock schedules voices using a 250ms lookahead, DT/HT rates and visual sync offsets. For DT/HT/map-speed changes it precomputes a WSOLA time-stretched music buffer so pitch is preserved while the clock still advances map time at the effective rate; the stretched buffer is cached per rate and falls back to pitch-changing playbackRate if stretching fails; it cancels abandoned sounds after pause, seek, speed change and disposal. Independent music and effects gain buses provide separate volume controls. Pending asynchronous AudioContext resume is invalidated on seek, pause, speed change or dispose. Four concurrent decoders, 48 live voices, unique-sample and byte/event bounds limit resources.

## Verification passes

**Functional:** `web/test/hitsounds.test.ts`, `hitsounds-spinner.test.ts`, `skin-hitsounds.test.ts` and `skin-assets.test.ts` cover decoded .osu metadata, physical ZIP archives, sample precedence, dropped objects, spinner completion, user skin inputs and session/judge coupling. `slider-loops.test.ts` covers judge tracking range planning and real looping source schedule/stop/seek phases.

**Robustness:** `sample-player.test.ts` checks errors, missing clips, voice ceilings, async decoder cancellation and lookahead behaviour. `lead-in.test.ts` checks invalid, nonfinite or unbounded AudioLeadIn values; `upload-limits.test.ts` limits untrusted local reads. `skin-hitsounds.test.ts` covers incorrect filenames, skin.ini options and format variants.

**Integration:** `audio-clock.test.ts` instruments the production Clock API, independent music/FX gains, suspended-context resume cancellation, seek/pause and speed cleanup; `web/src/main.ts` loads the real session hitsound plan and all effects through that clock. CI runs web/worker tests, TypeScript typechecks, Vite build and the CI-friendly judgement harness. These tests **do not demonstrate audible browser/device output** because their sample byte arrays are synthetic and AudioContext is instrumented.

## Still OPEN or unverified

- A licence-approved set of distributable default skin samples; complete user skin.ini sound options, visual skin sprites and persistence.
- Spinner bonus-tick sounds (the spin loop itself is implemented); slider tracking exact audible parity on varied real osu!stable replays, sound panning, volume weighting, fade behaviour and sample timestamp edge cases.
- WSOLA is a compact dependency-free stretcher, not a mastering-grade time-stretch: real music has not been acoustically compared, transient/phase artifacts are unmeasured, and very large maps pay a one-off preprocessing cost. The 0.25×–2× viewer-speed path uses the same stretcher when preparation succeeds.
- Real browser/Windows audio latency, decode support, MP3 padding/acoustic sync, skin visual integration and offline MP4 audio mix.
- Real osu! API replay access and real private fixture parity. The normal CI-friendly judgement check is not proof of real parity.

## Next independent tasks

1. Add default skin sample lookup only when licensing and attribution can be satisfied; do not commit copyrighted media without authorization.
2. Complete user skin visuals/remaining sound semantics and spinner loops with sound input grounded in actual replay/chart data.
3. Continue independent M3 HP/fail and M4 exact ScoreV1 test coverage, plus M2 real-replay validation when exact-MD5 private fixtures are available.
4. Run headphone/browser listening comparisons with genuine legal .osz/.osk resources once accessible; record acoustic discrepancies rather than calling M5 PASS from synthetic CI.
