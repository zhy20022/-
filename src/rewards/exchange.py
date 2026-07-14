"""
兑换系统
实现立绘兑换等
"""

from typing import Dict, Any, List, Optional
from ..rewards.material import MaterialBag, MaterialType
from ..characters.illustration import Illustration, IllustrationGender
from ..characters.character import Character


class ExchangeResult:
    """兑换结果"""
    
    def __init__(
        self,
        illustration: Illustration,
        success: bool = True,
        message: str = ""
    ):
        """
        初始化兑换结果
        
        Args:
            illustration: 兑换到的立绘
            success: 是否成功
            message: 结果消息
        """
        self.illustration = illustration
        self.success = success
        self.message = message
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "illustration": self.illustration.to_dict() if hasattr(self.illustration, 'to_dict') else str(self.illustration),
            "success": self.success,
            "message": self.message
        }


class ExchangeSystem:
    """兑换系统"""
    
    # 兑换消耗
    ILLUSTRATION_PIECE_COST = 100  # 立绘兑换：100个立绘拼图碎片
    
    def __init__(self, player_id: str, material_bag: MaterialBag):
        """
        初始化兑换系统
        
        Args:
            player_id: 玩家ID
            material_bag: 材料背包
        """
        self.player_id = player_id
        self.material_bag = material_bag
        self.exchanged_illustrations: List[str] = []  # 已兑换的立绘ID列表
    
    def exchange_illustration(
        self,
        character: Character,
        illustration_id: str,
        gender: str = "male"
    ) -> ExchangeResult:
        """
        兑换立绘
        
        Args:
            character: 角色（需要解锁角色）
            illustration_id: 立绘ID
            gender: 性别（male/female）
            
        Returns:
            兑换结果
        """
        # 检查是否已经兑换过（每个立绘只能兑换一次）
        if illustration_id in self.exchanged_illustrations:
            return ExchangeResult(
                None,
                False,
                f"立绘 {illustration_id} 已经兑换过，每个立绘只能兑换一次"
            )
        
        # 检查材料是否足够
        illustration_materials = self.material_bag.filter_materials(
            material_type=MaterialType.ILLUSTRATION_PIECE
        )
        
        total_materials = sum(illustration_materials.values())
        if total_materials < ExchangeSystem.ILLUSTRATION_PIECE_COST:
            return ExchangeResult(
                None,
                False,
                f"材料不足！需要{ExchangeSystem.ILLUSTRATION_PIECE_COST}个立绘拼图碎片，当前只有{total_materials}个"
            )
        
        # 消耗材料
        material_id = list(illustration_materials.keys())[0]
        self.material_bag.remove_material(
            material_id,
            ExchangeSystem.ILLUSTRATION_PIECE_COST
        )
        
        # 创建立绘
        gender_enum = IllustrationGender.MALE if gender == "male" else IllustrationGender.FEMALE
        illustration = Illustration(
            illustration_id=illustration_id,
            character_id=character.character_id,
            gender=gender_enum,
            image_path=f"illustrations/{character.character_id}_{gender}.png"
        )
        
        # 记录已兑换
        self.exchanged_illustrations.append(illustration_id)
        
        return ExchangeResult(
            illustration,
            True,
            f"成功兑换立绘：{illustration_id}（{gender}）"
        )
    
    def has_exchanged(self, illustration_id: str) -> bool:
        """检查是否已经兑换过"""
        return illustration_id in self.exchanged_illustrations
    
    def get_exchanged_illustrations(self) -> List[str]:
        """获取已兑换的立绘ID列表"""
        return self.exchanged_illustrations.copy()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "exchanged_illustrations_count": len(self.exchanged_illustrations),
            "exchanged_illustrations": self.exchanged_illustrations
        }

