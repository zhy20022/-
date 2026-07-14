@echo off
chcp 65001 >nul 2>&1
title 灾异志 - 环境测试

REM 切换到批处理文件所在目录
cd /d "%~dp0"

echo ========================================
echo   灾异志 - 启动环境测试
echo ========================================
echo.
echo [信息] 当前目录: %CD%
echo.

echo [测试 1] 检查当前目录
echo 当前目录: %CD%
echo.

echo [测试 2] 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo     [失败] Python 不可用
    echo     [提示] 请安装 Python 3.8+ 并添加到 PATH
) else (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo     [成功] Python 可用: %%i
)
echo.

echo [测试 3] 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo     [失败] Node.js 不可用
    echo     [提示] 请安装 Node.js 并添加到 PATH
) else (
    for /f "tokens=*" %%i in ('node --version 2^>^&1') do echo     [成功] Node.js 可用: %%i
)
echo.

echo [测试 4] 检查必要文件
set "FILE_OK=1"
if exist "run_server.py" (
    echo     [成功] run_server.py 存在
) else (
    echo     [失败] run_server.py 不存在
    set "FILE_OK=0"
)
if exist "web\package.json" (
    echo     [成功] web\package.json 存在
) else (
    echo     [失败] web\package.json 不存在
    set "FILE_OK=0"
)
if exist "web\node_modules" (
    echo     [成功] web\node_modules 存在
) else (
    echo     [提示] web\node_modules 不存在（首次运行需要安装依赖）
)
echo.

echo ========================================
echo   测试完成
echo ========================================
echo.
if %FILE_OK%==0 (
    echo [警告] 部分必要文件缺失，请检查游戏目录完整性
) else (
    echo [OK] 基本环境检查通过
)
echo.
echo 如需更详细的诊断，请运行: 诊断启动问题.bat
echo.
pause


