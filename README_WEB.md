# 灾异志 - Web版本

## 🎮 游戏概述

多人Web游戏，支持实时战斗、角色抽取、副本挑战等功能。

---

## 🚀 快速开始

### 1. 环境要求

- Python 3.8+
- Node.js 16+
- PostgreSQL 12+

### 2. 后端设置

```bash
# 安装Python依赖
pip install -r requirements.txt

# 创建.env文件
cp .env.example .env
# 编辑.env文件，配置数据库连接

# 创建数据库
psql -U postgres
CREATE DATABASE gamedb;

# 启动服务器
python run_server.py
```

服务器将在 `http://localhost:5000` 启动。

### 3. 前端设置

```bash
cd web

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端将在 `http://localhost:3000` 启动。

---

## 📁 项目结构

```
项目根目录/
├── src/
│   ├── database/          # 数据库系统
│   ├── player/            # 玩家系统
│   ├── server/            # Web服务器
│   ├── game/              # 游戏循环
│   ├── rewards/           # 奖励系统
│   ├── dungeons/          # 副本系统
│   ├── combat/            # 战斗系统
│   └── ...
├── web/                   # Web前端
│   ├── src/
│   │   ├── pages/         # 页面组件
│   │   ├── stores/        # 状态管理
│   │   └── ...
│   └── package.json
└── run_server.py          # 启动服务器
```

---

## 🎯 功能列表

### 已完成
- ✅ 玩家注册/登录
- ✅ 角色管理
- ✅ 副本选择
- ✅ 角色抽取
- ✅ 制作系统（框架）
- ✅ 游戏状态管理

### 开发中
- ⚠️ 战斗系统集成
- ⚠️ 完整的制作系统
- ⚠️ 升级系统
- ⚠️ 兑换系统
- ⚠️ 背包系统

---

## 📝 API文档

详细API文档请查看：`docs/Web游戏完整实现总结.md`

---

## 🛠️ 技术栈

### 后端
- Python 3.8+
- Flask (Web框架)
- SQLAlchemy (ORM)
- PostgreSQL (数据库)
- Flask-SocketIO (WebSocket)

### 前端
- React 18
- TypeScript
- Vite (构建工具)
- Zustand (状态管理)
- React Router (路由)
- Axios (HTTP客户端)
- Socket.IO Client (WebSocket客户端)

---

## 📝 开发说明

### 后端开发

1. API接口在 `src/server/routes.py` 中定义
2. 数据模型在 `src/database/models/` 中定义
3. 业务逻辑在对应的模块中实现

### 前端开发

1. 页面组件在 `web/src/pages/` 中
2. 状态管理在 `web/src/stores/` 中
3. 路由配置在 `web/src/App.tsx` 中

---

## ✅ 总结

**当前完成度：约 70%**

核心系统已实现，可以开始测试和优化！

---

**最后更新：** 2024年


