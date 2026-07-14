@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title 灾异志 - 启动问题诊断

echo ========================================
echo   灾异志 - 启动问题诊断工具
echo ========================================
echo.

REM 切换到批处理文件所在目录
cd /d "%~dp0" 2>nul
if errorlevel 1 (
    echo [错误] 无法切换到脚本所在目录
    echo [错误] 当前目录: %CD%
    goto :end
)

echo [1] 当前工作目录: %CD%
echo.

REM 检查必要文件
echo [2] 检查必要文件...
set "FILE_OK=1"
if exist "run_server.py" (
    echo     [OK] run_server.py 存在
) else (
    echo     [X] run_server.py 不存在
    set "FILE_OK=0"
)

if exist "web\package.json" (
    echo     [OK] web\package.json 存在
) else (
    echo     [X] web\package.json 不存在
    set "FILE_OK=0"
)

if exist "web\node_modules" (
    echo     [OK] web\node_modules 存在
) else (
    echo     [!] web\node_modules 不存在（需要安装依赖）
)
echo.

REM 检查 Python
echo [3] 检查 Python...
where python >nul 2>&1
if errorlevel 1 (
    echo     [X] Python 未在 PATH 中
    echo     [提示] 请检查 Python 是否正确安装并添加到 PATH
    echo     [提示] 下载地址: https://www.python.org/downloads/
) else (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
    echo     [OK] Python 可用: !PYTHON_VERSION!
)
echo.

REM 检查 Node.js
echo [4] 检查 Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo     [X] Node.js 未在 PATH 中
    echo     [提示] 请检查 Node.js 是否正确安装并添加到 PATH
    echo     [提示] 下载地址: https://nodejs.org/
) else (
    for /f "tokens=*" %%i in ('node --version 2^>^&1') do set NODE_VERSION=%%i
    echo     [OK] Node.js 可用: !NODE_VERSION!
)
echo.

REM 测试 Python 执行
echo [5] 测试 Python 执行...
python -c "import sys; print(sys.executable)" >nul 2>&1
if errorlevel 1 (
    echo     [X] Python 执行失败
    echo     [提示] 可能是 Python 环境配置问题
) else (
    for /f "tokens=*" %%i in ('python -c "import sys; print(sys.executable)" 2^>^&1') do set PYTHON_PATH=%%i
    echo     [OK] Python 路径: !PYTHON_PATH!
)
echo.

REM 测试 npm
echo [6] 测试 npm...
if exist "web" (
    pushd web
    if errorlevel 1 (
        echo     [X] 无法进入 web 目录
    ) else (
        call npm --version >nul 2>&1
        if errorlevel 1 (
            echo     [X] npm 不可用
        ) else (
            for /f "tokens=*" %%i in ('npm --version 2^>^&1') do set NPM_VERSION=%%i
            echo     [OK] npm 可用: !NPM_VERSION!
        )
    )
    popd
) else (
    echo     [X] web 目录不存在
)
echo.

REM 检查 Python 依赖
echo [7] 检查 Python 依赖...
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo     [X] Flask 未安装
    echo     [提示] 请运行: pip install -r requirements.txt
) else (
    echo     [OK] Flask 已安装
)
echo.

echo ========================================
echo   诊断完成
echo ========================================
echo.

:end
echo 如果看到 [X] 标记，请解决相应问题后重试
echo.
echo 按任意键退出...
pause >nul
exit /b 0
