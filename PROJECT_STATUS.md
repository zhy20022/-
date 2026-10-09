# Project Status

## 当前门禁：候选冻结与 Docker / WSS 验收（2026-10-09）

**Candidate：`137e9c9da330150127144de1dc6c1d690527056c`；Branch：`main`；Schema：`MultiplayerRoomEvents1788514000000`。** 冻结范围包含实时实现 `72d2ab2`、文档 `594f48d` 和 Docker 验收脚本的最小修正。没有 amend、push 或部署公网；验收结果另作后续 docs-only commit，不取代这个不可变候选。

### 固定 Commit 实际重新验证

干净检出：`C:\Users\12107\AppData\Local\Temp\gamer-rc-realtime-137e9c9`，detached HEAD 与候选完全一致。两端 `npm ci --registry=https://registry.npmjs.org` 退出0；最终Git status干净，两端lock的JSON与commit一致。无原工作树未跟踪文件依赖。

证据归档：**`C:\Users\12107\Desktop\4\release-evidence\137e9c9\candidate-manifest.json`**，记录候选hash、七个迁移、Compose/代理/Dockerfile/测试清单、源码hash、排除文件、环境预检、实际命令/时间/退出码及分层结果。同目录保留每项执行日志和backend/web/python JSON。

| 本轮 Gate | 结果与实测边界 |
|---|---|
| 独立源码/本地构建 | **PASS**：干净clone、npm ci、前后端build/typecheck、Nest lint；不是Docker复现 |
| Python / Worker | **PASS**：221tests/486subtests（8warnings）、真实Python子进程四类型与唯一5/20角色；`python.xml`、`backend-worker.log` |
| 前端单测 | reducer、Mock transport、theme、battle replay均PASS；Mock不冒充真实集成 |
| Room鉴权/序列/恢复 | **PASS（本地直连WS）**：真实PG/双Nest、权限/并发/事务失败/重启补发/缺口快照/成员离开/封禁/过期断连；`backend/room-realtime/result.json` |
| Legacy migration / H03-H05 | **PASS（本地PG18.1）**：七迁移、重复启动、安全、真实备份/恢复/恢复后业务；`backend/gamer-p0-delivery/result.json`明确candidate及clean tracked commit |
| 双账号3+2实时两局 | **PASS（本地直连WS）**：独立1280/390浏览器、准备推送、离线重连、同战斗/正确归属、4条独立结算/逐局SQL；`browser-realtime/gamer-multiplayer-delivery/result.json` |
| socket拒绝后HTTP回退两局 | **PASS**：实际socket尝试拒绝、两局4条结算/逐局SQL；`browser-fallback/gamer-multiplayer-delivery/result.json` |
| Docker Runner | **BLOCKED**：固定候选干净checkout实际运行Gate脚本，`spawnSync docker ENOENT`；`docker-preflight/result.json`、`1-docker.log` |
| 两套Compose / WSS代理恢复 | **NOT VERIFIED**：没有镜像/容器/代理TLS证据，本地WS不能代替 |

本轮没有改变房间状态机/恢复/结算，按要求重新执行最低两局；上一轮十局不归为本轮固定commit十局。本轮选角不足没有复现，根因仍 **UNRESOLVED**。Capacity **NOT VERIFIED**。现有身份校验覆盖签名/过期/封禁，但无独立单token撤销登记。

本轮实际修改：`server-nest/scripts/verify-docker-candidate.mjs`及三份状态文档。上一轮27个实时交付文件已纳入实现提交并在manifest列出。Dockerfile/Compose/代理配置沿用已跟踪版本，未修改业务/依赖/lock；十份无关用户报告均未纳入、未删除。候选后的结果提交仅更新这三份文档。

实际命令包括Git状态/分支/log/diff/staged检查、显式add/commit、独立clone/detached checkout；两端npm ci/build/typecheck及Nest lint；pytest；Node Worker、Room realtime、legacy、P0恢复、双浏览器两种模式，以及web reducer/Mock transport/theme/replay；固定候选`node scripts/verify-docker-candidate.mjs`。精确命令与退出码见证据JSON。Gate脚本exit1是环境缺失，不标项目业务FAIL。

尚未完成：两套镜像构建/运行、容器Worker/content/migration、Redis readiness、PG16、TLS/WSS握手/代理空闲/心跳/关闭/成员安全、代理环境异常恢复（包括断线期间房间结束）、容器双浏览器/对账及容量压测。npm ci审计仍报告Nest35项、web18项，未风险分级/自动修复。**Release Decision：CONDITIONAL ALPHA，只允许隔离本地合成账号内部测试；不许可公网或生产。**

实际环境检查：Docker CLI/Compose 不存在；标准 Docker/Podman 安装位置与服务未发现；没有 `DOCKER_HOST`/`DOCKER_CONTEXT`，WSL status 未能提供可用 Linux。三个现有 Actions 分别为 Pages、生产后置验收、生产备份，不是获授权的隔离双 Compose Runner；没有调用它们、push 或连接生产。

- Compose #1 实际为 `deploy/production/docker-compose.prod.yml`（Nest/PostgreSQL16/Redis7/Nginx）。Build/Start/Migration/Readiness/Worker/Content：**NOT VERIFIED，Runner BLOCKED**。
- Compose #2 实际为 `deploy/production/docker-compose.public-api.yml`（Nest/PostgreSQL16/Redis7/Caddy）。上述六项：**NOT VERIFIED，Runner BLOCKED**。
- `docker-compose.playable.yml` 是旧 Python 栈，不是本次正式 Nest Gate 目标。
- WSS 反代、TLS/空闲超时/代理心跳、代理环境双浏览器断线恢复：**NOT VERIFIED**。Nest 直连 WS 不等于 WSS/代理验收。
- 仓库 Nginx 默认模板仅 HTTP，TLS 示例需要显式配置；Caddy 配置包含 `/api/*` 和 `/socket.io/*`。本轮不声称这些静态配置已经启动。
- 验收脚本最小修正：两套预建独立状态；任一套失败后继续另一套；测试 Origin 改 HTTPS；显式检查事件 migration；清理故障单独记录。脚本仍只验容器 API/Worker，**不覆盖完整 WSS/双浏览器 Gate**。
- 既有 Nest lock/package 变更来自上一轮实时实现，本轮未升级依赖、未修改 lockfile。十份无关用户报告不纳入候选。

受控 Alpha 当前判断：**CONDITIONAL ALPHA，仅隔离本地/合成账号内部测试；没有公网或生产验收许可**。缺 Runner 是环境阻塞，不伪记代码 FAIL。下一步是提供获授权隔离 Docker Runner 并补齐双 Compose + WSS/恢复实际证据。

以下实时房间第一阶段及历史审计章节是前置结果，不代替本轮固定 Commit 的重新验证。

## 当前状态：可恢复实时房间第一阶段

更新：2026-10-09，Asia/Singapore。阶段：**Alpha / Recoverable Room Implemented / Local Verification**。

本节取代下面的历史候选状态；本次实时实现已冻结在 `main` 的实现候选提交 `72d2ab2`，未 push 或 amend。后续文档记录提交只更新验收元数据，不修改该实现提交。`afa8a00` 仍是历史冻结候选，不包含本次实时实现。

### 实际实现

- Nest `multiplayer-rooms.gateway.ts`：Socket.IO `/rooms` namespace、`/socket.io/` transport；握手复用 `AuthService.verifyActiveAuthorization`，校验签名/过期/账号状态/归属，限制 Origin、消息大小、连接及恢复请求数。订阅和持续发送前重新校验身份和房间成员资格；身份失效或退出成员后断连并清理订阅。
- `room-events.service.ts`、事件实体及 `1788514000000-MultiplayerRoomEvents.ts`：房间 `stateVersion` BIGINT、事件 UUID、唯一 `(roomId, version)`。版本在线路上为十进制字符串；房间写锁下，同一事务保存业务变更、递增版本和完整房间快照事件。回滚不留下事件。
- 实际事件：`room.created`、`member.joined`、`member.updated`、`member.presence`、`member.left`、`room.presence`、`battle.started`、`battle.finished`。无可见变化的心跳/重复提交不新增事件；没有新增重开状态规则，第二局仍创建新房间。事件不包含奖励发放命令或私人结算载荷。
- Gateway 每 500ms 为本实例的订阅连接查询已提交记录，不依赖进程计数器、即时广播或 Redis Pub/Sub。数据库中提交但未发送的记录可在下次查询或重连时恢复；两个真实 Nest 进程共享 PostgreSQL 的顺序与通知已测试。这是低频房间第一阶段方案，**不代表大规模扩容已验证**。
- `room.subscribe { roomId, version? }` ACK 返回 `events` 或 `snapshot`；`room.event` 为 `{ roomId, eventId, version, eventType, payload, createdAt }`；`room.sync` 返回快照，`room.revoked` 后断连。恢复使用成员校验和房间读锁，缺失历史、超过 100 条或没有 cursor 则完整快照；无效/未来 cursor 明确拒绝。HTTP `GET /api/multiplayer-rooms/:roomId/sync?version=...` 复用同一恢复逻辑。
- 默认事件保留 24 小时，每分钟清理，可用 `ROOM_EVENT_RETENTION_HOURS` 调整（最少一小时）。恢复只读取数据，不重新开战、结算或发奖。
- 前端 `realtimeSocket.ts`、`roomRealtimeState.ts`、`MultiplayerRoomPage.tsx`：正式 API origin 连接、版本去重/乱序保护/缺口恢复、恢复期间缓存 live 事件、重连、监听器和 ACK 清理、账号/房间隔离、本地选角草稿保护。现有 HTTP 命令、2.5 秒轮询及 5 秒 heartbeat 保留，不切到旧 Flask。
- 回滚开关：服务端 `ROOM_REALTIME_ENABLED=false`，前端 runtime `roomRealtime:false` 或 `VITE_ROOM_REALTIME=false`。优先关闭传输并保留新增数据库结构，不带玩家数据执行 down migration。
- Schema：**`MultiplayerRoomEvents1788514000000`**，共七个迁移；实体注册、schema 标识、legacy migration 测试及备份恢复检查同步更新。
- 明确依赖变更：新增 `@nestjs/websockets@10.4.22`、`@nestjs/platform-socket.io@10.4.22`，含 Socket.IO 4.8.1 传递依赖，更新 Nest package/lock。比对原 lock，已有依赖版本没有升级；web 无依赖变更。安装使用官方 registry，旧 taobao registry 证书已过期。npm 报告 35 个审计问题，未运行自动修复，不能据此声称依赖安全门禁通过。
- Python 战斗规则、奖励计算、结算语义和八属性主题均未改动。

