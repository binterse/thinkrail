param([string]$ProfilePath, [switch]$TestProfile)
. "$PSScriptRoot/Common.ps1"
if ([bool]$ProfilePath -ne [bool]$TestProfile) { throw 'An isolated test requires both -TestProfile and -ProfilePath. Normal ThinkRail always uses the canonical profile.' }
if ($TestProfile) {
    $profile = [IO.Path]::GetFullPath($ProfilePath)
    if (!$profile.StartsWith($LocalRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test profile must be inside the checkout .local directory.' }
    if (Test-Path -LiteralPath (Join-Path $profile 'retired.json')) { throw 'This test profile is retired. Use the normal ThinkRail shortcut.' }
    if (!(Test-Path -LiteralPath (Join-Path $profile 'isolation.json'))) { throw 'Prepare the explicit test profile first.' }
    $data = Join-Path $profile 'thinkrail'
    $agent = Join-Path $profile 'pi-agent'
    $desktop = Join-Path $profile 'desktop'
} else {
    $configuration = Join-Path $LocalRoot 'default-profile.json'
    if (!(Test-Path -LiteralPath $configuration)) { throw 'Configure the canonical profile before starting normal ThinkRail.' }
    $active = Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
    $data = [IO.Path]::GetFullPath($active.dataDirectory)
    $agent = [IO.Path]::GetFullPath($active.agentDirectory)
    $desktop = [IO.Path]::GetFullPath($active.desktopDirectory)
    $profile = Join-Path $LocalRoot 'active'
    foreach ($registry in @(@('projects.json','path'), @('workspaces.json','worktreePath'))) {
        $records = @(Get-Content -LiteralPath (Join-Path $data $registry[0]) -Raw | ConvertFrom-Json)
        foreach ($record in $records) {
            $directory = [IO.Path]::GetFullPath($record.($registry[1]))
            if ($directory.StartsWith($LocalRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $directory.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing a temporary project/workspace in normal ThinkRail: $directory"
            }
            if (!(Test-Path -LiteralPath $directory -PathType Container)) { throw "Project/workspace folder is missing: $directory" }
        }
    }
}
New-Item -ItemType Directory -Path $profile,$desktop -Force | Out-Null
$bundle = Join-Path $RepoRoot 'apps/desktop/build/dev-win-x64/ThinkRail-dev'
$launcher = Join-Path $bundle 'bin/launcher.exe'
if (!(Test-Path -LiteralPath $launcher)) { throw 'Run Build.ps1 first.' }
$alreadyRunning = @(Get-Process -Name bun,launcher -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($bundle + '\', [StringComparison]::OrdinalIgnoreCase) })
if ($alreadyRunning.Count) { Write-Host 'ThinkRail is already running; no second instance started.'; return }
Assert-OriginalStopped
$metadata = Get-Content -LiteralPath (Join-Path $bundle 'Resources/version.json') -Raw | ConvertFrom-Json
if ($metadata.channel -ne 'dev') { throw 'Refusing to start a non-dev build with production update metadata.' }
$ready = Join-Path $profile 'ready.json'
if (Test-Path -LiteralPath $ready) { Remove-Item -LiteralPath $ready }
$control = Join-Path $profile 'control'
if (Test-Path -LiteralPath $control) { Remove-Item -LiteralPath $control }
$start = [Diagnostics.ProcessStartInfo]::new($launcher)
$start.WorkingDirectory = Join-Path $bundle 'bin'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
foreach ($key in @($start.Environment.Keys | Where-Object { $_ -like 'THINKRAIL_*' -or $_ -eq 'PI_CODING_AGENT_DIR' })) { $start.Environment.Remove($key) | Out-Null }
$start.Environment['THINKRAIL_DATA_DIR'] = $data
$start.Environment['PI_CODING_AGENT_DIR'] = $agent
$start.Environment['THINKRAIL_DESKTOP_USER_DATA'] = $desktop
$start.Environment['THINKRAIL_DESKTOP_READY_FILE'] = $ready
$start.Environment['THINKRAIL_DESKTOP_CONTROL_FILE'] = $control
$start.Environment['THINKRAIL_NO_ANALYTICS'] = '1'
$start.Environment.Remove('ELECTROBUN_CONSOLE') | Out-Null
if (!$TestProfile) {
    $start.Environment['THINKRAIL_DESKTOP_PORT'] = '60570'
}
$networkFile = Join-Path $LocalRoot 'network.json'
if (!$TestProfile -and (Test-Path -LiteralPath $networkFile)) {
    $network = Get-Content -LiteralPath $networkFile -Raw | ConvertFrom-Json
    if ($network.host -notin @('127.0.0.1', '0.0.0.0')) { throw 'Unsupported local-build listen address.' }
    if ($network.port -isnot [long] -and $network.port -isnot [int]) { throw 'Local-build port must be an integer.' }
    if ($network.port -lt 1 -or $network.port -gt 65535) { throw 'Local-build port must be 1-65535.' }
    $start.Environment['THINKRAIL_DESKTOP_HOST'] = [string]$network.host
    $start.Environment['THINKRAIL_DESKTOP_PORT'] = [string]$network.port
}
if ($TestProfile) {
    $start.Environment['HOME'] = Join-Path $profile 'home'
    $start.Environment['USERPROFILE'] = Join-Path $profile 'home'
    $start.Environment['APPDATA'] = Join-Path $profile 'roaming'
    $start.Environment['LOCALAPPDATA'] = Join-Path $profile 'local-appdata'
    foreach ($key in @('SHELL','CODEX_HOME','CLAUDE_CONFIG_DIR','CLAUDE_SECURESTORAGE_CONFIG_DIR','GEMINI_CLI_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','COPILOT_HOME','KIMI_SHARE_DIR','GROK_HOME','GROK_AUTH_PATH')) {
        $start.Environment.Remove($key) | Out-Null
    }
}
$process = [Diagnostics.Process]::Start($start)
Write-Host "Started ThinkRail (launcher PID $($process.Id), data $data)."
