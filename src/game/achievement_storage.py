"""
成就系统数据持久化
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
import uuid

from ..database import get_database
from ..database.models.achievement_progress import AchievementProgressModel
from .achievement_system import AchievementSystem, Achievement


def save_achievement_progress(player_id: str, achievement: Achievement) -> bool:
    """
    保存成就进度到数据库
    
    Args:
        player_id: 玩家ID
        achievement: 成就对象
        
    Returns:
        是否保存成功
    """
    try:
        db = get_database()
        session = db.get_session()
        
        try:
            # 查找现有进度
            progress = session.query(AchievementProgressModel).filter(
                AchievementProgressModel.player_id == player_id,
                AchievementProgressModel.achievement_id == achievement.achievement_id
            ).first()
            
            if progress:
                # 更新现有进度
                progress.unlocked = achievement.unlocked
                progress.unlocked_at = achievement.unlocked_at
                progress.progress_data = achievement.progress
                progress.updated_at = datetime.utcnow()
            else:
                # 创建新进度
                progress = AchievementProgressModel(
                    progress_id=str(uuid.uuid4()),
                    player_id=player_id,
                    achievement_id=achievement.achievement_id,
                    unlocked=achievement.unlocked,
                    unlocked_at=achievement.unlocked_at,
                    progress_data=achievement.progress
                )
                session.add(progress)
            
            session.commit()
            return True
        finally:
            session.close()
    except Exception as e:
        print(f"保存成就进度失败: {e}")
        return False


def load_achievement_progress(player_id: str, achievement_system: AchievementSystem) -> None:
    """
    从数据库加载成就进度
    
    Args:
        player_id: 玩家ID
        achievement_system: 成就系统实例
    """
    try:
        db = get_database()
        session = db.get_session()
        
        try:
            # 获取所有成就进度
            progresses = session.query(AchievementProgressModel).filter(
                AchievementProgressModel.player_id == player_id
            ).all()
            
            # 恢复成就状态
            for progress in progresses:
                achievement = achievement_system.get_achievement(progress.achievement_id)
                if achievement:
                    achievement.unlocked = progress.unlocked
                    achievement.unlocked_at = progress.unlocked_at
                    achievement.progress = progress.progress_data or {}
                    
                    if progress.unlocked:
                        achievement_system.unlocked_achievements.append(progress.achievement_id)
        finally:
            session.close()
    except Exception as e:
        print(f"加载成就进度失败: {e}")


def save_all_achievements_progress(player_id: str, achievement_system: AchievementSystem) -> bool:
    """
    保存所有成就进度
    
    Args:
        player_id: 玩家ID
        achievement_system: 成就系统实例
        
    Returns:
        是否保存成功
    """
    success = True
    for achievement in achievement_system.get_all_achievements():
        if not save_achievement_progress(player_id, achievement):
            success = False
    return success