### 实际验证和证据

环境：Windows、本地 PostgreSQL 18.1 `127.0.0.1:55439`、隔离 `gamer_rewards_e2e_*` 数据库、两个 Nest 进程、Chrome headless/Playwright 独立浏览器上下文（1280 与 390 宽）。Redis 不可用，测试未将其替代为真实生产 readiness。

证据根目录：`C:\Users\12107\Desktop\4\release-evidence\realtime-20261009`。

| 本次执行 | 结果及范围 |
|---|---|
| Nest build / typecheck / lint；web build / `tsc --noEmit` | PASS；前端既有 chunk-size/CJS 警告保留 |
| `python -B -m pytest tests -q -p no:cacheprovider --junitxml=...` | **221 tests、486 subtests PASS**，5 个警告；`python.xml` |
| `python -m unittest discover -s tests -v` | 192 tests PASS，不拿它替代 pytest 全量 |
| `test-battle-worker.mjs` | 真实 Python 子进程、四种副本、唯一 5/20 角色及 authored healer PASS |
| `web/scripts/test-room-realtime.mjs` | reducer 重复/过期/乱序/缺口/快照/BIGINT/房间隔离 PASS |
| `web/scripts/test-room-transport.mjs` | **Mock transport 单测**：恢复/live ACK 竞态、重连、快照、HTTP fallback 回调、卸载、旧 ACK、切账号/房间及关闭开关 PASS；不冒充真实浏览器 |
| `e2e-room-realtime.mjs` | **真实 PostgreSQL + 双 Nest + Socket.IO**：未登录/伪造/过期/封禁/Origin 拒绝、成员权限、并发顺序、重复命令无事件、延迟约束提交失败完整回滚、进程重启补发、历史缺口快照、成员移除/在线封禁/过期断连 PASS；`room-realtime/result.json` |
| `test-legacy-migration.mjs` | 旧 schema adoption -> 七个迁移 -> 重复启动、pool-size-one PASS |
| `e2e-p0-delivery.mjs` | **H03/H04/H05 当前 schema 回归 PASS**：榜写安全、真实 Boss Worker 可信分数、双实例封禁、真实备份/恢复/重复迁移/恢复后登录和结算重放；`gamer-p0-delivery/result.json` |
| `e2e-multiplayer-delivery.mjs` 实时开启 | **真实双浏览器 3+2 连续十局 PASS**，20 条独立结算、逐局 SQL 对账。包含阻断 HTTP current 后 peer ready/unready 的 socket 推送及浏览器离线重连；`browser-enabled/gamer-multiplayer-delivery/result.json` |
| 同脚本前后端实时关闭 | **真实 HTTP-only 两局 PASS**，SQL 对账；`browser-http/gamer-multiplayer-delivery/result.json` |
| 同脚本仅服务端拒绝实时连接 | **真实 socket 尝试失败、HTTP 回退两局 PASS**，SQL 对账；`browser-rejected/gamer-multiplayer-delivery/result.json` |
| `test-element-theme.cjs` | 八主题/符号/名称/对比度 Contract PASS，视觉规范未改 |

十局运行期间及之后补强了请求/卸载隔离与已有房间读取锁；最终工作树另以 `final/room-realtime/result.json` 和 `browser-final/gamer-multiplayer-delivery/result.json` 的服务端及双浏览器两局重跑为准。十局证据不伪称来自新冻结 commit。

最终重跑均已结束且退出码为0：服务端鉴权/事务/恢复PASS，真实双浏览器3+2两局PASS（4条独立结算、逐局SQL对账、实时准备状态及重连证据）。最终 `git diff --check`、前后端构建、类型检查、Nest lint 和 reducer/Mock transport 单测通过。没有遗留测试服务进程；另留下用于试用的隔离本地预览（API4108、web3028），不属于Docker生产验收。

测试脚本首轮结束清理曾等待已退出的旧进程，已修正 `signalCode` 判断并真实重跑成功；不把被终止的首轮当作完整退出成功证据。

### 当前门禁与限制

- H01/H02：双浏览器实际核心闭环通过；H03/H04/H05：当前 schema 实际回归通过。
- **H06 两套生产 Compose：仍 NOT VERIFIED**。本次 `Get-Command docker` 无可用结果，没有执行 Docker build/start，未测试生产 Redis/TLS/WSS/反代/PostgreSQL 16。不能以本地 socket 或构建结果代替部署验收。
- 已完成：可恢复实时房间；未完成：实时战斗事件流、Python 流式 Worker、实时操作型战斗、四账号/20 角色在线闭环、压测/延迟指标/生产多实例扩容。
- 当前鉴权体系没有独立 session/token 撤销登记；WebSocket 与 HTTP 保持一致。封禁、签名失效、过期均校验，不能宣称实现了原系统不存在的单令牌撤销能力。
- 历史选角不足根因仍未完全定位。本次增加草稿和迟到请求保护且回归通过，不等于证明旧问题已修复。
- DB tail 每连接重复鉴权及快照查询，500ms 是调度间隔而非延迟保证；数据库负载/长业务锁可能导致通知延迟，HTTP fallback 保留。连接数限制不是容量验收结论。
- 本次交付源文件、迁移、测试和规划文档已进入 `72d2ab2`；十份无关用户报告保持未跟踪且未纳入。候选可从该提交独立 checkout；Docker/WSS 仍未验证。

**发布仍受 H06 限制，只可隔离本地内部验证，不能宣布公网 Ready。下一步唯一首要任务：将本次实现冻结为新候选后，在隔离 Docker runner 验收双生产 Compose 和 WSS/重连/HTTP 回退。**

## 历史：Release Candidate Verification（2026-10-08）

验收日期：2026-10-08，Asia/Singapore。阶段：**Frozen Candidate / Docker Gate Pending**。

发布判断：**CONDITIONAL ALPHA**，仅开发者监督下、隔离本地、合成账号的内部测试。**不是 READY FOR CONTROLLED ALPHA，不许可公网或生产部署。** H06 缺少实际 Docker 证据，是环境未满足，不伪记项目 FAIL，也不以静态检查代替 PASS。

本节是 2026-10-08 历史候选记录；不能代替上方 2026-10-09 工作树实时实现与实际验证结果。

### Candidate Manifest

| 项目 | 本轮实际值 |
|---|---|
| Candidate Commit | `afa8a00f67aec246a63670e0856d3ca37202eec4` |
| Branch | `main` |
| 前置冻结提交 | `505dbee4a70632d9f1feb838c242d0d3baa230b4`，已由最终候选取代 |
| Schema Version | `MultiplayerRoomPresence1788513000000` |
| Production Compose Files | `deploy/production/docker-compose.prod.yml`；`deploy/production/docker-compose.public-api.yml` |
| Dockerfile | `server-nest/Dockerfile`；prod 网关为 `deploy/production/nginx/Dockerfile`；public-api 网关为 Caddy 镜像 |
| 独立检出目录 | `C:\Users\12107\AppData\Local\Temp\gamer-rc-final-20261008`，HEAD 与候选完全一致 |
| Tracked Changes | 候选已包含 H01-H05、多人十局脚本、备份恢复检查、双 Compose context 修复、八属性主题及对应测试；无关键未跟踪源文件 |
| Untracked Changes | 原工作树十份无关审计/平衡报告，保留原样且不纳入；独立检出没有这些文件 |
| 可复现边界 | **源码/本地构建 YES**：干净 Git clone、两端 `npm ci`、构建、核心测试通过；**完整 Docker 部署 NOT VERIFIED** |
| Git 操作 | 已创建两个 release commit，没有 push；验收结论另作 docs-only commit，不 amend 候选 |

六个 Migration Files 均已被 Git 跟踪：

```text
server-nest/src/database/migrations/1788502608304-InitialOnlineSchema.ts
server-nest/src/database/migrations/1788509000000-ConcurrentMutationSafety.ts
server-nest/src/database/migrations/1788510000000-OnlineLegacyFeatures.ts
server-nest/src/database/migrations/1788511000000-QuestRewardPeriods.ts
server-nest/src/database/migrations/1788512000000-MultiplayerRooms.ts
server-nest/src/database/migrations/1788513000000-MultiplayerRoomPresence.ts
```

候选测试文件包括 `verify-p0-final.mjs`、`e2e-p0-delivery.mjs`、`e2e-multiplayer-delivery.mjs`、`e2e-multiplayer-room-browser.mjs`、`test-legacy-migration.mjs`、`test-battle-worker.mjs`、`verify-docker-candidate.mjs`、Python `tests/` 和 web 的 theme/browser/replay/guide 测试。完整交付文件清单可由 `git diff --name-status d163ea6 afa8a00` 复核。

无关报告为 `buff_duration_final_audit.md`、`buff_duration_update_report.md`、`mechanic_rule_library_draft.md`、`mechanic_rule_library_final.md`、`mechanic_skill_simulation_report.md`、`skill_cycle_balance_after_chichi_qiyusi_adjust.md`、`skill_cycle_balance_final_check.md`、`skill_cycle_balance_simulation_report.md`、`skill_cycle_balance_simulation_report_v2.md`、`special_effect_audit.md`。没有删除或覆盖它们。

本轮未升级依赖或编辑 lockfile；候选包含上一阶段已经存在的 Playwright 测试依赖改动。独立 clone 的 Nest lock Git blob 为 `79a96116ba44a5fcd944b1f67fd7aadf71dbb313`，与候选一致；Windows checkout 的 CRLF/LF 可使文件 SHA256 不同，不代表依赖改动。

### 当前 Gate

