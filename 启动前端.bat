@echo off
chcp 65001 >nul 2>&1
title 灾异志 - 前端服务器

cd /d "%~dp0\web"

echo ========================================
echo   灾异志 - 前端服务器
echo ========================================
echo.

if not exist "package.json" (
    echo [错误] 找不到 package.json
    echo [提示] 请确保在游戏根目录运行此脚本
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [提示] 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo 前端地址: http://localhost:3000
echo.
echo [提示] 请不要关闭此窗口
echo.

npm run dev

pause
