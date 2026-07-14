"""
API璺敱
瀹炵幇RESTful API鎺ュ彛
"""

import json
import logging
import random
from pathlib import Path
from flask import Blueprint, request, jsonify, session
from sqlalchemy.orm.attributes import flag_modified
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

# 閰嶇疆鏃ュ織
logger = logging.getLogger(__name__)
from ..player.auth import AuthSystem
from ..player.player import PlayerManager
from ..rewards.material import MAX_CHARACTER_EXP_CRYSTALS, MaterialBag, Material, MaterialType
from ..rewards.gacha import GachaSystem, GachaPool, GachaPoolType
from ..rewards.crafting import CraftingSystem
from ..rewards.exchange import ExchangeSystem
from ..database import get_database
from ..database.models.material import MaterialModel
from ..database.models.material_transaction import MaterialTransactionModel
from ..database.models.shop_purchase import ShopPurchaseModel
from ..database.models.character import CharacterModel
from ..database.models.player import PlayerModel
from ..database.models.battle_soul import BattleSoulModel
from ..database.models.gacha import GachaHistoryModel, GachaStateModel
from ..database.models.multiplayer import MultiplayerRoomChatModel, MultiplayerRoomInvitationModel, MultiplayerRoomModel
from ..database.models.world_boss import (
    WorldBossAnnouncementModel,
    WorldBossChestModel,
    WorldBossDamageRecordModel,
    WorldBossLayerHistoryModel,
    WorldBossLayerProgressModel,
    WorldBossRankingModel,
    WorldBossSeasonModel,
    WorldBossSettlementModel,
)
from ..characters.leveling import (
    MAX_CHARACTER_LEVEL,
    TOTAL_EXP_TO_MAX_LEVEL,
    apply_character_exp,
    get_exp_for_next_level,
    get_exp_progress,
    get_exp_required_to_level,
    get_total_exp_before_level,
)
from ..dungeons.dungeon_database import get_all_dungeons, get_dungeon_by_id
from ..dungeons.dungeon import DungeonType
from ..dungeons.multiplayer_manager import get_room_manager
from .websocket import (
    broadcast_multiplayer_chat,
    broadcast_multiplayer_invitation,
    broadcast_multiplayer_room_removed,
    broadcast_multiplayer_room_update,
    broadcast_multiplayer_rooms,
)
from ..social.friend_system import get_friend_system
from ..events.event_system import event_rotation_manager, shop_inventory
from ..game.quest_system import QuestSystem, QuestType, QuestStatus
from ..game.achievement_system import AchievementSystem, AchievementCategory
from ..rewards.equipment_enhancement import EquipmentEnhancementSystem, EnhancementType
import uuid

api_bp = Blueprint('api', __name__)
room_manager = get_room_manager()
GACHA_STATE_FILE = Path(__file__).resolve().parents[2] / "data" / "gacha_state.json"
UP_POOL_CONFIG_FILE = Path(__file__).resolve().parents[2] / "data" / "up_pool_config.json"
EXCLUSIVE_WEAPON_TEMPLATE_FILE = Path(__file__).resolve().parents[2] / "data" / "exclusive_weapon_skill_templates.json"
GACHA_PITY_THRESHOLD = 50
GACHA_HISTORY_LIMIT = 30
EXCLUSIVE_WEAPON_BASE_MAX_LEVEL = 5
EXCLUSIVE_WEAPON_MAX_BREAKTHROUGH = 3
EXCLUSIVE_WEAPON_UPGRADE_COSTS = [
    40, 80, 160, 320, 480,
    640, 800, 1000, 1200, 1400,
    1700, 2000, 2400, 2800, 3200,
    3700, 4200, 4800, 5400, 6000
]
EXCLUSIVE_WEAPON_BREAKTHROUGH_COSTS = [120, 240, 480]
DEFAULT_UP_POOL_CONFIG = {
    "pool_type": "UP_POOL",
    "up_rate": 0.5,
    "up_character_names": ["han_lan", "light_magic_ranged_dps", "dark_physical_melee_dps"],
    "title": "Initial UP Pool",
    "description": "UP characters have a 50 percent featured rate; misses draw from the full character pool."
}
DEFAULT_EXCLUSIVE_WEAPON_TEMPLATES = {
    "physical_dps": {
        "template_key": "physical_dps",
        "name": "Exclusive Combo",
        "description": "Physical exclusive weapon skill template for single-target burst.",
        "cooldown": 10,
        "damage_multiplier": 1.8,
        "physical_damage_ratio": 0.85,
        "magical_damage_ratio": 0.15,
        "target_type": "SINGLE",
        "target_count": 1,
        "is_heal": False,
        "heal_ratio": 0,
        "effect_tags": ["exclusive_weapon", "physical"],
        "impact_hint": "Adds one physical burst hit from the exclusive weapon."
    },
    "magic_dps": {
        "template_key": "magic_dps",
        "name": "Arcane Resonance",
        "description": "Magic exclusive weapon skill template for single-target burst.",
        "cooldown": 10,
        "damage_multiplier": 1.8,
        "physical_damage_ratio": 0.15,
        "magical_damage_ratio": 0.85,
        "target_type": "SINGLE",
        "target_count": 1,
        "is_heal": False,
        "heal_ratio": 0,
        "effect_tags": ["exclusive_weapon", "magic"],
        "impact_hint": "Triggers arcane resonance from the exclusive weapon."
    },
    "tank": {
        "template_key": "tank",
        "name": "Guardian Counter",
        "description": "Tank exclusive weapon skill template with stable cooldown.",
        "cooldown": 12,
        "damage_multiplier": 1.25,
        "physical_damage_ratio": 0.5,
        "magical_damage_ratio": 0.5,
        "target_type": "SINGLE",
        "target_count": 1,
        "is_heal": False,
        "heal_ratio": 0,
        "effect_tags": ["exclusive_weapon", "guard"],
        "impact_hint": "Releases a guardian counter."
    },
    "healer": {
        "template_key": "healer",
        "name": "Renewal Prayer",
        "description": "Healer exclusive weapon skill template for party healing.",
        "cooldown": 12,
        "damage_multiplier": 0,
        "physical_damage_ratio": 0,
        "magical_damage_ratio": 0,
        "target_type": "ALL",
        "target_count": 5,
        "is_heal": True,
        "heal_ratio": 1.1,
        "effect_tags": ["exclusive_weapon", "heal"],
        "impact_hint": "Releases renewal prayer."
    },
    "support": {
        "template_key": "support",
        "name": "Tactical Order",
        "description": "Support exclusive weapon skill template for light area pressure.",
        "cooldown": 12,
        "damage_multiplier": 1.05,
        "physical_damage_ratio": 0.35,
        "magical_damage_ratio": 0.65,
        "target_type": "ALL",
        "target_count": 5,
        "is_heal": False,
        "heal_ratio": 0,
        "effect_tags": ["exclusive_weapon", "support"],
        "impact_hint": "Issues a tactical order."
    }
}
# 棰勫畾涔夎鑹茬殑璇︾粏鎻忚堪
PREDEFINED_CHARACTER_DESCRIPTIONS = {
    "han_lan": "A water attribute character bound to a cold blade from the sea.",
    "寒澜": "A water attribute character bound to a cold blade from the sea."
}

# Character numbering system.
def get_character_number(attribute, profession) -> int:
    """
    鏍规嵁灞炴€у拰鑱屼笟璁＄畻瑙掕壊缂栧彿
    
    Args:
        attribute: 灞炴€х被鍨?(AttributeType)
        profession: 鑱屼笟绫诲瀷 (ProfessionType)
        
    Returns:
        瑙掕壊缂栧彿 (1-64)
    """
    from ..attributes.attribute import AttributeType
    from ..classes.profession import ProfessionType
    
    # 灞炴€ч『搴忥細姘淬€佸湡銆侀浄銆侀銆佺伀銆佹湪銆佸厜銆佹殫
    attribute_order = [
        AttributeType.WATER,   # 0
        AttributeType.EARTH,   # 1
        AttributeType.THUNDER, # 2
        AttributeType.WIND,    # 3
        AttributeType.FIRE,    # 4
        AttributeType.WOOD,    # 5
        AttributeType.LIGHT,   # 6
        AttributeType.DARK     # 7
    ]
    
    profession_order = [
        ProfessionType.PHYSICAL_TANK,      # 0
        ProfessionType.MAGIC_TANK,         # 1
        ProfessionType.PHYSICAL_MELEE_DPS, # 2
        ProfessionType.MAGIC_MELEE_DPS,    # 3
        ProfessionType.PHYSICAL_RANGED_DPS,# 4
        ProfessionType.MAGIC_RANGED_DPS,   # 5
        ProfessionType.HEALER,             # 6
        ProfessionType.SUPPORT             # 7
    ]
    
    attr_index = attribute_order.index(attribute)
    prof_index = profession_order.index(profession)
    
    # 缂栧彿 = (灞炴€х储寮?* 8) + (瀹氫綅绱㈠紩 + 1)
    return (attr_index * 8) + (prof_index + 1)


def generate_all_characters(version):
    """Docstring."""
    from ..characters.character import Character
    from ..classes.profession import get_profession, ProfessionType
    from ..attributes.attribute import Attribute, AttributeType

    attribute_order = [
        AttributeType.WATER,
        AttributeType.EARTH,
        AttributeType.THUNDER,
        AttributeType.WIND,
        AttributeType.FIRE,
        AttributeType.WOOD,
        AttributeType.LIGHT,
        AttributeType.DARK,
    ]
    profession_order = [
        ProfessionType.PHYSICAL_TANK,
        ProfessionType.MAGIC_TANK,
        ProfessionType.PHYSICAL_MELEE_DPS,
        ProfessionType.MAGIC_MELEE_DPS,
        ProfessionType.PHYSICAL_RANGED_DPS,
        ProfessionType.MAGIC_RANGED_DPS,
        ProfessionType.HEALER,
        ProfessionType.SUPPORT,
    ]

    characters = []
    for attr in attribute_order:
        for prof in profession_order:
            char_number = get_character_number(attr, prof)
            if attr == AttributeType.WATER and prof == ProfessionType.PHYSICAL_MELEE_DPS:
                character_id = "predefined_han_lan"
                name = "Han Lan"
            else:
                character_id = f"char_{char_number:03d}_{attr.name.lower()}_{prof.name.lower()}"
                name = f"{attr.name.title()} {prof.name.replace('_', ' ').title()}"
            characters.append(Character(
                character_id=character_id,
                name=name,
                profession=get_profession(prof),
                attribute=Attribute(attr),
                version=version,
                level=1,
                exp=0,
            ))
    return characters


def _create_default_game_version():
    from ..versions.version import GameVersion
    return GameVersion(
        version_id='v1.0',
        version_name='First Era',
        era_name='Initial Era',
        era_year=0,
        release_date=datetime.now()
    )

def _get_generated_character_pool() -> List[Any]:
    return generate_all_characters(_create_default_game_version())


def _serialize_generated_character(char: Any) -> Dict[str, Any]:
    return {
        "character_id": char.character_id,
        "name": char.name,
        "attribute_type": char.attribute.attribute_type.value,
        "profession_type": char.profession.profession_type.value,
    }


def _load_exclusive_weapon_templates() -> Dict[str, Dict[str, Any]]:
    templates = {key: dict(value) for key, value in DEFAULT_EXCLUSIVE_WEAPON_TEMPLATES.items()}
    if EXCLUSIVE_WEAPON_TEMPLATE_FILE.exists():
        try:
            with EXCLUSIVE_WEAPON_TEMPLATE_FILE.open("r", encoding="utf-8") as template_file:
                saved = json.load(template_file)
            if isinstance(saved, dict):
                saved_templates = saved.get("templates", saved)
                if isinstance(saved_templates, dict):
                    for key, value in saved_templates.items():
                        if isinstance(value, dict):
                            merged = dict(templates.get(key, {}))
                            merged.update(value)
                            merged["template_key"] = key
                            templates[key] = _normalize_exclusive_weapon_template(merged)
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            logger.warning("exclusive weapon template load failed; using defaults", exc_info=True)
    return {key: _normalize_exclusive_weapon_template(value) for key, value in templates.items()}


def _save_exclusive_weapon_templates(templates: Dict[str, Dict[str, Any]]) -> None:
    EXCLUSIVE_WEAPON_TEMPLATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    normalized = {
        key: _normalize_exclusive_weapon_template(value)
        for key, value in templates.items()
        if isinstance(value, dict)
    }
    with EXCLUSIVE_WEAPON_TEMPLATE_FILE.open("w", encoding="utf-8") as template_file:
        json.dump({"templates": normalized}, template_file, ensure_ascii=False, indent=2)


def _normalize_exclusive_weapon_template(template: Dict[str, Any]) -> Dict[str, Any]:
    key = str(template.get("template_key") or "").strip()
    effect_tags = template.get("effect_tags", [])
    if isinstance(effect_tags, str):
        effect_tags = [tag.strip() for tag in effect_tags.split(",") if tag.strip()]
    if not isinstance(effect_tags, list):
        effect_tags = []
    return {
        "template_key": key,
        "name": str(template.get("name") or "Exclusive Skill"),
        "description": str(template.get("description") or ""),
        "cooldown": max(1.0, float(template.get("cooldown", 10) or 10)),
        "damage_multiplier": max(0.0, float(template.get("damage_multiplier", 1.5) or 0)),
        "physical_damage_ratio": max(0.0, float(template.get("physical_damage_ratio", 0.5) or 0)),
        "magical_damage_ratio": max(0.0, float(template.get("magical_damage_ratio", 0.5) or 0)),
        "target_type": "ALL" if str(template.get("target_type", "SINGLE")).upper() == "ALL" else "SINGLE",
        "target_count": max(1, int(template.get("target_count", 1) or 1)),
        "is_heal": bool(template.get("is_heal", False)),
        "heal_ratio": max(0.0, float(template.get("heal_ratio", 0) or 0)),
        "effect_tags": [str(tag) for tag in effect_tags if str(tag).strip()],
        "impact_hint": str(template.get("impact_hint") or "")
    }


def _exclusive_weapon_template_key_for_profession(profession_type: Optional[str]) -> str:
    text = str(profession_type or "").lower()
    if "healer" in text or "娌荤枟" in text:
        return "healer"
    if "support" in text or "杈呭姪" in text:
        return "support"
    if "tank" in text or "鍧﹀厠" in text:
        return "tank"
    if "magic" in text or "娉曠郴" in text:
        return "magic_dps"
    return "physical_dps"


def _build_exclusive_weapon_skill_template(character_model: CharacterModel) -> Dict[str, Any]:
    templates = _load_exclusive_weapon_templates()
    template_key = _exclusive_weapon_template_key_for_profession(character_model.profession_type)
    template = dict(templates.get(template_key) or templates["physical_dps"])
    template["template_key"] = template_key
    return template


def _serialize_materials(materials) -> Dict[str, Dict[str, Any]]:
    """Docstring."""
    result: Dict[str, Dict[str, Any]] = {}
    for material in materials:
        key = f"{material.material_type}_{material.attribute_type or ''}"
        result[key] = {
            'material_type': material.material_type,
            'attribute_type': material.attribute_type,
            'count': material.count
        }
    return result


def _material_model_to_inventory_item(material: MaterialModel) -> Dict[str, Any]:
    attr_suffix = f" ({material.attribute_type})" if material.attribute_type else ""
    return {
        'item_id': material.material_id,
        'player_id': material.player_id,
        'item_type': 'material',
        'item_subtype': material.material_type,
        'item_name': f"{material.material_type}{attr_suffix}",
        'item_data': {
            'material_type': material.material_type,
            'attribute_type': material.attribute_type
        },
        'count': material.count,
        'level': 0,
        'is_locked': False,
        'is_equipped': False
    }


def _get_player_materials(player_id: str) -> Dict[str, Dict[str, Any]]:
    """Docstring."""
    db = get_database()
    db_session = db.get_session()
    try:
        materials = db_session.query(MaterialModel).filter(
            MaterialModel.player_id == player_id
        ).all()
        return _serialize_materials(materials)
    finally:
        db_session.close()


def _get_character_exp_crystal_total(player_id: str, db_session=None) -> int:
    owns_session = db_session is None
    if owns_session:
        db = get_database()
        db_session = db.get_session()
    try:
        total = sum(
            row.count for row in db_session.query(MaterialModel).filter(
                MaterialModel.player_id == player_id,
                MaterialModel.material_type == MaterialType.CHARACTER_EXP.value
            ).all()
        )
        return min(total, MAX_CHARACTER_EXP_CRYSTALS)
    finally:
        if owns_session:
            db_session.close()


def _parse_attribute_type(value: Optional[str]):
    if not value:
        return None
    from ..attributes.attribute import AttributeType
    if isinstance(value, AttributeType):
        return value
    try:
        return AttributeType[value]
    except KeyError:
        try:
            return AttributeType(value)
        except ValueError:
            return None


def _normalize_shop_cost_type(cost_type: str) -> Optional[MaterialType]:
    mapping = {
        'exclusive_material': MaterialType.EXCLUSIVE_ITEM,
        'exclusive_item': MaterialType.EXCLUSIVE_ITEM,
        'equipment_material': MaterialType.EQUIPMENT_SET,
        'equipment_set': MaterialType.EQUIPMENT_SET,
        'illustration_piece': MaterialType.ILLUSTRATION_PIECE,
        'character_exp': MaterialType.CHARACTER_EXP,
        'experience': MaterialType.CHARACTER_EXP,
    }
    return mapping.get(cost_type)


def _current_shop_period_key() -> str:
    now = datetime.utcnow()
    return f"{now.year:04d}-{now.month:02d}"


def _get_shop_limit(item_id: str) -> int:
    if item_id.startswith('equip_'):
        return 3
    if item_id.startswith('material_'):
        return 10
    return 0


def _get_shop_purchase_count(player_id: str, item_id: str, period_key: Optional[str] = None) -> int:
    period_key = period_key or _current_shop_period_key()
    db = get_database()
    db_session = db.get_session()
    try:
        record = db_session.query(ShopPurchaseModel).filter(
            ShopPurchaseModel.player_id == player_id,
            ShopPurchaseModel.item_id == item_id,
            ShopPurchaseModel.period_key == period_key
        ).first()
        return record.purchase_count if record else 0
    finally:
        db_session.close()


def _record_shop_purchase(player_id: str, item_id: str, period_key: Optional[str] = None) -> int:
    period_key = period_key or _current_shop_period_key()
    db = get_database()
    db_session = db.get_session()
    try:
        record = db_session.query(ShopPurchaseModel).filter(
            ShopPurchaseModel.player_id == player_id,
            ShopPurchaseModel.item_id == item_id,
            ShopPurchaseModel.period_key == period_key
        ).first()
        if record:
            record.purchase_count += 1
        else:
            record = ShopPurchaseModel(
                purchase_id=str(uuid.uuid4()),
                player_id=player_id,
                item_id=item_id,
                period_key=period_key,
                purchase_count=1
            )
            db_session.add(record)
        db_session.commit()
        return record.purchase_count
    finally:
        db_session.close()


def _build_shop_item_payload(player_id: str, item) -> Dict[str, Any]:
    payload = item.to_dict()
    period_key = _current_shop_period_key()
    limit = _get_shop_limit(item.item_id)
    purchased = _get_shop_purchase_count(player_id, item.item_id, period_key)
    payload['period_key'] = period_key
    payload['purchase_limit'] = limit
    payload['purchased_count'] = purchased
    payload['remaining_count'] = max(limit - purchased, 0) if limit else None
    return payload


def _spend_material_costs(player_id: str, costs: Dict[str, int], attribute_type=None) -> bool:
    from ..rewards.material_storage import MaterialStorage
    spent: List[tuple] = []
    for cost_type, amount in costs.items():
        material_type = _normalize_shop_cost_type(cost_type)
        if not material_type or amount <= 0:
            continue
        cost_attribute = attribute_type if material_type == MaterialType.EQUIPMENT_SET else None
        if not MaterialStorage.remove_material(
            player_id,
            material_type,
            cost_attribute,
            amount,
            source="shop",
            description="娲诲姩鍟嗗簵鍏戞崲"
        ):
            for spent_type, spent_attr, spent_amount in spent:
                MaterialStorage.save_material(
                    player_id,
                    spent_type,
                    spent_attr,
                    spent_amount,
                    source="shop_refund",
                    description="鍏戞崲澶辫触杩旇繕"
                )
            return False
        spent.append((material_type, cost_attribute, amount))
    return True


def _remove_material_any_attribute(
    player_id: str,
    material_type: MaterialType,
    count: int,
    source: str = "system",
    description: str = ""
) -> bool:
    db = get_database()
    db_session = db.get_session()
    spent: List[tuple] = []
    remaining = count
    try:
        rows = db_session.query(MaterialModel).filter(
            MaterialModel.player_id == player_id,
            MaterialModel.material_type == material_type.value
        ).order_by(MaterialModel.attribute_type.asc()).all()
        for row in rows:
            if remaining <= 0:
                break
            used = min(row.count, remaining)
            row.count -= used
            remaining -= used
            spent.append((row, used))
        if remaining > 0:
            db_session.rollback()
            return False
        for row in rows:
            if row.count <= 0:
                db_session.delete(row)
        for row, used in spent:
            db_session.add(MaterialTransactionModel(
                transaction_id=str(uuid.uuid4()),
                player_id=player_id,
                material_type=material_type.value,
                attribute_type=row.attribute_type,
                transaction_type="spend",
                amount=-used,
                balance_after=max(row.count, 0),
                source=source,
                description=description
            ))
        db_session.commit()
        return True
    except Exception:
        db_session.rollback()
        return False
    finally:
        db_session.close()


def _remove_material_any_attribute_with_session(
    db_session,
    player_id: str,
    material_type: MaterialType,
    count: int,
    source: str = "system",
    description: str = ""
) -> bool:
    spent: List[tuple] = []
    remaining = count
    rows = db_session.query(MaterialModel).filter(
        MaterialModel.player_id == player_id,
        MaterialModel.material_type == material_type.value
    ).order_by(MaterialModel.attribute_type.asc()).all()
    for row in rows:
        if remaining <= 0:
            break
        used = min(row.count, remaining)
        row.count -= used
        remaining -= used
        spent.append((row, used))
    if remaining > 0:
        return False
    for row in rows:
        if row.count <= 0:
            db_session.delete(row)
    for row, used in spent:
        db_session.add(MaterialTransactionModel(
            transaction_id=str(uuid.uuid4()),
            player_id=player_id,
            material_type=material_type.value,
            attribute_type=row.attribute_type,
            transaction_type="spend",
            amount=-used,
            balance_after=max(row.count, 0),
            source=source,
            description=description
        ))
    return True


def _create_shop_equipment(player_id: str, attribute_type) -> Dict[str, Any]:
    from ..inventory.inventory import InventoryManager, ItemType
    from ..characters.equipment import Equipment, EquipmentSlot
    inventory = InventoryManager.get_inventory(player_id)
    equipment = Equipment(
        equipment_id=f"shop_{attribute_type.name.lower()}_{uuid.uuid4().hex[:8]}",
        name=f"{attribute_type.name.title()} Event Gear Box",
        slot=EquipmentSlot.ACCESSORY,
        hp_bonus=120,
        attack_bonus=60,
        defense_bonus=60,
        magic_attack_bonus=60,
        magic_defense_bonus=60,
        description="Accessory obtained from the event shop.",
    )
    item_data = equipment.to_dict()
    item_data['attribute_type'] = attribute_type.value
    item_data['quality'] = 'rare'
    item = inventory.add_item(
        item_type=ItemType.EQUIPMENT,
        item_name=equipment.name,
        item_data=item_data,
        item_subtype="equipment_set"
    )
    return item.to_dict()


def _load_player_username(player_id: str) -> Optional[str]:
    player = PlayerManager.get_player_by_id(player_id)
    return player.username if player else None


def _validate_player_characters(player_id: str, character_ids: List[str]) -> bool:
    if not character_ids:
        return False
    db = get_database()
    session_db = db.get_session()
    try:
        count = session_db.query(CharacterModel).filter(
            CharacterModel.player_id == player_id,
            CharacterModel.character_id.in_(character_ids)
        ).count()
        return count == len(character_ids)
    finally:
        session_db.close()


def _load_battle_soul_data(player_id: str, gacha_system: GachaSystem) -> None:
    """
    浠庢暟鎹簱鍔犺浇鎴橀瓊鏁版嵁鍒?GachaSystem
    
    Args:
        player_id: 鐜╁ID
        gacha_system: GachaSystem 瀹炰緥
    """
    db = get_database()
    db_session = db.get_session()
    try:
        from ..attributes.attribute import AttributeType
        
        try:
            battle_soul_models = db_session.query(BattleSoulModel).filter(
                BattleSoulModel.player_id == player_id
            ).all()
            
            for model in battle_soul_models:
                try:
                    attribute_type = AttributeType(model.attribute_type)
                    gacha_system.essence[attribute_type] = model.essence_count
                    gacha_system.battle_soul[attribute_type] = model.level
                except (ValueError, KeyError) as e:
                    # 濡傛灉灞炴€х被鍨嬫棤鏁堬紝璺宠繃杩欐潯璁板綍
                    continue
        except Exception as e:
            # 濡傛灉琛ㄤ笉瀛樺湪鎴栧叾浠栨暟鎹簱閿欒锛屽拷鐣ワ紙浣跨敤榛樿鍊硷級
            pass
    finally:
        db_session.close()