| Gate | 本轮结果 | 实测边界 |
|---|---|---|
| A / H01-H02 | PASS：真实 3+2 两局及连续十局通过 | React + Nest + 独立 PostgreSQL + Python worker，20 条独立结算、十局 SQL 对账，不使用 Mock 替换业务 |
| B / H03 Ranking Security | PASS | 未鉴权/跨账号/动态 Boss 和固定权威榜拒绝；可信 worker Boss 结算一次写入真实榜 |
| B / H04 Ban Token | PASS | 封禁后旧 Token 读写/新登录被拒绝；解封恢复；同库两 API 实例一致 |
| C / H05 | PASS（本地） | 六迁移、旧 schema 升级、重复迁移、正式 HTTP 备份、真实恢复、恢复后启动和查询/重放 |
| D / H06 Compose #1 | NOT VERIFIED | 无 Docker runner；只有 YAML/context/COPY 输入静态检查通过 |
| D / H06 Compose #2 | NOT VERIFIED | 同上，没有执行任何镜像构建或容器启动 |
| E / Candidate | PASS（Git 完整性和本地复现） | 不可变提交、独立 clone、锁定依赖和构建；不能据此宣称 Docker 可复现 |
| F / Core Regression | PASS：构建、单项和 13 步完整回归 | 本轮 `core-regression.json` 为 verified=true，13 步退出码均为 0 |

### Docker 实际证据

本机执行 `docker version`、`docker compose version`，命令不存在；未找到 Docker Desktop/Podman、可用 WSL Linux、已配置远程 SSH runner、可用 GitHub CLI 凭证。已检查三个现有 Actions：`database-backup.yml`、`deploy-github-pages.yml`、`online-post-deploy.yml`；没有针对本候选的隔离双 Compose runner。不能以生产备份任务或公网业务写入任务代替隔离验收，也没有未经授权 push。

在最终候选干净 checkout 的 `server-nest` 目录实际运行 `node scripts/verify-docker-candidate.mjs`：报告 commit 正确，`verified=false`、`suites=[]`，环境预检日志为 **`spawnSync docker ENOENT`**。这不是 Docker build 失败，也没有生成镜像。

| 项目 | Compose #1 / prod | Compose #2 / public-api |
|---|---|---|
| Build | NOT VERIFIED | NOT VERIFIED |
| Container Start | NOT VERIFIED | NOT VERIFIED |
| Migration（容器） | NOT VERIFIED | NOT VERIFIED |
| Readiness（PostgreSQL 16 + Redis 7） | NOT VERIFIED | NOT VERIFIED |
| Worker（镜像内） | NOT VERIFIED | NOT VERIFIED |
| Content（镜像内） | NOT VERIFIED | NOT VERIFIED |
| 注册/登录/抽取/战斗/结算（容器） | NOT VERIFIED | NOT VERIFIED |
| 网关 / TLS | NOT VERIFIED | NOT VERIFIED |

Docker gate 脚本是后续执行入口，尚未在 Docker 上验收。设计采用随机 project、新卷、测试秘密和 loopback 端口，检查无 content 挂载的镜像，再做真实 HTTP 业务冒烟；不启动网关/TLS，也不包含容器备份恢复或容器浏览器多人验收。首套失败会停止，届时必须保留失败证据并单独补第二套，不能声称两套均已验证。完整生产 Compose 验收仍需补这些边界。

### 最终候选回归与证据

- 独立 clone：web 106 / Nest 509 包 `npm ci` 成功，无依赖升级。Nest build/typecheck/lint，web TypeScript/build 均 PASS。
- Python：`python -B -m pytest tests -q -p no:cacheprovider --junitxml=...`，**221 tests、486 subtests PASS**。有弃用警告，不修改测试消除它们。
- Worker：SINGLE/SQUAD/TEAM/SERVER_BOSS、作者技能 ABC/盾回放、五/二十不同角色队伍 PASS。部分测试战斗按预期失败，不把角色胜率等同测试通过。
- `test-skill-slot-rules.mjs`、`test-acquire-connection.mjs`、`test-guide-account.cjs`、`test-server-battle-replay.mjs`、`test-element-theme.cjs` PASS；repository/连接桩测试明确是 Contract，不是数据库 E2E。
- `test-element-theme-browser.cjs`：真实 Chrome 上 1280/390 两页面四组视觉 Contract PASS，八属性名称/图形和实际 DOM 文字对比度 >= 4.5:1、无横向溢出；API 使用 Mock，不计入多人真实 E2E。
- `verify-p0-final.mjs` 当前候选真实隔离回归：13 步均退出码 0，`verified=true`，于 `2026-10-08T10:52:26Z` 完成。包括 H03/H04/H05、单人可信战斗、并发注册、奖励回滚 fixture integration、房间 API、presence 浏览器及完整十局。奖励 fixture 故意触发约束错误以检查回滚，不是忽略失败。
- 多人：两个真实浏览器上下文、1280/390 视口、3+2 选择、准备、开战、共同可信快照、双方结算/返回/下一局全部通过；十局 `reconciled=true`、20 个不同 recordId、browser errors 为 0。包括等待断线/房主转移/恢复、战斗临时断网/刷新恢复、重复开战/并发结算一次发奖；没有加速票据时钟或改 worker 胜负。

本轮 H03 合法 Boss seed `4c59992f-7147-41bf-b180-1714e8dc7006`；可信伤害/实际榜分 **636000**；record `943358e3-3b81-4742-aa16-be66955db616`。

本轮 H05 环境是 PostgreSQL **18.1 Windows**；恢复库 `gamer_rewards_e2e_restore_1791456173530`；备份 SHA256 `e9cea11aa0a30df9d5536b3bb60aacf9a2cabaec408f47552ec661282a0018b8`；恢复验收记录时间 `2026-10-08T10:43:18.465Z`。对这份合成备份按 workflow 参数执行 AES-256-CBC/PBKDF2、200000 iterations 加密/解密，哈希完全一致。这不是生产玩家备份；未执行托管备份 workflow、远程灾难恢复或生产 PostgreSQL 16 恢复。

已将 JSON、13 步日志、Python JUnit、准备页面截图、Docker 预检、视觉 Contract 及原选角失败记录复制归档到项目旁，不纳入候选源码。归档目录：

```text
C:\Users\12107\Desktop\4\release-evidence\afa8a00
  core\core-regression.json
  core\gamer-p0-delivery\result.json
  core\gamer-multiplayer-delivery\result.json
  docker-preflight\result.json
  docker-preflight\1-docker.log
  visual-contract\result.json
  prior-selection-failure\result.json
```

原始临时目录仍保留：`gamer-rc-evidence-afa8a00`、`gamer-docker-gate-TsEEXH`、`gamer-element-visual`。测试 Nest/Vite/Chrome 子进程均已退出，4180/4181/4197/3019/3033 无测试监听；自己的独立 PostgreSQL 55439 已正常停止，没有操作其他 PostgreSQL 服务。

### 八属性视觉与 Known Risk

`web/src/services/elementTheme.ts` 统一管理 Primary/Secondary/Highlight/Background/Dark/Text/OnPrimary。火红、水蓝、土棕、木绿、雷紫、风青、光黄、暗黑；`ElementBadge` 同时展示名称和独立图形，不只依赖颜色。已接入角色卡/头像/技能、抽取、副本、正式多人选择、战斗单位及技能事件；worker 只补属性元数据，不改战斗逻辑。对比度覆盖主题和属性标签，不宣称所有既有伤害/Buff/界面文字均已完成可访问性审核。

**选角不足：仍未完全定位，Known Risk / Not Blocking Current Release Gate。** 上一阶段第九局开战按钮超时，之前八局通过；只读 SQL 观察房主仅一名角色、队友两名，online/ready 为真，总数三而非五，服务端/前端门槛正确拒绝。原失败缺少当时 selectedIds 和请求时序完整证据，不能认定根因已解决。`loadFormalData` 异步回写选择状态是需调查的时序点，不是已证实原因。当前脚本增加每次选择后的 UI 数量、准备响应数量断言和失败截图/请求证据，没有降低开战数量或绕过测试。

最大剩余发布风险是 **生产双 Compose 及容器业务链没有真实证据**。其次为选角时序偶发、四账号/二十角色真人流程、Boss 贡献、容量/故障恢复、既有移动端标题/布局和部分属性色文字对比度缺口。当前只允许隔离合成账号测试单人闭环/两账号 SQUAD；不得开放真实经济、公网、未验收公会贡献/直接助战/多人 Boss，不能仅靠隐藏 UI 视为服务端隔离。

**下一步唯一最重要任务：提供可访问的隔离 Docker runner，对 `afa8a00` 分别完成两套 Compose 的真实构建、启动、迁移、readiness、镜像 worker/content 和核心业务冒烟，再重新裁定 Release Gate。**

## 历史记录：上一阶段 P0 Final Verification（非当前候选）

验收日期：2026-10-08，Asia/Singapore。当前项目阶段：**Validated Multiplayer Alpha / Stabilization**。

发布判断：**CONDITIONAL ALPHA**。只支持开发者监督下的隔离、本地、合成账号内部测试；**尚未达到 Ready for Controlled Alpha，不授权公网或生产部署**。

本节仅保留上一阶段证据。其 dirty candidate、未提交文件和旧 HEAD 描述已由上面的不可变候选记录取代；后面的首次审计同样不能当作当前结论。

### Candidate Version

| 项目 | 本次实际版本 |
|---|---|
| HEAD | `d163ea6bf4c65656460e43dd1dfd49a8c1410afb` |
| Branch | `main` |
| Candidate Commit | **尚未形成**。本次验证对象是 HEAD + 未提交工作树，不是单独的 HEAD。 |
| Schema Version | `MultiplayerRoomPresence1788513000000` |
| 源码快照 | 523 文件，SHA256 `ac217b7fe7fe7daac714a73908415c8be5aabd88b8164a7289d28c80196adb97` |
| 可复现边界 | 已导出源码、保存逐文件哈希，独立目录重新 `npm ci`、构建和类型检查通过；这不等于 Git clean checkout 或容器可复现。 |

迁移集为：

```text
InitialOnlineSchema1788502608304
ConcurrentMutationSafety1788509000000
OnlineLegacyFeatures1788510000000
QuestRewardPeriods1788511000000
MultiplayerRooms1788512000000
MultiplayerRoomPresence1788513000000
```

