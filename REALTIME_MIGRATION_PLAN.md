# 灾异志 / 灾异纪元：实时多人迁移计划

更新日期：2026-10-09，Asia/Singapore

## 实施状态更新：第一阶段可恢复实时房间

以下第 1-12 节是实施前扫描及后续路线，不把其中“尚无 Gateway/版本”的历史描述当作当前实现。当前实时实现已冻结在候选提交 `72d2ab2`；旧 `afa8a00` 不包含本次模块。完整当前结果见 `PROJECT_STATUS.md` 首节。

### 已实现边界

- 保留 HTTP 房间业务命令、轮询、presence heartbeat、Python 完整预计算和原结算语义；新增 Nest Socket.IO `/rooms`，仅通知和恢复。不新增 `starting` 中间事务或 finished-room restart 游戏规则。
- 新增 `multiplayer-rooms.gateway.ts`、`room-events.service.ts`、`multiplayer-room-event.entity.ts`、`1788514000000-MultiplayerRoomEvents.ts`；修改房间 service/controller、AppModule、实体注册、schema-version、HTTP-only guard 的上下文判断、legacy/restore 检查。
- `stateVersion` BIGINT + 每房间唯一事件版本，同一数据库事务、房间锁下保存状态/事件；网络只能读取已提交记录。wire version 使用字符串，eventId 使用 UUID。payload 是权威房间快照，不包含发奖/业务命令。
- **与规划差异**：第一阶段不引入 Redis Pub/Sub 或新的独立 outbox 进程；Gateway 每 500ms 按本连接 cursor 查询持久化事件。跨进程同库通知和并发序列已真实测试，但每连接 DB 读取的成本尚未压测，后续可用 Redis fanout 降低查询成本，仍必须保留 DB 恢复。当前不能声称水平扩容容量已经 Verified。
- 复用现有自定义 `online.*` HMAC AuthService，不改造成 JWT。握手、订阅、持续发送均检查现有身份与有效账号，Origin allowlist、消息16KiB、每账号5连接、每进程1000连接、每连接30次恢复/分钟；这些上限不是容量认证。现有服务没有独立 session 撤销登记，不虚构单令牌撤销。
- 恢复保持房间读锁：验证成员、捕获版本和一致快照、查询缺失事件。cursor 缺省 -> snapshot；完整连续、最多100条 -> events；保留缺口/超限 -> snapshot；不存在/非成员/无效或未来 cursor -> 明确错误。默认保留24小时，每分钟清理，不改变成员业务或重复发奖。
- 前端新增 `realtimeSocket.ts`、`roomRealtimeState.ts`；正式房间页面对接。socket origin 来自正式 API，路径 `/socket.io/`，不走旧 Flask；去重/过期忽略、乱序缺口恢复、恢复与live ACK竞态缓冲、自动重连、卸载/账号/房间隔离、草稿保护。HTTP 2.5秒查询/5秒heartbeat不删除。
- 注册/好友邀请列表仍由 HTTP 轮询；BattlePage 的战斗快照回放仍由 HTTP 驱动。这是房间实时化，不是 Python 流式战斗已完成。

### 实际协议

```text
Client -> room.subscribe { roomId: UUID, version?: decimal-string }
ACK    -> { mode:"events", roomId, version, events:[...] }
       or { mode:"snapshot", roomId, version, snapshot:Room }
       or { error:{status,message} }
Server -> room.event { roomId,eventId,version,eventType,payload:Room,createdAt }
Server -> room.sync { mode:"snapshot",roomId,version,snapshot:Room }
Server -> room.revoked ; disconnect
Client -> room.unsubscribe -> {ok:true}
HTTP   -> GET /api/multiplayer-rooms/:roomId/sync?version=...
```

事件类型：`room.created/member.joined/member.updated/member.presence/member.left/room.presence/battle.started/battle.finished`。所有公开房间快照新增 `version`；客户端仅接受服务端版本。不把重复事件重新执行为命令。Schema 为 `MultiplayerRoomEvents1788514000000`。

### 验收与回滚

- 真实双 Nest/PostgreSQL/socket 已通过鉴权、成员权限、跨实例并发、提交后推送、事务回滚、重启补发、缺口快照和在线身份失效断连。
- 真实双浏览器已通过实时开关开启3+2十局/20结算/逐局对账、阻断HTTP current后socket准备状态同步、离线重连；HTTP-only两局及服务端拒绝socket后的HTTP回退两局均通过。最终补强请求隔离后另重跑服务端及实时两局；精确证据在状态文档列出。
- 前端 reducer/Mock transport 单测与真实集成明确分开；Python221/486、worker、两端build/typecheck、Nest lint、legacy migration、H03/H04/H05当前schema回归均重新执行通过。
- 回滚：关闭 `ROOM_REALTIME_ENABLED`；前端runtime `roomRealtime:false` 或 `VITE_ROOM_REALTIME=false`。保留已迁移列和事件表即可回HTTP；需要部署旧代码时优先保留扩展schema，不未经备份运行down migration。
- 依赖仅新增Nest10.4.22 websockets/platform-socket.io（Socket.IO4.8.1）及必要传递依赖，更新server lock；已有依赖无版本升级。Python/角色/经济/八属性规范未修改。
- **未验证**：Docker H06、WSS/TLS反代、目标PostgreSQL16、事件保留定时任务长期运行、规模化延迟/压测、四账号二十角色在线、多节点生产运维。H06不得升级为PASS。历史选角不足仍未完全定位。
- 下一阶段先冻结本次候选并关闭生产Docker/WSS恢复门禁，然后再规划权威战斗事件同步；本轮不提前实现后者。

扫描 HEAD：`70df18cf451f31bf86c44e4f6d2eb88d322f4579`（相对候选仅两份交付文档不同）

当前候选：`afa8a00f67aec246a63670e0856d3ca37202eec4`
当前阶段：Alpha / Frozen Candidate / Docker Gate Pending

## 1. 结论摘要

当前项目已经具备“可验证的在线多人切片”，但还不是实时多人架构：

- 正式线上多人使用 NestJS HTTP API、房间轮询、HTTP heartbeat、服务端预计算战斗和回放。
- 前端正式模式的房间状态约每 2.5 秒轮询，在线状态约每 5 秒 heartbeat；正式战斗状态约每 2 秒读取一次。
- 前端虽然已经依赖 `socket.io-client`，但现有 Socket.IO 主要属于旧的 Flask/Python 原型路径。正式 Nest 路径没有对应的 WebSocket Gateway。
- Python Worker 是一次性同步子进程：开战时完整计算战斗，输出 frames/events，Nest 将结果保存在服务端票据中，之后按服务器时间裁剪可见回放。
- 房间已有 `waiting -> starting/in_battle -> finished/cancelled` 状态和数据库 presence 字段，但没有房间事件日志、单调版本号或断线后的增量恢复协议。
- PostgreSQL、Redis、幂等请求和结算事务已经是可靠基础；Redis 当前只封装了连接和 `PING`，尚未承担事件总线职责。
- Docker H06 仍未验证。本计划不把 H06 静态检查、源码构建或架构设计当作 Docker PASS。

**推荐路线：实时自动战斗 + 实时战斗事件同步。**

具体做法是：

1. 第一阶段只把正式 Nest 房间状态从轮询改为“WebSocket 推送 + HTTP 快照恢复”。
2. 房间的创建、邀请、选角、准备、开战、离开和结算仍先保留 HTTP 命令，避免一次性改变已验证的事务边界。
3. 第二阶段把已有服务端预计算战斗中的 frames/events 以带序号的实时事件流推送给客户端；服务端时间、战斗快照和现有结算规则保持权威。
4. 第三阶段再处理多实例、Redis Streams/适配器、WSS、事件恢复和负载。
5. 不把当前项目改造成实时操作型战斗，不重写角色养成、战斗规则、奖励和结算系统。

