# 启动前端服务器
Write-Host "正在启动前端服务器..." -ForegroundColor Green
cd web
$env:NODE_ENV = "development"
npm run dev












