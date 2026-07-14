"""
认证系统
实现登录、注册、密码加密等
"""

import hashlib
import secrets
from typing import Optional, Tuple
from .player import Player, PlayerManager


def hash_password(password: str) -> str:
    """
    加密密码
    
    Args:
        password: 原始密码
        
    Returns:
        密码哈希
    """
    # 使用SHA-256加密（实际项目中应该使用bcrypt或argon2）
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return f"{salt}:{password_hash}"


def verify_password(password: str, password_hash: str) -> bool:
    """
    验证密码
    
    Args:
        password: 原始密码
        password_hash: 密码哈希
        
    Returns:
        如果密码正确返回True
    """
    try:
        salt, stored_hash = password_hash.split(':')
        computed_hash = hashlib.sha256((password + salt).encode()).hexdigest()
        return computed_hash == stored_hash
    except:
        return False


class AuthSystem:
    """认证系统"""
    
    @staticmethod
    def register(username: str, password: str, email: Optional[str] = None) -> Tuple[bool, Optional[Player], str]:
        """
        注册新玩家
        
        Args:
            username: 用户名
            password: 密码
            email: 邮箱
            
        Returns:
            (是否成功, 玩家对象, 消息)
        """
        # 检查用户名是否已存在
        existing_player = PlayerManager.get_player_by_username(username)
        if existing_player:
            return False, None, "用户名已存在"
        
        # 检查邮箱是否已存在
        if email:
            # TODO: 检查邮箱是否已存在
            pass
        
        # 创建玩家
        password_hash = hash_password(password)
        player = PlayerManager.create_player(username, password_hash, email)
        
        # 初始化新玩家资源（分配初始金币）
        PlayerManager.initialize_new_player(player.player_id)
        
        # 重新获取玩家对象以获取最新数据
        player = PlayerManager.get_player_by_id(player.player_id)
        
        return True, player, "注册成功"
    
    @staticmethod
    def login(username: str, password: str) -> Tuple[bool, Optional[Player], str]:
        """
        登录
        
        Args:
            username: 用户名
            password: 密码
            
        Returns:
            (是否成功, 玩家对象, 消息)
        """
        # 获取玩家
        player = PlayerManager.get_player_by_username(username)
        if not player:
            return False, None, "用户名或密码错误"
        
        # 验证密码
        if not verify_password(password, player.player_model.password_hash):
            return False, None, "用户名或密码错误"
        
        # 检查账号是否激活
        if not player.player_model.is_active:
            return False, None, "账号已被禁用"
        
        # 更新最后登录时间
        player.update_last_login()
        
        # 初始化新玩家资源（如果金币为0则分配初始金币）
        PlayerManager.initialize_new_player(player.player_id)
        
        # 重新获取玩家对象以获取最新数据
        player = PlayerManager.get_player_by_id(player.player_id)
        
        return True, player, "登录成功"
    
    @staticmethod
    def logout(player: Player):
        """
        登出
        
        Args:
            player: 玩家对象
        """
        player.set_offline()