证据边界：本轮只读取源码、配置、锁定依赖和现有验收归档，核对官方协议文档；没有启动服务、执行业务回归、修改依赖或重新验证 H01-H06。H01-H05/十局结果来自 2026-10-08 候选归档，不是本轮新测试。计划中的 Gateway、序列协议、事件表、Streams 和性能目标全部是待实现/待验证项。本轮唯一新增文件是本计划，不提交、不 push。

优先级区分：**实时改造的第一个开发任务是 Phase 1 房间推送切片；公网发布的第一阻塞仍是 H06。** 可以在隔离环境先做 Phase 1，但不能因为实时协议通过而绕过 H06，也不要求先有公网环境才能开发协议。

## 2. 当前架构扫描

### 2.1 正式 Nest 多人链路

核心文件：

- `server-nest/src/multiplayer-rooms/multiplayer-rooms.controller.ts`
- `server-nest/src/multiplayer-rooms/multiplayer-rooms.service.ts`
- `server-nest/src/database/entities/multiplayer-room.entity.ts`
- `server-nest/src/database/entities/multiplayer-room-member.entity.ts`
- `server-nest/src/database/migrations/1788513000000-MultiplayerRoomPresence.ts`
- `server-nest/src/dungeons/dungeons.service.ts`
- `server-nest/src/battle-settlement/battle-settlement.service.ts`

当前已经存在的能力：

- 房间创建、邀请、接受、选角、准备、开战、读取战斗、结算、离开。
- 房间状态和成员选角在 PostgreSQL 中保存。
- 事务内使用悲观锁保护房间、玩家和角色。
- 通过 `OperationRequestEntity` 和 `IdempotencyService` 保护开战与结算幂等。
- 使用 `connectionStatus`、`lastSeenAt`、`disconnectedAt` 实现 presence 和重连宽限期。
- 开战时服务端汇总全队角色，生成一个共享 battle seed 和共享 `serverBattle`。

当前限制：

- `MultiplayerRoomsService` 依赖定时 sweep 和客户端 HTTP heartbeat 发现断线。
- 房间状态变化没有持久化的版本号和事件序列。
- 事务提交后没有标准的事件发布边界；其他客户端只能通过下一次轮询看到变化。
- `starting` 当前只是类型/扫描范围的一部分，开战正常路径在同一事务内从 `waiting` 直接进入 `in_battle`；没有已提交的异步 starting/job 生命周期，不能把它当作现成后台任务系统。
- 没有正式 Nest WebSocket Gateway，也没有 Socket.IO handshake 鉴权和房间订阅授权。
- 房间状态序列化是当前快照，但没有 `lastVersion` / `eventId` / `sequence`。

### 2.2 正式前端链路

核心文件：

- `web/src/pages/MultiplayerRoomPage.tsx`
- `web/src/pages/BattlePage.tsx`
- `web/src/services/onlineApi.ts`
- `web/src/services/serverBattleReplay.ts`
- `web/src/config.ts`

正式模式当前行为：

- `MultiplayerRoomPage.tsx` 的 `FormalOnlineMultiplayerPage` 通过 `/api/multiplayer-rooms/*` 工作。
- 房间状态通过 `refreshFormalState()` 每约 2.5 秒读取。
- 房间 presence 通过 `/heartbeat` 每约 5 秒写入。
- `BattlePage.tsx` 的正式线上模式通过 `/multiplayer-rooms/:roomId/battle` 每约 2 秒读取。
- 客户端收到服务端状态后由 `serverBattleSnapshot()` 转换为展示快照。
- 结算仍走 `/multiplayer-rooms/:roomId/settle`，没有由客户端事件直接发奖。

同时存在旧路径：

- `LegacyMultiplayerRoomPage` 使用旧 Flask API 和 Socket.IO 事件。
- `BattlePage.tsx` 的非正式模式使用 `battle_join`、`battle_tick`、`battle_end` 等旧 Socket.IO 事件。
- `src/server/websocket.py` 使用进程内字典保存 socket presence，并直接广播旧事件。

旧路径不能直接作为正式实时架构复用。它没有与 Nest 正式认证、PostgreSQL 房间状态、幂等结算和当前 migration 绑定。

### 2.3 战斗计算与回放

核心文件：

- `server-nest/src/battle-settlement/battle-simulation.service.ts`
- `server-nest/src/dungeons/dungeons.service.ts`
- `server-nest/src/battle-settlement/battle-settlement.service.ts`
- `scripts/nest_battle_worker.py`
- `web/src/services/serverBattleReplay.ts`

当前模型：

1. Nest 在开战事务中调用 Python Worker。
2. Worker 使用 seed 计算完整战斗，生成有限数量 frames 和最多 512 个事件。
3. Nest 把完整结果放进 server-issued operation ticket。
4. Nest 根据 `serverTime` 和固定 4x 速度计算客户端当前可见时间。
5. 客户端读取当前 frame 和事件，完成展示。
6. 结算时重新校验服务器票据、时间、角色归属和权威结果，奖励由 Nest 事务发放。

这是适合当前自动战斗玩法的“服务端权威预计算回放”，不是实时 tick simulation。它可以作为第一版实时事件流的基础，不需要先重写 Worker。

不能遗漏的约束：

- `BattleSimulationService` 每 API 进程同时最多两个 Worker，无持久任务队列；单次超时 15 秒、输入上限约 1 MB、输出缓冲约 8 MB。
- `startRoom()` 当前在房间/玩家/角色事务锁持有期间等待模拟结果。这保护现有原子发布，却使慢计算阻塞数据库锁；Socket.IO 本身不会消除这个问题。
- Worker 固定调用 `flow.update(.25)`，frame 按时长抽样（约最多 32 帧），只收集部分技能/死亡/机制事件；超过 512 个会丢弃最早事件。它不是完整伤害/治疗/Buff事件日志，掉落 `sequence` 也不是正式战斗传输序号。
- 当前 `battleStatus()` 每次返回截至当前时间的累计可见事件，没有增量 cursor；多人完整 `serverBattle` 分别放在各成员票据中，后续增长需测量，不能无限扩展。
- 同 seed 测试不等于任意引擎/content 版本都可重演。冻结 roster、装备、技能、content hash、engineVersion，且以已保存结果为准。

### 2.4 Redis、部署和代理

核心文件：

- `server-nest/src/common/redis.service.ts`
- `server-nest/src/health/health.controller.ts`
- `deploy/production/docker-compose.prod.yml`
- `deploy/production/docker-compose.public-api.yml`
- `deploy/production/Caddyfile`
- `deploy/production/nginx/templates/default.conf.template`
- `render.yaml`

当前情况：

- Nest 有 Redis 连接、`PING` 和 readiness 检查，但没有发布/订阅或事件流封装。
- Nginx 和 Caddy 配置已经为 `/socket.io/` 设置了 WebSocket upgrade 代理意图。
- 生产 API 仍然没有 Nest Gateway，因此代理路径不能证明 WebSocket 业务已可用。
- 两套生产 Compose 的真实 Docker build/start/migration/readiness 仍是 H06 未验证状态。
- Render 配置是单个 Nest API + Redis + PostgreSQL 的部署模型，没有多实例事件恢复证明。

### 2.5 保留 / 升级边界

