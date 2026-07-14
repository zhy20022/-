# API 参考文档

## 职业系统 API

### `get_profession(profession_type: ProfessionType) -> Profession`

获取职业实例。

**参数**：
- `profession_type`: 职业类型枚举

**返回**：`Profession` 对象

**示例**：
```python
from classes.profession import ProfessionType, get_profession

profession = get_profession(ProfessionType.PHYSICAL_TANK)
print(profession.base_hp)  # 2000
```

### `Profession` 类

职业类，包含职业的基础属性。

**属性**：
- `profession_type`: 职业类型
- `base_hp`: 基础生命值
- `base_attack`: 基础物理攻击
- `base_defense`: 基础物理防御
- `base_magic_attack`: 基础魔法攻击
- `base_magic_defense`: 基础魔法防御

**方法**：
- `is_physical() -> bool`: 判断是否为物理职业
- `is_magic() -> bool`: 判断是否为法系职业
- `is_tank() -> bool`: 判断是否为坦克职业
- `is_dps() -> bool`: 判断是否为输出职业

---

## 属性系统 API

### `Attribute(attribute_type: AttributeType)`

属性类。

**参数**：
- `attribute_type`: 属性类型枚举

**方法**：
- `is_counter_to(other: Attribute) -> bool`: 判断是否克制目标属性
- `is_countered_by(other: Attribute) -> bool`: 判断是否被目标属性克制
- `calculate_damage_multiplier(defender: Attribute) -> float`: 计算伤害倍率

**示例**：
```python
from attributes.attribute import Attribute, AttributeType

fire = Attribute(AttributeType.FIRE)
wood = Attribute(AttributeType.WOOD)

multiplier = fire.calculate_damage_multiplier(wood)  # 1.5 (克制)
```

### `get_attribute_advantage(attacker: AttributeType, defender: AttributeType) -> float`

获取属性相克倍率（便捷函数）。

**参数**：
- `attacker`: 攻击方属性类型
- `defender`: 防御方属性类型

**返回**：伤害倍率（float）

---

## 角色系统 API

### `Character`

角色类。

**初始化参数**：
- `character_id`: 角色ID
- `name`: 角色名称
- `profession`: 职业对象
- `attribute`: 属性对象
- `version`: 游戏版本对象
- `level`: 等级（默认1）
- `exp`: 经验值（默认0）

**方法**：
- `add_illustration(illustration: Illustration)`: 添加立绘
- `select_illustration(gender: IllustrationGender)`: 选择立绘
- `equip_weapon(weapon: ExclusiveWeapon)`: 装备专属武器
- `equip_set(equipment_set: EquipmentSet)`: 装备套装
- `gain_exp(exp_amount: int) -> bool`: 获得经验值（返回是否升级）
- `is_max_level() -> bool`: 检查是否满级
- `can_use_in_version(version: GameVersion) -> bool`: 检查是否可在版本中使用

**属性**：
- `hp`: 生命值
- `attack`: 物理攻击
- `defense`: 物理防御
- `magic_attack`: 魔法攻击
- `magic_defense`: 魔法防御

---

## 游戏模式 API

### `SoloMode`

单人野外模式。

**方法**：
- `can_access(player_level: int) -> bool`: 检查是否可以访问
- `get_rewards() -> Dict`: 获取奖励信息
- `calculate_rewards(player_level: int, difficulty: int) -> Dict`: 计算奖励

### `FivePlayerTeam`

五人小队模式。

**方法**：
- `add_member(character: Character) -> bool`: 添加成员
- `remove_member(character: Character) -> bool`: 移除成员
- `is_team_full() -> bool`: 检查团队是否已满
- `is_team_ready() -> bool`: 检查团队是否准备就绪
- `get_rewards() -> Dict`: 获取奖励信息

### `TwentyPlayerTeam`

二十人团队模式。

**方法**：同 `FivePlayerTeam`

### `ServerEvent`

全服活动模式。

**方法**：
- `start_event(duration_days: int)`: 开始活动
- `end_event()`: 结束活动
- `is_event_active() -> bool`: 检查活动是否进行中
- `get_event_status() -> Dict`: 获取活动状态
- `calculate_rewards(contribution: float) -> Dict`: 根据贡献度计算奖励

---

## 版本系统 API

### `GameVersion`

游戏版本类。

