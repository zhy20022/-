"""Runtime for explicitly authored monster skills; no text interpretation."""

from copy import deepcopy
import random


def states(unit):
    if not hasattr(unit, "cast_effects"):
        unit.cast_effects = []
    return unit.cast_effects


def modifiers(unit):
    result = unit.status_manager.get_stat_modifiers() if unit.status_manager else {}
    result = dict(result)
    totals = {}
    for item in states(unit):
        if item["kind"] != "stat":
            continue
        if item.get("bound_shield") and not any(s["kind"] == "shield" and s["source_skill"] == item["source_skill"] for s in states(unit)):
            continue
        for name in item.get("stats", []):
            totals[name] = totals.get(name, 0) + item["value"]
    for name, value in totals.items():
        # Debuffs cannot make a stat negative. Buffs add, never compound.
        base = getattr(unit.character, name, 1 if name == "healing_received" else 0)
        result[name] = result.get(name, 0) + base * max(-.9, value)
    return result


def healing_multiplier(unit):
    return max(.1, 1 + modifiers(unit).get("healing_received", 0))


def absorb_damage(unit, amount):
    if getattr(unit, "authored_invulnerable", False) or getattr(unit, "mechanic_inactive", False):
        return 0
    shields = [s for s in states(unit) if s["kind"] == "shield" and s["amount"] > 0]
    total = sum(s["amount"] for s in shields)
    absorbed = min(total, amount)
    if total:
        for item in shields:
            item["amount"] *= max(0, 1 - absorbed / total)
        unit.cast_effects = [s for s in states(unit) if s["kind"] != "shield" or s["amount"] > 1e-6]
    return max(0, amount - absorbed)


class HealthPool:
    """Synchronize damage AND healing immediately, including lethal AOE hits."""

    def __init__(self, units):
        self.units = units
        self.maximum = sum(u.max_health for u in units)
        self.current = self.maximum
        for unit in units:
            unit.authored_pool = self
        self.sync()

    def sync(self):
        for unit in self.units:
            unit.max_health = self.maximum
            unit.current_health = self.current
            unit._sync_legacy_health_fields()

    def change(self, amount):
        self.current = max(0, min(self.maximum, self.current + amount))
        self.sync()


def begin_cast(unit):
    # Only effects present before this cast may tick/expire afterwards.
    return list(states(unit))


def end_cast(battle, unit, before):
    for item in before:
        if not any(s is item for s in states(unit)):
            continue
        if unit.is_alive():
            if item["kind"] == "dot":
                old = unit.current_health
                unit.take_damage(0, item["amount"])
                dealt = max(0, old - unit.current_health)
                battle._log(f"{unit.character.name}：{item['name']}结算 {dealt} 伤害", "dot")
                owner = item.get("owner")
                if item.get("drain") and owner and owner.is_alive():
                    owner.heal(dealt, 0)
            elif item["kind"] == "hot":
                unit.heal(int(unit.max_health * item["value"]), 0)
                battle._log(f"{unit.character.name}：{item['name']}结算治疗", "heal")
        if item.get("remaining") is not None:
            item["remaining"] -= 1
            if item["remaining"] <= 0:
                unit.cast_effects = [s for s in states(unit) if s is not item]
    if unit.is_dead() and not unit.is_player:
        battle._on_enemy_killed(unit)