| 模块 | 决策 | 理由与时机 |
|---|---|---|
| `src/combat/`、属性/角色/技能和 content | 保留 | 规则已存在，不是传输层；后续只加包装/observer |
| Nest 玩家养成、背包、装备、抽取、任务/奖励 | 保留现有 HTTP | 实时房间不要求所有业务变 WS，也不扩大未验收业务范围 |
| `IdempotencyService`、结算、排行榜/封禁 | 保留业务约束并补 WS 安全适配 | 重用事务/一次发奖；长连接不能绕过 H03/H04 |
| 房间 Controller/Service/entity | 渐进升级 | 新增版本、事件/outbox、恢复，不另造平行房间事实源 |
| React 正式房间状态获取 | 升级 | socket 优先、snapshot/reducer + polling fallback |
| 正式 BattlePage / serverBattleReplay | 第二阶段升级 | 显示事件同步，不重算战斗或发奖 |
| Python Worker 进程模型 | 先保留，按实测可选升级 | 事件传输不需要常驻模拟进程；解锁事务/队列单列 |
| Redis / Gateway / proxies | 新能力与独立验收 | 当前无跨实例事件总线；已配置 proxy 不等于 WSS PASS |
| 旧 Flask Socket.IO | 隔离保留，不移植认证与发奖 | 不是正式 Nest 多人权限/数据库协议 |

## 3. 三种实时战斗方案比较

| 方案 | 适配当前游戏 | 改造范围 | 优点 | 主要问题 | 结论 |
|---|---|---:|---|---|---|
| 实时自动战斗（实时计算） | 中高 | 中高 | 可复用规则，由服务端随时间推进 | 需长期 Worker、调度、恢复、输入/检查点语义，非当前预计算模型 | 可选后期，不是近期必需 |
| 实时战斗事件同步 | 很高 | 中 | 将已有 frames/events 变成实时推送；服务端继续权威；断线可恢复 | 需要事件日志、sequence、snapshot 和 gateway | **推荐主路线** |
| 实时操作型战斗 | 低 | 很高 | 适合需要玩家逐 tick 操作的动作/战术游戏 | 需要输入协议、tick loop、反作弊、长生命周期 Worker、战斗锁和大量新测试；会改变现有战斗规则边界 | 当前不做 |

这里三者不是完全互斥的传输协议。“实时自动战斗”严格意义是服务端随时间推进计算；现有自动战斗是预计算。推荐的近期交付是**自动战斗结果的实时事件同步**，不是宣称计算已经实时。真正实时自动计算放到可选后期，只有产品需要中途互动或预计算无法满足容量时再批准。

推荐不是单纯“把 HTTP 换成 WebSocket”，而是：

> HTTP 负责权威命令和事务，WebSocket 负责低延迟通知与事件传输，PostgreSQL 快照/事件日志负责恢复，服务端 Worker 和结算继续负责权威结果。

## 4. 推荐目标架构

### 4.1 逻辑分层

```text
React Client
  ├─ HTTP command: create / invite / select / ready / start / settle
  ├─ Socket.IO subscribe: room / battle
  ├─ snapshot recovery: HTTP or socket request with lastVersion
  └─ local reducer: deduplicate and apply ordered events

NestJS
  ├─ REST Controllers: existing mutation and recovery APIs
  ├─ Realtime Gateway: authentication, authorization, subscriptions
  ├─ Room State Service: existing transaction/state machine
  ├─ Room Event Service: append event after state mutation
  ├─ Battle Stream Service: expose precomputed events by server time
  ├─ PostgreSQL: room state, event log, idempotency, settlement
  └─ Redis: low-latency fan-out / Streams in multi-instance stage

Python Worker
  └─ existing deterministic full simulation; no rewrite in first two phases
```

### 4.2 房间事件模型

建议新增一张 append-only 房间事件表，而不是只依赖 Redis：

```text
multiplayer_room_events
  id               UUID primary key
  room_id          UUID not null
  sequence         BIGINT not null
  event_type       VARCHAR not null
  payload          JSONB not null
  created_at       TIMESTAMP not null
  actor_player_id  UUID nullable
  unique(room_id, sequence)
  unique(id)
```

房间实体增加：

```text
state_version     BIGINT not null default 0
```

每次改变房间状态的事务必须：

1. 锁定房间行。
2. 校验状态机和命令权限。
3. 更新房间/成员。
4. 将 `state_version` 加一。
5. 在同一事务插入事件。
6. 事务提交后再通知实时层。

**版本代表业务状态变化，不代表每次读请求或 heartbeat。** 选角/准备/加入/离开/转移房主/开战/结算/取消及 online/offline 状态转变才推进版本；重复 heartbeat、幂等重放、快照读取不制造新版本。当前 `refreshPresence()` 在读路径也保存行，后续要做差异检测，避免把 `updatedAt` 当版本。

事件记录是恢复依据，Redis 不是事实来源。Redis Pub/Sub 是 at-most-once，只能当作低延迟唤醒信号，不适合作为断线补发日志。[S3] 多实例阶段可以使用 Redis Streams 或 Socket.IO Redis Streams adapter；仍保留 PostgreSQL snapshot/event log 作为业务恢复边界。[S4]

事件表同时可作为小规模 transactional outbox。需要增加发布状态/attempt/lease/next retry 等字段或独立 outbox 表（二选一，第一版不同时造两套抽象）。进程启动后从未发布记录重试；数据库 commit 成功但进程在 emit 前崩溃不能丢通知。多实例发布器使用有限批次、数据库抢占/租约及 `FOR UPDATE SKIP LOCKED`（官方说明适用于 queue-like 多消费者，不是快照一致性查询），并保证每房间有序发布；消费去重仍必需。[S8] 这里是 at-least-once 投递 + 幂等业务，不承诺网络 exactly-once。

首个版本的单实例 Gateway 可本地 fan-out，不必先依赖 Redis adapter。Pub/Sub/Streams 放到多实例阶段；Redis 现有 readiness 设计仍按部署约束保留，不能以“单节点房间可降级”为理由宣称整个生产 ready。

### 4.3 Socket.IO 协议草案

先使用现有前端依赖的 Socket.IO 协议，不引入操作型战斗输入。

客户端到服务器：

```text
realtime:room:subscribe
  { roomId, lastVersion?: number }

realtime:room:unsubscribe
  { roomId }

realtime:battle:subscribe
  { roomId, battleSeed, lastSequence?: number }

realtime:resync
  { roomId, fromVersion?: number }
```

服务器到客户端：

```text
realtime:ready
  { connectionId, serverTime, protocolVersion }

realtime:room:snapshot
  { roomId, version, state, serverTime }

realtime:room:event
  { roomId, eventId, version, type, payload, serverTime }

realtime:battle:event
  { roomId, battleSeed, sequence, battleTime, type, payload }

realtime:battle:snapshot
  { roomId, battleSeed, sequence, frame, serverTime, ready }

realtime:resync_required
  { roomId, reason, latestVersion }
```

协议要求：

- 所有连接先通过 `AuthService` 校验 access token 和 active account。
- 订阅房间时再次检查成员关系或可见性，不能相信客户端传入的 playerId。
- 客户端按 `version` / `sequence` 去重，旧事件不能覆盖新状态。
- 断线重连携带 lastVersion/lastSequence。
- 服务端无法补齐连续事件时发送 `resync_required`，客户端获取完整快照后继续订阅。
- 事件中不能携带可直接发奖的客户端权威字段；结算继续走现有服务端票据。

Socket.IO 默认保证到达消息的顺序，但默认到达语义是 at-most-once；要自己补 eventId/persistence/cursor/resync，ACK 不是永久保存。[S1] Room/订阅身份以 token 推导，不能把 socket.id 当玩家或持久会话 ID。

