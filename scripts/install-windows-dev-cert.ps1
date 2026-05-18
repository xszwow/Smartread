#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$certPath = Join-Path $root "certs\SmartReadLocalDevCodeSigning.cer"

if (-not (Test-Path -LiteralPath $certPath)) {
  throw "Missing certificate: $certPath"
}

$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certPath)
$stores = @(
  @{ Name = "Root"; Location = "LocalMachine" },
  @{ Name = "TrustedPublisher"; Location = "LocalMachine" }
)

foreach ($target in $stores) {
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($target.Name, $target.Location)
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  try {
    $exists = @($store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count -gt 0
    if (-not $exists) {
      $store.Add($cert)
      Write-Host "Installed SmartRead development certificate into $($target.Location)\$($target.Name)."
    } else {
      Write-Host "SmartRead development certificate already exists in $($target.Location)\$($target.Name)."
    }
  } finally {
    $store.Close()
  }
}

Write-Host "Done. This trusts the local development certificate on this machine only."
