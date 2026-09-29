import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiplayerRooms1788512000000 implements MigrationInterface {
  name = 'MultiplayerRooms1788512000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "multiplayer_rooms" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dungeonId" character varying(80) NOT NULL,
        "leaderPlayerId" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'waiting',
        "capacity" integer NOT NULL DEFAULT 5,
        "maxCharactersPerMember" integer NOT NULL DEFAULT 5,
        "battleSeed" uuid,
        "battleRecordId" uuid,
        "characterIds" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_multiplayer_rooms" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_multiplayer_rooms_status_updated" ON "multiplayer_rooms" ("status", "updatedAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_multiplayer_rooms_leader_status" ON "multiplayer_rooms" ("leaderPlayerId", "status")`);
    await queryRunner.query(`
      CREATE TABLE "multiplayer_room_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "roomId" uuid NOT NULL,
        "playerId" uuid NOT NULL,
        "characterIds" jsonb NOT NULL DEFAULT '[]',
        "isReady" boolean NOT NULL DEFAULT false,
        "joinedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_multiplayer_room_members" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_multiplayer_room_member" ON "multiplayer_room_members" ("roomId", "playerId")`);
    await queryRunner.query(`CREATE INDEX "IDX_multiplayer_room_member_player_updated" ON "multiplayer_room_members" ("playerId", "updatedAt")`);
    await queryRunner.query(`
      CREATE TABLE "multiplayer_room_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "roomId" uuid NOT NULL,
        "inviterPlayerId" uuid NOT NULL,
        "inviteePlayerId" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_multiplayer_room_invitations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_multiplayer_invitee_status_created" ON "multiplayer_room_invitations" ("inviteePlayerId", "status", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_multiplayer_room_invitation_room_invitee_status" ON "multiplayer_room_invitations" ("roomId", "inviteePlayerId", "status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_multiplayer_room_invitation_room_invitee_status"`);
    await queryRunner.query(`DROP INDEX "IDX_multiplayer_invitee_status_created"`);
    await queryRunner.query(`DROP TABLE "multiplayer_room_invitations"`);
    await queryRunner.query(`DROP INDEX "IDX_multiplayer_room_member_player_updated"`);
    await queryRunner.query(`DROP INDEX "UQ_multiplayer_room_member"`);
    await queryRunner.query(`DROP TABLE "multiplayer_room_members"`);
    await queryRunner.query(`DROP INDEX "IDX_multiplayer_rooms_leader_status"`);
    await queryRunner.query(`DROP INDEX "IDX_multiplayer_rooms_status_updated"`);
    await queryRunner.query(`DROP TABLE "multiplayer_rooms"`);
  }
}
