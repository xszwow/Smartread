param()

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeDir = Join-Path $root "tools\node-v24.15.0-win-x64"
$node = Join-Path $nodeDir "node.exe"
$builder = Join-Path $root "node_modules\electron-builder\cli.js"
$tsc = Join-Path $root "node_modules\typescript\bin\tsc"
$signScript = Join-Path $root "scripts\sign-windows-artifacts.ps1"

$env:PATH = "$nodeDir;$env:PATH"
$env:ELECTRON_BUILDER_CACHE = Join-Path $root ".cache\electron-builder"

function Invoke-Checked {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host "[windows-dev-signed] $Label"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

Push-Location $root
try {
  Invoke-Checked "TypeScript build" {
    & $node $tsc -p tsconfig.json
  }

  Invoke-Checked "Build signed payload directory" {
    & $node $builder --win dir --config.win.signAndEditExecutable=false --config.win.forceCodeSigning=false
  }

  Invoke-Checked "Sign unpacked SmartRead.exe" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $signScript -UnpackedOnly
  }

  Invoke-Checked "Build NSIS installer from signed payload" {
    & $node $builder --win nsis --prepackaged (Join-Path $root "release\win-unpacked") --config.win.signAndEditExecutable=false --config.win.forceCodeSigning=false
  }

  Invoke-Checked "Sign NSIS installer" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $signScript -InstallerOnly
  }
} finally {
  Pop-Location
}
