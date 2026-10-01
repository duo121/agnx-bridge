# 在「已登录的可见桌面」(console session) 打开 Chrome，而不是 SSH 会话里隐形启动。
# powershell -ExecutionPolicy Bypass -File .\scripts\launch-chrome-interactive.ps1

$ErrorActionPreference = "Stop"

$Chrome = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $Chrome)) {
  throw "Chrome not found: $Chrome"
}

$Repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$Ext = Join-Path $Repo ".output\chrome-mv3"
if (-not (Test-Path (Join-Path $Ext "manifest.json"))) {
  throw "Extension build missing: $Ext"
}

$Profile = Join-Path $env:TEMP "agnx-bridge-chrome-e2e-profile"
$TaskName = "AGNXBridgeChromeE2E"
$Port = if ($env:AGNX_BRIDGE_CDP_PORT) { $env:AGNX_BRIDGE_CDP_PORT } else { "9334" }
$UserId = if ($env:USERNAME) { $env:USERNAME } else { "jianduo" }

# 只清掉占用我们临时 profile / CDP 端口的旧任务与残留，不动用户日常 Chrome。
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort ([int]$Port) -ErrorAction SilentlyContinue |
  ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }

if (Test-Path $Profile) {
  Remove-Item -Recurse -Force $Profile
}
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

# Chrome 参数：独立 profile + Load unpacked 等价的 --load-extension + CDP
$Argument = @(
  "--user-data-dir=`"$Profile`"",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-default-apps",
  # Chrome 137+ 默认禁用 --load-extension，需显式打开该开关才能自动化加载未打包扩展
  "--disable-features=DisableLoadExtensionCommandLineSwitch",
  "--remote-debugging-port=$Port",
  "--remote-allow-origins=*",
  "--load-extension=`"$Ext`"",
  "chrome://extensions/"
) -join " "

$Action = New-ScheduledTaskAction -Execute $Chrome -Argument $Argument
$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::FromHours(2))

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Principal $Principal `
  -Settings $Settings `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "OK interactive Chrome launched"
Write-Host "task=$TaskName"
Write-Host "cdp=http://127.0.0.1:$Port"
Write-Host "profile=$Profile"
Write-Host "ext=$Ext"
Write-Host "LOOK_AT_DESKTOP: a Chrome window should appear on the Windows console now"
