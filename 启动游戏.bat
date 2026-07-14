@echo off
chcp 65001 >nul 2>&1
title 灾异志 - 游戏启动器

cd /d "%~dp0"

echo ========================================
echo   灾异志 - 游戏启动
echo ========================================
echo.

echo [步骤1] 检查环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] Python 未安装或未添加到 PATH
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] Node.js 未安装或未添加到 PATH
    pause
    exit /b 1
)
echo [OK] 环境检查通过
echo.

echo [步骤2] 检查文件...
if not exist "run_server.py" (
    echo [错误] 找不到 run_server.py
    pause
    exit /b 1
)
if not exist "web\package.json" (
    echo [错误] 找不到 web\package.json
    pause
    exit /b 1
)
echo [OK] 文件检查通过
echo.

echo [步骤3] 启动后端服务器...
start "后端服务器" cmd /k "cd /d %~dp0 && python run_server.py"
timeout /t 2 /nobreak >nul
echo [OK] 后端服务器已启动
echo.

echo [步骤4] 启动前端服务器...
if not exist "web\node_modules" (
    echo [提示] 首次运行，正在安装前端依赖（需要一些时间）...
    cd web
    call npm install
    if errorlevel 1 (
        echo [错误] 前端依赖安装失败
        pause
        exit /b 1
    )
    cd ..
)
start "前端服务器" cmd /k "cd /d %~dp0\web && npm run dev"
echo [OK] 前端服务器已启动
echo.

echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 后端服务器: http://localhost:5000
echo 前端游戏: http://localhost:3000
echo.
echo 浏览器将在 10 秒后自动打开...
echo.
timeout /t 10 /nobreak >nul
start http://localhost:3000
echo.
echo [提示] 如果浏览器未自动打开，请手动访问: http://localhost:3000
echo [提示] 关闭游戏时，请关闭后端和前端服务器窗口
echo.
pause




