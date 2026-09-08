# Confirmed defect fixes (2026-09-08)

## Scope and delivery

Local source changes to the NestJS online backend, its acceptance scripts, and the web client. This patch has not been published to Render, GitHub Pages, or Sites. No production player data was changed.

## Fixed behavior

- Dungeon entry saves a random server-issued battle identity with player, dungeon, characters and server start time. Starting a new battle supersedes the old entry.
- Settlement uses that identity for transaction idempotency, independent of the HTTP request key. Missing, forged, superseded, wrong-character and cross-account entries are rejected. Changed settlement payloads conflict instead of awarding twice.
- Settlement checks elapsed server time against the existing maximum 4x playback speed. Entries expire after one hour; already committed identical settlements can still be replayed.
- Single and group monster kills share the 20-wave budget instead of independently allowing 20 waves each.
- Unverified client damage no longer creates server-owned damage ranking entries. Previously stored ranking data is not deleted.
- The online progress shortcut opens the dungeon page instead of immediately submitting a fabricated 60-second clear.
- Inventory consume/lock and character skill/equipment writes lock the player in a database transaction. Equipment cannot be equipped on two characters or dismantled concurrently with a successful equip.
- Slot-only unequip no longer mistakes two missing item IDs for a weapon match.
- Profiles return the full owned roster, including all 64 characters, and do not truncate the inventory at 100 entries.
- Experience use is capped at the amount needed for level 100; max-level previews require zero gold.
- Online battle time accumulates elapsed intervals, so changing speed does not recalculate the entire battle history.
- Online request timeout accommodates slower backend responses. No automatic retry of currency mutations was added.
- Legacy database adoption records the initial migration name, not the latest migration name. The advisory lock uses the same PostgreSQL session for acquisition and release; migration pools reserve at least two connections.
- Existing frontend TypeScript errors in battle, character, dungeon, multiplayer, team-report and static-demo code were corrected.

## Verification

An isolated PostgreSQL 18 cluster on localhost was used, with schema synchronization disabled.

- Nest lint, typecheck/build; frontend TypeScript check and Vite production build.
- `npm run e2e:security`: all 64 characters, invalid tickets, cross-account access, six request keys for one payout, kill budget, forged damage, equipment ownership, ten consumes of six items, max-level charging.
- `npm run e2e:concurrency`: six accounts, 128 requests; six affordable draws and four rejected draws from 1,000 gold, ending at 40 gold.
- `npm run e2e:online-loop`: registration, draw, start, timed settlement, reward persistence, upgrade.
- `npm run e2e:workshop-loop`: skills, crafting, enhancement, equipment, sweep, dismantle.
- `npm run e2e:http`: battle, idle claim, daily goals, guild, friends and administration passed. Local Redis was unavailable, so this does not verify Redis-dependent behavior or production readiness.
- `npm run test:legacy-migration`: legacy adoption, new migration, repeated startup, pool-size-one configuration.

## Remaining boundary

This is not a full server-side combat simulation. The online experience battle still uses client playback and reports duration/kills, now constrained by entry identity, elapsed time, ownership and wave caps. A client that waits the minimum time can still misreport combat performance within those bounds. Verified damage rankings require server-computed combat results before re-enabling writes from this flow.

This pass does not certify the legacy Python server, every character's combat logic, all guild/idle concurrency paths, or browser interaction across every mobile screen. Deployment and production acceptance remain separate from the local verification above.
