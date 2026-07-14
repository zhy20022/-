param(
  [string]$BaseUrl = "http://127.0.0.1"
)

$ErrorActionPreference = "Stop"

Write-Host "[check] $BaseUrl"

$home = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 10
if ($home.StatusCode -lt 200 -or $home.StatusCode -ge 400) {
  throw "home page returned status $($home.StatusCode)"
}
Write-Host "[ok] frontend home status $($home.StatusCode)"

try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 10
  Write-Host "[ok] api health:"
  $health | ConvertTo-Json -Depth 6
} catch {
  Write-Host "[warn] /api/health is not available. This is expected for some legacy Python builds."
}

Write-Host "[done] production smoke check finished"
