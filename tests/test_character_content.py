import json
import os
import random
import sys
from datetime import datetime
from pathlib import Path


project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from src.rewards.gacha import GachaPool, GachaPoolType
from src.server.routes import generate_all_characters
from src.versions.version import GameVersion


CONTENT_DIR = Path(project_root) / "data" / "content"


def test_character_content_contains_64_configured_characters():
    payload = json.loads((CONTENT_DIR / "characters.json").read_text(encoding="utf-8"))
    characters = payload["characters"]

    assert payload["total"] == 64
    assert len(characters) == 64
    assert len({character["id"] for character in characters}) == 64
    assert len({character["name"] for character in characters}) == 64
    assert {attribute["count"] for attribute in payload["attributes"]} == {8}
    assert characters[0]["name"] == "江无尘"
    assert characters[-1]["name"] == "钱明舒"
    assert all(len(character["skills"]) == 3 for character in characters)
    assert all(skill["effect"] for character in characters for skill in character["skills"])


def test_gacha_pools_cover_configured_character_pool():
    characters = json.loads((CONTENT_DIR / "characters.json").read_text(encoding="utf-8"))["characters"]
    pools = json.loads((CONTENT_DIR / "gacha_pools.json").read_text(encoding="utf-8"))["pools"]
    by_key = {pool["key"]: pool for pool in pools}

    assert set(by_key) == {"starter", "WATER_EARTH_THUNDER", "FIRE_WOOD_WIND", "LIGHT_DARK", "UP_POOL"}
    assert len(by_key["starter"]["entries"]) == 64
    assert len(by_key["WATER_EARTH_THUNDER"]["entries"]) == 24
    assert len(by_key["FIRE_WOOD_WIND"]["entries"]) == 24
    assert len(by_key["LIGHT_DARK"]["entries"]) == 16
    assert len(by_key["UP_POOL"]["entries"]) == 64
    assert {entry["characterConfigId"] for entry in by_key["starter"]["entries"]} == {
        character["id"] for character in characters
    }
    assert all(entry["type"] == "character" for pool in pools for entry in pool["entries"])
    assert any(entry["weight"] > 100 for entry in by_key["UP_POOL"]["entries"])


def test_python_gacha_uses_configured_characters():
    version = GameVersion("test", "Test Version", "Test Era", 0, datetime.now())
    characters = generate_all_characters(version)

    assert len(characters) == 64
    assert characters[0].name == "江无尘"
    assert characters[-1].name == "钱明舒"
    assert getattr(characters[0], "skill_config")[0]["name"] == "盘龙引"

    random.seed(1)
    pool = GachaPool(GachaPoolType.LIGHT_DARK, characters)
    drawn = [pool.get_random_character().name for _ in range(20)]

    configured_names = {character.name for character in characters}
    assert set(drawn).issubset(configured_names)
    assert not any(name.startswith("Light ") or name.startswith("Dark ") for name in drawn)
