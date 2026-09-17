# DPS First Delivery

## Ready

`READY_CONFIG_IDS` exports 15 implemented characters, IDs
3, 4, 5, 6, 11, 12, 13, 14, 19, 21, 22, 27, 28, 29, 30.
All three slots are present for these IDs. Dispatch does not parse skill text.

## Resolved Low-Resource Branch

- Character 27, slot 3: source Word defines mixed yin/yang (420% single target),
  two yang (300% AOE), and two yin (250% AOE with 20% defense reduction).
  The author confirmed zero or one total yin/yang uses 100% single-target wind
  physical damage, preserving all three higher-resource branches and accumulated
  sword bonuses. All branches are enabled and covered by effect-level tests.

## Resolved By User

- Character 3: remove the entire consecutive-three-casts / next-basic-attack
  passive. No tracking or satiation mark remains. This no longer blocks readiness.

## Source Recovery

All 15 source Word documents were inspected directly, including tables.
The character JSON omits character 27's 420% and 300% branches and character 22's
separate mark definition: three-layer cap and 5% incoming thunder amplification
per layer. These are implemented from the Word documents.

## Integration Contracts

- Parent owns begin/use/log/end once per cast; this module only applies effects.
- `after_cast(battle, unit, before)` runs after normal expiry. Mirage and heavenly
  punishment pulse on the affected target's next two casts, including final expiry.
- Marks have independent lifetimes, owner IDs, source skill IDs, and value 1.
  Paired stat effects have matching expiry and unique-mark dispel protection.
- `damage()` receives a copied effect with damageType, fractional ignore_defense,
  true_damage, or health_ratio (`current`/`max`). Max-health percentage damage
  must not inherit the calculator's 10%-of-attack minimum damage floor.
- Tests use real BattleUnit damage, real DamageCalculator, and real authored
  damage with minimal independent battle fixtures, not registration-only checks.
