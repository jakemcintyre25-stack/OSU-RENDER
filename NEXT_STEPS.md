# Next steps

> **Historical initial implementation plan (22 October 2026).** Several items below (hitsounds, user OSK audio, calculated score HUD, speed controls, mirror throttling and osu-render-side OMM links) have since been partially or fully implemented. Treat [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) as the authoritative current milestone/verification checklist and [docs/M5-FINDINGS.md](docs/M5-FINDINGS.md) for precise sound scope. **No milestone is considered done merely because an old checklist line was satisfied.** Real osu!stable parity, browser listening, Windows executable, video export and deployment acceptance are still open.


Where the project is, what's left, and the exact order to do it in. Written 22 October 2026, after the first push (`7c10ca4`).

Each step has a **Done when** line. Don't move on until it's true.

---

## Where things stand

**Working and tested:**

- Worker routes: recent plays, replay download, beatmap mirrors with fallback, checksum lookup, edge cache, rate limit. Tested against fake osu!/mirror responses only.
- Map prep: mods, stacking, slider paths, ticks, repeats, combo colours.
- Judgement v0, music-synced playback, and the renderer.
- `.osz` autoplay preview. Judges 897/897 300s on Renatus [Insane], including HR+DT.
- 29 automated tests.

**Not yet proven:**

- Real osu! API calls. Couldn't reach osu.ppy.sh from the build machine.
- Real beatmap mirror downloads.
- Judgement on real human replays. Autoplay only proves the easy case.

So the very next job is proving the outside connections work. Everything after that builds on it.

---

## Step 1 — Get it running against real osu! (you)

These need your accounts, so only you can do them.

### 1.1 Make an osu! OAuth app

1. Go to https://osu.ppy.sh/home/account/edit and scroll to **OAuth**.
2. Choose **New OAuth Application**.
3. Name: `osu-render`. Callback URL: anything, e.g. `http://localhost:8787/callback`. It isn't used.
4. Copy the **Client ID** and **Client Secret**.

Use a new app rather than the One Miss Merchants one. Then rate limits and any problems stay separate.

### 1.2 Run it locally

```bash
cd osu-render
npm install
npm run fixtures
printf 'OSU_CLIENT_ID=YOUR_ID\nOSU_CLIENT_SECRET=YOUR_SECRET\n' > worker/.dev.vars
npm run build          # the Worker serves web/dist
npm run dev:worker     # terminal 1 → http://localhost:8787
npm run dev            # terminal 2 → http://localhost:5173 (hot reload, forwards /api to 8787)
```

`.dev.vars` is gitignored. Never commit it.

### 1.3 Run the four checks

Open http://localhost:5173 and do each of these. Write down what happens.

| # | Do this | Expected | If it fails |
|---|---|---|---|
| A | Visit `http://localhost:8787/api/health` | `"osuConfigured": true` | Secret names or `.dev.vars` location wrong |
| B | Type `Shaxi` → **Show plays** | Your last 24h of plays, with covers and ranks | See 1.4 |
| C | Click a play that doesn't say "no replay" | Replay loads, map downloads with a progress bar, playback starts with music | See 1.4 |
| D | Open **ⓘ** | Renderer counts next to osu!'s counts | Note every yellow (mismatched) number — that's Step 3's input |

Also try one play set on **lazer** if you have any. The list should tag it "lazer". Check that it still loads.

### 1.4 What to do if B or C fails

**B fails with "osu! user lookup failed" or 502:** the token request is failing. Check the client ID and secret, then look at the `npm run dev:worker` terminal for the real error.

**C fails with "osu! refused the replay download":** the app token isn't allowed to download replays. This is the biggest unknown in the plan. The fix:

1. Add osu! sign-in to the Worker using the same flow One Miss Merchants uses, with scope `identify public`.
2. Unlike OMM, **keep the refresh token**, encrypted with a `TOKEN_ENCRYPTION_KEY` secret.
3. Store it in a D1 table.
4. Download replays with the user's own token instead of the app's.

