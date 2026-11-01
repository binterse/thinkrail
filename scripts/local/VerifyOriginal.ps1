. "$PSScriptRoot/Common.ps1"
Assert-OriginalStopped
$backup = (Get-Content -LiteralPath (Join-Path $LocalRoot 'latest-backup.txt') -Raw).Trim()
$manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
foreach ($root in $manifest.roots) {
    $current = Get-TreeManifest $root.source
    $expected = ConvertTo-Json -InputObject @($root.files) -Depth 5 -Compress
    if ($expected -cne (ConvertTo-Json -InputObject $current -Depth 5 -Compress)) { throw "Original changed: $($root.name)" }
}
if ((ConvertTo-Json $manifest.integration -Depth 10 -Compress) -cne (ConvertTo-Json (Get-OriginalIntegration) -Depth 10 -Compress)) { throw 'Original shortcuts or uninstall registration changed.' }
Write-Host 'PASS: original installation, ThinkRail data, pi profile, shortcuts and uninstall registration match the backup.'
