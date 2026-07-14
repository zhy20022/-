"""简易集成验证脚本

执行核心测试模块中的演示/断言函数，确保战斗、奖励和基础数据结构保持可用。
运行方式：
    python scripts/run_smoke_checks.py
"""

from __future__ import annotations

import importlib
import os
import sys
import traceback
from dataclasses import dataclass
from typing import Callable, List


# 将项目根目录加入 sys.path，方便导入 src/*
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


@dataclass
class TestCase:
    module: str
    functions: List[str]
    description: str


TEST_CASES: List[TestCase] = [
    TestCase(
        module="tests.test_game_systems",
        functions=[
            "test_profession_system",
            "test_attribute_system",
            "test_character_system",
            "test_equipment_system",
            "test_game_modes",
            "test_version_system",
        ],
        description="基础职业/属性/角色/装备/模式/版本体系校验",
    ),
    TestCase(
        module="tests.test_skill_learning",
        functions=["test_skill_learning_system"],
        description="技能学习与配置流程校验",
    ),
    TestCase(
        module="tests.test_combat_system",
        functions=["test_battle_system"],
        description="战斗主循环及技能释放演示",
    ),
    TestCase(
        module="tests.test_dungeon_system",
        functions=[
            "test_dungeon_database",
            "test_dungeon_unlock",
            "test_dungeon_reward",
            "test_dungeon_progress",
            "test_dungeon_monster_spawner",
        ],
        description="副本数据、解锁、奖励、进度与刷怪逻辑校验",
    ),
]


def load_callable(module_name: str, func_name: str) -> Callable[[], None]:
    module = importlib.import_module(module_name)
    func = getattr(module, func_name, None)
    if func is None or not callable(func):
        raise AttributeError(f"{module_name}.{func_name} 不存在或不可调用")
    return func


def main() -> int:
    print("=" * 80)
    print("Gamer 项目 · 核心功能集成验证")
    print("=" * 80)
    failures: List[str] = []

    for case in TEST_CASES:
        print(f"\n>>> {case.description} ({case.module})")
        for func_name in case.functions:
            display_name = f"{case.module}.{func_name}"
            print(f" -> 执行 {display_name}")
            try:
                func = load_callable(case.module, func_name)
                func()
            except AssertionError as exc:
                failures.append(f"{display_name}: 断言失败 - {exc}")
                traceback.print_exc()
            except Exception as exc:  # pylint: disable=broad-except
                failures.append(f"{display_name}: 异常 - {exc}")
                traceback.print_exc()

    print("\n" + "=" * 80)
    if failures:
        print("验证结果：FAIL")
        for failure in failures:
            print(f" - {failure}")
        print("=" * 80)
        return 1

    print("验证结果：PASS")
    print("所有核心演示用例执行完毕。")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    sys.exit(main())


