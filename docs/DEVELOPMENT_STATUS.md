# OSU-RENDER — development and verification status

Updated: 22 October 2026. The 12-milestone specification in `osu-render-chatgpt-prompt.md` is the acceptance contract. This checklist reflects **verified features**, not the existence of scaffolding or partial code.

## Milestone acceptance checklist

| Milestone | Status | Verification and outstanding work |
|---|---|---|
| M1 Judgement harness | **PASS** | `npm run judge-check`, verbose diagnostics and CI implemented. Empty optional fixtures exit zero. Real replay fixtures stay local. |
| M2 Stable judgement parity | **IN PROGRESS** | Slider follow/part timestamps, combo breaks, explicit early misses, spinner capped integration, 2B autoplay edge tested. Official strict rounded-error/truncated-OD window edges are implemented, but spinner velocity smoothing, stacked 2B/note-lock edge rules and **all real stable replay-header matches** remain unverified. |
| M3 HP and fail | **OPEN** | Stable HP drain, gains, breaks, NF/SD/PF and failTime not implemented. |
| M4 Score V1 | **IN PROGRESS** | Running ScoreV1, mod multipliers, slider/spinner part scoring implemented. Fixed 30-point slider heads and clamped difficulty multiplier to 2–6. Real header parity remains unverified; older M4 replay comparison values are stale. |
| M5 Audio timing and hitsounds | **OPEN** | Base Web Audio master clock exists, but map/user offset, hitsounds and pitch-preserving DT/HT still required. |
| M6 Default skin and visual parity | **OPEN** | Basic Pixi renderer exists; sprite parity, shader, HUD, FL and effects remain. |
| M7 Custom skins | **OPEN** | .osk and skin.ini support, IndexedDB and fallbacks remain. |
| M8 Player page | **IN PROGRESS** | Basic browsing, replay loading and controls exist. Settings, timeline enhancements, loading retries and mobile acceptance remain. |
| M9 MP4 export | **OPEN** | No WebCodecs/offline audio export yet. |
| M10 Lazer | **OPEN** | Legacy/stable only; lazer detection and rule set remain. |
| M11 Hardening | **IN PROGRESS** | Worker has edge caching and rate limit. R2, mirror breaker, ZIP validation, logging, bundle split and tests remain. |
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

The latest verified GitHub Actions head at the time of this update is `6a0bbc515580a478ba0dc18c8a02a1f7e457cd18`. Both push and pull-request CI runs passed the normal tests, typecheck, build and empty-fixture judge-check. This does **not** prove real-replay or desktop executable acceptance.

## Immediate next implementation work

1. Run `npm run judge-check` and `npm run judge-check -- --verbose <replay.osr>` using the local exact-MD5-matched real osu!stable replay fixture set (not committed); resolve count/combo mismatches before marking M2 PASS.
2. Validate the now documented-and-unit-tested strict rounded-error 300/100/50 windows against the real replay set; independently establish exact stable spinner velocity/RPM smoothing.
3. Run the optional all-difficulties Renatus autoplay acceptance test locally and fix any map-specific issues.
4. Only after M2 parity, proceed through M3 HP/fail and complete M4 ScoreV1 header parity, then audio/skin/export milestones.

## GitHub recovery and safety

- Development branch: `development/m2-slider-tracking`
- Draft PR: https://github.com/jakemcintyre25-stack/OSU-RENDER/pull/1
- Do not merge this draft or deploy unfinished changes.
- Never commit .osz, .osr, audio, skin assets, or user credentials.
