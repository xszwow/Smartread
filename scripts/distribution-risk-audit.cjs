const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const checks = [];

checkWindowsDistributionTrust();
checkAndroidDistributionTrust();
checkIosDistributionTrust();

let failed = false;
for (const check of checks) {
  console.log(`[${check.ok ? "ok" : "risk"}] ${check.name}: ${check.detail}`);
  failed ||= !check.ok;
}

if (failed) {
  console.log("Distribution risk audit failed. Current artifacts are suitable for local/dev verification, not broad low-warning distribution.");
  process.exitCode = 1;
}

function checkWindowsDistributionTrust() {
  const installer = path.join(root, "release", "SmartRead Setup 0.1.0.exe");
  if (!fs.existsSync(installer)) {
    add("Windows public distribution trust", false, "missing Windows installer");
    return;
  }
  if (process.platform !== "win32") {
    add("Windows public distribution trust", false, "Windows Authenticode inspection requires Windows");
    return;
  }
  const escaped = installer.replace(/'/g, "''");
  const command = [
    `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    "$cert=$s.SignerCertificate",
    "[pscustomobject]@{status=$s.Status.ToString();subject=$cert.Subject;issuer=$cert.Issuer;thumbprint=$cert.Thumbprint} | ConvertTo-Json -Compress"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
    encoding: "utf8"
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    add("Windows public distribution trust", false, result.stdout.trim() || result.stderr.trim() || "signature inspection failed");
    return;
  }
  const subject = String(parsed.subject || "");
  const issuer = String(parsed.issuer || "");
  const isLocalDev = /Local Dev|Development|Self/i.test(subject) || subject === issuer;
  const ok = parsed.status === "Valid" && !isLocalDev;
  add(
    "Windows public distribution trust",
    ok,
    ok
      ? `valid non-development signer ${subject}`
      : `current signer is development/self-signed: status=${parsed.status}; subject=${subject}; issuer=${issuer}; thumbprint=${parsed.thumbprint}`
  );
}

function checkAndroidDistributionTrust() {
  const configured = resolveAndroidSigningConfig();
  if (!configured.storeFile) {
    add("Android public distribution trust", false, "missing Android signing config");
    return;
  }
  const isDevKeystore = /dev|debug|test|sample/i.test(configured.markerText) || /smartread-dev/i.test(configured.markerText);
  add(
    "Android public distribution trust",
    !isDevKeystore,
    isDevKeystore
      ? `current keystore is development-local (${configured.storeFile}); use Play App Signing, enterprise signing, or a real release keystore`
      : `release keystore configured from ${configured.source}: ${configured.storeFile}`
  );
}

function resolveAndroidSigningConfig() {
  if (process.env.ANDROID_KEYSTORE_PATH || process.env.ANDROID_STORE_FILE) {
    const storeFile = process.env.ANDROID_KEYSTORE_PATH || process.env.ANDROID_STORE_FILE;
    return {
      source: process.env.ANDROID_KEYSTORE_PATH ? "ANDROID_KEYSTORE_PATH" : "ANDROID_STORE_FILE",
      storeFile,
      markerText: `${storeFile} ${process.env.ANDROID_KEYSTORE_PASSWORD || ""} ${process.env.ANDROID_STORE_PASSWORD || ""} ${process.env.ANDROID_KEY_PASSWORD || ""}`
    };
  }

  const propertiesPath = process.env.ANDROID_KEYSTORE_PROPERTIES
    ? path.resolve(root, process.env.ANDROID_KEYSTORE_PROPERTIES)
    : path.join(root, "android", "keystore.properties");
  if (!fs.existsSync(propertiesPath)) {
    return { source: "missing", storeFile: "", markerText: "" };
  }
  const text = fs.readFileSync(propertiesPath, "utf8");
  const storeFile = text.match(/^storeFile=(.+)$/m)?.[1]?.trim() || "";
  return {
    source: process.env.ANDROID_KEYSTORE_PROPERTIES ? "ANDROID_KEYSTORE_PROPERTIES" : "android/keystore.properties",
    storeFile,
    markerText: `${storeFile} ${text}`
  };
}

function checkIosDistributionTrust() {
  const releaseDir = path.join(root, "release", "ios");
  const ipaFiles = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter(name => name.toLowerCase().endsWith(".ipa"))
    : [];
  const hasTeam = Boolean(process.env.IOS_DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID);
  add(
    "iOS public distribution trust",
    hasTeam && ipaFiles.length > 0,
    hasTeam && ipaFiles.length > 0
      ? `signed IPA present: ${ipaFiles.join(", ")}`
      : "missing signed .ipa and/or Apple Team signing environment; build on macOS with Xcode and Apple Developer provisioning"
  );
}

function add(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}
