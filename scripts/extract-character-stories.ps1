param([string]$SourceRoot = 'C:\Users\12107\Desktop\4')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$catalogPath = Join-Path $PSScriptRoot '../data/content/characters.json'
$catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding utf8 | ConvertFrom-Json
$stories = [ordered]@{}
foreach ($character in $catalog.characters) {
    $path = Join-Path $SourceRoot $character.source
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing source: $path" }
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $reader = [IO.StreamReader]::new($zip.GetEntry('word/document.xml').Open())
        try { $xml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
        $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
        $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
        $paragraphs = @($xml.SelectNodes('//w:body/w:p', $ns) | ForEach-Object {
            ($_.SelectNodes('.//w:t', $ns) | ForEach-Object InnerText) -join ''
        })
        $start = -1
        for ($i = 0; $i -lt $paragraphs.Count; $i++) {
            if ($paragraphs[$i] -match '^[一二三四五六七八九十\d]+[、.．：:\s]*.*(?:背景故事|角色背景|人物背景)' -or $paragraphs[$i] -match '^(?:背景故事|角色背景|人物背景)[：:\s]*$') {
                $start = $i + 1
                break
            }
        }
        if ($start -lt 0) { Write-Warning "No story heading: $($character.name)"; continue }
        $body = [Collections.Generic.List[string]]::new()
        for ($i = $start; $i -lt $paragraphs.Count; $i++) {
            if ($paragraphs[$i] -match '^[一二三四五六七八九十]+[、.．]\s*' -or $paragraphs[$i] -match '^\d+[、.．]\s*(?:技能|武器|性格|体貌|台词|外观)') { break }
            if ($paragraphs[$i].Trim()) { $body.Add($paragraphs[$i].Trim()) }
        }
        if ($body.Count) { $stories[$character.id] = $body -join "`n`n" }
    } finally { $zip.Dispose() }
}
$output = Join-Path $PSScriptRoot '../data/content/character-stories.json'
[IO.File]::WriteAllText([IO.Path]::GetFullPath($output), ($stories | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output "Extracted $($stories.Count) stories"
