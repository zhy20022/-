# 隔离 Docker / WSS 验收手册

更新：2026-10-09。本文是候选 `137e9c9da330150127144de1dc6c1d690527056c` 的执行手册，不是验收结果。

## 目标与边界

只在临时 Linux Docker Runner 上执行，禁止连接生产数据库、真实玩家数据或生产证书。每次使用新的 Compose project name、PostgreSQL/Redis volume 和测试秘密；端口只绑定到 loopback。建议 Runner 至少提供 8 GB 可用内存，但这不是容量通过标准。

正式目标 Compose：

- `deploy/production/docker-compose.prod.yml`：Nest + PostgreSQL 16 + Redis 7 + Nginx。
- `deploy/production/docker-compose.public-api.yml`：Nest + PostgreSQL 16 + Redis 7 + Caddy。

`docker-compose.playable.yml` 是旧 Python 栈，不属于本 Gate。当前 `server-nest/scripts/verify-docker-candidate.mjs` 只覆盖 API/镜像/Worker/Content 的部分检查，不启动完整 TLS/WSS 网关，也不替代容器双浏览器验收。

## Runner 条件

- Docker Engine 与 Compose v2 可用，且能拉取 `postgres:16-alpine`、`redis:7-alpine`、`node:22-alpine`、网关镜像；网络失败要单独记录为环境故障。
- Git、Node 22、Python 3、Chromium/Chrome 和项目已锁定的 Node 依赖可用。浏览器验收需要两个独立浏览器 context。
- Runner 不得挂载项目宿主的真实数据库目录、用户 home 下的生产配置或长期 Docker volume。
- 候选检出必须 clean，且 `git rev-parse HEAD` 等于 `137e9c9da330150127144de1dc6c1d690527056c`。不从工作树未提交状态构建。

## 两套 Compose 的基础执行

在候选根目录准备仅含合成值的临时环境文件，密码、`AUTH_TOKEN_SECRET`、`ADMIN_TOKEN`、`BACKUP_TOKEN` 均使用随机测试值。不要把该文件提交或上传。每套使用不同的 `COMPOSE_PROJECT_NAME`，并分别保存命令输出、镜像 ID、容器日志和清理结果。

```bash
git rev-parse HEAD
test -z "$(git status --porcelain)"
export E2E_CANDIDATE_COMMIT=137e9c9da330150127144de1dc6c1d690527056c
node server-nest/scripts/verify-docker-candidate.mjs
```

脚本成功也只表示它覆盖的 API/Worker/Content 检查成功。另须对每个 Compose 独立执行 `config --quiet`、`build`、`up`、schema migration、`/api/health/ready`、容器持续运行检查和 `down --volumes --remove-orphans`。必须在没有宿主 `data/content` 挂载的临时容器中检查镜像内的 Python Worker、Content、`dist/main.js` 和 `1788514000000-MultiplayerRoomEvents` migration；Compose 的 content bind mount 不能作为镜像内容证据。

每套都记录：

```text
Build / Start / Migration / Readiness / Worker / Content / HTTP smoke
```

HTTP smoke 使用合成账号完成注册/登录、角色读取、核心入口、一次 Worker 战斗、结算和数据库读写对账。PostgreSQL 目标版本为 16；本地 PostgreSQL 18 的历史结果不能代替此项。

## 隔离 WSS 代理

直接连接 Nest Socket.IO 端口不等于生产 WSS 验收。必须让浏览器访问临时 HTTPS 地址，经网关 Upgrade 到 `api:4100`：

```text
browser -> https://127.0.0.1:<loopback-port> -> Nginx/Caddy -> http://api:4100
```

### Nginx Compose #1

默认 `deploy/production/nginx/templates/default.conf.template` 仅监听 HTTP；不能因为 Compose 发布了 `443` 就认为 TLS 已启用。使用临时 override：

- 将 `deploy/production/nginx/tls.conf.example` 作为网关的临时 `default.conf.template`。
- 提供仅用于 Runner 的测试证书和私钥，挂载到临时 `/etc/letsencrypt/live/<test-domain>/`。
- 将端口绑定到 `127.0.0.1` 的非默认端口，例如 `8443:443` 和 `8080:80`。
- 确认 `/socket.io/` 使用 HTTP/1.1、`Upgrade`、`Connection: upgrade`，并记录长连接、关闭和空闲超时行为。

### Caddy Compose #2

使用临时 Caddyfile 和本地测试 CA（例如 `tls internal`），只绑定 loopback 非默认端口。浏览器必须显式信任该测试 CA；若使用自签证书而未验证浏览器信任链，只能记为部分 WSS 证据，不能称为公网证书验证。保留现有 `/api/*` 与 `/socket.io/*` reverse proxy 路由。

两套都要验证有效 Origin/token、过期或封禁账号、非成员订阅、WebSocket Upgrade、心跳、关闭、代理重连以及授权成员事件隔离。生产域名、正式证书链和公网 DNS 在没有实际执行前标记 `NOT VERIFIED`。

## 容器双浏览器验收

现有 `server-nest/scripts/e2e-multiplayer-delivery.mjs` 会启动本地 Nest/Vite，因此其历史 PASS 不能直接作为容器网关证据。容器 Gate 需要独立浏览器 harness 或真实 UI，运行时 `apiBase`/`socketUrl` 指向 HTTPS 代理地址，而不是 `127.0.0.1:4100`。

必须完成：

1. 两账号进入同一房间，A 选 3 个角色、B 选 2 个角色，准备并开战。
2. 一个浏览器断开 WSS，另一个继续产生房间事件；恢复后收到连续事件或权威快照。
3. 双方结算、数据库记录和余额/经验/进度对账，奖励只发放一次。
4. 返回并开始第二局；实时不可用时再验证 HTTP 回退两局。

不得用 Mock、直接调用 start API、SQL 改状态或手工删客户端存储代替真实 UI 流程。

## 证据与停止条件

每次验收保存候选 hash、schema、Runner 版本、Compose 文件 hash、镜像 ID、容器日志、代理握手/浏览器日志、数据库对账和清理结果到：

```text
release-evidence/137e9c9/<timestamp>/
```

任何一套 Compose 未完成，H06 就不能标记 PASS。Runner 缺失时应记录 `BLOCKED / NOT VERIFIED`，不能把静态 YAML 检查、源码构建、本地直连 WS 或既有回归结果混合成部署通过证据。

## 后续容量基线

H06 关闭后再做容量测试。建议起始矩阵为 20/50/100 WebSocket 连接、10/25/50 房间，记录房间事件尾延迟 p95 <= 1 秒、p99 <= 2 秒、CPU < 70%、内存 < 80%、数据库池等待/错误/重复结算为 0。以上是待确认的建议目标，不是当前测试结果。
