param(
    [string]$BaseUrl = "http://127.0.0.1:3000",
    [string]$OutputDir = "data/browser-smoke"
)

$ErrorActionPreference = "Stop"

$candidateBrowsers = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

$browser = $candidateBrowsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
    throw "Chrome or Edge was not found."
}

$resolvedOutputDir = (New-Item -ItemType Directory -Force -Path $OutputDir).FullName

$pages = @(
    @{ Name = "home"; Path = "/" },
    @{ Name = "gacha"; Path = "/gacha" },
    @{ Name = "characters"; Path = "/characters" },
    @{ Name = "crafting"; Path = "/crafting" },
    @{ Name = "shop"; Path = "/shop" }
)

foreach ($page in $pages) {
    $url = "$BaseUrl$($page.Path)"
    $file = Join-Path $resolvedOutputDir "$($page.Name).png"
    & $browser --headless=new --disable-gpu --no-sandbox --window-size=1365,900 "--screenshot=$file" $url | Out-Null
    if (-not (Test-Path $file)) {
        throw "Screenshot failed: $url"
    }
    $item = Get-Item $file
    if ($item.Length -le 0) {
        throw "Screenshot is empty: $file"
    }
    Write-Output "$($page.Name) OK -> $file ($($item.Length) bytes)"
}
