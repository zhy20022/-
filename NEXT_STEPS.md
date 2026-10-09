# Next Steps

更新：2026-10-09，Asia/Singapore。

## 当前阻塞：隔离 Docker Runner

候选已冻结为 **`137e9c9da330150127144de1dc6c1d690527056c`**；运行代码来自 `72d2ab2`，另包含Docker验收脚本最小修正。干净检出npm ci/构建/类型/lint、Python221/486、Worker、权限/恢复/H03-H05、真实双浏览器3+2两局及socket拒绝后的HTTP回退两局均重新通过；这些是本地直连WS，不是生产WSS。

证据：`C:\Users\12107\Desktop\4\release-evidence\137e9c9\candidate-manifest.json`。Docker预检实际返回`spawnSync docker ENOENT`；两套Compose单独NOT VERIFIED、Runner BLOCKED。无需重复冻结；发现修复问题时创建新commit并重新验证受影响项目，禁止amend候选或混用历史十局。

**唯一首要任务：提供获授权的隔离 Docker Runner，对最终候选完成两套生产 Compose 和真实 TLS/WSS 代理恢复验收。** 本机 Docker/Compose 缺失，现有 Actions 涉及生产数据或公网后置任务，不调用它们作为隔离替代。不要 push 触发生产工作流。

验收脚本仅是部分 Gate：虽已补两套独立状态、失败继续、HTTPS Origin 和新migration检查，仍没有 WSS、容器双浏览器、代理空闲行为、容器备份恢复。Runner 到位后必须补真实执行证据，不把脚本 API `verified` 当成整个 Release Ready。

复核证据：`C:\Users\12107\Desktop\4\release-evidence\137e9c9\deployment-recheck-20261009\result.json`；Runner 交接手册：`deploy/production/ISOLATED_DOCKER_WSS_ACCEPTANCE.md`。静态检查通过不改变 H06 状态。

H06/WSS目前NOT VERIFIED；容量NOT VERIFIED；历史选角不足UNRESOLVED；不存在独立单令牌撤销登记。仅本地监督内部测试，不开放公网/真实经济。

以下为前置验收范围，若hash与最新门禁不同，使用最新门禁的候选hash。

## 唯一首要任务：新候选的 Docker / WSS 恢复验收

**在隔离 Docker runner 中，从 `72d2ab2` 的干净 checkout 出发，验收两套生产 Compose 及 WSS 断线恢复。** 不能拿旧 `afa8a00` 验收后宣称本次 Gateway 已生产通过。本次未 push 或 amend。

为什么优先：房间第一阶段已有实际本地 socket、数据库和双浏览器证据；公网部署仍缺 H06、生产反代/WSS、Redis readiness 和目标数据库版本验证。继续扩展战斗实时流之前应先验证现有通信能安全部署。

涉及入口：`server-nest/scripts/verify-docker-candidate.mjs`、`server-nest/scripts/e2e-room-realtime.mjs`、`server-nest/scripts/e2e-multiplayer-delivery.mjs`、`server-nest/Dockerfile`、两套 `deploy/production/docker-compose.*.yml`、Nginx/Caddy配置、新schema迁移及本次实时源文件；执行条件和代理 overlay 约束见 `deploy/production/ISOLATED_DOCKER_WSS_ACCEPTANCE.md`。只有发现真实部署问题时才作必要最小修复。

完成标准：

1. 已冻结本次源文件/依赖lock/七个迁移/测试/文档于 `72d2ab2`，保护十份无关用户报告；schema 为 `MultiplayerRoomEvents1788514000000`，干净检出可独立构建。
2. 新临时PostgreSQL16/Redis7、测试秘密、新卷；逐套记录 Build/Start/Migration/Readiness/Worker/Content 的实际结果，不连真实玩家库。
3. 真实TLS/WSS反代升级握手成功，正确Origin/token/成员权限；错Origin、过期/封禁令牌被拒绝；不把静态配置正确当作验收。
4. 容器镜像无宿主源码/content掩盖，运行Python/content/迁移；完成注册登录、角色、Worker/结算和数据库对账。
5. 两浏览器3+2两局，断线/reconnect补发或snapshot；拒绝实时连接时HTTP仍可两局。重启API后提交事件可恢复、奖励不重复。记录commit/image/schema及浏览器/SQL证据。
6. 目标数据库下备份、隔离恢复、恢复后启动和schema/event检查；更新状态，H06只有实际证据才PASS。

当前已通过：本地真实双Nest/PostgreSQL/socket鉴权及恢复、双浏览器实时十局、HTTP-only两局、服务端拒绝socket后HTTP回退两局；Python221/486、worker、构建/类型/lint、H03-H05和legacy升级。最终请求隔离补强后另重跑服务端及实时两局，详见 `PROJECT_STATUS.md`。

剩余风险：数据库按连接tail尚无容量/延迟基线；历史选角不足仍未完全定位；npm安装报告35个审计问题未经风险分级；无现有单token撤销登记。没有Docker/WSS证据，不开放公网或真实经济。

本阶段之后再考虑房间查询优化/Redis通知和权威战斗事件同步，不重写战斗引擎，不新增角色/支付/匹配。八属性规范继续保留。

## 历史待办（2026-10-08，旧候选）

## 唯一首要任务：关闭 H06 Docker Gate

**提供可访问的隔离 Docker runner，从 `afa8a00f67aec246a63670e0856d3ca37202eec4` 干净 checkout 分别真实验收两套生产 Compose。**

