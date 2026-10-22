# M5 — Beatmap hitsound playback: implementation and acceptance evidence

Updated 23 October 2026. **Status: IN PROGRESS (subset implemented and unit/integration verified).** The full milestone is **not** complete.

## Working implementation

- `web/src/audio/hitsounds.ts` parses the selected .osu difficulty's General, TimingPoints and HitObjects sections. It resolves Normal/Soft/Drum samples, indexed filenames, hitnormal + whistle/finish/clap layers, custom hitSample filenames, slider edge samples and tick samples.
- Events are conditional on **the replay judge's actual successful hits**: misses do not emit normal hit samples; slider repeats, ticks and tail events follow the judged collection flags. Audio samples are played at the recorded press time; head metadata uses the chart object's timing section. Stable's slider-tail leniency check is distinct from its audible end-edge time.
- Files are read from the **actual .osz archive**, respecting a difficulty's containing subfolder. The session also finds song/background assets relative to that directory.
- The `HitSoundPlayer` decodes real sample bytes with the same Web Audio context as music; its 250ms lookahead uses the music clock, mod rate and visual synchronization offset. Playback seeks, pauses, rate changes and disposal cancel pending sounds; past events are not replayed.
- Guardrails include max 8 MiB/sample, 64 MiB total sound data, 256 unique clips, 50,000 scheduled events, at most four concurrent decoder operations, and 48 simultaneously active voices.
- Missing beatmap samples can now be resolved from an optional **user-loaded .osk skin archive**. Only actual root-level Normal/Soft/Drum hitnormal/whistle/finish/clap audio files are supported (WAV/MP3/OGG); indexed beatmap sample takes precedence, a skin's unindexed version is used only for absent chart samples. Explicit custom filenames do not fall back to a skin. The skin.ini `LayeredHitSounds` setting is respected for combining normal/addition layers. No third-party sound files are bundled.
- If decoding fails or assets are missing, playback of the replay and music continues. Missing bundled defaults are **not** silently replaced by fabricated samples. A warning is shown.

## Functional/robustness/integration verification

- `web/test/hitsounds.test.ts`: actual compressed synthetic .osz loaded via `openOsz`, full `prepareMap` → `generateAutoplay` → `judge` → hitsound plan, sample-set and volume transitions, custom filenames, nested archive path, malformed/oversized samples, missed-object suppression and overlap-safe timing point lookup.
- `web/test/sample-player.test.ts`: instrumented AudioContext play scheduling, bounded lookahead, seek cancellation, DT-rate and sync offset calculations, missing/undecodable data, per-source voice limits, bounded concurrent decoding and cancellation of stale async loads.
- `web/test/hitsounds-spinner.test.ts`: actual layered .osu spinner-end sound, no sound on misses and no fabricated missing layers.
- `web/test/skin-hitsounds.test.ts`: real .osk ZIP loading, indexed beatmap priority over skin, filename override protection, MP3 fallback, .osu-only mode, skin.ini LayeredHitSounds on/off and integration through sessionFromAutoplay.
- `web/test/audio-clock.test.ts`: integration through the actual `Clock` API, AudioContext start-time, pause, seek and disposal checks.
- `web/test/timeline.test.ts`: preserve audio outro, silent maps and safe bounds for missing/invalid duration.
- GitHub Actions on `b9fc495e547d139e0a2d693951f470795a8ce24f`: regular automated suites, TypeScript and Vite build passed on push; check the current PR workflow conclusion before accepting branch integration.
- These tests use valid ZIP containers with **synthetic sample bytes** and instrumented AudioContext decoders. They do **not** establish a successful real-browser playback of actual licensed WAV/MP3 samples or exact reproduction of osu!stable audio.

## Not yet implemented or accepted

- Bundled default skin sound resources (no licensed default assets included), complete user-skin.ini customization beyond LayeredHitSounds, hitsound routing from nested skin subfolders and persistent .osk loading. User-provided .osk **audio only** works; visual skin graphics are still M7 OPEN.
- Continuous tracking-dependent slider slide/whistle loops, spinner spin/bonus sound effects, and storyboard hitsounds (successful spinner completion samples are now supported).
- Full inherited timing point/sample edge behaviour on complex real beatmaps, sound pan, audio normalization, and skin.ini sound options.
- Pitch-preserving audio time stretch at DT/HT rates (current source playbackRate changes pitch).
- Browser/device acoustic timing acceptance, headset latency compensation, real beatmap/audio test fixtures and offline MP4 audio mix integration.

## Next actions

1. Run a rights-cleared real .osz with varied custom hitsounds in a real browser and compare event/time/audio output against osu!stable while capturing discrepancies.
2. Extend the existing user-selected .osk audio lookup to full skin.ini semantics, audio overrides and visual skin rendering, without copying licensed assets into the repository. Decide legally distributable default hit sound sources.
3. Add continuous slider tracking audio and spinner hit sounds from actual asset sources, preserving judgement/clock coupling.
4. Continue M2 exact real replay parity, M3 HP/fail and M4 ScoreV1 separately. Do not mark M5 complete because these foundations compile.
