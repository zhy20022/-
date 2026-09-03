# Formal online API coverage

This file is the source-of-truth audit for main-city routes in formal online mode.

| Main-city route | Status | Formal API coverage |
| --- | --- | --- |
| `/` | Ready | Player profile, resource bar, idle/daily hints |
| `/characters` | Partial | Profile, experience upgrade, equipment equip/unequip, nine skill slots; illustration and battle-soul tabs remain Python-only |
| `/dungeons` | Partial | Eight-attribute single-player experience dungeons, battle start/settlement, progress and sweep; legacy multiplayer room UI remains Python-only |
| `/gacha` | Ready | Pool config, gold cost, draw, duplicate conversion and persistence |
| `/crafting` | Ready | Material balances, exclusive weapon crafting and equipment-set crafting |
| `/inventory` | Ready | Inventory list, lock/unlock, dismantle preview and dismantle |
| `/online-progress` | Ready | Idle income and daily goals |
| `/shop` | Pending | Activity shop still uses Python endpoints |
| `/social` | Pending UI | NestJS friends-assist endpoints exist; legacy page client migration is still pending |
| `/world-boss` | Pending | World Boss and season loop still use Python endpoints |
| `/quests` | Pending | Legacy quest system is not migrated; daily goals are available at `/online-progress` |
| `/achievements` | Pending | Achievement persistence and claims are not migrated |
| `/enhancement` | Ready | Server-owned preview, material/gold charge, enhancement and breakthrough |
| `/admin` | Redirected | Formal mode redirects to `/online-admin` |
| `/online-admin` | Ready | Player lookup, grants, mail and operation logs |

Pending routes are blocked from the formal-mode main menu with an explicit message, so they cannot silently call the Python API on a public deployment.
