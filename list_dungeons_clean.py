"""
列出所有副本信息（清晰格式）
"""
from src.dungeons.dungeon_database import get_all_dungeons

dungeons = get_all_dungeons()

print("\n" + "=" * 100)
print("副本列表（共32个副本）".center(100))
print("=" * 100 + "\n")

# 按属性分组
attributes_order = ["火", "木", "风", "水", "土", "雷", "光", "暗"]
attr_map = {
    "火": "FIRE", "木": "WOOD", "风": "WIND", "水": "WATER",
    "土": "EARTH", "雷": "THUNDER", "光": "LIGHT", "暗": "DARK"
}

type_names = {
    "1人本": "SINGLE",
    "5人本": "SQUAD", 
    "20人本": "TEAM",
    "世界boss本": "SERVER_BOSS"
}

# 统计信息
print(f"{'属性':<8} {'类型':<12} {'副本ID':<35} {'时长':<10} {'奖励类型':<20}")
print("-" * 100)

for attr_cn in attributes_order:
    attr_en = attr_map[attr_cn]
    
    # 获取该属性的所有副本
    attr_dungeons = [d for d in dungeons if d.attribute_type.value == attr_cn]
    
    for dungeon in attr_dungeons:
        type_cn = dungeon.dungeon_type.value
        duration_min = f"{dungeon.duration/60:.1f}分钟"
        reward_type = dungeon.reward_config.get('type', '未知')
        
        print(f"{attr_cn:<8} {type_cn:<12} {dungeon.dungeon_id:<35} {duration_min:<10} {reward_type:<20}")

print("-" * 100)
print(f"\n总计: {len(dungeons)} 个副本\n")

# 按类型统计
type_count = {}
for dungeon in dungeons:
    dt = dungeon.dungeon_type.value
    type_count[dt] = type_count.get(dt, 0) + 1

print("按类型统计:")
for dt in ["1人本", "5人本", "20人本", "世界boss本"]:
    if dt in type_count:
        print(f"  {dt}: {type_count[dt]}个")

# 按属性统计
print("\n按属性统计:")
for attr_cn in attributes_order:
    count = len([d for d in dungeons if d.attribute_type.value == attr_cn])
    print(f"  {attr_cn}系: {count}个")

print("\n" + "=" * 100)
print("\n详细说明:")
print("=" * 100)
print("""
副本类型说明:
  - 1人本: 单人副本，产出经验值，时长1分钟
  - 5人本: 小队副本，产出专属道具材料，时长2分钟
  - 20人本: 团队副本，产出装备材料，时长3分钟
  - 世界boss本: 世界Boss副本，产出立绘拼图碎片，时长3分钟

解锁条件:
  - 1人本: 无条件解锁
  - 5人本: 需要5个满级角色（单人模式）
  - 20人本: 需要通关对应属性的5人本，且拥有5个不同职业的满级角色
  - 世界boss本: 需要20个满级角色

奖励说明:
  - experience: 经验值奖励
  - exclusive_material: 专属道具材料
  - equipment_material: 装备材料
  - illustration_piece: 立绘拼图碎片
""")











