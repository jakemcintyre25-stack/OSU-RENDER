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
| M5 audio | Map and user-.osk hitsounds, slider loops, spinner loop/bonus clips, positional pan, shared Web Audio clock, WSOLA pitch-preserving DT/HT preview |
| M6 visuals | Procedural circles/sliders/spinners, soft radial hit lighting, follow points, Flashlight overlay, cursor/key HUD |
| M7 skins | Root `.osk` sprites for hitcircle/overlay, slider start/end circles and overlays, approach, slider ball/follow incl. indexed animation at the skin's `AnimationFramerate`, reverse arrow, spinner background/circle/approach, cursor/trail/middle, combo-colour overrides, cursor scale, slider border/track overrides, hit-circle and HUD-combo font digits with overlap, and IndexedDB saved-skin restore |
| M8 player | Seek, speed, sync, volumes, timeline markers, HP/fail, hit-error/UR summary, responsive controls, reduced-motion HP |
| M9 export | Real-time WebM with synchronized audio; deterministic fixed-FPS full-length MP4/WebM with offline audio mix, WSOLA pitch-preserved DT/HT music, progress and cancel |
| M10 lazer | Detection from game version and explicit unsupported rejection; pre-download gating in recent plays |
| M11 hardening | Bounded archives/replays/downloads, mirror breaker and Retry-After cooldowns, optional KV-backed global health, baseline Worker security headers and enforced CSP |
| M12 OMM | `?user`/`?score` deep links and canonical share URLs |

## Verification evidence

- Integration-branch CI is green on the current head.
- Web test suite: **290 passed, 12 skipped**.
- Worker test suite: **54 passed**.
- Web/worker typecheck and Vite production build pass.
- Real-browser evidence: [desktop FL](./evidence/browser-flashlight.png), [390×844 player](./evidence/browser-mobile.png), [CSP run](./evidence/browser-csp.png), [CSP export](./evidence/browser-export-csp.png), [3-minute export result](./evidence/export-long-1080p60.png).
- Real 1280×720/30 fps MP4: 60 H.264 packets / 2.000 s and 94 AAC packets / 2.005 s, both first timestamps 0, end delta 5.33 ms.
- 3-minute 1920×1080/60 export pipeline on a synthetic 2D canvas: 10,800 video packets and 8,438 AAC packets, first timestamps 0, 10.67 ms AAC-padding end delta, 180.0107 s playback, 138,933,591 bytes ([stream JSON](./evidence/export-long-1080p60-streams.json)).
- HP bar, lighting, follow points and skin sprites still need real-replay/device screenshot and listening acceptance.

## Known limits and blockers

1. **Real osu!stable parity is unproven.** No rights-cleared real replay/map fixtures are available in this environment, so `judge-check:strict`, real HP traces and real score headers could not be rerun.
2. **Unexplained historical score gap.** Three NM/HD replays had header totals 3–23× lower than ScoreV1; their mod bits did not indicate ScoreV2. This remains an open investigation.
3. **Full lazer rules** (judgements, score model, mod settings) are out of v1 and explicitly rejected.
4. **Visual parity is partial.** Shaders and complete default-skin sprites remain open; a Flashlight approximation and procedural lighting/follow points exist. Skin fonts, animation and persistence render, but still need real-browser screenshot comparison.
5. **Long-duration export acceptance is partial.** The 3-minute 1080p60 evidence above uses a synthetic 2D canvas, not Pixi/WebGL. A software-WebGL 10 s 1080p60 attempt timed out at 120 s; real-GPU/real-renderer 1080p60, total-process peak memory, physical mobile and real-music WSOLA artifacts remain unverified.
6. **Deployment and OMM-side links** require explicit authorization; no merge or deploy is performed here.

## Merge order

1. Review/merge the individual feature PRs if preferred: #2 (M9), #3 (M11 Retry-After), #4 (M10), #5 (M3 HP bar), #7 (M6 Flashlight), #8 (M6/M7 visual effects), #10 (M5 exact spinner audio), #12 (M11 security headers).
2. PR #11 was closed as superseded by #10's exact spinner timestamps; its WSOLA work lives in #14. PR #6 is an earlier/smaller M5 spinner-audio attempt superseded by the exact-timestamp implementation merged here.
3. WSOLA (#14), skin fonts (#15), soft hit glow (#20), hit-error/UR (#22), `AnimationFramerate` (#27), HUD combo fonts (#28) and 3-minute stream evidence (#25/#29) are merged into this candidate.
4. Or review this assembled candidate (#9) as one integration change.
5. Do not merge to `main` or deploy without explicit authorization and a fresh real-browser/real-replay acceptance run.