Phase 1 优先发送**带版本的完整小房间快照**作为事件 payload，不先追求复杂 delta reducer。跳版本时直接应用最新授权快照；若以后只发 delta，缺口必须先补齐/全量恢复。选角 ready、房主、开战状态等只有一个数据库序列，不按各 API 节点 local counter 生成。事件类型可用 `member.changed`、`presence.changed`、`leader.changed`、`battle.started`、`settlement.changed`、`room.closed`。

room 订阅只允许当前/历史有权限成员；大厅仅输出该账号已有可见性约束下的摘要，邀请走受邀人专属通知。event log payload 不能复制 `OperationRequest.response`、token、未揭晓 serverBattle、其他成员私有奖励。已结算玩家的 `current=null` 不等于整个房间结束，离房/换房要移除旧订阅，历史 resume 单独检查资格，不自动重新加入活跃房间。

订阅恢复必须解决 snapshot/event 竞态：

1. 验证 token、active account、room membership；仅加入未完成恢复的临时订阅缓冲区。
2. 在同一数据库一致性视图中读取房间/成员快照和当前版本 V，而不是各自独立读取后拼接。
3. 返回 version=V 的快照，或按客户端 cursor 补齐连续事件。
4. 再排空/补查 V 之后已提交的事件，去重后进入正常实时推送；任何 gap 请求 resync。
5. 定期低频 version check 或 server watermark 保留作为活性校验，避免“丢失最后一个通知、后面无事件”永远不发现。

事件游标不是访问权限。重连和恢复都重新鉴权、校验当前成员关系；不能因 cursor 曾合法就恢复越权订阅。数据库 BIGINT 到 JSON/JavaScript 需明确编码，推荐协议使用十进制字符串并用 BigInt 比较（不直接 JSON 序列化 BigInt）；上面的 `number` 草案仅表达单调序列，不能静默超过 Number 安全整数上限。

**H04 不能仅在握手检查一次。** 当前 `ActiveAccountGuard` 使用 `switchToHttp()`，实现不适用于 WS。Nest 可以在 Gateway/method/global 注册 guard，但必须按 context 处理 client/data，不能把现有 HTTP-only 实现原样视为 WS 安全；WS 异常用对应协议错误/`WsException`。[S6/S7] `AuthService` 的 `online.<payload>.<HMAC>` 是现有自定义 token，不是假定 JWT。使用现有 `verifyActiveAuthorization()`，不在本阶段换认证格式。

长连接期间：收到封禁事件立即在所有实例停止该账号的出站队列/订阅并断开全部会话；推送前和敏感命令再检查有效身份，token 到期强制重认证，断线重连也不得跳过 guard。跨实例封禁通知失败时采用数据库复核/短租约 fail-closed；测试要证明已连接账号封禁后不能继续收敏感推送，不能只验证无法新建连接。

每个 socket 限制消息大小、订阅数、命令频率和待发送缓冲量，校验 Origin 白名单，token 不放 query string/日志。当前 HTTP IP 限流的进程内 Map 不覆盖 WS message，也不跨实例；第一版新增账号维度 WS 限流，多实例再统一 Redis 配额。登出/换账号清除 cursor、缓冲和订阅，页面路由只复用一个正式连接，避免 mount/StrictMode 造成重复 socket。

### 4.4 战斗事件模型

第一版不修改战斗规则和 Worker，只把已有结果分段暴露：

- `battleSeed` 仍是唯一战斗身份。
- `serverTime` 仍是服务端时钟起点。
- `battleTime` 由服务端计算，不接受客户端时间。
- 将已有 `events` 按时间分组，并为每组分配单调 `sequence`。
- 定时器或请求触发器只发布“当前时间以前尚未发布”的事件。
- 客户端收到事件后更新展示；定期收到完整 frame/snapshot，避免只靠事件重建状态。
- 最终结果仍由 `BattleSettlementService` 根据服务器票据计算，WebSocket 事件不能完成结算。

序列在冻结输出后生成并保存/可确定重建，使用稳定原始次序解决同一 `time` 的多个事件；不能在每次订阅时重新随机生成 eventId。roomVersion 与 battleSequence 是两个作用域，不能混用。统一服务端共享时间线，开始/重连返回实际 `serverTime`、`battleStartedAt`、speed、可见游标；客户端插值仅为显示，不决定胜负、可结算时间或提速。

只发布已经到达服务器可见时间的 frames/events/outcome，恢复也不能下发未来事件或完整未揭晓结果。客户端慢于服务器时合并中间展示帧并发最新 snapshot，不丢必需终态/结果通知；超过发送预算触发 resync/受控断开，不能无限堆积。

当前最早事件被 Worker 的 512 上限丢弃时，第一版最多承诺“已有事件子集 + 状态快照一致”，不能声称全技能/全伤害流完整。若需要完整事件，应在单独的 Worker 输出包装层增加 observer/bounded batches/versioned envelope，明确 cursor 截断和 snapshot fallback，不能简单删除上限或提高缓冲绕过资源保护。

第二版再决定是否把完整 `frames` 从 operation ticket 拆到单独的 battle snapshot 存储。第一阶段不要为了实时传输先改变结算表、奖励表或 Worker 输出契约。

### 4.5 显式状态机

| 当前状态 | 允许行为 | 下一状态/保护 |
|---|---|---|
| waiting | 加入、选角、准备、离开、房主转移 | 更新版本；不足 5/20、未 ready/offline、角色重复/越权不能开战 |
| waiting -> starting（可选异步阶段） | 冻结 roster 和 jobId | 只在后台任务阶段启用；禁止继续改选角；有 lease/deadline |
| starting | 同 jobId 重试、查询进度 | 成功原子发布全成员 ticket -> in_battle；失败回 waiting 或取消，有补偿记录 |
| in_battle | 读取/订阅、断线恢复、已到时各自结算 | 一人结算不能撤销其他人的资格；已结算成员可以退出到下一房间 |
| finished | 历史查询和个人结果恢复 | 全成员结算后终态；不得重新开战或再发奖励 |
| cancelled | 查询终态 | 不能新入场或启动；后续另建房间 |

Phase 1 沿用当前 waiting -> in_battle 原子启动，不提前引入异步 starting。room lifecycle、connection lifecycle 和每玩家 settlement lifecycle 分开管理：TCP 断开不等于离房，战斗完成不等于所有成员已领奖。

## 5. 模块改造清单

### 5.1 第一优先级：正式 Nest 房间实时 Vertical Slice

预计新增或修改：

- `server-nest/src/multiplayer-rooms/multiplayer-rooms.gateway.ts`：Nest WebSocket Gateway，握手鉴权、房间订阅、断开清理。
- `server-nest/src/realtime/realtime-auth.service.ts`：复用 `AuthService`，统一解析 Socket.IO auth/header，拒绝 inactive account。
- `server-nest/src/realtime/room-event.service.ts`：房间事件写入、版本推进、快照恢复。
- `server-nest/src/database/entities/multiplayer-room-event.entity.ts`：事件实体。
- `server-nest/src/database/migrations/<timestamp>-MultiplayerRoomEvents.ts`：事件表和 `state_version` migration。
- `server-nest/src/multiplayer-rooms/multiplayer-rooms.service.ts`：把事务状态变更接入事件记录；保留原 HTTP 命令行为。
- `server-nest/src/multiplayer-rooms/multiplayer-rooms.controller.ts`：增加 HTTP snapshot/resync 入口，作为 WebSocket 失败时的后备。
- `server-nest/src/common/redis.service.ts`：首个单实例切片可保持不变；到跨实例阶段再补独立 pub/sub 连接或 Streams adapter，不能共用进入订阅模式的连接执行普通 Redis 命令。
- `server-nest/src/app.module.ts`、`database/entities-list.ts`、`database/entities/index.ts`、`database/typeorm-data-source.ts`、`database/schema-version.ts`：按现有注册方式加入实体/迁移/schema，更新备份恢复列检查，不能只改 TypeScript 类型。
- `server-nest/src/auth/active-account.guard.ts`、`auth/auth.service.ts`、`admin/admin.service.ts`：按需提供 WS context 身份校验/封禁通知入口，保持现有 HTTP H03/H04 行为。
- `server-nest/package.json` / `server-nest/package-lock.json`：按 Nest Gateway 方案补服务端 Socket.IO 依赖；此计划阶段不改文件。

