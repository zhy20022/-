"""
详细测试数据库连接
"""

import traceback
import sys

def test_database_detailed():
    """详细测试数据库连接"""
    print("=" * 60)
    print("详细数据库连接测试")
    print("=" * 60)
    print()
    
    try:
        print("步骤 1: 导入数据库模块...")
        from src.database.models import Base
        print("[OK] Base 导入成功")
        
        print("\n步骤 2: 导入所有模型...")
        from src.database.models import (
            PlayerModel, CharacterModel, DungeonProgressModel,
            MaterialModel, GoldModel, InventoryItemModel,
            QuestProgressModel, AchievementProgressModel,
            EventRotationHistoryModel, PlayerStatisticsModel,
            MonsterKillModel
        )
        print("[OK] 所有模型导入成功")
        
        print("\n步骤 3: 检查 Base.metadata...")
        print(f"Base.metadata 类型: {type(Base.metadata)}")
        print(f"Base.metadata.tables 数量: {len(Base.metadata.tables)}")
        print("[OK] Base.metadata 检查通过")
        
        print("\n步骤 4: 导入数据库类...")
        from src.database import Database, init_database
        print("[OK] 数据库类导入成功")
        
        print("\n步骤 5: 创建数据库实例...")
        import os
        database_url = os.getenv(
            'DATABASE_URL',
            'postgresql://postgres:postgres@localhost:5432/gamedb'
        )
        print(f"数据库 URL: {database_url.split('@')[1] if '@' in database_url else '默认'}")
        
        db = Database(database_url)
        print("[OK] 数据库实例创建成功")
        
        print("\n步骤 6: 尝试创建表...")
        db.create_tables()
        print("[OK] 表创建成功")
        
        print("\n步骤 7: 测试会话...")
        session = db.get_session()
        session.close()
        print("[OK] 会话测试成功")
        
        print("\n" + "=" * 60)
        print("[OK] 所有测试通过！")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"\n[X] 错误: {type(e).__name__}: {str(e)}")
        print("\n详细错误信息:")
        traceback.print_exc()
        return False

if __name__ == '__main__':
    test_database_detailed()

