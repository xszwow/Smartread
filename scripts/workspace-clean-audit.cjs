const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fix = process.argv.includes("--fix");
const keepMobileRuns = Number(process.env.SMARTREAD_KEEP_MOBILE_RUNS || 5);
const actions = [];

const packagedSmoke = path.join(root, "test-artifacts", "packaged-desktop-smoke");
const installedSmoke = path.join(root, "test-artifacts", "installed-desktop-smoke");

if (hasPassingSmoke(packagedSmoke)) {
  markFile("stale packaged smoke failure log", path.join(packagedSmoke, "server-failure.log"));
  markFile("stale packaged smoke missing import screenshot", path.join(packagedSmoke, "missing-import-control.png"));
  markFile("stale packaged smoke failure screenshot", path.join(packagedSmoke, "failure.png"));
}
if (hasPassingSmoke(installedSmoke)) {
  markFile("stale installed smoke failure log", path.join(installedSmoke, "server-failure.log"));
  markFile("stale installed smoke failure screenshot", path.join(installedSmoke, "failure.png"));
}

pruneOldMobileRuns();
markTempDirs();

if (!actions.length) {
  console.log("[ok] No stale SmartRead workspace artifacts found.");
  process.exit(0);
}

for (const action of actions) {
  if (fix) {
    removePath(action.path);
    console.log(`[removed] ${action.reason}: ${formatPath(action.path)}`);
  } else {
    console.log(`[stale] ${action.reason}: ${formatPath(action.path)}`);
  }
}

if (!fix) {
  console.log("[info] Re-run with --fix to remove the stale artifacts listed above.");
  process.exitCode = 1;
}

function hasPassingSmoke(dir) {
  return ["startup.png", "open.png", "server.log"].every(name => fs.existsSync(path.join(dir, name)));
}

function markFile(reason, filePath) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    actions.push({ reason, path: filePath });
  }
}

function markDir(reason, dirPath) {
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    actions.push({ reason, path: dirPath });
  }
}

function pruneOldMobileRuns() {
  const artifactsDir = path.join(root, "test-artifacts");
  if (!fs.existsSync(artifactsDir)) return;
  const runs = fs.readdirSync(artifactsDir, { withFileTypes: true })
    .filter(item => item.isDirectory() && item.name.startsWith("mobile-empty-shelf-"))
    .map(item => {
      const fullPath = path.join(artifactsDir, item.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const run of runs.slice(keepMobileRuns)) {
    markDir(`old mobile e2e run beyond latest ${keepMobileRuns}`, run.fullPath);
  }
}

function markTempDirs() {
  const tempDir = os.tmpdir();
  const allowedNames = new Set(["smartread-dev-data", "smartread-browser-data"]);
  const allowedPrefixes = [
    "smartread-packaged-",
    "smartread-installed-",
    "smartread-packaged-smoke-",
    "smartread-packaged-user-data-",
    "smartread-installed-smoke-",
    "smartread-installed-user-data-"
  ];
  for (const item of fs.readdirSync(tempDir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const matched = allowedNames.has(item.name) || allowedPrefixes.some(prefix => item.name.startsWith(prefix));
    if (!matched) continue;
    markDir("stale SmartRead temp directory", path.join(tempDir, item.name));
  }
}

function removePath(targetPath) {
  const fullPath = path.resolve(targetPath);
  const insideWorkspace = fullPath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`);
  const insideTemp = fullPath.toLowerCase().startsWith(`${os.tmpdir().toLowerCase()}${path.sep}`);
  if (!insideWorkspace && !insideTemp) {
    throw new Error(`Refusing to remove path outside workspace/temp: ${fullPath}`);
  }
  fs.rmSync(fullPath, { recursive: true, force: true });
}

function formatPath(targetPath) {
  const fullPath = path.resolve(targetPath);
  if (fullPath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) {
    return path.relative(root, fullPath);
  }
  return fullPath;
}
