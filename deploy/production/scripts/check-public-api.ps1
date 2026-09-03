param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl
)

$ErrorActionPreference = "Stop"
$base = $ApiUrl.TrimEnd("/")
if (-not $base.StartsWith("https://")) {
  throw "ApiUrl must use HTTPS"
}

$ready = Invoke-RestMethod -Uri "$base/api/health/ready" -TimeoutSec 15
if (-not $ready.ok -or $ready.db -ne "ok" -or $ready.redis -ne "PONG") {
  throw "API is reachable but its database or Redis is not ready"
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$guest = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType "application/json" -Body (@{
  username = "PublicCheck$stamp"
  password = "PublicCheck-$stamp-secret"
} | ConvertTo-Json) -TimeoutSec 15

if (-not $guest.accessToken -or -not $guest.player.id) {
  throw "Guest login did not return an online session"
}

Write-Host "[ok] HTTPS, PostgreSQL, Redis and guest login are ready"
Write-Host "[ok] player: $($guest.player.id)"
