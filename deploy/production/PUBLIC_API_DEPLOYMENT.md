# 正式在线 API 公网部署

这套部署将 `server-nest`、PostgreSQL、Redis 和自动 HTTPS 网关作为一个整体运行。公网只开放 80/443，数据库、Redis 和 NestJS 端口不直接暴露。

## 准备条件

- 一台安装了 Docker 与 Docker Compose 的 Linux 云服务器
- 一个解析到该服务器公网 IP 的 API 子域名，例如 `api.example.com`
- 云防火墙放行 TCP 80、TCP 443 和 UDP 443

## 首次部署

在服务器项目目录执行：

```bash
cd deploy/production
cp .env.public-api.example .env.public-api
```

编辑 `.env.public-api`：

- `API_DOMAIN_NAME` 填 API 子域名
- `PUBLIC_WEB_ORIGINS` 保留 Sites 试玩网址，并补充其他允许访问 API 的 HTTPS 前端网址
- 三个密码/令牌字段全部替换为互不相同的强随机值

生成随机值可以使用：

```bash
openssl rand -hex 32
```

确认 DNS 已生效后启动：

```bash
sh scripts/deploy-public-api.sh
```

Caddy 会自动申请和续期 HTTPS 证书。首次启动会先等待 PostgreSQL，再创建当前版本所需的数据表，随后等待 Redis 和 API 就绪。

## 验收

在 Windows 开发机执行：

```powershell
.\scripts\check-public-api.ps1 -ApiUrl "https://api.example.com"
```

脚本会验证 HTTPS、数据库、Redis、注册和密码登录。全部通过后，才应让公开试玩站切换到该 API。

## 让 Sites 试玩站接管正式在线模式

Sites Worker 已支持运行时变量 `GAME_API_ORIGIN`。将它设置为 API 源站，例如：

```text
GAME_API_ORIGIN=https://api.example.com
```

设置后仍使用原来的公开试玩网址。首页会自动进入正式在线模式，浏览器请求先到 Sites，再由 Sites 转发给 NestJS。清空该变量会自动退回静态试玩模式。

GitHub Pages 不具备同样的运行时代理。如果还要让 GitHub Pages 进入在线模式，请在仓库 `Settings -> Secrets and variables -> Actions -> Variables` 中设置：

```text
VITE_ONLINE_API_URL=https://api.example.com
VITE_SOCKET_URL=https://api.example.com
```

然后重新运行 Pages 工作流。

## 日常维护

查看状态：

```bash
docker compose --env-file .env.public-api -f docker-compose.public-api.yml ps
```

查看日志：

```bash
docker compose --env-file .env.public-api -f docker-compose.public-api.yml logs --tail=200 api gateway
```

更新版本：

```bash
git pull
sh scripts/deploy-public-api.sh
```

备份数据库：

```bash
docker compose --env-file .env.public-api -f docker-compose.public-api.yml exec -T postgres pg_dump -U gamer gamer_online > gamer_online.sql
```

`TYPEORM_SYNCHRONIZE` 在生产环境被强制禁止。当前 `schema:init` 只负责安全创建全新的初始库；后续数据库结构变化应继续增加正式迁移版本。
