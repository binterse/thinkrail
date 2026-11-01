. "$PSScriptRoot/Common.ps1"
if (!(Test-Path -LiteralPath (Join-Path $LocalRoot 'default-profile.json'))) { throw 'Configure the canonical ThinkRail profile first.' }
$shell = New-Object -ComObject WScript.Shell
$destination = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ThinkRail.lnk'
if (Test-Path -LiteralPath $destination) { throw 'ThinkRail shortcut already exists; refusing to overwrite it.' }
$shortcut = $shell.CreateShortcut($destination)
$shortcut.TargetPath = (Get-Command pwsh.exe).Source
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'Start.ps1') + '"'
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.WindowStyle = 7
$shortcut.IconLocation = Join-Path $RepoRoot 'packages/shared/assets/icon.ico'
$shortcut.Description = 'ThinkRail - modified build using the real project folders and canonical profile'
$shortcut.Save()
Write-Host "Created $destination"
