# Tanks First Readiness

## Final Author Decisions (Supersede Historical Notes Below)

All seven CONFIG_IDS are now enabled. True damage bypasses storage and school
conversion. ID 1 heals 2% own maximum HP on each of two subsequent casts only
when the expired inner-breath pool was positive; overflow damages normally.
ID 2 stores up to 100% maximum HP before shields, releases 35% of the remaining
pool on subsequent active casts, and pays all residual debt when the last stance
ends. Shields may absorb payment; skill 3 clears it before cast-end settlement.
No 25% post-expiry payment remains. ID 26 uses a single HP pool and pre-defense
magic conversion while retaining original physical provenance for wind storage.
Tests cover actual defense/crit calculation, mixed attacks and true-damage bypass.

## Historical Review

`CONFIG_IDS` declares implemented handlers for IDs 1, 2, 9, 10, 18, 25, 26.
`READY_CONFIG_IDS` enables only IDs 9, 10, 18, 25. Do not interpret handler
presence or passing isolated tests as approval of unresolved rules.

## Verified Sources

Read every owned character entry, including every skill note, the seven original
Word files referenced by those entries, and `../游戏设定.txt`.

- ID 1: `../1水/01物理坦克-持柔功法/江无尘.docx`, skill 3, explicitly states:
  `若护盾未被击破，状态结束时护盾剩余值的50%将转化为自身治疗。`
  Only that skill's surviving shield is healed on natural expiry. Breaking or
  overwriting it does not heal. The shield starts at 40% of missing HP.
- ID 9: the original Word supplies the intermediate armor stages omitted by
  the generated character JSON: 2%, 4%, 6%, 8%, ending after three evolutions.
- HP growth is additive against the unmodified maximum, not compounding and
  not an undocumented heal. Growth/marks stay battle-local.

## Pending Rulings

### ID 1

Skill 2 says stored inner breath becomes a 2% recovery effect but does not
unambiguously define the relationship between stored quantity and recovery.
Current provisional implementation: store up to 10% base HP, overflow damages
normally, then consume storage and provide two subsequent 2%-max-HP heals.
Confirm the healing basis, whether zero storage still grants recovery, and
whether storage overflow is immediate damage. Skill 1's soft force is capped at
15% base HP across independent windows and becomes a same-source shield.

### ID 2

Current provisional implementation: store damage before shields up to 100%
max HP; overflow is immediate damage. On each subsequent cast with the stance
present at cast start, release 25% of the current pool, including its final
cast. Preserve the remainder after expiry until recast or skill 3 clears it.
The Word does not specify overflow handling, expiry/battle-end settlement, or
whether release continues after expiry. No invented expiry/battle-end burst.

Settlement subtracts HP exactly once through `take_damage`, never restores HP,
never re-stores its own payment, and uses a valid `PRESSURE_SKILL` in damage
statistics. Actual damage (after shields and lethal clipping) is credited
proportionally to stored sources; fractional debt remains in the pool.
Settlement currently bypasses defense/reduction with `is_true=True` but may be
absorbed by shields. Confirm this interaction and original-school attribution.

Core must honor `modifiers(unit)['crit_immune_magical'] > 0` before crit rolls,
including elemental forced crits, without removing elemental damage multipliers.

### ID 26

Skill 3 has a live `kind='damage_conversion'`, `tank_key='reverse_wind'`,
`school='magical'` state lasting two subsequent holder casts. The module does
not recalculate already-defended damage; merely relabeling it is insufficient.

Required core interface:

1. Inspect that state before defense/resistance/crit calculation on every
   attack path, including authored monsters, ordinary skills and mixed hits.
   Preserve the original attack scaling stat: changing school must not silently
   change the attacker's physical attack into magic attack.
2. Recalculate each originally physical/magical component using magical defense
   and the new school while keeping original component provenance.
3. Pass the post-calculation components separately into `take_damage(p, m)`;
   expose its entry values as `context['original_physical']` and
   `context['original_magical']`. These are damage quantities, not percentages
   or raw attack stats. The hook uses the physical component for 90% storage,
   then returns the unstored sum as magical damage. If core combines the
   components before `take_damage`, it must supply equivalent provenance by
   another explicit field/API; `(0, sum)` alone loses this information.
4. Define handling of later incoming multipliers: provenance and hook damage
   must use the same stage, or carry original component shares and scale them
   by the final hook-entry total. Current hook expects equal-stage quantities.

Other unresolved definitions: the Word describes 3:1 body/soul HP deducted
sequentially, whereas the current engine exposes one HP pool. No replacement
dual-health model is invented here. Confirm whether 130% magic defense means
130% of initial (currently +30%) or a +130% bonus. Confirm overflow behavior
(currently immediate damage), and ordering of conversion versus wind storage.

## Core Scope

The generic incoming hook currently skips `is_true` hits entirely. Authored
"all damage" storage/conversion effects (IDs 1/2/26) need an explicit ruling:
storage is not ordinary damage reduction. The core should call incoming hooks
with `is_true` context and let each effect decide, while skipping ordinary
reductions. This module already checks `is_true` for ordinary reductions and
guards its own settlement. These gaps keep the relevant IDs out of READY.

ID 10 is treated as an always-on skill-2 passive: actual magical HP damage
adds a layer after the hit (not before), capped at 20. Zero/fully shielded hits
do not add layers. ID 18's magical-attack observation includes shielded attacks,
excludes non-attack damage, and resets after every holder cast.

The effect tests isolate this group's registry hooks but exercise real Battle,
BattleUnit, shared modifier computation, proportional shields, and cast clocks.
ID 26's conversion test verifies the hook contract only, not a completed core
pre-defense conversion path. ID 2's immunity test verifies the exported stat,
not core crit prevention.
