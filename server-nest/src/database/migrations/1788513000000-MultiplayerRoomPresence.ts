import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiplayerRoomPresence1788513000000 implements MigrationInterface {
  name = 'MultiplayerRoomPresence1788513000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "multiplayer_room_members" ADD "connectionStatus" character varying(16) NOT NULL DEFAULT 'online'`);
    await queryRunner.query(`ALTER TABLE "multiplayer_room_members" ADD "lastSeenAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "multiplayer_room_members" ADD "disconnectedAt" TIMESTAMP`);
    await queryRunner.query(`UPDATE "multiplayer_room_members" SET "lastSeenAt" = COALESCE("updatedAt", now()) WHERE "lastSeenAt" IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_multiplayer_room_member_presence" ON "multiplayer_room_members" ("roomId", "connectionStatus", "lastSeenAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_multiplayer_room_member_presence"`);
    await queryRunner.query(`ALTER TABLE "multiplayer_room_members" DROP COLUMN "disconnectedAt"`);
    await queryRunner.query(`ALTER TABLE "multiplayer_room_members" DROP COLUMN "lastSeenAt"`);
    await queryRunner.query(`ALTER TABLE "multiplayer_room_members" DROP COLUMN "connectionStatus"`);
  }
}
