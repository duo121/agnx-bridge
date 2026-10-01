$ErrorActionPreference = "Continue"

Get-NetTCPConnection -LocalPort 9334 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $cli = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.Id)).CommandLine
    if ($cli -and ($cli -like "*agnx-bridge*" -or $cli -like "*remote-debugging-port=9334*" -or $cli -like "*.winduo-e2e*")) {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
Start-Sleep -Seconds 2

$Repo = "C:\Users\jianduo\Documents\github\agnx-bridge"
$Src = Join-Path $Repo ".output\chrome-mv3"
$Ext = Join-Path $Repo ".winduo-e2e\chrome-mv3"
if (Test-Path $Ext) { Remove-Item -Recurse -Force $Ext }
New-Item -ItemType Directory -Force -Path $Ext | Out-Null
Copy-Item -Path (Join-Path $Src "*") -Destination $Ext -Recurse -Force

$Chrome = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
$Profile = Join-Path $Repo ".winduo-e2e\chrome-profile"
if (Test-Path $Profile) {
  try { Remove-Item -Recurse -Force $Profile } catch {}
}
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

$TaskName = "AGNXBridgeChromeE2E"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# No quotes around load-extension path (path has no spaces).
$Argument = "--user-data-dir=$Profile --no-first-run --no-default-browser-check --disable-default-apps --enable-logging --v=1 --disable-features=DisableLoadExtensionCommandLineSwitch --enable-unsafe-extension-debugging --remote-debugging-port=9334 --remote-allow-origins=* --load-extension=$Ext chrome://extensions/"

Write-Host "ARGS=$Argument"
$Action = New-ScheduledTaskAction -Execute $Chrome -Argument $Argument
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "LOOK_AT_DESKTOP profile=$Profile ext=$Ext"
Start-Sleep -Seconds 7
try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9334/json/version).Content } catch { "CDP_FAIL $($_.Exception.Message)" }

$logCandidates = @(
  (Join-Path $Profile "chrome_debug.log"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\chrome_debug.log")
)
foreach ($log in $logCandidates) {
  if (Test-Path $log) {
    Write-Host "==== $log ===="
    Get-Content $log -Tail 100
  }
}

# List extension dirs in profile
$extRoot = Join-Path $Profile "Default\Extensions"
if (Test-Path $extRoot) {
  Write-Host "==== Extensions dir ===="
  Get-ChildItem $extRoot | Select-Object Name
} else {
  Write-Host "NO Default\Extensions yet"
}
