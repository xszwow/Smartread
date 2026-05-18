const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "docs", "release-readiness-current.md");

const hardChecks = [
  ["Functional coverage audit", ["scripts/functional-coverage-audit.cjs"]],
  ["Native standalone audit", ["scripts/native-standalone-audit.cjs"]],
  ["Workspace cleanup audit", ["scripts/workspace-clean-audit.cjs"]],
  ["Release artifact audit", ["scripts/release-audit.cjs"]]
];

const advisoryChecks = [
  ["Signing environment check", ["scripts/check-signing-env.cjs"]],
  ["Production signing environment check", ["scripts/check-production-signing-env.cjs"]],
  ["Distribution risk audit", ["scripts/distribution-risk-audit.cjs"]]
];

const hardResults = hardChecks.map(([name, args]) => runNode(name, args));
const advisoryResults = advisoryChecks.map(([name, args]) => runNode(name, args, { allowFailure: true }));
const artifacts = collectArtifacts();
const functionalEvidence = collectFunctionalEvidence();

const localValidationOk = hardResults.every(result => result.status === 0);
const publicDistributionOk = localValidationOk && advisoryResults.every(result => result.status === 0);
const report = renderReport({
  generatedAt: new Date().toISOString(),
  hardResults,
  advisoryResults,
  artifacts,
  functionalEvidence,
  localValidationOk,
  publicDistributionOk
});

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, report, "utf8");

console.log(`[ok] Release readiness report written: ${path.relative(root, reportPath)}`);
console.log(`[${localValidationOk ? "ok" : "fail"}] Local/dev validation: ${localValidationOk ? "passed" : "failed"}`);
console.log(`[${publicDistributionOk ? "ok" : "blocked"}] Public low-warning distribution: ${publicDistributionOk ? "passed" : "blocked"}`);

if (!localValidationOk) process.exitCode = 1;

function runNode(name, args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0 && !options.allowFailure) {
    return { name, status: result.status ?? 1, ok: false, output };
  }
  return { name, status: result.status ?? 0, ok: result.status === 0, output };
}