class MonsterRuntime:
    def __init__(self, battle, rng=None):
        self.battle = battle
        self.rng = rng or random.Random()
        self.groups = []

    def attach(self, unit, definition, interval):
        unit.authored_monster = deepcopy(definition)
        unit.character.name = definition["name"]
        unit.spawn_name = definition["name"]
        unit.authored_phase = 0
        unit.authored_cursor = 0
        unit.authored_interval = interval
        unit.authored_next_cast = self.battle.current_time + interval
        unit.authored_used = set()
        unit.authored_runtime = self

    def add_group(self, units, definition):
        entry = dict(definition=definition, units=units, fused=False, strengthened=False,
                     next_common=self.battle.current_time + definition["interval"] * 3,
                     common_count=0, rotation=0, started=self.battle.current_time)
        if definition.get("mode") == "shared":
            entry["pool"] = HealthPool(units)
        for index, unit in enumerate(units):
            unit.authored_group = entry
            unit.mechanic_inactive = definition.get("mode") == "sequential" and index > 0
        self.groups.append(entry)
        self.refresh_groups()

    def refresh_groups(self):
        for entry in self.groups:
            config, units = entry["definition"], entry["units"]
            alive = [u for u in units if u.is_alive()]
            if config.get("mode") == "sequential":
                for unit in units:
                    inactive = unit.is_alive() and unit is not (alive[0] if alive else None)
                    if getattr(unit, "mechanic_inactive", False) and not inactive and unit.is_alive():
                        unit.authored_next_cast = self.battle.current_time + unit.authored_interval
                        self.battle._log(f"【轮流主导】{unit.character.name}激活", "boss_mechanic")
                    unit.mechanic_inactive = inactive
                    if getattr(unit, "boss_mechanic", None):
                        unit.boss_mechanic["active"] = not inactive and unit.is_alive()
            if config.get("balance_guard"):
                for unit in units:
                    unit.authored_invulnerable = False
                if len(alive) == 2:
                    low, high = sorted(alive, key=lambda u: u.get_total_health_percentage())
                    low.authored_invulnerable = high.get_total_health_percentage() - low.get_total_health_percentage() > .2 + 1e-9
            if config.get("fusion") and not entry["fused"] and alive and alive[0].get_total_health_percentage() < .3:
                entry["fused"] = True
                unit = alive[0]
                merged = [s for member in config["members"] for phase in member["phases"] for s in phase]
                unit.authored_monster = dict(name="玄冥合璧", phases=[deepcopy(merged)])
                unit.character.name = unit.spawn_name = "玄冥合璧"
                unit.authored_cursor = unit.authored_phase = 0
                unit.cast_effects = [s for s in states(unit) if not self.negative(s)]
                pool = entry["pool"]
                for retired in units[1:]:
                    if retired in self.battle.enemy_units:
                        self.battle.enemy_units.remove(retired)
                    retired.authored_pool = None
                    retired.current_health = 0
                    retired._sync_legacy_health_fields()
                    retired.authored_retired = True
                entry["units"] = pool.units = [unit]
                unit.heal(int(unit.max_health * .2), 0)
                self.cast(unit, dict(name="双蛟合璧", effects=[dict(kind="stat", target="self", value=.25, stats=["attack", "magic_attack"], permanent=True)]), triggered=True)
                self.battle._log("【双蛟合璧】融合为一个单位，净化并恢复20%生命", "boss_mechanic")
            if config.get("survivor") and len(alive) == 1 and len(units) > 1 and not entry["strengthened"]:
                entry["strengthened"] = True
                unit = alive[0]
                mode = config["survivor"]
                if mode in {"heal75", "fire"}:
                    unit.heal(int(unit.max_health * (.75 if mode == "heal75" else .25)), 0)
                if mode != "heal75":
                    names = ["attack", "magic_attack", "defense", "magic_defense"] if mode == "all_stats" else ["attack"]
                    self.cast(unit, dict(name="同伴遗志", effects=[dict(kind="stat", target="self", value=.3, stats=names, permanent=True)]), triggered=True)
                self.battle._log(f"【同伴倒下】{unit.character.name}触发一次继承效果", "boss_mechanic")
            if config.get("rotate"):
                rotation = int((self.battle.current_time - entry["started"]) // config["rotate"])
                names = ["attack", "magic_attack", "defense", "magic_defense"]
                for index, unit in enumerate(units):
                    unit.cast_effects = [s for s in states(unit) if s.get("key") != "rotation"]
                    states(unit).append(dict(kind="stat", key="rotation", source_skill="rotation", name="移山换位", stats=[names[(index + rotation) % 4]], value=.3, permanent=True, remaining=None))
                if rotation != entry["rotation"]:
                    self.battle._log("【移山换位】四方增益按固定顺序轮换", "boss_mechanic")
                entry["rotation"] = rotation

    def update(self):
        self.refresh_groups()
        for entry in self.groups:
            config = entry["definition"]
            alive = [u for u in entry["units"] if u.is_alive() and not u.mechanic_inactive]
            if config.get("common") and alive and self.battle.current_time >= entry["next_common"]:
                entry["next_common"] = self.battle.current_time + config["interval"] * 3
                self.cast(alive[0], config["common"])
                alive[0].authored_next_cast = self.battle.current_time + config["interval"]
                entry["common_count"] += 1

    def observe_phase(self, unit):
        config = unit.authored_monster
        ratio = unit.get_total_health_percentage()
        thresholds = [.5] if len(config["phases"]) == 2 else [.7, .35] if len(config["phases"]) == 3 else []
        phase = max(unit.authored_phase, sum(ratio < threshold for threshold in thresholds))
        if phase != unit.authored_phase:
            unit.authored_phase, unit.authored_cursor = phase, 0
            if getattr(unit, "boss_mechanic", None):
                unit.boss_mechanic["phase"] = phase + 1
            self.battle._log(f"【阶段切换】{unit.character.name}进入第{phase + 1}阶段", "boss_mechanic")
    def step(self, unit):
        self.refresh_groups()
        if not unit.is_alive() or getattr(unit, "mechanic_inactive", False) or getattr(unit, "authored_retired", False):
            return
        self.observe_phase(unit)
        config = unit.authored_monster
        ratio = unit.get_total_health_percentage()
        skills = config["phases"][unit.authored_phase]
        if not skills or self.battle.current_time < unit.authored_next_cast:
            return
        skill = skills[unit.authored_cursor % len(skills)]
        unit.authored_cursor += 1
        unit.authored_next_cast = self.battle.current_time + skill.get("recovery", unit.authored_interval)
        # Failed conditional slots advance without freezing the cycle or ticking effects.
        if skill.get("below") is not None and ratio >= skill["below"]:
            return
        if skill.get("once") and skill["name"] in unit.authored_used:
            return
        self.cast(unit, skill)
        unit.authored_used.add(skill["name"])

    @staticmethod
    def negative(item):
        return item["kind"] == "dot" or (item["kind"] == "stat" and item["value"] < 0)

    def targets(self, caster, target, primary):
        players = [u for u in self.battle.player_units if u.is_alive()]
        entry = getattr(caster, "authored_group", None)
        allies = entry["units"] if entry else self.battle.enemy_units
        allies = [u for u in allies if u.is_alive() and not getattr(u, "mechanic_inactive", False)]
        if target == "self":
            return [caster]
        if target == "allies":
            return allies
        if target == "all_monsters":
            return [u for u in self.battle.enemy_units if u.is_alive() and not getattr(u, "mechanic_inactive", False)]
        if target == "all":
            return players
        if target == "random":
            return [self.rng.choice(players)] if players else []
        return [primary] if primary and primary.is_alive() else []

    def cast(self, caster, skill, triggered=False):
        before = begin_cast(caster)
        players = [u for u in self.battle.player_units if u.is_alive()]
        primary = max(players, key=lambda u: u.current_health) if players else None
        self.battle._log(f"【怪物技能】{caster.character.name}：{skill['name']}", "boss_skill", {"caster_id": caster.character.character_id, "skill_name": skill["name"]})
        for index, component in enumerate(skill["effects"]):
            hits = int(component.get("hits", 1))
            for _ in range(hits):
                targets = self.targets(caster, component.get("target", "single"), primary)
                if component.get("target") == "random" and targets:
                    primary = targets[0]
                seen_pools = set()
                for target in targets:
                    pool = getattr(target, "authored_pool", None)
                    # An all-allies heal addresses a shared HP pool once, not per portrait.
                    if pool and component["kind"] == "heal":
                        if id(pool) in seen_pools:
                            continue
                        seen_pools.add(id(pool))
                    self.apply(caster, target, skill, index, component)
        if not triggered:
            end_cast(self.battle, caster, before)
        for unit in list(self.battle.enemy_units):
            if unit.is_dead():
                self.battle._on_enemy_killed(unit)

    def apply(self, caster, target, skill, index, original):
        item = deepcopy(original)
        kind, value = item["kind"], item.get("value", 0)
        if kind in {"damage", "hp_damage"}:
            if kind == "hp_damage":
                amount = target.max_health * value
                physical = False
            else:
                physical = item.get("school", "physical" if caster.character.attack >= caster.character.magic_attack else "magical") == "physical"
                if item.get("school") == "mixed":
                    result = self.battle.damage_calculator.calculate_dual_damage(
                        caster.character, target.character, .5, .5, value,
                        modifiers(caster), modifiers(target),
                    )
                    amount = result["total_damage"]
                else:
                    result = self.battle.damage_calculator.calculate_damage(
                        caster.character, target.character, 0, is_physical=physical,
                        skill_multiplier=value, attacker_modifiers=modifiers(caster), defender_modifiers=modifiers(target),
                    )
                    amount = result["final_damage"]
                if target.character.attribute.attribute_type.name == "DARK":
                    amount *= item.get("versus_dark", 1)
            before = target.current_health
            amount = max(0, int(amount))
            target.take_damage(amount if physical else 0, 0 if physical else amount)
            self.battle._log(f"{target.character.name}受到{int(before - target.current_health)}伤害", "damage", {
                "caster_id": caster.character.character_id, "target_id": target.character.character_id,
                "amount": before - target.current_health, "raw_amount": amount, "skill_name": skill["name"], "source": "authored_monster",
            })
        elif kind == "heal":
            before = target.current_health
            target.heal(int(target.max_health * value), 0)
            self.battle._log(f"{target.character.name}恢复{int(target.current_health - before)}生命", "heal", {"target_id": target.character.character_id, "amount": target.current_health - before})
        elif kind == "health_cost":
            # Cost is not damage and cannot be paid from a shield or kill the caster.
            cost = min(max(0, target.current_health - 1), int(target.max_health * value))
            pool = getattr(target, "authored_pool", None)
            if pool:
                pool.change(-cost)
            else:
                target.current_health -= cost
                target._sync_legacy_health_fields()
        elif kind == "corpse_heal":
            consumed = getattr(caster, "authored_corpses", set())
            dead = {u.character.character_id for u in self.battle.player_units if u.is_dead()} - consumed
            caster.authored_corpses = consumed | dead
            target.heal(int(target.max_health * value * len(dead)), 0)
        elif kind in {"cleanse", "dispel", "steal"}:
            count = 0
            for current in list(states(target)):
                eligible = self.negative(current) if kind == "cleanse" else not self.negative(current)
                if eligible and not current.get("permanent") and not current.get("unique_mark") and count < value:
                    target.cast_effects.remove(current)
                    count += 1
            if target.status_manager:
                # Legacy status integration uses the public remove API and preserves marks.
                from .status_system import StatusType
                for current in list(target.status_manager.status_effects):
                    negative = current.status_type in {StatusType.DEBUFF, StatusType.DOT}
                    eligible = negative if kind == "cleanse" else current.status_type in {StatusType.BUFF, StatusType.HOT}
                    if eligible and count < value:
                        target.status_manager.remove_status(current.status_id)
                        count += 1
            if kind == "steal" and count:
                self.apply(caster, caster, skill, index + 100, dict(kind="shield", value=.08 * count, casts=2))
        elif kind == "visual":
            self.battle._log(f"【表现】{item.get('label', skill['name'])}", "skill_effect", {"visual_only": True})
        else:
            if kind not in {"stat", "shield", "dot", "hot", "absorb_fire", "random_attack_down", "alternating_defense_down"}:
                raise ValueError(f"Unsupported monster effect: {kind}")
            if kind == "random_attack_down":
                item.update(kind="stat", stats=[self.rng.choice(["attack", "magic_attack"])])
            elif kind == "alternating_defense_down":
                turn = getattr(caster, "authored_group", {}).get("common_count", 0)
                item.update(kind="stat", stats=["defense" if turn % 2 == 0 else "magic_defense"])
            key = f"{caster.character.character_id}:{skill['name']}:{index}"
            source_skill = f"{caster.character.character_id}:{skill['name']}"
            item.update(key=key, source_skill=source_skill, name=skill["name"], remaining=None if item.get("permanent") or item.get("bound_shield") else item.get("casts"), owner=caster)
            if item.get("scaling") == "missing_health":
                item["value"] *= 1 - caster.get_total_health_percentage()
            if kind == "shield":
                target.cast_effects = [s for s in states(target) if s.get("key") != key]
                item["amount"] = target.max_health * value
            if item.get("bound_shield"):
                target.cast_effects = [s for s in states(target) if s.get("key") != key]
            if kind == "dot":
                result = self.battle.damage_calculator.calculate_dual_damage(
                    caster.character, target.character, .5, .5, value,
                    modifiers(caster), modifiers(target),
                )
                item["amount"] = result["total_damage"]
            cap = item.get("cap", 999999)
            for _ in range(item.get("stacks", 1)):
                if sum(s.get("key") == key for s in states(target)) < cap:
                    states(target).append(dict(item))

    def on_death(self, unit):
        definition = getattr(unit, "authored_monster", {})
        if definition.get("death_skill") and not getattr(unit, "authored_death_cast", False):
            unit.authored_death_cast = True
            self.cast(unit, definition["death_skill"], triggered=True)


def serialize_effects(unit):
    return [{key: value for key, value in item.items() if key != "owner"} for item in states(unit)]