def _save_battle_soul_data(player_id: str, gacha_system: GachaSystem) -> None:
    """
    灏?GachaSystem 涓殑鎴橀瓊鏁版嵁淇濆瓨鍒版暟鎹簱
    
    Args:
        player_id: 鐜╁ID
        gacha_system: GachaSystem 瀹炰緥
    """
    db = get_database()
    db_session = db.get_session()
    try:
        from ..attributes.attribute import AttributeType
        
        all_attributes = [
            AttributeType.WATER, AttributeType.EARTH, AttributeType.THUNDER,
            AttributeType.WIND, AttributeType.FIRE, AttributeType.WOOD,
            AttributeType.LIGHT, AttributeType.DARK
        ]
        
        try:
            for attr_type in all_attributes:
                essence_count = gacha_system.essence.get(attr_type, 0)
                level = gacha_system.battle_soul.get(attr_type, 0)
                
                model = db_session.query(BattleSoulModel).filter(
                    BattleSoulModel.player_id == player_id,
                    BattleSoulModel.attribute_type == attr_type.value
                ).first()
                
                if model:
                    model.essence_count = essence_count
                    model.level = level
                else:
                    model = BattleSoulModel(
                        player_id=player_id,
                        attribute_type=attr_type.value,
                        level=level,
                        essence_count=essence_count
                    )
                    db_session.add(model)
            
            db_session.commit()
        except Exception as e:
            db_session.rollback()
    finally:
        db_session.close()


def _load_gacha_state() -> Dict[str, Any]:
    _migrate_gacha_json_to_db()
    db = get_database()
    db_session = db.get_session()
    try:
        players: Dict[str, Any] = {}
        for state_model in db_session.query(GachaStateModel).all():
            player_state = players.setdefault(state_model.player_id, {
                "total_pulls": 0,
                "pool_counters": {},
                "history": []
            })
            player_state["pool_counters"][state_model.pool_type] = state_model.pity_counter or 0
            player_state["total_pulls"] += state_model.total_pulls or 0

        histories = db_session.query(GachaHistoryModel).order_by(
            GachaHistoryModel.created_at.desc()
        ).limit(500).all()
        for history_model in histories:
            player_state = players.setdefault(history_model.player_id, {
                "total_pulls": 0,
                "pool_counters": {},
                "history": []
            })
            if len(player_state["history"]) < GACHA_HISTORY_LIMIT:
                player_state["history"].append(history_model.to_dict())
        return {"players": players}
    finally:
        db_session.close()


def _save_gacha_state(state: Dict[str, Any]) -> None:
    return None
    # 鍏煎鏃ц皟鐢細鐜板湪鎶藉崱鐘舵€佷互鏁版嵁搴撲负鍑嗭紝涓嶅啀鍐欏洖 JSON銆?    return None


def _migrate_gacha_json_to_db() -> None:
    if not GACHA_STATE_FILE.exists():
        return
    db = get_database()
    db_session = db.get_session()
    try:
        if db_session.query(GachaStateModel).first() or db_session.query(GachaHistoryModel).first():
            return
        try:
            with GACHA_STATE_FILE.open("r", encoding="utf-8") as state_file:
                legacy = json.load(state_file)
        except (OSError, json.JSONDecodeError):
            return

        players = legacy.get("players", {}) if isinstance(legacy, dict) else {}
        for player_id, player_state in players.items():
            pool_counters = player_state.get("pool_counters", {}) if isinstance(player_state, dict) else {}
            pool_totals: Dict[str, int] = {}
            for entry in player_state.get("history", []) if isinstance(player_state, dict) else []:
                pool_type = entry.get("pool_type", "UP_POOL")
                pull_count = int(entry.get("pull_count", 0) or 0)
                pool_totals[pool_type] = pool_totals.get(pool_type, 0) + pull_count
                db_session.add(GachaHistoryModel(
                    history_id=str(uuid.uuid4()),
                    player_id=player_id,
                    pool_type=pool_type,
                    pull_count=pull_count,
                    cost=int(entry.get("cost", 0) or 0),
                    new_characters=int(entry.get("new_characters", 0) or 0),
                    duplicates=int(entry.get("duplicates", 0) or 0),
                    essence_gained=int(entry.get("essence_gained", 0) or 0),
                    pity_triggered=int(entry.get("pity_triggered", 0) or 0),
                    result_data=entry.get("results", [])
                ))
            for pool_type, pity_counter in pool_counters.items():
                db_session.add(GachaStateModel(
                    state_id=str(uuid.uuid4()),
                    player_id=player_id,
                    pool_type=pool_type,
                    pity_counter=int(pity_counter or 0),
                    total_pulls=pool_totals.get(pool_type, 0)
                ))
        db_session.commit()
    except Exception:
        db_session.rollback()
        logger.warning("legacy gacha JSON migration failed", exc_info=True)
    finally:
        db_session.close()


def _get_gacha_player_state(state: Dict[str, Any], player_id: str) -> Dict[str, Any]:
    players = state.setdefault("players", {})
    return players.setdefault(player_id, {
        "total_pulls": 0,
        "pool_counters": {},
        "history": []
    })


def _build_gacha_pity_payload(player_state: Dict[str, Any], pool_type: str) -> Dict[str, Any]:
    current = int(player_state.get("pool_counters", {}).get(pool_type, 0) or 0)
    current = max(0, min(current, GACHA_PITY_THRESHOLD))
    return {
        "pool_type": pool_type,
        "current": current,
        "threshold": GACHA_PITY_THRESHOLD,
        "remaining": max(0, GACHA_PITY_THRESHOLD - current),
        "next_guaranteed": current >= GACHA_PITY_THRESHOLD - 1,
        "description": f"After {GACHA_PITY_THRESHOLD} pulls in the same pool, one missing character is guaranteed when available."
    }


def _load_up_pool_config() -> Dict[str, Any]:
    if UP_POOL_CONFIG_FILE.exists():
        try:
            with UP_POOL_CONFIG_FILE.open("r", encoding="utf-8") as config_file:
                config = json.load(config_file)
                if isinstance(config, dict):
                    merged = dict(DEFAULT_UP_POOL_CONFIG)
                    merged.update(config)
                    merged["up_rate"] = min(0.95, max(0.0, float(merged.get("up_rate", 0.5))))
                    merged["up_character_names"] = [
                        str(name) for name in merged.get("up_character_names", [])
                        if str(name).strip()
                    ]
                    return merged
        except (OSError, json.JSONDecodeError, ValueError):
            logger.warning("UP pool config load failed; using defaults", exc_info=True)
    return dict(DEFAULT_UP_POOL_CONFIG)


def _save_up_pool_config(config: Dict[str, Any]) -> None:
    UP_POOL_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    merged = dict(DEFAULT_UP_POOL_CONFIG)
    merged.update(config)
    merged["up_rate"] = min(0.95, max(0.0, float(merged.get("up_rate", 0.5))))
    merged["up_character_names"] = [
        str(name) for name in merged.get("up_character_names", [])
        if str(name).strip()
    ]
    with UP_POOL_CONFIG_FILE.open("w", encoding="utf-8") as config_file:
        json.dump(merged, config_file, ensure_ascii=False, indent=2)


def _build_up_pool_payload(all_characters: Optional[List[Any]] = None) -> Dict[str, Any]:
    config = _load_up_pool_config()
    up_names = config.get("up_character_names", [])
    up_characters = []
    if all_characters is not None:
        up_name_set = set(up_names)
        up_characters = [
            _serialize_generated_character(char)
            for char in all_characters
            if char.name in up_name_set
        ]
    return {
        "pool_type": "UP_POOL",
        "title": config.get("title", "UP Pool"),
        "description": config.get("description", ""),
        "up_rate": config.get("up_rate", 0.5),
        "up_character_names": up_names,
        "up_characters": up_characters
    }


def _summarize_gacha_result(result) -> Dict[str, Any]:
    char = result.character
    return {
        "name": char.name,
        "character_id": char.character_id,
        "attribute_type": char.attribute.attribute_type.value,
        "profession_type": char.profession.profession_type.value,
        "is_duplicate": result.is_duplicate,
        "essence_gained": result.essence_gained
    }


def _record_gacha_pull(
    player_id: str,
    pool_type: str,
    pull_count: int,
    cost: int,
    results: List[Any],
    new_characters_count: int,
    essence_gained_total: int,
    pity_counter: int,
    pity_triggered: int
) -> Dict[str, Any]:
    _migrate_gacha_json_to_db()
    db = get_database()
    db_session = db.get_session()
    try:
        state_model = db_session.query(GachaStateModel).filter(
            GachaStateModel.player_id == player_id,
            GachaStateModel.pool_type == pool_type
        ).first()
        if not state_model:
            state_model = GachaStateModel(
                state_id=str(uuid.uuid4()),
                player_id=player_id,
                pool_type=pool_type,
                pity_counter=0,
                total_pulls=0
            )
            db_session.add(state_model)

        state_model.pity_counter = pity_counter
        state_model.total_pulls = int(state_model.total_pulls or 0) + pull_count
        history_model = GachaHistoryModel(
            history_id=str(uuid.uuid4()),
            player_id=player_id,
            pool_type=pool_type,
            pull_count=pull_count,
            cost=cost,
            new_characters=new_characters_count,
            duplicates=pull_count - new_characters_count,
            essence_gained=essence_gained_total,
            pity_triggered=pity_triggered,
            result_data=[_summarize_gacha_result(result) for result in results]
        )
        db_session.add(history_model)
        db_session.commit()

        total_pulls = sum(
            row.total_pulls or 0
            for row in db_session.query(GachaStateModel).filter(
                GachaStateModel.player_id == player_id
            ).all()
        )
        history = [
            history.to_dict()
            for history in db_session.query(GachaHistoryModel).filter(
                GachaHistoryModel.player_id == player_id
            ).order_by(GachaHistoryModel.created_at.desc()).limit(GACHA_HISTORY_LIMIT).all()
        ]
        player_state = {
            "total_pulls": total_pulls,
            "pool_counters": {pool_type: pity_counter},
            "history": history
        }
        return {
            "total_pulls": total_pulls,
            "pity": _build_gacha_pity_payload(player_state, pool_type),
            "history": history
        }
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()


def _get_max_essence_needed() -> int:
    """Return max essence needed for gacha battle soul upgrades."""
    from ..rewards.gacha import GachaSystem
    return GachaSystem.get_max_essence_needed()


def _multiplayer_requirements(dungeon) -> Dict[str, int]:
    if dungeon.dungeon_type == DungeonType.SQUAD:
        return {"capacity": 5, "max_characters_per_member": 1}
    if dungeon.dungeon_type == DungeonType.TEAM:
        return {"capacity": 4, "max_characters_per_member": 5}
    if dungeon.dungeon_type == DungeonType.SERVER_BOSS:
        return {"capacity": 1, "max_characters_per_member": 20}
    return {"capacity": 1, "max_characters_per_member": 1}


def _cleanup_multiplayer_rooms_and_broadcast():
    cleanup = room_manager.cleanup_expired_disconnects()
    for room in cleanup.get("updated_rooms", []):
        broadcast_multiplayer_room_update(room.to_dict(), event_type="member_timeout")
    for room_id in cleanup.get("removed_room_ids", []):
        broadcast_multiplayer_room_removed(str(room_id))
    return cleanup


def _build_multiplayer_invitation_payload(db_session, invitation: MultiplayerRoomInvitationModel) -> Dict[str, Any]:
    payload = invitation.to_dict()
    inviter = db_session.query(PlayerModel).filter(
        PlayerModel.player_id == invitation.inviter_id
    ).first()
    room = room_manager.get_room(invitation.room_id)
    room_model = None
    if not room:
        room_model = db_session.query(MultiplayerRoomModel).filter(
            MultiplayerRoomModel.room_id == invitation.room_id
        ).first()

    dungeon_id = room.dungeon_id if room else (room_model.dungeon_id if room_model else None)
    dungeon = get_dungeon_by_id(dungeon_id) if dungeon_id else None
    payload.update({
        "inviter_username": inviter.username if inviter else "鏈煡鐜╁",
        "room": room.to_dict() if room else None,
        "dungeon": {
            "dungeon_id": dungeon.dungeon_id,
            "name": dungeon.name,
            "dungeon_type": dungeon.dungeon_type.value,
            "attribute_type": dungeon.attribute_type.value,
            "difficulty": dungeon.difficulty.value,
        } if dungeon else None,
        "is_available": bool(room and room.status == "waiting" and invitation.status == "pending"),
    })
    return payload


def _get_world_boss_season_id(now: Optional[datetime] = None) -> str:
    """Docstring."""
    now = now or datetime.utcnow()
    iso_year, iso_week, _ = now.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _get_world_boss_season_bounds(now: Optional[datetime] = None) -> tuple[datetime, datetime]:
    now = now or datetime.utcnow()
    week_start = now - timedelta(days=now.weekday())
    week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    return week_start, week_start + timedelta(days=7)


def _estimate_world_boss_damage(duration: float, character_count: int, dungeon, success: bool = False) -> int:
    """Docstring."""
    max_duration = max(float(getattr(dungeon, "duration", 180.0) or 180.0), 1.0)
    duration_ratio = min(max(float(duration or 0.0) / max_duration, 0.0), 1.0)
    roster_factor = max(1, int(character_count or 1))
    difficulty_multiplier = float(getattr(dungeon, "get_monster_multiplier", lambda: 1.0)())
    clear_bonus = 1.15 if success else 1.0
    return max(1, int(round(10000 * duration_ratio * roster_factor * difficulty_multiplier * clear_bonus)))


WORLD_BOSS_LAYER_BASE_HP = 100_000
WORLD_BOSS_LAYER_HP_STEP = 10_000
WORLD_BOSS_LAYER_MILESTONE_INTERVAL = 50
WORLD_BOSS_MILESTONE_FRAGMENT_REWARD = 10
WORLD_BOSS_FULL_ILLUSTRATION_PIECES = 100
WORLD_BOSS_CHEST_REWARD_TABLE = {
    1: [(1, 0.78), (2, 0.17), (5, 0.045), ("full_illustration", 0.005)],
    2: [(1, 0.68), (2, 0.22), (5, 0.085), ("full_illustration", 0.015)],
    3: [(1, 0.56), (2, 0.29), (5, 0.12), ("full_illustration", 0.03)],
    4: [(1, 0.44), (2, 0.34), (5, 0.17), ("full_illustration", 0.05)],
    5: [(1, 0.32), (2, 0.38), (5, 0.22), ("full_illustration", 0.08)],
}