工作树包含既有未提交业务修复：房间共享开战/结算、前端多人和回放、鉴权、排行榜、schema、备份工作流、两个生产 Compose，以及依赖文件。完整 Dirty Files 清单已保存到 `candidate-manifest.json` 的 `dirtyStatus`，没有撤销用户改动，也没有代为提交。

以下关键文件仍未跟踪，必须纳入最终候选提交：

```text
server-nest/src/auth/active-account.guard.ts
server-nest/src/database/migrations/1788513000000-MultiplayerRoomPresence.ts
server-nest/scripts/e2e-multiplayer-room-browser.mjs
server-nest/scripts/e2e-multiplayer-delivery.mjs
server-nest/scripts/e2e-p0-delivery.mjs
server-nest/scripts/verify-p0-final.mjs
server-nest/scripts/snapshot-p0-candidate.mjs
PROJECT_STATUS.md
NEXT_STEPS.md
```

源码快照包含关键业务/测试文件，不包含这些未跟踪报告、秘密、数据库文件或原工作树的依赖目录。报告更新不会改变该源码哈希。

### 发布门禁

| Gate | 当前结果 | 真实证据及限制 |
|---|---|---|
| H01 Multiplayer First Game | **Resolved / Verified / PASS** | 最新真实 React + Nest + PostgreSQL + Python worker，双方分别选择 3+2，准备、按钮开战、结算成功。 |
| H02 Replay | **Resolved / Verified / PASS** | 连续十局均自然返回、刷新、创建下一房间并重新加入；finished 不阻塞下一局。 |
| H03 Ranking Security | **Verified / PASS** | 未登录写榜 401、跨账号 401、动态及固定权威榜直写 400；合法服务端 Boss 结算真实写榜。 |
| H04 Ban Token | **Verified / PASS** | 管理员封禁后旧 Token 的核心读写和新登录 403；解封恢复；同一数据库的两个 API 实例一致。 |
| H05 Migration / Backup / Restore | **Verified / PASS（本地）** | 隔离库全迁移、旧 schema 升级、重复迁移、正式备份 HTTP、真实恢复、恢复后服务启动/登录/查询/结算重放。 |
| H06 Production Compose | **NOT VERIFIED** | context 修复已包含，两个 Compose 的解析/路径静态检查通过；本机没有 Docker/Podman，未构建镜像或启动容器。 |
| Core Regression | **PASS（本节列明范围）** | Python、worker、前后端检查和 13 步数据库/HTTP/浏览器回归均通过；未运行所有历史/公网脚本。 |
| Multiplayer 10-Game Regression | **PASS** | 最新完整重跑十局、两个独立 Chrome 上下文、1280/390 视口、20 条不同账号结算记录。 |
| Database Reconciliation | **PASS** | 十局逐局核对票据、共享 seed/快照/时间、收益、材料、进度、角色等级/经验/归属；每账号奖励一次，局外账号不变。 |
| 不可变版本/生产可复现 | **未关闭** | 未提交 migration/guard 等文件，HEAD 不能代表本次验收版本；快照不是 release commit。 |

**New Blockers：没有新增已确认业务 Blocker；H06 和候选提交闭合仍是已有发布阻塞。**

### H03 / H04 实测

- H03：真实 `world_boss:<dungeonId>` key 和固定权威榜均拒绝普通用户直接自报 score；非权威公共榜允许本人写入，不能将其误称为 Boss 绕过。
- 合法 Boss 使用真实作者技能 worker：seed `68285937-ef0d-448b-b2cc-f51c1ec4198a`，可信伤害和实际榜分均为 **645000**；记录 `b1bffd56-c93f-4fb1-a937-1bd49efeeefa`。
- 四个并发结算请求跨两个实例只产生一条记录、一次榜尝试；伪造 `damageScore=999999999` 和奖励不生效，伪造玩家/阵容/seed 被拒绝。
- H04：旧 Token 封禁后拒绝，重新登录拒绝，其他账号不受影响。无管理员凭证解封 401；带合法管理员凭证解封 201，新登录和未过期旧 Token 在两个实例恢复访问。
- 账号状态按请求查数据库，没有状态缓存；“解封后旧 Token 恢复”是本次实际策略，不是永久撤销 Token 的机制。

### H05 实测与备份元数据

- PostgreSQL：**18.1，Windows x86_64**；独立测试实例 `127.0.0.1:55439`，未访问生产库。
- `TYPEORM_SYNCHRONIZE=false`：从空库执行全部六个迁移、初始旧 schema 升级到当前六迁移、再次执行均通过。
- 最新备份由 `/api/admin/database/backup` 实际下载，schema/commit HTTP 头符合预期；commit 头是上述 HEAD，不能掩盖 dirty candidate。
- 备份验收记录时间：`2026-10-08T09:33:18.282Z`。该字段由测试在恢复验收末尾记录，不是精确的备份开始时刻。
- 备份 SHA256：`f15643390e07f691531a7c0e89abad708cdc051cec2e09c4d2157b76e3a36a4a`。
- 恢复库：`gamer_rewards_e2e_restore_1791451974326`。真实 `pg_restore`、新增表/列/presence/关系与基础计数检查通过。
- 恢复后的当前 Nest 启动、登录、档案、战斗记录查询和旧结算幂等重放通过；恢复库重复迁移通过。
- 对最新合成数据备份执行工作流同参数的 AES-256-CBC/PBKDF2 加密/解密，SHA256 一致。**没有执行托管 GitHub Actions、生产秘密配置和远程灾难恢复。**
- 备份含 2 用户、2 玩家、20 角色、1 战斗记录、1 背包物品；这是合成测试样本。新增房间表结构已检查，不代表恢复后活跃多人房间恢复/崩溃续跑已经验收。
- 生产 Compose 声明 PostgreSQL 16，本次真实本地恢复使用 PostgreSQL 18.1；不能据此宣称生产 16 的迁移和恢复兼容性通过。

### 回归清单及证据等级

| 检查 | 结果 / 等级 |
|---|---|
| Python 全量 | 221 passed，486 subtests，5 弃用警告，最新重跑 2.75s。 |
| Nest build / typecheck / ESLint | PASS；独立导出目录锁文件安装后也通过。 |
| Web TypeScript / production build | PASS；独立目录也通过，保留 Vite CJS 和大于 500KB chunk 警告。 |
| Battle worker | PASS；真实 Node/Python 进程，四类副本、同种子重复、ABC/护盾和不同角色组队。 |
| Skill slot | PASS；规则测试及 **repository stubs / Contract verification**，不当作 HTTP E2E。 |
| Connection retry | PASS；**Stub / Contract verification**，不是远程网络故障测试。 |
| Account isolation / Guide / Replay mapping | PASS；本地规则/存储/映射测试，不当作完整真人流程 E2E。 |
| 单人权威战斗 | PASS；真实 HTTP/worker/数据库，过早/跨账号拒绝，伪造字段忽略、六路结算一次。 |
| 注册并发 | PASS；真实 HTTP/数据库，六路并发、同名冲突和档案失败回滚。 |
| Reward | PASS；**数据库 fixture integration**：历史战斗/周期 fixture、约束故障注入、两个 API 实例；不是自然战斗到全部奖励的真实 E2E。 |
| Multiplayer API | PASS；真实 HTTP/数据库/自然回放时长，presence 异常有显式数据库 fixture，不能代替 UI 证明。 |
| Multiplayer presence browser | PASS；真实双浏览器 HTTP，房主断线、转移、宽限期重连。 |
| Multiplayer 十局 UI | PASS；真实登录/建房/邀请/接受/3+2/准备/按钮开战/自然 4x 回放/结算/返回，无 HTTP mock 或业务时钟修改。 |
| git diff --check | PASS；只见 CRLF 提示。 |

最终顺序回归有 13 个步骤，全部退出码 0，时间 `2026-10-08T09:32:47.226Z` 至 `2026-10-08T09:41:59.287Z`。

十局已覆盖两局冒烟、重复按钮/并发 start、等待时断网刷新、战斗时断网刷新、结束刷新再开、重复结算；没有按 SQL 修改玩法状态使十局通过。仅开局前准备拥有角色的 fixture；每局保存 seed、角色归属、快照哈希、奖励、记录和对账结果。

**失败也保留**：前一次最终十局运行完成 8 局后，第 9 局等待 3+2 开战超时。只读 SQL 显示房主实际提交 1 名角色，门禁正确拒绝。新增逐次选角 UI 断言、准备响应角色数断言和失败诊断后，从新隔离库重跑全部流程及十局通过，没有弱化断言或修改多人业务逻辑。选角不足的确切触发原因尚未完全定位，不能仅凭重跑通过宣称此偶发风险已根治。

截图人工检查：桌面准备状态正确显示 5/5；390 宽度截图存在顶部/边缘裁切，自动横向溢出断言通过不等于移动端视觉完美。未以此非门禁 UI 问题扩展本阶段改版范围。

证据目录：

```text
C:\Users\12107\AppData\Local\Temp\gamer-p0-final-20261008\
  candidate-manifest.json
  candidate-source\
  core-regression.json                       # 前次失败，不能用于 PASS
  multiplayer-final-ten.log                  # 前次失败日志
  rerun-selection-assertions\
    core-regression.json                     # 当前最终 PASS
    gamer-p0-delivery\result.json
    gamer-p0-delivery\delivery.dump
    gamer-p0-delivery\restore-verification.txt
    gamer-multiplayer-delivery\result.json
    gamer-multiplayer-delivery\ready-*.png
```

这些是本机临时路径，不是已发布的持久 CI 产物；下一步需归档到可靠存储。

### 模块完成状态

已实现并接入正式在线端：账号、抽取、64 角色/192 技能、九槽、升级、装备、背包、制作/强化、单人副本、权威战斗结算、挂机/每日目标、基础任务/成就/商店/好友/Boss。此次不是这些模块全部玩法和配置的穷举验收。

本次新增确认完成的有限范围：双账号五角色多人可复玩闭环、Boss 榜写入安全、按请求封号/解封控制、当前 schema 的本地升级与备份恢复。四账号二十角色玩家流程、赛季运营、公会/邮件完整体验、资源音频、支付/平台登录等不能标记 Completed。