function collectArtifacts() {
  const installedExe = process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "SmartRead", "SmartRead.exe")
    : "";
  return [
    fileArtifact("Windows installer", path.join(root, "release", "SmartRead Setup 0.1.0.exe")),
    fileArtifact("Windows unpacked exe", path.join(root, "release", "win-unpacked", "SmartRead.exe")),
    installedExe ? windowsFileArtifact("Windows installed exe", installedExe) : missingArtifact("Windows installed exe", "%LOCALAPPDATA% not set"),
    fileArtifact("Android debug APK", path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")),
    fileArtifact("Android release APK", path.join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk")),
    fileArtifact("Android release AAB", path.join(root, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab")),
    latestIosIpaArtifact()
  ];
}

function collectFunctionalEvidence() {
  return {
    mobile: latestMobileSummary(),
    packagedSmoke: smokeEvidence("packaged-desktop-smoke"),
    installedSmoke: smokeEvidence("installed-desktop-smoke")
  };
}

function latestMobileSummary() {
  const dir = latestArtifactDir("mobile-empty-shelf-");
  if (!dir) return { ok: false, detail: "missing mobile e2e artifact" };
  const summaryPath = path.join(dir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    return { ok: false, detail: `missing ${path.relative(root, summaryPath)}` };
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const results = Array.isArray(summary.results) ? summary.results : [];
    return {
      ok: results.length > 0 && results.every(result => result.ok === true),
      path: path.relative(root, summaryPath),
      baseUrl: summary.baseUrl || "",
      previewServerStarted: summary.previewServerStarted,
      passed: results.filter(result => result.ok === true).length,
      total: results.length
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function smokeEvidence(name) {
  const dir = path.join(root, "test-artifacts", name);
  const startup = fileArtifact("startup.png", path.join(dir, "startup.png"));
  const open = fileArtifact("open.png", path.join(dir, "open.png"));
  const log = path.join(dir, "server.log");
  const timing = parseStartupTiming(log);
  return {
    ok: startup.exists && open.exists && fs.existsSync(log),
    dir: path.relative(root, dir),
    startup,
    open,
    log: fileArtifact("server.log", log),
    timing
  };
}

function parseStartupTiming(logPath) {
  if (!fs.existsSync(logPath)) return "missing startup timing log";
  const text = fs.readFileSync(logPath, "utf8");
  const startup = text.match(/desktop \+(\d+)ms\] Startup page rendered/);
  const shown = text.match(/desktop \+(\d+)ms\] Main window shown/);
  const healthy = text.match(/desktop \+(\d+)ms\] Local server healthy/);
  const parts = [];
  if (startup) parts.push(`startup page ${startup[1]}ms`);
  if (shown) parts.push(`window shown ${shown[1]}ms`);
  if (healthy) parts.push(`server healthy ${healthy[1]}ms`);
  return parts.length ? parts.join("; ") : "no desktop timing markers";
}

function latestIosIpaArtifact() {
  const releaseDir = path.join(root, "release", "ios");
  if (!fs.existsSync(releaseDir)) return missingArtifact("iOS signed IPA", "missing release/ios");
  const candidates = fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter(item => item.isFile() && item.name.toLowerCase().endsWith(".ipa"))
    .map(item => fileArtifact("iOS signed IPA", path.join(releaseDir, item.name)))
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  return candidates[0] || missingArtifact("iOS signed IPA", "no .ipa in release/ios");
}

function latestArtifactDir(prefix) {
  const artifactsDir = path.join(root, "test-artifacts");
  if (!fs.existsSync(artifactsDir)) return "";
  const candidates = fs.readdirSync(artifactsDir, { withFileTypes: true })
    .filter(item => item.isDirectory() && item.name.startsWith(prefix))
    .map(item => {
      const fullPath = path.join(artifactsDir, item.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.fullPath || "";
}

function fileArtifact(label, filePath) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  return {
    label,
    exists: Boolean(stat),
    path: displayPath(filePath),
    size: stat?.size || 0,
    sizeLabel: stat ? formatBytes(stat.size) : "missing",
    mtime: stat ? stat.mtime.toISOString() : "",
    mtimeMs: stat?.mtimeMs || 0
  };
}

function windowsFileArtifact(label, filePath) {
  const normal = fileArtifact(label, filePath);
  if (normal.exists || process.platform !== "win32") return normal;

  const escaped = filePath.replace(/'/g, "''");
  const command = [
    `$p='${escaped}'`,
    "if (Test-Path -LiteralPath $p) {",
    "$i=Get-Item -LiteralPath $p",
    "[pscustomobject]@{exists=$true;fullName=$i.FullName;length=$i.Length;mtime=$i.LastWriteTimeUtc.ToString('o')} | ConvertTo-Json -Compress",
    "} else {",
    "[pscustomobject]@{exists=$false;fullName=$p;length=0;mtime=''} | ConvertTo-Json -Compress",
    "}"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
    encoding: "utf8"
  });
  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (!parsed.exists) return normal;
    return {
      label,
      exists: true,
      path: parsed.fullName || filePath,
      size: Number(parsed.length) || 0,
      sizeLabel: formatBytes(Number(parsed.length) || 0),
      mtime: parsed.mtime || "",
      mtimeMs: Date.parse(parsed.mtime || "") || 0
    };
  } catch {
    return normal;
  }
}

function missingArtifact(label, detail) {
  return { label, exists: false, path: detail, size: 0, sizeLabel: "missing", mtime: "" };
}

function displayPath(filePath) {
  return filePath.startsWith(root)
    ? path.relative(root, filePath).replace(/\\/g, "/")
    : filePath;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function renderReport(context) {
  const {
    generatedAt,
    hardResults,
    advisoryResults,
    artifacts,
    functionalEvidence,
    localValidationOk,
    publicDistributionOk
  } = context;
  const goalComplete = publicDistributionOk;
  const lines = [];
  lines.push("# SmartRead Release Readiness Current");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push("## Bottom Line");
  lines.push("");
  lines.push(`- Local/dev verification: **${localValidationOk ? "PASS" : "FAIL"}**`);
  lines.push(`- Public low-warning distribution: **${publicDistributionOk ? "PASS" : "BLOCKED"}**`);
  lines.push(`- Full user objective complete: **${goalComplete ? "YES" : "NO"}**`);
  lines.push("");
  if (!goalComplete) {
    lines.push("The current artifacts are suitable for local and development validation. The full objective is still blocked by public distribution trust requirements: non-development Windows signing, non-development Android signing or managed store signing, and a signed iOS IPA built on macOS/Xcode with Apple provisioning.");
    lines.push("");
  }

  lines.push("## Artifacts");
  lines.push("");
  lines.push("| Item | Status | Path | Size | Modified |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const artifact of artifacts) {
    lines.push(`| ${artifact.label} | ${artifact.exists ? "present" : "missing"} | \`${artifact.path}\` | ${artifact.sizeLabel} | ${artifact.mtime || "-"} |`);
  }
  lines.push("");

  lines.push("## Functional Evidence");
  lines.push("");
  lines.push(`- Mobile Metro/e2e: ${functionalEvidence.mobile.ok ? "PASS" : "FAIL"}; ${functionalEvidence.mobile.passed ?? 0}/${functionalEvidence.mobile.total ?? 0} scenarios; artifact \`${functionalEvidence.mobile.path || functionalEvidence.mobile.detail || "missing"}\`.`);
  lines.push(`- Packaged desktop smoke: ${functionalEvidence.packagedSmoke.ok ? "PASS" : "FAIL"}; ${functionalEvidence.packagedSmoke.timing}; screenshots \`${functionalEvidence.packagedSmoke.startup.path}\`, \`${functionalEvidence.packagedSmoke.open.path}\`.`);
  lines.push(`- Installed desktop smoke: ${functionalEvidence.installedSmoke.ok ? "PASS" : "FAIL"}; ${functionalEvidence.installedSmoke.timing}; screenshots \`${functionalEvidence.installedSmoke.startup.path}\`, \`${functionalEvidence.installedSmoke.open.path}\`.`);
  lines.push("");

  lines.push("## Hard Verification Commands");
  lines.push("");
  lines.push("| Command | Status | Evidence excerpt |");
  lines.push("| --- | --- | --- |");
  for (const result of hardResults) {
    lines.push(`| ${result.name} | ${result.status === 0 ? "PASS" : `FAIL (${result.status})`} | ${markdownCell(excerpt(result.output))} |`);
  }
  lines.push("");

  lines.push("## Distribution Gates");
  lines.push("");
  lines.push("| Gate | Status | Evidence excerpt |");
  lines.push("| --- | --- | --- |");
  for (const result of advisoryResults) {
    lines.push(`| ${result.name} | ${result.status === 0 ? "PASS" : `BLOCKED (${result.status})`} | ${markdownCell(excerpt(result.output))} |`);
  }
  lines.push("");

  lines.push("## Blocking Gaps");
  lines.push("");
  if (publicDistributionOk) {
    lines.push("- None detected by the current distribution gates.");
  } else {
    lines.push("- Windows public distribution still needs a non-development signing chain, such as OV/EV code signing or Microsoft Store distribution, to reduce device warnings outside this trusted machine.");
    lines.push("- Android release currently uses a development-local signing setup unless replaced by Play App Signing, enterprise signing, or a production release keystore.");
    lines.push("- iOS signed `.ipa` is missing in this Windows workspace; create it on macOS with Xcode, Apple Developer Team ID, and provisioning profile using `npm run ios:build:release`.");
  }
  lines.push("");

  lines.push("## Re-run Checklist");
  lines.push("");
  lines.push("```powershell");
  lines.push("npm run build");
  lines.push("npm test");
  lines.push("npm run desktop:pack:win:dev-signed");
  lines.push("npm run desktop:smoke:packaged");
  lines.push("npm run desktop:smoke:installed");
  lines.push("npm run test:e2e:mobile-empty-shelf");
  lines.push("npm run functional:audit");
  lines.push("npm run native:standalone:audit");
  lines.push("npm run release:audit");
  lines.push("npm run signing:check");
  lines.push("npm run distribution:risk:audit");
  lines.push("npm run release:readiness");
  lines.push("```");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function excerpt(output) {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const interesting = lines.filter(line => /\[(ok|fail|risk|info)\]|Distribution risk audit failed|missing|Valid|Verifies|signed IPA|iOS|Windows|Android/i.test(line));
  return (interesting.length ? interesting : lines).slice(0, 4).join(" / ") || "no output";
}

function markdownCell(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
