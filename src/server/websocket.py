"""
WebSocket处理
实现实时通信（多人战斗、聊天等）
"""

from flask_socketio import SocketIO, emit, join_room, leave_room
from flask import request, session
from typing import Dict, Any
import time

socketio = SocketIO(cors_allowed_origins="*")
multiplayer_socket_presence: Dict[str, Dict[str, str]] = {}


def _mark_multiplayer_presence(sid: str, is_online: bool):
    presence = multiplayer_socket_presence.get(sid)
    if not presence:
        return
    try:
        from ..dungeons.multiplayer_manager import get_room_manager
        manager = get_room_manager()
        room = manager.get_room(presence['room_id'])
        if not room or room.status != 'waiting':
            return
        updated_room = manager.set_member_connection(
            presence['room_id'],
            presence['player_id'],
            is_online
        )
        broadcast_multiplayer_room_update(
            updated_room.to_dict(),
            event_type='connection' if is_online else 'disconnected'
        )
    except Exception as exc:
        print(f"多人房间在线状态更新失败: {exc}")


@socketio.on('connect')
def handle_connect():
    """客户端连接"""
    print(f"客户端连接: {request.sid}")
    emit('connected', {'message': '连接成功'})


@socketio.on('disconnect')
def handle_disconnect():
    """客户端断开连接"""
    print(f"客户端断开: {request.sid}")
    _mark_multiplayer_presence(request.sid, False)
    multiplayer_socket_presence.pop(request.sid, None)


@socketio.on('join_room')
def handle_join_room(data):
    """加入房间"""
    room = data.get('room')
    if room:
        join_room(room)
        emit('joined_room', {'room': room, 'message': f'已加入房间 {room}'})


@socketio.on('leave_room')
def handle_leave_room(data):
    """离开房间"""
    room = data.get('room')
    if room:
        leave_room(room)
        emit('left_room', {'room': room, 'message': f'已离开房间 {room}'})


@socketio.on('battle_action')
def handle_battle_action(data):
    """战斗动作"""
    room = data.get('room')
    action = data.get('action')
    
    # 广播给房间内所有玩家
    socketio.emit('battle_update', {
        'action': action,
        'player_id': data.get('player_id')
    }, room=room)


@socketio.on('chat_message')
def handle_chat_message(data):
    """聊天消息"""
    room = data.get('room')
    message = data.get('message')
    player_id = data.get('player_id')
    
    # 广播给房间内所有玩家
    socketio.emit('chat_message', {
        'player_id': player_id,
        'message': message,
        'timestamp': data.get('timestamp')
    }, room=room)


@socketio.on('battle_join')
def handle_battle_join(data):
    """加入战斗房间"""
    battle_id = data.get('battle_id')
    player_id = data.get('player_id')
    
    if battle_id:
        room = f'battle_{battle_id}'
        join_room(room)
        emit('battle_joined', {
            'battle_id': battle_id,
            'message': f'已加入战斗房间 {battle_id}'
        })


@socketio.on('multiplayer_lobby_join')
def handle_multiplayer_lobby_join(data=None):
    """加入多人大厅，接收房间列表变化。"""
    join_room('multiplayer_lobby')
    try:
        from ..dungeons.multiplayer_manager import get_room_manager
        rooms = [room.to_dict() for room in get_room_manager().list_rooms()]
    except Exception:
        rooms = []
    emit('multiplayer_rooms', {
        'rooms': rooms,
        'timestamp': time.time()
    })


@socketio.on('multiplayer_player_join')
def handle_multiplayer_player_join(data=None):
    """Join a per-player multiplayer notification channel."""
    player_id = (data or {}).get('player_id') or session.get('player_id')
    if player_id:
        join_room(f'multiplayer_player_{player_id}')
        emit('multiplayer_player_joined', {
            'player_id': player_id,
            'timestamp': time.time()
        })


@socketio.on('multiplayer_room_join')
def handle_multiplayer_room_join(data):
    """加入具体多人房间，接收准备/开战状态变化。"""
    room_id = (data or {}).get('room_id')
    if not room_id:
        return
    room_name = f'multiplayer_room_{room_id}'
    join_room(room_name)
    try:
        from ..dungeons.multiplayer_manager import get_room_manager
        manager = get_room_manager()
        room = manager.get_room(room_id)
        player_id = (data or {}).get('player_id') or session.get('player_id')
        if room and player_id in room.members:
            multiplayer_socket_presence[request.sid] = {
                'room_id': room_id,
                'player_id': player_id
            }
            if room.status == 'waiting':
                room = manager.set_member_connection(room_id, player_id, True)
        payload = room.to_dict() if room else None
    except Exception:
        payload = None
    emit('multiplayer_room_update', {
        'room': payload,
        'event_type': 'joined',
        'timestamp': time.time()
    })