### 剩余风险与临时限制

1. **H06 未验证、候选提交未形成**：不能称可部署。缺镜像/Python/content/migration 容器验收、Redis readiness、TLS/环境变量/真实 CI。
2. **H09/H10/H11 保留**：直接助战事务/权威来源、多人全服 Boss 整队伤害按成员计入、公会客户端贡献仍未在本阶段关闭。只隐藏 UI 不能隔离公开 API。
3. 长期悬挂房间、票据过期、服务崩溃恢复、三人以上好友拓扑、四账号二十角色及容量未验收。
4. 原始选角不足偶发、移动端裁切、worker 超时及后台节流仍需观察，不伪称不存在风险。

允许范围：隔离本机、合成账号、开发者监督、双账号 SQUAD 3+2 功能测试。禁止：公网暴露、真实经济/支付、未验证公会/直接助战、多人 SERVER_BOSS 经济结算、原型接口公开和容量承诺。这些是操作约束，不是已实现的路由开关或功能隔离。

**Most Important Next Task：冻结完整候选源码并在有 Docker 的隔离 runner 上关闭 H06，验证两个生产 Compose 的 clean checkout -> build -> migration -> worker/content -> Redis readiness；不扩展新玩法。**

---

## 历史记录：首次全面审计（修复前，不代表当前状态）

审计日期：2026-10-08，Asia/Shanghai。项目：灾异志 / 灾异纪元。

审计范围：`C:\Users\12107\Desktop\4\Gamer` 当前本地工作树，包括未提交改动；外层 `4` 是设定文档和部分素材目录，不是 Git 根目录。本次只新增两份审计报告，没有修改业务代码、资源、配置或依赖。

## 1. Executive Summary

**结论：已有可运行的角色养成与自动战斗核心，处于 Alpha，正在补齐多人闭环与发布可靠性；不能认定 Feature Complete、Beta 或 Release Candidate。**

- 已实现并接入正式在线端：账号、抽取、64角色/192专属技能、九槽配置、升级、装备、背包、制作、强化、单人经验本、Boss挑战、服务端战斗与结算、挂机、每日目标，以及基础任务、成就、商店、好友和全服Boss。
- 本次实际通过：Python 221项测试、486个子场景；前后端类型检查、Nest lint、前后端生产构建；四类Node/Python真实战斗进程测试；技能槽、连接重试、新手引导、回放映射测试。
- **多人API存在不等于玩家多人流程完成。** 真实前端构建产物的浏览器契约测试复现了“全队已准备但不能开战”和“结算后不能再创建/退出房间”两个断点，1280/390两种宽度均复现。
- 发现正式Boss排行榜写入口没有身份校验，保护名单没有覆盖真实 `world_boss:<dungeonId>` 名称。现有封号不撤销已签发的30天令牌。
- 当前备份/恢复检查仍硬编码旧schema；两个正式Compose的构建上下文与Dockerfile不匹配。存在发布与恢复阻塞。
- 本次没有对真实PostgreSQL执行写入型e2e，没有验证当前公网部署、CI最近结果或负载能力。历史验收不能替代当前版本验收。

**明天只做一项任务：打通并验收“两账号真实浏览器创建房间 -> 分别选3+2角色 -> 准备 -> 开战 -> 各自一次结算 -> 返回 -> 再次开局”，连续10局。** 安全与备份问题是公开发布前必须并行关闭的P0门禁，详见 `NEXT_STEPS.md`。

## 2. Project Type & Technology Stack

| 方面 | 实际证据与结论 |
|---|---|
| 游戏形态 | 浏览器角色收集/养成、阵容配置、自动技能战斗、副本及异步多人协作；不是已验证的开放世界实时MMORPG。 |
| 引擎 | 未发现Unity、Unreal、Godot工程；战斗是自研Python模拟器，界面为React DOM/CSS，不是3D引擎场景。 |
| 客户端 | React 18、TypeScript、HashRouter、Zustand、Axios、Vite；一个代码库内分正式在线、Python原型、静态演示三条路径。 |
| 正式服务端 | NestJS 10、TypeScript、Express、TypeORM、PostgreSQL；通过子进程调用Python战斗worker。 |
| 原型服务端 | Flask、Flask-SocketIO、SQLAlchemy、APScheduler；PostgreSQL不可用时可能使用SQLite。 |
| 网络 | 正式端HTTP、Bearer令牌、房间轮询/心跳、战斗快照轮询。Socket.IO用于旧Python路径；未发现正式Nest WebSocket房间同步实现。 |
| 战斗同步 | 开战时服务端预计算结果并保存票据，按服务器时间逐步公开快照，前端以4x回放；不是玩家实时操作广播。 |
| 配置 | `data/content/*.json`、数据库GameConfig覆盖、构建环境变量和 `window.__GAMER_RUNTIME_CONFIG__`。角色执行技能绑定worker文件版本，部分任务/商店/副本规则仍写在代码中。 |
| 存储 | 正式PostgreSQL实体和迁移；原型SQLAlchemy/SQLite；客户端localStorage存账号会话与引导，sessionStorage存恢复战斗凭证。Redis主要用于依赖检查/基础服务，不是多人同步权威源。 |
| UI/资源 | 页面、CSS、文字/图标/占位立绘；未发现完整可打包的64角色立绘目录或音频播放链路。外层有少量PNG，但未证明接入客户端。 |
| 测试 | Python pytest/unittest及subtests；Node assert脚本；HTTP/SQL e2e；Playwright；ESLint和TypeScript。 |
| 构建部署 | Nest build、Vite build；Docker/Compose、Render Blueprint、GitHub Pages、Sites Worker代理；Actions构建、公网验收、并发检查和数据库恢复任务。 |
| 第三方SDK | Axios、Socket.IO客户端、bcryptjs、ioredis、pg、class-validator等；未发现支付或平台登录的完整SDK集成。 |

技术识别依据：[E01]、[E02]、[E03]、[E10]、[E11]。SDK枚举值存在不等于对应平台认证已实现。

## 3. Current Development Stage

**Alpha / Core Gameplay已具备，向可重复多人Vertical Slice和Stabilization推进。**

支持依据：

1. 实际可执行战斗不是空框架：64角色、192技能、怪物机制与四类副本worker均有测试，真实Node/Python进程联调通过。
2. 注册、抽取、经验、装备与结算已在前后端接线；存在历史真实HTTP/PostgreSQL验收记录。
3. 多人目前仍存在前端开战与再开局断点；当前真实端到端闭环未重新验收。
4. 赛季收尾、立绘/战魂、公会/邮件玩家界面、资源与音频不完整；奖励、鉴权和发布门禁存在实质风险。
5. 单测与构建通过并不足以证明当前线上稳定、经济安全或可运营。

若将目标收窄为“单人自动战斗技术切片”，它比Prototype成熟；若目标是README完整网游设计，仍不能宣布功能完成。

## 4. Overall Progress

| 口径 | 估计 | 说明 |
|---|---:|---|
| 当前核心玩法实现与接线 | 75% | 大多数核心模块有真实实现，单人闭环较成熟；多人仍有阻塞。 |
| 稳定公开发布准备 | 50% | 已有构建、部署和备份框架，但安全、迁移恢复、当前版本e2e与容量门禁未达标。 |
| README全部长期网游设计 | 无法确认 | 缺少经过负责人确认的版本范围、完整内容量、支付要求、资源交付标准、SLO与排期基线。 |

这是按功能与玩家流程给出的粗粒度审计估计，不是代码行数统计、工时预测，也不是“剩余25%即可上线”的承诺。没有以提交数量推断进度。

## 5. Feature / Module Status

状态标记：**I = Implemented；G = Integrated；R = Runnable；V = Verified；C = Completed。** `V单测`、`V进程`、`V契约`与`V真实HTTP/DB`不等价。表中“历史”表示已有记录但本次未复测；C仅用于明确、有限的规则子范围，不表示整个模块生产完成。

