import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConcurrentMutationSafety1788509000000 implements MigrationInterface {
  name = 'ConcurrentMutationSafety1788509000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "operation_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "playerId" character varying NOT NULL,
        "operation" character varying(80) NOT NULL,
        "idempotencyKey" character varying(128) NOT NULL,
        "requestHash" character varying(64) NOT NULL,
        "response" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operation_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_operation_request_key" ON "operation_requests" ("playerId", "operation", "idempotencyKey")`);
    await queryRunner.query(`CREATE INDEX "IDX_operation_request_player_created" ON "operation_requests" ("playerId", "createdAt")`);

    await queryRunner.query(`
      WITH duplicates AS (
        SELECT "playerId", "itemConfigId", "itemType",
               (array_agg("id" ORDER BY "createdAt", "id"))[1] AS keep_id,
               SUM("quantity")::integer AS total_quantity
        FROM "inventory_items"
        WHERE "itemType" IN ('material', 'currency', 'fragment', 'consumable')
        GROUP BY "playerId", "itemConfigId", "itemType"
        HAVING COUNT(*) > 1
      )
      UPDATE "inventory_items" item
      SET "quantity" = duplicates.total_quantity, "updatedAt" = now()
      FROM duplicates
      WHERE item."id" = duplicates.keep_id
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "playerId", "itemConfigId", "itemType"
          ORDER BY "createdAt", "id"
        ) AS row_number
        FROM "inventory_items"
        WHERE "itemType" IN ('material', 'currency', 'fragment', 'consumable')
      )
      DELETE FROM "inventory_items" item
      USING ranked
      WHERE item."id" = ranked."id" AND ranked.row_number > 1
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_inventory_stack"
      ON "inventory_items" ("playerId", "itemConfigId", "itemType")
      WHERE "itemType" IN ('material', 'currency', 'fragment', 'consumable')
    `);
    await queryRunner.query(`ALTER TABLE "players" ADD CONSTRAINT "CHK_players_gold_nonnegative" CHECK ("gold" >= 0)`);
    await queryRunner.query(`ALTER TABLE "inventory_items" ADD CONSTRAINT "CHK_inventory_quantity_nonnegative" CHECK ("quantity" >= 0)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP CONSTRAINT "CHK_inventory_quantity_nonnegative"`);
    await queryRunner.query(`ALTER TABLE "players" DROP CONSTRAINT "CHK_players_gold_nonnegative"`);
    await queryRunner.query(`DROP INDEX "UQ_inventory_stack"`);
    await queryRunner.query(`DROP INDEX "IDX_operation_request_player_created"`);
    await queryRunner.query(`DROP INDEX "UQ_operation_request_key"`);
    await queryRunner.query(`DROP TABLE "operation_requests"`);
  }
}
