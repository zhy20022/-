"""
物品序列化
InventoryItemModel <-> ExclusiveWeapon/Equipment
"""

from typing import Optional
from ..database.models.inventory import InventoryItemModel
from ..characters.weapon import ExclusiveWeapon
from ..characters.equipment import Equipment, EquipmentSlot, EquipmentSet
from ..attributes.attribute import AttributeType, Attribute


class ItemSerializer:
    """物品序列化器"""

    @staticmethod
    def to_exclusive_weapon(model: InventoryItemModel) -> Optional[ExclusiveWeapon]:
        if model.item_type != 'weapon':
            return None
        data = model.item_data or {}
        weapon = ExclusiveWeapon(
            weapon_id=data.get('weapon_id') or model.item_id,
            name=data.get('name') or model.item_name,
            character_id=data.get('character_id') or data.get('owner_character_id') or '',
            attack_bonus=data.get('attack_bonus', 0),
            magic_attack_bonus=data.get('magic_attack_bonus', 0)
        )
        # 等级等由外部处理
        return weapon

    @staticmethod
    def to_equipment(model: InventoryItemModel) -> Optional[Equipment]:
        if model.item_type != 'equipment':
            return None
        data = model.item_data or {}
        slot_value = data.get('slot') or 'HELMET'
        if isinstance(slot_value, EquipmentSlot):
            slot = slot_value
        elif isinstance(slot_value, str):
            slot_aliases = {
                'HEAD': 'HELMET',
                'SHOULDER': 'ACCESSORY',
                'HANDS': 'GLOVES',
                'FEET': 'BOOTS',
            }
            slot_key = slot_aliases.get(slot_value, slot_value)
            try:
                slot = EquipmentSlot[slot_key]
            except KeyError:
                try:
                    slot = EquipmentSlot(slot_value)
                except ValueError:
                    slot = EquipmentSlot.HELMET
        else:
            slot = EquipmentSlot.HELMET
        equipment = Equipment(
            equipment_id=data.get('equipment_id') or model.item_id,
            name=data.get('name') or model.item_name,
            slot=slot,
            hp_bonus=data.get('hp_bonus', 0),
            attack_bonus=data.get('attack_bonus', 0),
            defense_bonus=data.get('defense_bonus', 0),
            magic_attack_bonus=data.get('magic_attack_bonus', 0),
            magic_defense_bonus=data.get('magic_defense_bonus', 0),
            description=data.get('description', '')
        )
        return equipment