需补齐 `@nestjs/websockets`、`@nestjs/platform-socket.io` 及服务端 Socket.IO 的明确兼容版本，并登记 Gateway provider。[S6] 这不是升级整个 Nest 或删除既有锁文件；实现阶段依赖变更单独审阅。

前端：

- `web/src/services/realtimeSocket.ts`：正式 Socket.IO 客户端、连接状态、订阅、重连和协议版本。
- `web/src/services/roomStateReducer.ts`：按 version/eventId 合并快照和增量事件。
- `web/src/pages/MultiplayerRoomPage.tsx`：只在 `FormalOnlineMultiplayerPage` 接入新 Gateway；保留 HTTP 命令和 polling fallback。
- `web/src/pages/BattlePage.tsx`：第一阶段可不改；正式 socket 服务挂在登录会话级保持路由切换，不迁移 battle polling/结算。
- `web/src/config.ts`：正式 WebSocket URL、协议版本和 feature flag。

正式 socket origin 必须绑定 Nest API/显式 realtime runtime 配置，不能直接复用原 `getSocketUrl()` 默认 `window.location.origin`。静态前端域名可能是 GitHub Pages/另一站点；本地默认 `/socket.io` 的 Vite proxy 仍指向 Flask 5000，而正式 HTTP 默认指向 Nest 4100。实现要统一 scheme/host/path（Socket.IO 默认 `/socket.io`，不自动加 `/api`）、WSS/CORS/Origin 与 token 重连读取；连不上只回退正式 HTTP，不偷偷切到旧 Flask。

测试：

- `server-nest/scripts/e2e-multiplayer-realtime.mjs`：两个真实账号、两个浏览器、HTTP 命令 + Socket 状态推送。
- `server-nest/scripts/e2e-multiplayer-reconnect.mjs`：断开、重连、lastVersion 恢复、snapshot fallback。
- `web/scripts/test-realtime-room-reducer.cjs`：乱序、重复、跳版本和 resync 规则。
- `server-nest/src/.../*.spec.ts` 或项目现有测试位置：状态机、事件事务、权限和幂等单测。

当前没有现成 Jest 单测运行脚本，不假定新增 spec 就会执行。优先沿用仓库 `scripts/*.mjs` 的 Node assert/真实 PostgreSQL/Playwright 入口；确定 runner 后再讨论框架。上述新增文件名都是建议，不表示已经创建。

### 5.2 第二优先级：战斗实时事件同步

- `server-nest/src/battle-stream/battle-stream.service.ts`：从权威 `serverBattle` 产生按时间可见的 event batch/snapshot。
- `server-nest/src/dungeons/dungeons.service.ts`：增加带 `sequence`、`serverTime`、`battleTime` 的状态/事件读取契约；保持现有结算校验。
- `server-nest/src/battle-settlement/battle-settlement.service.ts`：只确认仍使用权威票据，不把 socket payload 作为输入。
- `scripts/nest_battle_worker.py`：第一版只稳定输出已有 `events/frames` 契约，不改战斗规则。
- `web/src/services/serverBattleReplay.ts`：支持 `sequence`、snapshot recovery 和重复事件过滤。
- `web/src/pages/BattlePage.tsx`：Socket 优先、HTTP snapshot fallback；保持断线期间可恢复和最终结算重试。
- `server-nest/scripts/e2e-battle-events.mjs`：两账号同 seed、事件顺序、断线恢复、最终结算一致性。

### 5.3 第三优先级：多实例和生产实时基础设施

- `server-nest/src/common/redis.service.ts`：Redis Streams 或正式 Socket.IO adapter 的连接、重连和 shutdown。
- `server-nest/src/realtime/realtime-publisher.service.ts`：数据库提交后发布，避免事务未提交就广播。
- `deploy/production/docker-compose.prod.yml`
- `deploy/production/docker-compose.public-api.yml`
- `deploy/production/Caddyfile`
- `deploy/production/nginx/templates/default.conf.template`
- `deploy/production/.env.production.example`
- `deploy/production/.env.public-api.example`
- `render.yaml`

必须验证：

- WSS upgrade 和长连接 timeout。
- 两个 API 实例之间的房间事件可见性。
- 重连后不依赖原实例内存。
- Socket.IO 多节点方案的 session affinity 或无需 sticky 的传输配置。
- Redis 故障时，HTTP 命令和快照恢复的降级行为。

建议先用 WebSocket-only transport + 现有 HTTP polling fallback，避免同时维护 Engine.IO long-polling session affinity。若允许 Socket.IO 的 long-polling 升级 fallback，多节点要配置 sticky sessions；Redis adapter 不能代替 sticky。与现有 gameplay HTTP polling fallback 不同，不能混为一谈。

经典 `@socket.io/redis-adapter` 基于 Pub/Sub，不支持 Socket.IO 内置 connection-state recovery；`redis-streams-adapter` 支持该功能，但也不等于持久业务恢复/权限豁免。[S2/S4] 恢复失败仍需应用完整快照，不能通过 `skipMiddlewares=true` 跳过最新封禁校验。选择与 Nest 10/客户端锁定 Socket.IO 版本兼容的服务端依赖，单独评审后再改依赖，不在本轮升级。

使用 Socket.IO long-polling 时 sticky sessions 是独立要求；只用 WebSocket transport 可以避免这一要求，但失去 Engine.IO polling fallback，需保留游戏 HTTP 降级。[S5] Redis adapter 的广播功能不能代替这项选择。

### 5.4 保留但不迁移的旧路径

- `src/server/websocket.py`
- `src/server/app.py`
- `LegacyMultiplayerRoomPage` 所在的 `web/src/pages/MultiplayerRoomPage.tsx` 分支
- 非正式模式的旧 `/api/battle/*` Socket.IO 流程

这些文件可作为原型参考或兼容路径暂时保留，但不应继续扩展为正式线上实时协议。正式协议必须只有一套认证、房间状态来源和结算来源。

## 6. 实施顺序

### Phase 0：边界冻结和 H06 隔离

目标：

- 继续保持候选 `afa8a00` 可复现。
- H06 单独寻找 Docker runner，分别验证两套生产 Compose。
- 不在 H06 过程中顺手改实时协议。
- 取得真实 runner 后先核查 gate 脚本边界：当前第一套失败会停止第二套；prod 没有启动 TLS gateway；public overlay/HTTP CORS 示例需与生产 `validateEnvironment` 的 HTTPS 限制一致。这里只是待验配置风险，不是 Docker 已失败的结论。

验收：

- H06 两套 Compose 的 build/start/migration/readiness/worker/content 有真实日志。
- H06 仍以独立 Gate 记录，不因计划文档或静态路径检查变成 PASS。

依赖顺序：Phase 0/H06 为发布轨，Phase 1 可在隔离本地并行开发；Phase 2 依赖 Phase 1 恢复契约，Phase 3 依赖稳定事件投递，公网/白名单部署前必须合并通过 H06 和对应 WSS Gate。

### Phase 1：房间事件和正式 Gateway

目标：

