. "$PSScriptRoot/Common.ps1"
$bundle = Join-Path $RepoRoot 'apps/desktop/build/dev-win-x64/ThinkRail-dev'
if (@(Get-Process -Name bun,launcher -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($bundle + '\', [StringComparison]::OrdinalIgnoreCase) }).Count) {
    throw 'Close ThinkRail Local before rebuilding.'
}
New-Item -ItemType Directory -Path (Split-Path $BunDir) -Force | Out-Null
if (!(Test-Path -LiteralPath $BunExe)) {
    $archive = Join-Path (Split-Path $BunDir) 'bun.zip'
    Invoke-WebRequest 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-windows-x64.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath (Split-Path $BunDir) -Force
}
if ((& $BunExe --version) -ne '1.4.4') { throw 'Expected Bun 1.4.4.' }
$oldPath = $env:PATH
try {
    $env:PATH = "$BunDir;$oldPath"
    Push-Location $RepoRoot
    try {
        & $BunExe install --frozen-lockfile
        if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
        & $BunExe run desktop:build
        if ($LASTEXITCODE) { throw 'Desktop build failed.' }
        Write-LocalJson (Join-Path $LocalRoot 'build.json') ([pscustomobject]@{
            sourceTag = 'v0.3.0'; commit = (& git rev-parse HEAD); bun = '1.4.4'
            builtAt = [DateTimeOffset]::Now.ToString('o'); environment = 'dev'
        })
    } finally { Pop-Location }
} finally { $env:PATH = $oldPath }
