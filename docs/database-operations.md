# Database migration, backup, and recovery

## Release behavior

The production process runs `npm run migration:run` before starting NestJS. Migrations use a PostgreSQL advisory lock, so multiple instances cannot apply the same migration concurrently. An existing pre-migration database is adopted only after all required tables and core columns are verified.

Production persistence uses the external Neon `Game` PostgreSQL project. Render runs the NestJS web service and Redis, while `DATABASE_URL` is entered as a secret Render environment variable (`sync: false` in `render.yaml`) and `DB_SSL=true`. Do not commit the Neon connection string. The old Render PostgreSQL service is retained only as a temporary migration rollback point and is not the production source of truth after cutover.

The readiness endpoint reports:

- `schemaVersion`: latest applied migration
- `requiredSchemaVersion`: migration expected by this build
- `schemaReady`: whether the two versions match
- `deploymentCommit`: Render commit currently serving traffic

`GET /api/health/ready` returns 503 when PostgreSQL, Redis, or the schema is not ready.

## Automatic backup

The `Database backup and restore verification` GitHub Actions workflow runs every day at 02:17 China Standard Time and can also be started manually. It:

1. Calls `GET /api/admin/database/backup` with `x-backup-token`.
2. Produces a PostgreSQL custom-format logical backup with `pg_dump`.
3. Encrypts the dump, deletes the plaintext copy, decrypts it again, and checks its SHA-256 hash.
4. Restores the decrypted artifact into a clean PostgreSQL 18 service.
5. Verifies the migration version, required tables, record counts, and key relationships.
6. Deletes plaintext and uploads only the encrypted dump, checksum, and report as a 30-day GitHub Actions artifact.

Required GitHub Actions secrets:

- `BACKUP_TOKEN`: the same independent secret configured on the API
- `BACKUP_ARCHIVE_PASSWORD`: a different random value used only for artifact encryption

Recommended repository variables:

- `ONLINE_API_URL=https://gamer-nest-api.onrender.com`
- `PUBLIC_PLAYABLE_URL=https://gamer-2d-playable-demo.yicheng430664.chatgpt.site`

## Manual backup

```bash
curl --fail --show-error \
  -H "x-backup-token: $BACKUP_TOKEN" \
  https://gamer-nest-api.onrender.com/api/admin/database/backup \
  -o gamer.dump
pg_restore --list gamer.dump
```

Keep `BACKUP_TOKEN` outside source control. A request without the correct token receives HTTP 401.

## Restore drill

Always restore into an isolated empty database first:

```bash
createdb gamer_restore
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname gamer_restore gamer.dump
psql --dbname gamer_restore \
  --file server-nest/scripts/verify-restored-backup.sql
```

For an encrypted Actions artifact:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in gamer.dump.enc -out gamer.dump \
  -pass env:BACKUP_ARCHIVE_PASSWORD
sha256sum -c gamer.dump.sha256
```

Do not overwrite production during a drill. A real disaster recovery operation should stop application writes, restore into a new PostgreSQL database, run the verification SQL, update `DATABASE_URL`, deploy, and then run the public acceptance workflow.

## Post-deploy acceptance

The `Online post-deploy acceptance` workflow builds the server, waits until `/api/health/ready` reports the pushed Git commit and current schema, and then verifies the public Sites route through this loop:

1. Register and sign in.
2. Draw a character with gold.
3. Start and settle an experience dungeon.
4. Upgrade the character with experience resources and gold.
5. Reload the profile and confirm persistence.

This verifies the actual public frontend proxy, deployed API, Redis, and PostgreSQL path rather than only checking that an HTTP port is open.

## Concurrent mutation safety

Reward-bearing and resource-consuming endpoints accept an `Idempotency-Key` header. Battle settlement uses the `battleSeed` returned by dungeon start; the web client generates a fresh key for gacha, character upgrades, sweeps, idle and daily claims, crafting, enhancement, breakthrough, and dismantling. Reusing a key with the same request returns the original response with `idempotency.replayed=true`; reusing it with a different request returns HTTP 409.

Each protected mutation records its result in `operation_requests`, locks the player row, and commits costs, rewards, progress, and history in one PostgreSQL transaction. Database constraints reject negative gold, negative item quantities, and duplicate stackable inventory rows.

Run the multi-account test locally with:

```bash
npm run e2e:concurrency
```

The production post-deploy workflow also runs this test with six accounts. It submits duplicate gacha and settlement requests concurrently, verifies exact replay behavior, and runs distinct mutations against one player to detect lost balance updates.
