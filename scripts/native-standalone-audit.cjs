const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const checks = [];

const mobileDir = path.join(root, "mobile-www");
const androidPublicDir = path.join(root, "android", "app", "src", "main", "assets", "public");
const iosPublicDir = path.join(root, "ios", "App", "App", "public");

checkCapacitorConfig("Capacitor root config", path.join(root, "capacitor.config.json"));
checkCapacitorConfig("Android embedded Capacitor config", path.join(root, "android", "app", "src", "main", "assets", "capacitor.config.json"));
checkCapacitorConfig("iOS embedded Capacitor config", path.join(root, "ios", "App", "App", "capacitor.config.json"));

checkNativeBackendConfig("mobile-www native config", path.join(mobileDir, "native-config.js"));
checkNativeBackendConfig("Android native config", path.join(androidPublicDir, "native-config.js"));
checkNativeBackendConfig("iOS native config", path.join(iosPublicDir, "native-config.js"));
checkRequiredPublicFile("mobile-www root stylesheet", path.join(mobileDir, "index.css"));
checkRequiredPublicFile("Android root stylesheet", path.join(androidPublicDir, "index.css"));
checkRequiredPublicFile("iOS root stylesheet", path.join(iosPublicDir, "index.css"));
checkRequiredPublicFile("mobile-www native backend bridge", path.join(mobileDir, "js", "native-backend.js"));
checkRequiredPublicFile("Android native backend bridge", path.join(androidPublicDir, "js", "native-backend.js"));
checkAndroidNativeBackendPlugin();

checkIndexBootOrder("mobile-www index native config", path.join(mobileDir, "index.html"));
checkIndexBootOrder("Android index native config", path.join(androidPublicDir, "index.html"));
checkIndexBootOrder("iOS index native config", path.join(iosPublicDir, "index.html"));
checkNativeAPIRebind("Native API client rebind", path.join(root, "js", "api.js"), path.join(root, "js", "native-backend.js"));

comparePublicTree("Android embedded public resources", mobileDir, androidPublicDir);
comparePublicTree("iOS embedded public resources", mobileDir, iosPublicDir);

let failed = false;
for (const check of checks) {
  console.log(`[${check.ok ? "ok" : "fail"}] ${check.name}: ${check.detail}`);
  failed ||= !check.ok;
}
if (failed) process.exitCode = 1;

function checkCapacitorConfig(name, filePath) {
  if (!fs.existsSync(filePath)) {
    add(name, false, `missing: ${path.relative(root, filePath)}`);
    return;
  }
  try {
    const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const hasExternalServer = Boolean(config.server?.url);
    const webDirOk = filePath.endsWith("capacitor.config.json") && path.basename(path.dirname(filePath)) === path.basename(root)
      ? config.webDir === "mobile-www"
      : true;
    add(name, !hasExternalServer && webDirOk, hasExternalServer ? `unexpected server.url=${config.server.url}` : "no external server.url");
  } catch (error) {
    add(name, false, error instanceof Error ? error.message : String(error));
  }
}

function checkNativeBackendConfig(name, filePath) {
  if (!fs.existsSync(filePath)) {
    add(name, false, `missing: ${path.relative(root, filePath)}`);
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  const ok = /apiBaseUrl:\s*[""]/.test(text) && /nativeBackend:\s*true/.test(text) && /standalone:\s*false/.test(text) && /appMode:\s*['"]mobile['"]/.test(text);
  add(name, ok, path.relative(root, filePath));
}

function checkRequiredPublicFile(name, filePath) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  add(name, Boolean(stat && stat.size > 0), stat ? `${path.relative(root, filePath)} (${stat.size} bytes)` : `missing: ${path.relative(root, filePath)}`);
}

function checkAndroidNativeBackendPlugin() {
  const mainActivity = path.join(root, "android", "app", "src", "main", "java", "com", "smartread", "app", "MainActivity.java");
  const plugin = path.join(root, "android", "app", "src", "main", "java", "com", "smartread", "app", "SmartReadBackendPlugin.java");
  const mainText = fs.existsSync(mainActivity) ? fs.readFileSync(mainActivity, "utf8") : "";
  const pluginText = fs.existsSync(plugin) ? fs.readFileSync(plugin, "utf8") : "";
  const methodNames = [
    "searchZlib",
    "startZlibDownload",
    "aiChat",
    "ttsSpeak",
    "ttsStop",
    "recognizeSpeech"
  ];
  const ok = /registerPlugin\(SmartReadBackendPlugin\.class\)/.test(mainText)
    && /@CapacitorPlugin\([\s\S]*name\s*=\s*"SmartReadBackend"/.test(pluginText)
    && methodNames.every((methodName) => new RegExp(`@PluginMethod[\\s\\S]+${methodName}`).test(pluginText));
  add("Android native backend plugin", ok, ok ? "SmartReadBackendPlugin registered with zlib, AI, TTS and speech methods" : "missing plugin registration or methods");
}

function checkIndexBootOrder(name, filePath) {
  if (!fs.existsSync(filePath)) {
    add(name, false, `missing: ${path.relative(root, filePath)}`);
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  const nativeIndex = text.indexOf('src="native-config.js"');
  const apiIndex = text.indexOf('src="js/api.js"');
  add(name, nativeIndex >= 0 && apiIndex > nativeIndex, `native-config index=${nativeIndex}, api index=${apiIndex}`);
}

function checkNativeAPIRebind(name, apiPath, nativePath) {
  if (!fs.existsSync(apiPath) || !fs.existsSync(nativePath)) {
    add(name, false, "missing js/api.js or js/native-backend.js");
    return;
  }
  const apiText = fs.readFileSync(apiPath, "utf8");
  const nativeText = fs.readFileSync(nativePath, "utf8");
  const apiUsesRebindableGlobal = /var\s+SmartReadAPI\s*=\s*window\.SmartReadAPI\s*=/.test(apiText);
  const nativeRebindsIdentifier = /SmartReadAPI\s*=\s*window\.SmartReadAPI/.test(nativeText) && /SmartReadBackend/.test(nativeText);
  add(
    name,
    apiUsesRebindableGlobal && nativeRebindsIdentifier,
    `api global=${apiUsesRebindableGlobal}, native rebind=${nativeRebindsIdentifier}`
  );
}

function comparePublicTree(name, sourceDir, targetDir) {
  if (!fs.existsSync(targetDir)) {
    add(name, false, `missing target: ${path.relative(root, targetDir)}`);
    return;
  }
  const sourceFiles = listFiles(sourceDir);
  const missing = [];
  const mismatched = [];
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    if (!fs.existsSync(targetPath)) {
      missing.push(relativePath);
      continue;
    }
    if (hashFile(sourcePath) !== hashFile(targetPath)) {
      mismatched.push(relativePath);
    }
  }
  const ok = missing.length === 0 && mismatched.length === 0;
  const detail = ok
    ? `${sourceFiles.length} mobile-www files match`
    : `missing=${missing.slice(0, 5).join(",") || "none"} mismatched=${mismatched.slice(0, 5).join(",") || "none"}`;
  add(name, ok, detail);
}

function listFiles(dir) {
  const results = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        results.push(path.relative(dir, fullPath).replace(/\\/g, "/"));
      }
    }
  };
  visit(dir);
  return results.sort();
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function add(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}