| Module | Status | Progress | Evidence | Risk |
|---|---|---:|---|---|
| 8职业、8属性及克制规则 | I/G/R/V单测；C规则子范围 | 100% | Python本次全量；`tests/test_game_systems.py` | 不代表所有阵容已平衡。 |
| 账号注册/密码登录 | I/G；历史V真实HTTP/DB | 90% | [E03]、[E12]；事务注册、bcrypt、冲突处理 | 当前公网未复测；已登录封号无效；无完整找回密码。 |
| 大厅/会话/新手引导 | I/G/R/V引导单测 | 75% | [E02]；`web/scripts/test-guide-account.cjs`本次通过 | loadPlayer仅恢复缓存，不实时核验封号/最新档案；资源显示存在缓存路径。 |
| 64角色/192技能与九槽 | I/G/R/V单测+进程；历史V真实HTTP | 90% | [E04]、[E12]；本次skill-slot和worker | 并非192技能与所有组合的穷举验收。 |
| 战斗/怪物/Boss | I/G/R/V单测+真实进程 | 90% | [E04]；四类worker、固定种子重复输出一致 | 容量、15秒超时、故障恢复尚未证明；非实时操作战斗。 |
| 服务端结算/奖励存档 | I/G；历史V真实HTTP/DB | 75% | [E05]、[E08] | 房间跨账号事务、过期票据、并发死锁等缺本次真实验收。 |
| 单人经验本/扫荡/升级 | I/G/R引擎；历史V真实HTTP | 90% | [E05]、[E12]；24经验本定义 | 50次通关后扫荡；本次未验证真实浏览器全链路。 |
| 五人/二十人/全服Boss计算 | I/G/R/V进程 | 90% | [E04]；24 Boss入口定义、不同角色参考队通过 | 五人/二十人是角色槽位，不必然等于5/20真实账号。 |
| 多人房间API | I/G；测试脚本存在 | 75% | [E06]、[E08] | 部分开战落库非原子；加入多个房间、好友关系拓扑和重试风险。 |
| 多人玩家完整闭环 | I/G部分；V契约确认断点 | 50% | [E06]；本次1280/390浏览器复现 | Blocker：通常不能从按钮开战；结算后不能再开局。 |
| 心跳/重连/房主转移 | I/G；未验证当前真实HTTP/DB | 75% | [E06]、[E08]；未提交presence迁移 | 浏览器脚本仅等待房间；战斗断线/服务器重启未覆盖。 |
| 抽取/重复转换/背包 | I/G；历史V真实HTTP | 90% | `gacha`、`inventory`服务和对应页面 | 需当前经济回归；不是支付商城。 |
| 制作/装备/强化/突破 | I/G；历史测试脚本与验收 | 90% | [E07]；强化同步已穿装备副本 | 未证明全部装备配置一致；未发现正式精炼闭环。 |
| 挂机/每日目标 | I/G；e2e存在 | 75% | [E07]、[E08] | 挂机启动/停止非统一事务；不同请求并发与重启恢复待测。 |
| 正式任务/成就 | I/G；周期和并发测试脚本存在 | 75% | [E07]、[E08] | 仅4任务/5成就；不等于完整主支线内容。周期已实现，不能沿用旧文档称缺失。 |
| 好友/助战 | I/G；e2e存在 | 75% | [E07]、[E08] | 正式借角没有核验assistEnabled；直接助战API事务错误。 |
| 活动商店 | I/G基础兑换 | 50% | [E07]；每月购买限额与事务兑换 | 商品硬编码；未发现正式活动排期/完整轮换生命周期。 |
| 全服Boss赛季/层数/宝箱 | I/G基础 | 50% | [E07] | 无旧赛季收尾；共享伤害多账号累计需确认；真实榜写入未保护。 |
| 排行榜 | I/G Boss界面；V探针发现绕过 | 50% | [E09] | 无鉴权写入口；动态Boss榜不在保护名单。 |
| 公会 | I后端；局部接每日目标 | 50% | [E09]；`guild`服务/控制器 | 缺玩家UI、退出/治理；客户端可自报贡献，非原子保存。 |
| 邮件 | I后台发放/列表；无完整领奖链 | 25% | [E09]；`mail.controller.ts`仅GET | 补偿奖励不能认定已可领取；无玩家邮件页面。 |
| 立绘/战魂 | 原型I；正式G未完成 | 25% | [E13] | 正式端跳过加载；碎片产出没有完整正式消费闭环。 |
| 正式聊天/自动匹配 | 未发现正式主流程 | 0% | [E06]、[E13] | 旧原型有房间聊天；不能说全项目聊天从未实现。自动匹配是否本阶段必须做需裁定。 |
| 纪元隔离 | 原型I/R/V单测；正式未接线 | 25% | `src/versions/version.py`、[E05] | Nest入口只校验角色数/部分属性；不能认定版本与满级解锁规则全部生效。 |
| 资源/音频/演出 | 局部UI；音频链未发现 | 25% | [E13] | 占位立绘与素材接入；无完整资源验收基线。 |
| 运维/备份/迁移/CI | I/G构建；发布路径有断点 | 50% | [E10]、[E11] | 旧schema验收和Compose路径错误；当前部署状态无法确认。 |
| 支付/平台登录 | 未发现完整实现 | 0% | [E03]、[E13] | Provider枚举不是功能实现；不自动将其列为Alpha阻塞。 |

## 6. Completed

本次可在有限范围内确认完成：

- 职业、属性、克制基础规则及对应测试。
- ABC技能槽的合法布局、重复技能、未知/跨角色ID拒绝规则；实际技能执行和护盾进入回放的进程级验证。
- 前后端可构建、类型检查与Nest lint；真实Python战斗worker四类输入的运行与重复性。
- 新手引导账号隔离、坏存储处理、回放映射以及连接重试次数/释放规则的本次测试。

已实现的核心产品能力包括注册、抽取、成长、装备、单人副本、服务端结算等，但它们整条当前HTTP/DB/浏览器链路没有在本次重跑，不将它们一概标为生产Completed。

## 7. Implemented but Not Verified

- 当前工作树的多人presence字段、迁移、API心跳、定时检查和重连显示。
- 当前工作树下真实PostgreSQL的房间共享战斗、独立结算和两局连续复玩。
- 当前正式API的奖励并发、回滚、跨账号安全、公会及挂机并发。
- 当前Render、Pages、Sites运行提交与schema、定时备份是否实际成功。
- 账号找回、长期离线回归、浏览器进程关闭后单人战斗恢复、服务器崩溃后starting房间恢复。
- 性能、内存、长期数据增长、并发容量、移动设备后台节流及多实例房间扫描。

测试脚本存在只是“有测试能力”；本次未运行的脚本不记为Passed。

## 8. Partially Completed

- 多人完整流程：API开战存在，但UI准入条件和finished清理断开。
- 社交：好友建立和借角色开战已接线；助战开关未约束角色名册/授权；前端“添加好友”直接建立accepted关系，和申请/接受API语义不一致。
- 活动：原型自动轮换已接启动器；正式商店有月度限额，但没有完整活动轮换。
- Boss：季度key、共享层、累计榜、宝箱存在；赛季关闭、结算、历史奖励回收/补偿缺乏正式链路证据。
- 邮件：可由运营发邮件并存储奖励字段，但没有看到正式玩家领取API。
- 公会：创建、加入、贡献和查询有代码，无完整玩家管理体验与权威贡献来源。
- 立绘、战魂、纪元、精炼、团队战报：原型或局部实现不能当成正式在线完成。

## 9. Not Started

在正式在线端未发现自动匹配队列、匹配取消/超时、正式聊天、支付、Apple/微信认证、完整音频播放链路。

这些“不存在”结论限于已扫描源码/配置。是否为当前版本必需功能，需要先确认范围；不能仅因README提到MMORPG就将全部长期内容列为Blocker。

## 10. Hidden Issues

### H01 / Blocker：全队已准备但开战按钮仍不可用

`web/src/pages/MultiplayerRoomPage.tsx:916` 使用 `room?.character_ids.length || selectedIds.length`。等待房间的顶层 `characterIds` 初始为空；服务端只在 `start()` 中汇总并保存（`multiplayer-rooms.service.ts:194`）。前端却先用该汇总结果启用按钮，形成循环依赖。

两账号分别选3+2名角色且都准备时，UI显示3/5，开战按钮disabled。本次真实生产React在1280/390宽度、模拟合法HTTP响应下均复现。不是实际服务器完整开局验证，但断点本身已确认。极端“房主自己选齐5名”可绕过，不能据此认为正常协作流程已通。

### H02 / Blocker：结算后不能从房间界面再次开始

服务端 `current()` 返回最近成员的finished房间（`multiplayer-rooms.service.ts:54`）；settle设置finished但保留成员；leave只接受waiting（`:249`）。前端仅在 `!room` 显示创建，finished的准备/开战/离开都disabled（`MultiplayerRoomPage.tsx:1196`、`:1210`）。

本次1280/390浏览器契约测试均复现。直接调用create API可绕过，因此“后端能创建第二房间”不证明玩家UI可复玩。

### H03 / Critical：真正使用的Boss榜可被客户端写入，且写入口没有鉴权

`ranking.controller.ts:26` 的POST不使用AuthService；`ranking.service.ts:6`只禁止3个固定名称，但实际榜名是 `world_boss:${dungeonId}`（`online-features.service.ts:372`）。

本次使用当前编译代码和内存repository复现动态Boss榜接受自报分数；不曾攻击公网或实际改数据库。结合控制器调用可判定发布安全缺陷，需真实HTTP负向回归。

### H04 / Critical：封号不撤销现有令牌

`admin.service.ts:96`写banned；登录检查该状态，但 `auth.service.ts:104` 只验证签名/到期，不读取账号状态，令牌签发期限为30天。本次内存探针确认旧令牌通过鉴权且未查询user。

结论仅为现有受此AuthService保护路径不能立即封禁已登录账号；不将“新登录会拒绝”误说成封号全部失效。

### H05 / Blocker（发布恢复）：备份/恢复检查落后于schema

当前schema为 `MultiplayerRoomPresence1788513000000`；HEAD已是 `MultiplayerRooms1788512000000`，而workflow和恢复SQL仍要求 `ConcurrentMutationSafety1788509000000`。[E10]

因此对最新schema的备份，workflow头检查/恢复版本断言会拒绝；新增任务、成就、Boss和房间表也没有加入恢复表清单。未实际跑恢复，但版本矛盾可直接确认。不能因此宣称线上数据已丢失。

### H06 / Blocker（该部署路径）：两个正式Compose不能使用当前Dockerfile完整构建

`docker-compose.prod.yml:32`、`docker-compose.public-api.yml:34` 将context设为 `../../server-nest`；对应Dockerfile需要从项目根复制 `server-nest/`、`src/`、`data/content/`。[E11]

文件在该context不可见。Render及根目录开发Compose使用根context，不受同一错误影响。本机无Docker命令，未实际构建容器。

### H07 / Critical候选：多人开战不是一个共享快照/原子发布

房间先提交starting，再逐个成员调用独立 `dungeons.start()`；每次重读角色并运行模拟。中途失败只把房间改回waiting，不清除之前已提交的票据和activeBattleSeed。[E05]、[E06]

故障时可留下部分账号已开战；服务进程中断则starting无恢复路径。成员间装备/技能变更可能让相同seed产生不同快照结果。当前只做代码判定，未进行真实故障注入，不能声称已经观察到结果分叉。

### H08 / Major：房间成员与好友校验约束不一致

邀请只要求被邀请者是房主好友；每个成员开战又要求所有借用角色主人都是自己的accepted好友。三人以上房间可能需要成员互为好友，而不只是房主的好友。

create先查后写无统一玩家锁；acceptInvitation没有“该玩家是否已有另一活跃房间”的检查。不同房间并发加入/建房与activeBattle覆盖需要SQL级回归，尚未证实实际发生。

### H09 / Major：助战开关和直接助战接口不完整

`assistRoster()`、`resolveAssistCharacters()`未核验helper的 `flags.assistEnabled`；界面可关闭，但不能据此拒绝借角。

直接POST助战可达 `recordAssist()`，却不传事务manager；方法使用pessimistic_write。本次已加载全部实体的TypeORM内存探针复现 `PessimisticLockTransactionRequiredError`，未建立数据库连接。[E07]

