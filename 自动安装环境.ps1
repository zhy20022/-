# 灾异志 - 环境自动安装脚本
# 需要以管理员权限运行

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  环境自动安装脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[错误] 需要管理员权限运行此脚本" -ForegroundColor Red
    Write-Host "请右键点击此文件，选择'以管理员身份运行'" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "[提示] 检测到管理员权限" -ForegroundColor Green
Write-Host ""

# 检查 winget
Write-Host "正在检查 winget..." -ForegroundColor Yellow
try {
    $wingetVersion = winget --version 2>$null
    if ($wingetVersion) {
        Write-Host "[OK] winget 可用: $wingetVersion" -ForegroundColor Green
    }
} catch {
    Write-Host "[警告] winget 不可用，将使用手动安装方式" -ForegroundColor Yellow
    $useWinget = $false
}

Write-Host ""

# 安装 Node.js
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. 安装 Node.js" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否已安装
$nodeInstalled = $false
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "[OK] Node.js 已安装: $nodeVersion" -ForegroundColor Green
        $nodeInstalled = $true
    }
} catch {
    Write-Host "[提示] Node.js 未安装" -ForegroundColor Yellow
}

if (-not $nodeInstalled) {
    Write-Host "正在使用 winget 安装 Node.js LTS..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        Write-Host "[OK] Node.js 安装完成" -ForegroundColor Green
        Write-Host "[提示] 请重启命令行窗口后继续" -ForegroundColor Yellow
    } catch {
        Write-Host "[错误] 自动安装失败" -ForegroundColor Red
        Write-Host ""
        Write-Host "请手动安装 Node.js:" -ForegroundColor Yellow
        Write-Host "1. 访问: https://nodejs.org/" -ForegroundColor White
        Write-Host "2. 下载 LTS 版本" -ForegroundColor White
        Write-Host "3. 运行安装程序，勾选'添加到 PATH'" -ForegroundColor White
    }
}

Write-Host ""

# 安装 PostgreSQL
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "2. 安装 PostgreSQL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否已安装
$pgInstalled = $false
try {
    $pgVersion = psql --version 2>$null
    if ($pgVersion) {
        Write-Host "[OK] PostgreSQL 已安装" -ForegroundColor Green
        $pgInstalled = $true
    }
} catch {
    Write-Host "[提示] PostgreSQL 未安装" -ForegroundColor Yellow
}

if (-not $pgInstalled) {
    Write-Host "正在使用 winget 安装 PostgreSQL..." -ForegroundColor Yellow
    try {
        winget install PostgreSQL.PostgreSQL --accept-package-agreements --accept-source-agreements
        Write-Host "[OK] PostgreSQL 安装完成" -ForegroundColor Green
        Write-Host ""
        Write-Host "[重要] 安装 PostgreSQL 时请记住设置的密码！" -ForegroundColor Yellow
        Write-Host "[重要] 安装完成后需要:" -ForegroundColor Yellow
        Write-Host "  1. 启动 PostgreSQL 服务" -ForegroundColor White
        Write-Host "  2. 创建数据库: CREATE DATABASE gamedb;" -ForegroundColor White
    } catch {
        Write-Host "[错误] 自动安装失败" -ForegroundColor Red
        Write-Host ""
        Write-Host "请手动安装 PostgreSQL:" -ForegroundColor Yellow
        Write-Host "1. 访问: https://www.postgresql.org/download/windows/" -ForegroundColor White
        Write-Host "2. 下载并运行安装程序" -ForegroundColor White
        Write-Host "3. 记住设置的密码（默认用户: postgres）" -ForegroundColor White
        Write-Host "4. 安装完成后创建数据库 gamedb" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安装完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "1. 如果安装了 Node.js，请重启命令行窗口" -ForegroundColor White
Write-Host "2. 如果安装了 PostgreSQL，请启动服务并创建数据库" -ForegroundColor White
Write-Host "3. 运行 'python check_environment.py' 检查环境" -ForegroundColor White
Write-Host "4. 双击 '启动游戏.bat' 启动游戏" -ForegroundColor White
Write-Host ""
pause

