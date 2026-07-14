"""
玩家统计服务
提供统计数据的查询、更新等功能
"""

from typing import Dict, Optional
from datetime import datetime
import uuid
import logging

from ..database import get_database
from ..database.models import (
    PlayerStatisticsModel,
    MonsterKillModel,
    DungeonProgressModel,
    CharacterModel,
    MaterialModel,
    PlayerModel
)
from sqlalchemy import func

logger = logging.getLogger(__name__)


def get_or_create_statistics(player_id: str) -> PlayerStatisticsModel:
    """获取或创建玩家统计数据"""
    db = get_database()
    session = db.get_session()
    
    try:
        stats = session.query(PlayerStatisticsModel).filter(
            PlayerStatisticsModel.player_id == player_id
        ).first()
        
        if not stats:
            # 创建新的统计记录
            stats = PlayerStatisticsModel(player_id=player_id)
            session.add(stats)
            session.commit()
            session.refresh(stats)
        
        return stats
    finally:
        session.close()


def calculate_real_time_statistics(player_id: str) -> Dict[str, int]:
    """实时计算玩家统计数据（用于验证和更新）"""
    db = get_database()
    session = db.get_session()
    
    try:
        # 统计战斗完成数（所有副本的总挑战次数）
        battles_completed = session.query(
            func.sum(DungeonProgressModel.total_attempts)
        ).filter(
            DungeonProgressModel.player_id == player_id
        ).scalar() or 0
        
        # 统计副本完成数（所有副本的完成次数总和）
        dungeons_completed = session.query(
            func.sum(DungeonProgressModel.completion_count)
        ).filter(
            DungeonProgressModel.player_id == player_id
        ).scalar() or 0
        
        # 统计角色数量
        character_count = session.query(CharacterModel).filter(
            CharacterModel.player_id == player_id
        ).count()
        
        # 统计击杀怪物数
        monsters_killed = session.query(
            func.sum(MonsterKillModel.kill_count)
        ).filter(
            MonsterKillModel.player_id == player_id
        ).scalar() or 0
        
        # 统计总获得金币（从GoldModel或PlayerModel获取）
        player = session.query(PlayerModel).filter(
            PlayerModel.player_id == player_id
        ).first()
        total_gold_earned = player.gold if player else 0
        
        # 统计总掉落材料数量（从MaterialModel统计，material_type包含"dropped"的材料）
        # 注意：如果material_type字段不包含"dropped"标识，则统计所有材料
        total_materials_dropped = session.query(
            func.sum(MaterialModel.count)
        ).filter(
            MaterialModel.player_id == player_id
        ).scalar() or 0  # 暂时统计所有材料作为掉落材料
        
        # 统计总获得材料数量（所有材料的总数）
        total_materials_earned = session.query(
            func.sum(MaterialModel.count)
        ).filter(
            MaterialModel.player_id == player_id
        ).scalar() or 0
        
        # 获取等级
        level = player.level if player else 1
        
        return {
            'battles_completed': int(battles_completed),
            'dungeons_completed': int(dungeons_completed),
            'monsters_killed': int(monsters_killed),
            'character_count': character_count,
            'total_gold_earned': int(total_gold_earned),
            'total_materials_dropped': int(total_materials_dropped),
            'total_materials_earned': int(total_materials_earned),
            'level': level
        }
    finally:
        session.close()


def update_statistics(player_id: str, **kwargs) -> bool:
    """更新玩家统计数据
    
    Args:
        player_id: 玩家ID
        **kwargs: 要更新的统计数据字段
            - battles_completed: 增加战斗完成数
            - dungeons_completed: 增加副本完成数
            - monsters_killed: 增加击杀怪物数
            - character_count: 更新角色数量
            - total_gold_earned: 增加获得金币
            - total_materials_dropped: 增加掉落材料数量
            - total_materials_earned: 增加获得材料数量
            - level: 更新等级
    """
    db = get_database()
    session = db.get_session()
    
    try:
        stats = session.query(PlayerStatisticsModel).filter(
            PlayerStatisticsModel.player_id == player_id
        ).first()
        if not stats:
            stats = PlayerStatisticsModel(player_id=player_id)
            session.add(stats)
        
        # 更新统计数据
        if 'battles_completed' in kwargs:
            stats.battles_completed += kwargs['battles_completed']
        if 'dungeons_completed' in kwargs:
            stats.dungeons_completed += kwargs['dungeons_completed']
        if 'monsters_killed' in kwargs:
            stats.monsters_killed += kwargs['monsters_killed']
        if 'character_count' in kwargs:
            stats.character_count = kwargs['character_count']
        if 'total_gold_earned' in kwargs:
            stats.total_gold_earned += kwargs['total_gold_earned']
        if 'total_materials_dropped' in kwargs:
            stats.total_materials_dropped += kwargs['total_materials_dropped']
        if 'total_materials_earned' in kwargs:
            stats.total_materials_earned += kwargs['total_materials_earned']
        if 'level' in kwargs:
            stats.level = kwargs['level']
        
        stats.updated_at = datetime.utcnow()
        session.commit()
        
        logger.debug(f"玩家 {player_id} 统计数据已更新: {kwargs}")
        return True
    except Exception as e:
        logger.error(f"更新玩家统计数据失败: {e}", exc_info=True)
        session.rollback()
        return False
    finally:
        session.close()