- 两个客户端通过正式 Nest Socket.IO 订阅同一房间。
- HTTP 命令提交后，所有订阅者在一次事件中收到同一版本状态。
- 断线后可用 `lastVersion` 恢复，不需要清空本地状态。

边界：

- 不改变创建、邀请、选角、准备、开战、结算的业务约束/锁序/发奖语义；版本和 outbox 写入加入同一现有事务，不能在另一事务后补造成状态与日志不一致。
- 不删除 polling，先把 polling 降级为 fallback。
- 不触碰 Python Worker。

验收：

- 两个独立浏览器通过 Nest Gateway 完成房间创建、邀请、3+2 选角、准备和开战。
- room event 的 version 严格单调；重复事件不造成重复 UI 状态。
- 关闭一个连接后，房间状态仍正确写入 PostgreSQL；重连携带 lastVersion 能恢复。
- Gateway 鉴权拒绝无 token、过期 token、inactive account、非成员订阅。
- Redis 不可用时，单实例 HTTP + snapshot fallback 仍可完成核心流程。
- 模拟 commit 后 emit 前崩溃、丢最后一条通知、乱序/重复、snapshot 与新 ready 并发、多标签页关闭一页、登录中封禁/过期/换号，均能恢复或正确拒绝，不能仅测 happy path。
- 原两局/十局和 SQL 对账在新候选重新执行；无 Worker/奖励变更，旧 HTTP 客户端通过 feature flag 回退仍可游玩。

### Phase 2：战斗事件同步

目标：

- 以 WebSocket 推送已有服务端预计算 events 和周期性 snapshots。
- 同一 battle seed 的两个客户端看到相同事件顺序、相同时间线和相同最终结果。

验收：

- 事件带 `battleSeed + sequence + battleTime`。
- 断线重连后从最后 sequence 补发，补不齐时收到 snapshot。
- 重复、乱序、延迟事件不会回退当前战斗状态。
- 结算仍只由 Nest 权威票据和现有事务完成。
- Python Worker 输出契约和角色/技能/奖励测试不变。
- 若补完整事件包装层，在冻结 fixtures/seed/content 下 final result/frame 与旧模式一致；对 truncation、buffer 上限、超时、错误输出及未来结果不泄漏增加测试。未补时标清仅推送事件子集。

### Phase 2B：可选 Worker 实时化（不是近期必需）

触发条件：产品需要战斗中可影响结果的操作，或实测开战计算/事务锁/进程启动成本成为瓶颈。否则继续预计算，Phase 3 可以直接接 Phase 2。

路线：

1. 先把计算挪出长事务：短事务冻结输入/jobId/content hash；持久有限任务队列执行原 `simulate()`；短事务 CAS/锁重验并原子发布全成员票据。租约、超时、幂等、取消和崩溃补偿未验收前不启用异步 starting。
2. 若确需真实时间推进，新建 Worker runner/IPC 包装，不改 `src/combat/*` 规则；复用固定 `.25` 步长和原引擎 update，wall-clock pacing 在包装层实现，不改变仿真步长语义。
3. Python 使用 NDJSON 或同等有界 framing 发 `started/progress/events/checkpoint/completed/failed`，stderr 仅日志；Nest 使用 streaming spawn/读行解析，而不是 `execFile` 全 stdout JSON。每战斗 actor 单写者，命令带序号；worker 永远没有 DB/认证秘密，不直接领奖。
4. 明确 checkpointer 的 RNG、cooldown、Buff、召唤/怪物阶段与 roster 序列化；目前没有完整可恢复 checkpoint，不能承诺 kill 后就能续算。第一版可从冻结 seed/input 重算到进度，验证 hash 后接续，或明确受控取消/补偿。
5. 只有最终 verified complete 写入票据/结果后才允许原 settlement；部分事件、socket 断开和 Worker 退出不能视为胜利或发奖。

验收：同 fixtures/seed final result 不退化，Worker 超时/kill/重复 job/lease 过期无双发布/双奖励；重启恢复可对账；数据库锁等待和排队有实测预算。操作型战斗另需 input validation、tick/input 窗口和反作弊设计，不能通过增加 NDJSON 自动获得。

### Phase 3：Redis 和多实例

目标：

- 两个 Nest 实例接入同一 PostgreSQL/Redis。
- 客户端连接到不同实例时，房间事件仍能广播和恢复。
- 原实例重启后，客户端可从 PostgreSQL snapshot/event log 恢复。

推荐：

- PostgreSQL event log 作为可审计事实来源。
- Redis Streams 或具备恢复能力的 Socket.IO adapter 作为跨实例实时传输。
- Redis Pub/Sub 仅作为非关键唤醒信号时才可使用；不能承担离线补发责任。

验收：

- 两实例、反向代理、WSS、重连、跨实例房间更新全部通过。
- Redis 短暂不可用后，HTTP 命令不产生双发，event version 不跳回。
- event log、snapshot、operation request 和 settlement 的一致性可通过 SQL 对账。

### Phase 4：负载、观测和 Alpha/Beta

目标：

- 建立多人实时容量基线，而不是直接宣称可支撑公网规模。

最小指标：

- 活跃 Socket 连接数。
- 每房间事件发布延迟、客户端确认延迟。
- resync 次数、断线率、重连成功率。
- WebSocket 连接错误、认证失败、房间订阅拒绝。
- Worker 排队数、运行数、超时数。
- PostgreSQL 锁等待、连接池使用率、事件表增长。
- Redis Streams lag 或 adapter publish error。
- 同一 roomId/battleSeed/requestId/eventId 的结构化 trace；不记录 token/密码。指标标签避免每个玩家/房间高基数，详细身份放受控日志。

初始验收目标：

- 先以 20 个并发房间、100 个 Socket 连接作为 Alpha 基线。
- 本地/隔离环境事件 p95 延迟目标先定为小于 500ms，断线恢复成功率目标为 100%。
- 目标值需要在实际 Runner 和部署规格上重新校准，不能当作当前性能结果。

压测方法：依赖当前 Socket.IO 协议的真实客户端 harness（可后续评审 Artillery Socket.IO engine），不能把 raw WebSocket/HTTP RPS 当 Socket.IO 游戏测试。分 idle、房间 ready burst、10 局开战/结算、混合 workload，记录 warm-up 和持续至少 30 分钟；注入 200ms RTT、丢连接、Redis 中断、进程重启和重连风暴。100 连接在 20 房间的平均值只作为连接压力，20 角色 TEAM 是角色数而非 20 玩家；具体 membership 依现有 4-player TEAM 规则配 fixtures。事件延迟从 commit 到客户端应用计量，两机时钟或 RTT 校准；冷/暖 Worker、CPU/内存、p95/p99、queue/锁等待、重复发奖为零分别报，性能不代替 correctness。

## 7. 数据一致性和恢复规则

### 房间

- PostgreSQL 房间行是权威状态。
- `state_version` 每个成功状态变更只增加一次。
- `multiplayer_room_events` 与房间状态在同一事务提交。
- 事件发布失败不能回滚已提交游戏命令；发布器必须从 outbox/event log 重试。
- 客户端只接受成员授权范围内的房间事件。

### 战斗

- `battleSeed` 是战斗身份。
- `serverTime` 是战斗时钟起点。
- `sequence` 是展示事件顺序，不是奖励凭证。
- `serverBattle` / snapshot 是展示恢复数据。
- 结算仍由 `BattleSettlementService` 读取服务端票据，并用现有幂等 key 防重复。
- 客户端不能提交伤害、奖励、成功状态或属性结果作为权威输入。

