@echo off
chcp 65001 >nul
title 环境自动安装

echo ========================================
echo   环境自动安装脚本
echo ========================================
echo.
echo [提示] 此脚本需要管理员权限
echo [提示] 如果失败，请右键"以管理员身份运行"
echo.
pause

REM 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 需要管理员权限
    echo 请右键点击此文件，选择"以管理员身份运行"
    pause
    exit /b 1
)

echo [OK] 检测到管理员权限
echo.

REM 检查 winget
where winget >nul 2>&1
if %errorLevel% neq 0 (
    echo [警告] winget 不可用，将使用手动安装方式
    echo.
    goto :manual
)

echo [OK] winget 可用
echo.

REM 检查 Node.js
node --version >nul 2>&1
if %errorLevel% equ 0 (
    echo [OK] Node.js 已安装
    node --version
) else (
    echo [安装] 正在安装 Node.js LTS...
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if %errorLevel% equ 0 (
        echo [OK] Node.js 安装完成
        echo [提示] 请重启命令行窗口后继续
    ) else (
        echo [错误] Node.js 安装失败
        echo 请手动安装: https://nodejs.org/
    )
)

echo.

REM 检查 PostgreSQL
psql --version >nul 2>&1
if %errorLevel% equ 0 (
    echo [OK] PostgreSQL 已安装
) else (
    echo [安装] 正在安装 PostgreSQL...
    winget install PostgreSQL.PostgreSQL --accept-package-agreements --accept-source-agreements
    if %errorLevel% equ 0 (
        echo [OK] PostgreSQL 安装完成
        echo.
        echo [重要] 安装 PostgreSQL 时请记住设置的密码！
        echo [重要] 安装完成后需要:
        echo   1. 启动 PostgreSQL 服务
        echo   2. 创建数据库: CREATE DATABASE gamedb;
    ) else (
        echo [错误] PostgreSQL 安装失败
        echo 请手动安装: https://www.postgresql.org/download/windows/
    )
)

goto :end

:manual
echo ========================================
echo   手动安装指导
echo ========================================
echo.
echo 1. 安装 Node.js:
echo    - 访问: https://nodejs.org/
echo    - 下载 LTS 版本
echo    - 运行安装程序，勾选"添加到 PATH"
echo.
echo 2. 安装 PostgreSQL:
echo    - 访问: https://www.postgresql.org/download/windows/
echo    - 下载并运行安装程序
echo    - 记住设置的密码
echo    - 安装完成后创建数据库 gamedb
echo.
echo 详细步骤请查看: 安装指导.md
echo.

:end
echo.
echo ========================================
echo   安装完成
echo ========================================
echo.
echo 下一步:
echo 1. 如果安装了 Node.js，请重启命令行窗口
echo 2. 如果安装了 PostgreSQL，请启动服务并创建数据库
echo 3. 运行 'python check_environment.py' 检查环境
echo 4. 双击 '启动游戏.bat' 启动游戏
echo.
pause

