"""
玩家类和管理器
"""

from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid
from ..database import get_database
from ..database.models.player import PlayerModel
from ..database.models.character import CharacterModel
from ..database.models.material import MaterialModel
from ..database.models.gold import GoldModel


class Player:
    """玩家类"""
    
    def __init__(self, player_model: PlayerModel):
        """
        初始化玩家
        
        Args:
            player_model: 玩家数据模型
        """
        self.player_model = player_model
        self.player_id = player_model.player_id
        self.username = player_model.username
        self.level = player_model.level
        self.exp = player_model.exp
        self.gold = player_model.gold
    
    def add_gold(self, amount: int, description: str = ""):
        """
        增加金币
        
        Args:
            amount: 数量
            description: 描述
        """
        db = get_database()
        session = db.get_session()
        try:
            player_model = session.query(PlayerModel).filter(
                PlayerModel.player_id == self.player_id
            ).first()
            if not player_model:
                return

            player_model.gold += amount
            self.gold = player_model.gold
            
            # 记录交易
            transaction = GoldModel(
                transaction_id=str(uuid.uuid4()),
                player_id=self.player_id,
                transaction_type="获取",
                amount=amount,
                balance_after=self.gold,
                description=description
            )
            session.add(transaction)
            session.commit()
        finally:
            session.close()
    
    def spend_gold(self, amount: int, description: str = "") -> bool:
        """
        消耗金币
        
        Args:
            amount: 数量
            description: 描述
            
        Returns:
            如果成功消耗返回True
        """
        if self.gold < amount:
            return False
        
        db = get_database()
        session = db.get_session()
        try:
            player_model = session.query(PlayerModel).filter(
                PlayerModel.player_id == self.player_id
            ).first()
            if not player_model or player_model.gold < amount:
                return False

            player_model.gold -= amount
            self.gold = player_model.gold
            
            # 记录交易
            transaction = GoldModel(
                transaction_id=str(uuid.uuid4()),
                player_id=self.player_id,
                transaction_type="消耗",
                amount=-amount,
                balance_after=self.gold,
                description=description
            )
            session.add(transaction)
            session.commit()
            return True
        finally:
            session.close()
    
    def update_last_login(self):
        """更新最后登录时间"""
        db = get_database()
        session = db.get_session()
        try:
            self.player_model.last_login = datetime.utcnow()
            self.player_model.is_online = True
            session.commit()
        finally:
            session.close()
    
    def set_offline(self):
        """设置离线状态"""
        db = get_database()
        session = db.get_session()
        try:
            self.player_model.is_online = False
            session.commit()
        finally:
            session.close()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return self.player_model.to_dict()


class PlayerManager:
    """玩家管理器"""
    
    @staticmethod
    def create_player(
        username: str,
        password_hash: str,
        email: Optional[str] = None
    ) -> Player:
        """
        创建玩家
        
        Args:
            username: 用户名
            password_hash: 密码哈希
            email: 邮箱
            
        Returns:
            玩家对象
        """
        db = get_database()
        session = db.get_session()
        try:
            player_id = str(uuid.uuid4())
            # 给新玩家初始金币（100连抽所需）
            initial_gold = 100000
            player_model = PlayerModel(
                player_id=player_id,
                username=username,
                password_hash=password_hash,
                email=email,
                level=1,
                exp=0,
                gold=initial_gold
            )
            session.add(player_model)
            session.commit()
            
            # 记录初始金币交易
            transaction = GoldModel(
                transaction_id=str(uuid.uuid4()),
                player_id=player_id,
                transaction_type="获取",
                amount=initial_gold,
                balance_after=initial_gold,
                description="新手初始金币"
            )
            session.add(transaction)
            session.commit()
            
            return Player(player_model)
        finally:
            session.close()
    
    @staticmethod
    def initialize_new_player(player_id: str) -> bool:
        """
        初始化新玩家的资源（初始金币）
        如果玩家金币为0，则给予100连抽所需的初始金币
        
        Args:
            player_id: 玩家ID
            
        Returns:
            如果进行了初始化返回True，否则返回False
        """
        db = get_database()
        db_session = db.get_session()
        try:
            # 检查玩家是否存在
            player_model = db_session.query(PlayerModel).filter(
                PlayerModel.player_id == player_id
            ).first()
            if not player_model:
                return False
            
            player = Player(player_model)
            initialized = False
            
            # 如果玩家金币为0，给初始金币（兼容旧玩家）
            if player_model.gold == 0:
                initial_gold = 100000  # 100连抽所需金币
                player_model.gold = initial_gold
                
                # 记录交易
                transaction = GoldModel(
                    transaction_id=str(uuid.uuid4()),
                    player_id=player_id,
                    transaction_type="获取",
                    amount=initial_gold,
                    balance_after=initial_gold,
                    description="新手初始金币"
                )
                db_session.add(transaction)
                initialized = True
            
            db_session.commit()
            
            return initialized
        finally:
            db_session.close()
    
    @staticmethod
    def get_player_by_id(player_id: str) -> Optional[Player]:
        """
        根据ID获取玩家
        
        Args:
            player_id: 玩家ID
            
        Returns:
            玩家对象，如果不存在返回None
        """
        db = get_database()
        session = db.get_session()
        try:
            player_model = session.query(PlayerModel).filter(
                PlayerModel.player_id == player_id
            ).first()
            if player_model:
                return Player(player_model)
            return None
        finally:
            session.close()
    
    @staticmethod
    def get_player_by_username(username: str) -> Optional[Player]:
        """
        根据用户名获取玩家
        
        Args:
            username: 用户名
            
        Returns:
            玩家对象，如果不存在返回None
        """
        db = get_database()
        session = db.get_session()
        try:
            player_model = session.query(PlayerModel).filter(
                PlayerModel.username == username
            ).first()
            if player_model:
                return Player(player_model)
            return None
        finally:
            session.close()
    
    @staticmethod
    def get_all_players(limit: int = 100) -> List[Player]:
        """
        获取所有玩家
        
        Args:
            limit: 限制数量
            
        Returns:
            玩家列表
        """
        db = get_database()
        session = db.get_session()
        try:
            player_models = session.query(PlayerModel).limit(limit).all()
            return [Player(pm) for pm in player_models]
        finally:
            session.close()

