"""
启动Web服务器
"""

import os
from dotenv import load_dotenv
from src.server.app import app
from src.server.websocket import socketio

# 加载环境变量
load_dotenv()

if __name__ == '__main__':
    # 获取配置
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('DEBUG', 'False').lower() == 'true'
    
    print(f"启动服务器: http://{host}:{port}")
    print(f"调试模式: {debug}")
    
    # 启动定时任务调度器
    from src.server.scheduler import start_scheduler
    start_scheduler()
    print("定时任务调度器已启动（活动轮换检查：每30分钟）")
    
    # 启动服务器
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)

