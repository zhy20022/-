"""
测试数据库连接
"""

import os
import sys

def test_database():
    """测试数据库连接"""
    print("正在测试数据库连接...")
    print(f"数据库 URL: postgresql://postgres:postgres@localhost:5432/gamedb")
    print()
    
    try:
        # 尝试导入数据库模块
        from src.database import init_database, get_database
        print("[OK] 数据库模块导入成功")
        
        # 设置数据库 URL
        database_url = os.getenv(
            'DATABASE_URL',
            'postgresql://postgres:postgres@localhost:5432/gamedb'
        )
        
        # 尝试初始化
        print("正在初始化数据库...")
        init_database(database_url)
        print("[OK] 数据库初始化成功")
        
        # 尝试获取数据库实例
        db = get_database()
        print("[OK] 数据库实例获取成功")
        
        # 尝试创建会话
        print("正在测试数据库会话...")
        session = db.get_session()
        session.close()
        print("[OK] 数据库会话测试成功")
        
        print("\n" + "=" * 50)
        print("[OK] 数据库连接测试通过！")
        print("=" * 50)
        return True
        
    except ImportError as e:
        print(f"[X] 导入错误: {str(e)}")
        return False
    except Exception as e:
        error_msg = str(e)
        print(f"[X] 数据库连接失败: {error_msg}")
        print()
        print("可能的原因：")
        print("1. PostgreSQL 服务未启动")
        print("2. 数据库 'gamedb' 不存在")
        print("3. 用户名或密码错误")
        print("4. 端口 5432 无法访问")
        print()
        print("解决方案：")
        print("1. 启动 PostgreSQL 服务（Windows: 服务管理器）")
        print("2. 创建数据库: CREATE DATABASE gamedb;")
        print("3. 检查用户名和密码是否正确")
        return False

if __name__ == '__main__':
    test_database()

