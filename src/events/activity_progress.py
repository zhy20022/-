"""
活动进度管理
处理活动切换时的进度清空等操作
"""

from typing import Optional
import logging

logger = logging.getLogger(__name__)


def clear_activity_progress(event_type: str, event_id: str) -> bool:
    """清空活动相关的玩家进度
    
    Args:
        event_type: 活动类型，"team_monthly" 或 "server_quarterly"
        event_id: 活动ID
        
    Returns:
        是否成功清空
    """
    try:
        from ..database import get_database
        from ..database.models import QuestProgressModel
        
        db = get_database()
        session = db.get_session()
        
        # 清空与活动相关的任务进度
        # 假设活动相关的任务ID以活动ID为前缀
        activity_quest_prefix = f"{event_type}_{event_id}"
        
        # 查找并删除相关任务进度
        activity_quests = session.query(QuestProgressModel).filter(
            QuestProgressModel.quest_id.like(f"{activity_quest_prefix}%")
        ).all()
        
        deleted_count = 0
        for quest_progress in activity_quests:
            session.delete(quest_progress)
            deleted_count += 1
        
        session.commit()
        session.close()
        
        logger.info(f"活动进度已清空: {event_type} {event_id}, 删除了 {deleted_count} 条任务进度")
        return True
        
    except Exception as e:
        logger.error(f"清空活动进度失败: {e}", exc_info=True)
        return False


