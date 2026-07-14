"""
数据库连接和管理
实现PostgreSQL数据库连接、连接池管理等
"""

import os
from typing import Optional
from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool


class Database:
    """数据库类"""
    
    def __init__(self, database_url: Optional[str] = None):
        """
        初始化数据库
        
        Args:
            database_url: 数据库连接URL
                格式：postgresql://用户名:密码@主机:端口/数据库名
                例如：postgresql://user:password@localhost:5432/gamedb
        """
        if database_url is None:
            # 从环境变量获取数据库URL，如果PostgreSQL不可用则使用SQLite
            database_url = os.getenv('DATABASE_URL')
            
            # 如果没有设置环境变量，尝试PostgreSQL，失败则使用SQLite
            if database_url is None:
                # 尝试PostgreSQL
                try:
                    test_url = 'postgresql://postgres:postgres@localhost:5432/gamedb'
                    # 先测试连接
                    test_engine = create_engine(test_url, connect_args={'connect_timeout': 2})
                    with test_engine.connect() as conn:
                        pass
                    database_url = test_url
                    print("[信息] 使用 PostgreSQL 数据库")
                except:
                    # PostgreSQL不可用，使用SQLite作为备选
                    database_url = 'sqlite:///gamedb.sqlite'
                    print("[信息] PostgreSQL 不可用，使用 SQLite 数据库 (gamedb.sqlite)")
        
        # 确保数据库URL是UTF-8编码的字符串
        if isinstance(database_url, bytes):
            try:
                database_url = database_url.decode('utf-8')
            except UnicodeDecodeError:
                # 如果UTF-8解码失败，尝试使用系统默认编码
                database_url = database_url.decode('latin-1')
        
        self.database_url = database_url
        
        # 创建数据库引擎
        # SQLite不需要连接池配置
        if database_url.startswith('sqlite'):
            self.engine: Engine = create_engine(
                database_url,
                connect_args={'check_same_thread': False},
                echo=False
            )
        else:
            self.engine: Engine = create_engine(
                database_url,
                poolclass=QueuePool,
                pool_size=10,
                max_overflow=20,
                pool_pre_ping=True,  # 连接前检查连接是否有效
                echo=False  # 是否打印SQL语句（开发时可以设为True）
            )
        
        # 创建会话工厂
        self.SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
            bind=self.engine
        )
    
    def get_session(self) -> Session:
        """
        获取数据库会话
        
        Returns:
            数据库会话
        """
        return self.SessionLocal()
    
    def create_tables(self):
        """创建所有数据表"""
        from .models import Base
        Base.metadata.create_all(self.engine)
    
    def drop_tables(self):
        """删除所有数据表（谨慎使用！）"""
        from .models import Base
        Base.metadata.drop_all(self.engine)
    
    def close(self):
        """关闭数据库连接"""
        self.engine.dispose()


# 全局数据库实例
_database: Optional[Database] = None


def get_database() -> Database:
    """
    获取数据库实例（单例模式）
    
    Returns:
        数据库实例
    """
    global _database
    if _database is None:
        _database = Database()
    return _database


def init_database(database_url: Optional[str] = None):
    """
    初始化数据库
    
    Args:
        database_url: 数据库连接URL
    """
    global _database
    _database = Database(database_url)
    _database.create_tables()