事件 ACK/游标与命令幂等分离。现有 `battleSeed` 继续拥有一次发奖权，不能改成新 socket packet ID。新增会重试的 command 才配稳定 `commandId/requestHash/expectedVersion`，复用 operation request 模式；首个切片不迁移命令 transport，不新建第二套结算锁。current/null、ticket 约一小时过期、成员待结算不结束的既有策略必须明确展示/恢复，不通过无限重连延长合法领奖窗口；离线超窗补偿属于需另行裁定的产品规则。

### 断线

```text
connected
  -> authenticated
  -> subscribed
  -> disconnected
  -> reconnecting
  -> resumed_by_events
  -> resumed_by_snapshot
  -> expired / left
```

现有 HTTP heartbeat 和 presence sweep 在 Phase 1 保留，直到 WebSocket presence、浏览器后台节流和多实例重连有真实证据。不能只因为 TCP 连接断开就立即删除房间成员。

连接级 identity/lease 与玩家级 presence 分开：同账号两标签/两设备仍有一条有效连接时，不因另一个 socket disconnect 标成 offline；重连先建立新 epoch/session lease，再处理旧 disconnect，防止迟到回调踢新连接。继承当前 15 秒检测 + 30 秒宽限期作为初始配置，明确离房 HTTP、封禁、后台和网关重启不同语义；倒计时下发 server deadline，本地展示不依赖每秒广播。

当前每 API 实例 5 秒 sweep 最多 100 房间，没有分页公平/全局 owner 的覆盖证据。多实例阶段改成可抢占的 presence lease/sweep owner、分页扫描和 lag 指标；DB 批量写状态转换，不按每个 socket ping 发 PostgreSQL 事务。Redis presence 只能缓存，终态/成员资格仍在 PG。

事件保留：建议 Alpha 热窗口不少于一次完整战斗与重连窗口（初始可 24 小时，需容量确认），冷归档和限量清理带指标。恢复游标过旧/事件被截断返回完整 snapshot 和 retainedFromVersion；不能为满足补发无限保留内存/Redis 队列。记录所有 envelope 的 protocolVersion/payload schema，旧客户端不识别事件可 resync，重大不兼容明确拒绝并回退；rolling deploy 先新增兼容字段再启用发新事件。

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Formal Nest 与旧 Flask Socket.IO 并存 | 客户端连错服务或协议不一致 | 正式页面只使用新 Gateway；旧路径标注 legacy，不新增功能 |
| Socket 事件默认可能丢失 | 断线后房间/战斗状态缺口 | PostgreSQL event log + sequence + snapshot recovery |
| Redis Pub/Sub 丢消息 | 多实例状态不同 | Pub/Sub 只做唤醒；用 Streams 或数据库事件日志恢复 |
| 事件先发后提交 | 客户端看到不存在的状态 | 事务提交后 outbox publisher 才广播 |
| 事件重复或乱序 | UI 回退、重复结算误解 | client reducer 按 version/sequence 去重，服务端命令继续幂等 |
| Worker 当前最多两个并发 | 实时化后排队和超时 | 第一版不提高并发承诺；先做队列/指标/限流，后续再拆 worker |
| 事件 payload 过大 | 内存、网络和 Redis 压力 | 事件只传增量；固定间隔传 compact snapshot；限制大小 |
| 页面后台节流 | heartbeat 和重连判断延迟 | Socket ping/pong + 服务端 lease；HTTP heartbeat 作为 fallback |
| 多实例连接粘性问题 | 握手或重连失败 | long-polling 需 sticky；WebSocket-only 则验证重连换节点恢复，adapter 不自动替代 session affinity |
| 选角不足偶发问题 | 房间开战偶发失败 | 先保持当前服务端门槛；实时改造增加 selectedIds、version、请求时序日志，不绕过门槛 |
| H06 未验证 | 无法证明生产部署 | 单独 Docker Gate，不能用实时计划替代 |
| 八属性视觉回归 | 实时事件 UI 丢失属性语义 | 战斗事件继续携带 `attributeType`；复用 `ElementTheme`，名称和图形与颜色同时展示 |

## 9. 回滚方案

### 功能回滚

增加独立开关，例如：

```text
REALTIME_ROOMS_ENABLED=false
REALTIME_BATTLE_EVENTS_ENABLED=false
```

关闭后：

- 正式房间回到现有 HTTP polling + heartbeat。
- 正式战斗回到现有 2 秒 HTTP 状态读取。
- HTTP 创建、准备、开战、结算逻辑不回滚、不替换。
- 旧 Flask Socket.IO 不作为正式回滚路径。

上述 flags 尚不存在，客户端 flag 和服务端 flag 需有兼容 rollout 顺序。回退 HTTP polling 仍要走新的版本化 snapshot reducer，不能把迟到 HTTP 响应重新覆盖 socket 新状态；本地选角 draft 与已提交成员选择分离，只有当前会话/房间/请求 generation 匹配才回写，原选角问题保持未完全定位，不能称迁移已修好。

### 数据回滚

- 新增 event table 和 `state_version` migration 采用向前兼容方式。
- 关闭实时功能时保留事件表，不删除已有数据。
- 只在确认没有依赖后再做数据归档；不要把 migration down 当作线上回滚主方案。
- 如果事件发布器故障，使用 HTTP snapshot 和 event log 重放；不直接修改房间/结算数据来“修复显示”。

### 部署回滚

```text
新版本 Gateway/客户端
  -> feature flag off
  -> 保留 HTTP API
  -> 观察数据库和 settlement
  -> 必要时回退应用镜像
  -> 保留兼容 migration
```

回滚验收必须证明：

- 旧客户端仍能完成现有 3+2 两局流程。
- 房间不会因没有 socket 订阅而被错误删除。
- 结算和奖励不会重复。
- event publisher 停止后不会阻塞 HTTP 事务。

## 10. Alpha -> Beta -> Release 路线

### Alpha：实时房间可恢复

开放范围：

- 隔离或白名单账号。
- 2-4 人房间。
- 房间状态实时推送。
- 服务端预计算自动战斗的事件展示。

必须关闭：

- H06 两套 Compose 真实验收。
- Gateway 鉴权、状态版本、断线恢复。
- 3+2 两局和十局回归在实时协议下通过。

不开放：

- 公网大规模房间。
- 真实经济扩大。
- 实时操作型战斗。

当前仍只支持隔离合成账号内部测试。受控白名单也需服务端限制未验收直接助战/公会贡献/多人 Boss 经济路径，隐藏 UI 不足以隔离。不得因本计划标注 Alpha 就提前开放这些接口或沿用历史未验证安全结论。

### Beta：多实例和容量基线

必须完成：

- 两实例 + Redis + PostgreSQL event recovery。
- WSS、反向代理、连接恢复。
- 20 房间/100 Socket 初始容量基线。
- 负载、锁等待、Worker 排队和 Redis lag 观测。
- 四账号/二十角色、异常断线、恢复、重复命令回归。

### Release：公网服务

必须完成：

- Docker/Compose、网关、TLS、备份恢复和回滚演练。
- 真实部署规格上的 SLO 和容量报告。
- 事件协议兼容策略和客户端版本淘汰策略。
- 安全审计：Socket 鉴权、房间授权、事件注入、重放、限流。
- 真实多实例数据库对账。

## 11. 当前最应该做的一个任务

**任务：实现正式 Nest 线上多人房间的 WebSocket Vertical Slice：鉴权 Gateway + 房间订阅 + PostgreSQL `state_version`/事件日志 + snapshot recovery；HTTP 命令和现有战斗/结算保持不变。**

涉及文件：

