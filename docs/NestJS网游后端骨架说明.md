# NestJS 网游后端骨架说明

当前阶段新增了一个并行后端目录：`server-nest`。

它不会替换现有 Python 原型，而是作为后续网游化迁移的服务端骨架。

## 技术栈

- Node.js + NestJS
- PostgreSQL
- Redis
- TypeORM
- Docker Compose
- 简单运营后台入口

## 本地启动

如果本机安装了 Docker：

```bash
docker compose -f docker-compose.nest.yml up --build
```

API 地址：

```text
http://127.0.0.1:4100/api
```

后台入口：

```text
http://127.0.0.1:4100/api/admin
```

## 手动启动

先准备 PostgreSQL 和 Redis，然后在 `server-nest` 目录执行：

```bash
npm install --registry=https://registry.npmmirror.com
npm run build
npm run start:dev
```

可复制 `server-nest/.env.example` 为 `.env`，修改连接串。

## HTTP/数据库端到端联调

`server-nest` 已提供一键 HTTP e2e 脚本：

```bash
npm run build
npm run e2e:http
```

脚本会验证：

- 游客登录 2 名玩家
- 抽卡、角色档案、战斗结算、背包奖励
- 排行榜提交和查询
- 公会创建、加入、贡献
- 好友申请、接受、助战列表、助战记录
- PostgreSQL 关键表写入计数

默认连接：

```text
E2E_API_BASE=http://127.0.0.1:4100/api
E2E_DATABASE_URL=postgres://gamer:gamer_dev_password@127.0.0.1:55432/gamer_online
```

如果 `4100` 没有正在运行的 API，脚本会自动启动 `dist/main.js` 并在结束后关闭它。若想只测试已有服务，可设置：

```bash
E2E_START_SERVER=false npm run e2e:http
```

PowerShell 写法：

```powershell
$env:E2E_DATABASE_URL='postgres://gamer:gamer_dev_password@127.0.0.1:55432/gamer_online'; npm run e2e:http
```

当前本机没有可用 Redis 时，`/health` 会显示 `redis: unavailable`，但这条异步多人 HTTP/DB 链路不依赖 Redis。

## 已有接口

健康检查：

```text
GET /api/health
```

游客登录：

```text
POST /api/auth/guest
```

示例 body：

```json
{
  "deviceId": "local-dev-device",
  "displayName": "Tester"
}
```

玩家档案：

```text
GET /api/players/:playerId/profile
```

配置读取：

```text
GET /api/configs
GET /api/configs/skills
GET /api/configs/gacha_pools
```

背包：

```text
GET /api/inventory/:playerId
POST /api/inventory/:playerId/grant
POST /api/inventory/:playerId/consume
```

抽卡：

```text
GET /api/gacha/pools
POST /api/gacha/:playerId/draw
```

示例 body：

```json
{
  "poolKey": "starter",
  "count": 10
}
```

战斗结算：

```text
POST /api/battle-settlement
GET /api/battle-settlement/:playerId/records
GET /api/battle-settlement/:playerId/progress
```

示例 body：

```json
{
  "playerId": "player-uuid",
  "dungeonId": "fire_type_single_001",
  "characterIds": ["character-uuid"],
  "success": true,
  "duration": 58.5,
  "damageScore": 12345,
  "rewards": [
    {
      "itemConfigId": "fire_exp_crystal",
      "itemType": "material",
      "quantity": 531
    }
  ]
}
```

异步多人第一版：

```text
GET /api/ranking/:boardKey
GET /api/ranking/:boardKey/player/:playerId
POST /api/ranking/:boardKey/score

POST /api/friends-assist/:playerId/request
POST /api/friends-assist/:playerId/accept
GET /api/friends-assist/:playerId
GET /api/friends-assist/:playerId/assist-roster
POST /api/friends-assist/:playerId/assist
GET /api/friends-assist/:playerId/assist-history

GET /api/guild
POST /api/guild
GET /api/guild/player/:playerId/current
GET /api/guild/:guildId
POST /api/guild/:guildId/join
POST /api/guild/contribute
GET /api/guild/:guildId/contributions
```

示例：提交排行榜分数。

```json
{
  "playerId": "player-uuid",
  "score": 123456,
  "seasonKey": "season-001",
  "metadata": {
    "dungeonId": "fire_type_single_001"
  }
}
```

示例：记录一次好友助战。

```json
{
  "helperPlayerId": "friend-player-uuid",
  "helperCharacterId": "character-uuid",
  "dungeonId": "fire_type_single_001",
  "payload": {
    "battleId": "battle-record-uuid"
  }
}
```

示例：创建公会。

```json
{
  "leaderPlayerId": "player-uuid",
  "name": "测试公会"
}
```

后台：

```text
GET /api/admin
GET /api/admin/dashboard
GET /api/admin/players
GET /api/admin/logs
POST /api/admin/mail
POST /api/admin/users/:userId/ban
```

后台写接口需要请求头：

```text
x-admin-token: dev-admin-token
```

## 当前边界

这一步完成了“网游后端骨架 + 第一批核心玩法承接模块”：

- 账号和玩家建档
- 玩家角色、背包、邮件、配置、后台日志表
- 配置文件读取入口
- 简单运营后台入口
- Docker Compose 开发环境
- 背包发放/消耗
- 抽卡池读取、权重抽取、角色入库、重复转碎片
- 异步战斗结算、奖励入背包、副本进度更新、战斗记录
- 排行榜提交/查询、玩家名次查询
- 好友申请/接受、好友列表、好友角色助战、助战奖励记录
- 公会创建/加入/查询、贡献记录、公会等级成长

还没有迁移：

- 活动热更新
- 支付和平台登录

推荐下一步：把异步战斗结算与 `ranking / friends-assist / guild` 串联起来，让副本伤害自动进榜、助战次数和奖励自动结算、公会贡献从战斗/日常任务自然产出；同时把 Python 原型里的副本奖励规则整理成 `data/content/dungeons.json`、`drops.json`、`level_exp.json`。
