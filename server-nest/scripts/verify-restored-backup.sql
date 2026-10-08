\set ON_ERROR_STOP on

\if :{?expected_schema_version}
SELECT set_config('gamer.expected_schema_version', :'expected_schema_version', false);
\else
\echo 'expected_schema_version must be supplied from the release schema-version.ts'
\quit 1
\endif

DO $$
DECLARE
  required_tables text[] := ARRAY[
    'admin_logs',
    'battle_records',
    'daily_goal_progress',
    'dungeon_progress',
    'friend_assist_records',
    'friendships',
    'gacha_records',
    'game_configs',
    'guild_contributions',
    'guild_members',
    'guilds',
    'idle_claims',
    'idle_sessions',
    'inventory_items',
    'mails',
    'operation_requests',
    'quest_progress',
    'achievement_progress',
    'shop_purchases',
    'world_boss_states',
    'world_boss_chests',
    'multiplayer_rooms',
    'multiplayer_room_members',
    'multiplayer_room_invitations',
    'player_characters',
    'players',
    'ranking_entries',
    'typeorm_migrations',
    'users'
  ];
  missing_tables text[];
  current_version text;
  orphan_count bigint;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO missing_tables
  FROM unnest(required_tables) AS table_name
  WHERE to_regclass('public.' || quote_ident(table_name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'restore verification failed; missing tables: %', array_to_string(missing_tables, ', ');
  END IF;

  SELECT name INTO current_version
  FROM typeorm_migrations
  ORDER BY id DESC
  LIMIT 1;

  IF current_version IS DISTINCT FROM current_setting('gamer.expected_schema_version') THEN
    RAISE EXCEPTION 'restore verification failed; unexpected schema version: %', current_version;
  END IF;

  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'multiplayer_room_members'
      AND column_name IN ('connectionStatus', 'lastSeenAt', 'disconnectedAt')) <> 3 THEN
    RAISE EXCEPTION 'restore verification failed; multiplayer presence columns missing';
  END IF;

  SELECT count(*) INTO orphan_count
  FROM multiplayer_room_members m
  LEFT JOIN multiplayer_rooms r ON r.id = m."roomId"
  LEFT JOIN players p ON p.id = m."playerId"
  WHERE r.id IS NULL OR p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; orphan room members: %', orphan_count;
  END IF;

  SELECT count(*) INTO orphan_count
  FROM players p
  LEFT JOIN users u ON u.id::text = p."userId"
  WHERE u.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; orphan players: %', orphan_count;
  END IF;

  SELECT count(*) INTO orphan_count
  FROM player_characters c
  LEFT JOIN players p ON p.id::text = c."playerId"
  WHERE p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; orphan player characters: %', orphan_count;
  END IF;

  SELECT count(*) INTO orphan_count
  FROM inventory_items i
  LEFT JOIN players p ON p.id::text = i."playerId"
  WHERE p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; orphan inventory items: %', orphan_count;
  END IF;

  SELECT count(*) INTO orphan_count FROM players WHERE gold < 0;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; negative player balances: %', orphan_count;
  END IF;

  SELECT count(*) INTO orphan_count FROM inventory_items WHERE quantity < 0;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; negative inventory quantities: %', orphan_count;
  END IF;

  SELECT count(*) INTO orphan_count
  FROM (
    SELECT 1
    FROM inventory_items
    WHERE "itemType" IN ('material', 'currency', 'fragment', 'consumable')
    GROUP BY "playerId", "itemConfigId", "itemType"
    HAVING count(*) > 1
  ) duplicates;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'restore verification failed; duplicate inventory stacks: %', orphan_count;
  END IF;
END $$;

SELECT jsonb_pretty(jsonb_build_object(
  'verifiedAt', now(),
  'schemaVersion', (SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 1),
  'counts', jsonb_build_object(
    'users', (SELECT count(*) FROM users),
    'players', (SELECT count(*) FROM players),
    'characters', (SELECT count(*) FROM player_characters),
    'inventoryItems', (SELECT count(*) FROM inventory_items),
    'battleRecords', (SELECT count(*) FROM battle_records),
    'gachaRecords', (SELECT count(*) FROM gacha_records)
  )
)) AS restore_verification;
