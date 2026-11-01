. "$PSScriptRoot/Common.ps1"
Assert-OriginalStopped
$agentDir = $env:PI_CODING_AGENT_DIR
$environmentFile = Join-Path $OriginalData 'environment.json'
if (!$agentDir -and (Test-Path -LiteralPath $environmentFile)) {
    $agentDir = (Get-Content -LiteralPath $environmentFile -Raw | ConvertFrom-Json).agentDir
}
if (!$agentDir) { $agentDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.pi/agent' }
if ($agentDir.StartsWith('~')) { $agentDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) $agentDir.Substring(1).TrimStart('/','\') }
$agentDir = [IO.Path]::GetFullPath($agentDir)
$backup = Join-Path $LocalRoot ('backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$roots = @(
    [pscustomobject]@{name='installation';source=$OriginalInstall},
    [pscustomobject]@{name='thinkrail';source=$OriginalData},
    [pscustomobject]@{name='pi-agent';source=$agentDir}
)
$records = @()
$activeProfile = Join-Path $LocalRoot 'default-profile.json'
if (Test-Path -LiteralPath $activeProfile) {
    $desktop = (Get-Content -LiteralPath $activeProfile -Raw | ConvertFrom-Json).desktopDirectory
    if ($desktop -and (Test-Path -LiteralPath $desktop)) {
        $roots += [pscustomobject]@{name='desktop';source=[IO.Path]::GetFullPath($desktop)}
    }
}
foreach ($root in $roots) {
    $links = @(Get-ChildItem -LiteralPath $root.source -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count) { throw "Resolve reparse points before backup: $($root.source)" }
    Write-Host "Backing up $($root.name)..."
    $before = Get-TreeManifest $root.source
    Copy-LocalTree $root.source (Join-Path $backup $root.name)
    $copied = Get-TreeManifest (Join-Path $backup $root.name)
    $after = Get-TreeManifest $root.source
    $expected = ConvertTo-Json -InputObject $before -Depth 5 -Compress
    if ($expected -cne (ConvertTo-Json -InputObject $copied -Depth 5 -Compress) -or $expected -cne (ConvertTo-Json -InputObject $after -Depth 5 -Compress)) {
        throw "Backup validation failed or source changed: $($root.name)"
    }
    $records += [pscustomobject]@{name=$root.name;source=$root.source;files=$before}
}
Assert-OriginalStopped
Write-LocalJson (Join-Path $backup 'manifest.json') ([pscustomobject]@{createdAt=[DateTimeOffset]::Now.ToString('o');roots=$records;integration=(Get-OriginalIntegration)})
Set-Content -LiteralPath (Join-Path $LocalRoot 'latest-backup.txt') -Value $backup -Encoding utf8NoBOM
Write-Host "Verified backup: $backup"
