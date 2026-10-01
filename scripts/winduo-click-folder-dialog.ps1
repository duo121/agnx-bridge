# Automate the Chrome "Load unpacked" folder picker on the interactive desktop.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

$target = "C:\Users\jianduo\Documents\github\agnx-bridge\.winduo-e2e\chrome-mv3"
Write-Host "Waiting for folder dialog..."

function Find-FolderDialog {
  Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      $_.MainWindowTitle -match "Select|选择|文件夹|Folder|打开|Open|Load|加载|扩展"
    )
  } | Select-Object -First 1
}

$deadline = (Get-Date).AddSeconds(20)
$dlg = $null
while ((Get-Date) -lt $deadline) {
  $dlg = Find-FolderDialog
  if ($dlg) { break }
  Start-Sleep -Milliseconds 300
}

if (-not $dlg) {
  # Fallback: any chrome-owned modal via Enum - just try SendKeys to foreground
  Write-Host "No titled dialog found; sending keys to foreground window"
} else {
  Write-Host ("Found dialog pid=" + $dlg.Id + " title=" + $dlg.MainWindowTitle)
  try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    [FocusWin]::ShowWindow($dlg.MainWindowHandle, 5) | Out-Null
    [FocusWin]::SetForegroundWindow($dlg.MainWindowHandle) | Out-Null
  } catch {}
}

Start-Sleep -Milliseconds 500
# Common Item Dialog: focus address/filename area and paste path
[System.Windows.Forms.SendKeys]::SendWait("%d")
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.Clipboard]::SetText($target)
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 800
# Confirm select folder (Alt+S on English, or Enter again)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("%s")
Write-Host "Sent folder path keys for $target"
