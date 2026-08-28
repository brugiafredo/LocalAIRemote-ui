param(
  [string]$ProjectRoot = "C:\Apps\local-ai-remote",
  [string]$WinSWPath = "$PSScriptRoot\LocalAIRemote.exe"
)

$ErrorActionPreference = "Stop"
$serviceId = "LocalAIRemote"
$configPath = Join-Path (Split-Path -Parent $WinSWPath) "LocalAIRemote.xml"
$envPath = Join-Path $ProjectRoot ".env"
$envExamplePath = Join-Path $ProjectRoot ".env.example"

if (Test-Path -LiteralPath $envPath -PathType Leaf) {
  Write-Host "Existing .env preserved at $envPath."
} else {
  if (-not (Test-Path -LiteralPath $envExamplePath -PathType Leaf)) {
    throw "Configuration template not found at $envExamplePath. Restore .env.example before installing the service."
  }

  Copy-Item -LiteralPath $envExamplePath -Destination $envPath
  Write-Host "Created .env from .env.example at $envPath. Review it before starting the service."
}

if (-not (Test-Path $WinSWPath)) {
  throw "WinSW executable not found at $WinSWPath. Download WinSW-x64.exe, rename it to LocalAIRemote.exe, and run this script again."
}
if (-not (Test-Path (Join-Path $ProjectRoot "apps\server\dist\index.js"))) {
  throw "Production build not found. Run npm install and npm run build in $ProjectRoot first."
}

$xml = @"
<service>
  <id>$serviceId</id>
  <name>Local AI Remote</name>
  <description>Private Local AI Remote web interface</description>
  <executable>node</executable>
  <arguments>apps/server/dist/index.js</arguments>
  <workingdirectory>$ProjectRoot</workingdirectory>
  <logpath>$ProjectRoot\logs</logpath>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="none" />
  <startmode>Automatic</startmode>
  <stoptimeout>15 sec</stoptimeout>
</service>
"@

Set-Content -Path $configPath -Value $xml -Encoding UTF8
New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot "logs") | Out-Null
& $WinSWPath stop $serviceId 2>$null
& $WinSWPath uninstall $serviceId 2>$null
& $WinSWPath install $serviceId
& $WinSWPath start $serviceId
Write-Host "LocalAIRemote service installed and started."
