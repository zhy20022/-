import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialOnlineSchema1788502608304 implements MigrationInterface {
    name = 'InitialOnlineSchema1788502608304'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`
            CREATE TABLE "admin_logs" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "actor" character varying(80) NOT NULL,
                "action" character varying(80) NOT NULL,
                "targetId" character varying(80),
                "payload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_1bd116497b175ab12373dcb362b" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_0e0ae083ef32226cf844f440e3" ON "admin_logs" ("actor")
        `);
        await queryRunner.query(`
            CREATE TABLE "battle_records" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "dungeonId" character varying(80) NOT NULL,
                "success" boolean NOT NULL DEFAULT false,
                "duration" double precision NOT NULL DEFAULT '0',
                "damageScore" integer NOT NULL DEFAULT '0',
                "characterIds" jsonb NOT NULL DEFAULT '[]',
                "rewards" jsonb NOT NULL DEFAULT '{}',
                "resultPayload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_eff85bd193ba9c0bdd31caee340" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_f44f219b100fc4b2223400d7e4" ON "battle_records" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_fdd76135f726c40c056d8b7a11" ON "battle_records" ("dungeonId")
        `);
        await queryRunner.query(`
            CREATE TABLE "daily_goal_progress" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "dateKey" character varying(10) NOT NULL,
                "goalKey" character varying(80) NOT NULL,
                "progress" integer NOT NULL DEFAULT '0',
                "claimed" boolean NOT NULL DEFAULT false,
                "metadata" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ed5da2e940aa31cec004365a2fe" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_2bb92874bb6401bf7c64bfd4c3" ON "daily_goal_progress" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_2069643a4a87d8e89409329389" ON "daily_goal_progress" ("dateKey")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_27ab992777aa786961008e41f0" ON "daily_goal_progress" ("playerId", "dateKey", "goalKey")
        `);
        await queryRunner.query(`
            CREATE TABLE "dungeon_progress" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "dungeonId" character varying(80) NOT NULL,
                "totalAttempts" integer NOT NULL DEFAULT '0',
                "successfulAttempts" integer NOT NULL DEFAULT '0',
                "failedAttempts" integer NOT NULL DEFAULT '0',
                "bestDamageScore" integer NOT NULL DEFAULT '0',
                "bestDuration" double precision,
                "bestRecord" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_04ec1c869c65b604a7f831c1f43" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_aaf1949ef4cb4f545d3e6f38e9" ON "dungeon_progress" ("playerId", "dungeonId")
        `);
        await queryRunner.query(`
            CREATE TABLE "friend_assist_records" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "borrowerPlayerId" character varying NOT NULL,
                "helperPlayerId" character varying NOT NULL,
                "helperCharacterId" uuid,
                "dungeonId" character varying(80),
                "rewardGold" integer NOT NULL DEFAULT '0',
                "payload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_6658e15011f0f99853012990e2f" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_e039e73327fb8a4b3fbd4dcddc" ON "friend_assist_records" ("borrowerPlayerId", "createdAt")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_f088db789bb3e1a5dbf942cbbb" ON "friend_assist_records" ("helperPlayerId", "createdAt")
        `);
        await queryRunner.query(`
            CREATE TABLE "friendships" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "requesterPlayerId" character varying NOT NULL,
                "addresseePlayerId" character varying NOT NULL,
                "status" character varying(24) NOT NULL DEFAULT 'pending',
                "metadata" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_08af97d0be72942681757f07bc8" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_93288562555c7540c374836f91" ON "friendships" ("requesterPlayerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_7f23aca0c08be12f45acae3556" ON "friendships" ("addresseePlayerId")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_25d227403397e369477e410234" ON "friendships" ("requesterPlayerId", "addresseePlayerId")
        `);
        await queryRunner.query(`
            CREATE TABLE "gacha_records" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "poolKey" character varying(80) NOT NULL,
                "drawCount" integer NOT NULL DEFAULT '1',
                "results" jsonb NOT NULL DEFAULT '[]',
                "cost" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_8fcd432cd504efeae8a5cb33472" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_ead535aef6a6bfa6d24487e164" ON "gacha_records" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_9dcfca938e252456b9ac7e0d79" ON "gacha_records" ("poolKey")
        `);
        await queryRunner.query(`
            CREATE TABLE "game_configs" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "configKey" character varying(80) NOT NULL,
                "version" integer NOT NULL DEFAULT '1',
                "enabled" boolean NOT NULL DEFAULT true,
                "payload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_7d7ef60da2cd850d7676c290dcf" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_a4a607921a46d4586cce6f4ffb" ON "game_configs" ("configKey")
        `);
        await queryRunner.query(`
            CREATE TABLE "guild_contributions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "guildId" character varying NOT NULL,
                "playerId" character varying NOT NULL,
                "amount" integer NOT NULL DEFAULT '0',
                "source" character varying(80) NOT NULL DEFAULT 'manual',
                "payload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_3fd5b6eba55aa8d882e5ba93c47" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_3b5c004412ba10d828e377acb9" ON "guild_contributions" ("playerId", "createdAt")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_922e94f9a69ef29461bd3a39dd" ON "guild_contributions" ("guildId", "createdAt")
        `);
        await queryRunner.query(`
            CREATE TABLE "guild_members" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "guildId" character varying NOT NULL,
                "playerId" character varying NOT NULL,
                "role" character varying(24) NOT NULL DEFAULT 'member',
                "weeklyContribution" integer NOT NULL DEFAULT '0',
                "totalContribution" integer NOT NULL DEFAULT '0',
                "joinedAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_d8df14c1079fd625f782c4f933c" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_2c6d1fa8790304f7488cd92959" ON "guild_members" ("guildId")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_f9e93b85f1ac9c9cdb7db82e36" ON "guild_members" ("playerId")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_8f1af78c2c36340ae23b62628c" ON "guild_members" ("guildId", "playerId")
        `);
        await queryRunner.query(`
            CREATE TABLE "guilds" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying(40) NOT NULL,
                "leaderPlayerId" character varying NOT NULL,
                "level" integer NOT NULL DEFAULT '1',
                "contribution" integer NOT NULL DEFAULT '0',
                "memberLimit" integer NOT NULL DEFAULT '30',
                "settings" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_e7e7f2a51bd6d96a9ac2aa560f9" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_e6cf236d98ddbb9b7174626cd0" ON "guilds" ("name")
        `);
        await queryRunner.query(`
            CREATE TABLE "idle_claims" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "sessionId" character varying NOT NULL,
                "stageId" character varying(80) NOT NULL,
                "elapsedSeconds" integer NOT NULL DEFAULT '0',
                "cappedSeconds" integer NOT NULL DEFAULT '0',
                "rewards" jsonb NOT NULL DEFAULT '[]',
                "goldGranted" integer NOT NULL DEFAULT '0',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_558d8bfa9642b244c5e23194b76" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_4733dcfa8f128bdb94b0c41f80" ON "idle_claims" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_74fe5537a2b44e8ef43c58af14" ON "idle_claims" ("sessionId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_b00824a03a66cd4dfc38f61785" ON "idle_claims" ("playerId", "createdAt")
        `);
        await queryRunner.query(`
            CREATE TABLE "idle_sessions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "stageId" character varying(80) NOT NULL,
                "characterIds" jsonb NOT NULL DEFAULT '[]',
                "status" character varying(20) NOT NULL DEFAULT 'active',
                "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "lastClaimedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "metadata" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_b8070887714da522d98bbff2312" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_dbcf3b0e69d70badb0eafe1c69" ON "idle_sessions" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_e18bf0fd7be0625829772ee7c7" ON "idle_sessions" ("playerId", "status")
        `);
        await queryRunner.query(`
            CREATE TABLE "inventory_items" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "itemConfigId" character varying(80) NOT NULL,
                "itemType" character varying(32) NOT NULL,
                "quantity" integer NOT NULL DEFAULT '0',
                "locked" boolean NOT NULL DEFAULT false,
                "payload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_cf2f451407242e132547ac19169" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_509ea24a6e55879c23d887cd58" ON "inventory_items" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_cd3b2ad4779b669c80390c4d38" ON "inventory_items" ("itemConfigId")
        `);
        await queryRunner.query(`
            CREATE TABLE "mails" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "title" character varying(80) NOT NULL,
                "body" text NOT NULL,
                "rewards" jsonb NOT NULL DEFAULT '[]',
                "claimed" boolean NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_218248d7dfe1b739f06e2309349" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_4889a4156f6c8739aa9a7ea069" ON "mails" ("playerId")
        `);
        await queryRunner.query(`
            CREATE TABLE "player_characters" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "playerId" character varying NOT NULL,
                "characterConfigId" character varying(80) NOT NULL,
                "attributeType" character varying(24) NOT NULL,
                "professionType" character varying(48) NOT NULL,
                "level" integer NOT NULL DEFAULT '1',
                "exp" integer NOT NULL DEFAULT '0',
                "skillSlots" jsonb NOT NULL DEFAULT '{}',
                "equipment" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_4faad69f48d86dfa28b6390cccf" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_71508be5c33f3e0fc728dd2c28" ON "player_characters" ("playerId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_cc061cb639c3b1c1818da6d64b" ON "player_characters" ("characterConfigId")
        `);
        await queryRunner.query(`
            CREATE TABLE "players" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" character varying NOT NULL,
                "displayName" character varying(40) NOT NULL,
                "level" integer NOT NULL DEFAULT '1',
                "exp" integer NOT NULL DEFAULT '0',
                "gold" integer NOT NULL DEFAULT '0',
                "flags" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_de22b8fdeee0c33ab55ae71da3b" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_7c11c744c0601ab432cfa6ff7a" ON "players" ("userId")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_26533593a5bb441565269af44d" ON "players" ("displayName")
        `);
        await queryRunner.query(`
            CREATE TABLE "ranking_entries" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "rankingKey" character varying(80) NOT NULL,
                "seasonId" character varying(80) NOT NULL DEFAULT 'default',
                "playerId" character varying NOT NULL,
                "playerName" character varying(80) NOT NULL,
                "score" integer NOT NULL DEFAULT '0',
                "payload" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_d96715e4495075ef3427c9d0953" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_0efbf69d5146645fe63f5efc51" ON "ranking_entries" ("seasonId", "rankingKey", "score")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_daedcc480dc809b9fcea6127c8" ON "ranking_entries" ("seasonId", "rankingKey", "playerId")
        `);
        await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "accountId" character varying(64) NOT NULL,
                "provider" character varying(24) NOT NULL DEFAULT 'guest',
                "passwordHash" character varying(120),
                "status" character varying(24) NOT NULL DEFAULT 'active',
                "metadata" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_42bba679e348de51a699fb0a80" ON "users" ("accountId")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "public"."IDX_42bba679e348de51a699fb0a80"
        `);
        await queryRunner.query(`
            DROP TABLE "users"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_daedcc480dc809b9fcea6127c8"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_0efbf69d5146645fe63f5efc51"
        `);
        await queryRunner.query(`
            DROP TABLE "ranking_entries"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_26533593a5bb441565269af44d"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_7c11c744c0601ab432cfa6ff7a"
        `);
        await queryRunner.query(`
            DROP TABLE "players"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_cc061cb639c3b1c1818da6d64b"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_71508be5c33f3e0fc728dd2c28"
        `);
        await queryRunner.query(`
            DROP TABLE "player_characters"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_4889a4156f6c8739aa9a7ea069"
        `);
        await queryRunner.query(`
            DROP TABLE "mails"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_cd3b2ad4779b669c80390c4d38"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_509ea24a6e55879c23d887cd58"
        `);
        await queryRunner.query(`
            DROP TABLE "inventory_items"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_e18bf0fd7be0625829772ee7c7"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_dbcf3b0e69d70badb0eafe1c69"
        `);
        await queryRunner.query(`
            DROP TABLE "idle_sessions"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_b00824a03a66cd4dfc38f61785"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_74fe5537a2b44e8ef43c58af14"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_4733dcfa8f128bdb94b0c41f80"
        `);
        await queryRunner.query(`
            DROP TABLE "idle_claims"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_e6cf236d98ddbb9b7174626cd0"
        `);
        await queryRunner.query(`
            DROP TABLE "guilds"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_8f1af78c2c36340ae23b62628c"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_f9e93b85f1ac9c9cdb7db82e36"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_2c6d1fa8790304f7488cd92959"
        `);
        await queryRunner.query(`
            DROP TABLE "guild_members"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_922e94f9a69ef29461bd3a39dd"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_3b5c004412ba10d828e377acb9"
        `);
        await queryRunner.query(`
            DROP TABLE "guild_contributions"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_a4a607921a46d4586cce6f4ffb"
        `);
        await queryRunner.query(`
            DROP TABLE "game_configs"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_9dcfca938e252456b9ac7e0d79"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_ead535aef6a6bfa6d24487e164"
        `);
        await queryRunner.query(`
            DROP TABLE "gacha_records"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_25d227403397e369477e410234"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_7f23aca0c08be12f45acae3556"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_93288562555c7540c374836f91"
        `);
        await queryRunner.query(`
            DROP TABLE "friendships"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_f088db789bb3e1a5dbf942cbbb"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_e039e73327fb8a4b3fbd4dcddc"
        `);
        await queryRunner.query(`
            DROP TABLE "friend_assist_records"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_aaf1949ef4cb4f545d3e6f38e9"
        `);
        await queryRunner.query(`
            DROP TABLE "dungeon_progress"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_27ab992777aa786961008e41f0"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_2069643a4a87d8e89409329389"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_2bb92874bb6401bf7c64bfd4c3"
        `);
        await queryRunner.query(`
            DROP TABLE "daily_goal_progress"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_fdd76135f726c40c056d8b7a11"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_f44f219b100fc4b2223400d7e4"
        `);
        await queryRunner.query(`
            DROP TABLE "battle_records"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_0e0ae083ef32226cf844f440e3"
        `);
        await queryRunner.query(`
            DROP TABLE "admin_logs"
        `);
    }

}
