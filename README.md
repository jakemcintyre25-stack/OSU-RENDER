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

## Status

Done:

- Worker: recent plays, replay download, beatmap mirrors with fallback, checksum lookup, edge caching, rate limit
- Map prep: mods (EZ/HR/HD/DT/NC/HT), stacking, slider paths, ticks/repeats, combo colours
- Playback: music-synced clock, seek, background + dim, volume
- Drawing: hit circles, approach circles, snaking slider bodies, reverse arrows, ticks, slider ball + follow circle, spinners, HD fades, cursor + trail, key overlay, combo/accuracy, 100/50/miss popups, miss markers on the timeline
- Judgement v0: hit windows, note-lock, slider tracking, spinners, combo. Compared against the replay's own counts in the ⓘ panel
- Autoplay generator (used for map preview and tests — judges 100% on the test map)

Next (see the build plan):

- Judgement to exact stable parity (slider leniency, 2B, spinner rpm, score V1, HP)
- Hitsounds, DT/HT pitch-preserving time-stretch
- Default skin sprites + custom `.osk` skins, follow points, hit lighting
- MP4 export with WebCodecs
- Lazer score rules
- Hook into One Miss Merchants (sign-in, profile links)

## Licences

No licence has been chosen for this code yet. Dependencies `osu-parsers`, `osu-classes`, `osu-standard-stable`, `pixi.js` and `fflate` are MIT. The test map in `fixtures/` comes from the osu! repository's test resources and is not redistributed here.
