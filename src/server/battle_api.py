"""Battle API routes and battle settlement helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import threading
import time
import uuid

from flask import Blueprint, jsonify, request, session

from ..attributes.attribute import AttributeType
from ..combat.battle import BattleSpeed
from ..database import get_database
from ..database.models.character import CharacterModel
from ..database.models.dungeon_progress import DungeonProgressModel
from ..database.models.material import MaterialModel
from ..database.models.material_transaction import MaterialTransactionModel
from ..database.models.multiplayer import (
    MultiplayerRewardSettlementModel,
    TeamDungeonClearRecordModel,
)
from ..dungeons.dungeon import DungeonType
from ..dungeons.dungeon_battle import DungeonBattleFlow, DungeonBattleState
from ..dungeons.dungeon_database import get_dungeon_by_id
from ..dungeons.multiplayer_manager import get_room_manager
from ..characters.leveling import apply_character_exp, get_exp_for_next_level, get_exp_progress
from ..player.player import PlayerManager
from ..rewards.material import MAX_CHARACTER_EXP_CRYSTALS, MaterialType
from ..serialization.character_serializer import CharacterSerializer
from .websocket import (
    broadcast_battle_end,
    broadcast_battle_update,
    broadcast_drop_event,
    broadcast_multiplayer_battle_started,
    broadcast_multiplayer_room_removed,
    broadcast_multiplayer_room_update,
)


battle_bp = Blueprint("battle", __name__)
active_battles: Dict[str, Dict[str, Any]] = {}
room_manager = get_room_manager()


def _coerce_battle_speed(value: Any) -> BattleSpeed:
    speed_map = {1: BattleSpeed.X1, 2: BattleSpeed.X2, 4: BattleSpeed.X4}
    try:
        return speed_map.get(int(value), BattleSpeed.X1)
    except (TypeError, ValueError):
        return BattleSpeed.X1


def _normalize_state(enum_obj) -> Dict[str, str]:
    if enum_obj is None:
        return {"code": "unknown", "label": "unknown"}
    return {"code": enum_obj.name.lower(), "label": enum_obj.value}


def _player_has_access(player_id: str, battle_info: Dict[str, Any]) -> bool:
    if battle_info.get("player_id") == player_id:
        return True
    allowed_players = battle_info.get("allowed_players") or set()
    return player_id in allowed_players


def _build_speed_state(
    battle_info: Dict[str, Any],
    battle_flow: Optional[DungeonBattleFlow] = None,
) -> Dict[str, Any]:
    current_speed = int(battle_info.get("battle_speed", BattleSpeed.X1.value))
    allowed_players = battle_info.get("allowed_players") or set()
    total_players = max(len(allowed_players), 1)
    agreements: Dict[str, bool] = {}
    can_use_4x = True
    if battle_flow and battle_flow.is_multiplayer:
        agreements = dict(getattr(battle_flow, "players_agree_4x", {}) or {})
        can_use_4x = bool(getattr(battle_flow, "can_use_4x", False))
    agreed_count = sum(1 for agreed in agreements.values() if agreed)
    return {
        "current_speed": current_speed,
        "requested_speed": int(battle_info.get("requested_speed", current_speed)),
        "is_multiplayer": bool(battle_flow.is_multiplayer) if battle_flow else bool(battle_info.get("room_id")),
        "can_use_4x": can_use_4x,
        "agreements": agreements,
        "agreed_count": agreed_count,
        "total_players": total_players,
        "pending_4x": bool(
            battle_flow
            and battle_flow.is_multiplayer
            and int(battle_info.get("requested_speed", current_speed)) == 4
            and not can_use_4x
        ),
    }


def _get_or_create_progress(db_session, player_id: str, dungeon_id: str) -> DungeonProgressModel:
    progress = db_session.query(DungeonProgressModel).filter(
        DungeonProgressModel.player_id == player_id,
        DungeonProgressModel.dungeon_id == dungeon_id,
    ).first()
    if progress:
        return progress

    progress = DungeonProgressModel(
        progress_id=str(uuid.uuid4()),
        player_id=player_id,
        dungeon_id=dungeon_id,
        total_attempts=0,
        successful_attempts=0,
        failed_attempts=0,
        is_completed=False,
        completion_count=0,
        sweep_unlocked=False,
        best_record={},
    )
    db_session.add(progress)
    return progress


def _get_sweep_unlock_count(dungeon) -> int:
    return 100 if dungeon.reward_config.get("type") == "experience" else 50


def _distribute_experience(
    db_session,
    character_models: List[CharacterModel],
    total_exp: int,
) -> Tuple[int, Dict[str, Dict[str, Any]]]:
    if total_exp <= 0 or not character_models:
        return 0, {}

    base_exp = total_exp // len(character_models)
    remainder = total_exp % len(character_models)
    updates: Dict[str, Dict[str, Any]] = {}

    for index, char_model in enumerate(character_models):
        gained = base_exp + (1 if index < remainder else 0)
        if gained <= 0:
            continue
        growth = apply_character_exp(char_model.level, char_model.exp, gained)
        char_model.level = growth["after_level"]
        char_model.exp = growth["after_exp"]
        character = CharacterSerializer.model_to_domain(char_model)
        updated = CharacterSerializer.domain_to_model_dict(character)
        char_model.stats = updated["stats"]
        updates[char_model.character_id] = {
            "gained_exp": gained,
            "before_level": growth["before_level"],
            "after_level": char_model.level,
            "before_exp": growth["before_exp"],
            "after_exp": char_model.exp,
            "leveled_up": growth["leveled_up"],
            "exp_to_next_level": get_exp_for_next_level(char_model.level),
            "exp_progress": get_exp_progress(char_model.level, char_model.exp),
        }
    return total_exp, updates


def _add_material(
    db_session,
    player_id: str,
    material_type: MaterialType,
    attribute_type: Optional[AttributeType],
    count: int,
) -> Optional[Dict[str, Any]]:
    count = int(count or 0)
    if count <= 0:
        return None

    if material_type == MaterialType.CHARACTER_EXP:
        total_owned = sum(
            row.count
            for row in db_session.query(MaterialModel).filter(
                MaterialModel.player_id == player_id,
                MaterialModel.material_type == MaterialType.CHARACTER_EXP.value,
            ).all()
        )
        count = min(count, max(0, MAX_CHARACTER_EXP_CRYSTALS - total_owned))
        if count <= 0:
            return None

    attribute_value = attribute_type.value if attribute_type else None
    material = db_session.query(MaterialModel).filter(
        MaterialModel.player_id == player_id,
        MaterialModel.material_type == material_type.value,
        MaterialModel.attribute_type == attribute_value,
    ).first()
    if material:
        material.count += count
    else:
        material = MaterialModel(
            material_id=str(uuid.uuid4()),
            player_id=player_id,
            material_type=material_type.value,
            attribute_type=attribute_value,
            count=count,
        )
        db_session.add(material)

    db_session.add(MaterialTransactionModel(
        transaction_id=str(uuid.uuid4()),
        player_id=player_id,
        material_type=material_type.value,
        attribute_type=attribute_value,
        transaction_type="gain",
        amount=count,
        balance_after=material.count,
        source="dungeon_reward",
        description="dungeon battle reward",
    ))
    return {
        "material_type": material_type.value,
        "attribute_type": attribute_value,
        "count": count,
    }


def _load_player_characters(player_id: str, character_ids: List[str]) -> List[CharacterModel]:
    if not character_ids:
        return []
    db = get_database()
    db_session = db.get_session()
    try:
        rows = db_session.query(CharacterModel).filter(
            CharacterModel.player_id == player_id,
            CharacterModel.character_id.in_(character_ids),
        ).all()
        found = {row.character_id for row in rows}
        ordered = {row.character_id: row for row in rows}
        if len(found) != len(set(character_ids)):
            return []
        return [ordered[char_id] for char_id in character_ids if char_id in ordered]
    finally:
        db_session.close()


def _build_player_data(player_id: str, characters: List[CharacterModel], is_solo: bool) -> Dict[str, Any]:
    db = get_database()
    db_session = db.get_session()
    try:
        completed = [
            row.dungeon_id
            for row in db_session.query(DungeonProgressModel).filter(
                DungeonProgressModel.player_id == player_id,
                DungeonProgressModel.is_completed == True,  # noqa: E712
            ).all()
        ]
    finally:
        db_session.close()
    return {
        "is_solo": is_solo,
        "characters": [row.to_dict() for row in characters],
        "completed_dungeons": completed,
    }


def create_single_battle_for_player(
    player_id: str,
    dungeon_id: str,
    character_ids: List[str],
    assist_enabled: Optional[bool] = None,
) -> Tuple[Dict[str, Any], int]:
    dungeon = get_dungeon_by_id(dungeon_id)
    if not dungeon:
        return {"success": False, "message": "dungeon not found"}, 404

    characters = _load_player_characters(player_id, character_ids)
    if len(characters) != len(character_ids):
        return {"success": False, "message": "invalid characters"}, 400

    if not dungeon.check_unlock_condition(_build_player_data(player_id, characters, is_solo=True)):
        return {"success": False, "message": "dungeon locked"}, 403

    domain_characters = [CharacterSerializer.model_to_domain(row) for row in characters]
    battle_id = str(uuid.uuid4())
    flow = DungeonBattleFlow(
        dungeon=dungeon,
        player_characters=domain_characters,
        assist_enabled=bool(assist_enabled),
    )
    flow.enter_dungeon()
    flow.all_players_ready = True

    active_battles[battle_id] = {
        "battle_id": battle_id,
        "player_id": player_id,
        "dungeon_id": dungeon_id,
        "dungeon_attribute": dungeon.attribute_type,
        "character_ids": list(character_ids),
        "flow": flow,
        "state": "created",
        "battle_speed": 1,
        "requested_speed": 1,
        "created_at": time.time(),
        "allowed_players": {player_id},
    }
    return {
        "success": True,
        "battle_id": battle_id,
        "dungeon_id": dungeon_id,
        "character_ids": list(character_ids),
    }, 200


def _format_battle_log(battle_log: Optional[List[Dict[str, Any]]]) -> List[str]:
    if not battle_log:
        return []
    formatted = []
    for entry in battle_log:
        time_value = float(entry.get("time", 0.0) or 0.0)
        message = entry.get("message", "")
        formatted.append(f"[{time_value:.1f}s] {message}")
    return formatted


def _format_battle_events(battle_log: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    if not battle_log:
        return []
    return [{
        "time": float(entry.get("time", 0.0) or 0.0),
        "time_text": f"{float(entry.get('time', 0.0) or 0.0):.1f}s",
        "message": entry.get("message", ""),
        "event_type": entry.get("event_type", "info"),
        "payload": entry.get("payload") or {},
    } for entry in battle_log]


def _battle_unit_payload(unit) -> Dict[str, Any]:
    unit_payload = unit.to_dict() if hasattr(unit, "to_dict") else {}
    health = getattr(unit, "current_health", 0)
    max_health = getattr(unit, "max_health", 0)
    return {
        "character_id": unit.character.character_id,
        "name": unit.character.name,
        "health": health,
        "max_health": max_health,
        "physical_health": getattr(unit, "current_physical_health", health),
        "max_physical_health": getattr(unit, "max_physical_health", max_health),
        "magical_health": getattr(unit, "current_magical_health", 0),
        "max_magical_health": getattr(unit, "max_magical_health", 0),
        "spawn_category": getattr(unit, "spawn_category", None),
        "boss_type": getattr(unit, "boss_type_code", None),
        "boss_mechanic": getattr(unit, "boss_mechanic", None),
        "boss_group_id": getattr(unit, "boss_group_id", None),
        "exclusive_weapon": unit_payload.get("exclusive_weapon"),
        "skill_slots": unit_payload.get("skill_slots"),
        "is_alive": unit.is_alive(),
    }


def get_battle_snapshot(
    battle_flow: DungeonBattleFlow,
    battle_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    battle_info = next(
        (info for info in active_battles.values() if info.get("flow") is battle_flow),
        {},
    )
    if not battle_flow.battle:
        return {
            "flow_state": _normalize_state(battle_flow.state),
            "battle_state": _normalize_state(None),
            "current_time": battle_flow.current_time,
            "duration": battle_flow.duration,
            "player_units": [],
            "enemy_units": [],
            "battle_log": [],
            "battle_events": [],
            "battle_speed": int(battle_info.get("battle_speed", 1)),
            "speed_state": _build_speed_state(battle_info, battle_flow),
            "result": battle_result,
            "drops": battle_flow.get_drop_summary(),
            "team_status": battle_flow.get_team_status(),
        }

    battle = battle_flow.battle
    return {
        "flow_state": _normalize_state(battle_flow.state),
        "battle_state": _normalize_state(battle.state),
        "current_time": battle.current_time,
        "duration": battle_flow.duration,
        "player_units": [_battle_unit_payload(unit) for unit in battle.player_units],
        "enemy_units": [_battle_unit_payload(unit) for unit in battle.enemy_units if unit.is_alive()],
        "battle_log": _format_battle_log(battle.battle_log[-10:] if battle.battle_log else []),
        "battle_events": _format_battle_events(battle.battle_log[-16:] if battle.battle_log else []),
        "battle_speed": int(battle.battle_speed.value),
        "speed_state": _build_speed_state(battle_info, battle_flow),
        "result": battle_result,
        "drops": battle_flow.get_drop_summary(),
        "team_status": battle_flow.get_team_status(),
    }


def _build_result_progress_summary(progress: Optional[Dict[str, Any]], dungeon) -> Dict[str, Any]:
    completion_count = int((progress or {}).get("completion_count", 0) or 0)
    sweep_unlock_count = _get_sweep_unlock_count(dungeon)
    return {
        "completion_count": completion_count,
        "total_attempts": int((progress or {}).get("total_attempts", 0) or 0),
        "successful_attempts": int((progress or {}).get("successful_attempts", 0) or 0),
        "failed_attempts": int((progress or {}).get("failed_attempts", 0) or 0),
        "sweep_unlocked": bool((progress or {}).get("sweep_unlocked", False)),
        "sweep_unlock_count": sweep_unlock_count,
        "sweep_text": "unlocked" if bool((progress or {}).get("sweep_unlocked", False)) else f"{completion_count}/{sweep_unlock_count}",
    }


def _build_best_record_payload(battle_flow: DungeonBattleFlow, rewards_dict: Dict[str, Any]) -> Dict[str, Any]:
    payload = {"duration": battle_flow.duration, "rewards": rewards_dict}
    team_performance = battle_flow.get_team_performance()
    if team_performance:
        payload["team_performance"] = team_performance
        payload["reward_tier"] = team_performance.get("reward_tier")
        payload["performance_score"] = team_performance.get("performance_score")
    return payload


def _extract_player_material_drops(drop_summary: Dict[str, Any], player_id: str) -> List[Dict[str, Any]]:
    for bucket in drop_summary.get("players", []) if drop_summary else []:
        if bucket.get("player_id") == player_id:
            material_drops = []
            for drop in bucket.get("drops", []):
                item = drop.get("item") or {}
                if item.get("item_type") != "material":
                    continue
                classes = item.get("classifications") or {}
                material_drops.append({
                    "category": classes.get("category"),
                    "attribute": classes.get("attribute"),
                    "quantity": int(item.get("quantity", 0) or 0),
                    "drop": drop,
                })
            return material_drops
    return []


def _award_material_drop(
    db_session,
    player_id: str,
    dungeon_attribute: AttributeType,
    material_drop: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    quantity = int(material_drop.get("quantity", 0) or 0)
    if quantity <= 0:
        return None
    category = material_drop.get("category")
    if category == "exclusive_material":
        return _add_material(db_session, player_id, MaterialType.EXCLUSIVE_ITEM, None, quantity)
    if category == "equipment_material":
        return _add_material(db_session, player_id, MaterialType.EQUIPMENT_SET, dungeon_attribute, quantity)
    if category == "illustration_piece":
        return _add_material(db_session, player_id, MaterialType.ILLUSTRATION_PIECE, None, quantity)
    return None


def _apply_reward_to_player(
    db_session,
    *,
    player_id: str,
    dungeon_attribute: AttributeType,
    character_ids: List[str],
    rewards_dict: Dict[str, Any],
    drop_summary: Dict[str, Any],
    use_drop_share: bool,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    materials_awarded: List[Dict[str, Any]] = []
    character_updates: Dict[str, Any] = {}
    reward_type = rewards_dict.get("reward_type") if rewards_dict else None
    reward_detail = rewards_dict.get("rewards", {}) if rewards_dict else {}

    if reward_type == "experience":
        total_exp = int(round(float(reward_detail.get("exp", 0) or 0)))
        direct_character_exp = int(round(float(reward_detail.get("kill_character_exp", 0) or 0)))
        if direct_character_exp > 0 and character_ids:
            selected_models = db_session.query(CharacterModel).filter(
                CharacterModel.player_id == player_id,
                CharacterModel.character_id.in_(character_ids),
            ).all()
            _, character_updates = _distribute_experience(db_session, selected_models, direct_character_exp)
        material = _add_material(db_session, player_id, MaterialType.CHARACTER_EXP, None, total_exp)
        if material:
            materials_awarded.append(material)
    elif use_drop_share:
        for material_drop in _extract_player_material_drops(drop_summary, player_id):
            material = _award_material_drop(db_session, player_id, dungeon_attribute, material_drop)
            if material:
                materials_awarded.append(material)
    elif reward_type == "exclusive_material":
        material = _add_material(db_session, player_id, MaterialType.EXCLUSIVE_ITEM, None, int(reward_detail.get("material_count", 0) or 0))
        if material:
            materials_awarded.append(material)
    elif reward_type == "equipment_material":
        material = _add_material(db_session, player_id, MaterialType.EQUIPMENT_SET, dungeon_attribute, int(reward_detail.get("material_count", 0) or 0))
        if material:
            materials_awarded.append(material)
    elif reward_type == "illustration_piece":
        material = _add_material(db_session, player_id, MaterialType.ILLUSTRATION_PIECE, None, int(reward_detail.get("illustration_pieces", 0) or 0))
        if material:
            materials_awarded.append(material)
    return materials_awarded, character_updates


def _persist_player_battle_rewards(
    db_session,
    *,
    battle_id: str,
    room_id: Optional[str],
    participant: Dict[str, Any],
    dungeon_id: str,
    dungeon_attribute: AttributeType,
    battle_flow: DungeonBattleFlow,
    rewards_dict: Dict[str, Any],
    drop_summary: Dict[str, Any],
    was_successful: bool,
    use_drop_share: bool,
) -> Dict[str, Any]:
    player_id = participant["player_id"]
    character_ids = list(participant.get("character_ids") or [])
    progress = _get_or_create_progress(db_session, player_id, dungeon_id)
    progress.total_attempts += 1
    if was_successful:
        progress.successful_attempts += 1
        progress.is_completed = True
        progress.completion_count += 1
        if progress.completion_count >= _get_sweep_unlock_count(battle_flow.dungeon):
            progress.sweep_unlocked = True
        progress.last_completion_time = datetime.utcnow()
        best_record = progress.best_record or {}
        best_duration = best_record.get("duration")
        if best_duration is None or battle_flow.duration < best_duration:
            progress.best_record = _build_best_record_payload(battle_flow, rewards_dict)
    else:
        progress.failed_attempts += 1

    materials_awarded, character_updates = _apply_reward_to_player(
        db_session,
        player_id=player_id,
        dungeon_attribute=dungeon_attribute,
        character_ids=character_ids,
        rewards_dict=rewards_dict,
        drop_summary=drop_summary,
        use_drop_share=use_drop_share,
    )
    player_drop_summary = next(
        (bucket for bucket in (drop_summary.get("players", []) if drop_summary else []) if bucket.get("player_id") == player_id),
        {"player_id": player_id, "player_name": participant.get("player_name"), "drops": [], "total_items": 0, "total_quantity": 0},
    )
    progress_record = progress.to_dict()
    progress_summary = _build_result_progress_summary(progress_record, battle_flow.dungeon)
    db_session.add(MultiplayerRewardSettlementModel(
        settlement_id=str(uuid.uuid4()),
        battle_id=battle_id,
        room_id=room_id,
        dungeon_id=dungeon_id,
        player_id=player_id,
        success=was_successful,
        materials_awarded=materials_awarded,
        character_updates=character_updates,
        drop_summary=player_drop_summary,
        progress_summary=progress_summary,
    ))
    return {
        "player_id": player_id,
        "player_name": participant.get("player_name"),
        "characters": character_updates,
        "materials": materials_awarded,
        "progress": progress_record,
        "progress_summary": progress_summary,
        "drops": player_drop_summary,
    }


def _get_battle_participants(battle_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    player_roster = battle_info.get("player_roster") or []
    if player_roster:
        return player_roster
    player_id = battle_info["player_id"]
    player = PlayerManager.get_player_by_id(player_id)
    return [{
        "player_id": player_id,
        "player_name": getattr(player, "username", None) or player_id,
        "character_ids": battle_info.get("character_ids", []),
    }]


def _persist_team_dungeon_record(
    db_session,
    *,
    battle_id: str,
    room_id: Optional[str],
    dungeon_id: str,
    battle_flow: DungeonBattleFlow,
    rewards_dict: Dict[str, Any],
    participants: List[Dict[str, Any]],
    was_successful: bool,
) -> Optional[Dict[str, Any]]:
    if battle_flow.dungeon.dungeon_type != DungeonType.TEAM:
        return None
    performance = battle_flow.get_team_performance() or {}
    role_profile = performance.get("role_profile") or {}
    performance_payload = dict(performance)
    performance_payload["damage_summary"] = battle_flow.get_damage_summary()
    record = TeamDungeonClearRecordModel(
        record_id=str(uuid.uuid4()),
        battle_id=battle_id,
        room_id=room_id,
        dungeon_id=dungeon_id,
        success=was_successful,
        duration=int(round(float(battle_flow.duration or 0))),
        phase_reached=int(performance.get("phase_reached", 0) or 0),
        phase_count=int(performance.get("phase_count", 0) or 0),
        pressure_peak=int(performance.get("pressure_peak", 0) or 0),
        pressure_average=int(round(float(performance.get("pressure_average", 0) or 0))),
        role_score=int(role_profile.get("score", 0) or 0),
        performance_score=int(performance.get("performance_score", 0) or 0),
        reward_tier=str(performance.get("reward_tier") or "C"),
        participants=participants,
        performance_payload=performance_payload,
        rewards=rewards_dict,
    )
    db_session.add(record)
    return record.to_dict()


def _finalize_battle_result(
    battle_id: str,
    battle_info: Dict[str, Any],
    battle_flow: DungeonBattleFlow,
) -> Dict[str, Any]:
    was_successful = bool(getattr(battle_flow, "is_successful", False))
    battle_flow.finish_reward()
    rewards_dict = battle_flow.rewards.to_dict() if battle_flow.rewards else {}
    player_id = battle_info["player_id"]
    dungeon_id = battle_info["dungeon_id"]
    dungeon_attribute = battle_info["dungeon_attribute"]
    drop_summary = battle_flow.get_drop_summary()
    db = get_database()
    db_session = db.get_session()
    try:
        participants = _get_battle_participants(battle_info)
        if battle_flow.is_multiplayer:
            player_results: Dict[str, Any] = {}
            for participant in participants:
                player_results[participant["player_id"]] = _persist_player_battle_rewards(
                    db_session,
                    battle_id=battle_id,
                    room_id=battle_info.get("room_id"),
                    participant=participant,
                    dungeon_id=dungeon_id,
                    dungeon_attribute=dungeon_attribute,
                    battle_flow=battle_flow,
                    rewards_dict=rewards_dict,
                    drop_summary=drop_summary,
                    was_successful=was_successful,
                    use_drop_share=True,
                )
            team_record = _persist_team_dungeon_record(
                db_session,
                battle_id=battle_id,
                room_id=battle_info.get("room_id"),
                dungeon_id=dungeon_id,
                battle_flow=battle_flow,
                rewards_dict=rewards_dict,
                participants=participants,
                was_successful=was_successful,
            )
            db_session.commit()
            primary = player_results.get(player_id) or next(iter(player_results.values()), {})
            return {
                "battle_id": battle_id,
                "player_id": player_id,
                "dungeon_id": dungeon_id,
                "state": _normalize_state(battle_flow.state),
                "outcome": {"success": was_successful, "code": "success" if was_successful else "failed", "label": "success" if was_successful else "failed"},
                "duration": battle_flow.duration,
                "rewards": rewards_dict,
                "characters": primary.get("characters", {}),
                "materials": primary.get("materials", []),
                "progress": primary.get("progress"),
                "progress_summary": primary.get("progress_summary"),
                "drops": drop_summary,
                "damage_summary": battle_flow.get_damage_summary(),
                "team_performance": battle_flow.get_team_performance(),
                "team_record": team_record,
                "player_results": player_results,
                "finished_at": datetime.utcnow().isoformat(),
            }

        participant = participants[0]
        result = _persist_player_battle_rewards(
            db_session,
            battle_id=battle_id,
            room_id=None,
            participant=participant,
            dungeon_id=dungeon_id,
            dungeon_attribute=dungeon_attribute,
            battle_flow=battle_flow,
            rewards_dict=rewards_dict,
            drop_summary=drop_summary,
            was_successful=was_successful,
            use_drop_share=False,
        )
        team_record = _persist_team_dungeon_record(
            db_session,
            battle_id=battle_id,
            room_id=None,
            dungeon_id=dungeon_id,
            battle_flow=battle_flow,
            rewards_dict=rewards_dict,
            participants=participants,
            was_successful=was_successful,
        )
        db_session.commit()
        return {
            "battle_id": battle_id,
            "player_id": player_id,
            "dungeon_id": dungeon_id,
            "state": _normalize_state(battle_flow.state),
            "outcome": {"success": was_successful, "code": "success" if was_successful else "failed", "label": "success" if was_successful else "failed"},
            "duration": battle_flow.duration,
            "rewards": rewards_dict,
            "characters": result.get("characters", {}),
            "materials": result.get("materials", []),
            "progress": result.get("progress"),
            "progress_summary": result.get("progress_summary"),
            "drops": drop_summary,
            "damage_summary": battle_flow.get_damage_summary(),
            "team_performance": battle_flow.get_team_performance(),
            "team_record": team_record,
            "finished_at": datetime.utcnow().isoformat(),
        }
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()


def _personalize_multiplayer_result(result: Dict[str, Any], player_id: str) -> Dict[str, Any]:
    if not isinstance(result, dict) or not result.get("player_results"):
        return result
    own_result = (result.get("player_results") or {}).get(player_id)
    if not own_result:
        return result
    personalized = dict(result)
    personalized["player_id"] = player_id
    personalized["characters"] = own_result.get("characters", {})
    personalized["materials"] = own_result.get("materials", [])
    personalized["progress"] = own_result.get("progress")
    personalized["progress_summary"] = own_result.get("progress_summary")
    personalized["current_player_result"] = own_result
    return personalized


def _start_battle_thread(
    battle_id: str,
    battle_info: Dict[str, Any],
    battle_flow: DungeonBattleFlow,
    run_speed: BattleSpeed,
):
    if battle_info.get("thread_started"):
        return
    battle_info["thread_started"] = True
    battle_info["state"] = "started"
    battle_info["battle_speed"] = int(run_speed.value)
    battle_info["started_at"] = time.time()

    def _battle_thread():
        battle_flow.register_drop_callback(lambda drop_event: broadcast_drop_event(battle_id, drop_event))
        battle_flow.start_battle()
        speed_applied = False
        while True:
            if battle_info.get("stop_requested"):
                battle_flow.state = DungeonBattleState.FAILED
                battle_flow.is_successful = False
                battle_flow._calculate_rewards()
                battle_flow.state = DungeonBattleState.REWARD
                break
            if battle_flow.battle and not speed_applied:
                try:
                    battle_flow.battle.set_battle_speed(run_speed)
                except Exception:
                    pass
                speed_applied = True
            if battle_flow.state in (
                DungeonBattleState.COMPLETED,
                DungeonBattleState.FAILED,
                DungeonBattleState.REWARD,
                DungeonBattleState.FINISHED,
            ):
                break
            tick_delta = float(battle_info.get("battle_speed", run_speed.value))
            battle_flow.update(tick_delta)
            try:
                broadcast_battle_update(battle_id, get_battle_snapshot(battle_flow, battle_info.get("result")))
            except Exception:
                pass
            time.sleep(1.0)

        try:
            result_payload = _finalize_battle_result(battle_id, battle_info, battle_flow)
            battle_info["result"] = result_payload
            battle_info["state"] = "finished"
            battle_info["finished_at"] = time.time()
            room_id = battle_info.get("room_id")
            if room_id:
                try:
                    room = room_manager.mark_finished(room_id)
                    if room:
                        broadcast_multiplayer_room_update(room.to_dict(), event_type="finished")
                    closed_room = room_manager.close_room(room_id)
                    if closed_room:
                        result_payload["room_cleanup"] = {"room_id": room_id, "status": "removed"}
                        broadcast_multiplayer_room_removed(room_id)
                except Exception:
                    pass
        except Exception as exc:
            result_payload = {
                "battle_id": battle_id,
                "error": str(exc),
                "state": _normalize_state(battle_flow.state),
                "finished_at": datetime.utcnow().isoformat(),
            }
            battle_info["result"] = result_payload
            battle_info["state"] = "error"

        try:
            broadcast_battle_update(battle_id, get_battle_snapshot(battle_flow, result_payload))
            broadcast_battle_end(battle_id, result_payload)
        except Exception:
            pass

    threading.Thread(target=_battle_thread, daemon=True).start()


@battle_bp.route("/battle/create", methods=["POST"])
def create_battle():
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    data = request.get_json() or {}
    payload, status = create_single_battle_for_player(
        player_id=player_id,
        dungeon_id=data.get("dungeon_id"),
        character_ids=list(data.get("character_ids") or []),
        assist_enabled=data.get("assist_enabled"),
    )
    return jsonify(payload), status


@battle_bp.route("/battle/<battle_id>/start", methods=["POST"])
def start_battle(battle_id: str):
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    if battle_id not in active_battles:
        return jsonify({"success": False, "message": "battle not found"}), 404
    battle_info = active_battles[battle_id]
    if not _player_has_access(player_id, battle_info):
        return jsonify({"success": False, "message": "forbidden"}), 403
    data = request.get_json() or {}
    run_speed = _coerce_battle_speed(data.get("battle_speed", 1))
    battle_info["requested_speed"] = int(run_speed.value)
    _start_battle_thread(battle_id, battle_info, battle_info["flow"], run_speed)
    return jsonify({
        "success": True,
        "message": "battle started",
        "battle_id": battle_id,
        "speed_state": _build_speed_state(battle_info, battle_info["flow"]),
    }), 200


@battle_bp.route("/battle/<battle_id>/speed", methods=["POST"])
def set_battle_speed(battle_id: str):
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    if battle_id not in active_battles:
        return jsonify({"success": False, "message": "battle not found"}), 404
    battle_info = active_battles[battle_id]
    if not _player_has_access(player_id, battle_info):
        return jsonify({"success": False, "message": "forbidden"}), 403

    speed = _coerce_battle_speed((request.get_json() or {}).get("battle_speed", 1))
    flow: DungeonBattleFlow = battle_info["flow"]
    battle_info["requested_speed"] = int(speed.value)
    message = "battle speed updated"
    if speed == BattleSpeed.X4 and flow.is_multiplayer:
        flow.set_player_agree_4x(player_id, True)
        if flow.can_use_4x:
            battle_info["battle_speed"] = int(BattleSpeed.X4.value)
            if flow.battle:
                flow.battle.set_battle_speed(BattleSpeed.X4)
        else:
            message = "waiting for all players to agree to 4x"
    else:
        battle_info["battle_speed"] = int(speed.value)
        if flow.battle:
            flow.battle.set_battle_speed(speed)
    speed_state = _build_speed_state(battle_info, flow)
    try:
        broadcast_battle_update(battle_id, get_battle_snapshot(flow, battle_info.get("result")))
    except Exception:
        pass
    return jsonify({
        "success": True,
        "message": message,
        "battle_speed": speed_state["current_speed"],
        "speed_state": speed_state,
    }), 200


@battle_bp.route("/battle/<battle_id>/snapshot", methods=["GET"])
def get_battle_snapshot_api(battle_id: str):
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    if battle_id not in active_battles:
        return jsonify({"success": False, "message": "battle not found"}), 404
    battle_info = active_battles[battle_id]
    if not _player_has_access(player_id, battle_info):
        return jsonify({"success": False, "message": "forbidden"}), 403
    return jsonify({"success": True, "snapshot": get_battle_snapshot(battle_info["flow"], battle_info.get("result"))}), 200


@battle_bp.route("/battle/<battle_id>/result", methods=["GET"])
def get_battle_result(battle_id: str):
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    if battle_id not in active_battles:
        return jsonify({"success": False, "message": "battle not found"}), 404
    battle_info = active_battles[battle_id]
    if not _player_has_access(player_id, battle_info):
        return jsonify({"success": False, "message": "forbidden"}), 403
    if not battle_info.get("result"):
        return jsonify({"success": False, "message": "result pending"}), 202
    return jsonify({
        "success": True,
        "result": _personalize_multiplayer_result(battle_info["result"], player_id),
    }), 200


@battle_bp.route("/battle/<battle_id>/stop", methods=["POST"])
def stop_battle(battle_id: str):
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    if battle_id not in active_battles:
        return jsonify({"success": False, "message": "battle not found"}), 404
    battle_info = active_battles[battle_id]
    if not _player_has_access(player_id, battle_info):
        return jsonify({"success": False, "message": "forbidden"}), 403
    battle_info["stop_requested"] = True
    return jsonify({"success": True, "message": "battle stop requested"}), 200


@battle_bp.route("/battle/multiplayer/<room_id>/start", methods=["POST"])
def start_multiplayer_battle(room_id: str):
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({"success": False, "message": "room not found"}), 404
    if room.leader_id != player_id:
        return jsonify({"success": False, "message": "only leader can start"}), 403
    if room.status != "waiting":
        return jsonify({"success": False, "message": "room is not waiting"}), 400
    if not room.all_ready():
        return jsonify({"success": False, "message": "not all members are ready"}), 400

    dungeon = get_dungeon_by_id(room.dungeon_id)
    if not dungeon:
        return jsonify({"success": False, "message": "dungeon not found"}), 404

    participants = []
    domain_characters = []
    owner_map: Dict[str, Dict[str, str]] = {}
    for member in room.members.values():
        models = _load_player_characters(member.player_id, list(member.character_ids))
        if len(models) != len(member.character_ids):
            return jsonify({"success": False, "message": f"invalid characters for {member.username}"}), 400
        if not dungeon.check_unlock_condition(_build_player_data(member.player_id, models, is_solo=False)):
            return jsonify({"success": False, "message": f"dungeon locked for {member.username}"}), 403
        participants.append({
            "player_id": member.player_id,
            "player_name": member.username,
            "character_ids": list(member.character_ids),
        })
        for model in models:
            domain_characters.append(CharacterSerializer.model_to_domain(model))
            owner_map[model.character_id] = {
                "player_id": member.player_id,
                "player_name": member.username,
            }

    total_characters = sum(len(row["character_ids"]) for row in participants)
    if dungeon.dungeon_type == DungeonType.TEAM and (len(room.members) < room.capacity or total_characters < 20):
        return jsonify({"success": False, "message": "team dungeon requires 4 players and 20 characters"}), 400
    if dungeon.dungeon_type == DungeonType.SERVER_BOSS and total_characters < 20:
        return jsonify({"success": False, "message": "server boss requires 20 characters"}), 400

    battle_id = str(uuid.uuid4())
    flow = DungeonBattleFlow(
        dungeon=dungeon,
        player_characters=domain_characters,
        is_multiplayer=True,
        player_roster=participants,
        character_owner_map=owner_map,
    )
    flow.enter_dungeon()
    for participant in participants:
        flow.set_player_ready(participant["player_id"], True)
        flow.set_player_agree_4x(participant["player_id"], False)

    room_manager.mark_in_battle(room_id, battle_id)
    room_payload = room_manager.get_room(room_id).to_dict()
    active_battles[battle_id] = {
        "battle_id": battle_id,
        "player_id": player_id,
        "room_id": room_id,
        "dungeon_id": dungeon.dungeon_id,
        "dungeon_attribute": dungeon.attribute_type,
        "character_ids": [char.character_id for char in domain_characters],
        "flow": flow,
        "state": "created",
        "battle_speed": 1,
        "requested_speed": 1,
        "created_at": time.time(),
        "allowed_players": {row["player_id"] for row in participants},
        "player_roster": participants,
    }

    run_speed = _coerce_battle_speed((request.get_json() or {}).get("battle_speed", 1))
    _start_battle_thread(battle_id, active_battles[battle_id], flow, run_speed)
    broadcast_multiplayer_battle_started(room_payload, battle_id)
    return jsonify({
        "success": True,
        "battle_id": battle_id,
        "room": room_payload,
        "speed_state": _build_speed_state(active_battles[battle_id], flow),
    }), 200


@battle_bp.route("/battle/team-records", methods=["GET"])
def get_team_dungeon_records():
    player_id = session.get("player_id")
    if not player_id:
        return jsonify({"success": False, "message": "not logged in"}), 401
    dungeon_id = request.args.get("dungeon_id")
    try:
        limit = min(max(int(request.args.get("limit", 20) or 20), 1), 100)
    except (TypeError, ValueError):
        limit = 20
    db = get_database()
    db_session = db.get_session()
    try:
        query = db_session.query(TeamDungeonClearRecordModel)
        if dungeon_id:
            query = query.filter(TeamDungeonClearRecordModel.dungeon_id == dungeon_id)
        records = query.order_by(TeamDungeonClearRecordModel.created_at.desc()).limit(limit).all()
        return jsonify({"success": True, "records": [record.to_dict() for record in records]}), 200
    finally:
        db_session.close()
