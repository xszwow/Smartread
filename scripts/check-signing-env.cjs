const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const localWindowsCert = path.join(root, "certs", "SmartReadLocalDevCodeSigning.cer");
const androidKeystoreProperties = path.join(root, "android", "keystore.properties");

function hasAndroidKeystoreFromProperties() {
  if (!fs.existsSync(androidKeystoreProperties)) {
    return false;
  }
  const text = fs.readFileSync(androidKeystoreProperties, "utf8");
  const match = text.match(/^storeFile=(.+)$/m);
  if (!match) {
    return false;
  }
  const storeFile = match[1].trim();
  const resolved = path.isAbsolute(storeFile)
    ? storeFile
    : path.resolve(path.join(root, "android"), storeFile);
  return fs.existsSync(resolved);
}

const checks = [
  {
    target: "Windows",
    ok: Boolean(process.env.CSC_LINK || process.env.WINDOWS_SIGNING_CERT_PATH || fs.existsSync(localWindowsCert)),
    detail: "Set CSC_LINK or WINDOWS_SIGNING_CERT_PATH for production, or create a local development signing cert."
  },
  {
    target: "Android",
    ok: Boolean(
      (process.env.ANDROID_KEYSTORE_PATH && fs.existsSync(process.env.ANDROID_KEYSTORE_PATH || "")) ||
      (process.env.ANDROID_STORE_FILE && fs.existsSync(process.env.ANDROID_STORE_FILE || "")) ||
      (process.env.ANDROID_KEYSTORE_PROPERTIES && fs.existsSync(process.env.ANDROID_KEYSTORE_PROPERTIES || "")) ||
      hasAndroidKeystoreFromProperties()
    ),
    detail: "Set ANDROID_KEYSTORE_PATH, ANDROID_STORE_FILE, ANDROID_KEYSTORE_PROPERTIES, or android/keystore.properties before building a release APK/AAB."
  },
  {
    target: "iOS",
    ok: Boolean(process.env.IOS_DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID),
    detail: "Set IOS_DEVELOPMENT_TEAM or APPLE_TEAM_ID and configure Xcode signing/provisioning."
  }
];

let failed = false;
for (const check of checks) {
  if (check.ok) {
    console.log(`[ok] ${check.target} signing environment detected`);
    continue;
  }
  failed = true;
  console.log(`[missing] ${check.target}: ${check.detail}`);
}

if (failed) {
  console.log("Signing support is scaffolded. Local development certs/keystores do not replace production trust from real certificates/accounts.");
  process.exitCode = 1;
}
