const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const checks = [];

const mobileSummary = readJson(path.join(findLatestArtifact("mobile-empty-shelf-"), "summary.json"));

expect(mobileSummary.baseUrl === "http://127.0.0.1:4173", "Mobile e2e target", mobileSummary.baseUrl);
expect(mobileSummary.previewServerStarted === true || mobileSummary.previewServerStarted === false, "Mobile e2e records preview server mode", String(mobileSummary.previewServerStarted));
expect(Array.isArray(mobileSummary.results) && mobileSummary.results.length === 6, "Mobile e2e scenario count", `${mobileSummary.results?.length || 0} scenarios`);
for (const result of mobileSummary.results || []) {
  expect(result.ok === true, `Mobile e2e scenario ${result.id}`, result.error || "ok");
}

const requiredMobileEvidence = [
  ["01-390x844-guest-empty", "checks.firstScreenClean", "Guest login empty state"],
  ["02-390x844-auth-empty-unbound", "checks.metroHome", "No-book Metro home"],
  ["02-390x844-auth-empty-unbound", "checks.importPage", "Import feature page"],
  ["02-390x844-auth-empty-unbound", "checks.onlinePage", "Online source feature page"],
  ["02-390x844-auth-empty-unbound", "checks.accountPage", "Account/service feature page"],
  ["02-390x844-auth-empty-unbound", "checks.mobileSettings", "AI/settings modal entry"],
  ["02-390x844-auth-empty-unbound", "checks.zlibUnbound", "Z-Library unbound bind UI"],
  ["03-390x844-auth-empty-bound", "checks.zlibBound", "Z-Library bound search UI"],
  ["04-390x844-auth-books-unread", "checks.libraryPage", "Library page for unread books"],
  ["05-390x844-restored-shelf-recent", "checks.continueOpensReader", "Continue reading opens reader"],
  ["06-1280x844-desktop-auth-empty-regression", "checks.desktopRegression", "Desktop layout regression"]
];

for (const [scenarioId, evidencePath, label] of requiredMobileEvidence) {
  const scenario = mobileSummary.results.find(item => item.id === scenarioId);
  expect(Boolean(scenario && getPath(scenario, evidencePath)), label, `${scenarioId}.${evidencePath}`);
}

for (const name of ["packaged-desktop-smoke", "installed-desktop-smoke"]) {
  const dir = path.join(root, "test-artifacts", name);
  checkFile(`${name} startup screenshot`, path.join(dir, "startup.png"), 1024);
  checkFile(`${name} reader screenshot`, path.join(dir, "open.png"), 1024);
  checkFile(`${name} server log`, path.join(dir, "server.log"), 1);
}

checkFile("Functional test matrix", path.join(root, "docs", "functional-test-matrix.md"), 1);
checkFile("Verification report", path.join(root, "docs", "verification-report.md"), 1);

let failed = false;
for (const check of checks) {
  console.log(`[${check.ok ? "ok" : "fail"}] ${check.name}: ${check.detail}`);
  failed ||= !check.ok;
}
if (failed) process.exitCode = 1;

function findLatestArtifact(prefix) {
  const artifactsDir = path.join(root, "test-artifacts");
  const candidates = fs.readdirSync(artifactsDir, { withFileTypes: true })
    .filter(item => item.isDirectory() && item.name.startsWith(prefix))
    .map(item => {
      const fullPath = path.join(artifactsDir, item.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) {
    throw new Error(`No test artifact found with prefix ${prefix}`);
  }
  return candidates[0].fullPath;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing JSON file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

function checkFile(name, filePath, minBytes) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  expect(Boolean(stat && stat.size >= minBytes), name, stat ? `${path.relative(root, filePath)} (${stat.size} bytes)` : `missing: ${path.relative(root, filePath)}`);
}

function expect(ok, name, detail) {
  checks.push({ ok: Boolean(ok), name, detail });
}