This is about a session of work. Tell me and I'll build it.

**C fails at "Downloading beatmap…":** the mirrors are failing. The terminal shows each mirror's reason.
- If all three fail from your machine, they're probably down or blocking. Try again later.
- If they fail only once deployed on Cloudflare, see Step 2.3.

**Done when:** A–D all work on at least 3 of your own plays, including one with mods.

---

## Step 2 — Deploy it (you, ~15 minutes)

### 2.1 First deploy

```bash
cd worker
npx wrangler login
npx wrangler secret put OSU_CLIENT_ID
npx wrangler secret put OSU_CLIENT_SECRET
cd ..
npm run deploy
```

Wrangler prints a `https://osu-render.<your-account>.workers.dev` URL.

### 2.2 Custom domain (optional, recommended)

You already run `onemissmerchants.keystonegaragedoors.co.nz` through Cloudflare. Add `replays.onemissmerchants.keystonegaragedoors.co.nz` (or whatever you like):

**Cloudflare dashboard → Workers & Pages → osu-render → Settings → Domains & Routes → Add → Custom domain**

### 2.3 Re-run checks A–D on the live site

Mirrors sometimes block Cloudflare's IP ranges even when they work from home. If downloads fail only when deployed:
- reorder `MIRRORS` in `worker/src/mirrors.ts`, or
- add another mirror there.

**Done when:** a play loads end-to-end on the live URL.

### 2.4 Pick a licence

The repo is public with no licence. That means people can read the code but legally can't reuse it. Decide one of:

- **MIT:** anyone can use it for anything.
- **GPL-3.0:** anyone can use it, but changes must stay open. Required if we ever copy code from danser.
- **Make the repo private.**

Tell me which and I'll add the file.

---

## Step 3 — Make the judgement match osu! exactly (me, biggest chunk)

This is what makes it "one-to-one". The yardstick is simple: the 300/100/50/miss counts and max combo stored inside every replay must match ours exactly.

### 3.1 Build a test set of real replays (you)

Collect **20–30 `.osr` files** plus their `.osz` maps. Aim for a spread:

| Kind | How many | Why |
|---|---|---|
| Clean FCs, no mod | 3 | Baseline |
| Plays with a few 100s and misses | 5 | Hit windows, combo breaks |
| Slider-heavy maps with slider breaks | 4 | Slider tracking, ticks, ends |
| HR, DT, HD, EZ, HT (one each) | 5 | Mod maths |
| Spinners that were barely completed | 2 | Spin counting |
| Fast streams / jumps with note-lock moments | 3 | Note-lock |
| Failed plays (F rank) | 2 | HP / fail point |
| Lazer plays | 2 | Kept separate — different rules (Step 8) |

