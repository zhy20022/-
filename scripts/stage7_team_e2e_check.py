"""Stage 7 team dungeon end-to-end check.

Runs against an isolated SQLite database and exercises:
register/login -> seed 4 players with 20 max-level characters -> room create
and join -> ready -> multiplayer battle start -> settlement -> team record query.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "stage7_team_e2e.sqlite"


def configure_environment() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH.as_posix()}"
    os.environ.setdefault("SECRET_KEY", "stage7-team-e2e-secret")
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


configure_environment()

from src.server.app import app  # noqa: E402
from src.database import get_database  # noqa: E402
from src.database.models.character import CharacterModel  # noqa: E402
from src.database.models.multiplayer import TeamDungeonClearRecordModel  # noqa: E402
from src.dungeons.dungeon_database import get_dungeon_by_id  # noqa: E402
from src.dungeons.dungeon_battle import DungeonBattleFlow  # noqa: E402
from src.dungeons.dungeon_monster import MonsterSpawner, MonsterType  # noqa: E402
from src.dungeons.multiplayer_manager import get_room_manager  # noqa: E402
from src.classes.profession import get_profession, ProfessionType  # noqa: E402
from src.attributes.attribute import Attribute, AttributeType  # noqa: E402
from src.versions.version import GameVersion  # noqa: E402
from src.characters.character import Character  # noqa: E402
from src.serialization.character_serializer import CharacterSerializer  # noqa: E402
from src.server.battle_api import active_battles  # noqa: E402


DUNGEON_ID = "fire_type_team_001"
PASSWORD = "stage7-password"
ROLES = [
    ProfessionType.PHYSICAL_TANK,
    ProfessionType.MAGIC_TANK,
    ProfessionType.PHYSICAL_TANK,
    ProfessionType.HEALER,
    ProfessionType.HEALER,
    ProfessionType.HEALER,
    ProfessionType.HEALER,
    ProfessionType.SUPPORT,
    ProfessionType.SUPPORT,
    ProfessionType.SUPPORT,
    ProfessionType.PHYSICAL_MELEE_DPS,
    ProfessionType.PHYSICAL_RANGED_DPS,
    ProfessionType.PHYSICAL_MELEE_DPS,
    ProfessionType.PHYSICAL_RANGED_DPS,
    ProfessionType.MAGIC_MELEE_DPS,
    ProfessionType.MAGIC_RANGED_DPS,
    ProfessionType.MAGIC_MELEE_DPS,
    ProfessionType.MAGIC_RANGED_DPS,
    ProfessionType.PHYSICAL_MELEE_DPS,
    ProfessionType.MAGIC_RANGED_DPS,
]


def ok(message: str) -> None:
    print(f"[OK] {message}")


def fail(message: str) -> None:
    raise AssertionError(message)


def expect_success(response, label: str, status_codes: tuple[int, ...] = (200,)) -> Dict[str, Any]:
    payload = response.get_json() or {}
    if response.status_code not in status_codes or not payload.get("success"):
        fail(f"{label} failed: HTTP {response.status_code}, {payload}")
    ok(label)
    return payload


def reset_room_manager() -> None:
    manager = get_room_manager()
    with manager._lock:  # E2E-only cleanup for isolated deterministic state.
        manager._rooms.clear()
        manager._persist_locked()
    active_battles.clear()


def make_stats(profession_type: ProfessionType) -> Dict[str, int]:
    version = GameVersion("stage7", "Stage 7", "E2E", 1, __import__("datetime").datetime.utcnow())
    character = Character(
        character_id="preview",
        name="Preview",
        profession=get_profession(profession_type),
        attribute=Attribute(AttributeType.FIRE),
        version=version,
        level=100,
        exp=0,
    )
    return CharacterSerializer.domain_to_model_dict(character)["stats"]


def seed_characters(player_id: str, player_index: int) -> List[str]:
    db = get_database()
    session = db.get_session()
    try:
        character_ids = []
        for local_index in range(5):
            role = ROLES[player_index * 5 + local_index]
            character_id = f"stage7_{player_index}_{local_index}_{uuid.uuid4().hex[:8]}"
            character_ids.append(character_id)
            session.add(CharacterModel(
                character_id=character_id,
                player_id=player_id,
                name=f"Stage7 P{player_index + 1}-{local_index + 1}",
                profession_type=role.value,
                attribute_type=AttributeType.FIRE.value,
                version_id="stage7",
                level=100,
                exp=0,
                stats=make_stats(role),
                equipment={},
                skills={},
            ))
        session.commit()
        return character_ids
    finally:
        session.close()


def make_fast_team_battle() -> None:
    dungeon = get_dungeon_by_id(DUNGEON_ID)
    if not dungeon:
        fail(f"missing dungeon {DUNGEON_ID}")
    dungeon.duration = 12.0
    original_configure = MonsterSpawner._configure_spawn_times
    original_random_monster_type = MonsterSpawner._get_random_monster_type

    def fast_configure(self: MonsterSpawner) -> None:
        original_configure(self)
        if self.dungeon.dungeon_id == DUNGEON_ID:
            self.spawn_times = [0.1]
            self.boss_spawn_times = []

    def fast_monster_type(self: MonsterSpawner) -> MonsterType:
        if self.dungeon.dungeon_id == DUNGEON_ID:
            return MonsterType.SINGLE
        return original_random_monster_type(self)

    MonsterSpawner._configure_spawn_times = fast_configure
    MonsterSpawner._get_random_monster_type = fast_monster_type


def force_all_ready_clients(clients: List[Any], room_id: str, character_sets: List[List[str]]) -> None:
    for index, client in enumerate(clients):
        expect_success(
            client.post(f"/api/dungeons/multiplayer/rooms/{room_id}/ready", json={
                "is_ready": True,
                "character_ids": character_sets[index],
            }),
            f"player {index + 1} ready",
        )


def wait_for_result(client, battle_id: str, timeout_seconds: float = 20.0) -> Dict[str, Any]:
    deadline = time.time() + timeout_seconds
    last_payload: Dict[str, Any] = {}
    while time.time() < deadline:
        response = client.get(f"/api/battle/{battle_id}/result")
        last_payload = response.get_json() or {}
        if response.status_code == 200 and last_payload.get("success"):
            return last_payload["result"]
        time.sleep(0.5)
    fail(f"battle result timed out: {last_payload}")


def assert_team_record_in_database(battle_id: str) -> None:
    db = get_database()
    session = db.get_session()
    try:
        record = session.query(TeamDungeonClearRecordModel).filter(
            TeamDungeonClearRecordModel.battle_id == battle_id
        ).first()
        if not record:
            fail("team clear record was not written")
        if not record.success:
            fail(f"team clear record success=false: {record.to_dict()}")
        performance_payload = record.performance_payload or {}
        if not performance_payload.get("damage_summary", {}).get("players"):
            fail(f"team clear record missing damage contribution summary: {record.to_dict()}")
        ok(f"team record persisted tier={record.reward_tier}, score={record.performance_score}")
    finally:
        session.close()


def main() -> None:
    reset_room_manager()
    make_fast_team_battle()

    clients = [app.test_client() for _ in range(4)]
    player_ids: List[str] = []
    character_sets: List[List[str]] = []
    stamp = int(time.time())

    for index, client in enumerate(clients):
        username = f"stage7_team_{stamp}_{index + 1}"
        register_payload = expect_success(
            client.post("/api/auth/register", json={"username": username, "password": PASSWORD}),
            f"register player {index + 1}",
        )
        player_id = register_payload["player"]["player_id"]
        player_ids.append(player_id)
        expect_success(
            client.post("/api/auth/login", json={"username": username, "password": PASSWORD}),
            f"login player {index + 1}",
        )
        character_sets.append(seed_characters(player_id, index))
        ok(f"seeded 5 max-level fire characters for player {index + 1}")

    room_payload = expect_success(
        clients[0].post("/api/dungeons/multiplayer/rooms", json={"dungeon_id": DUNGEON_ID}),
        "leader creates 20-player room",
    )
    room_id = room_payload["room"]["room_id"]

    for index in range(1, 4):
        expect_success(
            clients[index].post(f"/api/dungeons/multiplayer/rooms/{room_id}/join", json={
                "character_ids": character_sets[index],
            }),
            f"player {index + 1} joins room",
        )

    force_all_ready_clients(clients, room_id, character_sets)

    start_payload = expect_success(
        clients[0].post(f"/api/battle/multiplayer/{room_id}/start", json={"battle_speed": 4}),
        "leader starts team battle",
    )
    battle_id = start_payload["battle_id"]
    result = wait_for_result(clients[0], battle_id)

    if not result.get("outcome", {}).get("success"):
        fail(f"battle did not clear: {result}")
    if len(result.get("player_results") or {}) != 4:
        fail(f"expected 4 player settlements: {result.get('player_results')}")
    if not result.get("team_record") or not result.get("team_performance"):
        fail(f"missing team record/performance in result: {result}")

    expect_success(
        clients[0].get(f"/api/battle/team-records?dungeon_id={DUNGEON_ID}&limit=5"),
        "query team record API",
    )
    assert_team_record_in_database(battle_id)

    ok("stage 7 team dungeon E2E passed")
    print(f"[INFO] battle_id={battle_id}")
    print(f"[INFO] isolated_db={DB_PATH}")


if __name__ == "__main__":
    main()
