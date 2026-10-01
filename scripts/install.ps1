# AGNX Bridge one-shot installer (Windows): native-host + Skill
#
# From repo root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#
# Optional env:
#   $env:AGNX_BRIDGE_SKIP_SKILL = "1"
#   $env:NATIVE_HOST_BROWSER = "chrome"   # chrome|edge|brave|chromium

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Need command: $Name"
  }
}

Require-Command node

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..")
$SkipSkill = if ($env:AGNX_BRIDGE_SKIP_SKILL) { $env:AGNX_BRIDGE_SKIP_SKILL } else { "0" }

if (-not (Test-Path (Join-Path $Root "scripts\install-native-host.mjs"))) {
  throw "Run this script from the agnx-bridge repo root"
}

Write-Host "[info] using local repo: $Root"
Write-Host "[info] installing native-host..."
Push-Location $Root
try {
  & node .\scripts\install-native-host.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "native-host install failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

if ($SkipSkill -ne "1") {
  Write-Host "[info] installing skill..."
  $SkillSrc = Join-Path $Root "skills\agnx-bridge"
  if (-not (Test-Path (Join-Path $SkillSrc "SKILL.md"))) {
    throw "Skill source not found: $SkillSrc"
  }

  $Targets = @(
    (Join-Path $env:USERPROFILE ".cursor\skills\agnx-bridge"),
    (Join-Path $env:USERPROFILE ".claude\skills\agnx-bridge"),
    (Join-Path $env:USERPROFILE ".codex\skills\agnx-bridge")
  )

  foreach ($Dest in $Targets) {
    $Parent = Split-Path -Parent $Dest
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
    if (Test-Path $Dest) {
      Remove-Item -Recurse -Force $Dest
    }
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    Copy-Item -Path (Join-Path $SkillSrc "*") -Destination $Dest -Recurse -Force
    Write-Host "[ok] installed -> $Dest"
  }

  foreach ($Legacy in @("webext-bridge")) {
    foreach ($Base in @(
      (Join-Path $env:USERPROFILE ".cursor\skills"),
      (Join-Path $env:USERPROFILE ".claude\skills"),
      (Join-Path $env:USERPROFILE ".codex\skills")
    )) {
      $LegacyPath = Join-Path $Base $Legacy
      if (Test-Path $LegacyPath) {
        Remove-Item -Recurse -Force $LegacyPath
        Write-Host "[ok] removed legacy skill -> $LegacyPath"
      }
    }
  }
}

Write-Host ""
Write-Host "========== AGNX Bridge install done =========="
Write-Host "Next:"
Write-Host "  1. pnpm build  (or download chrome-mv3 zip from GitHub Releases)"
Write-Host "  2. Chrome -> chrome://extensions -> Developer mode -> Load unpacked"
Write-Host "     folder: .output\chrome-mv3  or extracted chrome-mv3"
Write-Host "  3. Open extension popup -> confirm port 3054 -> Enable bridge"
Write-Host "  4. curl.exe -sS http://localhost:3054/api/agnx-bridge/health"
Write-Host "  5. Use agnx-bridge skill in Cursor / Claude / Codex"
Write-Host "=============================================="
