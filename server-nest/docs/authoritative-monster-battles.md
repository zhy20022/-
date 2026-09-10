# 怪物机制接入正式 Nest 服务端

## 本轮实现

Nest 负责身份校验、角色归属校验、数据库事务、开始票据、战报访问和奖励结算；受限 Python 子进程复用已有怪物战斗引擎。不是另起 Flask 服务，也不是让客户端计算伤害。Python 使用 `-S`、只依赖标准库、不连接数据库、不接收服务器密钥。

角色等级、职业、技能槽、装备快照在持有玩家锁的事务中读取。使用服务器生成的随机种子计算完整战斗，并将结果持久化到已有 `operation_requests` 开始记录中。本轮不需要新增数据库迁移。服务重启后仍可读取战报和完成结算。

已接入四类副本：经验 24 个（八属性三难度），五人、二十人、全服 Boss 本地挑战各八个（首版普通难度）。普通 Boss 随机选组、阶段、共血、融合、逐个激活、施法后状态等复用同一份 Python 代码。

## 接口

1. `GET /api/dungeons` 获取副本目录。
2. `POST /api/dungeons/:playerId/:dungeonId/start`，请求体 `{"characterIds":["角色实例UUID"]}`。可提供 UUID 格式的 `Idempotency-Key`；重试复用同一个键，不能重复生成战斗。返回 `battleSeed`、`engineVersion` 和角色快照，不返回未来战斗结果。
3. `GET /api/dungeons/:playerId/battles/:battleSeed` 获取可见战报。仅限角色所属玩家。首版服务端回放统一按最高 4 倍速解锁，每场最多约 31 个紧凑快照；`ready` 表示可以结算。`outcome` 在到达实际结束时间前为 null。不能把此接口当作逐帧 WebSocket。
4. 使用原 `POST /api/battle-settlement` 结算，保留原 DTO 字段以兼容调用方，将开始票据放入 `clientTrace.battleSeed`。客户端的成功标记、时长、伤害、击杀数和奖励不再决定结果；结算全部取数据库内的服务端计算结果。

快照 `frame.units` 每项依次为：实例 ID、当前生命、护盾量、从零开始的阶段、未激活标记、当时的名字、当时最大生命、当时技能循环名字。`units` 提供对应元数据，已按当前快照修正名字和生命上限，避免融合后的信息污染较早画面。

经验入口仍需一名同属性角色；五人需五名，二十人和全服 Boss 需二十名本账号角色。首版不限制 Boss 队伍只能同属性。Boss 副本未启用扫荡；奖励使用已有服务端 `reward_rules` 配置，缺省仍为既有通用战斗材料，不采纳客户端奖励列表。

## 安全与运行限制

- 开始与结算沿用数据库幂等唯一键及玩家行锁。重复领取不同 HTTP 键也无法为同一 `battleSeed` 多次发奖。
- 队伍快照冻结，战斗中更换装备不会倒改本场结果。
- 最多两个并行计算进程，进程最长 15 秒，输入不超过 1MB，输出不超过 8MB；超限或失败返回 503，事务回滚，不发奖励。
- 不启用 shell，不把客户端输入拼入命令；子进程环境中不传入数据库 URL、账号 Token、备份密钥。
- 结算以服务端结束时长校验等待时间；不能提交 duration=0 提前领取。
- 旧版没有服务端计算结果的票据必须重新开始，不能继续提交旧式客户端估算结算。
- 角色经验、金币、材料与战斗记录仍在同一个结算事务中持久化。全服 Boss 自疗不扣减本场累计有效伤害。

## 部署

生产 Render Dockerfile 和仓库根目录的 Compose 已包含 Python 标准库计算所需文件。`server-nest/Dockerfile` 现在同样使用仓库根目录作为构建上下文：

```powershell
docker build -f server-nest/Dockerfile .
docker compose -f docker-compose.nest.yml up --build
```

Docker 内设置 `BATTLE_WORKER_ROOT=/workspace`、`CONTENT_DIR=/workspace/data/content`。本地在 `server-nest` 目录启动时默认使用父目录及 `python`（Windows）或 `python3`（Linux）；可用 `BATTLE_PYTHON` 指定可信 Python 可执行文件，`BATTLE_WORKER_ROOT` 指定游戏根目录。修改文件配置后需要重新发布镜像，不能把管理数据库中的目录预览修改误认为已经热更了 Python 技能实现。

本轮没有推送 GitHub、触发 Render 部署或修改 Neon 生产库；Docker 配置已更新，但尚未在本机实际构建镜像。

## 验收

```powershell
npm run typecheck
npm run lint
npm run test:battle-worker
# E2E_DATABASE_URL 必须是隔离的 localhost PostgreSQL 测试库
npm run e2e:authoritative-battle
```

已在隔离 PostgreSQL 完成实际 HTTP 验收：开始幂等重试、隐藏未来结果、越权拒绝、过早结算拒绝、伪造字段无效、六路并发只奖励一次、不同结算内容拒绝重放。计算进程验收覆盖四类副本，固定种子重复运行的结果一致。

联调另修复了两处旧问题：用名字判断群体/Boss 导致击杀分类错误；最后一波刷出与胜利检测同一 tick 时提前判胜。全服 Boss 原先误用经验怪基础属性、满级队伍一秒击败，现已设置独立基础属性；这只是首轮数值，不是最终平衡。

## 尚未完成

- 前端仍需改用服务端战报播放，停止使用本地估算进度。旧画面可能和真实结算不同，不能直接作为新版公开试玩体验。
- 五人和二十人目前是单账号完整队伍的异步挑战，不是跨账号房间同步；全服 Boss 已存真实本场伤害，但尚未把这个 Nest 入口接入赛季共享血池、推层和全服奖励分配。
- 玩家侧仍复用既有 Python 技能槽和装备运行逻辑，本轮不是将 64 个角色全部文本特殊技能重新实现一遍。
- 旧 e2e 脚本中“客户端填满 20 波必然得到满额奖励”的断言不再适用；本轮新增的权威结算脚本使用真实战斗结果验收，旧流程脚本需继续调整测试队伍与断言。
- 战报暂存开始票据，后续要补保留期与容量监控；本轮没有自动删除历史玩家数据。
