@echo off
chcp 65001 >nul 2>&1
title 灾异志 - 游戏运行状态诊断

echo ========================================
echo   灾异志 - 游戏问题快速诊断
echo ========================================
echo.

echo [1] 检查后端服务器 (端口 5000)...
netstat -ano | findstr ":5000" >nul
if %errorlevel% == 0 (
    echo     [OK] 后端服务器正在运行
) else (
    echo     [错误] 后端服务器未运行
    echo           请运行: python run_server.py
)
echo.

echo [2] 检查前端服务器 (端口 3000)...
netstat -ano | findstr ":3000" >nul
if %errorlevel% == 0 (
    echo     [OK] 前端服务器正在运行
) else (
    echo     [错误] 前端服务器未运行
    echo           请运行: cd web ^&^& npm run dev
)
echo.

echo [3] 检查数据库服务...
sc query postgresql-x64-* >nul 2>&1
if %errorlevel% == 0 (
    echo     [信息] PostgreSQL服务已安装
    sc query postgresql-x64-* | findstr "RUNNING" >nul
    if %errorlevel% == 0 (
        echo     [OK] PostgreSQL服务正在运行
    ) else (
        echo     [提示] PostgreSQL服务未运行（游戏将使用SQLite）
    )
) else (
    echo     [提示] 未检测到PostgreSQL（游戏将使用SQLite，无需配置）
)
echo.

echo [4] 检查Node.js进程...
tasklist | findstr "node.exe" >nul
if %errorlevel% == 0 (
    echo     [OK] 找到Node.js进程
) else (
    echo     [错误] 未找到Node.js进程
)
echo.

echo [5] 检查Python进程...
tasklist | findstr "python.exe" >nul
if %errorlevel% == 0 (
    echo     [OK] 找到Python进程
) else (
    echo     [错误] 未找到Python进程
)
echo.

echo ========================================
echo   诊断总结
echo ========================================
echo.
echo 如果前端服务器未运行，请执行以下步骤：
echo.
echo 1. 打开新的命令行窗口
echo 2. 执行: cd web
echo 3. 执行: npm run dev
echo 4. 等待看到 "Local: http://localhost:3000/" 的消息
echo 5. 然后在浏览器中访问: http://localhost:3000
echo.
echo 如果后端服务器未运行，请执行：
echo 1. 打开新的命令行窗口
echo 2. 执行: python run_server.py
echo 3. 等待看到 "Running on http://127.0.0.1:5000" 的消息
echo.
echo ========================================
pause





