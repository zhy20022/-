"""
列出所有副本信息
"""
from src.dungeons.dungeon_database import get_all_dungeons

print("=" * 80)
print("副本列表（共32个副本）")
print("=" * 80)
print()

dungeons = get_all_dungeons()

# 按属性分组
attributes = {}
for dungeon in dungeons:
    attr = dungeon.attribute_type.value
    if attr not in attributes:
        attributes[attr] = []
    attributes[attr].append(dungeon)

# 按属性顺序显示
attr_order = ["火", "木", "风", "水", "土", "雷", "光", "暗"]

for attr in attr_order:
    if attr not in attributes:
        continue
    
    print(f"\n【{attr}系副本】")
    print("-" * 80)
    
    for dungeon in attributes[attr]:
        dungeon_type_name = dungeon.dungeon_type.value
        print(f"  ID: {dungeon.dungeon_id}")
        print(f"  名称: {dungeon.name}")
        print(f"  类型: {dungeon_type_name}")
        print(f"  时长: {dungeon.duration}秒 ({dungeon.duration/60:.1f}分钟)")
        print(f"  描述: {dungeon.description}")
        print(f"  奖励类型: {dungeon.reward_config.get('type', '未知')}")
        print()

print("=" * 80)
print(f"总计: {len(dungeons)} 个副本")
print("=" * 80)

# 按类型统计
type_count = {}
for dungeon in dungeons:
    dt = dungeon.dungeon_type.value
    type_count[dt] = type_count.get(dt, 0) + 1

print("\n按类型统计:")
for dt, count in type_count.items():
    print(f"  {dt}: {count}个")











