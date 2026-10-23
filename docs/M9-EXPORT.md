# M9 deterministic export — implementation notes

Status: **IMPLEMENTED / AUTOMATED TESTS PASSING / REAL-BROWSER OUTPUT ACCEPTANCE PENDING**
Last updated: 23 October 2026.

This is the deterministic replacement path for the real-time `MediaRecorder`
capture. It renders every frame from an explicit map-time timeline, mixes audio
offline, and muxes the result with Mediabunny. The live preview is not recorded.

## Pipeline

```
session.map/frames/judgement
        │
        ├── createExportTimeline(startMs, endMs, rate, fps)
        │       frame n: mapTime = start + n * 1000 * rate / fps
        │                outputTime = n / fps
        │
        ├── renderOfflineMix(...)  (OfflineAudioContext)
        │       music + planned hitsound events/loops on one fixed timeline
        │
        └── PlayfieldRenderer (hidden 1280×720 or 1920×1080 host, resolution 1)
                render(mapTime) -> CanvasSource.add(outputTime, 1/fps)
                                        │
                                Mediabunny Output
                                  MP4: H.264 + AAC (preferred)
                                  WebM: VP9/VP8 + Opus (fallback)
                                        │
                                  playable Blob -> local download
```

Files:

- `web/src/render/export/timeline.ts` — presets, frame count, exact map/output timestamps, filenames.
- `web/src/render/export/frames.ts` — ordered frame loop, abort checks and progress.
- `web/src/render/export/codecs.ts` — MP4/WebM codec preference policy.
- `web/src/render/export/export-video.ts` — WebCodecs/Mediabunny encoder + muxer.
- `web/src/audio/offline-mix.ts` — offline music/hitsound placement and rendering.
- `web/src/main.ts` — export dialog, hidden renderer lifecycle, download and cleanup.

## Determinism guarantees

- Frame timestamps are always `n / fps`; they never depend on wall-clock time,
  preview `requestAnimationFrame` cadence or encoder speed.
- Map time for frame `n` is `startMs + n * 1000 * mapRate / fps`. DT/HT map rate
  is included; the viewer-only speed selector and audio/visual sync offset are
  deliberately excluded.
- Audio is rendered before encoding with an `OfflineAudioContext`; it does not
  capture the live audio graph.
- `CanvasSource.add` is awaited, so encoder/writer backpressure controls the
  loop rather than an unbounded frame queue.
- The last frame count always covers the full map span (`ceil`), without adding
  a frame when the duration lands exactly on a frame boundary.

## Output selection

| Priority | Container | Video | Audio | Condition |
|---|---|---|---|---|
| 1 | MP4 | H.264 (`avc`) | AAC | both encoders report supported |
| 2 | MP4 | H.264 | none | H.264 supported, AAC not |
| 3 | WebM | VP9 | Opus | MP4/H.264 unavailable |
| 4 | WebM | VP8 | Opus | VP9 unavailable |
| 5 | no export | — | — | no supported video encoder |

Codec support is probed with Mediabunny's `canEncodeVideo` / `canEncodeAudio`
at the selected resolution, not inferred from the user agent. A browser without
WebCodecs sees an explicit unsupported message and can still use the real-time
WebM recorder.

## Known limits / still unverified

- **Real-browser acceptance is partial.** A headless Chrome 155 run on Windows
  produced and re-opened a real 1280×720/30 fps MP4: 60 frames, H.264 video
  (2.000 s) and AAC stereo audio (2.005 s), with both streams starting at 0 and
  an end delta of 5.33 ms from AAC frame padding. Long-duration 1080p60,
  memory usage, real replay content and mobile browsers remain unverified.
- Output is buffered in memory (`BufferTarget`). A long 1080p60 export can use
  substantial RAM; streaming-to-disk and memory profiling are not implemented.
- The browser's H.264/AAC encoders may not exist on every platform; WebM is the
  fallback. The UI reports which one was selected.
- DT/HT export audio is stretched with the same dependency-free WSOLA path used
  by the preview and played at rate 1, so export pitch is preserved. If
  stretching fails it falls back to pitch-changing `playbackRate`.
- Audio decode failure falls back to video-only rather than failing the export.
- Export does not include the live preview's viewer speed, sync offset, or
  audio-device latency compensation. It follows the map timeline.
- 1080p60 is exposed but not performance-benchmarked on low-end hardware.

## Automated evidence

- `web/test/export-timeline.test.ts` — frame counts, exact boundaries, DT/HT,
  negative lead-in, invalid input, filenames.
- `web/test/export-frames.test.ts` — frame order, timestamps, abort before and
  during encoding, progress, encoder error propagation.
- `web/test/export-codecs.test.ts` — codec preference and no-WebCodecs probe.
- `web/test/offline-mix.test.ts` — music offset/preroll, event/loop placement,
  bus gains, cancellation and no-audio fast path.
- `web/test/export-video.test.ts` — muxer orchestration, audio track addition,
  frame submission, finalisation and cancellation using mocked Mediabunny.

Verification run: 33 export-focused tests pass; the full merged web suite passes
(278 tests, 12 skipped); worker tests pass (50); web typecheck passes; the Vite
production build passes with Mediabunny in a lazy-loaded 255 KB chunk.

### Real-browser MP4 check (23 October 2026)

A standalone harness bundled from the production export modules was run in
headless Chrome 155 on Windows against a synthetic 1280×720 canvas and a generated
stereo tone. It produced a 444,500-byte MP4 in 426 ms and re-opened it via
`HTMLVideoElement` (2.005 s, 1280×720). The file was then parsed independently
with Mediabunny's `Input`/`EncodedPacketSink`:

| Stream | Codec | Packets | Duration | First timestamp | End |
|---|---|---:|---:|---:|---:|
| Video | H.264 (`avc`) | 60 | 2.000 s | 0 | 2.000 s |
| Audio | AAC, 48 kHz stereo | 94 | 2.005 s | 0 | 2.005 s |

A/V start delta is **0 ms**; the **5.33 ms** end delta is AAC frame padding.
This is a real file/stream check, not only a recorder mock, but it is not a real
osu! replay, not 1080p60 and not a memory measurement.

## Acceptance checklist before M9 PASS

- [ ] Export a real 3-minute map at 1080p60 in current Chrome/Edge; play the
      result in a normal player and confirm full duration and synchronized sound.
- [ ] Inspect the actual MP4/WebM stream timestamps (not just playback) for
      cumulative A/V drift and correct frame count.
- [ ] Test NM, DT and HT exports; confirm the documented pitch behaviour.
- [ ] Test no-audio map, corrupt audio and missing-audio cases.
- [ ] Measure peak memory and export time on a representative desktop.
- [ ] Verify cancel, navigation-away cleanup and retry after failure.
- [ ] Verify the real-time `Record WebM` fallback still works after export.
