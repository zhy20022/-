"""
版本/纪元系统
"""

from typing import List, Dict, Any, Optional, TYPE_CHECKING
from datetime import datetime

if TYPE_CHECKING:
    from ..characters.character import Character


class GameVersion:
    """游戏版本/纪元类"""
    
    def __init__(
        self,
        version_id: str,
        version_name: str,
        era_name: str,
        era_year: int,
        release_date: datetime,
        description: str = ""
    ):
        """
        初始化游戏版本
        
        Args:
            version_id: 版本ID
            version_name: 版本名称
            era_name: 纪元名称
            era_year: 纪元年份（0-99，代表100年）
            release_date: 发布日期
            description: 版本描述
        """
        self.version_id = version_id
        self.version_name = version_name
        self.era_name = era_name
        self.era_year = era_year
        self.release_date = release_date
        self.description = description
        self.is_active = False
        self.characters: List['Character'] = []
    
    def add_character(self, character: 'Character'):
        """添加角色到版本"""
        if character not in self.characters:
            self.characters.append(character)
    
    def remove_character(self, character: 'Character'):
        """从版本中移除角色"""
        if character in self.characters:
            self.characters.remove(character)
    
    def can_use_character(self, character: 'Character') -> bool:
        """
        检查角色是否可以在当前版本中使用
        
        Args:
            character: 角色
            
        Returns:
            如果可以使用返回True
        """
        return character.version == self
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "version_id": self.version_id,
            "version_name": self.version_name,
            "era_name": self.era_name,
            "era_year": self.era_year,
            "release_date": self.release_date.isoformat(),
            "description": self.description,
            "is_active": self.is_active,
            "character_count": len(self.characters)
        }
    
    def __str__(self) -> str:
        return f"{self.version_name} - {self.era_name} ({self.era_year}年)"
    
    def __eq__(self, other):
        if not isinstance(other, GameVersion):
            return False
        return self.version_id == other.version_id


class VersionManager:
    """版本管理器"""
    
    def __init__(self):
        self.versions: List['GameVersion'] = []
        self.current_version: Optional['GameVersion'] = None
    
    def add_version(self, version: GameVersion):
        """添加版本"""
        if version not in self.versions:
            self.versions.append(version)
    
    def set_current_version(self, version: GameVersion):
        """设置当前版本"""
        # 将之前的当前版本设为非活跃
        if self.current_version:
            self.current_version.is_active = False
        
        # 设置新版本为当前版本
        self.current_version = version
        version.is_active = True
    
    def get_current_version(self) -> Optional[GameVersion]:
        """获取当前版本"""
        return self.current_version
    
    def get_version_by_id(self, version_id: str) -> Optional[GameVersion]:
        """根据ID获取版本"""
        for version in self.versions:
            if version.version_id == version_id:
                return version
        return None
    
    def get_previous_versions(self) -> List[GameVersion]:
        """获取所有旧版本（非当前版本）"""
        return [v for v in self.versions if v != self.current_version]
    
    def can_character_use_in_version(self, character: 'Character', version: 'GameVersion') -> bool:
        """
        检查角色是否可以在指定版本中使用
        
        Args:
            character: 角色
            version: 版本
            
        Returns:
            如果可以使用返回True
        """
        # 角色只能在自己的版本中使用
        return character.version == version
    
    def get_character_available_versions(self, character: 'Character') -> List['GameVersion']:
        """
        获取角色可用的版本列表
        
        Args:
            character: 角色
            
        Returns:
            可用版本列表（通常只有一个）
        """
        # 角色只能在自己的版本中使用
        if character.version in self.versions:
            return [character.version]
        return []
    
    def update_to_new_version(self, new_version: GameVersion):
        """
        更新到新版本
        
        Args:
            new_version: 新版本
        """
        # 将旧版本设为非活跃
        if self.current_version:
            self.current_version.is_active = False
        
        # 设置新版本为当前版本
        self.set_current_version(new_version)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "current_version": self.current_version.to_dict() if self.current_version else None,
            "all_versions": [v.to_dict() for v in self.versions],
            "version_count": len(self.versions)
        }