**不能把这个路径直接断言为“已可无限刷金币”**：目前事务缺失可能先阻止执行。正确结论是接口不可认定可用，且设计缺少真实战斗来源/一次性约束；不能仅加事务而保留客户端自报发奖。

### H10 / Major：Boss评分/奖励契约存在矛盾

每名房间成员独立结算同一整队damageScore并调用全服累计，可能将整队伤害按成员数重复累计；只有success才记录贡献；宝箱目前给触发清层的结算玩家。需先裁定个人贡献、失败伤害、参与者奖励规则。

UI声明“每50层10碎片”，实际开箱按tier给1/2/5片，没有发现独立里程碑领取实现。未做真实多账号Boss对账，以上区分为代码/契约风险，不伪称已经造成经济损失。

### H11 / Major：公会贡献不是权威资源消费

`guild.controller.ts`允许客户端提供amount/source/payload；service只检查正数，直接增加贡献并并行保存，无对应资源扣除或一次性业务来源；加入限额也是先计数后插入。已核对代码，未复现并发超员/丢更新。公会未接玩家主流程不代表公开API没有风险。

### H12 / Major：旧e2e会产生误导

`e2e-http.mjs`开战后立即结算且要求damageScore=0；`e2e-online-loop.mjs`要求客户端指定击杀对应的固定经验。当前权威结算有elapsed校验且实际使用worker伤害，两者明显落后。它们不是当前闭环通过的可靠证据。

现有房间HTTP测试绕过UI直接调用start；新浏览器presence脚本只测等待房间重连，没有点击选角/准备/开战或第二局，因此可以漏掉H01/H02。

## 11. Technical Debt

| 分类 | 内容 | 影响 |
|---|---|---|
| Critical | 多账号玩家/角色锁序不统一 | 两成员同时结算各自先锁本人，再锁全队角色/对方玩家；潜在数据库死锁。本次未复现，不与已确认UI阻塞混为一谈。 |
| Major | 模式与文档漂移 | README全未勾选、旧75%文档、API coverage的Pending说明与新代码互相冲突。 |
| Major | 配置分散/缺内容文件回退 | known content列出不存在的文件；部分奖励有fallback、任务商店硬编码。需要校验配置完整性和版本一致。 |
| Major | activeBattleSeed覆盖与过期 | 新开战可覆盖旧未结算票据；结算票据超过3600秒拒绝；缺明确弃战/补偿产品规则。 |
| Major | 房间扫描与轮询 | 每5秒查最多100房间，无明确分页、公平扫描与错误可观测性；玩家每2.5秒轮询两接口并另发心跳，需容量/NAT限流评估。 |
| Major | 部分API非事务 | 公会、直接助战、挂机start/stop；范围应逐个裁定，不必重写整个服务层。 |
| Minor | 原型TODO/乱码 | 原型驱散查找返回None；prepare_character仍TODO；原型手动活动轮换未校验管理员，任务材料发放未完成。若公开原型则安全等级上升。 |
| Minor | 构建/日期警告 | Python10条弃用警告；Vite CJS警告及613KB主JS chunk；影响维护与加载，不是当前最大阻塞。 |
| Future | 内容及表现层扩展 | 新角色、大型场景、支付、更多动画、音频、自动匹配应在范围确定后排期。 |

TODO搜索做了上下文判断：HTML输入placeholder、测试Mock、模拟固定值属于合理实现/测试手段，不列为未完成业务。

## 12. QA / Testing Status

### 本次实际执行

| 检查 | 结果 | 证明范围 |
|---|---|---|
| `.venv/Scripts/python.exe -B -m pytest ...` | 未能执行：No module named pytest | 环境缺依赖，不是测试断言失败；未安装任何包。 |
| `python -B -m pytest tests -q -p no:cacheprovider` | **221 passed，486 subtests passed，10 warnings，8.59秒** | 系统Python跑当前全部Python tests；不生成pytest cache/pyc。 |
| Nest `tsc --noEmit --incremental false` | PASS | 当前源码类型检查。 |
| Web `tsc --noEmit --incremental false` | PASS | 包括未提交页面改动；不等于UI逻辑正确。 |
| Nest `npm run lint` | PASS | 没有使用--fix。 |
| Nest `npm run build` | PASS | 生成本地忽略目录dist，不部署。 |
| Web `npm run build` | PASS | 188模块，613.02KB JS、120.81KB CSS；有chunk/CJS警告。 |
| `test-battle-worker.mjs` | PASS | 真实Node/Python：SINGLE、SQUAD、TEAM、SERVER_BOSS；固定seed重复一致；作者技能/护盾、5/20不同角色参考队通过。 |
| `test-skill-slot-rules.mjs` | PASS | 规则及repository stub下加载/保存/迁移，非真实数据库。 |
| `test-acquire-connection.mjs` | PASS | stub连接的有限重试、释放、永久错误不重试。 |
| `test-guide-account.cjs` | PASS | VM/localStorage模拟的账号隔离、坏存储。 |
| `test-server-battle-replay.mjs` | PASS | 合成快照映射，不是实际线上战斗。 |
| `audit-online-api-coverage.mjs` | PASS | 15条路由声明存在；只是字符串/声明检查，没有请求API，也遗漏multiplayer/team-records路由。 |
| 临时内存风险探针 | 确认H03/H04及直接助战事务前置错误 | 当前编译代码+stub或TypeORM元数据，无数据库连接/写入。未持久化探针文件。 |
| 真实React构建/Playwright契约探针 | **1280/390均复现H01/H02；无页面错误/横向溢出** | 实际Chrome、生产React和临时只读HTTP静态服务器；业务HTTP全mock。无截图文件、服务器测试后已关闭。 |
| 本地4100/5000探测 | ECONNREFUSED | 默认端口没有正在服务；不代表其他端口或公网离线。 |

### 测试覆盖的真实缺口

- 没有本次真实PostgreSQL/HTTP结果；未运行会写账号、改表、发奖励或修改测试票据时钟的脚本，遵守只读审计。
- 没有“两个真实浏览器十局复玩”“四账号二十人房间”“中途服务重启恢复”“全部成员最终奖励对账”的当前记录。
- 没有当前schema全迁移 + 恢复 + 启动验收；不能用TYPEORM_SYNCHRONIZE测试代替迁移验证。
- 没有当日公网版本、CORS、账户重登录与资源恢复结果。
- 一些浏览器技能/入口测试mock HTTP；一些HTTP测试通过SQL放入满级角色并提前票据时钟。它们有效验证其断言，但不是从新账号自然成长的全链路。
- CI没有跑Python全量、奖励e2e、房间e2e和上述双局UI门禁；当前构建CI只是部分覆盖。

### 异常路径矩阵

| 异常 | 已见处理/测试 | 尚缺证据 |
|---|---|---|
| 注册冲突/连接失败 | 事务、唯一冲突、有限连接重试；本次连接stub通过 | 当日实际DB并发与网络恢复。 |
| 请求超时/503/429 | Axios60秒、worker15秒和busy拒绝、IP限流、UI错误提示 | 多人开战结果不明时的正确重试/补偿。 |
| 重复抽取/结算/领奖 | IdempotencyService事务+请求hash；e2e-rewards脚本覆盖同/异key、回滚 | 本次真实运行；对业务入口完整覆盖。 |
| 房间满/未准备/非房主 | 服务端校验与行锁 | UI完整请求/错误提示，跨房间加入和完整好友拓扑。 |
| 房主离开/断线 | waiting转移房主、15秒离线、30秒宽限；presence脚本 | 移动端切后台、战斗中断线、超过宽限再入、重启。 |
| 服务中断 | worker失败不发奖；starting仅有catch回waiting | Node进程崩溃后的状态回收、部分成员已提交票据的补偿。 |
| 保存失败 | 多数核心变更使用事务；奖励脚本有SQL故障注入 | 房间开战、公会、直接助战、挂机生命周期的原子性。 |
| 数据不存在/腐坏 | 多个NotFound、非法skill校验、引导坏JSON处理 | 完整档案/技能/装备腐坏、迁移失败可恢复方案。 |
| 退出/返回/再开始 | 单人UI有返回定时器；房间leave只waiting | H02已确认；战斗凭证sessionStorage未见结算后清除。 |

## 13. Build / Deployment Status

- 当前本地前后端构建可执行；无需升级依赖。
- 系统Python能运行测试与worker，但`.venv`缺pytest；开发测试环境不可完全按requirements复现，requirements也未声明pytest/subtests开发依赖。
- 当前默认本地服务端口未运行；未为审计启动会初始化/写入业务库的Nest/Flask。
- Render Dockerfile、Blueprint与根目录开发Compose使用正确根context；另两个生产Compose有H06。
- 生产环境有密钥长度、HTTPS CORS、禁synchronize等启动校验；Redis不可用可使ready失败。
- 当前presence迁移未跟踪，已修改CURRENT_SCHEMA_VERSION；必须把迁移、实体、schema常量及回归作为同一发布单元。已有业务改动均未提交/覆盖。
- 当前backup pipeline使用旧版本，不能据其文件存在宣称备份恢复已完成。
- CI有构建、公开注册/成长和并发验收，但本次未访问远程执行状态；远程分支记录是本地缓存，没有fetch。
- 未做公网注册/抽卡测试，以免只读审计向正式库写数据；公网在线版本和长期可用性均无法确认。

## 14. Critical Player Journey

### 单人核心链

```text
部署/启动
  -> 注册/登录
  -> 大厅/新手引导
  -> 抽角色并存档
  -> 选同属性经验本/配置角色
  -> 服务端票据 + Python真实计算
  -> 逐步公开快照/前端4x回放
  -> 权威胜负、经验、金币、进度一次性结算
  -> 返回副本
  -> 升级/穿装备/再次挑战
  -> 重登录恢复
```

代码接线完整，规则/计算本次已跑，历史有HTTP验收；本次没有真实数据库+浏览器完整重跑，因此结论是“具备闭环实现与部分可靠证据”，不是当天整链Verified。

### 多人关键链

