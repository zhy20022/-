"""
背包系统模块
实现物品管理、锁定、分解等
"""

from .inventory import Inventory, InventoryManager, ItemType

__all__ = [
    'Inventory',
    'InventoryManager',
    'ItemType'
]


