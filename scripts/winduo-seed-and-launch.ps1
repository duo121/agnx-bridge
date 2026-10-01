$ErrorActionPreference = "Stop"

Get-NetTCPConnection -LocalPort 9334 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$Node = "D:\software\nodejs\node.exe"
$Repo = "C:\Users\jianduo\Documents\github\agnx-bridge"
$Src = Join-Path $Repo ".output\chrome-mv3"
$Ext = Join-Path $Repo ".winduo-e2e\chrome-mv3"
$Profile = Join-Path $Repo ".winduo-e2e\chrome-profile"
$Chrome = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"

if (Test-Path $Ext) { Remove-Item -Recurse -Force $Ext }
New-Item -ItemType Directory -Force -Path $Ext | Out-Null
Copy-Item -Path (Join-Path $Src "*") -Destination $Ext -Recurse -Force
Get-ChildItem $Ext -Force -Recurse -Filter "._*" | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
Get-ChildItem $Ext -Force -Recurse -Filter ".DS_Store" | Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $Profile) {
  try { Remove-Item -Recurse -Force $Profile } catch {}
}
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

& $Node (Join-Path $Repo "scripts\seed-chrome-unpacked-extension.mjs") $Profile $Ext "eppdcemdgahndmmnnfhmgpcagpjiclcp"
if ($LASTEXITCODE -ne 0) { throw "seed failed" }

$TaskName = "AGNXBridgeChromeE2E"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$Argument = "--user-data-dir=$Profile --no-first-run --no-default-browser-check --remote-debugging-port=9334 --remote-allow-origins=* chrome://extensions/"
$Action = New-ScheduledTaskAction -Execute $Chrome -Argument $Argument
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "LOOK_AT_DESKTOP seeded unpacked extension and launched Chrome"
Start-Sleep -Seconds 8
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9334/json/version).Content
