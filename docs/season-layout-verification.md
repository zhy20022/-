# Season and dungeon update verification

Date: 2026-11-10

Existing unrelated auth/schema workspace edits were excluded from the isolated
release checkout. Production deployment status must be checked separately.

## Behavior

- Main-menu materials entry is now the backpack.
- Season tabs cover characters, backpack, crafting, enhancement, summons,
  inventory, shop, and dungeon routes; seasons 2-4 are reserved empty views.
- Current content defaults to season 1, named 灾厄初启.
- Character ordering uses season then authored character number.
- Character and dungeon lists use two columns on desktop and mobile.
- Experience dungeon difficulties share one entry per attribute.
- Difficulty selection displays recommended levels.
- Team selection supports attribute, profession, type, and level ordering.
- Battle results remain open and provide dungeon return and rematch actions.
- SINGLE sweep: 10 successful clears; SQUAD: 5 solo clears.
- TEAM/world sweep retain the earlier 10-flawless-clear requirement.
- SQUAD duration is 120 seconds, TEAM duration is 180 seconds.
- Each boss grants one crafting material, including on a failed run.
  A full clear grants exactly two more. No direct equipment is awarded.
- Exclusive crafting costs 8 materials; equipment crafting costs 10.
- Multiplayer starts at 1x and changes to 4x only on unanimous server-side consent.
  Repeated votes and non-member votes cannot bypass consent.

## Performance and reliability

- Routes load on demand instead of importing all pages at startup.
- Late battle polling responses are ignored after navigation or rematch.
- Pending result retries are cleared on leaving the battle.
- New battles reset previous result and drop state.
- Season controls no longer sit beneath the orientation toggle.
- Failed demo persistence invalidates the mutated memory cache before retry.
- Profile reads are deduplicated and independent dungeon reads run in parallel.
- Resource polling does not overlap or restart on route/gold changes.
- Login prewarms readiness and exits the connecting state on a 90-second timeout.
- Read requests time out after 15 seconds; simulations have a 30-second limit.

Production readiness was observed at about 36 seconds on the first request
and 3.5 seconds subsequently. The Render configuration uses the free plan.
These observations are consistent with cold startup but are not a full
production trace or proof of its sole cause. No paid plan was enabled.

These are concrete fixes, not proof that all reported production stalls are
resolved. Production backend latency and intermittent browser freezes still
require reproduction with the affected account and deployed version.

## Verification

- Frontend production build: passed.
- Frontend and Nest TypeScript checks: passed.
- Catalog, inventory contract and static storage tests: 27 passed.
- Browser tests at 1280px and 390px: passed with mocked formal API responses.
  Covered season switching, two columns, numbering, difficulty selection,
  filters, result retention beyond five seconds, rematch and dungeon return.
- Configured dungeon types passed the revised sweep and material boundary tests.
  Executed directly because the local virtual environment lacks pytest.
- Browser screenshots are under artifacts/season-*.png.

Browser tests do not establish production API or database correctness.

Additional backend checks passed:
- Four rule/clock/actual-room-voting tests.
- Python worker integration, including the 180-second raid limit.
- Isolated PostgreSQL legacy migration and repeat startup.
- Real HTTP/worker/PostgreSQL authority and concurrent-once-only settlement.

Production backend still reported commit 3276e209 at pre-release verification.
Render dashboard requires account login before deployment can be controlled.
