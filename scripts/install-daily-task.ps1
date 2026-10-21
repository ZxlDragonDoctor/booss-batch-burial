param(
    [string]$BrowserPath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$Time = '09:29',
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$taskName = 'BossHelperDailyBrowser'
if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed $taskName"
    return
}
if (-not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) { throw "Browser not found: $BrowserPath" }
$browser = (Resolve-Path -LiteralPath $BrowserPath).Path
if ([IO.Path]::GetFileName($browser) -notin @('msedge.exe', 'chrome.exe')) { throw 'Select Edge or Chrome.' }
$action = New-ScheduledTaskAction -Execute $browser -Argument '--new-window "https://www.zhipin.com/web/geek/jobs"'
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Open the existing browser for the locally installed BOSS Helper extension. Login and verification remain manual.' -Force | Out-Null
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object TaskName, NextRunTime, LastTaskResult
Write-Output 'Task time uses the Windows local timezone. The extension schedule uses Beijing time.'