def _create_world_boss_announcement_with_session(
    db_session,
    announcement_type: str,
    title: str,
    message: str,
    season_id: Optional[str] = None,
    dungeon_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> WorldBossAnnouncementModel:
    announcement = WorldBossAnnouncementModel(
        announcement_id=str(uuid.uuid4()),
        season_id=season_id,
        dungeon_id=dungeon_id,
        announcement_type=announcement_type,
        title=title,
        message=message,
        payload=payload or {},
    )
    db_session.add(announcement)
    return announcement


def _ensure_world_boss_season_with_session(db_session, season_id: Optional[str] = None, now: Optional[datetime] = None) -> WorldBossSeasonModel:
    now = now or datetime.utcnow()
    season_id = season_id or _get_world_boss_season_id(now)
    season = db_session.query(WorldBossSeasonModel).filter(
        WorldBossSeasonModel.season_id == season_id
    ).first()
    if season:
        if season.status != "active":
            season.status = "active"
            season.updated_at = now
        return season

    starts_at, ends_at = _get_world_boss_season_bounds(now)
    season = WorldBossSeasonModel(
        season_uid=str(uuid.uuid4()),
        season_id=season_id,
        status="active",
        started_at=starts_at,
        ends_at=ends_at,
    )
    db_session.add(season)
    _create_world_boss_announcement_with_session(
        db_session,
        "season_started",
        "World boss season started",
        f"Season {season_id} has started. Global layer progress has been reset.",
        season_id=season_id,
        payload={"season_id": season_id},
    )
    return season


def _get_world_boss_season_payload(season_id: Optional[str] = None) -> Dict[str, Any]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        season = _ensure_world_boss_season_with_session(db_session, season_id)
        db_session.commit()
        return season.to_dict()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()


def _get_world_boss_announcements(
    season_id: Optional[str] = None,
    dungeon_id: Optional[str] = None,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        query = db_session.query(WorldBossAnnouncementModel).filter(
            (WorldBossAnnouncementModel.season_id == season_id) | (WorldBossAnnouncementModel.season_id.is_(None))
        )
        if dungeon_id:
            query = query.filter(
                (WorldBossAnnouncementModel.dungeon_id == dungeon_id) | (WorldBossAnnouncementModel.dungeon_id.is_(None))
            )
        rows = query.order_by(WorldBossAnnouncementModel.created_at.desc()).limit(limit).all()
        return [row.to_dict() for row in rows]
    finally:
        db_session.close()


def _get_world_boss_layer_history(dungeon_id: str, season_id: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        rows = db_session.query(WorldBossLayerHistoryModel).filter(
            WorldBossLayerHistoryModel.dungeon_id == dungeon_id,
            WorldBossLayerHistoryModel.season_id == season_id,
        ).order_by(WorldBossLayerHistoryModel.layer.desc()).limit(limit).all()
        return [row.to_dict() for row in rows]
    finally:
        db_session.close()


def run_world_boss_season_maintenance(now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.utcnow()
    current_season_id = _get_world_boss_season_id(now)
    db = get_database()
    db_session = db.get_session()
    closed_seasons: List[str] = []
    try:
        _ensure_world_boss_season_with_session(db_session, current_season_id, now)
        stale_seasons = db_session.query(WorldBossSeasonModel).filter(
            WorldBossSeasonModel.season_id != current_season_id,
            WorldBossSeasonModel.status == "active",
        ).all()
        for season in stale_seasons:
            season.status = "settling"
            season.updated_at = now
            closed_seasons.append(season.season_id)
        db_session.commit()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()

    season_summaries: Dict[str, Any] = {}
    server_boss_dungeons = [
        dungeon for dungeon in get_all_dungeons(include_difficulties=True)
        if dungeon.dungeon_type == DungeonType.SERVER_BOSS
    ]
    for old_season_id in closed_seasons:
        dungeon_results: List[Dict[str, Any]] = []
        for dungeon in server_boss_dungeons:
            try:
                dungeon_results.append(settle_world_boss_rewards(dungeon.dungeon_id, old_season_id))
            except Exception as exc:
                dungeon_results.append({
                    "dungeon_id": dungeon.dungeon_id,
                    "season_id": old_season_id,
                    "error": str(exc),
                })
        season_summaries[old_season_id] = dungeon_results

        db_session = db.get_session()
        try:
            season = db_session.query(WorldBossSeasonModel).filter(
                WorldBossSeasonModel.season_id == old_season_id
            ).first()
            if season:
                season.status = "settled"
                season.settled_at = now
                season.summary_payload = {"dungeons": dungeon_results}
                season.updated_at = now
            _create_world_boss_announcement_with_session(
                db_session,
                "season_settled",
                "World boss season settled",
                f"Season {old_season_id} has been settled. Shared layer rewards were issued to eligible participants.",
                season_id=old_season_id,
                payload={"season_id": old_season_id, "dungeon_results": dungeon_results},
            )
            db_session.commit()
        except Exception:
            db_session.rollback()
            raise
        finally:
            db_session.close()

    return {
        "current_season_id": current_season_id,
        "closed_seasons": closed_seasons,
        "settlements": season_summaries,
    }


def _get_world_boss_layer_hp(layer: int) -> int:
    layer = max(1, int(layer or 1))
    return WORLD_BOSS_LAYER_BASE_HP + (layer - 1) * WORLD_BOSS_LAYER_HP_STEP


def _get_world_boss_chest_tier(layer: int) -> int:
    layer = max(1, int(layer or 1))
    return min(5, ((layer - 1) // 100) + 1)


def _get_world_boss_milestone_reward_count(cleared_layers: int) -> int:
    milestone_count = max(0, int(cleared_layers or 0)) // WORLD_BOSS_LAYER_MILESTONE_INTERVAL
    return milestone_count * WORLD_BOSS_MILESTONE_FRAGMENT_REWARD


def _world_boss_progress_to_payload(progress: Optional[WorldBossLayerProgressModel], dungeon_id: str, season_id: str) -> Dict[str, Any]:
    current_layer = int(progress.current_layer if progress else 1)
    cleared_layers = int(progress.cleared_layers if progress else 0)
    current_layer_damage = int(progress.current_layer_damage if progress else 0)
    current_layer_max_hp = _get_world_boss_layer_hp(current_layer)
    next_milestone_layer = ((cleared_layers // WORLD_BOSS_LAYER_MILESTONE_INTERVAL) + 1) * WORLD_BOSS_LAYER_MILESTONE_INTERVAL
    return {
        "progress_id": progress.progress_id if progress else None,
        "dungeon_id": dungeon_id,
        "season_id": season_id,
        "current_layer": current_layer,
        "cleared_layers": cleared_layers,
        "current_layer_damage": current_layer_damage,
        "current_layer_max_hp": current_layer_max_hp,
        "current_layer_remaining_hp": max(0, current_layer_max_hp - current_layer_damage),
        "current_layer_progress": min(1.0, current_layer_damage / current_layer_max_hp) if current_layer_max_hp else 0.0,
        "next_milestone_layer": next_milestone_layer,
        "layers_to_next_milestone": max(0, next_milestone_layer - cleared_layers),
        "milestone_fragments_available": _get_world_boss_milestone_reward_count(cleared_layers),
        "updated_at": progress.updated_at.isoformat() if progress and progress.updated_at else None,
    }


def _get_or_create_world_boss_progress_with_session(db_session, dungeon_id: str, season_id: str) -> WorldBossLayerProgressModel:
    progress = db_session.query(WorldBossLayerProgressModel).filter(
        WorldBossLayerProgressModel.dungeon_id == dungeon_id,
        WorldBossLayerProgressModel.season_id == season_id,
    ).first()
    if not progress:
        progress = WorldBossLayerProgressModel(
            progress_id=str(uuid.uuid4()),
            dungeon_id=dungeon_id,
            season_id=season_id,
            current_layer=1,
            cleared_layers=0,
            current_layer_damage=0,
        )
        db_session.add(progress)
        db_session.flush()
    return progress


def _get_world_boss_progress_payload(dungeon_id: str, season_id: Optional[str] = None) -> Dict[str, Any]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        progress = db_session.query(WorldBossLayerProgressModel).filter(
            WorldBossLayerProgressModel.dungeon_id == dungeon_id,
            WorldBossLayerProgressModel.season_id == season_id,
        ).first()
        return _world_boss_progress_to_payload(progress, dungeon_id, season_id)
    finally:
        db_session.close()


def _grant_world_boss_chests_for_layer(db_session, dungeon_id: str, season_id: str, layer: int) -> int:
    participants = db_session.query(WorldBossRankingModel).filter(
        WorldBossRankingModel.dungeon_id == dungeon_id,
        WorldBossRankingModel.season_id == season_id,
    ).all()
    tier = _get_world_boss_chest_tier(layer)
    granted = 0
    for participant in participants:
        existing = db_session.query(WorldBossChestModel).filter(
            WorldBossChestModel.dungeon_id == dungeon_id,
            WorldBossChestModel.season_id == season_id,
            WorldBossChestModel.player_id == participant.player_id,
            WorldBossChestModel.layer == layer,
        ).first()
        if existing:
            continue
        db_session.add(WorldBossChestModel(
            chest_id=str(uuid.uuid4()),
            dungeon_id=dungeon_id,
            season_id=season_id,
            player_id=participant.player_id,
            username=participant.username,
            layer=layer,
            tier=tier,
            status="unopened",
        ))
        granted += 1
    return granted


def _apply_world_boss_layer_damage(
    db_session,
    dungeon_id: str,
    season_id: str,
    damage: int,
    player_id: Optional[str] = None,
    username: Optional[str] = None,
) -> Dict[str, Any]:
    progress = _get_or_create_world_boss_progress_with_session(db_session, dungeon_id, season_id)
    progress.current_layer_damage = int(progress.current_layer_damage or 0) + max(0, int(damage or 0))
    cleared: List[Dict[str, Any]] = []
    chests_granted = 0
    while progress.current_layer_damage >= _get_world_boss_layer_hp(progress.current_layer):
        layer = int(progress.current_layer or 1)
        progress.current_layer_damage -= _get_world_boss_layer_hp(layer)
        progress.cleared_layers = max(int(progress.cleared_layers or 0), layer)
        progress.current_layer = layer + 1
        layer_chests_granted = _grant_world_boss_chests_for_layer(db_session, dungeon_id, season_id, layer)
        chests_granted += layer_chests_granted
        existing_history = db_session.query(WorldBossLayerHistoryModel).filter(
            WorldBossLayerHistoryModel.dungeon_id == dungeon_id,
            WorldBossLayerHistoryModel.season_id == season_id,
            WorldBossLayerHistoryModel.layer == layer,
        ).first()
        if not existing_history:
            db_session.add(WorldBossLayerHistoryModel(
                history_id=str(uuid.uuid4()),
                dungeon_id=dungeon_id,
                season_id=season_id,
                layer=layer,
                tier=_get_world_boss_chest_tier(layer),
                cleared_by_player_id=player_id,
                cleared_by_username=username,
                trigger_damage=max(0, int(damage or 0)),
                chests_granted=layer_chests_granted,
            ))
        if layer % WORLD_BOSS_LAYER_MILESTONE_INTERVAL == 0:
            _create_world_boss_announcement_with_session(
                db_session,
                "layer_milestone",
                "World boss milestone reached",
                f"{dungeon_id} reached layer {layer}. Shared rewards increased by {WORLD_BOSS_MILESTONE_FRAGMENT_REWARD} fragments.",
                season_id=season_id,
                dungeon_id=dungeon_id,
                payload={
                    "layer": layer,
                    "tier": _get_world_boss_chest_tier(layer),
                    "reward_fragments": _get_world_boss_milestone_reward_count(layer),
                    "cleared_by_player_id": player_id,
                    "cleared_by_username": username,
                },
            )
        cleared.append({
            "layer": layer,
            "tier": _get_world_boss_chest_tier(layer),
        })
    progress.updated_at = datetime.utcnow()
    return {
        "progress": _world_boss_progress_to_payload(progress, dungeon_id, season_id),
        "cleared_layers": cleared,
        "chests_granted": chests_granted,
    }


def _get_world_boss_chest_summary(dungeon_id: str, season_id: Optional[str], player_id: str, limit: int = 20) -> Dict[str, Any]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        base_query = db_session.query(WorldBossChestModel).filter(
            WorldBossChestModel.dungeon_id == dungeon_id,
            WorldBossChestModel.season_id == season_id,
            WorldBossChestModel.player_id == player_id,
        )
        unopened_count = base_query.filter(WorldBossChestModel.status == "unopened").count()
        opened_count = base_query.filter(WorldBossChestModel.status == "opened").count()
        latest = base_query.order_by(
            WorldBossChestModel.status.desc(),
            WorldBossChestModel.layer.desc(),
            WorldBossChestModel.created_at.desc(),
        ).limit(limit).all()
        return {
            "unopened_count": unopened_count,
            "opened_count": opened_count,
            "latest": [row.to_dict() for row in latest],
            "tier_rules": [
                {"tier": 1, "layer_range": "1-100"},
                {"tier": 2, "layer_range": "101-200"},
                {"tier": 3, "layer_range": "201-300"},
                {"tier": 4, "layer_range": "301-400"},
                {"tier": 5, "layer_range": "401+"},
            ],
            "reward_options": [
                {"type": "fragment", "count": 1},
                {"type": "fragment", "count": 2},
                {"type": "fragment", "count": 5},
                {"type": "full_illustration", "count": WORLD_BOSS_FULL_ILLUSTRATION_PIECES},
            ],
        }
    finally:
        db_session.close()


def _draw_world_boss_chest_reward(tier: int) -> Dict[str, Any]:
    tier = min(5, max(1, int(tier or 1)))
    table = WORLD_BOSS_CHEST_REWARD_TABLE.get(tier, WORLD_BOSS_CHEST_REWARD_TABLE[1])
    roll = random.random()
    cursor = 0.0
    selected: Any = 1
    for reward, chance in table:
        cursor += chance
        if roll <= cursor:
            selected = reward
            break
    if selected == "full_illustration":
        return {
            "reward_type": "full_illustration",
            "label": "full illustration",
            "material_type": MaterialType.ILLUSTRATION_PIECE.value,
            "material_count": WORLD_BOSS_FULL_ILLUSTRATION_PIECES,
        }
    return {
        "reward_type": "fragment",
        "label": f"{selected} illustration fragments",
        "material_type": MaterialType.ILLUSTRATION_PIECE.value,
        "material_count": int(selected),
    }


def record_world_boss_damage(
    dungeon_id: str,
    player_id: str,
    damage: int,
    duration: float = 0.0,
    character_ids: Optional[List[str]] = None,
    battle_id: Optional[str] = None,
    source: str = "battle",
) -> Dict[str, Any]:
    """Docstring."""
    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        raise ValueError("not_a_world_boss_dungeon")

    damage = max(0, int(damage or 0))
    if damage <= 0:
        raise ValueError("damage_must_be_positive")

    season_id = _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        _ensure_world_boss_season_with_session(db_session, season_id)
        player = db_session.query(PlayerModel).filter(PlayerModel.player_id == player_id).first()
        username = player.username if player else player_id

        record = WorldBossDamageRecordModel(
            record_id=str(uuid.uuid4()),
            dungeon_id=dungeon_id,
            season_id=season_id,
            player_id=player_id,
            username=username,
            battle_id=battle_id,
            damage=damage,
            duration=float(duration or 0.0),
            character_ids=list(character_ids or []),
            source=source,
        )
        db_session.add(record)

        ranking = db_session.query(WorldBossRankingModel).filter(
            WorldBossRankingModel.dungeon_id == dungeon_id,
            WorldBossRankingModel.season_id == season_id,
            WorldBossRankingModel.player_id == player_id,
        ).first()
        if not ranking:
            ranking = WorldBossRankingModel(
                ranking_id=str(uuid.uuid4()),
                dungeon_id=dungeon_id,
                season_id=season_id,
                player_id=player_id,
                username=username,
                max_damage=0,
                total_damage=0,
                attempts=0,
            )
            db_session.add(ranking)

        ranking.username = username
        ranking.total_damage = int(ranking.total_damage or 0) + damage
        ranking.attempts = int(ranking.attempts or 0) + 1
        if damage > int(ranking.max_damage or 0):
            ranking.max_damage = damage
            ranking.best_battle_id = battle_id
        ranking.updated_at = datetime.utcnow()
        db_session.flush()
        layer_result = _apply_world_boss_layer_damage(db_session, dungeon_id, season_id, damage, player_id, username)
        db_session.commit()
        payload = ranking.to_dict()
        payload["record"] = record.to_dict()
        payload["layer_result"] = layer_result
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()

    return payload


def _get_world_boss_rankings(dungeon_id: str, season_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        rows = db_session.query(WorldBossRankingModel).filter(
            WorldBossRankingModel.dungeon_id == dungeon_id,
            WorldBossRankingModel.season_id == season_id,
        ).order_by(
            WorldBossRankingModel.max_damage.desc(),
            WorldBossRankingModel.total_damage.desc(),
            WorldBossRankingModel.updated_at.asc(),
        ).limit(limit).all()
        return [row.to_dict(rank=index + 1) for index, row in enumerate(rows)]
    finally:
        db_session.close()


def _get_world_boss_player_ranking(dungeon_id: str, player_id: str, season_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    rankings = _get_world_boss_rankings(dungeon_id, season_id=season_id, limit=500)
    return next((row for row in rankings if row["player_id"] == player_id), None)


def _get_world_boss_settlement_rows(dungeon_id: str, season_id: Optional[str] = None, player_id: Optional[str] = None) -> List[Dict[str, Any]]:
    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    try:
        query = db_session.query(WorldBossSettlementModel).filter(
            WorldBossSettlementModel.dungeon_id == dungeon_id,
            WorldBossSettlementModel.season_id == season_id,
        )
        if player_id:
            query = query.filter(WorldBossSettlementModel.player_id == player_id)
        rows = query.order_by(WorldBossSettlementModel.rank.asc()).all()
        return [row.to_dict() for row in rows]
    finally:
        db_session.close()


def settle_world_boss_rewards(dungeon_id: str, season_id: Optional[str] = None) -> Dict[str, Any]:
    """Docstring."""
    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        raise ValueError("not_a_world_boss_dungeon")

    season_id = season_id or _get_world_boss_season_id()
    db = get_database()
    db_session = db.get_session()
    paid_rows: List[Dict[str, Any]] = []
    skipped_rows: List[Dict[str, Any]] = []
    try:
        progress = db_session.query(WorldBossLayerProgressModel).filter(
            WorldBossLayerProgressModel.dungeon_id == dungeon_id,
            WorldBossLayerProgressModel.season_id == season_id,
        ).first()
        cleared_layers = int(progress.cleared_layers if progress else 0)
        reward_count = _get_world_boss_milestone_reward_count(cleared_layers)

        ranking_rows = db_session.query(WorldBossRankingModel).filter(
            WorldBossRankingModel.dungeon_id == dungeon_id,
            WorldBossRankingModel.season_id == season_id,
        ).order_by(
            WorldBossRankingModel.max_damage.desc(),
            WorldBossRankingModel.total_damage.desc(),
            WorldBossRankingModel.updated_at.asc(),
        ).all()

        for ranking in ranking_rows:
            existing = db_session.query(WorldBossSettlementModel).filter(
                WorldBossSettlementModel.dungeon_id == dungeon_id,
                WorldBossSettlementModel.season_id == season_id,
                WorldBossSettlementModel.player_id == ranking.player_id,
            ).first()
            if existing:
                skipped_rows.append(existing.to_dict())
                continue
            if reward_count <= 0:
                continue

            material = _add_material_with_session(
                db_session,
                ranking.player_id,
                MaterialType.ILLUSTRATION_PIECE,
                None,
                reward_count,
                source="world_boss_settlement",
                description=f"{dungeon.name} {season_id} layer milestone reward: {cleared_layers} layers"
            )
            settlement = WorldBossSettlementModel(
                settlement_id=str(uuid.uuid4()),
                dungeon_id=dungeon_id,
                season_id=season_id,
                player_id=ranking.player_id,
                username=ranking.username,
                rank=0,
                max_damage=ranking.max_damage,
                total_damage=ranking.total_damage,
                reward_material_type=MaterialType.ILLUSTRATION_PIECE.value,
                reward_attribute_type=None,
                reward_count=material.get("count", reward_count) if material else 0,
            )
            db_session.add(settlement)
            paid_rows.append(settlement.to_dict())

        db_session.commit()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()

    return {
        "dungeon_id": dungeon_id,
        "season_id": season_id,
        "cleared_layers": cleared_layers if 'cleared_layers' in locals() else 0,
        "reward_per_player": reward_count if 'reward_count' in locals() else 0,
        "paid_count": len(paid_rows),
        "skipped_count": len(skipped_rows),
        "settlements": paid_rows,
        "skipped": skipped_rows,
    }


def _build_world_boss_status_payload(dungeon, player_id: Optional[str] = None) -> Dict[str, Any]:
    season_id = _get_world_boss_season_id()
    season_payload = _get_world_boss_season_payload(season_id)
    rankings = _get_world_boss_rankings(dungeon.dungeon_id, season_id=season_id, limit=10)
    player_ranking = _get_world_boss_player_ranking(dungeon.dungeon_id, player_id, season_id) if player_id else None
    player_settlements = _get_world_boss_settlement_rows(dungeon.dungeon_id, season_id, player_id) if player_id else []
    layer_progress = _get_world_boss_progress_payload(dungeon.dungeon_id, season_id)
    chest_summary = _get_world_boss_chest_summary(dungeon.dungeon_id, season_id, player_id) if player_id else {
        "unopened_count": 0,
        "opened_count": 0,
        "latest": [],
        "tier_rules": [],
        "reward_options": [],
    }
    return {
        "dungeon": {
            "dungeon_id": dungeon.dungeon_id,
            "name": dungeon.name,
            "attribute_type": dungeon.attribute_type.value,
            "difficulty": dungeon.difficulty.value,
            "difficulty_key": dungeon.get_difficulty_config()["key"],
            "duration": dungeon.duration,
            "reward_config": dungeon.reward_config,
            "recommendation": _get_party_recommendation(dungeon),
            "boss_summary": _build_boss_summary_payload(dungeon),
        },
        "season_id": season_id,
        "season": season_payload,
        "settlement": {
            "cadence": "weekly",
            "status": "ready",
            "description": "Damage ranking is display-only. Rewards are shared by global cleared layers.",
            "reward_material_type": MaterialType.ILLUSTRATION_PIECE.value,
            "milestone_rule": {
                "interval_layers": WORLD_BOSS_LAYER_MILESTONE_INTERVAL,
                "fragments_per_interval": WORLD_BOSS_MILESTONE_FRAGMENT_REWARD,
                "current_fragments": layer_progress["milestone_fragments_available"],
            },
            "player_settlements": player_settlements,
        },
        "layer_progress": layer_progress,
        "layer_history": _get_world_boss_layer_history(dungeon.dungeon_id, season_id, limit=12),
        "announcements": _get_world_boss_announcements(season_id, dungeon.dungeon_id, limit=8),
        "chests": chest_summary,
        "ranking": rankings,
        "player_ranking": player_ranking,
        "rules": {
            "team_size": 20,
            "score_basis": "Combat damage pushes the global layer. Ranking is only a display reference.",
            "future_source": "Each cleared layer grants a chest; every 50 cleared layers adds 10 shared settlement fragments.",
        },
    }


# 璁よ瘉鐩稿叧
@api_bp.route('/auth/register', methods=['POST'])
def register():
    """Docstring."""
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')
    email = data.get('email')
    
    if not username or not password:
        return jsonify({'success': False, 'message': '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖'}), 400
    
    success, player, message = AuthSystem.register(username, password, email)
    if success:
        return jsonify({
            'success': True,
            'message': message,
            'player': player.to_dict()
        }), 200
    else:
        return jsonify({'success': False, 'message': message}), 400


@api_bp.route('/auth/login', methods=['POST'])
def login():
    """Docstring."""
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'success': False, 'message': '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖'}), 400
    
    success, player, message = AuthSystem.login(username, password)
    if success:
        session['player_id'] = player.player_id
        return jsonify({
            'success': True,
            'message': message,
            'player': player.to_dict()
        }), 200
    else:
        return jsonify({'success': False, 'message': message}), 401


@api_bp.route('/auth/logout', methods=['POST'])
def logout():
    """Docstring."""
    player_id = session.get('player_id')
    if player_id:
        player = PlayerManager.get_player_by_id(player_id)
        if player:
            AuthSystem.logout(player)
        session.pop('player_id', None)
    return jsonify({'success': True, 'message': '鐧诲嚭鎴愬姛'}), 200


# 鐜╁鐩稿叧
@api_bp.route('/player/info', methods=['GET'])
def get_player_info():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    player = PlayerManager.get_player_by_id(player_id)
    if not player:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    return jsonify({
        'success': True,
        'player': player.to_dict()
    }), 200


# 鏉愭枡鐩稿叧
@api_bp.route('/materials', methods=['GET'])
def get_materials():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    materials = _get_player_materials(player_id)
    return jsonify({
        'success': True,
        'materials': materials
    }), 200


@api_bp.route('/materials/transactions', methods=['GET'])
def get_material_transactions():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    limit = min(int(request.args.get('limit', 30)), 100)
    db = get_database()
    db_session = db.get_session()
    try:
        transactions = db_session.query(MaterialTransactionModel).filter(
            MaterialTransactionModel.player_id == player_id
        ).order_by(MaterialTransactionModel.created_at.desc()).limit(limit).all()
        return jsonify({
            'success': True,
            'transactions': [transaction.to_dict() for transaction in transactions]
        }), 200
    finally:
        db_session.close()


# 鎶藉彇鐩稿叧
@api_bp.route('/gacha/status', methods=['GET'])
def gacha_status():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    pool_type = request.args.get('pool_type', 'FIRE_WOOD_WIND')
    state = _load_gacha_state()
    player_state = _get_gacha_player_state(state, player_id)
    return jsonify({
        'success': True,
        'total_pulls': player_state.get('total_pulls', 0),
        'pity': _build_gacha_pity_payload(player_state, pool_type),
        'history': player_state.get('history', [])[:GACHA_HISTORY_LIMIT],
        'up_pool': _build_up_pool_payload() if pool_type == 'UP_POOL' else None
    }), 200


@api_bp.route('/admin/up-pool', methods=['GET'])
def admin_get_up_pool():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    all_characters = _get_generated_character_pool()
    return jsonify({
        'success': True,
        'up_pool': _build_up_pool_payload(all_characters),
        'available_characters': [_serialize_generated_character(char) for char in all_characters]
    }), 200


@api_bp.route('/admin/up-pool', methods=['POST'])
def admin_save_up_pool():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    all_characters = _get_generated_character_pool()
    available_names = {char.name for char in all_characters}
    up_names = [
        str(name).strip()
        for name in data.get('up_character_names', [])
        if str(name).strip()
    ]
    invalid_names = [name for name in up_names if name not in available_names]
    if invalid_names:
        return jsonify({
            'success': False,
            'message': f'UP瑙掕壊涓嶅瓨鍦細{", ".join(invalid_names)}'
        }), 400

    try:
        up_rate = float(data.get('up_rate', 0.5))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'error'}), 400
    if up_rate < 0 or up_rate > 0.95:
        return jsonify({'success': False, 'message': 'UP姒傜巼闇€瑕佸湪 0 鍒?0.95 涔嬮棿'}), 400

    _save_up_pool_config({
        'placeholder_1724': 'value',
        'description': str(data.get('description') or ''),
        'up_rate': up_rate,
        'up_character_names': up_names
    })
    return jsonify({
        'success': True,
        'message': 'UP姹犻厤缃凡淇濆瓨',
        'up_pool': _build_up_pool_payload(all_characters),
        'available_characters': [_serialize_generated_character(char) for char in all_characters]
    }), 200


@api_bp.route('/admin/exclusive-weapon-templates', methods=['GET'])
def admin_get_exclusive_weapon_templates():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    templates = _load_exclusive_weapon_templates()
    return jsonify({
        'success': True,
        'templates': templates,
        'template_order': ['physical_dps', 'magic_dps', 'tank', 'healer', 'support']
    }), 200


@api_bp.route('/admin/exclusive-weapon-templates', methods=['POST'])
def admin_save_exclusive_weapon_template():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    template_key = str(data.get('template_key') or '').strip()
    if not template_key:
        return jsonify({'success': False, 'message': '缂哄皯妯℃澘 key'}), 400

    templates = _load_exclusive_weapon_templates()
    next_template = dict(data)
    next_template['template_key'] = template_key
    templates[template_key] = _normalize_exclusive_weapon_template(next_template)
    _save_exclusive_weapon_templates(templates)
    return jsonify({
        'success': True,
        'message': '涓撳睘姝﹀櫒鎶€鑳芥ā鏉垮凡淇濆瓨',
        'templates': templates,
        'template': templates[template_key]
    }), 200


@api_bp.route('/gacha/pull', methods=['POST'])
def gacha_pull():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        logger.warning('鎶藉崱璇锋眰锛氭湭鐧诲綍')
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    pull_count = data.get('pull_count', 1)  # 1, 10, 100
    pool_type = data.get('pool_type', 'FIRE_WOOD_WIND')  # 姹犲瓙绫诲瀷
    
    logger.info(f'鐜╁ {player_id} 寮€濮嬫娊鍗★細娆℃暟={pull_count}, 姹犲瓙={pool_type}')
    
    player = PlayerManager.get_player_by_id(player_id)
    if not player:
        logger.error("error")
        return jsonify({'success': False, 'message': 'error'}), 404
    
    cost = GachaSystem.get_gold_cost(pull_count)
    if player.gold < cost:
        logger.warning(f'鐜╁ {player_id} 閲戝竵涓嶈冻锛氶渶瑕?{cost}锛屽綋鍓?{player.gold}')
        return jsonify({
            'success': False,
            'message': f'not enough gold: need {cost}, owned {player.gold}'
        }), 400
    
    # 鍒涘缓鎶藉彇绯荤粺
    gacha = GachaSystem(player_id)
    
    # 鍔犺浇鎴橀瓊鏁版嵁
    _load_battle_soul_data(player_id, gacha)
    
    # 瀵煎叆蹇呰鐨勭被鍨嬶紙闇€瑕佸湪瀹氫箟鍐呴儴鍑芥暟涔嬪墠瀵煎叆锛?    from ..characters.character import Character
    from ..classes.profession import get_profession, ProfessionType
    from ..attributes.attribute import Attribute, AttributeType
    from ..versions.version import GameVersion
    from datetime import datetime
    import uuid
    
    # 鍔犺浇鐜╁宸叉嫢鏈夌殑瑙掕壊鍒?gacha 绯荤粺涓紝浠ヤ究姝ｇ‘鍒ゆ柇閲嶅
    # 娉ㄦ剰锛欸achaSystem.pull 浣跨敤 character.character_id 鏉ュ垽鏂噸澶?    # 鎵€浠ユ垜浠渶瑕佺‘淇濇睜瀛愪腑瑙掕壊鐨?character_id 涓庡凡鎷ユ湁瑙掕壊鐨?character_id 鍖归厤
    db = get_database()
    db_session = db.get_session()
    try:
        from ..serialization.character_serializer import CharacterSerializer
        owned_char_models = db_session.query(CharacterModel).filter(
            CharacterModel.player_id == player_id
        ).all()
        for char_model in owned_char_models:
            char_domain = CharacterSerializer.model_to_domain(char_model)
            if char_model.name in PREDEFINED_CHARACTER_DESCRIPTIONS:
                char_domain.character_id = f"predefined_{char_model.name}"
            # 浣跨敤 character_id 浣滀负閿紙涓?GachaSystem.pull 鐨勯€昏緫涓€鑷达級
            gacha.owned_characters[char_domain.character_id] = char_domain
    finally:
        db_session.close()
    
    # 鍒涘缓瑙掕壊姹犲瓙锛堢被鍨嬪鍏ュ凡鍦ㄤ笂闈㈠畬鎴愶級
    
    # 鍒涘缓榛樿娓告垙鐗堟湰
    default_version = GameVersion(
        version_id='v1.0',
        version_name='绗竴绾厓',
        era_name='鍒濆绾厓',
        era_year=0,
        release_date=datetime.now()
    )
    
    try:
        all_characters = generate_all_characters(default_version)
        logger.debug(f'鐢熸垚瑙掕壊鏁伴噺: {len(all_characters) if all_characters else 0}')
        if not all_characters or len(all_characters) == 0:
            logger.error('瑙掕壊鐢熸垚澶辫触锛氱敓鎴愮殑瑙掕壊鏁伴噺涓?')
            return jsonify({
                'success': False,
                'message': f'瑙掕壊鐢熸垚澶辫触锛岀敓鎴愮殑瑙掕壊鏁伴噺涓?'
            }), 500
    except Exception as e:
        import traceback
        logger.error(f'瑙掕壊鐢熸垚澶辫触: {str(e)}', exc_info=True)
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'瑙掕壊鐢熸垚澶辫触: {str(e)}'
        }), 500
    
    characters = []
    
    try:
        if pool_type == 'FIRE_WOOD_WIND':
            # 鐏湪椋庢睜锛氱瓫閫夌伀銆佹湪銆侀灞炴€х殑瑙掕壊 (缂栧彿25-48)
            characters = [
                char for char in all_characters
                if char.attribute.attribute_type in [AttributeType.FIRE, AttributeType.WOOD, AttributeType.WIND]
            ]
        
        elif pool_type == 'WATER_EARTH_THUNDER':
            # 姘村湡闆锋睜锛氱瓫閫夋按銆佸湡銆侀浄灞炴€х殑瑙掕壊 (缂栧彿1-24)
            characters = [
                char for char in all_characters
                if char.attribute.attribute_type in [AttributeType.WATER, AttributeType.EARTH, AttributeType.THUNDER]
            ]
        
        elif pool_type == 'LIGHT_DARK':
            # 鍏夋殫姹狅細绛涢€夊厜銆佹殫灞炴€х殑瑙掕壊 (缂栧彿49-64)
            characters = [
                char for char in all_characters
                if char.attribute.attribute_type in [AttributeType.LIGHT, AttributeType.DARK]
            ]
        
        else:
            characters = all_characters
    except Exception as e:
        import traceback
        logger.error(f'瑙掕壊绛涢€夊け璐? {str(e)}', exc_info=True)
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'瑙掕壊绛涢€夊け璐? {str(e)}'
        }), 500
    
    # 鍒涘缓姹犲瓙
    up_pool_payload = _build_up_pool_payload(all_characters)
    up_characters = []
    if pool_type == 'UP_POOL':
        up_names = set(up_pool_payload.get("up_character_names", []))
        up_characters = [char for char in characters if char.name in up_names]

    if not characters or len(characters) == 0:
        logger.error("error")
        return jsonify({
            'success': False,
            'message': 'ok',
        }), 500
    
    try:
        pool = GachaPool(
            pool_type=GachaPoolType[pool_type],
            characters=characters,
            up_characters=up_characters,
            up_rate=up_pool_payload.get("up_rate", 0.5)
        )
        logger.debug(f'鍒涘缓姹犲瓙鎴愬姛锛氱被鍨?{pool_type}, 瑙掕壊鏁?{len(characters)}')
    except KeyError:
        logger.error(f'鏃犳晥鐨勬睜瀛愮被鍨? {pool_type}')
        return jsonify({
            'success': False,
            'message': f'鏃犳晥鐨勬睜瀛愮被鍨? {pool_type}'
        }), 400
    except Exception as e:
        import traceback
        logger.error(f'鍒涘缓姹犲瓙澶辫触: {str(e)}', exc_info=True)
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'鍒涘缓姹犲瓙澶辫触: {str(e)}'
        }), 500
    
    # 鎶藉彇
    try:
        results = gacha.pull(pool, pull_count, player.gold)
        
        # 瀵逛簬棰勫畾涔夎鑹诧紝闇€瑕侀澶栨鏌ユ暟鎹簱涓槸鍚﹀凡瀛樺湪鍚屽悕瑙掕壊
        from ..rewards.gacha import GachaSystem as GS
        max_essence_needed = GS.get_max_essence_needed()  # 775
        state = _load_gacha_state()
        player_state = _get_gacha_player_state(state, player_id)
        pity_counter = int(player_state.get("pool_counters", {}).get(pool_type, 0) or 0)
        pity_triggered = 0
        
        db_check = get_database()
        db_check_session = db_check.get_session()
        try:
            owned_names = {
                row.name for row in db_check_session.query(CharacterModel.name).filter(
                    CharacterModel.player_id == player_id
                ).all()
            }
            for result in results:
                char = result.character
                attribute_type = char.attribute.attribute_type
                
                # 濡傛灉鏄瀹氫箟瑙掕壊锛屾鏌ユ暟鎹簱涓槸鍚﹀凡瀛樺湪鍚屽悕瑙掕壊
                if char.name in owned_names and not result.is_duplicate:
                    # 鏁版嵁搴撲腑宸插瓨鍦ㄤ絾 GachaSystem 娌℃湁鍒ゆ柇涓洪噸澶嶏紝鎵嬪姩鏍囪骞惰ˉ鍙戠簿鍗?                    result.is_duplicate = True
                    result.essence_gained = 1
                    if attribute_type not in gacha.essence:
                        gacha.essence[attribute_type] = 0
                    gacha.essence[attribute_type] += result.essence_gained
                    # 娣诲姞鍒?owned_characters锛岀‘淇濆悗缁娊鍙栬兘姝ｇ‘鍒ゆ柇閲嶅
                    gacha.owned_characters[char.character_id] = char

                if result.is_duplicate:
                    pity_counter += 1
                    available_unowned = [pool_char for pool_char in characters if pool_char.name not in owned_names]
                    if pity_counter >= GACHA_PITY_THRESHOLD and available_unowned:
                        if result.essence_gained > 0:
                            gacha.essence[attribute_type] = max(
                                0,
                                gacha.essence.get(attribute_type, 0) - result.essence_gained
                            )
                        forced_character = random.choice(available_unowned)
                        result.character = forced_character
                        result.is_duplicate = False
                        result.essence_gained = 0
                        gacha.owned_characters[forced_character.character_id] = forced_character
                        owned_names.add(forced_character.name)
                        pity_counter = 0
                        pity_triggered += 1
                        continue
                
                # 澶勭悊绮惧崕锛氭鏌ユ槸鍚﹀簲璇ヨ浆鍖栦负绮惧崕锛坧ull宸茬粡澧炲姞浜嗙簿鍗庯紝闇€瑕佹鏌ユ槸鍚﹁秴闄愶級
                if result.is_duplicate and result.essence_gained > 0:
                    try:
                        current_essence = gacha.essence.get(attribute_type, 0)
                        current_level = gacha.battle_soul.get(attribute_type, 0)
                        
                        total_essence_used = 0
                        if current_level > 0:
                            for level in range(1, current_level + 1):
                                try:
                                    cost = gacha.get_battle_soul_upgrade_cost(level - 1)
                                    total_essence_used += cost
                                except Exception:
                                    break
                        
                        # 褰撳墠鎷ユ湁鐨勭簿鍗?+ 宸蹭娇鐢ㄧ殑绮惧崕
                        total_essence = current_essence + total_essence_used
                        
                        if total_essence >= max_essence_needed:
                            gacha.essence[attribute_type] = max(0, gacha.essence.get(attribute_type, 0) - 1)
                            result.essence_gained = 0
                    except Exception:
                        # 濡傛灉绮惧崕澶勭悊澶辫触锛屼笉褰卞搷鎶藉崱娴佺▼
                        pass
                if result.is_duplicate:
                    pity_counter = min(pity_counter, GACHA_PITY_THRESHOLD)
                else:
                    owned_names.add(result.character.name)
                    pity_counter = 0
        finally:
            db_check_session.close()
        
        # 淇濆瓨鎴橀瓊鏁版嵁
        _save_battle_soul_data(player_id, gacha)
        
        # repaired malformed string on line 2023
        
        # 淇濆瓨鎶藉彇鍒扮殑瑙掕壊鍒版暟鎹簱
        db = get_database()
        db_session = db.get_session()
        try:
            for result in results:
                if not result.is_duplicate:
                    # 鏂拌鑹诧紝淇濆瓨鍒版暟鎹簱
                    char = result.character
                    # 鑾峰彇瑙掕壊鎻忚堪锛堝鏋滄槸棰勫畾涔夎鑹诧級
                    description = PREDEFINED_CHARACTER_DESCRIPTIONS.get(char.name, None)
                    
                    # 瀵逛簬棰勫畾涔夎鑹诧紝闇€瑕佺敓鎴愬熀浜?player_id 鐨勫敮涓€ character_id
                    # 骞舵鏌ユ暟鎹簱涓槸鍚﹀凡瀛樺湪鍚屽悕瑙掕壊锛堥槻姝㈤噸澶嶄繚瀛橈級
                    if char.name in PREDEFINED_CHARACTER_DESCRIPTIONS:
                        # 妫€鏌ユ槸鍚﹀凡瀛樺湪鍚屽悕瑙掕壊
                        existing = db_session.query(CharacterModel).filter(
                            CharacterModel.player_id == player_id,
                            CharacterModel.name == char.name
                        ).first()
                        if existing:
                            # 宸插瓨鍦ㄥ悓鍚嶈鑹诧紝璺宠繃淇濆瓨锛堣繖绉嶆儏鍐电悊璁轰笂涓嶅簲璇ュ彂鐢燂紝鍥犱负搴旇鍦ㄦ娊鍙栨椂灏辫鍒ゆ柇涓洪噸澶嶏級
                            continue
                        # 鐢熸垚鍞竴鐨?character_id
                        unique_char_id = f"{player_id}_{char.name}_{uuid.uuid4().hex[:8]}"
                    else:
                        # 鏅€氳鑹诧紝浣跨敤鍘熸湁鐨?character_id
                        unique_char_id = char.character_id
                    
                    char_model = CharacterModel(
                        character_id=unique_char_id,
                        player_id=player_id,
                        name=char.name,
                        profession_type=char.profession.profession_type.value,
                        attribute_type=char.attribute.attribute_type.value,
                        version_id=char.version.version_id,
                        level=char.level,
                        exp=char.exp,
                        stats={
                            'hp': char.hp,
                            'attack': char.attack,
                            'defense': char.defense,
                            'magic_attack': char.magic_attack,
                            'magic_defense': char.magic_defense
                        },
                        equipment={},
                        skills={},
                        description=description
                    )
                    db_session.add(char_model)
            
            db_session.commit()
            
            # 鏇存柊瑙掕壊鏁伴噺缁熻
            new_characters_count = sum(1 for r in results if not r.is_duplicate)
            if new_characters_count > 0:
                from ..game.player_statistics import update_statistics, get_player_statistics
                stats = get_player_statistics(player_id, use_cache=False)  # 瀹炴椂璁＄畻瑙掕壊鏁伴噺
                update_statistics(player_id=player_id, character_count=stats['character_count'])
        finally:
            db_session.close()
        
        new_characters_count = sum(1 for r in results if not r.is_duplicate)
        essence_gained_total = sum(r.essence_gained for r in results)
        gacha_tracking = _record_gacha_pull(
            player_id=player_id,
            pool_type=pool_type,
            pull_count=pull_count,
            cost=cost,
            results=results,
            new_characters_count=new_characters_count,
            essence_gained_total=essence_gained_total,
            pity_counter=pity_counter,
            pity_triggered=pity_triggered
        )
        logger.info(f'鐜╁ {player_id} 鎶藉崱鎴愬姛锛氭柊瑙掕壊={new_characters_count}, 绮惧崕={essence_gained_total}, 娑堣€楅噾甯?{cost}')
        
        return jsonify({
            'success': True,
            'message': f'鎶藉彇鎴愬姛锛屾秷鑰?{cost} 閲戝竵',
            'results': [r.to_dict() for r in results],
            'new_characters': new_characters_count,
            'essence_gained': essence_gained_total,
            'summary': {
                'pull_count': pull_count,
                'cost': cost,
                'new_characters': new_characters_count,
                'duplicates': pull_count - new_characters_count,
                'essence_gained': essence_gained_total,
                'pity_triggered': pity_triggered
            },
            'pity': gacha_tracking['pity'],
            'history': gacha_tracking['history'],
            'total_pulls': gacha_tracking['total_pulls'],
            'up_pool': up_pool_payload if pool_type == 'UP_POOL' else None
        }), 200
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        import traceback
        error_msg = str(e)
        logger.error(f'鎶藉彇澶辫触: {error_msg}', exc_info=True)  # 璁板綍瀹屾暣閿欒鍫嗘爤
        traceback.print_exc()  # 鎵撳嵃閿欒鍒版湇鍔″櫒鏃ュ織
        return jsonify({
            'success': False,
            'message': f'鎶藉彇澶辫触: {error_msg}'
        }), 500


