# OSU-RENDER release candidate — scope, evidence and limits

Branch: `integration/complete-renderer` · draft PR #9
Last assembled: 24 October 2026

This is the assembled candidate for the browser osu!standard replay renderer. It is **not** a deployment and has not been merged to `main`.

## Product scope (v1)

- osu!standard only, stable-origin replays.
- Browser-only replay preview, judging, ScoreV1, HP/fail and video export.
- One Miss Merchants deep links are renderer-side only; OMM-side profile/match changes and a production hostname remain separate work.
- osu!lazer is deliberately detected and rejected with a clear message. Full lazer rules are **not** part of v1.

## Included feature work

| Area | State |
|---|---|
| M2 judgement | Stable hit windows, half-spin spinners, stable note-lock and 3 ms simultaneous-object tolerance |
| M3 HP/fail | Stable simulated drain search, hit/part/combo-end gains, seekable trace, visible HP bar and failure overlay |
| M4 ScoreV1 | Slider/head/spinner scoring, stable half-spin bonus gap, stable difficulty multiplier/drain quirks, combo integer truncation, ScoreV2 skip |
| M5 audio | Map and user-.osk hitsounds, slider loops, spinner loop/bonus clips, shared Web Audio clock |
| M6 visuals | Procedural circles/sliders/spinners, hit lighting, follow points, Flashlight overlay, cursor/key HUD |
| M7 skins | Root `.osk` sprites for hitcircle/overlay, slider start/end circles and overlays, approach, slider ball/follow, reverse arrow, spinner background/circle/approach, cursor/trail/middle, combo-colour overrides, cursor scale and slider border/track overrides |
| M8 player | Seek, speed, sync, volumes, timeline markers, HP/fail, responsive controls, reduced-motion HP |
| M9 export | Real-time WebM with synchronized audio; deterministic fixed-FPS full-length MP4/WebM with offline audio mix, progress and cancel |
| M10 lazer | Detection from game version and explicit unsupported rejection |
| M11 hardening | Bounded archives/replays/downloads, mirror breaker and Retry-After cooldowns, baseline Worker security headers |
| M12 OMM | `?user`/`?score` deep links and canonical share URLs |

## Verification evidence

- Integration-branch CI is green on the current head.
- Web test suite: 265 passed, 12 skipped (last assembled full run).
- Worker test suite: 50 passed.
- Web typecheck and Vite production build pass.
- Real-browser export evidence from the M9 branch: headless Chrome produced a 1280×720/30 fps MP4 with H.264 60 packets / 2.000 s and AAC stereo 48 kHz 94 packets / 2.005 s, both first timestamps 0, end delta 5.33 ms.
- HP bar, lighting, follow points and skin sprites still need real-browser screenshot/listening acceptance.

## Known limits and blockers

1. **Real osu!stable parity is unproven.** No rights-cleared real replay/map fixtures are available in this environment, so `judge-check:strict`, real HP traces and real score headers could not be rerun.
2. **Unexplained historical score gap.** Three NM/HD replays had header totals 3–23× lower than ScoreV1; their mod bits did not indicate ScoreV2. This remains an open investigation.
3. **True pitch-preserving DT/HT** is not implemented; Web Audio playbackRate changes pitch.
4. **Full lazer rules** (judgements, score model, mod settings) are out of v1 and explicitly rejected.
5. **Visual parity is partial.** Shaders, complete default-skin sprites, complete `skin.ini` layout and animation remain open; a Flashlight approximation and procedural lighting/follow points exist.
6. **Long-duration export acceptance.** 1080p60 exists but has not been benchmarked for a full 3-minute map, peak memory or mobile.
7. **Deployment and OMM-side links** require explicit authorization; no merge or deploy is performed here.

## Merge order

1. Review/merge the individual feature PRs if preferred: #2 (M9), #3 (M11 Retry-After), #4 (M10), #5 (M3 HP bar), #7 (M6 Flashlight), #8 (M6/M7 visual effects), #10 (M5 exact spinner audio), #12 (M11 security headers).
2. PR #6 and #11 are earlier/smaller M5 spinner-audio attempts superseded by the exact-timestamp implementation merged here.
3. Or review this assembled candidate (#9) as one integration change.
4. Do not merge to `main` or deploy without explicit authorization and a fresh real-browser/real-replay acceptance run.
