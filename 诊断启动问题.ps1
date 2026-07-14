# 诊断启动问题 - PowerShell 版本
# 编码: UTF-8

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "========================================"
Write-Host "  启动问题诊断工具"
Write-Host "========================================"
Write-Host ""

# 切换到脚本所在目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath
Write-Host "[1] 当前工作目录: $PWD"
Write-Host ""

# 检查必要文件
Write-Host "[2] 检查必要文件..."
if (Test-Path "run_server.py") {
    Write-Host "     [OK] run_server.py 存在"
} else {
    Write-Host "     [X] run_server.py 不存在"
}

if (Test-Path "web\package.json") {
    Write-Host "     [OK] web\package.json 存在"
} else {
    Write-Host "     [X] web\package.json 不存在"
}

if (Test-Path "web\node_modules") {
    Write-Host "     [OK] web\node_modules 存在"
} else {
    Write-Host "     [!] web\node_modules 不存在（需要安装依赖）"
}
Write-Host ""

# 检查 Python
Write-Host "[3] 检查 Python..."
try {
    $pythonVersion = python --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "     [OK] Python 可用: $pythonVersion"
    } else {
        Write-Host "     [X] Python 未在 PATH 中"
        Write-Host "     [提示] 请检查 Python 是否正确安装并添加到 PATH"
    }
} catch {
    Write-Host "     [X] Python 未找到"
    Write-Host "     [提示] 下载地址: https://www.python.org/downloads/"
}
Write-Host ""

# 检查 Node.js
Write-Host "[4] 检查 Node.js..."
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "     [OK] Node.js 可用: $nodeVersion"
    } else {
        Write-Host "     [X] Node.js 未在 PATH 中"
        Write-Host "     [提示] 请检查 Node.js 是否正确安装并添加到 PATH"
    }
} catch {
    Write-Host "     [X] Node.js 未找到"
    Write-Host "     [提示] 下载地址: https://nodejs.org/"
}
Write-Host ""

# 测试 Python 执行
Write-Host "[5] 测试 Python 执行..."
try {
    $pythonPath = python -c "import sys; print(sys.executable)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "     [OK] Python 路径: $pythonPath"
    } else {
        Write-Host "     [X] Python 执行失败"
    }
} catch {
    Write-Host "     [X] Python 执行失败"
}
Write-Host ""

# 测试 npm
Write-Host "[6] 测试 npm..."
if (Test-Path "web") {
    Push-Location web
    try {
        $npmVersion = npm --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "     [OK] npm 可用: $npmVersion"
        } else {
            Write-Host "     [X] npm 不可用"
        }
    } catch {
        Write-Host "     [X] npm 不可用"
    }
    Pop-Location
} else {
    Write-Host "     [X] web 目录不存在"
}
Write-Host ""

# 检查 Python 依赖
Write-Host "[7] 检查 Python 依赖..."
try {
    python -c "import flask" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "     [OK] Flask 已安装"
    } else {
        Write-Host "     [X] Flask 未安装"
        Write-Host "     [提示] 请运行: pip install -r requirements.txt"
    }
} catch {
    Write-Host "     [X] 无法检查 Flask"
}
Write-Host ""

Write-Host "========================================"
Write-Host "  诊断完成"
Write-Host "========================================"
Write-Host ""
Write-Host "如果看到 [X] 标记，请解决相应问题后重试"
Write-Host ""
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")








