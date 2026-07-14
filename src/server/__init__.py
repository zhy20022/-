"""
Web服务器模块
实现Flask应用、API接口、WebSocket等
"""

from .app import create_app, app
from .routes import api_bp
from .websocket import socketio

__all__ = [
    'create_app',
    'app',
    'api_bp',
    'socketio'
]


