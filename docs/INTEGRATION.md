# OSU-RENDER ↔ One Miss Merchants integration contract (M12)

**Status: IN PROGRESS — osu-render's deep-link half is implemented and unit-tested. OMM integration, a deployed URL and real API acceptance have NOT been verified.**

This project remains a standalone Worker/app. A profile or match page on One Miss Merchants can link to it, instead of embedding its renderer and weakening either site's Content Security Policy.

## Supported public, read-only entry points

- `https://<renderer-host>/?user=<osu_user_id>`: opens the recent osu!standard score list for a linked osu! account automatically. Requires a positive integer osu! user **ID**, not an internal OMM user ID or profile display name.
- `https://<renderer-host>/?score=<osu_score_id>`: downloads and renders that score when osu! allows replay retrieval. The Share replay button copies the canonical link after a score starts.
- Invalid or oversized IDs do not trigger API requests. If both parameters are supplied, a valid `score` takes precedence; a malformed score does not silently downgrade to `user`.
- Direct links only select public osu! IDs. They do not grant login access, authorize replay downloads, expose credentials or bypass the existing exact beatmap-checksum requirement.

`web/src/launch.ts` is the executable contract; `web/test/launch.test.ts` covers parsing, injection-resistant bounds and canonical URL output.

## Work required in One Miss Merchants (not yet applied)

1. Decide the renderer's deployed HTTPS hostname. Do not hardcode an assumed Cloudflare subdomain.
2. On user profiles, read the **linked osu! user ID** from OMM's identity records and display **Watch replays** only when a valid linked ID is present. Build the URL with a URL object and a validated numeric ID.
3. On match/tournament result rows, use the real osu! score ID (not an OMM match ID, lobby ID or replay file hash) to build `?score=...` URLs. A score without a retrievable replay should show a disabled/unavailable link.
4. Open the renderer as a normal external HTTPS link with `rel="noopener noreferrer"`. OMM's existing `frame-ancestors` restrictions need no changes for this approach.
5. Document the renderer's separately versioned deployment and rollback steps in OMM's `DEPLOYMENT.md` and `ROLLBACK.md`. Do not merge or deploy this draft PR as part of OMM changes.

## Acceptance evidence

- PASS (isolated): supported `?user` and `?score` ID parsing and canonical share links via Vitest.
- PASS (synthetic integration): score/user browser entry handlers call existing real API functions rather than a mock data source; builds and TypeScript checks in GitHub Actions.
- OPEN: real deployed HTTPS hostname, osu! credentials, production replay API authorization and results.
- OPEN: One Miss Merchants profile, match and tournament review links (separate repository).
- OPEN: end-to-end browser acceptance from an OMM account to a playable score, and rollback rehearsal.

## Permission/dependency boundary

No OAuth client secrets, copyrighted skins/maps or private replay files belong in the git repository. The public app uses its **own** osu! OAuth client credentials. A user-provided local `.osz` and `.osr` can still render offline, without OMM and without asking for credentials.

**Next independent development actions:** complete renderer-side player reliability, real-replay parity checks when private fixtures are available, and skin/audio features. OMM-side modifications wait until the actual deployed URL and site integration point are known. M12 remains IN PROGRESS rather than PASS.
