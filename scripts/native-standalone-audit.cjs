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

checkStandaloneConfig("mobile-www native config", path.join(mobileDir, "native-config.js"));
checkStandaloneConfig("Android native config", path.join(androidPublicDir, "native-config.js"));
checkStandaloneConfig("iOS native config", path.join(iosPublicDir, "native-config.js"));

checkIndexBootOrder("mobile-www index native config", path.join(mobileDir, "index.html"));
checkIndexBootOrder("Android index native config", path.join(androidPublicDir, "index.html"));
checkIndexBootOrder("iOS index native config", path.join(iosPublicDir, "index.html"));

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

function checkStandaloneConfig(name, filePath) {
  if (!fs.existsSync(filePath)) {
    add(name, false, `missing: ${path.relative(root, filePath)}`);
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  const ok = /apiBaseUrl:\s*[""]/.test(text) && /standalone:\s*true/.test(text) && /appMode:\s*['"]mobile['"]/.test(text);
  add(name, ok, path.relative(root, filePath));
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
