import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiplayerRoomEvents1788514000000 implements MigrationInterface {
  name = 'MultiplayerRoomEvents1788514000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "multiplayer_rooms" ADD "stateVersion" bigint NOT NULL DEFAULT 0`);
    await runner.query(`CREATE TABLE "multiplayer_room_events" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "roomId" uuid NOT NULL REFERENCES "multiplayer_rooms" ("id") ON DELETE CASCADE,
      "version" bigint NOT NULL CHECK ("version" > 0),
      "eventType" varchar(40) NOT NULL,
      "payload" jsonb NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_room_event_version" UNIQUE ("roomId", "version")
    )`);
    await runner.query(`CREATE INDEX "IDX_room_event_created" ON "multiplayer_room_events" ("createdAt")`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "multiplayer_room_events"`);
    await runner.query(`ALTER TABLE "multiplayer_rooms" DROP COLUMN "stateVersion"`);
  }
}
