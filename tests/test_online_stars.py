import importlib.util
from pathlib import Path


def test_worker_uses_star_stats():
    source = Path(__file__).resolve().parents[1] / "scripts/nest_battle_worker.py"
    spec = importlib.util.spec_from_file_location("battle_worker", source)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    row = dict(id="hero", characterConfigId="char_001_water_physical_tank",
               professionType="PHYSICAL_TANK", attributeType="WATER", level=10)
    base = worker.character_from_snapshot({**row, "equipment": {}})
    upgraded = worker.character_from_snapshot({**row, "equipment": {"star": 5}})
    for stat in ("hp", "attack", "defense", "magic_attack", "magic_defense"):
        assert getattr(upgraded, stat) == getattr(base, stat) * 2
    equipped = worker.character_from_snapshot({**row, "equipment": {
        "star": 5, "equipment_set": {"RING": {"itemId": "ring", "stats": {"hp_bonus": 100}}}}})
    assert equipped.hp == base.hp * 2 + 100
