"""
抽取系统
实现角色抽取、金币消耗、属性池子、战魂系统等
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from ..attributes.attribute import AttributeType
from ..characters.character import Character
import random


class GachaPoolType(Enum):
    """抽取池子类型"""
    FIRE_WOOD_WIND = "火木风池"      # 火、木、风属性池子
    WATER_EARTH_THUNDER = "水土雷池"  # 水、土、雷属性池子
    LIGHT_DARK = "光暗池"           # 光、暗属性池子
    UP_POOL = "UP池"               # 概率提升的up池子


class GachaResult:
    """抽取结果"""
    
    def __init__(
        self,
        character: Character,
        is_duplicate: bool = False,
        essence_gained: int = 0
    ):
        """
        初始化抽取结果
        
        Args:
            character: 抽取到的角色
            is_duplicate: 是否为重复角色
            essence_gained: 获得的精华数量（如果是重复角色）
        """
        self.character = character
        self.is_duplicate = is_duplicate
        self.essence_gained = essence_gained
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "character": self.character.to_dict(),
            "is_duplicate": self.is_duplicate,
            "essence_gained": self.essence_gained
        }


class GachaPool:
    """抽取池子"""
    
    def __init__(
        self,
        pool_type: GachaPoolType,
        characters: List[Character],
        up_characters: List[Character] = None,
        up_rate: float = 0.5
    ):
        """
        初始化抽取池子
        
        Args:
            pool_type: 池子类型
            characters: 角色列表
            up_characters: UP角色列表（概率提升）
        """
        self.pool_type = pool_type
        self.characters = characters
        self.up_characters = up_characters or []
        self.up_rate = max(0.0, min(float(up_rate), 0.95))
    
    def get_random_character(self) -> Character:
        """
        从池子中随机抽取一个角色
        
        Returns:
            抽取到的角色
        """
        if not self.characters or len(self.characters) == 0:
            raise ValueError(f"池子 {self.pool_type.value} 为空，无法抽取角色")
        
        # 根据池子类型分配概率
        if self.pool_type == GachaPoolType.FIRE_WOOD_WIND:
            # 火木风角色各占三分之一
            fire_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.FIRE]
            wood_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.WOOD]
            wind_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.WIND]
            
            # 随机选择属性
            attr_choice = random.choice([AttributeType.FIRE, AttributeType.WOOD, AttributeType.WIND])
            if attr_choice == AttributeType.FIRE:
                return random.choice(fire_chars) if fire_chars else random.choice(self.characters)
            elif attr_choice == AttributeType.WOOD:
                return random.choice(wood_chars) if wood_chars else random.choice(self.characters)
            else:
                return random.choice(wind_chars) if wind_chars else random.choice(self.characters)
        
        elif self.pool_type == GachaPoolType.WATER_EARTH_THUNDER:
            # 水土雷角色各占三分之一
            water_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.WATER]
            earth_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.EARTH]
            thunder_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.THUNDER]
            
            # 随机选择属性
            attr_choice = random.choice([AttributeType.WATER, AttributeType.EARTH, AttributeType.THUNDER])
            if attr_choice == AttributeType.WATER:
                return random.choice(water_chars) if water_chars else random.choice(self.characters)
            elif attr_choice == AttributeType.EARTH:
                return random.choice(earth_chars) if earth_chars else random.choice(self.characters)
            else:
                return random.choice(thunder_chars) if thunder_chars else random.choice(self.characters)
        
        elif self.pool_type == GachaPoolType.LIGHT_DARK:
            # 光暗角色各占二分之一
            light_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.LIGHT]
            dark_chars = [c for c in self.characters if c.attribute.attribute_type == AttributeType.DARK]
            
            # 随机选择属性
            attr_choice = random.choice([AttributeType.LIGHT, AttributeType.DARK])
            if attr_choice == AttributeType.LIGHT:
                return random.choice(light_chars) if light_chars else random.choice(self.characters)
            else:
                return random.choice(dark_chars) if dark_chars else random.choice(self.characters)
        
        elif self.pool_type == GachaPoolType.UP_POOL:
            # UP池子：优先抽取UP角色（概率提升）
            if self.up_characters and random.random() < self.up_rate:
                return random.choice(self.up_characters)
            else:
                return random.choice(self.characters)
        
        # 默认随机选择
        return random.choice(self.characters)


class GachaSystem:
    """抽取系统"""
    
    # 抽取消耗（金币）
    SINGLE_PULL_COST = 1000  # 单抽：1000金币
    TEN_PULL_COST = 10000    # 10连抽：1万金币
    HUNDRED_PULL_COST = 100000  # 100连抽：10万金币
    
    def __init__(self, player_id: str):
        """
        初始化抽取系统
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.owned_characters: Dict[str, Character] = {}  # 已拥有的角色
        self.essence: Dict[AttributeType, int] = {}  # 精华（按属性分类）
        self.battle_soul: Dict[AttributeType, int] = {}  # 战魂等级（按属性分类）
    
    @staticmethod
    def get_gold_cost(pull_count: int) -> int:
        """
        获取抽取消耗的金币（静态方法）
        
        Args:
            pull_count: 抽取次数
            
        Returns:
            消耗的金币数量
        """
        if pull_count == 100:
            return GachaSystem.HUNDRED_PULL_COST
        elif pull_count == 10:
            return GachaSystem.TEN_PULL_COST
        else:
            return GachaSystem.SINGLE_PULL_COST * pull_count
    
    def pull(
        self,
        pool: GachaPool,
        pull_count: int = 1,
        player_gold: int = 0
    ) -> List[GachaResult]:
        """
        抽取角色
        
        Args:
            pool: 抽取池子
            pull_count: 抽取次数（1、10、100）
            player_gold: 玩家金币数量
            
        Returns:
            抽取结果列表
        """
        # 检查金币是否足够
        cost = self.get_gold_cost(pull_count)
        if player_gold < cost:
            raise ValueError(f"金币不足！需要 {cost} 金币，当前只有 {player_gold} 金币")
        
        results = []
        
        for _ in range(pull_count):
            # 从池子中随机抽取角色（允许重复抽取已拥有的角色）
            character = pool.get_random_character()
            
            # 检查是否为重复角色（判断是否已经拥有）
            is_duplicate = character.character_id in self.owned_characters
            essence_gained = 0
            
            if is_duplicate:
                # 重复角色：转化为对应属性的战魂精华
                attribute_type = character.attribute.attribute_type
                essence_gained = 1  # 每个重复角色获得1个精华
                if attribute_type not in self.essence:
                    self.essence[attribute_type] = 0
                self.essence[attribute_type] += essence_gained
            else:
                # 新角色：添加到已拥有列表（后续会保存到数据库）
                self.owned_characters[character.character_id] = character
            
            results.append(GachaResult(character, is_duplicate, essence_gained))
        
        return results
    
    # 战魂等级配置
    # 等级：0(未激活), 1, 2, 3, 4, 5
    # 等级1-5对应的加成：6%, 12%, 25%, 50%, 100%
    # 升级到等级1-5需要的精华数：25, 50, 100, 200, 400
    BATTLE_SOUL_LEVELS = [
        {"level": 0, "bonus": 0.00, "cost": 0},      # 未激活
        {"level": 1, "bonus": 0.06, "cost": 25},     # 6%加成，需要25精华
        {"level": 2, "bonus": 0.12, "cost": 50},     # 12%加成，需要50精华
        {"level": 3, "bonus": 0.25, "cost": 100},    # 25%加成，需要100精华
        {"level": 4, "bonus": 0.50, "cost": 200},    # 50%加成，需要200精华
        {"level": 5, "bonus": 1.00, "cost": 400},    # 100%加成，需要400精华
    ]
    MAX_BATTLE_SOUL_LEVEL = 5
    
    @staticmethod
    def get_max_essence_needed() -> int:
        """
        获取升级到5级满级所需的总精华数
        
        Returns:
            总精华数（25+50+100+200+400=775）
        """
        return 25 + 50 + 100 + 200 + 400  # 775
    
    def get_battle_soul_upgrade_cost(self, current_level: int) -> int:
        """
        获取升级到下一级所需的精华数
        
        Args:
            current_level: 当前等级 (0-5)
            
        Returns:
            升级所需的精华数，如果已满级返回0
        """
        if current_level >= self.MAX_BATTLE_SOUL_LEVEL:
            return 0
        next_level = current_level + 1
        for level_config in self.BATTLE_SOUL_LEVELS:
            if level_config["level"] == next_level:
                return level_config["cost"]
        return 0
    
    def upgrade_battle_soul(self, attribute_type: AttributeType) -> Dict[str, Any]:
        """
        提升战魂等级到下一级
        
        Args:
            attribute_type: 属性类型
            
        Returns:
            升级结果字典，包含 success, message, new_level, cost 等
        """
        if attribute_type not in self.essence:
            self.essence[attribute_type] = 0
        
        if attribute_type not in self.battle_soul:
            self.battle_soul[attribute_type] = 0
        
        current_level = self.battle_soul[attribute_type]
        
        # 检查是否已满级
        if current_level >= self.MAX_BATTLE_SOUL_LEVEL:
            return {
                "success": False,
                "message": f"战魂已达到最高等级（{self.MAX_BATTLE_SOUL_LEVEL}级）",
                "current_level": current_level,
                "cost": 0
            }
        
        # 获取升级所需精华
        cost = self.get_battle_soul_upgrade_cost(current_level)
        
        # 检查精华是否足够
        if self.essence[attribute_type] < cost:
            return {
                "success": False,
                "message": f"精华不足！升级需要 {cost} 精华，当前只有 {self.essence[attribute_type]} 精华",
                "current_level": current_level,
                "cost": cost,
                "essence_available": self.essence[attribute_type]
            }
        
        # 消耗精华并升级
        self.essence[attribute_type] -= cost
        self.battle_soul[attribute_type] += 1
        new_level = self.battle_soul[attribute_type]
        
        # 获取新等级的加成
        bonus = self.BATTLE_SOUL_LEVELS[new_level]["bonus"]
        
        return {
            "success": True,
            "message": f"战魂升级成功！当前等级：{new_level}级（加成：{bonus*100:.0f}%）",
            "current_level": new_level,
            "cost": cost,
            "bonus": bonus,
            "essence_remaining": self.essence[attribute_type]
        }
    
    def get_battle_soul_bonus(self, attribute_type: AttributeType) -> Dict[str, float]:
        """
        获取战魂加成（提升对应整个属性的数值加成）
        
        Args:
            attribute_type: 属性类型
            
        Returns:
            加成字典（如：{"attack": 0.06, "defense": 0.06} 表示攻击力和防御力+6%）
        """
        level = self.battle_soul.get(attribute_type, 0)
        
        # 根据等级获取加成百分比
        for level_config in self.BATTLE_SOUL_LEVELS:
            if level_config["level"] == level:
                bonus = level_config["bonus"]
                return {
                    "attack": bonus,
                    "defense": bonus,
                    "magic_attack": bonus,
                    "magic_defense": bonus,
                    "hp": bonus
                }
        
        # 如果找不到，返回0加成
        return {
            "attack": 0.0,
            "defense": 0.0,
            "magic_attack": 0.0,
            "magic_defense": 0.0,
            "hp": 0.0
        }
    
    def get_battle_soul_info(self, attribute_type: AttributeType) -> Dict[str, Any]:
        """
        获取战魂详细信息
        
        Args:
            attribute_type: 属性类型
            
        Returns:
            战魂信息字典
        """
        level = self.battle_soul.get(attribute_type, 0)
        essence_count = self.essence.get(attribute_type, 0)
        bonus = self.BATTLE_SOUL_LEVELS[level]["bonus"] if level < len(self.BATTLE_SOUL_LEVELS) else 0.0
        upgrade_cost = self.get_battle_soul_upgrade_cost(level)
        can_upgrade = level < self.MAX_BATTLE_SOUL_LEVEL and essence_count >= upgrade_cost
        
        return {
            "level": level,
            "essence_count": essence_count,
            "bonus": bonus,
            "upgrade_cost": upgrade_cost,
            "can_upgrade": can_upgrade,
            "max_level": self.MAX_BATTLE_SOUL_LEVEL
        }
    
    def get_essence_count(self, attribute_type: AttributeType) -> int:
        """获取精华数量"""
        return self.essence.get(attribute_type, 0)
    
    def get_battle_soul_level(self, attribute_type: AttributeType) -> int:
        """获取战魂等级"""
        return self.battle_soul.get(attribute_type, 0)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "owned_characters_count": len(self.owned_characters),
            "essence": {attr.value: count for attr, count in self.essence.items()},
            "battle_soul": {attr.value: level for attr, level in self.battle_soul.items()}
        }