```text
两账号登录
  -> accepted好友
  -> 创建/邀请/接受房间 [Implemented/Integrated]
  -> 各自选3+2并准备 [Implemented]
  -> 全队计数/开战按钮 [BROKEN：H01]
  -> 房主调用start [API存在；部分提交风险H07]
  -> 每成员票据/回放 [Implemented；快照一致待测]
  -> 各账号结算一次 [脚本存在；本次真实DB未验]
  -> finished房间
  -> 返回/退出/新局 [BROKEN：H02]
```

五人本房间最多5账号但要求总共5角色；二十人本房间最多4账号、每账号最多5角色。产品文案必须区分“角色数”和“账号人数”。

## 15. Broken / Missing Links

1. 最早的多人断点：全队计数 -> 开战按钮。
2. 最后的多人断点：finished -> 清理成员/恢复大厅 -> 再开局。
3. 开战失败/进程重启 -> 回滚全部成员票据/一致恢复，缺乏完整机制。
4. Boss合法伤害 -> 受保护排名，动态key可绕过；封号 -> 现有会话禁用未接通。
5. 立绘碎片 -> 正式兑换/加载资源，以及邮件奖励 -> 玩家领取未接通。
6. 最新数据库 -> 自动备份恢复验收，以及生产Compose -> 可构建镜像，存在配置断点。
7. 原型团队战报页仍请求Python `/api/battle/team-records`；正式端没有对应承接，路由仍注册，但不能计为正式战报。

## 16. Current Blockers

| Blocker | 阻塞目标 | 性质 |
|---|---|---|
| H01开战门槛循环依赖 | 正常两账号多人游戏首局 | 已复现真实UI契约错误。 |
| H02finished房间不能复玩 | 多人完整闭环与连续回归 | 已复现真实UI契约错误。 |
| H05恢复版本错位 | 最新版本可验证恢复/发布门禁 | 静态版本矛盾确定。 |
| H06Compose上下文错位 | 这两套生产部署方案 | 静态路径矛盾确定；Render不受同一问题影响。 |
| 当前隔离DB/生产模式验收缺失 | 将Implemented提升为Verified/公开发布 | 本次为只读限制而未执行写入测试，不宣称项目永远无法测试。 |

H03/H04是公开发布的Critical安全门禁，不能被高测试通过率覆盖。长期内容、匹配、支付和美术扩充不是解除当前多人阻塞的先决条件。

## 17. Critical Path

```text
A. 修复全队计数 + finished再开局
  -> B. 固定共享快照/开战失败补偿 + 跨账号结算一致
  -> C. 当前schema隔离DB正式迁移
  -> D. 两真实浏览器10局 + 至少3异常场景 + SQL对账
  -> E. 提交包含presence迁移的可复现版本
  -> F. 修复部署/恢复检查，并通过备份恢复
  -> G. 目标部署commit/schema核对 + 公网新账号冒烟
  -> 可接受的在线多人Alpha验收

S. Boss榜鉴权/来源保护 + 已登录封号 + 直接奖励入口治理
  -> 安全回归
  -> 与G共同构成公开测试门禁
```

解除最多玩家链路阻塞的是A并附带真实两局测试；解除公开发布风险需要S和F，不能只修两个按钮后直接上线。

## 18. Key Risks

- 当前“测试多”可能掩盖“测试没有走实际入口/第二局”；所有Ready和API覆盖声明都须绑定运行断言。
- 已签发凭证与匿名排名写入破坏长期运营可信度；不能在真实经济上线后再治理。
- 多人逐账号计算/事务、好友拓扑、锁序和成员状态可能导致分叉、部分发奖或失败；必须使用真实PostgreSQL验证。
- 一进程最多2战斗worker，每成员开战再计算；没有证明高并发房间可用。需先正确再测容量，不凭6账号验收推断负载上限。
- 资源、赛季、奖励、版本和主线内容的阶段范围未冻结；继续新增容易扩大未验证面积。
- 未提交迁移和多套部署模式让“本地可玩”和“远程可恢复”脱节。

## 19. Audit Notes

- Git分支main；HEAD `d163ea6bf4c65656460e43dd1dfd49a8c1410afb`，最近提交2026-09-29。本地只有main与origin/main，均指向该提交；没有查询服务器是否另有分支。
- 最近30提交集中在线迁移、数据库安全、作者技能、玩法回归和多人协作；最近10提交检查了stat。未发现该范围内merge/revert提交，不能据此断言全部历史无此类提交。
- 审计开始即存在10个已修改tracked文件，另有未跟踪技能报告、presence迁移和浏览器脚本。未修改、删除、移动或提交它们。
- 标准构建仅重新生成既有忽略目录dist和构建缓存，没有修改依赖/lockfile。Python使用-B及关闭pytest cache；临时探针未保存脚本或截图。
- 未运行`npm ci/install`、Docker、数据库写入e2e、公开注册验收、备份下载或部署；未读取/输出真实密钥。
- 文档矛盾：README的实现计划未勾选；旧文档称75%；`formal-online-api-coverage.md`称五条Pending，但代码已接线；代码coverage仍称任务周期/助战未完成，而实现和脚本已有对应逻辑。以当前代码与实际运行结果为准。
- 更正前次模块概述：存在多人代码并不意味着多人玩家闭环完成；任务周期和成就并发测试代码已经有，不能再当作“未实现”；发现直接助战发奖函数也不能未经事务检查声称已可刷奖励。
- 审计未覆盖所有函数/随机种子/角色组合，未穷举外层Word设定与代码的一致性。所有无法确认项均留为待验证，不人为填写100%。

## 20. Evidence / References

以下路径相对本报告所在Git根目录；行号指2026-10-08审计时本地工作树。

| ID | Evidence |
|---|---|
| E01 | `README.md`；`web/package.json`；`server-nest/package.json`；`requirements.txt`；`server-nest/src/app.module.ts`。 |
| E02 | `web/src/main.tsx`；`web/src/App.tsx`；`web/src/config.ts`；`web/src/stores/authStore.ts`；`web/src/services/onlineApi.ts`；`web/src/pages/MainMenu.tsx`。 |
| E03 | `server-nest/src/auth/auth.service.ts:39`注册事务、`:90`登录封禁、`:104`请求鉴权、`:129`30天签发；`server-nest/src/admin/admin.service.ts:96`封号。 |
| E04 | `scripts/nest_battle_worker.py`；`src/combat/battle.py`；`src/skills/authored_characters.py`；`src/skills/characters/registry.py`；`data/content/authored-character-skills.json`；`server-nest/scripts/test-battle-worker.mjs`；`tests/test_authored_characters.py`及角色测试文件。 |
| E05 | `server-nest/src/dungeons/dungeons.service.ts:121`开战、`:177`快照、`:193`扫荡；`server-nest/src/battle-settlement/battle-settlement.service.ts:43`结算；`server-nest/src/common/idempotency.service.ts`；`battle-simulation.service.ts`。 |
| E06 | `server-nest/src/multiplayer-rooms/multiplayer-rooms.service.ts:54`current、`:84`create、`:137`accept、`:180`start、`:230`settle、`:249`leave、`:276`presence；`web/src/pages/MultiplayerRoomPage.tsx:916`计数、`:918`开战判定、`:1196`创建、`:1210`离开；`web/src/pages/BattlePage.tsx:604`回放恢复。 |
| E07 | `server-nest/src/online-features/online-features.service.ts:56`任务、`:63`成就、`:136`兑换、`:204`任务、`:255`成就、`:285`Boss、`:346`伤害、`:398`宝箱、`:464`周期；`friends-assist.service.ts:62`发奖、`:96`借角；`friends-assist.controller.ts:64`公开调用；`workshop.service.ts`；`idle.service.ts`；`daily-goals.service.ts`。 |
| E08 | `server-nest/scripts/e2e-rewards.mjs`；`e2e-registration.mjs`；`e2e-multiplayer-assist.mjs`；`e2e-multiplayer-room.mjs`；未跟踪的`e2e-multiplayer-room-browser.mjs`；`e2e-authoritative-battle.mjs`；`e2e-http.mjs`；`e2e-online-loop.mjs`；`web/scripts/test-skill-slots-browser.cjs`。 |
| E09 | `server-nest/src/ranking/ranking.controller.ts:26`无鉴权提交；`ranking.service.ts:6`保护集合、`:15`提交；`guild/guild.controller.ts`及`guild.service.ts:62`贡献；`mail/mail.controller.ts`；`admin/admin.service.ts`。 |
| E10 | `server-nest/src/database/schema-version.ts:1`；`database/run-migrations.ts`；未跟踪的`migrations/1788513000000-MultiplayerRoomPresence.ts`；`database/database-backup.service.ts`；`.github/workflows/database-backup.yml:61`；`server-nest/scripts/verify-restored-backup.sql:46`。 |
| E11 | `server-nest/Dockerfile:3`、`:21`；`deploy/production/docker-compose.prod.yml:32`；`docker-compose.public-api.yml:34`；`deploy/render/Dockerfile`；`render.yaml`；`docker-compose.nest.yml`；`.github/workflows/online-post-deploy.yml`、`deploy-github-pages.yml`；`web/scripts/create-sites-worker.mjs`。 |
| E12 | 历史材料：`docs/character-release-acceptance-2026-09-17.md`；`character-http-acceptance-2026-09-17.json`；`three-step-progress-2026-09-11.md`；`seven-dps-balance-review-2026-09-23.md`；`new-player-journey-2026-09-17.md`。不当作本次运行结果。 |
| E13 | `web/src/pages/CharacterPage.tsx:175`、`:660`正式模式跳过原型；`TeamRecordsPage.tsx`；`src/server/scheduler.py`；`run_server.py`；`src/versions/version.py`；`src/combat/ai_system.py:155`；`src/dungeons/dungeon_battle.py:399`；`src/server/routes.py:5785`、`:6007`；`web/src/services/onlineFeatureCoverage.ts`；`docs/formal-online-api-coverage.md`。 |

本次命令结果、临时内存探针和浏览器契约探针已在本报告记录，不另生成第三份产物。历史关键提交：`3276e20`（2026-09-17角色）、`e936abf`、`a96872b`、`13826f7`、`d163ea6`（2026-09-29在线玩法/助战/房间）。
