# osu! replay renderer

Watch osu!standard replays in the browser. Pick a recent play (or drop in a `.osr`), and the site pulls the replay, beatmap, music and background, then plays it back with WebGL — no render servers, nothing to install.

## How it fits together

```
web/      Browser app (Vite + TypeScript + PixiJS). All parsing, judging and drawing happens here.
worker/   Cloudflare Worker. Serves the built site and proxies osu! API + beatmap mirror downloads.
scripts/  Dev helpers (test fixture download).
```

| Step | Where | Notes |
|---|---|---|
| Recent plays | Worker → osu! API v2 | `/users/{id}/scores/recent` with the app's own client-credentials token. No user login needed. |
| Replay | Worker → osu! API v2 | `/scores/{id}/download`, cached at the edge. |
| Beatmap | Worker → mirrors | catboy.best → nerinyan → osu.direct, first valid zip wins. Falls back to the bare `.osu` (no audio). |
| Parse + map maths | Browser | `osu-parsers` / `osu-standard-stable` (MIT): mods, stacking, slider paths. |
| Judgement | Browser | `web/src/game/judge.ts` — works out every hit from the replay. |
| Draw + audio | Browser | PixiJS on WebGL; Web Audio is the master clock. |

## Running it

```bash
npm install
npm run fixtures        # downloads a test beatmap into fixtures/ (not committed)
npm test                # web + worker tests
npm run dev             # web app on http://localhost:5173
npm run dev:worker      # API on http://localhost:8787 (needs worker/.dev.vars, see below)
```

The `.osz` autoplay preview works with only `npm run dev` — no API needed.

For custom hitsounds, drop a rights-cleared `.osk` file in **Optional skin hitsounds** before opening a replay. Its WAV/MP3/OGG hitnormal/whistle/finish/clap and slider slide/whistle sounds can be used, with the `LayeredHitSounds` setting. Skin images/sprites, default bundled sounds and persistence are not implemented. Beatmap-provided samples take priority, and an uploaded skin is kept in browser memory for the current page session only. Oversized local uploads are rejected before reading their bytes.

### osu! API credentials

Create an OAuth application at https://osu.ppy.sh/home/account/edit (any callback URL; it isn't used), then:

```bash
# local
printf 'OSU_CLIENT_ID=...\nOSU_CLIENT_SECRET=...\n' > worker/.dev.vars
# production
cd worker && npx wrangler secret put OSU_CLIENT_ID && npx wrangler secret put OSU_CLIENT_SECRET
```

### Deploy

```bash
npm run deploy          # builds web/ and deploys the Worker with the site attached
```

The player also supports clicking miss/100 timeline markers to jump two seconds before the event. A new replay selection cancels older downloads and prevents stale asynchronous results from replacing the current player. These controls are covered by automated tests but still need real-browser/mobile acceptance.

## Status

Done:

- Worker: recent plays, replay download, beatmap mirrors with fallback, checksum lookup, edge caching, rate limit
- Map prep: mods (EZ/HR/HD/DT/NC/HT), stacking, slider paths, ticks/repeats, combo colours
- Playback: music-synced clock, song-outro-aware seek, AudioLeadIn, independent music/FX volumes, persisted sync offset and 0.25×–2× viewer speed; beatmap and user-.osk circle/slider/spinner-end sounds plus judged slider tracking loops use Web Audio
- Drawing: hit circles, approach circles, snaking slider bodies, reverse arrows, ticks, slider ball + follow circle, spinners, HD fades, cursor + trail, key overlay, combo/accuracy, 100/50/miss popups, miss markers on the timeline
- Judgement v0: hit windows, note-lock, slider tracking, spinners, combo. Compared against the replay's own counts in the ⓘ panel
- HP engine: stable's simulated drain search, hit/combo-end gains, nested slider/spinner health, break pauses and negative-judgement HP-zero failure, with a visible player HP bar and fail overlay
- Autoplay generator (used for map preview and tests — judges 100% on the test map)
- Recording: real-time WebM capture of the live canvas with synchronized music and hit-effect audio, codec negotiation for Opus muxing, video-only fallback, and 60-second/256 MiB limits
- Deterministic export: full-length fixed-FPS rendering plus an offline music/hitsound mix, muxed as MP4 (H.264/AAC) or WebM (VP9/VP8 + Opus), with progress, cancel and honest codec fallback. A real 1280×720/30 fps MP4 has been produced and its H.264/AAC streams timestamp-checked in Chrome; see `docs/M9-EXPORT.md`

