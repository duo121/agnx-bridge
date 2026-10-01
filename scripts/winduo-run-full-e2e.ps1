$ErrorActionPreference = "Stop"
$Repo = "C:\Users\jianduo\Documents\github\agnx-bridge"
$Node = "D:\software\nodejs\node.exe"
$Base = Join-Path $Repo ".winduo-e2e"
$Ext = Join-Path $Base "chrome-mv3"
$Profile = Join-Path $Base "chrome-profile"
$Src = Join-Path $Repo ".output\chrome-mv3"
# ONLY the user's installed Google Chrome
$Chrome = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
$Log = Join-Path $Base "e2e-run.log"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Host $line
}

if (-not (Test-Path $Chrome)) { throw "Google Chrome not found: $Chrome" }

New-Item -ItemType Directory -Force -Path $Base | Out-Null
"" | Set-Content -Path $Log -Encoding UTF8

Get-NetTCPConnection -LocalPort 9334 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $cli = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.Id)).CommandLine
    if ($cli -and ($cli -like "*.winduo-e2e*" -or $cli -like "*remote-debugging-port=9334*")) {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
Start-Sleep -Seconds 2

if (Test-Path $Ext) { Remove-Item -Recurse -Force $Ext }
if (Test-Path $Profile) { try { Remove-Item -Recurse -Force $Profile } catch {} }
New-Item -ItemType Directory -Force -Path $Ext | Out-Null
New-Item -ItemType Directory -Force -Path $Profile | Out-Null
Copy-Item -Path (Join-Path $Src "*") -Destination $Ext -Recurse -Force
Get-ChildItem $Ext -Force -Recurse -Filter "._*" -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
Write-Log "using Google Chrome=$Chrome"
Write-Log "prepared ext=$Ext"

$TaskChrome = "AGNXBridgeChromeE2E"
Unregister-ScheduledTask -TaskName $TaskChrome -Confirm:$false -ErrorAction SilentlyContinue
# Google Chrome: enable CDP extension install API (no alternate browser)
$chromeArgs = "--user-data-dir=$Profile --no-first-run --no-default-browser-check --enable-unsafe-extension-debugging --remote-debugging-port=9334 --remote-allow-origins=* chrome://extensions/"
$Action = New-ScheduledTaskAction -Execute $Chrome -Argument $chromeArgs
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskChrome -Action $Action -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskChrome
Write-Log "Google Chrome launched on interactive desktop"

$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  try {
    $null = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9334/json/version
    Write-Log "cdp ready"
    break
  } catch { Start-Sleep -Milliseconds 400 }
}

$env:Path = "D:\software\nodejs;" + $env:Path
$env:AGNX_BRIDGE_EXT_PATH = $Ext
Set-Location $Repo
& $Node .\scripts\e2e-windows-chrome-cdp.mjs
if ($LASTEXITCODE -ne 0) { throw "e2e failed" }
Write-Log "E2E_PASS"
