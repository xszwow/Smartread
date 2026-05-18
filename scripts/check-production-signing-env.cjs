const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const checks = [];

checkWindowsProductionSigning();
checkAndroidProductionSigning();
checkIosProductionSigning();

let failed = false;
for (const check of checks) {
  console.log(`[${check.ok ? "ok" : "missing"}] ${check.name}: ${check.detail}`);
  failed ||= !check.ok;
}

if (failed) {
  console.log("Production signing is not ready. Development certificates prove local builds only; they do not satisfy broad low-warning distribution.");
  process.exitCode = 1;
}

function checkWindowsProductionSigning() {
  const certThumbprint = process.env.WINDOWS_SIGNING_CERT_THUMBPRINT || "";
  const certPath = process.env.WINDOWS_SIGNING_CERT_PATH || process.env.CSC_LINK || "";

  if (certThumbprint) {
    const inspected = inspectWindowsCertByThumbprint(certThumbprint);
    if (!inspected.ok) {
      add("Windows production signing", false, inspected.detail);
      return;
    }
    add("Windows production signing", !isDevelopmentWindowsCert(inspected), `cert ${inspected.subject}; issuer ${inspected.issuer}; thumbprint ${inspected.thumbprint}`);
    return;
  }

  if (certPath) {
    const resolved = resolveMaybeRelative(certPath);
    const exists = fs.existsSync(resolved);
    const looksDev = /local|dev|self|test/i.test(path.basename(resolved));
    add(
      "Windows production signing",
      exists && !looksDev,
      exists
        ? `certificate path configured at ${displayPath(resolved)}${looksDev ? " but filename looks development-local" : ""}`
        : `configured certificate file missing: ${displayPath(resolved)}`
    );
    return;
  }

  add("Windows production signing", false, "set WINDOWS_SIGNING_CERT_THUMBPRINT or WINDOWS_SIGNING_CERT_PATH/CSC_LINK for a non-development Authenticode certificate");
}

function checkAndroidProductionSigning() {
  const propertiesPath = path.join(root, "android", "keystore.properties");
  const envKeystore = process.env.ANDROID_KEYSTORE_PATH || process.env.ANDROID_STORE_FILE || "";
  const envProperties = process.env.ANDROID_KEYSTORE_PROPERTIES || "";
  const configured = envKeystore
    ? { storeFile: envKeystore, source: process.env.ANDROID_KEYSTORE_PATH ? "ANDROID_KEYSTORE_PATH" : "ANDROID_STORE_FILE", text: "" }
    : envProperties
      ? readAndroidKeystoreProperties(resolveMaybeRelative(envProperties), "ANDROID_KEYSTORE_PROPERTIES")
    : readAndroidKeystoreProperties(propertiesPath);

  if (!configured.storeFile) {
    add("Android production signing", false, "set ANDROID_KEYSTORE_PATH or android/keystore.properties to a non-development release keystore");
    return;
  }

  const resolved = resolveAndroidStoreFile(configured.storeFile);
  const exists = fs.existsSync(resolved);
  const markerText = `${configured.storeFile} ${configured.text || ""}`;
  const looksDev = /dev|debug|test|sample/i.test(markerText) || /smartread-dev/i.test(markerText);
  add(
    "Android production signing",
    exists && !looksDev,
    exists
      ? `${configured.source} -> ${displayPath(resolved)}${looksDev ? " is development-local" : ""}`
      : `${configured.source} points to missing keystore: ${displayPath(resolved)}`
  );
}

function checkIosProductionSigning() {
  const teamId = process.env.IOS_DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID || "";
  const hasMac = process.platform === "darwin";
  const xcode = hasMac ? spawnSync("xcodebuild", ["-version"], { encoding: "utf8" }) : null;
  const hasXcode = Boolean(xcode && xcode.status === 0);
  const releaseDir = path.join(root, "release", "ios");
  const ipaFiles = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter(name => name.toLowerCase().endsWith(".ipa"))
    : [];

  add(
    "iOS production signing",
    Boolean(teamId && hasMac && hasXcode && ipaFiles.length > 0),
    [
      teamId ? `team=${teamId}` : "missing Apple team id",
      hasMac ? "macOS host" : "not macOS",
      hasXcode ? "Xcode available" : "Xcode unavailable",
      ipaFiles.length ? `signed IPA present: ${ipaFiles.join(", ")}` : "signed IPA missing"
    ].join("; ")
  );
}

function inspectWindowsCertByThumbprint(thumbprint) {
  if (process.platform !== "win32") {
    return { ok: false, detail: "Windows certificate store inspection requires Windows" };
  }
  const clean = thumbprint.replace(/\s+/g, "").toUpperCase();
  const command = [
    `$thumb='${clean.replace(/'/g, "''")}'`,
    "$cert = Get-ChildItem Cert:\\CurrentUser\\My,Cert:\\LocalMachine\\My -CodeSigningCert -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1",
    "if ($cert) { [pscustomobject]@{found=$true;subject=$cert.Subject;issuer=$cert.Issuer;thumbprint=$cert.Thumbprint;hasPrivateKey=$cert.HasPrivateKey;notAfter=$cert.NotAfter.ToString('o')} | ConvertTo-Json -Compress } else { [pscustomobject]@{found=$false} | ConvertTo-Json -Compress }"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
    encoding: "utf8"
  });
  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (!parsed.found) return { ok: false, detail: `certificate thumbprint not found in CurrentUser/LocalMachine My stores: ${clean}` };
    if (!parsed.hasPrivateKey) return { ok: false, detail: `certificate has no private key: ${clean}` };
    return {
      ok: true,
      subject: parsed.subject || "",
      issuer: parsed.issuer || "",
      thumbprint: parsed.thumbprint || clean,
      notAfter: parsed.notAfter || ""
    };
  } catch {
    return { ok: false, detail: result.stdout.trim() || result.stderr.trim() || "failed to inspect Windows certificate" };
  }
}

function isDevelopmentWindowsCert(cert) {
  const text = `${cert.subject} ${cert.issuer}`;
  return cert.subject === cert.issuer || /Local Dev|Development|Self|Test/i.test(text);
}

function readAndroidKeystoreProperties(filePath, source = "android/keystore.properties") {
  if (!fs.existsSync(filePath)) return { storeFile: "", source, text: "" };
  const text = fs.readFileSync(filePath, "utf8");
  return {
    storeFile: text.match(/^storeFile=(.+)$/m)?.[1]?.trim() || "",
    source,
    text
  };
}

function resolveAndroidStoreFile(storeFile) {
  return path.isAbsolute(storeFile)
    ? storeFile
    : path.resolve(path.join(root, "android"), storeFile);
}

function resolveMaybeRelative(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function displayPath(filePath) {
  return filePath.startsWith(root)
    ? path.relative(root, filePath).replace(/\\/g, "/")
    : filePath;
}

function add(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}
