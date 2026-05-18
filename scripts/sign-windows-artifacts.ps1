param(
  [switch]$UnpackedOnly,
  [switch]$InstallerOnly,
  [switch]$Production,
  [string]$CertThumbprint = $env:WINDOWS_SIGNING_CERT_THUMBPRINT,
  [string]$ProductionCertPath = $(if ($env:WINDOWS_SIGNING_CERT_PATH) { $env:WINDOWS_SIGNING_CERT_PATH } else { $env:CSC_LINK }),
  [string]$CertPassword = $(if ($env:WINDOWS_SIGNING_CERT_PASSWORD) { $env:WINDOWS_SIGNING_CERT_PASSWORD } else { $env:CSC_KEY_PASSWORD }),
  [string]$TimestampServer = $(if ($env:WINDOWS_SIGNING_TIMESTAMP_URL) { $env:WINDOWS_SIGNING_TIMESTAMP_URL } else { "http://timestamp.digicert.com" })
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$devCertSubject = "CN=SmartRead Local Dev Code Signing"
$devCertExportPath = Join-Path $root "certs\SmartReadLocalDevCodeSigning.cer"

function Assert-ProductionCertificate {
  param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)

  $identity = "$($Certificate.Subject) $($Certificate.Issuer)"
  if ($Certificate.Subject -eq $Certificate.Issuer -or $identity -match "Local Dev|Development|Self|Test") {
    throw "Refusing to use a development/self-signed certificate for production signing: subject=$($Certificate.Subject); issuer=$($Certificate.Issuer)"
  }
}

function Resolve-ProductionCertificate {
  if ($CertThumbprint) {
    $thumbprint = $CertThumbprint -replace "\s", ""
    $cert = Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $thumbprint -and $_.HasPrivateKey } |
      Sort-Object NotAfter -Descending |
      Select-Object -First 1
    if (-not $cert) {
      throw "Production Windows code-signing certificate not found or has no private key: $thumbprint"
    }
    Assert-ProductionCertificate $cert
    return $cert
  }

  if ($ProductionCertPath) {
    $resolvedCertPath = if ([System.IO.Path]::IsPathRooted($ProductionCertPath)) {
      $ProductionCertPath
    } else {
      Join-Path $root $ProductionCertPath
    }
    if (-not (Test-Path -LiteralPath $resolvedCertPath)) {
      throw "Production Windows code-signing certificate file is missing: $resolvedCertPath"
    }
    if ([System.IO.Path]::GetExtension($resolvedCertPath).ToLowerInvariant() -ne ".pfx") {
      throw "WINDOWS_SIGNING_CERT_PATH/CSC_LINK must point to a .pfx file for production signing, or set WINDOWS_SIGNING_CERT_THUMBPRINT."
    }
    $securePassword = if ($CertPassword) {
      ConvertTo-SecureString $CertPassword -AsPlainText -Force
    } else {
      ConvertTo-SecureString "" -AsPlainText -Force
    }
    $imported = Import-PfxCertificate -FilePath $resolvedCertPath -CertStoreLocation Cert:\CurrentUser\My -Password $securePassword
    if (-not $imported -or -not $imported.HasPrivateKey) {
      throw "Failed to import production Windows code-signing certificate with private key: $resolvedCertPath"
    }
    Assert-ProductionCertificate $imported
    return $imported
  }

  throw "Production signing requires WINDOWS_SIGNING_CERT_THUMBPRINT or WINDOWS_SIGNING_CERT_PATH/CSC_LINK."
}

function Resolve-DevelopmentCertificate {
  New-Item -ItemType Directory -Force -Path (Split-Path $devCertExportPath) | Out-Null

  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Subject -eq $devCertSubject -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if (-not $cert) {
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $devCertSubject `
      -CertStoreLocation Cert:\CurrentUser\My `
      -KeyUsage DigitalSignature `
      -KeyAlgorithm RSA `
      -KeyLength 3072 `
      -HashAlgorithm SHA256 `
      -NotAfter (Get-Date).AddYears(3)
  }

  Export-Certificate -Cert $cert -FilePath $devCertExportPath -Force | Out-Null
  $thumbprint = $cert.Thumbprint
  $trusted = ((Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumbprint } | Measure-Object).Count -gt 0)
  $publisher = ((Get-ChildItem Cert:\CurrentUser\TrustedPublisher -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumbprint } | Measure-Object).Count -gt 0)
  if (-not ($trusted -and $publisher)) {
    Write-Warning "Development certificate is not trusted in CurrentUser Root/TrustedPublisher. Run npm run windows:trust-dev-cert from an elevated shell if Authenticode status is not Valid."
  }

  return $cert
}

if ($UnpackedOnly -and $InstallerOnly) {
  throw "Use only one of -UnpackedOnly or -InstallerOnly"
}

$unpackedExe = Join-Path $root "release\win-unpacked\SmartRead.exe"
$installer = Join-Path $root "release\SmartRead Setup 0.1.0.exe"
$files = if ($UnpackedOnly) {
  @($unpackedExe)
} elseif ($InstallerOnly) {
  @($installer)
} else {
  @($unpackedExe, $installer)
}

$cert = if ($Production) {
  Resolve-ProductionCertificate
} else {
  Resolve-DevelopmentCertificate
}

foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw "Missing Windows artifact: $file"
  }
}

$signArgs = @{
  FilePath = $files
  Certificate = $cert
  HashAlgorithm = "SHA256"
}
if ($Production -and $TimestampServer) {
  $signArgs.TimestampServer = $TimestampServer
}

$results = Set-AuthenticodeSignature @signArgs
$acceptedStatuses = if ($Production) { @("Valid") } else { @("Valid", "UnknownError") }
$failed = $results | Where-Object { $acceptedStatuses -notcontains $_.Status.ToString() }
if ($failed) {
  $failed | Format-List Path,Status,StatusMessage | Out-String | Write-Error
  throw "Windows artifact signing failed"
}

$results | Select-Object Path,Status,@{Name="Thumbprint";Expression={$_.SignerCertificate.Thumbprint}}
