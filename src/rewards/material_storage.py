"""
材料存储系统
实现材料与数据库的集成
"""

from typing import Dict, Any, List
from ..database import get_database
from ..database.models.material import MaterialModel
from ..database.models.material_transaction import MaterialTransactionModel
from ..rewards.material import MAX_CHARACTER_EXP_CRYSTALS, Material, MaterialType, MaterialBag
from ..attributes.attribute import AttributeType
import uuid


class MaterialStorage:
    """材料存储系统"""
    
    @staticmethod
    def load_materials_to_bag(player_id: str, material_bag: MaterialBag):
        """
        从数据库加载材料到背包
        
        Args:
            player_id: 玩家ID
            material_bag: 材料背包
        """
        db = get_database()
        session = db.get_session()
        try:
            materials = session.query(MaterialModel).filter(
                MaterialModel.player_id == player_id
            ).all()
            
            for material_model in materials:
                # 创建Material对象
                material_type = MaterialType(material_model.material_type)
                attribute_type = None
                if material_model.attribute_type:
                    try:
                        attribute_type = AttributeType(material_model.attribute_type)
                    except ValueError:
                        attribute_type = AttributeType[material_model.attribute_type]
                
                material = Material(
                    material_id=material_model.material_id,
                    material_type=material_type,
                    name=material_model.material_type,  # 使用类型作为名称
                    attribute_type=attribute_type
                )
                
                # 添加到背包
                material_bag.add_material(material, material_model.count)
        finally:
            session.close()
    
    @staticmethod
    def save_material(
        player_id: str,
        material_type: MaterialType,
        attribute_type: AttributeType = None,
        count: int = 1,
        source: str = "system",
        description: str = ""
    ):
        """
        保存材料到数据库
        
        Args:
            player_id: 玩家ID
            material_type: 材料类型
            attribute_type: 属性类型
            count: 数量
        """
        db = get_database()
        session = db.get_session()
        try:
            if material_type == MaterialType.CHARACTER_EXP:
                total_owned = sum(
                    row.count for row in session.query(MaterialModel).filter(
                        MaterialModel.player_id == player_id,
                        MaterialModel.material_type == MaterialType.CHARACTER_EXP.value
                    ).all()
                )
                count = min(count, max(0, MAX_CHARACTER_EXP_CRYSTALS - total_owned))
                if count <= 0:
                    return

            # 查找是否已存在
            existing = session.query(MaterialModel).filter(
                MaterialModel.player_id == player_id,
                MaterialModel.material_type == material_type.value,
                MaterialModel.attribute_type == (attribute_type.value if attribute_type else None)
            ).first()
            
            if existing:
                # 增加数量
                existing.count += count
                balance_after = existing.count
            else:
                # 创建新记录
                material_id = str(uuid.uuid4())
                material = MaterialModel(
                    material_id=material_id,
                    player_id=player_id,
                    material_type=material_type.value,
                    attribute_type=attribute_type.value if attribute_type else None,
                    count=count
                )
                session.add(material)
                balance_after = count

            transaction = MaterialTransactionModel(
                transaction_id=str(uuid.uuid4()),
                player_id=player_id,
                material_type=material_type.value,
                attribute_type=attribute_type.value if attribute_type else None,
                transaction_type="获取",
                amount=count,
                balance_after=balance_after,
                source=source,
                description=description
            )
            session.add(transaction)
            
            session.commit()
        finally:
            session.close()
    
    @staticmethod
    def remove_material(
        player_id: str,
        material_type: MaterialType,
        attribute_type: AttributeType = None,
        count: int = 1,
        source: str = "system",
        description: str = ""
    ) -> bool:
        """
        从数据库移除材料
        
        Args:
            player_id: 玩家ID
            material_type: 材料类型
            attribute_type: 属性类型
            count: 数量
            
        Returns:
            如果成功移除返回True
        """
        db = get_database()
        session = db.get_session()
        try:
            material = session.query(MaterialModel).filter(
                MaterialModel.player_id == player_id,
                MaterialModel.material_type == material_type.value,
                MaterialModel.attribute_type == (attribute_type.value if attribute_type else None)
            ).first()
            
            if not material or material.count < count:
                return False
            
            if material.count == count:
                balance_after = 0
                session.delete(material)
            else:
                material.count -= count
                balance_after = material.count

            transaction = MaterialTransactionModel(
                transaction_id=str(uuid.uuid4()),
                player_id=player_id,
                material_type=material_type.value,
                attribute_type=attribute_type.value if attribute_type else None,
                transaction_type="消耗",
                amount=-count,
                balance_after=balance_after,
                source=source,
                description=description
            )
            session.add(transaction)
            
            session.commit()
            return True
        finally:
            session.close()


