"""
任务系统数据持久化
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
import uuid

from ..database import get_database
from ..database.models.quest_progress import QuestProgressModel, QuestStatusEnum
from .quest_system import QuestSystem, Quest, QuestStatus


def save_quest_progress(player_id: str, quest: Quest) -> bool:
    """
    保存任务进度到数据库
    
    Args:
        player_id: 玩家ID
        quest: 任务对象
        
    Returns:
        是否保存成功
    """
    try:
        db = get_database()
        session = db.get_session()
        
        try:
            # 查找现有进度
            progress = session.query(QuestProgressModel).filter(
                QuestProgressModel.player_id == player_id,
                QuestProgressModel.quest_id == quest.quest_id
            ).first()
            
            # 转换任务状态
            status_map = {
                QuestStatus.LOCKED: QuestStatusEnum.LOCKED,
                QuestStatus.AVAILABLE: QuestStatusEnum.AVAILABLE,
                QuestStatus.IN_PROGRESS: QuestStatusEnum.IN_PROGRESS,
                QuestStatus.COMPLETED: QuestStatusEnum.COMPLETED,
                QuestStatus.CLAIMED: QuestStatusEnum.CLAIMED
            }
            status_enum = status_map.get(quest.status, QuestStatusEnum.LOCKED)
            
            # 保存目标进度
            objectives_progress = {}
            for obj in quest.objectives:
                objectives_progress[obj.objective_id] = obj.current_count
            
            if progress:
                # 更新现有进度
                progress.status = status_enum
                progress.objectives_progress = objectives_progress
                progress.updated_at = datetime.utcnow()
                if quest.accepted_at:
                    progress.accepted_at = quest.accepted_at
                if quest.completed_at:
                    progress.completed_at = quest.completed_at
                if hasattr(quest, 'claimed_at') and quest.claimed_at:
                    progress.claimed_at = quest.claimed_at
            else:
                # 创建新进度
                progress = QuestProgressModel(
                    progress_id=str(uuid.uuid4()),
                    player_id=player_id,
                    quest_id=quest.quest_id,
                    status=status_enum,
                    objectives_progress=objectives_progress,
                    accepted_at=quest.accepted_at,
                    completed_at=quest.completed_at,
                    claimed_at=getattr(quest, 'claimed_at', None)
                )
                session.add(progress)
            
            session.commit()
            return True
        finally:
            session.close()
    except Exception as e:
        print(f"保存任务进度失败: {e}")
        return False


def load_quest_progress(player_id: str, quest_system: QuestSystem) -> None:
    """
    从数据库加载任务进度
    
    Args:
        player_id: 玩家ID
        quest_system: 任务系统实例
    """
    try:
        db = get_database()
        session = db.get_session()
        
        try:
            # 获取所有任务进度
            progresses = session.query(QuestProgressModel).filter(
                QuestProgressModel.player_id == player_id
            ).all()
            
            # 状态映射
            status_map = {
                QuestStatusEnum.LOCKED: QuestStatus.LOCKED,
                QuestStatusEnum.AVAILABLE: QuestStatus.AVAILABLE,
                QuestStatusEnum.IN_PROGRESS: QuestStatus.IN_PROGRESS,
                QuestStatusEnum.COMPLETED: QuestStatus.COMPLETED,
                QuestStatusEnum.CLAIMED: QuestStatus.CLAIMED
            }
            
            # 恢复任务状态
            for progress in progresses:
                quest = quest_system.get_quest(progress.quest_id)
                if quest:
                    quest.status = status_map.get(progress.status, QuestStatus.LOCKED)
                    quest.accepted_at = progress.accepted_at
                    quest.completed_at = progress.completed_at
                    if hasattr(quest, 'claimed_at'):
                        quest.claimed_at = progress.claimed_at
                    
                    # 恢复目标进度
                    for obj in quest.objectives:
                        if obj.objective_id in progress.objectives_progress:
                            obj.current_count = progress.objectives_progress[obj.objective_id]
        finally:
            session.close()
    except Exception as e:
        print(f"加载任务进度失败: {e}")


def save_all_quests_progress(player_id: str, quest_system: QuestSystem) -> bool:
    """
    保存所有任务进度
    
    Args:
        player_id: 玩家ID
        quest_system: 任务系统实例
        
    Returns:
        是否保存成功
    """
    success = True
    for quest in quest_system.get_all_quests():
        if not save_quest_progress(player_id, quest):
            success = False
    return success