1. 新增 `server-nest/src/multiplayer-rooms/multiplayer-rooms.gateway.ts`。
2. 新增 `server-nest/src/realtime/realtime-auth.service.ts`、`room-event.service.ts`。
3. 新增房间事件 Entity 和 migration，修改 `multiplayer-room.entity.ts`。
4. 修改 `multiplayer-rooms.service.ts`，将房间事务接入版本和事件记录。
5. 修改 `app.module.ts`、entity/migration/schema/恢复检查注册，补 context-aware 鉴权；单实例阶段 Redis 封装可不改。
6. 新增 `web/src/services/realtimeSocket.ts`、`roomStateReducer.ts`。
7. 只修改 `FormalOnlineMultiplayerPage` 对接 socket；保留 polling fallback。
8. 新增 Gateway、事件恢复和两浏览器回归脚本。

为什么先做它：

- 它直接解决当前实时差距最大的部分：房间状态延迟、轮询压力和断线后无法按版本恢复。
- 它不改变已验证的角色养成、Python 战斗规则、服务端权威战斗、奖励和结算事务。
- 它能验证最关键的实时基础设施：鉴权、房间授权、事件顺序、状态版本、重连恢复和旧 HTTP 兼容。
- 没有这层协议，直接把战斗 Worker 改成长连接进程会把网络、状态、计算和奖励问题混在一起，难以回滚。
- 它为后续战斗事件同步、多实例 Redis、WSS 和扩容提供稳定契约。

完成标准：

- 两个真实独立浏览器连接到正式 Nest Gateway，而不是旧 Flask Socket.IO。
- HTTP 创建/邀请/选角/准备/开战命令提交后，房间订阅者收到同一 `roomId + version` 状态。
- 无 token、inactive account、非成员订阅被拒绝。
- 事件版本单调、重复事件幂等、乱序事件不会回退 UI。
- 断开后携带 `lastVersion` 重连；事件可补发时增量恢复，不能补发时完整 snapshot 恢复。
- Socket 不可用时 HTTP polling fallback 仍能完成已有两局流程。
- 现有结算、奖励、battle seed、角色归属和数据库对账结果不改变。
- 新增实时回归至少覆盖：双账号 3+2、准备、开战、断线、重连、刷新、重复命令、非成员订阅、Redis 不可用降级。
- H06 仍单独记录为未验证，不能将本任务完成等同于 Docker 或公网发布完成。

## 12. 明确不做

- 不重写 `scripts/nest_battle_worker.py` 的战斗规则。
- 不把客户端伤害、技能或奖励输入改成权威。
- 不把现有结算改成 socket 事件直接发奖。
- 不一次性删除 HTTP API 或 polling fallback。
- 不把旧 `src/server/websocket.py` 直接接到正式 Nest 数据库。
- 不开发新角色、支付、自动匹配、聊天、音频或大型活动。
- 不修改八属性配色规范。实时事件中的属性仍必须同时保留属性名称、独立图形标识和 `ElementTheme` 配色。
- 不把 H06 Docker 未验证标为通过。

## 13. 八属性视觉约束

实时迁移只传属性语义，服务端不传 CSS 色值或让客户端重新计算属性规则。

| 属性 | Canonical ID | 核心色 |
|---|---|---|
| 火 | FIRE | 红 |
| 水 | WATER | 蓝 |
| 土 | EARTH | 棕 |
| 木 | WOOD | 绿 |
| 雷 | THUNDER | 紫 |
| 风 | WIND | 青 |
| 光 | LIGHT | 黄 |
| 暗 | DARK | 黑 |

复用 `web/src/services/elementTheme.ts` 和 `web/src/components/ElementBadge.tsx/.css` 的 Primary/Secondary/Highlight/Background/Dark/Text/OnPrimary，继续兼容 LIGHTNING/HOLY/SHADOW aliases。实时单位/技能/Buff 展示携带合法 `attributeType`，同时展示名称/图形；黄色与黑色使用对应对比文字，不把所有背景改成纯色。

每个阶段重新检查 desktop/mobile 的事件/角色/技能标签、去重后 DOM 与对比度，沿用 theme/browser contract 测试，不将 Mock 视觉测试记作真实多人 E2E。当前未完成的全伤害/Buff色彩/对比度覆盖继续记录，不以传输迁移掩盖视觉缺口。

## 14. 扫描依据与官方资料

本轮实际检查：Git status/branch/log、tracked diff、配置/源码静态定位、现有 2026-10-08 JSON 证据、官方文档内容。没有重新运行构建、Python、多人回归、Docker 或压测，不能在下一轮实现完成后沿用本计划当作验收结果。实际结果必须绑定新的不可变候选、环境、命令、时间和产物。

源码定位（当前扫描版本，后续提交行号可能变化）：

| 结论 | 现有定位 |
|---|---|
| 正式与原型分支明确分离 | `web/src/pages/MultiplayerRoomPage.tsx:888`、`:1269`；旧分支 `:119` |
| 房间 2.5s/5s polling/heartbeat | `web/src/pages/MultiplayerRoomPage.tsx:1128` |
| 正式战斗提前分支退出到 HTTP | `web/src/pages/BattlePage.tsx:575`、`:610`、`:669` |
| 旧 Flask socket 不是正式 Nest 权限 | `src/server/websocket.py:38`、`:114`、`:141` |
| state/presence/原子启动 | `server-nest/src/multiplayer-rooms/multiplayer-rooms.service.ts:178`、`:295`、`:329` |
| 权威预计算与时间裁剪 | `server-nest/src/dungeons/dungeons.service.ts:182`、`:199` |
| 结算依据 ticket/time 而非展示事件 | `server-nest/src/battle-settlement/battle-settlement.service.ts:70` |
| Worker 资源限制 | `server-nest/src/battle-settlement/battle-simulation.service.ts:24` |
| 部分事件/512 截断/固定步长 | `scripts/nest_battle_worker.py:67`、`:86`、`:92`、`:114` |
| 现有 HTTP-only guard 与 active check | `server-nest/src/auth/active-account.guard.ts:10`、`auth/auth.service.ts:134` |
| Redis 当前仅连接/health | `server-nest/src/common/redis.service.ts:1` |
| 正式代理/开发原型代理不同 | `deploy/production/Caddyfile:11`、`web/vite.config.ts:11` |
| 原验收而非本轮重跑 | `PROJECT_STATUS.md` 当前章节；项目旁 `release-evidence/afa8a00/core/core-regression.json` |

以下官方资料于 2026-10-09 在线核对，用于技术事实而非已实现证明。URLs 仅列参考，计划不固定最新版本、不自动升级依赖。

| 引用 | 官方资料 | 地址 |
|---|---|---|
| S1 | Socket.IO Delivery Guarantees：ordering / at-most-once / application persistence | `https://socket.io/docs/v4/delivery-guarantees/` |
| S2 | Connection State Recovery：失败可能性和 adapter 支持矩阵 | `https://socket.io/docs/v4/connection-state-recovery/` |
| S3 | Redis Pub/Sub：delivery semantics | `https://redis.io/docs/latest/develop/pubsub/` |
| S4 | Socket.IO Redis Streams Adapter | `https://socket.io/docs/v4/redis-streams-adapter/` |
| S5 | Socket.IO Multiple Nodes；Redis adapter | `https://socket.io/docs/v4/using-multiple-nodes/`；`https://socket.io/docs/v4/redis-adapter/` |
| S6 | NestJS Gateways（对应 docs 官方源码已核对） | `https://docs.nestjs.com/websockets/gateways`；`https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/websockets/gateways.md` |
| S7 | NestJS WebSocket Guards（对应 docs 官方源码已核对） | `https://docs.nestjs.com/websockets/guards`；`https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/websockets/guards.md` |
| S8 | PostgreSQL SELECT / SKIP LOCKED 的用途与边界 | `https://www.postgresql.org/docs/current/sql-select.html` |