def sync_statistics_from_database(player_id: str) -> bool:
    """从数据库同步统计数据（用于验证和修复）"""
    try:
        real_time_stats = calculate_real_time_statistics(player_id)
        
        db = get_database()
        session = db.get_session()
        
        try:
            stats = session.query(PlayerStatisticsModel).filter(
                PlayerStatisticsModel.player_id == player_id
            ).first()
            if not stats:
                stats = PlayerStatisticsModel(player_id=player_id)
                session.add(stats)
            
            # 同步统计数据
            stats.battles_completed = real_time_stats['battles_completed']
            stats.dungeons_completed = real_time_stats['dungeons_completed']
            stats.monsters_killed = real_time_stats['monsters_killed']
            stats.character_count = real_time_stats['character_count']
            stats.total_gold_earned = real_time_stats['total_gold_earned']
            stats.total_materials_dropped = real_time_stats['total_materials_dropped']
            stats.total_materials_earned = real_time_stats['total_materials_earned']
            stats.level = real_time_stats['level']
            
            stats.updated_at = datetime.utcnow()
            session.commit()
            
            logger.info(f"玩家 {player_id} 统计数据已从数据库同步")
            return True
        finally:
            session.close()
    except Exception as e:
        logger.error(f"同步玩家统计数据失败: {e}", exc_info=True)
        return False


def record_monster_kill(
    player_id: str,
    monster_id: str,
    kill_count: int = 1,
    monster_name: Optional[str] = None,
    battle_id: Optional[str] = None,
    dungeon_id: Optional[str] = None,
    extra_info: Optional[Dict] = None
) -> bool:
    """记录怪物击杀
    
    Args:
        player_id: 玩家ID
        monster_id: 怪物ID
        kill_count: 击杀数量
        monster_name: 怪物名称
        battle_id: 战斗ID
        dungeon_id: 副本ID
        extra_info: 额外信息
    """
    db = get_database()
    session = db.get_session()
    
    try:
        import json
        
        kill_record = MonsterKillModel(
            kill_id=str(uuid.uuid4()),
            player_id=player_id,
            monster_id=monster_id,
            monster_name=monster_name,
            kill_count=kill_count,
            battle_id=battle_id,
            dungeon_id=dungeon_id,
            extra_info=json.dumps(extra_info) if extra_info else None,
            killed_at=datetime.utcnow()
        )
        
        session.add(kill_record)
        session.commit()
        
        # 更新统计表中的击杀数
        update_statistics(player_id, monsters_killed=kill_count)
        
        logger.debug(f"记录怪物击杀: 玩家 {player_id} 击杀了 {kill_count} 只 {monster_name or monster_id}")
        return True
    except Exception as e:
        logger.error(f"记录怪物击杀失败: {e}", exc_info=True)
        session.rollback()
        return False
    finally:
        session.close()


def get_player_statistics(player_id: str, use_cache: bool = True) -> Dict[str, int]:
    """获取玩家统计数据
    
    Args:
        player_id: 玩家ID
        use_cache: 是否使用缓存（统计表），False则实时计算
    """
    if use_cache:
        # 从统计表获取
        stats = get_or_create_statistics(player_id)
        return {
            'battles_completed': stats.battles_completed,
            'dungeons_completed': stats.dungeons_completed,
            'monsters_killed': stats.monsters_killed,
            'character_count': stats.character_count,
            'total_gold_earned': stats.total_gold_earned,
            'total_materials_dropped': stats.total_materials_dropped,
            'total_materials_earned': stats.total_materials_earned,
            'level': stats.level
        }
    else:
        # 实时计算
        return calculate_real_time_statistics(player_id)
