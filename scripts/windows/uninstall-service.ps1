param(
  [string]$WinSWPath = "$PSScriptRoot\LocalAIRemote.exe"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $WinSWPath)) {
  throw "WinSW executable not found at $WinSWPath."
}
& $WinSWPath stop LocalAIRemote 2>$null
& $WinSWPath uninstall LocalAIRemote
Write-Host "LocalAIRemote service removed. Application files and logs were kept."