**初始化参数**：
- `version_id`: 版本ID
- `version_name`: 版本名称
- `era_name`: 纪元名称
- `era_year`: 纪元年份（0-99）
- `release_date`: 发布日期
- `description`: 版本描述

**方法**：
- `add_character(character: Character)`: 添加角色
- `can_use_character(character: Character) -> bool`: 检查角色是否可用

### `VersionManager`

版本管理器。

**方法**：
- `add_version(version: GameVersion)`: 添加版本
- `set_current_version(version: GameVersion)`: 设置当前版本
- `get_current_version() -> GameVersion`: 获取当前版本
- `get_version_by_id(version_id: str) -> GameVersion`: 根据ID获取版本
- `update_to_new_version(new_version: GameVersion)`: 更新到新版本
- `can_character_use_in_version(character: Character, version: GameVersion) -> bool`: 检查角色是否可在版本中使用

---

## 装备系统 API

### `ExclusiveWeapon`

专属武器类。

**初始化参数**：
- `weapon_id`: 武器ID
- `name`: 武器名称
- `character_id`: 所属角色ID
- `attack_bonus`: 物理攻击加成
- `magic_attack_bonus`: 魔法攻击加成
- `description`: 武器描述
- `special_skill`: 特殊技能（字典）

**方法**：
- `get_weapon_skill() -> Dict`: 获取武器技能

### `EquipmentSet`

装备套装类。

**初始化参数**：
- `set_id`: 套装ID
- `name`: 套装名称
- `pieces`: 套装部件列表
- `set_bonus_2`: 2件套加成（字典）
- `set_bonus_4`: 4件套加成（字典）
- `set_bonus_6`: 6件套加成（字典）

**方法**：
- `equip_piece(equipment: Equipment) -> bool`: 装备部件
- `unequip_piece(equipment: Equipment) -> bool`: 卸下部件
- `get_equipped_count() -> int`: 获取已装备数量
- `get_set_bonus() -> Dict`: 获取套装加成
- `is_complete() -> bool`: 检查是否完整（6件）

---

## 立绘系统 API

### `Illustration`

立绘类。

**初始化参数**：
- `illustration_id`: 立绘ID
- `character_id`: 角色ID
- `gender`: 立绘性别（`IllustrationGender` 枚举）
- `image_path`: 图片路径
- `name`: 立绘名称

### `IllustrationGender`

立绘性别枚举：
- `MALE`: 男
- `FEMALE`: 女

---

## 使用示例

### 创建角色

```python
from classes.profession import ProfessionType, get_profession
from attributes.attribute import Attribute, AttributeType
from characters.character import Character
from versions.version import GameVersion
from datetime import datetime

# 创建版本
version = GameVersion(
    version_id="v1.0",
    version_name="第一纪元",
    era_name="初始纪元",
    era_year=0,
    release_date=datetime.now()
)

# 创建角色
profession = get_profession(ProfessionType.PHYSICAL_TANK)
attribute = Attribute(AttributeType.FIRE)

character = Character(
    character_id="char_001",
    name="火焰守护者",
    profession=profession,
    attribute=attribute,
    version=version,
    level=1
)
```

### 装备武器和套装

```python
from characters.weapon import ExclusiveWeapon
from characters.equipment import Equipment, EquipmentSet, EquipmentSlot

# 装备专属武器
weapon = ExclusiveWeapon(
    weapon_id="weapon_001",
    name="烈焰之盾",
    character_id="char_001",
    attack_bonus=150
)
character.equip_weapon(weapon)

# 装备套装
pieces = [
    Equipment("eq_001", "头盔", EquipmentSlot.HELMET, hp_bonus=200),
    # ... 其他部件
]
equipment_set = EquipmentSet("set_001", "守护者套装", pieces)
for piece in pieces:
    equipment_set.equip_piece(piece)
character.equip_set(equipment_set)
```

### 参与游戏模式

```python
from game_modes.solo_mode import SoloMode
from game_modes.team_mode import FivePlayerTeam

# 单人模式
solo = SoloMode()
if solo.can_access(character.level):
    rewards = solo.calculate_rewards(character.level, difficulty=1)
    character.gain_exp(rewards["exp"])

# 五人小队
team = FivePlayerTeam()
if team.can_access(character.level):
    team.add_member(character)
    if team.is_team_ready():
        rewards = team.get_rewards()
```








