param([ValidateRange(1,65535)][int]$Port = 24242)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$program = [IO.Path]::GetFullPath((Join-Path $repo 'apps/desktop/build/dev-win-x64/ThinkRail-dev/bin/bun.exe'))
$ruleName = "ThinkRail-Local-LAN-$Port"
$localRoot = Join-Path $repo '.local'
$resultFile = Join-Path $localRoot 'lan-firewall-result.json'
try {
    if (!(Test-Path -LiteralPath $program)) { throw 'Build ThinkRail Local first.' }
    New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
    $legacyRule = $null
    if ($Port -ne 60570) {
        $legacyRule = Get-NetFirewallRule -Name 'ThinkRail-Local-LAN-60570' -ErrorAction SilentlyContinue
        if ($legacyRule) {
            $legacyProgram = $legacyRule | Get-NetFirewallApplicationFilter
            $legacyPort = $legacyRule | Get-NetFirewallPortFilter
            $legacyAddress = $legacyRule | Get-NetFirewallAddressFilter
            if ($legacyProgram.Program -ine $program -or $legacyRule.Direction.ToString() -ne 'Inbound' -or
                $legacyRule.Action.ToString() -ne 'Allow' -or $legacyRule.Profile.ToString() -ne 'Private' -or
                $legacyPort.Protocol.ToString() -ne 'TCP' -or $legacyPort.LocalPort.ToString() -ne '60570' -or
                $legacyAddress.RemoteAddress.ToString() -ne 'LocalSubnet') {
                throw 'Existing 60570 rule does not match the retired ThinkRail LAN rule; refusing to change it.'
            }
        }
    }
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        $application = $existing | Get-NetFirewallApplicationFilter
        if ($application.Program -ine $program) { throw 'Existing firewall rule belongs to a different application.' }
        $existing | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private -ErrorAction Stop
        $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port -ErrorAction Stop
        $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet -ErrorAction Stop
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName "ThinkRail Local LAN ($Port)" -Program $program -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet -Enabled True -ErrorAction Stop | Out-Null
    }
    $confirmed = Get-NetFirewallRule -Name $ruleName -ErrorAction Stop
    $confirmedProgram = $confirmed | Get-NetFirewallApplicationFilter
    $confirmedPort = $confirmed | Get-NetFirewallPortFilter
    $confirmedAddress = $confirmed | Get-NetFirewallAddressFilter
    if ($confirmed.Enabled.ToString() -ne 'True' -or $confirmed.Profile.ToString() -ne 'Private' -or
        $confirmed.Direction.ToString() -ne 'Inbound' -or $confirmed.Action.ToString() -ne 'Allow' -or
        $confirmedProgram.Program -ine $program -or $confirmedPort.Protocol.ToString() -ne 'TCP' -or
        $confirmedPort.LocalPort.ToString() -ne [string]$Port -or
        $confirmedAddress.RemoteAddress.ToString() -ne 'LocalSubnet') {
        throw 'Firewall rule verification failed.'
    }
    $automaticRules = Get-NetFirewallApplicationFilter -Program $program | Get-NetFirewallRule | Where-Object {
        $_.Name -like '* Query User*' -and $_.Action.ToString() -eq 'Allow' -and $_.Enabled.ToString() -eq 'True'
    }
    foreach ($automaticRule in $automaticRules) {
        $automaticRule | Set-NetFirewallRule -Enabled False -ErrorAction Stop
    }
    if ($legacyRule) { $legacyRule | Set-NetFirewallRule -Enabled False -ErrorAction Stop }
    @{ status='ok'; ruleName=$ruleName; program=$program; port=$Port; protocol='TCP'; profile='Private'; remoteAddress='LocalSubnet' } | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
    Write-Output "Enabled $ruleName for the private local subnet."
    if ($legacyRule) { Write-Output 'Disabled the exact obsolete ThinkRail 60570 rule for this executable.' }
} catch {
    @{ status='error'; error=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
    throw
}
