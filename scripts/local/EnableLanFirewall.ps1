param([ValidateRange(1,65535)][int]$Port = 60570)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$program = [IO.Path]::GetFullPath((Join-Path $repo 'apps/desktop/build/dev-win-x64/ThinkRail-dev/bin/bun.exe'))
$ruleName = "ThinkRail-Local-LAN-$Port"
$resultFile = Join-Path $repo '.local/lan-firewall-result.json'
try {
    if (!(Test-Path -LiteralPath $program)) { throw 'Build ThinkRail Local first.' }
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        $application = $existing | Get-NetFirewallApplicationFilter
        if ($application.Program -ne $program) { throw 'Existing firewall rule belongs to a different application.' }
        $existing | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private -RemoteAddress LocalSubnet -Protocol TCP -LocalPort $Port -ErrorAction Stop
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName "ThinkRail Local LAN ($Port)" -Program $program -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet -Enabled True -ErrorAction Stop | Out-Null
    }
    $confirmed = Get-NetFirewallRule -Name $ruleName -ErrorAction Stop
    if ($confirmed.Enabled.ToString() -ne 'True' -or $confirmed.Profile.ToString() -ne 'Private') { throw 'Firewall rule verification failed.' }
    $automaticRules = Get-NetFirewallApplicationFilter -Program $program | Get-NetFirewallRule | Where-Object {
        $_.Name -like '* Query User*' -and $_.Action.ToString() -eq 'Allow' -and $_.Enabled.ToString() -eq 'True'
    }
    foreach ($automaticRule in $automaticRules) {
        $automaticRule | Set-NetFirewallRule -Enabled False -ErrorAction Stop
    }
    @{ status='ok'; ruleName=$ruleName; port=$Port; profile='Private'; remoteAddress='LocalSubnet' } | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
    Write-Output "Enabled $ruleName for the private local subnet."
} catch {
    @{ status='error'; error=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
    throw
}
