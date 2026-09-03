param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
Set-Location $root

Write-Host "[release] root: $root"

$required = @(
  "deploy\production\.env.production.example",
  "deploy\production\docker-compose.playable.yml",
  "deploy\production\docker-compose.prod.yml",
  "deploy\production\docker-compose.public-api.yml",
  "deploy\production\.env.public-api.example",
  "deploy\production\Caddyfile",
  "deploy\production\scripts\deploy-public-api.sh",
  "deploy\production\scripts\check-public-api.ps1",
  "deploy\production\nginx\Dockerfile",
  "deploy\production\nginx\templates\default.conf.template",
  "deploy\production\python\Dockerfile",
  "deploy\production\postgres\init\001_extensions.sql",
  "server-nest\Dockerfile",
  "web\package.json"
)

foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "missing required deployment file: $path"
  }
  Write-Host "[ok] $path"
}

if (-not $SkipBuild) {
  Write-Host "[build] web"
  Push-Location "web"
  npm run build
  Pop-Location

  Write-Host "[build] server-nest lint/typecheck/build"
  Push-Location "server-nest"
  npm run lint
  npm run typecheck
  npm run build
  Pop-Location
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  Write-Host "[ok] docker found: $($docker.Source)"
  docker compose version
} else {
  Write-Host "[warn] docker is not installed on this machine; run docker compose validation on the server."
}

Write-Host "[done] release preparation checks finished"
