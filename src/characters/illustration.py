"""
立绘系统
"""

from enum import Enum
from typing import Optional, Dict, Any


class IllustrationGender(Enum):
    """立绘性别"""
    MALE = "男"
    FEMALE = "女"


class Illustration:
    """立绘类"""
    
    def __init__(
        self,
        illustration_id: str,
        character_id: str,
        gender: IllustrationGender,
        image_path: str,
        name: str = ""
    ):
        """
        初始化立绘
        
        Args:
            illustration_id: 立绘ID
            character_id: 角色ID
            gender: 性别
            image_path: 图片路径
            name: 立绘名称
        """
        self.illustration_id = illustration_id
        self.character_id = character_id
        self.gender = gender
        self.image_path = image_path
        self.name = name or f"{character_id}_{gender.value}"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "illustration_id": self.illustration_id,
            "character_id": self.character_id,
            "gender": self.gender.value,
            "image_path": self.image_path,
            "name": self.name
        }
    
    def __str__(self) -> str:
        return f"{self.name} ({self.gender.value})"
    
    def __eq__(self, other):
        if not isinstance(other, Illustration):
            return False
        return self.illustration_id == other.illustration_id
    
    def __hash__(self):
        return hash(self.illustration_id)