# 瑙掕壊鐩稿叧
def _get_equipment_slot_from_item(item_data: Dict[str, Any]) -> str:
    slot_value = item_data.get('slot') or '楗板搧'
    slot_map = {
        'HELMET': '澶寸洈',
        'HEAD': '澶寸洈',
        'placeholder_2139': 'value',
        '澶寸洈': '澶寸洈',
        'CHEST': '鑳哥敳',
        'placeholder_2142': 'value',
        '鑳哥敳': '鑳哥敳',
        'LEGS': '鎶よ吙',
        'placeholder_2145': 'value',
        '鎶よ吙': '鎶よ吙',
        'BOOTS': '闈村瓙',
        'FEET': '闈村瓙',
        'placeholder_2149': 'value',
        '闈村瓙': '闈村瓙',
        'GLOVES': '鎵嬪',
        'HANDS': '鎵嬪',
        'placeholder_2153': 'value',
        '鎵嬪': '鎵嬪',
        'ACCESSORY': '楗板搧',
        'SHOULDER': '楗板搧',
        'placeholder_2157': 'value',
        '楗板搧': '楗板搧',
    }
    return slot_map.get(slot_value, str(slot_value))


def _get_exclusive_weapon_max_level(breakthrough_level: int) -> int:
    return EXCLUSIVE_WEAPON_BASE_MAX_LEVEL + max(0, min(breakthrough_level, EXCLUSIVE_WEAPON_MAX_BREAKTHROUGH)) * 5


def _get_exclusive_weapon_upgrade_cost(current_level: int) -> int:
    if current_level < 0 or current_level >= len(EXCLUSIVE_WEAPON_UPGRADE_COSTS):
        return 0
    return EXCLUSIVE_WEAPON_UPGRADE_COSTS[current_level]


def _recalculate_exclusive_weapon_data(data: Dict[str, Any], level: int, breakthrough_level: int) -> Dict[str, Any]:
    updated = dict(data or {})
    base_attack = int(updated.get('base_attack_bonus') or updated.get('attack_bonus') or 100)
    base_magic_attack = int(updated.get('base_magic_attack_bonus') or updated.get('magic_attack_bonus') or 100)
    multiplier = 1 + max(level, 0) * 0.12 + max(breakthrough_level, 0) * 0.2
    updated['base_attack_bonus'] = base_attack
    updated['base_magic_attack_bonus'] = base_magic_attack
    updated['attack_bonus'] = int(base_attack * multiplier)
    updated['magic_attack_bonus'] = int(base_magic_attack * multiplier)
    updated['breakthrough_level'] = breakthrough_level
    updated['max_level'] = _get_exclusive_weapon_max_level(breakthrough_level)
    special_skill = dict(updated.get('special_skill') or {})
    if special_skill:
        special_skill['damage_multiplier'] = round(float(special_skill.get('damage_multiplier', 1.5)) + breakthrough_level * 0.1, 2)
        special_skill['description'] = f"涓撳睘鎶€鑳介殢绐佺牬寮哄寲锛屽綋鍓嶇獊鐮?{breakthrough_level}"
        updated['special_skill'] = special_skill
    return updated


def _build_exclusive_weapon_info(item) -> Dict[str, Any]:
    data = item.item_data or {}
    if item.item_type != 'weapon' or item.item_subtype != 'exclusive_weapon':
        return {}
    breakthrough_level = int(data.get('breakthrough_level', 0) or 0)
    max_level = _get_exclusive_weapon_max_level(breakthrough_level)
    current_level = int(item.level or 0)
    return {
        'is_exclusive': True,
        'bound_character_id': data.get('character_id'),
        'bound_character_name': data.get('character_name'),
        'level': current_level,
        'max_level': max_level,
        'breakthrough_level': breakthrough_level,
        'max_breakthrough': EXCLUSIVE_WEAPON_MAX_BREAKTHROUGH,
        'can_upgrade': current_level < max_level,
        'upgrade_cost': _get_exclusive_weapon_upgrade_cost(current_level) if current_level < max_level else 0,
        'can_breakthrough': current_level >= max_level and breakthrough_level < EXCLUSIVE_WEAPON_MAX_BREAKTHROUGH,
        'breakthrough_cost': EXCLUSIVE_WEAPON_BREAKTHROUGH_COSTS[breakthrough_level] if breakthrough_level < EXCLUSIVE_WEAPON_MAX_BREAKTHROUGH else 0,
        'attack_bonus': data.get('attack_bonus', 0),
        'magic_attack_bonus': data.get('magic_attack_bonus', 0),
        'special_skill': data.get('special_skill')
    }


def _sync_equipped_exclusive_weapon(db_session, player_id: str, item) -> Optional[CharacterModel]:
    data = item.item_data or {}
    character_id = data.get('character_id')
    if not character_id:
        return None
    character = db_session.query(CharacterModel).filter(
        CharacterModel.player_id == player_id,
        CharacterModel.character_id == character_id
    ).first()
    if not character:
        return None
    equipment = dict(character.equipment or {})
    weapon = equipment.get('weapon')
    if isinstance(weapon, dict) and weapon.get('item_id') == item.item_id:
        equipment['weapon'] = _serialize_equipped_item(item)
        character.equipment = equipment
        _recalculate_character_stats(character)
        return character
    return None


def _serialize_equipped_item(item) -> Dict[str, Any]:
    data = item.item_data or {}
    exclusive_info = _build_exclusive_weapon_info(item) if item.item_type == 'weapon' else None
    return {
        'item_id': item.item_id,
        'name': item.item_name,
        'item_type': item.item_type,
        'item_subtype': item.item_subtype,
        'level': item.level,
        'quality': data.get('quality'),
        'slot': data.get('slot'),
        'attribute_type': data.get('attribute_type'),
        'character_id': data.get('character_id'),
        'bound_character_id': data.get('character_id'),
        'breakthrough_level': data.get('breakthrough_level', 0),
        'max_level': exclusive_info.get('max_level') if exclusive_info else data.get('max_level'),
        'exclusive_info': exclusive_info,
        'stats': {
            'hp': data.get('hp_bonus', 0),
            'attack': data.get('attack_bonus', 0),
            'defense': data.get('defense_bonus', 0),
            'magic_attack': data.get('magic_attack_bonus', 0),
            'magic_defense': data.get('magic_defense_bonus', 0),
        },
        'item_data': data
    }


def _calculate_character_base_stats(character: CharacterModel) -> Dict[str, int]:
    from ..classes.profession import get_profession, ProfessionType
    try:
        profession_type = ProfessionType(character.profession_type)
    except ValueError:
        profession_type = ProfessionType.PHYSICAL_MELEE_DPS
    profession = get_profession(profession_type)
    level_multiplier = 1 + (character.level - 1) * 0.05
    return {
        'hp': int(profession.base_hp * level_multiplier),
        'attack': int(profession.base_attack * level_multiplier),
        'defense': int(profession.base_defense * level_multiplier),
        'magic_attack': int(profession.base_magic_attack * level_multiplier),
        'magic_defense': int(profession.base_magic_defense * level_multiplier),
    }


def _calculate_equipment_bonus(equipment: Dict[str, Any]) -> Dict[str, int]:
    bonus = {'hp': 0, 'attack': 0, 'defense': 0, 'magic_attack': 0, 'magic_defense': 0}
    weapon = equipment.get('weapon')
    if weapon:
        stats = weapon.get('stats') or {}
        for key in bonus:
            bonus[key] += int(stats.get(key, 0) or 0)

    equipment_set = equipment.get('equipment_set') or {}
    if isinstance(equipment_set, dict):
        for piece in equipment_set.values():
            if not isinstance(piece, dict):
                continue
            stats = piece.get('stats') or {}
            for key in bonus:
                bonus[key] += int(stats.get(key, 0) or 0)
    return bonus


def _recalculate_character_stats(character: CharacterModel) -> Dict[str, int]:
    base_stats = _calculate_character_base_stats(character)
    equipment_bonus = _calculate_equipment_bonus(character.equipment or {})
    final_stats = {
        key: base_stats.get(key, 0) + equipment_bonus.get(key, 0)
        for key in base_stats
    }
    character.stats = final_stats
    return final_stats


def _summarize_skill_slots(skills: Dict[str, Any]) -> Dict[str, Any]:
    from ..skills.skill_database import get_skill_by_id
    slots = (skills or {}).get('skill_slots') or {'low': [], 'mid': [], 'high': []}
    result = {'low': [], 'mid': [], 'high': [], 'total_configured': 0}
    for tier in ['low', 'mid', 'high']:
        for skill_id in slots.get(tier, []) or []:
            skill = get_skill_by_id(skill_id)
            result[tier].append({
                'skill_id': skill_id,
                'name': skill.name if skill else skill_id,
                'skill_logic': skill.skill_logic.value if skill else '',
                'skill_tier': skill.skill_tier.value if skill else ''
            })
        result['total_configured'] += len(result[tier])
    return result


def _summarize_equipment(equipment: Dict[str, Any]) -> Dict[str, Any]:
    equipment_set = (equipment or {}).get('equipment_set') or {}
    pieces = [
        piece for piece in equipment_set.values()
        if isinstance(piece, dict)
    ] if isinstance(equipment_set, dict) and not equipment_set.get('name') else []
    return {
        'has_weapon': bool((equipment or {}).get('weapon')),
        'weapon_name': ((equipment or {}).get('weapon') or {}).get('name'),
        'equipped_piece_count': len(pieces),
        'equipped_slots': [piece.get('slot') for piece in pieces if piece.get('slot')],
    }


def _add_material_with_session(
    db_session,
    player_id: str,
    material_type: MaterialType,
    attribute_type=None,
    count: int = 1,
    source: str = "system",
    description: str = ""
) -> Optional[Dict[str, Any]]:
    if count <= 0:
        return None
    if material_type == MaterialType.CHARACTER_EXP:
        total_owned = _get_character_exp_crystal_total(player_id, db_session)
        count = min(count, max(0, MAX_CHARACTER_EXP_CRYSTALS - total_owned))
        if count <= 0:
            return None
    attribute_value = attribute_type.value if attribute_type else None
    material = db_session.query(MaterialModel).filter(
        MaterialModel.player_id == player_id,
        MaterialModel.material_type == material_type.value,
        MaterialModel.attribute_type == attribute_value
    ).first()
    if material:
        material.count += count
        balance_after = material.count
    else:
        material = MaterialModel(
            material_id=str(uuid.uuid4()),
            player_id=player_id,
            material_type=material_type.value,
            attribute_type=attribute_value,
            count=count
        )
        db_session.add(material)
        balance_after = count

    db_session.add(MaterialTransactionModel(
        transaction_id=str(uuid.uuid4()),
        player_id=player_id,
        material_type=material_type.value,
        attribute_type=attribute_value,
        transaction_type="鑾峰彇",
        amount=count,
        balance_after=balance_after,
        source=source,
        description=description
    ))
    return {
        'material_type': material_type.value,
        'attribute_type': attribute_value,
        'count': count
    }


def _character_payload(character: CharacterModel) -> Dict[str, Any]:
    payload = character.to_dict()
    base_stats = _calculate_character_base_stats(character)
    equipment_bonus = _calculate_equipment_bonus(character.equipment or {})
    exp_to_next_level = get_exp_for_next_level(character.level)
    payload['base_stats'] = base_stats
    payload['equipment_bonus'] = equipment_bonus
    payload['stats'] = {
        key: base_stats.get(key, 0) + equipment_bonus.get(key, 0)
        for key in base_stats
    }
    payload['max_level'] = MAX_CHARACTER_LEVEL
    payload['exp_to_next_level'] = exp_to_next_level
    payload['exp_progress'] = get_exp_progress(character.level, character.exp)
    payload['total_exp_to_current_level'] = get_total_exp_before_level(character.level) + character.exp
    payload['total_exp_to_max_level'] = TOTAL_EXP_TO_MAX_LEVEL
    payload['skill_summary'] = _summarize_skill_slots(character.skills or {})
    payload['equipment_summary'] = _summarize_equipment(character.equipment or {})
    return payload


def _apply_character_exp(character: CharacterModel, amount: int) -> Dict[str, Any]:
    growth = apply_character_exp(character.level, character.exp, amount)
    character.level = growth['after_level']
    character.exp = growth['after_exp']
    _recalculate_character_stats(character)
    return growth


def _calculate_sweep_reward(dungeon, progress: Optional[Any]) -> Dict[str, Any]:
    best_record = (progress.best_record or {}) if progress else {}
    best_rewards = best_record.get('rewards')
    if isinstance(best_rewards, dict) and best_rewards.get('reward_type'):
        return best_rewards

    from ..dungeons.dungeon_reward import RewardCalculator
    from ..dungeons.dungeon_monster import MonsterSpawner
    bosses_killed = 0
    if dungeon.dungeon_type == DungeonType.SQUAD:
        bosses_killed = len(MonsterSpawner(dungeon).boss_spawn_times)
    reward = RewardCalculator.calculate_reward(
        dungeon=dungeon,
        duration=dungeon.duration,
        monsters_killed=0,
        groups_killed=0,
        bosses_killed=bosses_killed,
        is_completed=True
    )
    return reward.to_dict()


def _get_sweep_unlock_count(dungeon) -> int:
    return 100 if dungeon.reward_config.get('type') == 'experience' else 50


def _build_dungeon_boss_config_payload(dungeon) -> Dict[str, Any]:
    from ..enemies.boss_mechanics import get_boss_mechanic_template
    from ..enemies.boss_skill_config import build_boss_skill_loadout

    configured_boss = (dungeon.monster_config or {}).get("boss_config") or {}
    boss_type = configured_boss.get("boss_type") or "SINGLE"
    skill_slots = configured_boss.get("skill_slots")
    loadout = build_boss_skill_loadout(boss_type, 0, skill_slots)
    return {
        "boss_type": boss_type,
        "mechanic": get_boss_mechanic_template(boss_type),
        "skill_slots": loadout["skill_slots"],
        "total_slots": loadout["total_slots"],
        "source": "custom" if configured_boss else "default",
    }


def _get_countered_enemy_attribute(attribute_type) -> str:
    from ..enemies.enemy_factory import EnemyFactory

    try:
        return EnemyFactory._get_counter_attribute(attribute_type).value
    except Exception:
        return getattr(attribute_type, "value", str(attribute_type))


def _get_recommended_level(dungeon) -> int:
    base_level_by_type = {
        DungeonType.SINGLE: {
            "normal": 1,
            "hard": 25,
            "nightmare": 55,
        },
        DungeonType.SQUAD: {
            "normal": 100,
            "hard": 100,
            "nightmare": 100,
        },
        DungeonType.TEAM: {
            "normal": 100,
            "hard": 100,
            "nightmare": 100,
        },
        DungeonType.SERVER_BOSS: {
            "normal": 100,
            "hard": 100,
            "nightmare": 100,
        },
    }
    difficulty_key = dungeon.get_difficulty_config()["key"]
    return base_level_by_type.get(dungeon.dungeon_type, {}).get(difficulty_key, 1)


def _get_party_recommendation(dungeon) -> Dict[str, Any]:
    if dungeon.dungeon_type == DungeonType.SINGLE:
        return {
            "party_size": 1,
            "formation": [{"role": "浠绘剰鏍稿績瑙掕壊", "count": 1}],
            "summary": "Recommended party and reward summary.",
        }
    if dungeon.dungeon_type == DungeonType.SQUAD:
        return {
            "party_size": 5,
            "formation": [
                {"role": "鍧﹀厠", "count": 1},
                {"role": "娌荤枟", "count": 1},
                {"role": "杈撳嚭/杈呭姪", "count": 3},
            ],
            "summary": "Recommended party and reward summary.",
        }
    if dungeon.dungeon_type == DungeonType.TEAM:
        return {
            "party_size": 20,
            "formation": [
                {"role": "鍧﹀厠", "count": 4},
                {"role": "娌荤枟", "count": 4},
                {"role": "杈撳嚭", "count": 8},
                {"role": "杈呭姪", "count": 4},
            ],
            "summary": "Recommended party and reward summary.",
        }
    return {
        "party_size": 20,
        "formation": [
            {"role": "Role", "count": 4},
            {"role": "娌荤枟/杈呭姪", "count": 6},
            {"role": "Role", "count": 10},
        ],
        "summary": "Recommended party and reward summary.",
    }


def _build_roster_status(dungeon, characters: List[Any], recommended_level: int) -> Dict[str, Any]:
    target_attr = dungeon.attribute_type.value
    matching_attr = [
        character for character in characters
        if getattr(character, "attribute_type", None) == target_attr
    ]
    level_ready = [
        character for character in matching_attr
        if int(getattr(character, "level", 0) or 0) >= recommended_level
    ]
    max_level = [
        character for character in characters
        if int(getattr(character, "level", 0) or 0) >= MAX_CHARACTER_LEVEL
    ]
    party_size = _get_party_recommendation(dungeon)["party_size"]
    ready = len(level_ready) >= min(party_size, len(matching_attr) or party_size)
    if dungeon.dungeon_type != DungeonType.SINGLE:
        ready = len(level_ready) >= party_size
    return {
        "matching_attribute_count": len(matching_attr),
        "recommended_level_ready_count": len(level_ready),
        "max_level_count": len(max_level),
        "party_size": party_size,
        "ready": ready,
        "hint": (
            "Text pending.",
            # repaired malformed string on line 2571
        )
    }