候选已经冻结，migration、H01-H05、多人回归和必要脚本均已跟踪。最终候选的 Python 221 项/486 子场景、前后端构建/类型、Nest lint、worker、13 步真实核心回归和双账号 3+2 连续十局/20 条独立结算/逐局 SQL 对账已通过。不要重复执行历史“先补未提交候选”的任务。

当前判定：**CONDITIONAL ALPHA，仅开发者监督下的隔离本地合成账号内部测试；不是受控公网 Alpha 许可。** 本机 Docker/Compose 不存在，现有 Actions 和远程配置中未找到可用隔离 runner；H06 为 NOT VERIFIED，而非项目构建 FAIL。候选源码和本地构建可复现，不代表容器部署已复现。

后续验收文档单独提交，不 amend 已验证候选，也不未经授权 push。旧审计计划保留在 Git 历史，不再作为当前待办。

## Runner 验收范围

1. 校验候选 hash、clean checkout、schema `MultiplayerRoomPresence1788513000000`，使用测试秘密、新 PostgreSQL 16/Redis 7、新卷和 loopback 端口。禁止生产库、真实玩家和覆盖本地数据库。
2. 分别执行 `deploy/production/docker-compose.prod.yml` 与 `deploy/production/docker-compose.public-api.yml`：config -> build -> image -> schema -> API -> readiness。
3. 无源码/content 挂载地检查镜像内 Node、Python worker、content、六个 migration；校验运行用户、启动命令及持续运行状态。
4. 容器 HTTP 真正完成注册/登录 -> 获取角色 -> 核心入口 -> worker 战斗 -> 结算，并记录数据库读写、镜像 ID、commit/schema、健康及日志。
5. 各套分别记录 Build/Start/Migration/Readiness/Worker/Content PASS/FAIL。先失败的一套不允许掩盖另一套未测。
6. 补网关启动/配置和受控证书/TLS 验收。没有域名/证书时明确 NOT VERIFIED，不能只 API ready 就宣称整个生产 Compose PASS。
7. 补 PostgreSQL 16 下正式备份/隔离恢复/恢复后启动；本地 PostgreSQL 18.1 结果不能替代目标版本兼容性。
8. 对容器环境至少完成双账号 3+2 两局真实 UI 冒烟；若修改核心业务，重跑安全/恢复/结算及十局 SQL 对账，不复用旧版本结果。

现有入口：

```powershell
# 在干净候选 checkout 的 server-nest 目录执行
$env:E2E_CANDIDATE_COMMIT='afa8a00f67aec246a63670e0856d3ca37202eec4'
node scripts/verify-docker-candidate.mjs
```

此脚本目前**没有真实 Docker 验收**。它设计为随机项目/测试卷/测试秘密、迁移与 Redis/API readiness、无挂载镜像检查和真实业务 HTTP 冒烟。它不启动网关/TLS、不执行容器恢复或容器浏览器多人流程；首套失败会停止，必须保留失败日志并补第二套。不要把脚本存在或语法检查视为门禁通过。

## 关闭标准

- 两套 Compose 各自具有上述实际结果，worker/content 不能由宿主文件掩盖。
- 候选/source/schema/image/数据库版本和逐步日志可追踪，关键回归没有退化。
- 环境故障和项目故障分开记录；真正缺文件或 Dockerfile/context 错误只作最小修复，并冻结新的候选再验证。
- 更新 `PROJECT_STATUS.md` 并重新给出 READY / CONDITIONAL / NOT READY；当前不预先宣布 H06 PASS。

## 保留限制

选角不足仍未完全定位，保留为 **Known Risk / Not Blocking Current Release Gate**。原失败显示房主一名 + 队友两名，online/ready 正常但总数不足；缺少当时完整 selectedIds/请求时序。保留旧失败证据，不能因十局重跑通过就宣布根因已修复，也不能降低测试标准。

当前可测试：隔离合成账号的单人闭环、两账号 SQUAD、榜安全、封禁和本地恢复。当前不能开放：公网/生产、真实经济，以及未验收直接助战、公会贡献、多人 Boss 经济路径；隐藏 UI 不等于服务端安全隔离。

八属性主题/标签规则及两页四视口的浏览器视觉 Contract 已通过，不代表所有旧伤害/Buff/文字完成对比度审核。既有标题/布局缺口作为风险保留，不在本轮大范围改版。

H06 全部通过后再制定受控 Alpha -> 真实用户规模扩大 -> 四账号/二十角色 -> 并发/异常 -> Boss 贡献 -> 容量基线计划，不在本轮自动扩展。暂不新增角色、匹配、支付、聊天、音频或大型活动。

## 当前证据入口

```text
Candidate: afa8a00f67aec246a63670e0856d3ca37202eec4
Schema: MultiplayerRoomPresence1788513000000
Archive: C:\Users\12107\Desktop\4\release-evidence\afa8a00
Core: core\core-regression.json
Multiplayer: core\gamer-multiplayer-delivery\result.json
Security/restore: core\gamer-p0-delivery\result.json
Docker preflight: docker-preflight\result.json / 1-docker.log
Visual contract: visual-contract\result.json
Prior failure: prior-selection-failure\result.json
```

归档含合成测试备份，不是生产玩家数据；交接时复制到受控持久位置。所有本轮测试子进程及自己的 PostgreSQL 55439 已正常停止，复验需重新提供隔离数据库。
