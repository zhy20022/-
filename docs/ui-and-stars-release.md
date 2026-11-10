# Unified UI and Character Stars

Release scope, November 10, 2026:

- Shared 1400px responsive page frame, centered module titles, square home
  control, fixed back-to-top control, and consistent typography.
- Completed onboarding collapses and remains available above the season tabs.
- Character cards show a portrait, exclusive item, and eight equipment slots.
- Details and crafting support head, chest, shoulders, gloves, legs, boots,
  ring and necklace. Legacy accessory items remain usable as rings.
- Background stories are extracted from the author's 64 source documents.
- Each duplicate draw grants one character-specific shard in the backpack.
- Star costs are 5, 10, 15 and 20 shards; base-stat multipliers are 100%, 120%,
  145%, 170% and 200%. Equipment bonuses are added after the star multiplier.
- Upgrade writes use player/row locks and idempotent requests. No schema
  migration or destructive inventory conversion is required.

Verification:

- Frontend production build and TypeScript checks.
- Browser layout tests at 1440px, 390px and 320px across eleven modules.
- Seven backend rule tests, including duplicate draws and room speed voting.
- Isolated PostgreSQL HTTP tests for exact shard costs, replay protection,
  maximum star, ownership, 200% stats, and new equipment slots.
- Python worker tests for matching star-scaled battle stats.

The original dirty checkout is not part of this release. Render's existing
free-instance sleep and resource limits remain; these UI changes do not imply
that all production latency has been eliminated.
