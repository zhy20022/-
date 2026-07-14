"""
Flask应用主文件
"""

import logging
import os
from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO
from ..database import init_database

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    """
    创建Flask应用
    
    Returns:
        Flask应用实例
    """
    app = Flask(__name__)
    
    # 配置
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['CORS_ORIGINS'] = os.getenv('CORS_ORIGINS', '*').split(',')
    
    # 启用CORS
    CORS(app, resources={r"/api/*": {"origins": app.config['CORS_ORIGINS']}})
    
    # 初始化数据库（不指定URL，让Database类自动选择PostgreSQL或SQLite）
    try:
        database_url = os.getenv('DATABASE_URL')  # 如果为None，Database类会自动尝试PostgreSQL，失败则使用SQLite
        init_database(database_url)
        logger.info("数据库初始化成功")
        print("[OK] 数据库初始化成功")
    except Exception as e:
        logger.warning(f"数据库初始化失败: {str(e)}", exc_info=True)
        print(f"[警告] 数据库初始化失败: {str(e)}")
        print("      游戏将以受限模式运行（某些功能可能不可用）")
        # 不阻止服务器启动，但数据库功能将不可用
    
    # 注册蓝图
    from .routes import api_bp
    from .battle_api import battle_bp
    app.register_blueprint(api_bp, url_prefix='/api')
    app.register_blueprint(battle_bp, url_prefix='/api')
    
    # 初始化SocketIO
    from .websocket import socketio
    socketio.init_app(app, cors_allowed_origins=app.config['CORS_ORIGINS'])
    
    # 初始化定时任务调度器
    from .scheduler import init_scheduler
    init_scheduler()
    
    return app


# 创建应用实例
app = create_app()

