# GitHub Pages 静态试玩发布

这个方案用于实现类似 `https://yyc2644.github.io/toy-night-watch-demo/` 的“点击链接即可游玩”模式。

## 已经准备好的内容

- `web` 前端支持 GitHub Pages 子路径构建。
- 前端路由已改为 `HashRouter`，静态站点刷新页面不会 404。
- `VITE_STATIC_DEMO=true` 时会启用浏览器内静态试玩 API。
- 已新增 GitHub Actions：`.github/workflows/deploy-github-pages.yml`。

## 发布步骤

1. 把 `Gamer` 目录作为 GitHub 仓库上传。
2. 进入 GitHub 仓库页面。
3. 打开 `Settings -> Pages`。
4. `Build and deployment` 选择 `GitHub Actions`。
5. 推送到 `main` 或 `master` 分支，等待 Actions 执行完成。
6. 完成后访问：

```text
https://你的GitHub用户名.github.io/你的仓库名/
```

前端会自动进入静态试玩模式，玩家可以注册/登录试玩，不需要你先买域名。

## 静态试玩和真正网游的区别

静态试玩模式的数据保存在玩家自己的浏览器 `localStorage`，适合让别人点链接体验界面和基础流程。

真正多人在线仍然需要后端服务器，例如你当前的 `server-nest` 加 PostgreSQL/Redis。等你有云服务器后，可以在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions -> Variables` 添加：

```text
VITE_ONLINE_API_URL=https://你的后端域名
VITE_SOCKET_URL=https://你的后端域名
```

然后可以把工作流里的 `VITE_STATIC_DEMO` 改成 `false`，前端就会连接真实后端。

## 本地测试 GitHub Pages 构建

PowerShell：

```powershell
cd web
$env:VITE_STATIC_DEMO="true"
$env:VITE_PUBLIC_BASE="/gamer-demo/"
npm run build:github-pages
npm run preview
```
