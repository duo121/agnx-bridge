# Automate Chrome "Load unpacked" folder picker on the interactive desktop.
# Prefer UI Automation; fallback to SendKeys.
$ErrorActionPreference = "Continue"
$target = "C:\Users\jianduo\Documents\github\agnx-bridge\.winduo-e2e\chrome-mv3"
$log = "C:\Users\jianduo\Documents\github\agnx-bridge\.winduo-e2e\folder-dialog.log"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $msg
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"" | Set-Content -Path $log -Encoding UTF8
Write-Log "start target=$target"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DialogNative {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@

function Get-CandidateWindows {
  $list = New-Object System.Collections.Generic.List[object]
  $callback = [DialogNative+EnumProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [DialogNative]::IsWindowVisible($hWnd)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][DialogNative]::GetWindowText($hWnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    $pid = 0
    [void][DialogNative]::GetWindowThreadProcessId($hWnd, [ref]$pid)
    if ($title -and ($title -match "选择|文件夹|Folder|Select|打开|Open|Browse|扩展|Load")) {
      $list.Add([pscustomobject]@{ Handle=$hWnd; Title=$title; Pid=$pid })
    }
    return $true
  }
  [DialogNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $list
}

function Set-FolderWithUia([IntPtr]$handle) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if (-not $root) { return $false }

  $editCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
  Write-Log ("uia edits=" + $edits.Count)
  if ($edits.Count -lt 1) { return $false }

  $edit = $edits.Item($edits.Count - 1)
  $valuePattern = $null
  if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
    $valuePattern.SetValue($target)
    Write-Log "uia SetValue ok"
  } else {
    $edit.SetFocus()
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.Clipboard]::SetText($target)
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Write-Log "uia clipboard paste fallback"
  }

  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 500

  $btnCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
  foreach ($b in $buttons) {
    $name = $b.Current.Name
    if ($name -match "选择|Select|打开|Open|确定|OK") {
      $invoke = $null
      if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
        Write-Log ("uia click button=" + $name)
        $invoke.Invoke()
        return $true
      }
    }
  }
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Write-Log "uia enter fallback"
  return $true
}

$deadline = (Get-Date).AddSeconds(45)
$done = $false
while ((Get-Date) -lt $deadline) {
  $wins = Get-CandidateWindows
  foreach ($w in $wins) {
    Write-Log ("candidate title=" + $w.Title + " pid=" + $w.Pid)
    try {
      [DialogNative]::ShowWindow($w.Handle, 5) | Out-Null
      [DialogNative]::SetForegroundWindow($w.Handle) | Out-Null
      if (Set-FolderWithUia $w.Handle) {
        $done = $true
        break
      }
    } catch {
      Write-Log ("uia error " + $_.Exception.Message)
    }
  }
  if ($done) { break }

  # Broad SendKeys attempt if a chrome-owned dialog may be untitled
  Start-Sleep -Milliseconds 400
}

if (-not $done) {
  Write-Log "no dialog matched; last-chance SendKeys"
  [System.Windows.Forms.SendKeys]::SendWait("%d")
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.Clipboard]::SetText($target)
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

Write-Log ("finish done=" + $done)
