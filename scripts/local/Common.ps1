$ErrorActionPreference = 'Stop'
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$LocalRoot = Join-Path $RepoRoot '.local'
$BunDir = Join-Path $LocalRoot 'toolchain/bun-windows-x64'
$BunExe = Join-Path $BunDir 'bun.exe'
$OriginalInstall = Join-Path $env:LOCALAPPDATA 'ai.thinkrail.app/stable'
$OriginalData = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.thinkrail'

function Assert-OriginalStopped {
    $localBundle = Join-Path $RepoRoot 'apps/desktop/build/dev-win-x64/ThinkRail-dev'
    $running = @(Get-Process -Name bun,launcher -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and ($_.Path.StartsWith($OriginalInstall + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith($localBundle + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))
    })
    if ($running.Count) { throw 'Close every ThinkRail instance normally before backup, verification, or profile migration.' }
}

function Copy-LocalTree([string]$Source, [string]$Destination) {
    if (!(Test-Path -LiteralPath $Source)) { throw "Missing source: $Source" }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    & robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Backup copy failed ($LASTEXITCODE): $Source" }
}

function Get-TreeManifest([string]$Root) {
    ,@(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{
            path = [IO.Path]::GetRelativePath($Root, $_.FullName)
            length = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
}

function Get-OriginalIntegration {
    $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
    $registry = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName -EQ 'ThinkRail' |
        Sort-Object PSPath | Select-Object PSPath,DisplayName,DisplayVersion,InstallLocation,UninstallString,DisplayIcon)
    $folders = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'), (Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar'))
    $shortcuts = @($folders | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Filter '*ThinkRail*.lnk' -Recurse -File | Where-Object Name -NE 'ThinkRail Local.lnk'
    } | Sort-Object FullName -Unique | ForEach-Object {
        [pscustomobject]@{ path = $_.FullName; sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash }
    })
    [pscustomobject]@{ registry = $registry; shortcuts = $shortcuts }
}

function Write-LocalJson([string]$Path, $Value) {
    ConvertTo-Json -InputObject $Value -Depth 100 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