**Where to get them:**
- Your own: osu! stable keeps them in `osu!\Data\r\` (raw, named by hash). For named files, open the result screen and press **F2** to export to `osu!\Replays\`.
- Other people's: download top-play replays from osu! website score pages. Watch the per-score download limit.

Put them in `fixtures/replays/`, which is gitignored. I'll add a script that lists every `.osr` with its header counts.

### 3.2 Add the comparison harness (me)

- **Script:** `npm run judge-check` runs every fixture replay through `judge()`. It prints a table of ours vs osu! for 300/100/50/miss and max combo, and fails if any differ.
- **Detail mode:** for any mismatch, `--verbose` prints each object where our result might be wrong, with its time. Then you can scrub to it in the player.
- **CI:** a GitHub Actions workflow runs the normal tests on every push. The fixture-based harness stays local, since the maps can't be committed.

### 3.3 Fix the rules, one at a time (me)

Work through these in order, re-running the harness after each. The order is roughly "most common cause of mismatches first".

1. **Slider scoring model.** Stable doesn't give a slider head its own 300/100/50. The head, each tick, each repeat and the end are all "parts". The slider's single result comes from how many parts were collected. Our v0 already does this but treats a late head click as fully hit. Check what stable does with a late-but-in-window head.
2. **Slider follow area.** Our v0 starts at radius r and widens to 2.4r once tracking. Check:
   - when tracking can start (only when a key goes down while inside the ball?)
   - whether releasing and re-pressing inside 2.4r resumes tracking
3. **Slider end leniency.** The tail check happens 36 ms before the real end on stable (the "legacy last tick"). The library already places the tail there; confirm our tracking check uses that time and not `end`.
4. **Note-lock.** Stable blocks clicking object N+1 until object N is judged. Check the exact unlock moment (hit, or its 50-window passing) and how stacked/overlapping objects behave.
5. **Two keys on one frame, 2B maps.** Our v0 counts both keys as two presses. Check stable doesn't let one double-press hit two objects in some cases where it should, and vice versa.
6. **Miss window.** We treat a click more than 400 ms early as ignored, and an early-but-within-400 ms click on the circle as a miss. Verify against stable.
7. **Hit window edges.** Check `<=` vs `<` at the window boundary, and whether stable rounds the OD-based windows. One-off mismatches on exact-boundary hits point here.
8. **Spinners.**
   - Stable caps spin speed (around 477 rpm).
   - It counts spins from cursor angle change per frame, with smoothing.
   - Required spins depend on OD and length.
   - Score 300 / 100 / 50 / miss thresholds on spins completed vs required.
9. **Combo.** Confirm combo +1 for each of: circle hit, slider head, tick, repeat, end, spinner. Confirm which misses break combo — a missed slider *end* doesn't in stable.

**Reference:** danser-go's source is the best guide to stable behaviour, at `github.com/Wieku/danser-go`, the `app/rulesets/osu` folder. Read it for the rules. **Don't copy code** unless we've chosen GPL-3 in 2.4.

**Done when:** every non-lazer replay in the test set matches osu!'s counts and max combo exactly.

### 3.4 Score and HP (me)

Once counts match:

**Score V1.** Each hit adds:

```
hitValue + hitValue × (comboBefore × difficultyMultiplier × modMultiplier / 25)
```

- `difficultyMultiplier` comes from HP + CS + OD plus object density, rounded to 2–6.
- Mod multipliers: EZ 0.5, NF 0.5, HT 0.3, HR 1.06, HD 1.06, DT/NC 1.12, FL 1.12, SO 0.9.
- Slider parts: ticks 10, heads/repeats/ends 30.
- Spinners: 100 per spin, plus 1,000 per bonus spin.
- **Check:** our total equals the replay header's `totalScore`.

**HP bar.**
- Stable drains HP over time based on the map's HP setting.
- Hits refill it; misses take a chunk.
- Breaks don't drain.
- **Check:** failed replays should hit zero at the moment the replay data ends.

Then show score on the HUD and draw the HP bar. HP bar drawing is Step 5.4.

**Done when:** score matches the header on every replay. HP hits zero at the right moment on the failed plays.

---

## Step 4 — Sound (me)

1. **Audio offset.** Browsers decode MP3s with slightly different start padding. Add an offset slider (±100 ms) in a settings panel and save it. Then line up a few maps by ear against osu!.
2. **Lead-in.** Read `AudioLeadIn` from the map and start playback that far before 0. Currently we start 1.5–2.5 s before the first object regardless.
3. **Hitsounds.**
   - Read each object's sample set (normal / soft / drum) and additions (whistle / finish / clap).
   - Read custom sample index and volume from the timing point active at that time.
   - For sliders: head, each repeat and end each have their own sounds. The slider body has a looping slide sound, and ticks have a tick sound.
   - Lookup order:
     1. map's own `.wav`/`.ogg` in the `.osz` (e.g. `soft-hitclap2.wav`)
     2. skin
     3. default skin
   - Schedule them on the Web Audio clock at the **judged hit time** (not the object time) — that's what osu! does.
4. **DT/HT pitch.** Right now DT speeds the song up and raises the pitch (that's NC behaviour).
   - Add a time-stretch that keeps pitch, using SoundTouchJS in an AudioWorklet.
   - NC keeps the current behaviour.

**Default hitsound files:** ppy's `osu-resources` repo has the legacy default samples. They're licensed CC BY-NC 4.0, which is fine for a free site with credit in the footer.

**Done when:**
- a map with custom hitsounds sounds like it does in osu!
- DT keeps the original pitch
- music and visuals feel in sync after setting your offset

---

## Step 5 — Look like osu! (me)

1. **Default skin sprites.** Replace the hand-drawn circles with the real stable default skin images from `osu-resources` (same CC BY-NC licence; credit them):
   - `hitcircle`, `hitcircleoverlay`, `approachcircle`
   - `default-0…9`
   - `sliderb`, `sliderfollowcircle`, `reversearrow`, `sliderscorepoint`
   - `spinner-*`, `cursor`, `cursortrail`
   - `hit0/50/100/300`
   - score and combo fonts

   Load `@2x` versions on high-DPI screens.
2. **Slider bodies.** Replace the three stacked strokes with a proper shader. Stable draws the body as one mesh with a border and a gradient from edge to centre. That fixes the faint seams and makes custom `SliderTrackOverride` / `SliderBorder` colours possible.
3. **Follow points.** Dotted lines between consecutive objects in the same combo, fading in and out with stable timing.
4. **HUD.**
   - score counter
   - HP bar (from 3.4)
   - progress pie
   - hit-error bar (optional, toggle)
   - combo pop animation
   - break overlay
   - fail screen
5. **Hit lighting** (toggle) and the 300 "explosion".
6. **Custom skins.** Drop in an `.osk`, read `skin.ini` (colours, fonts, slider style), use any images it has, and fall back to default for missing ones. Remember the last skin.
7. **Flashlight mod overlay.** It's currently ignored.
8. **Check combo colours.** We pick colour `comboIndexWithOffsets % colours`, matching lazer's code. Confirm on a map with obvious colours that the first combo uses the same colour as osu!. If it's off by one, it's a one-line fix in `prepare.ts`.

**Done when:** you play an o!rdr video of a replay next to ours, and someone who plays osu! can't tell which is which at a glance (skin aside).

---

## Step 6 — Player page polish (me)

1. **Login instead of typing a username.** Optional once on OMM — OMM already knows who you are.
2. **Settings panel:**
   - background dim, music and effect volume
   - offset, cursor size, cursor trail on/off
   - key overlay on/off, skin

   Saved per browser.
3. **Timeline:**
   - hover a miss marker to see its time and type
   - click to jump 2 s before it
   - playback speed 0.25×–2×
4. **Loading:** show which mirror served the map. Add retry buttons when a step fails.
5. **Mobile:** test on a phone and fix touch controls.
6. **Shareable link** already works (`?score=ID`). Add a copy-link button.

---

## Step 7 — MP4 export (me)

1. Add an "Export video" button with resolution (720p / 1080p) and fps (30 / 60) options.
2. **Frames:** render frame by frame off-screen, not in real time, stepping the clock by `1000 / fps` ms each frame.
3. **Video:** encode with WebCodecs `VideoEncoder` (H.264). Package into MP4 with the `mediabunny` (or `mp4-muxer`) library.
4. **Audio:** mix music + hitsounds with `OfflineAudioContext`, encode as AAC with `AudioEncoder`.
5. Show progress and a cancel button. Download the file when done.
6. **Fallback** for browsers without WebCodecs: real-time `MediaRecorder` capture of the canvas (WebM).

**Done when:** a 3-minute map exports to a playable 1080p60 MP4 with sound, in a few minutes on a normal PC.

---

## Step 8 — Lazer plays (me, later)

Lazer scores use different rules:
- sliders judge differently (no slider-end leniency in the same way)
- classic-mod variants exist
- accuracy and scoring differ

Plan:
1. Detect lazer replays. The list already flags them; the `.osr` header also differs.
2. Add a second judgement mode that follows lazer's own code (`ppy/osu`, MIT licence, so copying is fine).
3. Check against the lazer replays from the 3.1 test set.

Until then, lazer plays still play back. Their counts in ⓘ will often differ.

---

## Step 9 — Plug into One Miss Merchants (me + you)

**Recommended:** keep osu-render as its own Worker on its own subdomain (Step 2.2) and link to it from OMM. Merging the code into OMM would mean adding a build step to a site that currently has none.

1. In osu-render, support `?user=<osu user id>` to open straight to that player's recent plays.
2. In OMM, add a **Watch replays** link on:
   - profiles (uses the linked osu! ID from the `identities` table)
   - match pages
   - tournament results
3. **Reviews:** for tournament reviews, add `?score=ID` links next to scores so referees can watch disputed plays.
4. **CSP:** OMM's CSP stays as it is, since we link out rather than embed. If you later want it embedded in an OMM page, OMM's `frame-ancestors 'none'` and osu-render's headers both need loosening.
5. **Docs:** add osu-render to OMM's `DEPLOYMENT.md` and `ROLLBACK.md`.

**Done when:** from your OMM profile, two clicks gets you watching your last play.

---

## Step 10 — Hardening (me, before you share it widely)

1. **Durable cache.** Swap the edge cache for **R2** for `.osz` and `.osr` files. The edge cache is per data centre and gets evicted, so popular maps would keep re-downloading from mirrors. Needs an R2 bucket, free tier.
2. **Upload limits.** `.osr` under 5 MB, `.osz` under 150 MB. Reject anything that doesn't unzip cleanly.
3. **Error logging.** Log every client error to the Worker (`/api/log`, rate limited) and keep Workers observability on. Then you see what breaks for other people.
4. **Mirror etiquette.**
   - Keep the identifying User-Agent.
   - Don't hammer a mirror that's failing: skip it for 10 minutes after 3 failures.
5. **Rate limit.** 60 requests/min per IP is a guess. Watch real usage and adjust in `wrangler.jsonc`.
6. **Bundle size.** The main bundle is ~515 KB (154 KB gzipped). Fine for now. Split the renderer into its own chunk if the home page ever feels slow on mobile.

---

## Known limitations in the current build

Things that are intentionally rough right now, so they don't surprise you:

- **DT** pitches up like NC (Step 4.4).
- **No hitsounds**, only music (Step 4.3).
- **Hand-drawn circles** instead of skin sprites. Slider bodies look slightly flat (Step 5).
- **No score or HP bar** (Step 3.4).
- **Judgement is a first pass.** Expect some mismatches on real replays (Step 3).
- **Map lead-in** isn't read from the map (Step 4.2).
- **Flashlight** isn't drawn (Step 5.7).
- **Follow points, hit lighting, storyboards and video backgrounds** aren't drawn.
- **Recent plays** only covers the last 24 hours. That's an osu! API limit. For older plays, use F2 export and drop the `.osr` in.

---

## Order at a glance

| # | Step | Who | Size | Blocks |
|---|---|---|---|---|
| 1 | Run against real osu! | You | 30 min | Everything |
| 2 | Deploy + licence decision | You | 15 min | 9 |
| 3.1 | Collect test replays | You | 30 min | 3.2–3.4 |
| 3.2–3.4 | Judgement parity, score, HP | Me | Biggest — several sessions | 5.4, 7 |
| 4 | Sound | Me | 2 sessions | 7 |
| 5 | Skin + visuals | Me | 2–3 sessions | 7 |
| 6 | Player polish | Me | 1 session | — |
| 7 | MP4 export | Me | 1–2 sessions | — |
| 8 | Lazer rules | Me | 2 sessions | — |
| 9 | One Miss Merchants hookup | Me + you | 1 session | — |
| 10 | Hardening | Me | 1 session | Wide sharing |

Steps 4, 5 and 6 can run alongside 3. Step 7 waits for 3–5 so the video shows the finished look.

**Your three jobs right now:**
1. Do Step 1 and send me the results of checks B, C and D (screenshots of ⓘ are perfect).
2. Pick a licence (2.4).
3. Start collecting replays for 3.1.
