@echo off
chcp 65001 >nul 2>&1
title 灾异志 - 环境检查

cd /d "%~dp0"

echo ========================================
echo   灾异志 - 环境检查
echo ========================================
echo.

echo [1] 检查 Python...
python --version 2>nul
if errorlevel 1 (
    echo     [X] Python 未安装或未添加到 PATH
    echo     [提示] 请安装 Python 3.8+ 并添加到 PATH
) else (
    echo     [OK] Python 已安装
)
echo.

echo [2] 检查 Node.js...
node --version 2>nul
if errorlevel 1 (
    echo     [X] Node.js 未安装或未添加到 PATH
    echo     [提示] 请安装 Node.js 并添加到 PATH
) else (
    echo     [OK] Node.js 已安装
)
echo.

echo [3] 检查必要文件...
if exist "run_server.py" (
    echo     [OK] run_server.py 存在
) else (
    echo     [X] run_server.py 不存在
)

if exist "web\package.json" (
    echo     [OK] web\package.json 存在
) else (
    echo     [X] web\package.json 不存在
)
echo.

echo [4] 检查前端依赖...
if exist "web\node_modules" (
    echo     [OK] 前端依赖已安装
) else (
    echo     [!] 前端依赖未安装（首次运行会自动安装）
)
echo.

echo [5] 检查端口占用...
netstat -ano | findstr ":5000" >nul 2>&1
if errorlevel 1 (
    echo     [OK] 端口 5000 可用
) else (
    echo     [!] 端口 5000 已被占用（后端可能正在运行）
)

netstat -ano | findstr ":3000" >nul 2>&1
if errorlevel 1 (
    echo     [OK] 端口 3000 可用
) else (
    echo     [!] 端口 3000 已被占用（前端可能正在运行）
)
echo.

echo ========================================
echo   检查完成
echo ========================================
echo.
pause




