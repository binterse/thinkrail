param([string]$BackupPath, [string]$ProfilePath)
. "$PSScriptRoot/Common.ps1"
$backup = if ($BackupPath) { [IO.Path]::GetFullPath($BackupPath) } else { (Get-Content -LiteralPath (Join-Path $LocalRoot 'latest-backup.txt') -Raw).Trim() }
$manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
$profile = if ($ProfilePath) { [IO.Path]::GetFullPath($ProfilePath) } else { Join-Path $LocalRoot 'profile' }
if (!$profile.StartsWith($LocalRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Profile must be inside the checkout .local directory.' }
if (Test-Path -LiteralPath $profile) { throw 'Profile already exists; it is never overwritten. Keep it or rename it before preparing another.' }
$data = Join-Path $profile 'thinkrail'
$agent = Join-Path $profile 'pi-agent'
$desktop = Join-Path $profile 'desktop'
foreach ($dir in @($data,$agent,$desktop,(Join-Path $profile 'home'),(Join-Path $profile 'roaming'),(Join-Path $profile 'local-appdata'))) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
foreach ($name in @('config.json','themes','locales')) {
    $source = Join-Path $backup "thinkrail/$name"
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $data -Recurse }
}
$configFile = Join-Path $data 'config.json'
$config = if (Test-Path $configFile) { Get-Content $configFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
foreach ($name in @('agentReviewEnabled','reviewAutoFix','subagentsEnabled','jbcentralQuotaEnabled')) {
    $config | Add-Member -NotePropertyName $name -NotePropertyValue $false -Force
}
Write-LocalJson $configFile $config
foreach ($name in @('auth.json','models-store.json','settings.json')) {
    $source = Join-Path $backup "pi-agent/$name"
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $agent }
}
$settingsFile = Join-Path $agent 'settings.json'
if (Test-Path $settingsFile) {
    $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json
    foreach ($name in @('packages','extensions','skills','prompts','themes','trustedDirectories')) { $settings.PSObject.Properties.Remove($name) }
    Write-LocalJson $settingsFile $settings
}
$projects = @(Get-Content (Join-Path $backup 'thinkrail/projects.json') -Raw | ConvertFrom-Json)
$workspaces = @(Get-Content (Join-Path $backup 'thinkrail/workspaces.json') -Raw | ConvertFrom-Json)
$mapping = @{}
function New-SandboxRepo([string]$Path) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    & git -C $Path init -b main --quiet
    if ($LASTEXITCODE) { throw 'Sandbox git init failed.' }
    Set-Content -LiteralPath (Join-Path $Path 'README.md') -Value '# ThinkRail Local sandbox' -Encoding utf8NoBOM
    & git -C $Path add README.md
    & git -C $Path -c user.name='ThinkRail Local' -c user.email='local@localhost' -c core.hooksPath=NUL commit --quiet -m 'Create disposable test project'
    if ($LASTEXITCODE) { throw 'Sandbox git commit failed.' }
}
foreach ($project in $projects) {
    $path = Join-Path $profile "projects/$($project.id)"
    New-SandboxRepo $path
    $mapping[$project.path] = $path
    $project.path = $path
    $project.name = "$($project.name) (test copy)"
    foreach ($name in @('trusted','acknowledgedSkills','disabledSkills','disabledGroups','mcpApprovals','mcpOverrides','mcpToolGrants','closed')) { $project.PSObject.Properties.Remove($name) }
    $project | Add-Member -NotePropertyName piResourceTrust -NotePropertyValue untrusted -Force
}
foreach ($workspace in $workspaces) {
    $oldPath = $workspace.worktreePath
    if (!$mapping.ContainsKey($oldPath)) {
        $mapping[$oldPath] = Join-Path $profile "workspaces/$($workspace.id)"
        New-SandboxRepo $mapping[$oldPath]
    }
    $workspace.worktreePath = $mapping[$oldPath]
    $workspace.branch = 'main'
    $workspace.baseBranch = 'main'
    if ($workspace.kind -ne 'default') { $workspace | Add-Member -NotePropertyName kind -NotePropertyValue external -Force }
    foreach ($name in @('review','diffBase','diffStats','initialTerminalPending','skillOverrides')) { $workspace.PSObject.Properties.Remove($name) }
}
Write-LocalJson (Join-Path $data 'projects.json') $projects
Write-LocalJson (Join-Path $data 'workspaces.json') $workspaces
$sessionCount = 0
$sessionRoot = Join-Path $backup 'pi-agent/sessions'
if (Test-Path -LiteralPath $sessionRoot) {
    foreach ($file in Get-ChildItem -LiteralPath $sessionRoot -Filter '*.jsonl' -Recurse -File) {
        $lines = [IO.File]::ReadAllLines($file.FullName)
        $header = $lines[0] | ConvertFrom-Json
        if ($header.type -ne 'session' -or !$header.cwd) { throw "Unrecognized session header: $($file.Name)" }
        if (!$mapping.ContainsKey($header.cwd)) {
            $mapping[$header.cwd] = Join-Path $profile ('archived/' + [guid]::NewGuid().ToString())
            New-SandboxRepo $mapping[$header.cwd]
        }
        $header.cwd = $mapping[$header.cwd]
        $header.PSObject.Properties.Remove('parentSession')
        $lines[0] = ConvertTo-Json $header -Depth 100 -Compress
        $encoded = '--' + ($header.cwd -replace '^[/\\]', '' -replace '[/\\:]', '-') + '--'
        $destination = Join-Path $agent "sessions/$encoded"
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        [IO.File]::WriteAllLines((Join-Path $destination $file.Name), $lines, [Text.UTF8Encoding]::new($false))
        $sessionCount++
    }
}
Write-LocalJson (Join-Path $profile 'isolation.json') ([pscustomobject]@{
    backup=$backup; projectMapping=$mapping; copiedSessions=$sessionCount
    note='Session headers point to disposable repositories. Original transcripts and all desktop preferences remain unchanged in the backup. No terminal state or MCP configuration was restored.'
})
Write-Host "Prepared isolated profile with $sessionCount copied sessions."