def _build_reward_preview_payload(dungeon) -> Dict[str, Any]:
    reward_config = dungeon.reward_config or {}
    reward_type = reward_config.get("type", "unknown")
    multiplier = dungeon.get_reward_multiplier()
    if reward_type == "experience":
        full_exp = int(round(float(reward_config.get("base_exp", 0)) * multiplier))
        return {
            "reward_type": reward_type,
            "title": "閫氱敤缁忛獙缁撴櫠",
            "main": f"婊℃椂闀?{full_exp} 缁忛獙缁撴櫠",
            "details": [
                "Text pending.",
                "Text pending.",
            ],
            "thresholds": [
                {"label": "Time", "amount": int(round(full_exp * 0.15))},
                {"label": "Time", "amount": int(round(full_exp * 0.40))},
                {"label": "Time", "amount": int(round(full_exp * 0.65))},
                {"label": "Time", "amount": full_exp},
            ],
        }
    if reward_type == "exclusive_material":
        base = int(round(int(reward_config.get("base_material", 0)) * multiplier))
        return {
            "reward_type": reward_type,
            "title": "涓撳睘閬撳叿鏉愭枡",
            "main": "Reward summary.",
            "details": [
                "Text pending.",
                "Text pending.",
            ],
            "thresholds": [
                {"label": "Time", "amount": int(round(base * 0.1))},
                {"label": "Time", "amount": int(round(base * 0.2))},
                {"label": "Time", "amount": int(round(base * 0.5))},
                {"label": "Time", "amount": base},
            ],
        }
    if reward_type == "equipment_material":
        base = max(1, int(round(int(reward_config.get("base_material", 1)) * multiplier)))
        return {
            "reward_type": reward_type,
            "title": "瑁呭鏉愭枡",
            "main": "Reward summary.",
            "details": [
                "Text pending.",
                "Text pending.",
            ],
            "thresholds": [{"label": "閫氬叧", "amount": base}],
        }
    if reward_type == "illustration_piece":
        return {
            "reward_type": reward_type,
            "title": "绔嬬粯纰庣墖",
            "main": "閫氬叧鑾峰緱绔嬬粯纰庣墖",
            "details": ["Details pending."],
            "thresholds": [{"label": "閫氬叧", "amount": 1}],
        }
    return {
        "reward_type": reward_type,
        "title": "鏈煡濂栧姳",
        "main": "Reward summary.",
        "details": [],
        "thresholds": [],
    }


def _build_boss_summary_payload(dungeon) -> Dict[str, Any]:
    boss_config = _build_dungeon_boss_config_payload(dungeon)
    boss_type_labels = {
        "SINGLE": "鍗曚綋 Boss",
        "TWIN_SHARED": "鍙屽瓙鍏辫",
        "TWIN_SEPARATE": "鍙屽瓙鐩镐簰寮哄寲",
        "COUNCIL_SHARED": "璁細鍏辫",
        "COUNCIL_SEQUENTIAL": "璁細杞祦涓诲",
    }
    mechanic = boss_config["mechanic"]
    flags = []
    if mechanic.get("shared_health"):
        flags.append("鍏辫")
    if mechanic.get("mutual_strengthen"):
        flags.append("鐩镐簰寮哄寲")
    if mechanic.get("sequential_activation"):
        flags.append("杞祦涓诲")
    if not flags:
        flags.append("甯歌")

    from ..enemies.boss_skill_config import get_boss_skill_library_payload
    skill_library = get_boss_skill_library_payload()
    skill_ids = (
        boss_config["skill_slots"].get("high", [])
        + boss_config["skill_slots"].get("mid", [])[:2]
    )
    top_skills = [
        {
            "skill_id": skill_id,
            "name": skill_library.get(skill_id, {}).get("name", skill_id),
            "effect_tags": skill_library.get(skill_id, {}).get("effect_tags", []),
        }
        for skill_id in skill_ids
    ]
    return {
        "boss_type": boss_config["boss_type"],
        "type_label": boss_type_labels.get(boss_config["boss_type"], boss_config["boss_type"]),
        "mechanic_id": mechanic.get("mechanic_id"),
        "description": mechanic.get("description", ""),
        "boss_count": mechanic.get("boss_count", 1),
        "flags": flags,
        "slot_total": boss_config["total_slots"],
        "top_skills": top_skills,
    }


def _format_best_reward_text(best_record: Dict[str, Any]) -> str:
    rewards = (best_record or {}).get("rewards") or {}
    reward_type = rewards.get("reward_type")
    detail = rewards.get("rewards") or {}
    if reward_type == "experience":
        return f"{detail.get('exp', 0)} 缁忛獙缁撴櫠"
    if reward_type in {"exclusive_material", "equipment_material"}:
        return f"{detail.get('material_count', 0)} 鏉愭枡"
    if reward_type == "illustration_piece":
        return f"{detail.get('illustration_pieces', 0)} 绔嬬粯纰庣墖"
    return "鏆傛棤璁板綍"


def _build_progress_summary(progress: Optional[Any], dungeon) -> Dict[str, Any]:
    if not progress:
        completion_count = 0
        total_attempts = 0
        sweep_unlocked = False
        best_record = {}
    else:
        completion_count = progress.completion_count
        total_attempts = progress.total_attempts
        sweep_unlocked = progress.sweep_unlocked
        best_record = progress.best_record or {}
    sweep_unlock_count = _get_sweep_unlock_count(dungeon)
    best_duration = best_record.get("duration")
    return {
        "completion_count": completion_count,
        "total_attempts": total_attempts,
        "best_time_text": f"{float(best_duration):.1f}s" if best_duration else "None",
        "best_reward_text": _format_best_reward_text(best_record),
        "sweep_unlocked": sweep_unlocked,
        "sweep_text": "Unlocked" if sweep_unlocked else f"{completion_count}/{sweep_unlock_count}",
        "sweep_unlock_count": sweep_unlock_count,
    }


def _build_dungeon_overview_payload(dungeon, progress: Optional[Any], characters: List[Any]) -> Dict[str, Any]:
    recommended_level = _get_recommended_level(dungeon)
    party = _get_party_recommendation(dungeon)
    target_attribute = dungeon.attribute_type.value
    enemy_attribute = _get_countered_enemy_attribute(dungeon.attribute_type)
    return {
        "recommendation": {
            **party,
            "recommended_level": recommended_level,
            "recommended_attribute": target_attribute,
            "enemy_attribute": enemy_attribute,
            "attribute_hint": f"Recommended attribute: {target_attribute}; enemy attribute: {enemy_attribute}.",
            "roster_status": _build_roster_status(dungeon, characters, recommended_level),
        },
        "reward_preview": _build_reward_preview_payload(dungeon),
        "boss_summary": _build_boss_summary_payload(dungeon),
        "progress_summary": _build_progress_summary(progress, dungeon),
    }


def _grant_sweep_rewards(
    db_session,
    player_id: str,
    dungeon,
    reward_payload: Dict[str, Any],
    sweep_count: int
) -> List[Dict[str, Any]]:
    reward_type = reward_payload.get('reward_type')
    reward_detail = reward_payload.get('rewards') or {}
    materials_awarded: List[Dict[str, Any]] = []
    if reward_type == 'experience':
        total_exp = int(round(float(reward_detail.get('exp', 0)) * sweep_count))
        material = _add_material_with_session(
            db_session,
            player_id,
            MaterialType.CHARACTER_EXP,
            None,
            total_exp,
            source="dungeon_sweep",
            description=f"{dungeon.name}鎵崱濂栧姳"
        )
        if material:
            material['name'] = "閫氱敤瑙掕壊缁忛獙缁撴櫠"
            materials_awarded.append(material)
    elif reward_type == 'exclusive_material':
        material_count = int(reward_detail.get('material_count', 0)) * sweep_count
        material = _add_material_with_session(
            db_session,
            player_id,
            MaterialType.EXCLUSIVE_ITEM,
            None,
            material_count,
            source="dungeon_sweep",
            description=f"{dungeon.name}鎵崱濂栧姳"
        )
        if material:
            materials_awarded.append(material)
    elif reward_type == 'equipment_material':
        material_count = int(reward_detail.get('material_count', 0)) * sweep_count
        material = _add_material_with_session(
            db_session,
            player_id,
            MaterialType.EQUIPMENT_SET,
            dungeon.attribute_type,
            material_count,
            source="dungeon_sweep",
            description=f"{dungeon.name}鎵崱濂栧姳"
        )
        if material:
            materials_awarded.append(material)
    return materials_awarded


def _character_domain_for_skills(character: CharacterModel):
    from ..characters.character import Character
    from ..classes.profession import get_profession, ProfessionType
    from ..attributes.attribute import Attribute, AttributeType
    from ..versions.version import GameVersion
    try:
        profession_type = ProfessionType(character.profession_type)
    except ValueError:
        profession_type = ProfessionType.PHYSICAL_MELEE_DPS
    try:
        attribute_type = AttributeType(character.attribute_type)
    except ValueError:
        attribute_type = AttributeType.FIRE
    return Character(
        character_id=character.character_id,
        name=character.name,
        profession=get_profession(profession_type),
        attribute=Attribute(attribute_type),
        version=GameVersion(character.version_id or "v1.0", "Version", "鍒濆绾厓", 0, datetime.utcnow()),
        level=character.level,
        exp=character.exp
    )


def _get_unlocked_skills_for_character(character: CharacterModel) -> List[Dict[str, Any]]:
    from ..skills.skill_database import get_skill_database
    from ..attributes.attribute import AttributeType
    try:
        attribute_type = AttributeType(character.attribute_type)
    except ValueError:
        attribute_type = AttributeType.FIRE
    return [skill.to_dict() for skill in get_skill_database().get_skills_for_attribute(attribute_type)]


def _validate_skill_slots(skill_slots: Dict[str, List[str]], unlocked_skill_ids: set) -> tuple:
    from ..combat.skill_system import SkillManager
    from ..skills.skill_database import get_skill_by_id
    normalized = {
        'low': skill_slots.get('low', []),
        'mid': skill_slots.get('mid', []),
        'high': skill_slots.get('high', [])
    }
    all_ids = normalized['low'] + normalized['mid'] + normalized['high']
    if len(all_ids) != len(set(all_ids)):
        return False, "failed"
    missing = [skill_id for skill_id in all_ids if skill_id not in unlocked_skill_ids]
    if missing:
        return False, f"missing skills: {', '.join(missing)}"

    manager = SkillManager(None)
    for tier_key in ['low', 'mid', 'high']:
        for skill_id in normalized[tier_key]:
            skill = get_skill_by_id(skill_id)
            if not skill:
                return False, f"skill not found: {skill_id}"
            manager.add_skill(skill)
    return manager.validate_skill_configuration()


@api_bp.route('/characters', methods=['GET'])
def get_characters():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    db = get_database()
    db_session = db.get_session()
    try:
        characters = db_session.query(CharacterModel).filter(
            CharacterModel.player_id == player_id
        ).all()
        
        return jsonify({
            'success': True,
            'characters': [_character_payload(char) for char in characters]
        }), 200
    finally:
        db_session.close()


@api_bp.route('/characters', methods=['POST'])
def create_character():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    name = data.get('name')
    profession_type = data.get('profession_type')
    attribute_type = data.get('attribute_type')
    version_id = data.get('version_id', 'v1.0')
    
    if not all([name, profession_type, attribute_type]):
        return jsonify({'success': False, 'message': '缂哄皯蹇呰鍙傛暟'}), 400
    
    db = get_database()
    db_session = db.get_session()
    try:
        character_id = str(uuid.uuid4())
        character = CharacterModel(
            character_id=character_id,
            player_id=player_id,
            name=name,
            profession_type=profession_type,
            attribute_type=attribute_type,
            version_id=version_id,
            level=1,
            exp=0,
            stats={},
            equipment={},
            skills={}
        )
        db_session.add(character)
        db_session.commit()
        
        # 鏇存柊瑙掕壊鏁伴噺缁熻
        from ..game.player_statistics import update_statistics, get_player_statistics
        stats = get_player_statistics(player_id, use_cache=False)  # 瀹炴椂璁＄畻瑙掕壊鏁伴噺
        update_statistics(player_id=player_id, character_count=stats['character_count'])
        
        return jsonify({
            'success': True,
            'message': '瑙掕壊鍒涘缓鎴愬姛',
            'character': character.to_dict()
        }), 200
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/lock', methods=['POST'])
def lock_character(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404
        
        # 鍦╡quipment JSON涓坊鍔爄s_locked瀛楁锛屾垨鑰呬娇鐢╯tats瀛楁
        # 涓轰簡绠€鍗曪紝鎴戜滑鍦╡quipment涓瓨鍌ㄩ攣瀹氱姸鎬?        equipment = character.equipment or {}
        equipment['is_locked'] = True
        character.equipment = equipment
        
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'ok',
        }), 200
    except Exception as e:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'閿佸畾澶辫触: {str(e)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/unlock', methods=['POST'])
def unlock_character(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404
        
        # 鍦╡quipment JSON涓Щ闄s_locked瀛楁
        equipment = character.equipment or {}
        equipment['is_locked'] = False
        character.equipment = equipment
        
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'ok',
        }), 200
    except Exception as e:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'瑙ｉ攣澶辫触: {str(e)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/equipment-options', methods=['GET'])
