"""
角色序列化
CharacterModel <-> Character
"""

from typing import Any, Dict, List, Optional
from ..database.models.character import CharacterModel
from ..characters.character import Character
from ..characters.equipment import Equipment, EquipmentSet, EquipmentSlot
from ..characters.weapon import ExclusiveWeapon
from ..classes.profession import get_profession, ProfessionType
from ..attributes.attribute import Attribute, AttributeType
from ..versions.version import GameVersion
from datetime import datetime


STAT_KEYS = ("hp", "attack", "defense", "magic_attack", "magic_defense")


def _get_stat(source: Dict[str, Any], key: str) -> int:
    stats = source.get("stats") or {}
    item_data = source.get("item_data") or {}
    bonus_key = f"{key}_bonus"
    return int(
        stats.get(key)
        or item_data.get(bonus_key)
        or source.get(bonus_key)
        or 0
    )


def _normalize_slot(slot_value: Any) -> EquipmentSlot:
    if isinstance(slot_value, EquipmentSlot):
        return slot_value
    aliases = {
        "HEAD": "HELMET",
        "HELMET": "HELMET",
        "头盔": "HELMET",
        "CHEST": "CHEST",
        "胸甲": "CHEST",
        "LEGS": "LEGS",
        "护腿": "LEGS",
        "BOOTS": "BOOTS",
        "FEET": "BOOTS",
        "靴子": "BOOTS",
        "GLOVES": "GLOVES",
        "HANDS": "GLOVES",
        "手套": "GLOVES",
        "ACCESSORY": "ACCESSORY",
        "SHOULDER": "ACCESSORY",
        "饰品": "ACCESSORY",
    }
    key = aliases.get(str(slot_value or "").upper(), aliases.get(str(slot_value or ""), "HELMET"))
    return EquipmentSlot[key]


def _weapon_from_payload(payload: Optional[Dict[str, Any]], character_id: str) -> Optional[ExclusiveWeapon]:
    if not isinstance(payload, dict):
        return None
    item_data = payload.get("item_data") or {}
    return ExclusiveWeapon(
        weapon_id=payload.get("item_id") or item_data.get("weapon_id") or "",
        name=payload.get("name") or item_data.get("name") or "专属武器",
        character_id=item_data.get("character_id") or item_data.get("owner_character_id") or character_id,
        attack_bonus=_get_stat(payload, "attack"),
        magic_attack_bonus=_get_stat(payload, "magic_attack"),
        description=item_data.get("description", ""),
        special_skill=item_data.get("special_skill"),
    )


def _equipment_from_payload(payload: Dict[str, Any]) -> Equipment:
    item_data = payload.get("item_data") or {}
    return Equipment(
        equipment_id=payload.get("item_id") or item_data.get("equipment_id") or "",
        name=payload.get("name") or item_data.get("name") or "装备",
        slot=_normalize_slot(payload.get("slot") or item_data.get("slot")),
        hp_bonus=_get_stat(payload, "hp"),
        attack_bonus=_get_stat(payload, "attack"),
        defense_bonus=_get_stat(payload, "defense"),
        magic_attack_bonus=_get_stat(payload, "magic_attack"),
        magic_defense_bonus=_get_stat(payload, "magic_defense"),
        description=item_data.get("description", ""),
    )


def _equipment_set_from_payload(payload: Any) -> Optional[EquipmentSet]:
    if not isinstance(payload, dict):
        return None
    if payload.get("name") and payload.get("pieces"):
        piece_payloads = payload.get("pieces") or []
    else:
        piece_payloads = [piece for piece in payload.values() if isinstance(piece, dict)]
    pieces: List[Equipment] = [_equipment_from_payload(piece) for piece in piece_payloads]
    if not pieces:
        return None
    item_data = payload.get("item_data") or {}
    equipment_set = EquipmentSet(
        set_id=payload.get("set_id") or item_data.get("set_id") or "equipped_set",
        name=payload.get("name") or "已穿戴套装",
        pieces=pieces,
        set_bonus_2=payload.get("set_bonus_2") or item_data.get("set_bonus_2") or {},
        set_bonus_4=payload.get("set_bonus_4") or item_data.get("set_bonus_4") or {},
        set_bonus_6=payload.get("set_bonus_6") or item_data.get("set_bonus_6") or {},
        description=payload.get("description") or item_data.get("description", ""),
    )
    for piece in pieces:
        equipment_set.equip_piece(piece)
    return equipment_set


class CharacterSerializer:
    """角色序列化器"""

    @staticmethod
    def model_to_domain(model: CharacterModel) -> Character:
        """
        将数据库模型转换为领域对象Character
        """
        try:
            profession_type = ProfessionType(model.profession_type)
        except ValueError:
            profession_type = ProfessionType.PHYSICAL_MELEE_DPS
        try:
            attribute_type = AttributeType(model.attribute_type)
        except ValueError:
            attribute_type = AttributeType.FIRE

        profession = get_profession(profession_type)
        attribute = Attribute(attribute_type)
        version_id = model.version_id or "v1.0"
        version = GameVersion(
            version_id=version_id,
            version_name=f"Version {version_id}",
            era_name="初始纪元",
            era_year=0,
            release_date=datetime.utcnow()
        )

        character = Character(
            character_id=model.character_id,
            name=model.name,
            profession=profession,
            attribute=attribute,
            version=version,
            level=model.level,
            exp=model.exp
        )

        equipment = model.equipment or {}
        character.saved_equipment = equipment
        character.exclusive_weapon = _weapon_from_payload(equipment.get("weapon"), model.character_id)
        character.equipment_set = _equipment_set_from_payload(equipment.get("equipment_set"))
        if character.exclusive_weapon or character.equipment_set:
            character._calculate_stats()

        stats = model.stats or {}
        if stats:
            character.hp = int(stats.get('hp', character.hp) or 0)
            character.attack = int(stats.get('attack', character.attack) or 0)
            character.defense = int(stats.get('defense', character.defense) or 0)
            character.magic_attack = int(stats.get('magic_attack', character.magic_attack) or 0)
            character.magic_defense = int(stats.get('magic_defense', character.magic_defense) or 0)

        skills = model.skills or {}
        character.saved_skills = skills
        character.saved_skill_slots = skills.get('skill_slots')
        return character

    @staticmethod
    def domain_to_model_dict(character: Character) -> Dict[str, Any]:
        """
        将领域对象Character转换为可用于持久化的字典
        """
        return {
            'character_id': character.character_id,
            'name': character.name,
            'profession_type': character.profession.profession_type.value,
            'attribute_type': character.attribute.attribute_type.value,
            'version_id': character.version.version_id,
            'level': character.level,
            'exp': character.exp,
            'stats': {
                'hp': character.hp,
                'attack': character.attack,
                'defense': character.defense,
                'magic_attack': character.magic_attack,
                'magic_defense': character.magic_defense
            },
            'equipment': getattr(character, 'saved_equipment', {}),
            'skills': getattr(character, 'saved_skills', {})
        }



