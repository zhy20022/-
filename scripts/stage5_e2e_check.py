"""
第5阶段端到端验收脚本。

使用独立 SQLite 数据库运行，不污染开发中的 gamedb.sqlite。
覆盖：UP池抽卡、抽卡历史入库、专属武器制作/装备/升级/突破、套装制作、
立绘兑换、活动商店兑换、专属武器技能进入战斗。
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "stage5_e2e.sqlite"


def configure_environment() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH.as_posix()}"
    os.environ.setdefault("SECRET_KEY", "stage5-e2e-secret")
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


configure_environment()

from src.server.app import app  # noqa: E402
from src.database import get_database  # noqa: E402
from src.database.models.gacha import GachaHistoryModel, GachaStateModel  # noqa: E402
from src.rewards.material import MaterialType  # noqa: E402
from src.rewards.material_storage import MaterialStorage  # noqa: E402
from src.attributes.attribute import AttributeType  # noqa: E402


ATTRIBUTE_TO_SINGLE_DUNGEON = {
    "火": "fire_type_single_001",
    "木": "wood_type_single_001",
    "风": "wind_type_single_001",
    "水": "water_type_single_001",
    "土": "earth_type_single_001",
    "雷": "lightning_type_single_001",
    "光": "holy_type_single_001",
    "暗": "shadow_type_single_001",
}


def ok(message: str) -> None:
    print(f"[OK] {message}")


def fail(message: str) -> None:
    raise AssertionError(message)


def expect_success(response, label: str, status_codes: tuple[int, ...] = (200,)) -> Dict[str, Any]:
    payload = response.get_json() or {}
    if response.status_code not in status_codes or not payload.get("success"):
        fail(f"{label}失败: HTTP {response.status_code}, {payload}")
    ok(label)
    return payload


def seed_stage5_materials(player_id: str) -> None:
    MaterialStorage.save_material(
        player_id,
        MaterialType.EXCLUSIVE_ITEM,
        None,
        3000,
        source="stage5_e2e",
        description="第5阶段验收：专属武器制作/升级/突破"
    )
    MaterialStorage.save_material(
        player_id,
        MaterialType.ILLUSTRATION_PIECE,
        None,
        600,
        source="stage5_e2e",
        description="第5阶段验收：立绘兑换与商店兑换"
    )
    for attribute in AttributeType:
        MaterialStorage.save_material(
            player_id,
            MaterialType.EQUIPMENT_SET,
            attribute,
            80,
            source="stage5_e2e",
            description="第5阶段验收：套装制作与商店兑换"
        )


def gacha_tables_have_data(player_id: str) -> None:
    db = get_database()
    session = db.get_session()
    try:
        state_count = session.query(GachaStateModel).filter(
            GachaStateModel.player_id == player_id
        ).count()
        history_count = session.query(GachaHistoryModel).filter(
            GachaHistoryModel.player_id == player_id
        ).count()
        if state_count <= 0 or history_count <= 0:
            fail("抽卡状态或历史没有写入数据库")
        ok(f"抽卡历史入库 state={state_count}, history={history_count}")
    finally:
        session.close()


def get_first_shop_item(items_payload: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    for items in items_payload.values():
        if items:
            return items[0]
    fail("活动商店没有可兑换商品")


def run_battle_until_exclusive_skill(client, character_id: str, attribute_type: str) -> None:
    dungeon_id = ATTRIBUTE_TO_SINGLE_DUNGEON.get(attribute_type, "water_type_single_001")
    create_payload = expect_success(
        client.post("/api/battle/create", json={
            "dungeon_id": dungeon_id,
            "character_ids": [character_id]
        }),
        "创建单人副本战斗"
    )
    battle_id = create_payload.get("battle_id")
    if not battle_id:
        fail(f"创建战斗没有返回 battle_id: {create_payload}")

    expect_success(
        client.post(f"/api/battle/{battle_id}/start", json={"battle_speed": 4}),
        "启动战斗"
    )

    observed_events: List[Dict[str, Any]] = []
    for _ in range(12):
        time.sleep(1.0)
        snapshot_payload = expect_success(
            client.get(f"/api/battle/{battle_id}/snapshot"),
            "读取战斗快照"
        )
        snapshot = snapshot_payload.get("snapshot") or {}
        observed_events.extend(snapshot.get("battle_events") or [])
        if any(event.get("event_type") == "exclusive_weapon_skill" for event in observed_events):
            ok("专属武器技能进入战斗日志")
            return

    fail(f"未观察到专属武器技能事件，最近事件: {observed_events[-8:]}")


def main() -> None:
    client = app.test_client()
    username = f"stage5_e2e_{int(time.time())}"
    password = "stage5-password"

    register_payload = expect_success(
        client.post("/api/auth/register", json={"username": username, "password": password}),
        "注册临时玩家"
    )
    player_id = register_payload["player"]["player_id"]

    expect_success(
        client.post("/api/auth/login", json={"username": username, "password": password}),
        "登录临时玩家"
    )

    seed_stage5_materials(player_id)
    ok("注入第5阶段验收材料")

    status_payload = expect_success(
        client.get("/api/gacha/status?pool_type=UP_POOL"),
        "读取UP池状态"
    )
    up_pool = status_payload.get("up_pool") or {}
    if not up_pool.get("up_character_names") or float(up_pool.get("up_rate", 0)) <= 0:
        fail(f"UP池配置无效: {up_pool}")
    ok(f"UP池配置有效: {up_pool.get('title')} / {up_pool.get('up_rate')}")

    gacha_payload = expect_success(
        client.post("/api/gacha/pull", json={"pool_type": "UP_POOL", "pull_count": 10}),
        "UP池十连抽"
    )
    if not gacha_payload.get("results"):
        fail("抽卡没有返回结果列表")
    if not gacha_payload.get("history"):
        fail("抽卡响应没有返回历史记录")
    gacha_tables_have_data(player_id)

    characters_payload = expect_success(client.get("/api/characters"), "读取角色列表")
    characters = characters_payload.get("characters") or []
    if not characters:
        fail("抽卡后角色列表为空")
    character = characters[0]
    character_id = character["character_id"]
    attribute_type = character["attribute_type"]
    ok(f"选择验收角色: {character['name']} / {attribute_type}")

    craft_weapon_payload = expect_success(
        client.post("/api/crafting/exclusive-item", json={"character_id": character_id}),
        "制作专属武器"
    )
    weapon_item = craft_weapon_payload.get("item") or {}
    weapon_item_id = weapon_item.get("item_id")
    if not weapon_item_id or not weapon_item.get("exclusive_info"):
        fail(f"专属武器产物缺少 item_id 或 exclusive_info: {weapon_item}")

    equip_payload = expect_success(
        client.post(f"/api/characters/{character_id}/equip", json={"item_id": weapon_item_id}),
        "装备专属武器"
    )
    equipped_weapon = ((equip_payload.get("character") or {}).get("equipment") or {}).get("weapon") or {}
    if not equipped_weapon.get("exclusive_info"):
        fail("装备后的角色没有携带专属武器信息")

    for expected_level in range(1, 6):
        upgrade_payload = expect_success(
            client.post("/api/upgrade/exclusive-item", json={"item_id": weapon_item_id}),
            f"专属武器升级到 Lv.{expected_level}"
        )
        if upgrade_payload.get("new_level") != expected_level:
            fail(f"专属武器升级等级异常: {upgrade_payload}")

    breakthrough_payload = expect_success(
        client.post("/api/breakthrough/exclusive-item", json={"item_id": weapon_item_id}),
        "专属武器突破"
    )
    if breakthrough_payload.get("breakthrough_level") != 1:
        fail(f"专属武器突破层级异常: {breakthrough_payload}")

    equipment_payload = expect_success(
        client.post("/api/crafting/equipment-set", json={
            "attribute_type": attribute_type,
            "profession_category": "B",
            "slot": "HELMET"
        }),
        "制作套装部件"
    )
    if not (equipment_payload.get("item") or {}).get("name"):
        fail(f"套装制作产物异常: {equipment_payload}")

    illustration_id = f"{character_id}_male"
    illustration_payload = expect_success(
        client.post("/api/exchange/illustration", json={
            "character_id": character_id,
            "illustration_id": illustration_id,
            "gender": "male"
        }),
        "兑换角色立绘"
    )
    unlocked = ((illustration_payload.get("illustration_status") or {}).get("unlocked") or [])
    if illustration_id not in unlocked:
        fail(f"立绘未进入已解锁列表: {illustration_payload}")

    shop_payload = expect_success(client.get("/api/shop/items"), "读取活动商店")
    shop_item = get_first_shop_item(shop_payload.get("items") or {})
    exchange_payload = expect_success(
        client.post("/api/shop/exchange", json={"item_id": shop_item["item_id"]}),
        f"活动商店兑换 {shop_item['name']}"
    )
    if not exchange_payload.get("reward"):
        fail(f"商店兑换没有返回奖励: {exchange_payload}")

    run_battle_until_exclusive_skill(client, character_id, attribute_type)

    inventory_payload = expect_success(client.get("/api/inventory"), "读取背包")
    inventory = inventory_payload.get("inventory") or {}
    if not inventory.get("weapons") or not inventory.get("equipment"):
        fail("背包没有包含制作/兑换后的武器或装备")
    ok("第5阶段端到端验收全部通过")
    print(f"[INFO] isolated_db={DB_PATH}")


if __name__ == "__main__":
    main()