def get_character_equipment_options(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404

        from ..database.models.inventory import InventoryItemModel
        items = db_session.query(InventoryItemModel).filter(
            InventoryItemModel.player_id == player_id,
            InventoryItemModel.item_type.in_(['weapon', 'equipment'])
        ).all()

        current_equipment = character.equipment or {}
        current_ids = set()
        if current_equipment.get('weapon'):
            current_ids.add(current_equipment['weapon'].get('item_id'))
        for piece in (current_equipment.get('equipment_set') or {}).values():
            if isinstance(piece, dict):
                current_ids.add(piece.get('item_id'))

        weapons = []
        equipment = []
        for item in items:
            data = item.item_data or {}
            payload = item.to_dict()
            payload['is_current_character_equipped'] = item.item_id in current_ids
            if item.item_type == 'weapon':
                owner_character_id = data.get('character_id')
                payload['can_equip'] = not owner_character_id or owner_character_id == character_id
                payload['exclusive_info'] = _build_exclusive_weapon_info(item)
                weapons.append(payload)
            elif item.item_type == 'equipment':
                payload['can_equip'] = True
                payload['slot'] = _get_equipment_slot_from_item(data)
                equipment.append(payload)

        return jsonify({
            'success': True,
            'weapons': weapons,
            'equipment': equipment,
            'character': _character_payload(character)
        }), 200
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/equip', methods=['POST'])
def equip_character_item(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    item_id = data.get('item_id')
    if not item_id:
        return jsonify({'success': False, 'message': '缂哄皯鐗╁搧ID'}), 400

    db = get_database()
    db_session = db.get_session()
    try:
        from ..database.models.inventory import InventoryItemModel
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404

        item = db_session.query(InventoryItemModel).filter(
            InventoryItemModel.player_id == player_id,
            InventoryItemModel.item_id == item_id
        ).first()
        if not item:
            return jsonify({'success': False, 'message': 'error'}), 404
        if item.item_type not in ['weapon', 'equipment']:
            return jsonify({'success': False, 'message': 'error'}), 400

        item_data = item.item_data or {}
        equipment = dict(character.equipment or {})

        if item.item_type == 'weapon':
            owner_character_id = item_data.get('character_id')
            if owner_character_id and owner_character_id != character_id:
                return jsonify({'success': False, 'message': '璇ヤ笓灞炴鍣ㄤ笉灞炰簬褰撳墠瑙掕壊'}), 400
            old_weapon = equipment.get('weapon')
            if old_weapon and old_weapon.get('item_id') != item_id:
                old_item = db_session.query(InventoryItemModel).filter(
                    InventoryItemModel.item_id == old_weapon.get('item_id')
                ).first()
                if old_item:
                    old_item.is_equipped = False
            equipment['weapon'] = _serialize_equipped_item(item)
        else:
            slot = _get_equipment_slot_from_item(item_data)
            equipment_set = dict(equipment.get('equipment_set') or {})
            old_piece = equipment_set.get(slot)
            if old_piece and old_piece.get('item_id') != item_id:
                old_item = db_session.query(InventoryItemModel).filter(
                    InventoryItemModel.item_id == old_piece.get('item_id')
                ).first()
                if old_item:
                    old_item.is_equipped = False
            equipment_set[slot] = _serialize_equipped_item(item)
            equipment['equipment_set'] = equipment_set

        item.is_equipped = True
        character.equipment = equipment
        _recalculate_character_stats(character)
        db_session.commit()

        return jsonify({
            'success': True,
            'message': '瑁呭鎴愬姛',
            'character': _character_payload(character)
        }), 200
    except Exception as exc:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'瑁呭澶辫触: {str(exc)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/unequip', methods=['POST'])
def unequip_character_item(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    item_id = data.get('item_id')
    slot = data.get('slot')
    item_type = data.get('item_type')

    db = get_database()
    db_session = db.get_session()
    try:
        from ..database.models.inventory import InventoryItemModel
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404

        equipment = dict(character.equipment or {})
        removed_item_id = None
        if item_type == 'weapon' or (item_id and equipment.get('weapon', {}).get('item_id') == item_id):
            removed_item_id = equipment.get('weapon', {}).get('item_id')
            equipment.pop('weapon', None)
        else:
            equipment_set = dict(equipment.get('equipment_set') or {})
            if item_id:
                for slot_key, piece in list(equipment_set.items()):
                    if isinstance(piece, dict) and piece.get('item_id') == item_id:
                        removed_item_id = piece.get('item_id')
                        equipment_set.pop(slot_key, None)
                        break
            elif slot:
                normalized_slot = _get_equipment_slot_from_item({'slot': slot})
                piece = equipment_set.pop(normalized_slot, None)
                if isinstance(piece, dict):
                    removed_item_id = piece.get('item_id')
            equipment['equipment_set'] = equipment_set

        if not removed_item_id:
            return jsonify({'success': False, 'message': '鏈壘鍒板凡绌挎埓鐗╁搧'}), 404

        item = db_session.query(InventoryItemModel).filter(
            InventoryItemModel.player_id == player_id,
            InventoryItemModel.item_id == removed_item_id
        ).first()
        if item:
            item.is_equipped = False

        character.equipment = equipment
        _recalculate_character_stats(character)
        db_session.commit()

        return jsonify({
            'success': True,
            'message': '鍗镐笅鎴愬姛',
            'character': _character_payload(character)
        }), 200
    except Exception as exc:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'鍗镐笅澶辫触: {str(exc)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/skills', methods=['GET'])
def get_character_skills(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404
        unlocked_skills = _get_unlocked_skills_for_character(character)
        skills_data = character.skills or {}
        current_slots = skills_data.get('skill_slots') or {'low': [], 'mid': [], 'high': []}
        is_valid, message = _validate_skill_slots(
            current_slots,
            {skill['skill_id'] for skill in unlocked_skills}
        ) if sum(len(current_slots.get(tier, [])) for tier in ['low', 'mid', 'high']) > 0 else (False, '灏氭湭閰嶇疆鎶€鑳芥Ы')
        return jsonify({
            'success': True,
            'unlocked_skills': unlocked_skills,
            'skill_slots': current_slots,
            'is_valid': is_valid,
            'message': message
        }), 200
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/skills/config', methods=['POST'])
def configure_character_skills(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    skill_slots = data.get('skill_slots') or {}

    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404
        unlocked_skills = _get_unlocked_skills_for_character(character)
        unlocked_ids = {skill['skill_id'] for skill in unlocked_skills}
        is_valid, message = _validate_skill_slots(skill_slots, unlocked_ids)
        if not is_valid:
            return jsonify({'success': False, 'message': message}), 400

        skills_data = dict(character.skills or {})
        skills_data['learned_skills'] = list(unlocked_ids)
        skills_data['skill_slots'] = {
            'low': skill_slots.get('low', []),
            'mid': skill_slots.get('mid', []),
            'high': skill_slots.get('high', [])
        }
        character.skills = skills_data
        db_session.commit()
        return jsonify({
            'success': True,
            'message': '鎶€鑳介厤缃凡淇濆瓨',
            'skill_slots': skills_data['skill_slots'],
            'character': _character_payload(character)
        }), 200
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/use-exp', methods=['POST'])
def use_character_exp(character_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    amount = int(data.get('amount') or 0)
    target_level = data.get('target_level')
    level_delta = data.get('level_delta')

    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404
        if character.level >= MAX_CHARACTER_LEVEL:
            return jsonify({'success': False, 'message': 'error'}), 400

        remaining_to_max = TOTAL_EXP_TO_MAX_LEVEL - (
            get_total_exp_before_level(character.level) + character.exp
        )
        if target_level is not None:
            desired_level = min(max(int(target_level), character.level), MAX_CHARACTER_LEVEL)
            amount = get_exp_required_to_level(character.level, character.exp, desired_level)
        elif level_delta is not None:
            desired_level = min(character.level + max(0, int(level_delta)), MAX_CHARACTER_LEVEL)
            amount = get_exp_required_to_level(character.level, character.exp, desired_level)

        spend_amount = min(max(0, amount), max(0, remaining_to_max))
        if spend_amount <= 0:
            return jsonify({'success': False, 'message': '浣跨敤鏁伴噺蹇呴』澶т簬0'}), 400

        owned_exp = _get_character_exp_crystal_total(player_id, db_session)
        if spend_amount > owned_exp:
            return jsonify({
                'success': False,
                'message': 'ok',
                'required_exp': spend_amount,
                'owned_exp': owned_exp,
                'need_more': spend_amount - owned_exp,
                'can_afford': False,
                'max_crystals': MAX_CHARACTER_EXP_CRYSTALS
            }), 400

        if not _remove_material_any_attribute_with_session(
            db_session,
            player_id,
            MaterialType.CHARACTER_EXP,
            spend_amount,
            source="character_growth",
            description=f"鍩瑰吇{character.name}"
        ):
            return jsonify({'success': False, 'message': 'error'}), 400

        growth = _apply_character_exp(character, spend_amount)
        db_session.commit()
        return jsonify({
            'success': True,
            'message': 'ok',
            'growth': growth,
            'character': _character_payload(character),
            'materials': _get_player_materials(player_id),
            'owned_exp_after': _get_character_exp_crystal_total(player_id)
        }), 200
    except Exception as exc:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'浣跨敤缁忛獙澶辫触: {str(exc)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/characters/<character_id>/exp-preview', methods=['GET'])
def preview_character_exp(character_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    target_level = request.args.get('target_level', type=int)
    level_delta = request.args.get('level_delta', type=int)

    db = get_database()
    db_session = db.get_session()
    try:
        character = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character:
            return jsonify({'success': False, 'message': 'error'}), 404

        if target_level is None:
            target_level = character.level + max(0, level_delta or 0)
        target_level = min(max(target_level, character.level), MAX_CHARACTER_LEVEL)
        required_exp = get_exp_required_to_level(character.level, character.exp, target_level)
        owned_exp = _get_character_exp_crystal_total(player_id, db_session)
        return jsonify({
            'success': True,
            'target_level': target_level,
            'required_exp': required_exp,
            'owned_exp': owned_exp,
            'need_more': max(0, required_exp - owned_exp),
            'can_afford': required_exp <= owned_exp,
            'max_crystals': MAX_CHARACTER_EXP_CRYSTALS
        }), 200
    finally:
        db_session.close()


# 鎴橀瓊鐩稿叧
@api_bp.route('/battle-soul/info', methods=['GET'])
def get_battle_soul_info():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..attributes.attribute import AttributeType
    from ..rewards.gacha import GachaSystem
    
    gacha = GachaSystem(player_id)
    _load_battle_soul_data(player_id, gacha)
    
    result = {}
    all_attributes = [
        AttributeType.WATER, AttributeType.EARTH, AttributeType.THUNDER,
        AttributeType.WIND, AttributeType.FIRE, AttributeType.WOOD,
        AttributeType.LIGHT, AttributeType.DARK
    ]
    
    for attr_type in all_attributes:
        info = gacha.get_battle_soul_info(attr_type)
        result[attr_type.value] = info
    
    return jsonify({
        'success': True,
        'battle_soul': result
    }), 200


@api_bp.route('/battle-soul/upgrade', methods=['POST'])
def upgrade_battle_soul():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    attribute_type_str = data.get('attribute_type')
    
    if not attribute_type_str:
        return jsonify({'success': False, 'message': 'error'}), 400
    
    from ..attributes.attribute import AttributeType
    from ..rewards.gacha import GachaSystem
    
    try:
        attribute_type = AttributeType(attribute_type_str)
    except ValueError:
        return jsonify({'success': False, 'message': f'鏃犳晥鐨勫睘鎬х被鍨? {attribute_type_str}'}), 400
    
    gacha = GachaSystem(player_id)
    _load_battle_soul_data(player_id, gacha)
    
    result = gacha.upgrade_battle_soul(attribute_type)
    
    if result['success']:
        _save_battle_soul_data(player_id, gacha)
        return jsonify({
            'success': True,
            'message': result['message'],
            'battle_soul': gacha.get_battle_soul_info(attribute_type)
        }), 200
    else:
        return jsonify({
            'success': False,
            'message': result['message'],
            'battle_soul': gacha.get_battle_soul_info(attribute_type)
        }), 400


# 鍓湰鐩稿叧
@api_bp.route('/dungeons', methods=['GET'])
def get_dungeons():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..dungeons.dungeon_database import get_all_dungeons
    from ..database.models.dungeon_progress import DungeonProgressModel
    
    dungeons = get_all_dungeons(include_difficulties=True)
    player = PlayerManager.get_player_by_id(player_id)
    
    db = get_database()
    db_session = db.get_session()
    try:
        characters = db_session.query(CharacterModel).filter(
            CharacterModel.player_id == player_id
        ).all()
        progress_records = db_session.query(DungeonProgressModel).filter(
            DungeonProgressModel.player_id == player_id
        ).all()
        progress_map = {p.dungeon_id: p for p in progress_records}
        player_data = {
            'characters': [c.to_dict() for c in characters],
            'is_solo': True,
            'completed_dungeons': [
                progress.dungeon_id for progress in progress_records
                if progress.is_completed or progress.completion_count > 0
            ]
        }
    finally:
        db_session.close()
    
    # 妫€鏌ヨВ閿佺姸鎬佸苟娣诲姞杩涘害淇℃伅
    available_dungeons = []
    for dungeon in dungeons:
        is_unlocked = dungeon.check_unlock_condition(player_data)
        progress = progress_map.get(dungeon.dungeon_id)
        
        dungeon_dict = dungeon.to_dict()
        dungeon_dict['is_unlocked'] = is_unlocked
        dungeon_dict['boss_config'] = _build_dungeon_boss_config_payload(dungeon)
        
        # 娣诲姞杩涘害淇℃伅
        if progress:
            dungeon_dict['progress'] = {
                'completion_count': progress.completion_count,
                'total_attempts': progress.total_attempts,
                'sweep_unlocked': progress.sweep_unlocked,
                'sweep_unlock_count': _get_sweep_unlock_count(dungeon),
                'best_record': progress.best_record or {}
            }
        else:
            dungeon_dict['progress'] = {
                'completion_count': 0,
                'total_attempts': 0,
                'sweep_unlocked': False,
                'sweep_unlock_count': _get_sweep_unlock_count(dungeon),
                'best_record': {}
            }
        dungeon_dict.update(_build_dungeon_overview_payload(dungeon, progress, characters))
        
        available_dungeons.append(dungeon_dict)
    
    # 鎺掑簭锛氭寜鐓у睘鎬ч『搴忥紙姘淬€佸湡銆侀浄銆侀銆佺伀銆佹湪銆佸厜銆佹殫锛夛紝鐒跺悗鎸夌収鍓湰绫诲瀷椤哄簭
    # 灞炴€ч『搴忔槧灏勶紙浣跨敤涓枃鍊硷級
    attribute_order_map = {
        'placeholder_3538': 'value',
        'placeholder_3539': 'value',
        'placeholder_3540': 'value',
        'placeholder_3541': 'value',
        'placeholder_3542': 'value',
        'placeholder_3543': 'value',
        'placeholder_3544': 'value',
        'placeholder_3545': 'value',
    }
    
    # 鍓湰绫诲瀷椤哄簭鏄犲皠
    dungeon_type_order_map = {
        '1浜烘湰': 1,      # SINGLE
        '5浜烘湰': 2,       # SQUAD
        '20浜烘湰': 3,      # TEAM
        'placeholder_3553': 'value',
    }
    
    def sort_key(dungeon_dict):
        attr = dungeon_dict.get('attribute_type', '')
        attr_order = attribute_order_map.get(attr, 999)
        
        dungeon_type = dungeon_dict.get('dungeon_type', '')
        type_order = dungeon_type_order_map.get(dungeon_type, 999)
        difficulty_order = dungeon_dict.get('difficulty_order', 1)
        return (attr_order, type_order, difficulty_order)
    
    available_dungeons.sort(key=sort_key)
    
    return jsonify({
        'success': True,
        'dungeons': available_dungeons
    }), 200


@api_bp.route('/dungeons/<dungeon_id>', methods=['GET'])
def get_dungeon_detail(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..dungeons.dungeon_database import get_dungeon
    from ..database.models.dungeon_progress import DungeonProgressModel
    
    dungeon = get_dungeon(dungeon_id)
    if not dungeon:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    db = get_database()
    db_session = db.get_session()
    try:
        characters = db_session.query(CharacterModel).filter(
            CharacterModel.player_id == player_id
        ).all()
        # 鑾峰彇鍓湰杩涘害
        all_progress = db_session.query(DungeonProgressModel).filter(
            DungeonProgressModel.player_id == player_id
        ).all()
        progress = db_session.query(DungeonProgressModel).filter(
            DungeonProgressModel.player_id == player_id,
            DungeonProgressModel.dungeon_id == dungeon_id
        ).first()
        player_data = {
            'characters': [c.to_dict() for c in characters],
            'is_solo': True,
            'completed_dungeons': [
                record.dungeon_id for record in all_progress
                if record.is_completed or record.completion_count > 0
            ]
        }
        
        dungeon_dict = dungeon.to_dict()
        dungeon_dict['is_unlocked'] = dungeon.check_unlock_condition(player_data)
        dungeon_dict['boss_config'] = _build_dungeon_boss_config_payload(dungeon)
        
        # 娣诲姞杩涘害淇℃伅
        if progress:
            dungeon_dict['progress'] = {
                'completion_count': progress.completion_count,
                'total_attempts': progress.total_attempts,
                'sweep_unlocked': progress.sweep_unlocked,
                'sweep_unlock_count': _get_sweep_unlock_count(dungeon),
                'best_record': progress.best_record or {}
            }
        else:
            dungeon_dict['progress'] = {
                'completion_count': 0,
                'total_attempts': 0,
                'sweep_unlocked': False,
                'sweep_unlock_count': _get_sweep_unlock_count(dungeon),
                'best_record': {}
            }
        dungeon_dict.update(_build_dungeon_overview_payload(dungeon, progress, characters))
        
        return jsonify({
            'success': True,
            'dungeon': dungeon_dict
        }), 200
    finally:
        db_session.close()


@api_bp.route('/boss-config/options', methods=['GET'])
def get_boss_config_options():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    from ..enemies.boss_mechanics import get_boss_mechanic_templates
    from ..enemies.boss_skill_config import (
        BOSS_SKILL_SLOT_TEMPLATE,
        get_boss_skill_library_payload,
    )

    return jsonify({
        'success': True,
        'boss_types': get_boss_mechanic_templates(),
        'skill_library': get_boss_skill_library_payload(),
        'default_skill_slots': BOSS_SKILL_SLOT_TEMPLATE,
    }), 200


@api_bp.route('/dungeons/<dungeon_id>/boss-config', methods=['GET'])
def get_dungeon_boss_config(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    from ..dungeons.dungeon_database import get_dungeon

    dungeon = get_dungeon(dungeon_id)
    if not dungeon:
        return jsonify({'success': False, 'message': 'error'}), 404

    return jsonify({
        'success': True,
        'boss_config': _build_dungeon_boss_config_payload(dungeon)
    }), 200


@api_bp.route('/dungeons/<dungeon_id>/boss-config', methods=['POST'])
def update_dungeon_boss_config(dungeon_id: str):
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    boss_type = data.get('boss_type') or 'SINGLE'
    skill_slots = data.get('skill_slots') or {}

    from ..dungeons.dungeon_database import get_dungeon, save_dungeon_boss_config
    from ..enemies.boss_mechanics import get_boss_mechanic_templates
    from ..enemies.boss_skill_config import validate_boss_skill_slots

    dungeon = get_dungeon(dungeon_id)
    if not dungeon:
        return jsonify({'success': False, 'message': 'error'}), 404

    if boss_type not in get_boss_mechanic_templates():
        return jsonify({'success': False, 'message': '鏈煡Boss鏈哄埗'}), 400

    validation = validate_boss_skill_slots(skill_slots)
    if not validation.get('valid'):
        return jsonify({'success': False, 'message': validation.get('message', 'Boss鎶€鑳芥Ы閰嶇疆鏃犳晥')}), 400

    saved_dungeon = save_dungeon_boss_config(dungeon_id, {
        'boss_type': boss_type,
        'skill_slots': validation['skill_slots'],
    })
    if not saved_dungeon:
        return jsonify({'success': False, 'message': 'Boss閰嶇疆淇濆瓨澶辫触'}), 500

    return jsonify({
        'success': True,
        'message': 'ok',
        'boss_config': _build_dungeon_boss_config_payload(saved_dungeon),
    }), 200


@api_bp.route('/dungeons/<dungeon_id>/sweep', methods=['POST'])
def sweep_dungeon(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    sweep_count = data.get('count', 1)  # 鎵崱娆℃暟锛岄粯璁?娆?    
    from ..dungeons.dungeon_database import get_dungeon
    from ..database.models.dungeon_progress import DungeonProgressModel
    
    dungeon = get_dungeon(dungeon_id)
    if not dungeon:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    # 妫€鏌ユ槸鍚﹀彲浠ユ壂鑽★紙鍙湁1浜烘湰鍜?浜烘湰鍙互鎵崱锛?    if dungeon.dungeon_type.value not in ['1浜烘湰', '5浜烘湰']:
        return jsonify({'success': False, 'message': '璇ュ壇鏈笉鏀寔鎵崱'}), 400
    
    db = get_database()
    db_session = db.get_session()
    try:
        progress = db_session.query(DungeonProgressModel).filter(
            DungeonProgressModel.player_id == player_id,
            DungeonProgressModel.dungeon_id == dungeon_id
        ).first()
        
        if not progress or not progress.sweep_unlocked:
            unlock_count = _get_sweep_unlock_count(dungeon)
            return jsonify({
                'success': False,
                'message': 'ok',
            }), 400
        
        reward_payload = _calculate_sweep_reward(dungeon, progress)
        materials_awarded = _grant_sweep_rewards(
            db_session,
            player_id,
            dungeon,
            reward_payload,
            sweep_count
        )

        progress.total_attempts += sweep_count
        progress.successful_attempts += sweep_count
        progress.completion_count += sweep_count
        progress.is_completed = True
        progress.sweep_unlocked = True
        progress.last_completion_time = datetime.utcnow()
        db_session.commit()

        try:
            from ..game.player_statistics import update_statistics
            update_statistics(
                player_id=player_id,
                battles_completed=sweep_count,
                dungeons_completed=sweep_count,
                total_materials_earned=sum(item.get('count', 0) for item in materials_awarded)
            )
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'message': 'ok',
            'sweep_count': sweep_count,
            'reward': reward_payload,
            'materials_awarded': materials_awarded,
            'progress': progress.to_dict()
        }), 200
    except Exception as exc:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'鎵崱澶辫触: {str(exc)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/dungeons/<dungeon_id>/start', methods=['POST'])
def start_dungeon(dungeon_id):
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    character_ids = data.get('character_ids', [])
    
    if not character_ids:
        return jsonify({'success': False, 'message': '璇烽€夋嫨瑙掕壊'}), 400
    
    from ..dungeons.dungeon_database import get_dungeon_by_id
    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    from .battle_api import create_single_battle_for_player
    payload, status = create_single_battle_for_player(
        player_id=player_id,
        dungeon_id=dungeon_id,
        character_ids=character_ids,
        assist_enabled=data.get('assist_enabled')
    )
    return jsonify(payload), status


# 澶氫汉鍓湰鐩稿叧
# World boss framework
@api_bp.route('/world-boss/seasons/maintenance', methods=['POST'])
def maintain_world_boss_seasons():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    return jsonify({
        'success': True,
        'maintenance': run_world_boss_season_maintenance(),
    }), 200


@api_bp.route('/world-boss/announcements', methods=['GET'])
def list_world_boss_announcements():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    season_id = request.args.get('season_id') or _get_world_boss_season_id()
    dungeon_id = request.args.get('dungeon_id')
    limit = min(max(int(request.args.get('limit', 20)), 1), 100)
    return jsonify({
        'success': True,
        'season_id': season_id,
        'announcements': _get_world_boss_announcements(season_id, dungeon_id, limit),
    }), 200


@api_bp.route('/world-boss/dungeons', methods=['GET'])
def list_world_boss_dungeons():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    from ..dungeons.dungeon_database import get_all_dungeons
    dungeons = [
        dungeon for dungeon in get_all_dungeons(include_difficulties=True)
        if dungeon.dungeon_type == DungeonType.SERVER_BOSS
    ]
    return jsonify({
        'success': True,
        'season_id': _get_world_boss_season_id(),
        'dungeons': [_build_world_boss_status_payload(dungeon, player_id) for dungeon in dungeons]
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/status', methods=['GET'])
def get_world_boss_status(dungeon_id: str):
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'error'}), 404
    return jsonify({
        'success': True,
        **_build_world_boss_status_payload(dungeon, player_id)
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/ranking', methods=['GET'])
def get_world_boss_ranking(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'error'}), 404
    limit = min(max(int(request.args.get('limit', 100)), 1), 500)
    season_id = request.args.get('season_id') or _get_world_boss_season_id()
    return jsonify({
        'success': True,
        'dungeon_id': dungeon_id,
        'season_id': season_id,
        'ranking': _get_world_boss_rankings(dungeon_id, season_id=season_id, limit=limit),
        'player_ranking': _get_world_boss_player_ranking(dungeon_id, player_id, season_id),
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/layer-history', methods=['GET'])
def get_world_boss_layer_history(dungeon_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'error'}), 404
    season_id = request.args.get('season_id') or _get_world_boss_season_id()
    limit = min(max(int(request.args.get('limit', 50)), 1), 200)
    return jsonify({
        'success': True,
        'dungeon_id': dungeon_id,
        'season_id': season_id,
        'layer_history': _get_world_boss_layer_history(dungeon_id, season_id, limit),
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/settlements', methods=['GET'])
def get_world_boss_settlements(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'error'}), 404
    season_id = request.args.get('season_id') or _get_world_boss_season_id()
    include_all = request.args.get('scope') == 'all'
    return jsonify({
        'success': True,
        'dungeon_id': dungeon_id,
        'season_id': season_id,
        'settlements': _get_world_boss_settlement_rows(
            dungeon_id,
            season_id,
            None if include_all else player_id
        )
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/chests', methods=['GET'])
def get_world_boss_chests(dungeon_id: str):
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'not_logged_in'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'world_boss_not_found'}), 404
    season_id = request.args.get('season_id') or _get_world_boss_season_id()
    return jsonify({
        'success': True,
        'dungeon_id': dungeon_id,
        'season_id': season_id,
        'chests': _get_world_boss_chest_summary(dungeon_id, season_id, player_id),
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/chests/<chest_id>/open', methods=['POST'])
def open_world_boss_chest(dungeon_id: str, chest_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'not_logged_in'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'world_boss_not_found'}), 404

    db = get_database()
    db_session = db.get_session()
    try:
        chest = db_session.query(WorldBossChestModel).filter(
            WorldBossChestModel.chest_id == chest_id,
            WorldBossChestModel.dungeon_id == dungeon_id,
            WorldBossChestModel.player_id == player_id,
        ).first()
        if not chest:
            return jsonify({'success': False, 'message': 'chest_not_found'}), 404
        if chest.status != "unopened":
            return jsonify({'success': False, 'message': 'chest_already_opened'}), 400

        reward = _draw_world_boss_chest_reward(int(chest.tier or 1))
        material = _add_material_with_session(
            db_session,
            player_id,
            MaterialType.ILLUSTRATION_PIECE,
            None,
            int(reward["material_count"]),
            source="world_boss_chest",
            description=f"{dungeon.name} {chest.season_id} layer {chest.layer} tier {chest.tier} chest"
        )
        reward["granted_count"] = material.get("count", reward["material_count"]) if material else 0
        chest.status = "opened"
        chest.reward_payload = reward
        chest.opened_at = datetime.utcnow()
        db_session.commit()
        chest_payload = chest.to_dict()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()

    return jsonify({
        'success': True,
        'message': 'chest_opened',
        'chest': chest_payload,
        'status': _build_world_boss_status_payload(dungeon, player_id),
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/chests/open-batch', methods=['POST'])
def open_world_boss_chests_batch(dungeon_id: str):
    """Open current player's unopened world boss chests in a bounded batch."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'not_logged_in'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'world_boss_not_found'}), 404

    data = request.get_json() or {}
    season_id = data.get('season_id') or request.args.get('season_id') or _get_world_boss_season_id()
    limit = min(max(int(data.get('limit') or request.args.get('limit') or 100), 1), 100)
    db = get_database()
    db_session = db.get_session()
    opened_rows: List[Dict[str, Any]] = []
    reward_summary: Dict[str, int] = {
        "fragment_1": 0,
        "fragment_2": 0,
        "fragment_5": 0,
        "full_illustration": 0,
        "total_fragments": 0,
    }
    try:
        chests = db_session.query(WorldBossChestModel).filter(
            WorldBossChestModel.dungeon_id == dungeon_id,
            WorldBossChestModel.season_id == season_id,
            WorldBossChestModel.player_id == player_id,
            WorldBossChestModel.status == "unopened",
        ).order_by(WorldBossChestModel.layer.asc()).limit(limit).all()

        for chest in chests:
            reward = _draw_world_boss_chest_reward(int(chest.tier or 1))
            material = _add_material_with_session(
                db_session,
                player_id,
                MaterialType.ILLUSTRATION_PIECE,
                None,
                int(reward["material_count"]),
                source="world_boss_chest_batch",
                description=f"{dungeon.name} {season_id} layer {chest.layer} tier {chest.tier} chest batch"
            )
            granted_count = material.get("count", reward["material_count"]) if material else 0
            reward["granted_count"] = granted_count
            chest.status = "opened"
            chest.reward_payload = reward
            chest.opened_at = datetime.utcnow()
            if reward["reward_type"] == "full_illustration":
                reward_summary["full_illustration"] += 1
            else:
                reward_summary[f"fragment_{reward['material_count']}"] += 1
            reward_summary["total_fragments"] += int(granted_count or 0)
            opened_rows.append(chest.to_dict())

        if opened_rows:
            _create_world_boss_announcement_with_session(
                db_session,
                "chest_batch_opened",
                "World boss chests opened",
                f"{len(opened_rows)} chests were opened from {dungeon.name}.",
                season_id=season_id,
                dungeon_id=dungeon_id,
                payload={"player_id": player_id, "count": len(opened_rows), "reward_summary": reward_summary},
            )
        db_session.commit()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()

    return jsonify({
        'success': True,
        'message': 'chests_opened',
        'opened_count': len(opened_rows),
        'reward_summary': reward_summary,
        'chests': opened_rows,
        'status': _build_world_boss_status_payload(dungeon, player_id),
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/settle', methods=['POST'])
def settle_world_boss(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'error'}), 404
    data = request.get_json() or {}
    season_id = data.get('season_id') or request.args.get('season_id') or _get_world_boss_season_id()
    try:
        settlement = settle_world_boss_rewards(dungeon_id, season_id)
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    return jsonify({
        'success': True,
        'message': 'ok',
        'settlement': settlement,
        'status': _build_world_boss_status_payload(dungeon, player_id),
    }), 200


@api_bp.route('/world-boss/<dungeon_id>/damage', methods=['POST'])
def submit_world_boss_damage(dungeon_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon or dungeon.dungeon_type != DungeonType.SERVER_BOSS:
        return jsonify({'success': False, 'message': 'error'}), 404

    data = request.get_json() or {}
    character_ids = data.get('character_ids') or []
    try:
        damage = int(data.get('damage') or 0)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'error'}), 400
    if damage <= 0:
        duration = float(data.get('duration') or 0.0)
        damage = _estimate_world_boss_damage(duration, len(character_ids), dungeon, bool(data.get('success')))

    try:
        ranking = record_world_boss_damage(
            dungeon_id=dungeon_id,
            player_id=player_id,
            damage=damage,
            duration=float(data.get('duration') or 0.0),
            character_ids=character_ids,
            battle_id=data.get('battle_id'),
            source=str(data.get('source') or 'manual'),
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    return jsonify({
        'success': True,
        'message': 'ok',
        'ranking': ranking,
        'status': _build_world_boss_status_payload(dungeon, player_id),
    }), 200


@api_bp.route('/dungeons/multiplayer/rooms', methods=['POST'])
def create_multiplayer_room():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    dungeon_id = data.get('dungeon_id')
    if not dungeon_id:
        return jsonify({'success': False, 'message': '缂哄皯鍓湰ID'}), 400

    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon:
        return jsonify({'success': False, 'message': 'error'}), 404
    if dungeon.dungeon_type == DungeonType.SINGLE:
        return jsonify({'success': False, 'message': '璇ュ壇鏈笉鏀寔澶氫汉妯″紡'}), 400

    requirements = _multiplayer_requirements(dungeon)
    username = _load_player_username(player_id)
    if not username:
        return jsonify({'success': False, 'message': 'error'}), 404

    capacity = min(int(data.get('capacity', requirements['capacity'])), requirements['capacity'])
    room = room_manager.create_room(
        dungeon_id=dungeon.dungeon_id,
        dungeon_type=dungeon.dungeon_type.value,
        leader_id=player_id,
        leader_name=username,
        capacity=capacity,
        max_characters_per_member=requirements['max_characters_per_member']
    )
    room_payload = room.to_dict()
    broadcast_multiplayer_room_update(room_payload, event_type='created')
    return jsonify({
        'success': True,
        'room': room_payload
    }), 200


@api_bp.route('/dungeons/multiplayer/rooms', methods=['GET'])
def list_multiplayer_rooms():
    _cleanup_multiplayer_rooms_and_broadcast()
    rooms = room_manager.list_rooms()
    return jsonify({
        'success': True,
        'rooms': [room.to_dict() for room in rooms]
    }), 200


@api_bp.route('/dungeons/multiplayer/rooms/current', methods=['GET'])
def get_current_multiplayer_room():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    _cleanup_multiplayer_rooms_and_broadcast()
    room = room_manager.get_player_room(player_id)
    return jsonify({
        'success': True,
        'room': room.to_dict() if room else None
    }), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>', methods=['GET'])
def get_multiplayer_room(room_id: str):
    _cleanup_multiplayer_rooms_and_broadcast()
    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({'success': False, 'message': 'error'}), 404
    return jsonify({'success': True, 'room': room.to_dict()}), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/join', methods=['POST'])
def join_multiplayer_room(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({'success': False, 'message': 'error'}), 404
    if room.status != 'waiting':
        return jsonify({'success': False, 'message': 'error'}), 400

    data = request.get_json() or {}
    character_ids = data.get('character_ids', [])
    if len(character_ids) == 0:
        return jsonify({'success': False, 'message': '璇烽€夋嫨瑙掕壊'}), 400
    if len(character_ids) > room.max_characters_per_member:
        return jsonify({'success': False, 'message': 'error'}), 400
    if not _validate_player_characters(player_id, character_ids):
        return jsonify({'success': False, 'message': '瑙掕壊淇℃伅鏃犳晥'}), 400

    username = _load_player_username(player_id)
    if not username:
        return jsonify({'success': False, 'message': 'error'}), 404

    try:
        updated_room = room_manager.add_or_update_member(room_id, player_id, username, character_ids)
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    room_payload = updated_room.to_dict()
    broadcast_multiplayer_room_update(room_payload, event_type='joined')
    return jsonify({'success': True, 'room': room_payload}), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/ready', methods=['POST'])
def ready_multiplayer_room(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({'success': False, 'message': 'error'}), 404
    if room.status != 'waiting':
        return jsonify({'success': False, 'message': 'error'}), 400

    data = request.get_json() or {}
    is_ready = bool(data.get('is_ready', True))
    character_ids = data.get('character_ids')
    if character_ids:
        if len(character_ids) > room.max_characters_per_member:
            return jsonify({'success': False, 'message': 'error'}), 400
        if not _validate_player_characters(player_id, character_ids):
            return jsonify({'success': False, 'message': '瑙掕壊淇℃伅鏃犳晥'}), 400

    try:
        room = room_manager.set_member_ready(room_id, player_id, is_ready, character_ids)
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    room_payload = room.to_dict()
    broadcast_multiplayer_room_update(room_payload, event_type='ready')
    return jsonify({'success': True, 'room': room_payload}), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/leave', methods=['POST'])
def leave_multiplayer_room(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({'success': False, 'message': 'error'}), 404

    room_manager.remove_member(room_id, player_id)
    remaining_room = room_manager.get_room(room_id)
    if remaining_room:
        broadcast_multiplayer_room_update(remaining_room.to_dict(), event_type='left')
    else:
        broadcast_multiplayer_room_removed(room_id)
    return jsonify({'success': True, 'message': '宸茬寮€鎴块棿'}), 200


# 鍒朵綔鐩稿叧
# 澶氫汉鎴块棿姝ｅ紡鍖栨帴鍙?@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/transfer-leader', methods=['POST'])
def transfer_multiplayer_room_leader(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    data = request.get_json() or {}
    target_player_id = data.get('target_player_id')
    if not target_player_id:
        return jsonify({'success': False, 'message': '缂哄皯鐩爣鐜╁'}), 400
    try:
        room = room_manager.transfer_leader(room_id, player_id, target_player_id)
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    room_payload = room.to_dict()
    broadcast_multiplayer_room_update(room_payload, event_type='leader_transferred')
    return jsonify({'success': True, 'room': room_payload}), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/connection', methods=['POST'])
def update_multiplayer_room_connection(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    data = request.get_json() or {}
    is_online = bool(data.get('is_online', True))
    try:
        room = room_manager.set_member_connection(room_id, player_id, is_online)
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    room_payload = room.to_dict()
    broadcast_multiplayer_room_update(room_payload, event_type='connection')
    return jsonify({'success': True, 'room': room_payload}), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/chat', methods=['GET'])
def list_multiplayer_room_chat(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    room = room_manager.get_room(room_id)
    if not room or player_id not in room.members:
        return jsonify({'success': False, 'message': '鏃犳潈璁块棶鎴块棿鑱婂ぉ'}), 403
    db = get_database()
    db_session = db.get_session()
    try:
        rows = db_session.query(MultiplayerRoomChatModel).filter(
            MultiplayerRoomChatModel.room_id == room_id
        ).order_by(MultiplayerRoomChatModel.created_at.desc()).limit(50).all()
        return jsonify({
            'success': True,
            'messages': [row.to_dict() for row in reversed(rows)]
        }), 200
    finally:
        db_session.close()


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/chat', methods=['POST'])
def send_multiplayer_room_chat(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    room = room_manager.get_room(room_id)
    if not room or player_id not in room.members:
        return jsonify({'success': False, 'message': 'error'}), 403
    data = request.get_json() or {}
    message = str(data.get('message') or '').strip()
    if not message:
        return jsonify({'success': False, 'message': '鑱婂ぉ鍐呭涓嶈兘涓虹┖'}), 400
    if len(message) > 200:
        return jsonify({'success': False, 'message': 'error'}), 400
    username = room.members[player_id].username
    db = get_database()
    db_session = db.get_session()
    try:
        row = MultiplayerRoomChatModel(
            message_id=str(uuid.uuid4()),
            room_id=room_id,
            player_id=player_id,
            username=username,
            message=message
        )
        db_session.add(row)
        db_session.commit()
        payload = row.to_dict()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()
    broadcast_multiplayer_chat(room_id, payload)
    return jsonify({'success': True, 'message': payload}), 200


@api_bp.route('/dungeons/multiplayer/rooms/<room_id>/invite', methods=['POST'])
def invite_multiplayer_room_member(room_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    room = room_manager.get_room(room_id)
    if not room or player_id not in room.members:
        return jsonify({'success': False, 'message': 'error'}), 403
    data = request.get_json() or {}
    invitee_username = str(data.get('username') or '').strip()
    invitee_id = data.get('player_id')
    if not invitee_username and not invitee_id:
        return jsonify({'success': False, 'message': '璇疯緭鍏ラ個璇风帺瀹跺悕鎴朓D'}), 400
    db = get_database()
    db_session = db.get_session()
    try:
        invitee = None
        if invitee_id:
            invitee = db_session.query(PlayerModel).filter(PlayerModel.player_id == invitee_id).first()
        if not invitee and invitee_username:
            invitee = db_session.query(PlayerModel).filter(PlayerModel.username == invitee_username).first()
        if not invitee:
            return jsonify({'success': False, 'message': '琚個璇风帺瀹朵笉瀛樺湪'}), 404
        if invitee.player_id in room.members:
            return jsonify({'success': False, 'message': 'error'}), 400
        invitation = db_session.query(MultiplayerRoomInvitationModel).filter(
            MultiplayerRoomInvitationModel.room_id == room_id,
            MultiplayerRoomInvitationModel.invitee_id == invitee.player_id,
            MultiplayerRoomInvitationModel.status == 'pending'
        ).first()
        if not invitation:
            invitation = MultiplayerRoomInvitationModel(
                invitation_id=str(uuid.uuid4()),
                room_id=room_id,
                inviter_id=player_id,
                invitee_id=invitee.player_id,
                invitee_username=invitee.username,
                status='pending'
            )
            db_session.add(invitation)
        db_session.commit()
        payload = _build_multiplayer_invitation_payload(db_session, invitation)
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()
    broadcast_multiplayer_invitation(room_id, payload)
    return jsonify({'success': True, 'invitation': payload}), 200


@api_bp.route('/dungeons/multiplayer/invitations', methods=['GET'])
def list_multiplayer_invitations():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    _cleanup_multiplayer_rooms_and_broadcast()
    status = request.args.get('status', 'pending')
    db = get_database()
    db_session = db.get_session()
    try:
        query = db_session.query(MultiplayerRoomInvitationModel).filter(
            MultiplayerRoomInvitationModel.invitee_id == player_id
        )
        if status and status != 'all':
            query = query.filter(MultiplayerRoomInvitationModel.status == status)
        rows = query.order_by(MultiplayerRoomInvitationModel.created_at.desc()).limit(30).all()
        changed = False
        for row in rows:
            if row.status == 'pending':
                room = room_manager.get_room(row.room_id)
                if not room or room.status != 'waiting':
                    row.status = 'expired'
                    row.updated_at = datetime.utcnow()
                    changed = True
        if changed:
            db_session.commit()
        invitations = [_build_multiplayer_invitation_payload(db_session, row) for row in rows]
        return jsonify({
            'success': True,
            'invitations': invitations
        }), 200
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()


@api_bp.route('/dungeons/multiplayer/invitations/<invitation_id>/accept', methods=['POST'])
def accept_multiplayer_invitation(invitation_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    _cleanup_multiplayer_rooms_and_broadcast()
    data = request.get_json() or {}
    character_ids = data.get('character_ids') or []
    if not character_ids:
        return jsonify({'success': False, 'message': '璇峰厛閫夋嫨瑕佸姞鍏ユ埧闂寸殑瑙掕壊'}), 400
    if not _validate_player_characters(player_id, character_ids):
        return jsonify({'success': False, 'message': '瑙掕壊淇℃伅鏃犳晥'}), 400

    db = get_database()
    db_session = db.get_session()
    try:
        invitation = db_session.query(MultiplayerRoomInvitationModel).filter(
            MultiplayerRoomInvitationModel.invitation_id == invitation_id,
            MultiplayerRoomInvitationModel.invitee_id == player_id
        ).first()
        if not invitation:
            return jsonify({'success': False, 'message': '閭€璇蜂笉瀛樺湪'}), 404
        if invitation.status != 'pending':
            return jsonify({'success': False, 'message': 'error'}), 400

        room = room_manager.get_room(invitation.room_id)
        if not room or room.status != 'waiting':
            invitation.status = 'expired'
            invitation.updated_at = datetime.utcnow()
            db_session.commit()
            payload = _build_multiplayer_invitation_payload(db_session, invitation)
            broadcast_multiplayer_invitation(invitation.room_id, payload)
            return jsonify({'success': False, 'message': 'error'}), 400

        current_room = room_manager.get_player_room(player_id)
        if current_room and current_room.room_id != room.room_id:
            return jsonify({'success': False, 'message': '浣犲凡缁忓湪鍏朵粬澶氫汉鎴块棿涓紝璇峰厛绂诲紑褰撳墠鎴块棿'}), 400
        if len(character_ids) > room.max_characters_per_member:
            return jsonify({'success': False, 'message': 'error'}), 400

        username = _load_player_username(player_id)
        if not username:
            return jsonify({'success': False, 'message': 'error'}), 404
        try:
            updated_room = room_manager.add_or_update_member(room.room_id, player_id, username, character_ids)
        except ValueError as exc:
            return jsonify({'success': False, 'message': str(exc)}), 400

        invitation.status = 'accepted'
        invitation.updated_at = datetime.utcnow()
        db_session.commit()
        room_payload = updated_room.to_dict()
        invitation_payload = _build_multiplayer_invitation_payload(db_session, invitation)
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()

    broadcast_multiplayer_room_update(room_payload, event_type='invitation_accepted')
    broadcast_multiplayer_invitation(invitation_payload['room_id'], invitation_payload)
    return jsonify({
        'success': True,
        'room': room_payload,
        'invitation': invitation_payload
    }), 200


@api_bp.route('/dungeons/multiplayer/invitations/<invitation_id>/reject', methods=['POST'])
def reject_multiplayer_invitation(invitation_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    db = get_database()
    db_session = db.get_session()
    try:
        invitation = db_session.query(MultiplayerRoomInvitationModel).filter(
            MultiplayerRoomInvitationModel.invitation_id == invitation_id,
            MultiplayerRoomInvitationModel.invitee_id == player_id
        ).first()
        if not invitation:
            return jsonify({'success': False, 'message': '閭€璇蜂笉瀛樺湪'}), 404
        if invitation.status != 'pending':
            return jsonify({'success': False, 'message': 'error'}), 400
        invitation.status = 'rejected'
        invitation.updated_at = datetime.utcnow()
        db_session.commit()
        payload = _build_multiplayer_invitation_payload(db_session, invitation)
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()
    broadcast_multiplayer_invitation(payload['room_id'], payload)
    return jsonify({
        'success': True,
        'invitation': payload
    }), 200


@api_bp.route('/crafting/preview', methods=['POST'])
def preview_crafting():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    crafting_type = data.get('crafting_type')
    attribute_type = _parse_attribute_type(data.get('attribute_type'))
    materials = _get_player_materials(player_id)

    if crafting_type == 'exclusive':
        owned = sum(
            material['count']
            for material in materials.values()
            if material['material_type'] == MaterialType.EXCLUSIVE_ITEM.value
        )
        required = CraftingSystem.EXCLUSIVE_ITEM_MATERIAL_COST
        return jsonify({
            'success': True,
            'preview': {
                'crafting_type': crafting_type,
                'costs': [{
                    'material_type': MaterialType.EXCLUSIVE_ITEM.value,
                    'attribute_type': None,
                    'required': required,
                    'owned': owned,
                    'enough': owned >= required
                }]
            }
        }), 200

    if crafting_type == 'equipment':
        if not attribute_type:
            return jsonify({'success': False, 'message': 'error'}), 400
        owned = sum(
            material['count']
            for material in materials.values()
            if material['material_type'] == MaterialType.EQUIPMENT_SET.value
            and material['attribute_type'] == attribute_type.value
        )
        required = CraftingSystem.EQUIPMENT_SET_MATERIAL_COST
        return jsonify({
            'success': True,
            'preview': {
                'crafting_type': crafting_type,
                'costs': [{
                    'material_type': MaterialType.EQUIPMENT_SET.value,
                    'attribute_type': attribute_type.value,
                    'required': required,
                    'owned': owned,
                    'enough': owned >= required
                }]
            }
        }), 200

    return jsonify({'success': False, 'message': '鍒朵綔绫诲瀷鏃犳晥'}), 400


@api_bp.route('/crafting/exclusive-item', methods=['POST'])
def craft_exclusive_item():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    character_id = data.get('character_id')
    
    if not character_id:
        return jsonify({'success': False, 'message': '缂哄皯瑙掕壊ID'}), 400
    
    player = PlayerManager.get_player_by_id(player_id)
    if not player:
        return jsonify({'success': False, 'message': 'error'}), 404

    db = get_database()
    db_session = db.get_session()
    try:
        character_model = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        if not character_model:
            return jsonify({'success': False, 'message': 'error'}), 404
        character_name = character_model.name
    finally:
        db_session.close()
    
    # 鍒涘缓鏉愭枡鑳屽寘
    from ..rewards.material import MaterialBag
    from ..rewards.material_storage import MaterialStorage
    material_bag = MaterialBag(player_id)
    MaterialStorage.load_materials_to_bag(player_id, material_bag)
    
    # 鍒涘缓鍒朵綔绯荤粺
    crafting = CraftingSystem(player_id, material_bag)
    result = crafting.craft_exclusive_item(character_id)
    
    if result.success and result.item:
        from ..inventory.inventory import InventoryManager, ItemType
        inventory = InventoryManager.get_inventory(player_id)
        item_data = result.item.to_dict()
        item_data['character_id'] = character_id
        item_data['character_name'] = character_name
        item_data['quality'] = 'epic'
        item_data['base_attack_bonus'] = item_data.get('attack_bonus', 100)
        item_data['base_magic_attack_bonus'] = item_data.get('magic_attack_bonus', 100)
        item_data['special_skill'] = _build_exclusive_weapon_skill_template(character_model)
        item_data = _recalculate_exclusive_weapon_data(item_data, 0, 0)
        created_item = inventory.add_item(
            item_type=ItemType.WEAPON,
            item_name=result.item.name,
            item_data=item_data,
            item_subtype="exclusive_weapon"
        )
        item_payload = created_item.to_dict()
        item_payload['exclusive_info'] = _build_exclusive_weapon_info(created_item)
        # 鎵ｉ櫎鏉愭枡
        from ..rewards.material import MaterialType
        if not MaterialStorage.remove_material(
            player_id,
            MaterialType.EXCLUSIVE_ITEM,
            None,
            CraftingSystem.EXCLUSIVE_ITEM_MATERIAL_COST,
            source="crafting",
            description=f"craft {result.item.name}"
        ):
            return jsonify({
                'success': False,
                'message': '鏉愭枡鎵ｉ櫎澶辫触锛岃绋嶅悗閲嶈瘯'
            }), 500
    
    updated_materials = _get_player_materials(player_id)
    
    return jsonify({
        'success': result.success,
        'message': result.message,
        'item': item_payload if result.success and result.item else None,
        'materials': updated_materials
    }), 200 if result.success else 400


@api_bp.route('/exclusive-weapons/status', methods=['GET'])
def exclusive_weapon_status():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    from ..database.models.inventory import InventoryItemModel
    db = get_database()
    db_session = db.get_session()
    try:
        weapons = db_session.query(InventoryItemModel).filter(
            InventoryItemModel.player_id == player_id,
            InventoryItemModel.item_type == 'weapon',
            InventoryItemModel.item_subtype == 'exclusive_weapon'
        ).all()
        return jsonify({
            'success': True,
            'weapons': [
                {
                    **weapon.to_dict(),
                    'exclusive_info': _build_exclusive_weapon_info(weapon)
                }
                for weapon in weapons
            ],
            'materials': _get_player_materials(player_id)
        }), 200
    finally:
        db_session.close()


@api_bp.route('/crafting/equipment-set', methods=['POST'])
def craft_equipment_set():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    attribute_type = data.get('attribute_type')
    profession_category = data.get('profession_category')
    slot = data.get('slot')
    
    if not all([attribute_type, profession_category, slot]):
        return jsonify({'success': False, 'message': '缂哄皯蹇呰鍙傛暟'}), 400
    
    player = PlayerManager.get_player_by_id(player_id)
    if not player:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    # 鍒涘缓鏉愭枡鑳屽寘
    from ..rewards.material import MaterialBag
    from ..rewards.material_storage import MaterialStorage
    from ..attributes.attribute import AttributeType
    from ..characters.equipment import EquipmentSlot
    
    material_bag = MaterialBag(player_id)
    MaterialStorage.load_materials_to_bag(player_id, material_bag)
    
    # 鍒涘缓鍒朵綔绯荤粺
    crafting = CraftingSystem(player_id, material_bag)
    parsed_attribute = _parse_attribute_type(attribute_type)
    if not parsed_attribute:
        return jsonify({'success': False, 'message': 'error'}), 400
    slot_aliases = {
        'HEAD': 'HELMET',
        'SHOULDER': 'ACCESSORY',
        'HANDS': 'GLOVES',
        'FEET': 'BOOTS',
    }
    slot_key = slot_aliases.get(slot, slot)
    if slot_key not in EquipmentSlot.__members__:
        return jsonify({'success': False, 'message': '瑁呭閮ㄤ綅鏃犳晥'}), 400

    result = crafting.craft_equipment_set_piece(
        parsed_attribute,
        profession_category,
        EquipmentSlot[slot_key]
    )
    
    if result.success and result.item:
        from ..inventory.inventory import InventoryManager, ItemType
        inventory = InventoryManager.get_inventory(player_id)
        item_data = result.item.to_dict()
        item_data['attribute_type'] = parsed_attribute.value
        item_data['profession_category'] = profession_category
        item_data['quality'] = 'rare'
        inventory.add_item(
            item_type=ItemType.EQUIPMENT,
            item_name=result.item.name,
            item_data=item_data,
            item_subtype="equipment_set"
        )
        from ..rewards.material import MaterialType
        if not MaterialStorage.remove_material(
            player_id,
            MaterialType.EQUIPMENT_SET,
            parsed_attribute,
            CraftingSystem.EQUIPMENT_SET_MATERIAL_COST,
            source="crafting",
            description=f"craft {result.item.name}"
        ):
            return jsonify({
                'success': False,
                'message': '鏉愭枡鎵ｉ櫎澶辫触锛岃绋嶅悗閲嶈瘯'
            }), 500
    
    updated_materials = _get_player_materials(player_id)
    
    return jsonify({
        'success': result.success,
        'message': result.message,
        'item': result.item.to_dict() if result.item else None,
        'materials': updated_materials
    }), 200 if result.success else 400


# 鍗囩骇鐩稿叧
@api_bp.route('/upgrade/exclusive-item', methods=['POST'])
def upgrade_exclusive_item():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json() or {}
    item_id = data.get('item_id')
    
    if not item_id:
        return jsonify({'success': False, 'message': '缂哄皯鐗╁搧ID'}), 400

    from ..database.models.inventory import InventoryItemModel
    from ..rewards.material_storage import MaterialStorage
    db = get_database()
    db_session = db.get_session()
    try:
        item = db_session.query(InventoryItemModel).filter(
            InventoryItemModel.player_id == player_id,
            InventoryItemModel.item_id == item_id
        ).first()
        if not item:
            return jsonify({'success': False, 'message': 'error'}), 404
        if item.item_type != 'weapon' or item.item_subtype != 'exclusive_weapon':
            return jsonify({'success': False, 'message': '涓嶆槸涓撳睘姝﹀櫒'}), 400

        data = item.item_data or {}
        current_level = int(item.level or 0)
        breakthrough_level = int(data.get('breakthrough_level', 0) or 0)
        max_level = _get_exclusive_weapon_max_level(breakthrough_level)
        if current_level >= max_level:
            return jsonify({
                'success': False,
                'message': 'ok',
                'item': item.to_dict()
            }), 400

        cost = _get_exclusive_weapon_upgrade_cost(current_level)
        if cost <= 0:
            return jsonify({'success': False, 'message': 'error'}), 400
        if not MaterialStorage.remove_material(
            player_id,
            MaterialType.EXCLUSIVE_ITEM,
            None,
            cost,
            source="upgrade",
            description=f"鍗囩骇{item.item_name}"
        ):
            return jsonify({
                'success': False,
                'message': 'ok',
            }), 400

        new_level = current_level + 1
        item.level = new_level
        item.item_data = _recalculate_exclusive_weapon_data(data, new_level, breakthrough_level)
        updated_character = _sync_equipped_exclusive_weapon(db_session, player_id, item)
        db_session.commit()
        item_payload = item.to_dict()
        item_payload['exclusive_info'] = _build_exclusive_weapon_info(item)

        return jsonify({
            'success': True,
            'message': f'涓撳睘姝﹀櫒鍗囩骇鎴愬姛锛屽綋鍓?Lv.{new_level}',
            'new_level': new_level,
            'materials': _get_player_materials(player_id),
            'item': item_payload,
            'character': _character_payload(updated_character) if updated_character else None
        }), 200
    except Exception as exc:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'鍗囩骇澶辫触: {str(exc)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/breakthrough/exclusive-item', methods=['POST'])
def breakthrough_exclusive_item():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    item_id = data.get('item_id')
    if not item_id:
        return jsonify({'success': False, 'message': '缂哄皯鐗╁搧ID'}), 400

    from ..database.models.inventory import InventoryItemModel
    from ..rewards.material_storage import MaterialStorage
    db = get_database()
    db_session = db.get_session()
    try:
        item = db_session.query(InventoryItemModel).filter(
            InventoryItemModel.player_id == player_id,
            InventoryItemModel.item_id == item_id
        ).first()
        if not item:
            return jsonify({'success': False, 'message': 'error'}), 404
        if item.item_type != 'weapon' or item.item_subtype != 'exclusive_weapon':
            return jsonify({'success': False, 'message': '涓嶆槸涓撳睘姝﹀櫒'}), 400

        item_data = item.item_data or {}
        breakthrough_level = int(item_data.get('breakthrough_level', 0) or 0)
        if breakthrough_level >= EXCLUSIVE_WEAPON_MAX_BREAKTHROUGH:
            return jsonify({'success': False, 'message': 'error'}), 400

        current_max_level = _get_exclusive_weapon_max_level(breakthrough_level)
        if int(item.level or 0) < current_max_level:
            return jsonify({
                'success': False,
                'message': f'闇€瑕佸厛鍗囩骇鍒板綋鍓嶄笂闄?Lv.{current_max_level} 鎵嶈兘绐佺牬'
            }), 400

        cost = EXCLUSIVE_WEAPON_BREAKTHROUGH_COSTS[breakthrough_level]
        if not MaterialStorage.remove_material(
            player_id,
            MaterialType.EXCLUSIVE_ITEM,
            None,
            cost,
            source="breakthrough",
            description=f"绐佺牬{item.item_name}"
        ):
            return jsonify({
                'success': False,
                'message': 'ok',
            }), 400

        new_breakthrough_level = breakthrough_level + 1
        item.item_data = _recalculate_exclusive_weapon_data(
            item_data,
            int(item.level or 0),
            new_breakthrough_level
        )
        updated_character = _sync_equipped_exclusive_weapon(db_session, player_id, item)
        db_session.commit()
        item_payload = item.to_dict()
        item_payload['exclusive_info'] = _build_exclusive_weapon_info(item)

        return jsonify({
            'success': True,
            'message': f'涓撳睘姝﹀櫒绐佺牬鎴愬姛锛岀瓑绾т笂闄愭彁鍗囪嚦 Lv.{_get_exclusive_weapon_max_level(new_breakthrough_level)}',
            'breakthrough_level': new_breakthrough_level,
            'materials': _get_player_materials(player_id),
            'item': item_payload,
            'character': _character_payload(updated_character) if updated_character else None
        }), 200
    except Exception as exc:
        db_session.rollback()
        return jsonify({'success': False, 'message': f'绐佺牬澶辫触: {str(exc)}'}), 500
    finally:
        db_session.close()


@api_bp.route('/upgrade/equipment-set', methods=['POST'])
def upgrade_equipment_set():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json()
    item_id = data.get('item_id')
    current_level = data.get('current_level', 0)
    attribute_type = data.get('attribute_type')
    
    if not item_id or not attribute_type:
        return jsonify({'success': False, 'message': '缂哄皯蹇呰鍙傛暟'}), 400
    
    # 浠庢暟鎹簱鍔犺浇鐗╁搧
    from ..inventory.inventory import InventoryManager
    inventory = InventoryManager.get_inventory(player_id)
    
    if item_id not in inventory.items:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    item = inventory.items[item_id]
    if item.item_type != 'equipment':
        return jsonify({'success': False, 'message': '涓嶆槸瑁呭'}), 400
    
    # 鍒涘缓鏉愭枡鑳屽寘
    from ..rewards.material import MaterialBag
    from ..rewards.material_storage import MaterialStorage
    from ..attributes.attribute import AttributeType
    
    material_bag = MaterialBag(player_id)
    MaterialStorage.load_materials_to_bag(player_id, material_bag)
    
    # 鍒涘缓鍗囩骇绯荤粺
    from ..rewards.upgrade import UpgradeSystem
    upgrade = UpgradeSystem(player_id, material_bag)
    
    # 灏嗙墿鍝佸簭鍒楀寲涓洪鍩熷璞?    from ..serialization.item_serializer import ItemSerializer
    equipment = ItemSerializer.to_equipment(item)
    if equipment is None:
        return jsonify({'success': False, 'message': 'error'}), 400

    # 鎵ц鍗囩骇
    parsed_attribute = _parse_attribute_type(attribute_type)
    if not parsed_attribute:
        return jsonify({'success': False, 'message': 'error'}), 400

    result = upgrade.upgrade_equipment_set(equipment, current_level, parsed_attribute)

    if result.success:
        from ..rewards.material import MaterialType
        cost = 0
        if current_level < len(UpgradeSystem.EQUIPMENT_SET_UPGRADE_COSTS):
            cost = UpgradeSystem.EQUIPMENT_SET_UPGRADE_COSTS[current_level]
        if cost > 0 and not MaterialStorage.remove_material(
            player_id,
            MaterialType.EQUIPMENT_SET,
            parsed_attribute,
            cost,
            source="upgrade",
            description=f"鍗囩骇{item.item_name}"
        ):
            return jsonify({
                'success': False,
                'message': '鏉愭枡鎵ｉ櫎澶辫触锛岃绋嶅悗閲嶈瘯'
            }), 500
        # 淇濆瓨鍗囩骇鍚庣瓑绾у埌鐗╁搧
        from ..database import get_database
        db = get_database()
        session_db = db.get_session()
        updated_item_data = None
        try:
            db_item = session_db.merge(item)
            db_item.level = result.new_level
            # 鏇存柊灞炴€т俊鎭?            data = db_item.item_data or {}
            data.update({
                'hp_bonus': equipment.hp_bonus,
                'attack_bonus': equipment.attack_bonus,
                'defense_bonus': equipment.defense_bonus,
                'magic_attack_bonus': getattr(equipment, 'magic_attack_bonus', data.get('magic_attack_bonus')),
                'magic_defense_bonus': getattr(equipment, 'magic_defense_bonus', data.get('magic_defense_bonus'))
            })
            db_item.item_data = data
            updated_item_data = db_item.item_data
            session_db.commit()
        finally:
            session_db.close()
        item.level = result.new_level
        if updated_item_data is not None:
            item.item_data = updated_item_data

    updated_materials = _get_player_materials(player_id)

    return jsonify({
        'success': result.success,
        'message': result.message,
        'new_level': result.new_level if result.success else current_level,
        'materials': updated_materials,
        'item': item.to_dict() if result.success else None
    }), 200 if result.success else 400


# 鍏戞崲鐩稿叧
def _get_illustration_piece_count(player_id: str) -> int:
    materials = _get_player_materials(player_id)
    return sum(
        material['count']
        for material in materials.values()
        if material['material_type'] == MaterialType.ILLUSTRATION_PIECE.value
    )


def _build_illustration_status(character: CharacterModel) -> Dict[str, Any]:
    equipment_data = character.equipment or {}
    illustrations_info = equipment_data.get('illustrations', {})
    if not isinstance(illustrations_info, dict):
        illustrations_info = {}
    unlocked = illustrations_info.get('unlocked', [])
    selected = illustrations_info.get('selected', None)
    selected_id = illustrations_info.get('selected_id')
    if selected and not selected_id:
        selected_id = f"{character.character_id}_{selected}"
    return {
        'character_id': character.character_id,
        'character_name': character.name,
        'unlocked': unlocked,
        'selected': selected,
        'selected_id': selected_id,
        'selected_path': f"illustrations/{character.character_id}_{selected}.png" if selected else None,
        'options': [
            {
                'illustration_id': f"{character.character_id}_male",
                'gender': 'male',
                'name': f"{character.name} Illustration",
                'unlocked': f"{character.character_id}_male" in unlocked
            },
            {
                'illustration_id': f"{character.character_id}_female",
                'gender': 'female',
                'name': f"{character.name} Illustration",
                'unlocked': f"{character.character_id}_female" in unlocked
            }
        ],
        'cost': ExchangeSystem.ILLUSTRATION_PIECE_COST
    }


@api_bp.route('/exchange/illustration/status', methods=['GET'])
def illustration_exchange_status():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    character_id = request.args.get('character_id')
    db = get_database()
    db_session = db.get_session()
    try:
        query = db_session.query(CharacterModel).filter(CharacterModel.player_id == player_id)
        if character_id:
            query = query.filter(CharacterModel.character_id == character_id)
        characters = query.all()
        return jsonify({
            'success': True,
            'material_count': _get_illustration_piece_count(player_id),
            'cost': ExchangeSystem.ILLUSTRATION_PIECE_COST,
            'characters': [_build_illustration_status(character) for character in characters]
        }), 200
    finally:
        db_session.close()


@api_bp.route('/exchange/illustration', methods=['POST'])
def exchange_illustration():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json()
    character_id = data.get('character_id')
    illustration_id = data.get('illustration_id')
    gender = data.get('gender', 'male')
    
    if not all([character_id, illustration_id]):
        return jsonify({'success': False, 'message': '缂哄皯蹇呰鍙傛暟'}), 400
    
    # 浠庢暟鎹簱鍔犺浇瑙掕壊
    db = get_database()
    db_session = db.get_session()
    try:
        char_model = db_session.query(CharacterModel).filter(
            CharacterModel.character_id == character_id,
            CharacterModel.player_id == player_id
        ).first()
        
        if not char_model:
            return jsonify({'success': False, 'message': 'error'}), 404

        equipment_data = char_model.equipment or {}
        illustrations_info = equipment_data.get('illustrations', {})
        if not isinstance(illustrations_info, dict):
            illustrations_info = {}
        unlocked = illustrations_info.get('unlocked', [])
        if illustration_id in unlocked:
            illustrations_info['selected'] = gender
            illustrations_info['selected_id'] = illustration_id
            equipment_data['illustrations'] = illustrations_info
            char_model.equipment = equipment_data
            flag_modified(char_model, 'equipment')
            db_session.commit()
            return jsonify({
                'success': True,
                'message': 'ok',
                'illustration_status': _build_illustration_status(char_model),
                'materials': _get_player_materials(player_id),
                'character': _character_payload(char_model)
            }), 200
        
        # 灏咰haracterModel杞崲涓篊haracter瀵硅薄
        from ..serialization.character_serializer import CharacterSerializer
        character = CharacterSerializer.model_to_domain(char_model)
        
        # 鍒涘缓鏉愭枡鑳屽寘
        from ..rewards.material import MaterialBag
        from ..rewards.material_storage import MaterialStorage
        material_bag = MaterialBag(player_id)
        MaterialStorage.load_materials_to_bag(player_id, material_bag)
        
        # 鍒涘缓鍏戞崲绯荤粺
        exchange = ExchangeSystem(player_id, material_bag)
        
        result = exchange.exchange_illustration(character, illustration_id, gender)

        if result.success and result.illustration:
            from ..rewards.material import MaterialType
            # 鎵ｉ櫎鏉愭枡
            if not MaterialStorage.remove_material(
                player_id,
                MaterialType.ILLUSTRATION_PIECE,
                None,
                ExchangeSystem.ILLUSTRATION_PIECE_COST,
                source="exchange",
                description=f"鍏戞崲{illustration_id}"
            ):
                return jsonify({
                    'success': False,
                    'message': '鏉愭枡鎵ｉ櫎澶辫触锛岃绋嶅悗閲嶈瘯'
                }), 500
            if illustration_id not in unlocked:
                unlocked.append(illustration_id)
            illustrations_info['unlocked'] = unlocked
            illustrations_info['selected'] = gender
            illustrations_info['selected_id'] = illustration_id
            equipment_data['illustrations'] = illustrations_info
            char_model.equipment = equipment_data
            flag_modified(char_model, 'equipment')
            db_session.commit()
            updated_materials = _get_player_materials(player_id)
            return jsonify({
                'success': True,
                'message': result.message,
                'illustration': result.illustration.to_dict(),
                'illustration_status': _build_illustration_status(char_model),
                'materials': updated_materials,
                'character': _character_payload(char_model)
            }), 200

        return jsonify({
            'success': result.success,
            'message': result.message
        }), 400
    finally:
        db_session.close()


# 鑳屽寘鐩稿叧
@api_bp.route('/inventory', methods=['GET'])
def get_inventory():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..inventory.inventory import InventoryManager, ItemType
    
    inventory = InventoryManager.get_inventory(player_id)

    db = get_database()
    db_session = db.get_session()
    try:
        material_models = db_session.query(MaterialModel).filter(
            MaterialModel.player_id == player_id
        ).all()
        materials = [_material_model_to_inventory_item(material) for material in material_models]
    finally:
        db_session.close()

    weapons = [item.to_dict() for item in inventory.get_items_by_type(ItemType.WEAPON)]
    equipment = [item.to_dict() for item in inventory.get_items_by_type(ItemType.EQUIPMENT)]
    items = [item.to_dict() for item in inventory.get_items_by_type(ItemType.ITEM)]
    
    return jsonify({
        'success': True,
        'inventory': {
            'materials': materials,
            'weapons': weapons,
            'equipment': equipment,
            'items': items
        }
    }), 200


@api_bp.route('/inventory/<item_id>/lock', methods=['POST'])
def lock_item(item_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..inventory.inventory import InventoryManager
    inventory = InventoryManager.get_inventory(player_id)
    
    if inventory.lock_item(item_id):
        return jsonify({'success': True, 'message': 'ok'}), 200
    else:
        return jsonify({'success': False, 'message': '閿佸畾澶辫触'}), 400


@api_bp.route('/inventory/<item_id>/unlock', methods=['POST'])
def unlock_item(item_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..inventory.inventory import InventoryManager
    inventory = InventoryManager.get_inventory(player_id)
    
    if inventory.unlock_item(item_id):
        return jsonify({'success': True, 'message': 'ok'}), 200
    else:
        return jsonify({'success': False, 'message': '瑙ｉ攣澶辫触'}), 400


@api_bp.route('/inventory/<item_id>/dismantle', methods=['POST'])
def dismantle_item(item_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..inventory.inventory import InventoryManager
    inventory = InventoryManager.get_inventory(player_id)
    
    result = inventory.dismantle_item(item_id)
    return jsonify(result), 200 if result.get('success') else 400


@api_bp.route('/inventory/<item_id>/dismantle/preview', methods=['GET'])
def preview_dismantle_item(item_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    from ..inventory.inventory import InventoryManager
    inventory = InventoryManager.get_inventory(player_id)
    result = inventory.preview_dismantle_item(item_id)
    return jsonify(result), 200 if result.get('success') else 400


# 绀句氦鐩稿叧
@api_bp.route('/social/friends', methods=['GET'])
def list_friends():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    friend_system = get_friend_system(player_id)
    return jsonify({
        'success': True,
        'friends': friend_system.list_friends(),
        'assist_enabled': friend_system.is_assist_enabled()
    }), 200


@api_bp.route('/social/friends', methods=['POST'])
def add_friend():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    data = request.get_json() or {}
    target_username = data.get('username')
    target_player_id = data.get('player_id')
    if not target_username and not target_player_id:
        return jsonify({'success': False, 'message': '璇锋彁渚涘ソ鍙嬬敤鎴峰悕鎴朓D'}), 400
    if target_player_id == player_id:
        return jsonify({'success': False, 'message': 'error'}), 400
    target_player = None
    if target_player_id:
        target_player = PlayerManager.get_player_by_id(target_player_id)
    elif target_username:
        target_player = PlayerManager.get_player_by_username(target_username)
    if not target_player:
        return jsonify({'success': False, 'message': 'error'}), 404
    if target_player.player_id == player_id:
        return jsonify({'success': False, 'message': 'error'}), 400
    friend_system = get_friend_system(player_id)
    if not friend_system.get_friend(target_player.player_id):
        friend_system.add_friend(target_player.player_id, target_player.username)
    return jsonify({
        'success': True,
        'friends': friend_system.list_friends()
    }), 200


@api_bp.route('/social/friends/<friend_id>', methods=['DELETE'])
def remove_friend(friend_id: str):
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    friend_system = get_friend_system(player_id)
    removed = friend_system.remove_friend(friend_id)
    return jsonify({
        'success': removed,
        'friends': friend_system.list_friends()
    }), 200 if removed else 404


@api_bp.route('/social/assist-mode', methods=['GET', 'POST'])
def assist_mode():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    friend_system = get_friend_system(player_id)
    if request.method == 'POST':
        data = request.get_json() or {}
        enabled = bool(data.get('enabled', False))
        friend_system.set_assist_mode(enabled)
        return jsonify({'success': True, 'assist_enabled': friend_system.is_assist_enabled()}), 200
    return jsonify({'success': True, 'assist_enabled': friend_system.is_assist_enabled()}), 200


# 娲诲姩涓庡晢搴?@api_bp.route('/events/active', methods=['GET'])
def get_active_events():
    # 璇锋眰鏃朵篃妫€鏌ユ椿鍔ㄥ垏鎹紙浣滀负琛ュ厖锛?    from ..events.event_system import event_rotation_manager
    event_rotation_manager.check_and_rotate_events(reason="auto")
    
    events = event_rotation_manager.get_active_events()
    return jsonify({'success': True, 'events': events}), 200


@api_bp.route('/events/rotate', methods=['POST'])
def manual_rotate_event():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    # TODO: 妫€鏌ョ鐞嗗憳鏉冮檺
    # if not is_admin(player_id):
    #     return jsonify({'success': False, 'message': '鏉冮檺涓嶈冻'}), 403
    
    data = request.get_json() or {}
    event_type = data.get('event_type')  # 'team_monthly' 鎴?'server_quarterly'
    target_event_id = data.get('target_event_id')  # 鍙€夛紝鎸囧畾娲诲姩ID
    
    if not event_type:
        return jsonify({'success': False, 'message': '缂哄皯娲诲姩绫诲瀷'}), 400
    
    if event_type not in ['team_monthly', 'server_quarterly']:
        return jsonify({'success': False, 'message': 'error'}), 400
    
    from ..events.event_system import event_rotation_manager
    success = event_rotation_manager.force_rotate_event(
        event_type=event_type,
        target_event_id=target_event_id,
        reason="manual"
    )
    
    if success:
        events = event_rotation_manager.get_active_events()
        return jsonify({
            'success': True,
            'message': 'ok',
            'events': events
        }), 200
    else:
        return jsonify({'success': False, 'message': '娲诲姩鍒囨崲澶辫触'}), 400


@api_bp.route('/shop/items', methods=['GET'])
def get_shop_items():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    items: Dict[str, List[Dict[str, Any]]] = {}
    for item in shop_inventory.items:
        key = item.attribute_type.value
        items.setdefault(key, []).append(_build_shop_item_payload(player_id, item))
    items = dict(sorted(items.items(), key=lambda kv: kv[0]))
    materials = _get_player_materials(player_id)
    return jsonify({
        'success': True,
        'items': items,
        'materials': materials,
        'period_key': _current_shop_period_key()
    }), 200


@api_bp.route('/shop/exchange', methods=['POST'])
def exchange_shop_item():
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    item_id = data.get('item_id')
    if not item_id:
        return jsonify({'success': False, 'message': '缂哄皯鍟嗗搧ID'}), 400

    shop_item = next((item for item in shop_inventory.items if item.item_id == item_id), None)
    if not shop_item:
        return jsonify({'success': False, 'message': 'error'}), 404

    period_key = _current_shop_period_key()
    purchase_limit = _get_shop_limit(item_id)
    purchased_count = _get_shop_purchase_count(player_id, item_id, period_key)
    if purchase_limit and purchased_count >= purchase_limit:
        return jsonify({'success': False, 'message': 'error'}), 400

    if not _spend_material_costs(player_id, shop_item.cost, shop_item.attribute_type):
        return jsonify({'success': False, 'message': 'error'}), 400

    reward: Dict[str, Any]
    if item_id.startswith('equip_'):
        reward = {
            'type': 'equipment',
            'item': _create_shop_equipment(player_id, shop_item.attribute_type)
        }
        message = f"鎴愬姛鍏戞崲{shop_item.name}"
    elif item_id.startswith('material_'):
        from ..rewards.material_storage import MaterialStorage
        MaterialStorage.save_material(
            player_id,
            MaterialType.EQUIPMENT_SET,
            shop_item.attribute_type,
            1,
            source="shop",
            description=f"鍏戞崲{shop_item.name}"
        )
        reward = {
            'type': 'material',
            'material_type': MaterialType.EQUIPMENT_SET.value,
            'attribute_type': shop_item.attribute_type.value,
            'count': 1
        }
        message = f"鎴愬姛鍏戞崲{shop_item.name}"
    else:
        return jsonify({'success': False, 'message': '鍟嗗搧绫诲瀷鏆備笉鏀寔'}), 400

    new_purchase_count = _record_shop_purchase(player_id, item_id, period_key)

    return jsonify({
        'success': True,
        'message': message,
        'reward': reward,
        'materials': _get_player_materials(player_id),
        'purchase': {
            'period_key': period_key,
            'purchase_limit': purchase_limit,
            'purchased_count': new_purchase_count,
            'remaining_count': max(purchase_limit - new_purchase_count, 0) if purchase_limit else None
        }
    }), 200


# 浠诲姟绯荤粺鐩稿叧
_quest_system_registry: Dict[str, QuestSystem] = {}
_achievement_system_registry: Dict[str, AchievementSystem] = {}


def get_quest_system(player_id: str) -> QuestSystem:
    """Docstring."""
    if player_id not in _quest_system_registry:
        quest_system = QuestSystem(player_id)
        # 浠庢暟鎹簱鍔犺浇浠诲姟杩涘害
        from ..game.quest_storage import load_quest_progress
        load_quest_progress(player_id, quest_system)
        _quest_system_registry[player_id] = quest_system
    return _quest_system_registry[player_id]


def get_achievement_system(player_id: str) -> AchievementSystem:
    """Docstring."""
    if player_id not in _achievement_system_registry:
        achievement_system = AchievementSystem(player_id)
        # 浠庢暟鎹簱鍔犺浇鎴愬氨杩涘害
        from ..game.achievement_storage import load_achievement_progress
        load_achievement_progress(player_id, achievement_system)
        _achievement_system_registry[player_id] = achievement_system
    return _achievement_system_registry[player_id]


@api_bp.route('/quests/list', methods=['GET'])
def get_quests():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    quest_type = request.args.get('type')  # main, side, daily, weekly, all
    quest_system = get_quest_system(player_id)
    
    player = PlayerManager.get_player_by_id(player_id)
    
    # 浠庣粺璁¤〃鑾峰彇缁熻鏁版嵁
    from ..game.player_statistics import get_player_statistics
    stats = get_player_statistics(player_id, use_cache=True)
    
    player_data = {
        'level': stats.get('level', player.level if player else 1),
        'battles_completed': stats.get('battles_completed', 0),
        'dungeons_completed': stats.get('dungeons_completed', 0),
    }
    
    available_quests = quest_system.get_available_quests(player_data)
    all_quests = quest_system.get_all_quests()
    
    # 杩囨护浠诲姟绫诲瀷
    if quest_type and quest_type != 'all':
        quest_type_enum = QuestType[quest_type.upper()]
        all_quests = [q for q in all_quests if q.quest_type == quest_type_enum]
    
    return jsonify({
        'success': True,
        'quests': [q.to_dict() for q in all_quests]
    }), 200


@api_bp.route('/quests/<quest_id>/accept', methods=['POST'])
def accept_quest(quest_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    quest_system = get_quest_system(player_id)
    success = quest_system.accept_quest(quest_id)
    
    if success:
        quest = quest_system.get_quest(quest_id)
        # 淇濆瓨浠诲姟杩涘害
        if quest:
            from ..game.quest_storage import save_quest_progress
            save_quest_progress(player_id, quest)
        return jsonify({
            'success': True,
            'message': '浠诲姟鎺ュ彇鎴愬姛',
            'quest': quest.to_dict() if quest else None
        }), 200
    else:
        return jsonify({'success': False, 'message': '浠诲姟鎺ュ彇澶辫触'}), 400


@api_bp.route('/quests/<quest_id>/claim', methods=['POST'])
def claim_quest_reward(quest_id: str):
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    quest_system = get_quest_system(player_id)
    reward = quest_system.claim_quest_reward(quest_id)
    
    if reward:
        # 鍙戞斁濂栧姳
        player = PlayerManager.get_player_by_id(player_id)
        if player:
            player.add_exp(reward.exp)
            player.add_gold(reward.gold)
            # TODO: 鍙戞斁鏉愭枡鍜岀墿鍝?        
        quest = quest_system.get_quest(quest_id)
        # 淇濆瓨浠诲姟杩涘害
        if quest:
            from ..game.quest_storage import save_quest_progress
            save_quest_progress(player_id, quest)
        return jsonify({
            'success': True,
            'message': '濂栧姳棰嗗彇鎴愬姛',
            'reward': reward.to_dict(),
            'quest': quest.to_dict() if quest else None
        }), 200
    else:
        return jsonify({'success': False, 'message': '濂栧姳棰嗗彇澶辫触'}), 400


# 鎴愬氨绯荤粺鐩稿叧
@api_bp.route('/achievements/list', methods=['GET'])
def get_achievements():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    category = request.args.get('category')  # combat, dungeon, character, etc.
    rarity = request.args.get('rarity')  # common, rare, epic, legendary
    
    achievement_system = get_achievement_system(player_id)
    
    achievements = achievement_system.get_all_achievements()
    
    # 杩囨护鍒嗙被
    if category:
        category_enum = AchievementCategory[category.upper()]
        achievements = achievement_system.get_achievements_by_category(category_enum)
    
    # 杩囨护绋€鏈夊害
    if rarity:
        from ..game.achievement_system import AchievementRarity
        rarity_enum = AchievementRarity[rarity.upper()]
        achievements = achievement_system.get_achievements_by_rarity(rarity_enum)
    
    return jsonify({
        'success': True,
        'achievements': [a.to_dict() for a in achievements]
    }), 200


@api_bp.route('/achievements/check', methods=['POST'])
def check_achievements():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    achievement_system = get_achievement_system(player_id)
    
    player = PlayerManager.get_player_by_id(player_id)
    
    # 浠庣粺璁¤〃鑾峰彇缁熻鏁版嵁
    from ..game.player_statistics import get_player_statistics
    stats = get_player_statistics(player_id, use_cache=True)
    
    player_data = {
        'battles_completed': stats.get('battles_completed', 0),
        'dungeons_completed': stats.get('dungeons_completed', 0),
        'character_count': stats.get('character_count', 0),
    }
    
    newly_unlocked = achievement_system.check_achievements(player_data)
    
    return jsonify({
        'success': True,
        'newly_unlocked': [a.to_dict() for a in newly_unlocked],
        'message': 'ok',
    }), 200


# 瑁呭寮哄寲鐩稿叧
@api_bp.route('/equipment/enhance/preview', methods=['POST'])
def preview_enhance_equipment():
    "Text pending.",
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401

    data = request.get_json() or {}
    current_level = int(data.get('current_level', 0))
    player = PlayerManager.get_player_by_id(player_id)
    if not player:
        return jsonify({'success': False, 'message': 'error'}), 404

    materials = _get_player_materials(player_id)
    owned_material = sum(
        material['count']
        for material in materials.values()
        if material['material_type'] == MaterialType.EQUIPMENT_SET.value
    )
    if current_level >= EquipmentEnhancementSystem.MAX_ENHANCEMENT_LEVEL:
        gold_cost = 0
        material_cost = 0
    else:
        gold_cost = EquipmentEnhancementSystem.ENHANCEMENT_COST_BASE * (current_level + 1)
        material_cost = EquipmentEnhancementSystem.ENHANCEMENT_MATERIAL_COST * (current_level + 1)

    preview = {
        'current_level': current_level,
        'next_level': min(current_level + 1, EquipmentEnhancementSystem.MAX_ENHANCEMENT_LEVEL),
        'success_rate': EquipmentEnhancementSystem(player_id, MaterialBag(player_id), player.gold)._get_success_rate(current_level),
        'costs': {
            'gold': {
                'required': gold_cost,
                'owned': player.gold,
                'enough': player.gold >= gold_cost
            },
            'material': {
                'material_type': MaterialType.EQUIPMENT_SET.value,
                'required': material_cost,
                'owned': owned_material,
                'enough': owned_material >= material_cost
            }
        }
    }
    return jsonify({'success': True, 'preview': preview}), 200


@api_bp.route('/equipment/enhance', methods=['POST'])
def enhance_equipment():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    data = request.get_json()
    item_id = data.get('item_id')
    current_level = data.get('current_level', 0)
    
    if not item_id:
        return jsonify({'success': False, 'message': '缂哄皯鐗╁搧ID'}), 400
    
    # 浠庤儗鍖呭姞杞借澶?    from ..inventory.inventory import InventoryManager
    inventory = InventoryManager.get_inventory(player_id)
    
    if item_id not in inventory.items:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    item = inventory.items[item_id]
    if item.item_type != 'equipment':
        return jsonify({'success': False, 'message': '涓嶆槸瑁呭'}), 400
    
    # 鍒涘缓鏉愭枡鑳屽寘
    from ..rewards.material import MaterialBag
    from ..rewards.material_storage import MaterialStorage
    material_bag = MaterialBag(player_id)
    MaterialStorage.load_materials_to_bag(player_id, material_bag)
    
    # 鑾峰彇鐜╁閲戝竵
    player = PlayerManager.get_player_by_id(player_id)
    if not player:
        return jsonify({'success': False, 'message': 'error'}), 404
    
    # 鍒涘缓寮哄寲绯荤粺
    enhancement_system = EquipmentEnhancementSystem(
        player_id, 
        material_bag, 
        gold=player.gold
    )
    
    # 搴忓垪鍖栬澶?    from ..serialization.item_serializer import ItemSerializer
    equipment = ItemSerializer.to_equipment(item)
    if equipment is None:
        return jsonify({'success': False, 'message': 'error'}), 400
    
    # 鎵ц寮哄寲
    result = enhancement_system.enhance_equipment(equipment, current_level)
    
    if result.success:
        # 鎵ｉ櫎閲戝竵鍜屾潗鏂?        gold_cost = result.materials_used.get('gold', 0)
        material_cost = result.materials_used.get('material', 0)
        if gold_cost > 0 and not player.spend_gold(gold_cost, '瑁呭寮哄寲'):
            return jsonify({'success': False, 'message': '閲戝竵鎵ｉ櫎澶辫触锛岃绋嶅悗閲嶈瘯'}), 500
        if material_cost > 0 and not _remove_material_any_attribute(
            player_id,
            MaterialType.EQUIPMENT_SET,
            material_cost,
            source="enhancement",
            description=f"寮哄寲{item.item_name}"
        ):
            if gold_cost > 0:
                player.add_gold(gold_cost, '瑁呭寮哄寲鏉愭枡鎵ｉ櫎澶辫触杩旇繕')
            return jsonify({'success': False, 'message': '鏉愭枡鎵ｉ櫎澶辫触锛岃绋嶅悗閲嶈瘯'}), 500
        
        # 淇濆瓨寮哄寲缁撴灉
        from ..database import get_database
        db = get_database()
        session_db = db.get_session()
        updated_item = None
        try:
            db_item = session_db.merge(item)
            db_item.level = result.new_enhancement_level
            data = db_item.item_data or {}
            data.update({
                'hp_bonus': equipment.hp_bonus,
                'attack_bonus': equipment.attack_bonus,
                'defense_bonus': equipment.defense_bonus,
                'magic_attack_bonus': equipment.magic_attack_bonus,
                'magic_defense_bonus': equipment.magic_defense_bonus
            })
            db_item.item_data = data
            session_db.commit()
            updated_item = db_item.to_dict()
        finally:
            session_db.close()
        
        return jsonify({
            'success': True,
            'message': result.message,
            'new_level': result.new_enhancement_level,
            'equipment': updated_item or item.to_dict(),
            'materials': _get_player_materials(player_id),
            'player': PlayerManager.get_player_by_id(player_id).to_dict()
        }), 200
    else:
        return jsonify({
            'success': False,
            'message': result.message
        }), 400


# 鐜╁缁熻鐩稿叧
@api_bp.route('/player/statistics', methods=['GET'])
def get_player_statistics_api():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    use_cache = request.args.get('use_cache', 'true').lower() == 'true'
    
    from ..game.player_statistics import get_player_statistics
    stats = get_player_statistics(player_id, use_cache=use_cache)
    
    return jsonify({
        'success': True,
        'statistics': stats
    }), 200


@api_bp.route('/player/statistics/sync', methods=['POST'])
def sync_player_statistics():
    """Docstring."""
    player_id = session.get('player_id')
    if not player_id:
        return jsonify({'success': False, 'message': 'error'}), 401
    
    from ..game.player_statistics import sync_statistics_from_database
    success = sync_statistics_from_database(player_id)
    
    if success:
        from ..game.player_statistics import get_player_statistics
        stats = get_player_statistics(player_id, use_cache=True)
        return jsonify({
            'success': True,
            'message': 'ok',
            'statistics': stats
        }), 200
    else:
        return jsonify({
            'success': False,
            'message': '缁熻鏁版嵁鍚屾澶辫触'
        }), 500


# 鍋ュ悍妫€鏌?@api_bp.route('/health', methods=['GET'])
def health():
    "Text pending.",
    return jsonify({
        'success': True,
        'message': 'ok',
        'version': '1.0.0'
    }), 200





