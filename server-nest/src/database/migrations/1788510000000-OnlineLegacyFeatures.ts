import { MigrationInterface, QueryRunner } from 'typeorm';

export class OnlineLegacyFeatures1788510000000 implements MigrationInterface {
  name = 'OnlineLegacyFeatures1788510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "quest_progress" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "playerId" character varying NOT NULL,
        "questId" character varying(80) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'LOCKED',
        "objectivesProgress" jsonb NOT NULL DEFAULT '{}',
        "acceptedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "claimedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quest_progress" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_quest_progress_player" ON "quest_progress" ("playerId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_quest_progress_player_quest" ON "quest_progress" ("playerId", "questId")`);

    await queryRunner.query(`
      CREATE TABLE "achievement_progress" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "playerId" character varying NOT NULL,
        "achievementId" character varying(80) NOT NULL,
        "unlocked" boolean NOT NULL DEFAULT false,
        "unlockedAt" TIMESTAMP,
        "progress" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_achievement_progress" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_achievement_progress_player" ON "achievement_progress" ("playerId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_achievement_progress_player_achievement" ON "achievement_progress" ("playerId", "achievementId")`);

    await queryRunner.query(`
      CREATE TABLE "shop_purchases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "playerId" character varying NOT NULL,
        "itemId" character varying(80) NOT NULL,
        "periodKey" character varying(32) NOT NULL,
        "quantity" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shop_purchases" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_shop_purchases_player" ON "shop_purchases" ("playerId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_shop_purchases_period" ON "shop_purchases" ("playerId", "itemId", "periodKey")`);

    await queryRunner.query(`
      CREATE TABLE "world_boss_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dungeonId" character varying(80) NOT NULL,
        "seasonId" character varying(80) NOT NULL,
        "currentLayer" integer NOT NULL DEFAULT 1,
        "currentLayerDamage" integer NOT NULL DEFAULT 0,
        "currentLayerMaxHp" integer NOT NULL DEFAULT 1000000,
        "layerHistory" jsonb NOT NULL DEFAULT '[]',
        "announcements" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_world_boss_states" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_world_boss_state_season" ON "world_boss_states" ("dungeonId", "seasonId")`);

    await queryRunner.query(`
      CREATE TABLE "world_boss_chests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "playerId" character varying NOT NULL,
        "dungeonId" character varying(80) NOT NULL,
        "seasonId" character varying(80) NOT NULL,
        "layer" integer NOT NULL,
        "tier" integer NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'unopened',
        "rewardPayload" jsonb NOT NULL DEFAULT '{}',
        "openedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_world_boss_chests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_world_boss_chests_player" ON "world_boss_chests" ("playerId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_world_boss_chest_layer" ON "world_boss_chests" ("playerId", "dungeonId", "seasonId", "layer")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_world_boss_chest_layer"`);
    await queryRunner.query(`DROP INDEX "IDX_world_boss_chests_player"`);
    await queryRunner.query(`DROP TABLE "world_boss_chests"`);
    await queryRunner.query(`DROP INDEX "UQ_world_boss_state_season"`);
    await queryRunner.query(`DROP TABLE "world_boss_states"`);
    await queryRunner.query(`DROP INDEX "UQ_shop_purchases_period"`);
    await queryRunner.query(`DROP INDEX "IDX_shop_purchases_player"`);
    await queryRunner.query(`DROP TABLE "shop_purchases"`);
    await queryRunner.query(`DROP INDEX "UQ_achievement_progress_player_achievement"`);
    await queryRunner.query(`DROP INDEX "IDX_achievement_progress_player"`);
    await queryRunner.query(`DROP TABLE "achievement_progress"`);
    await queryRunner.query(`DROP INDEX "UQ_quest_progress_player_quest"`);
    await queryRunner.query(`DROP INDEX "IDX_quest_progress_player"`);
    await queryRunner.query(`DROP TABLE "quest_progress"`);
  }
}