@socketio.on('multiplayer_room_leave')
def handle_multiplayer_room_leave(data):
    """离开具体多人房间订阅。"""
    room_id = (data or {}).get('room_id')
    if room_id:
        leave_room(f'multiplayer_room_{room_id}')
        presence = multiplayer_socket_presence.get(request.sid)
        if presence and presence.get('room_id') == room_id:
            _mark_multiplayer_presence(request.sid, False)
            multiplayer_socket_presence.pop(request.sid, None)


@socketio.on('battle_leave')
def handle_battle_leave(data):
    """离开战斗房间"""
    battle_id = data.get('battle_id')
    
    if battle_id:
        room = f'battle_{battle_id}'
        leave_room(room)
        emit('battle_left', {
            'battle_id': battle_id,
            'message': f'已离开战斗房间 {battle_id}'
        })


def broadcast_battle_update(battle_id: str, snapshot: Dict[str, Any]):
    """
    广播战斗更新
    
    Args:
        battle_id: 战斗ID
        snapshot: 战斗快照
    """
    room = f'battle_{battle_id}'
    socketio.emit('battle_tick', {
        'battle_id': battle_id,
        'snapshot': snapshot,
        'timestamp': time.time()
    }, room=room)


def broadcast_battle_end(battle_id: str, result: Dict[str, Any]):
    """广播战斗结束"""
    room = f'battle_{battle_id}'
    socketio.emit('battle_end', {
        'battle_id': battle_id,
        'result': result,
        'timestamp': time.time()
    }, room=room)


def broadcast_drop_event(battle_id: str, drop_event: Dict[str, Any]):
    """广播掉落事件"""
    room = f'battle_{battle_id}'
    socketio.emit('dungeon_drop', {
        'battle_id': battle_id,
        'drop': drop_event
    }, room=room)


def broadcast_multiplayer_rooms():
    """广播多人大厅房间列表。"""
    try:
        from ..dungeons.multiplayer_manager import get_room_manager
        rooms = [room.to_dict() for room in get_room_manager().list_rooms()]
    except Exception:
        rooms = []
    socketio.emit('multiplayer_rooms', {
        'rooms': rooms,
        'timestamp': time.time()
    }, room='multiplayer_lobby')


def broadcast_multiplayer_room_update(room: Dict[str, Any], event_type: str = "updated"):
    """广播单个多人房间变化，并刷新大厅列表。"""
    if room:
        socketio.emit('multiplayer_room_update', {
            'room': room,
            'event_type': event_type,
            'timestamp': time.time()
        }, room=f"multiplayer_room_{room.get('room_id')}")
    broadcast_multiplayer_rooms()


def broadcast_multiplayer_battle_started(room: Dict[str, Any], battle_id: str):
    """通知房间成员多人战斗已开始。"""
    socketio.emit('multiplayer_battle_started', {
        'room': room,
        'battle_id': battle_id,
        'timestamp': time.time()
    }, room=f"multiplayer_room_{room.get('room_id')}")
    broadcast_multiplayer_room_update(room, event_type='battle_started')


def broadcast_multiplayer_room_removed(room_id: str):
    """通知房间已解散或不可恢复。"""
    socketio.emit('multiplayer_room_update', {
        'room': None,
        'room_id': room_id,
        'event_type': 'removed',
        'timestamp': time.time()
    }, room=f'multiplayer_room_{room_id}')
    broadcast_multiplayer_rooms()


def broadcast_multiplayer_chat(room_id: str, message: Dict[str, Any]):
    """广播多人房间聊天消息。"""
    socketio.emit('multiplayer_room_chat', {
        'room_id': room_id,
        'message': message,
        'timestamp': time.time()
    }, room=f'multiplayer_room_{room_id}')


def broadcast_multiplayer_invitation(room_id: str, invitation: Dict[str, Any]):
    """广播多人房间邀请。"""
    payload = {
        'room_id': room_id,
        'invitation': invitation,
        'timestamp': time.time()
    }
    socketio.emit('multiplayer_room_invitation', payload, room=f'multiplayer_room_{room_id}')
    invitee_id = invitation.get('invitee_id') if isinstance(invitation, dict) else None
    if invitee_id:
        socketio.emit('multiplayer_room_invitation', payload, room=f'multiplayer_player_{invitee_id}')