Next (see the build plan):

- Judgement to exact stable parity (slider leniency, 2B, spinner rpm, score V1, HP)
- Finish default/user skin graphics, spinner rotation/bonus sounds, and pitch-preserving DT/HT time stretch. Slider loops already exist for recorded tracking sections but still require real-browser acoustic acceptance
- Default skin sprites + custom `.osk` skins, follow points, hit lighting
- Long-duration 1080p60, real-replay and peak-memory acceptance for deterministic export (720p30 MP4 and A/V timestamps are verified)
- Lazer score rules (lazer-origin replays are detected and rejected with a clear message; native lazer judgement, scoring and mod settings remain open)
- Complete One Miss Merchants profile/match links (the renderer-side `?user=<osu ID>` and `?score=<score ID>` routes and Share replay button are implemented; see `docs/INTEGRATION.md`)

## Licences

No licence has been chosen for this code yet. Dependencies `osu-parsers`, `osu-classes`, `osu-standard-stable`, `pixi.js` and `fflate` are MIT; `mediabunny` is MPL-2.0 (file-level copyleft) and is bundled as a separate lazy-loaded chunk. The test map in `fixtures/` comes from the osu! repository's test resources and is not redistributed here.


## Judgement parity checks (M1)

`npm run judge-check:strict` is the **real osu!stable parity acceptance command**; it exits nonzero if no compatible replay/map fixtures were checked. The ordinary `npm run judge-check` intentionally prints setup instructions and succeeds without fixtures in CI. Do not mistake that for proven replay parity.



`npm run judge-check` compares each local legacy osu!standard replay's judgement results with the counts and maximum combo in its `.osr` header. The check looks for `fixtures/replays/*.osr` and the exact-MD5-matching `.osu` difficulty inside `fixtures/maps/*.osz`. Output includes a row for each replay, our counts versus the header, and a failure exit status on any discrepancy. Once Score V1 exists, the same table will also compare total score.

```bash
npm run judge-check
npm run judge-check -- --verbose example.osr
```

Verbose output lists every object, its millisecond and `mm:ss.mmm` timestamp, judged result, and slider-part collection. Replay headers contain aggregate counts only, so the tool **cannot know the true judgement of an individual object**. All object results are displayed as potential mismatch candidates.

Fixtures are local and gitignored: **never commit beatmaps, replays, audio, or skins**. If either directory is missing or empty, the command exits successfully with setup instructions. Lazer fixtures should go in `fixtures/replays/lazer/` (not scanned by M1) or use a `*.lazer.osr` filename. `judge-check` also skips them from the decoded `30000000+` game-version header, so a misnamed lazer fixture cannot be scored as stable.

GitHub Actions runs `npm test`, `npm run typecheck`, `npm run build`, and `npm run judge-check` on pushes and pull requests. Tests that require the optional `fixtures/renatus.osz` continue to skip when it is missing in CI. New fixture-independent CLI tests run under Node's built-in test runner as part of `npm test`.

## Standalone Windows app

One file, `osu-render.exe`, serves the renderer on `http://127.0.0.1:8787` and opens it in your browser. It needs no install and no internet to render a local replay.

Build it (on any machine with Bun and Node):

```
npm install
npm run desktop          # writes dist-desktop/osu-render.exe
bun desktop/build.ts --linux   # Linux test binary
```

Use it:

- Drop a beatmap `.osz` first, then a replay `.osr`. The replay is matched to the map by MD5, offline.
- For "recent plays" and automatic map lookup, copy `osu-render.env.example` to `osu-render.env` next to the exe and add your osu! API v2 client credentials.

Known limits: scoring and judgement are not yet exact (see `docs/M2-FINDINGS.md` and `docs/M4-FINDINGS.md`), and HP is not implemented.
