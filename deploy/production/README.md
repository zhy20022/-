# 灾异志线上部署准备包

这个目录用于把游戏部署到一台公网 Linux 服务器，并通过域名访问。

当前提供两种部署模式：

- `docker-compose.playable.yml`：当前可试玩版本，前端连接旧 Python 后端。适合马上给朋友测试。
- `docker-compose.prod.yml`：后续 NestJS 网游后端版本，前端连接 `server-nest`。适合继续迁移成正式网游服务。

## 服务器要求

建议最低配置：

- 2 核 CPU
- 4 GB 内存
- 40 GB 磁盘
- Ubuntu 22.04 / 24.04
- Docker + Docker Compose Plugin

服务器安全组需要开放：

- `80/tcp`
- `443/tcp`

## 域名准备

1. 购买域名。
2. 在 DNS 控制台添加 A 记录，指向服务器公网 IP。
3. 如果服务器在中国大陆，通常需要先完成 ICP 备案后再正式绑定访问。

## 第一次部署当前可试玩版本

在服务器上进入项目根目录：

```bash
cd /opt/Gamer
cd deploy/production
cp .env.production.example .env.production
```

编辑 `.env.production`：

```bash
nano .env.production
```

至少修改：

```text
DOMAIN_NAME=你的域名
ACME_EMAIL=你的邮箱
POSTGRES_PASSWORD=强密码
JWT_SECRET=强随机字符串
ADMIN_TOKEN=强随机字符串
```

启动当前可试玩版本：

```bash
docker compose --env-file .env.production -f docker-compose.playable.yml up -d --build
```

查看状态：

```bash
docker compose --env-file .env.production -f docker-compose.playable.yml ps
docker compose --env-file .env.production -f docker-compose.playable.yml logs -f
```

访问：

```text
http://你的域名
```

## 部署 NestJS 网游后端版本

当 `server-nest` 已经承接完整游戏 API 后，使用：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

当前迁移阶段如果还没有数据库迁移脚本，可以在测试服临时设置：

```text
TYPEORM_SYNCHRONIZE=true
```

正式服建议改回：

```text
TYPEORM_SYNCHRONIZE=false
```

## HTTPS 证书

先确保 HTTP 已经能访问：

```text
http://你的域名
```

申请证书：

```bash
docker compose --env-file .env.production -f docker-compose.playable.yml --profile certbot run --rm certbot
```

如果你部署的是 NestJS 版本，把 compose 文件换成：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml --profile certbot run --rm certbot
```

证书申请成功后，把 TLS 示例替换为 Nginx 模板：

```bash
cp nginx/tls.conf.example nginx/templates/default.conf.template
docker compose --env-file .env.production -f docker-compose.playable.yml up -d --build gateway
```

之后访问：

```text
https://你的域名
```

## 更新版本

拉取或上传新代码后：

```bash
cd /opt/Gamer/deploy/production
docker compose --env-file .env.production -f docker-compose.playable.yml up -d --build
```

## 数据备份

备份 PostgreSQL：

```bash
docker compose --env-file .env.production -f docker-compose.playable.yml exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > gamer_backup.sql
```

恢复时先确认目标库为空，再执行：

```bash
cat gamer_backup.sql | docker compose --env-file .env.production -f docker-compose.playable.yml exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## 快速烟测

Windows PowerShell：

```powershell
.\scripts\check-production.ps1 -BaseUrl "http://你的域名"
```

上线前准备检查：

```powershell
.\scripts\prepare-release.ps1
```

Linux/macOS 可以直接用：

```bash
curl -I http://你的域名
curl http://你的域名/api/health
```

旧 Python 后端不一定提供 `/api/health`，所以这个检查失败不代表页面不能玩；NestJS 后端应返回健康状态。

## 三层闭环验收

当前工程里三层闭环的对应关系：

- 公网部署闭环：本目录的 Compose、Nginx、TLS、env、烟测脚本。
- 服务器权威数据闭环：`server-nest` 的战斗结算从 `data/content/reward_rules.json` 读取奖励规则，不信任客户端传入奖励。
- 挂机收益闭环：`server-nest` 的 `/api/idle/*` 接口按服务器时间计算挂机收益，领取后写入背包和玩家金币。

本地有 PostgreSQL 环境时可以运行：

```bash
cd ../../server-nest
npm run e2e:http
```

这条 e2e 会验证：

- 游客登录
- 抽卡
- 服务器权威战斗奖励
- 挂机开始、预览、领取、历史
- 排行榜
- 公会
- 好友助战
- PostgreSQL 关键表落库

## 当前边界

当前可试玩模式能让别人通过域名访问你的游戏，但它仍然是原型后端，不是完整的服务器权威型网游架构。

后续要成为真正多人长期在线网游，需要继续把以下内容迁移到 `server-nest`：

- 登录与账号体系
- 玩家档案、角色、背包、抽卡
- 战斗创建、战斗结算、奖励发放
- 多人房间、WebSocket 同步、断线重连
- 排行榜、好友、公会、活动
- 管理后台、日志、封号、邮件补偿
- 数据库迁移脚本和正式运维监控
