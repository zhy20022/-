import { MigrationInterface, QueryRunner } from 'typeorm';

export class QuestRewardPeriods1788511000000 implements MigrationInterface {
  name = 'QuestRewardPeriods1788511000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "quest_progress" ADD "periodKey" character varying(16) NOT NULL DEFAULT 'permanent'`);
    await queryRunner.query(`
      UPDATE "quest_progress"
      SET "periodKey" = to_char(("createdAt" AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
      WHERE "questId" LIKE 'daily_%'
    `);
    await queryRunner.query(`
      UPDATE "quest_progress"
      SET "periodKey" = to_char(date_trunc('week', ("createdAt" AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD')
      WHERE "questId" LIKE 'weekly_%'
    `);
    await queryRunner.query(`DROP INDEX "UQ_quest_progress_player_quest"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_quest_progress_player_quest_period" ON "quest_progress" ("playerId", "questId", "periodKey")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_quest_progress_player_quest_period"`);
    await queryRunner.query(`
      DELETE FROM "quest_progress" older
      USING "quest_progress" newer
      WHERE older."playerId" = newer."playerId" AND older."questId" = newer."questId"
        AND (older."createdAt", older."id") < (newer."createdAt", newer."id")
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_quest_progress_player_quest" ON "quest_progress" ("playerId", "questId")`);
    await queryRunner.query(`ALTER TABLE "quest_progress" DROP COLUMN "periodKey"`);
  }
}
