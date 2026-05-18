const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const checks = [];

checkFile("Windows installer", "release/SmartRead Setup 0.1.0.exe", 50 * 1024 * 1024);
checkFile("Windows unpacked exe", "release/win-unpacked/SmartRead.exe", 50 * 1024 * 1024);
checkFile("Desktop server entry", "release/win-unpacked/resources/app.asar.unpacked/dist/server/index.js");
checkFile("Desktop backend dependency fastify", "release/win-unpacked/resources/app.asar.unpacked/node_modules/fastify/package.json");
checkFile("Desktop backend dependency @fastify/static", "release/win-unpacked/resources/app.asar.unpacked/node_modules/@fastify/static/package.json");
checkFile("Desktop frontend index", "release/win-unpacked/resources/app.asar.unpacked/index.html");
checkFile("Desktop frontend global CSS", "release/win-unpacked/resources/app.asar.unpacked/index.css");
checkFile("Desktop bookshelf CSS", "release/win-unpacked/resources/app.asar.unpacked/css/bookshelf.css");
checkFile("Desktop API client JS", "release/win-unpacked/resources/app.asar.unpacked/js/api.js");
checkAsarText("Desktop userData isolation", "release/win-unpacked/resources/app.asar", "desktop/main.cjs", "SMARTREAD_USER_DATA_DIR");
checkAsarText("Desktop startup health check", "release/win-unpacked/resources/app.asar", "desktop/main.cjs", "/api/health");
checkAsarText("Desktop startup loading page", "release/win-unpacked/resources/app.asar", "desktop/main.cjs", "正在启动本地阅读服务");
checkAsarText("Desktop load failure retry", "release/win-unpacked/resources/app.asar", "desktop/main.cjs", "did-fail-load");

checkWindowsSignature("Windows installer signature", "release/SmartRead Setup 0.1.0.exe");
checkWindowsSignature("Windows unpacked exe signature", "release/win-unpacked/SmartRead.exe");

checkFile("Android debug APK", "android/app/build/outputs/apk/debug/app-debug.apk", 1024 * 1024);
checkFile("Android release APK", "android/app/build/outputs/apk/release/app-release.apk", 1024 * 1024);
checkAndroidSignature("Android release APK signature", "android/app/build/outputs/apk/release/app-release.apk");
checkFile("Android release AAB", "android/app/build/outputs/bundle/release/app-release.aab", 1024 * 1024);
checkAndroidBundleSignature("Android release AAB signature", "android/app/build/outputs/bundle/release/app-release.aab");

checkStandaloneConfig("mobile-www native standalone config", "mobile-www/native-config.js");
checkStandaloneConfig("Android embedded native standalone config", "android/app/src/main/assets/public/native-config.js");
checkStandaloneConfig("iOS embedded native standalone config", "ios/App/App/public/native-config.js");

checkFile("iOS Xcode project", "ios/App/App.xcodeproj/project.pbxproj");
checkFile("iOS app delegate", "ios/App/App/AppDelegate.swift");
checkFile("iOS macOS release build script", "scripts/build-ios-release.sh");
checkFile("Functional coverage audit script", "scripts/functional-coverage-audit.cjs");
checkFile("Native standalone audit script", "scripts/native-standalone-audit.cjs");
checkFile("Workspace cleanup audit script", "scripts/workspace-clean-audit.cjs");
checkFile("Distribution risk audit script", "scripts/distribution-risk-audit.cjs");
checkFile("Functional test matrix", "docs/functional-test-matrix.md");
checkCommand("Native standalone resource audit", [process.execPath, path.join(root, "scripts", "native-standalone-audit.cjs")]);
checkCommand("Workspace stale artifact audit", [process.execPath, path.join(root, "scripts", "workspace-clean-audit.cjs")]);

printResults();

function checkFile(name, relativePath, minBytes = 1) {
  const filePath = path.join(root, relativePath);
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  add(name, Boolean(stat && stat.size >= minBytes), stat ? `${relativePath} (${stat.size} bytes)` : `missing: ${relativePath}`);
}

function checkStandaloneConfig(name, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    add(name, false, `missing: ${relativePath}`);
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  const ok = /standalone:\s*true/.test(text) && /appMode:\s*['"]mobile['"]/.test(text) && /apiBaseUrl:\s*[""]/.test(text);
  add(name, ok, relativePath);
}

function checkAsarText(name, asarRelativePath, fileInAsar, expectedText) {
  const asarPath = path.join(root, asarRelativePath);
  if (!fs.existsSync(asarPath)) {
    add(name, false, `missing: ${asarRelativePath}`);
    return;
  }
  try {
    const asar = require("@electron/asar");
    const text = asar.extractFile(asarPath, fileInAsar).toString("utf8");
    add(name, text.includes(expectedText), `${fileInAsar} contains ${expectedText}`);
  } catch (error) {
    add(name, false, error instanceof Error ? error.message : String(error));
  }
}

function checkWindowsSignature(name, relativePath) {
  if (process.platform !== "win32") {
    add(name, false, "Windows signature verification requires Windows");
    return;
  }
  const filePath = path.join(root, relativePath);
  const escaped = filePath.replace(/'/g, "''");
  const command = [
    `$s=Get-AuthenticodeSignature -FilePath '${escaped}'`,
    "$thumb=$s.SignerCertificate.Thumbprint",
    "$currentRoot=@(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq $thumb }).Count",
    "$currentPublisher=@(Get-ChildItem Cert:\\CurrentUser\\TrustedPublisher | Where-Object { $_.Thumbprint -eq $thumb }).Count",
    "$machineRoot=@(Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq $thumb }).Count",
    "$machinePublisher=@(Get-ChildItem Cert:\\LocalMachine\\TrustedPublisher | Where-Object { $_.Thumbprint -eq $thumb }).Count",
    "[pscustomobject]@{status=$s.Status.ToString();thumbprint=$thumb;currentRoot=$currentRoot;currentPublisher=$currentPublisher;machineRoot=$machineRoot;machinePublisher=$machinePublisher} | ConvertTo-Json -Compress"
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-EncodedCommand",
    encoded
  ], { encoding: "utf8" });
  const text = result.stdout.trim();
  try {
    const parsed = JSON.parse(text);
    const status = String(parsed.status || "");
    const trustedLocalDev = Boolean(parsed.thumbprint) && (
      (Number(parsed.currentRoot) > 0 && Number(parsed.currentPublisher) > 0) ||
      (Number(parsed.machineRoot) > 0 && Number(parsed.machinePublisher) > 0)
    );
    const ok = status === "Valid" || (status === "UnknownError" && trustedLocalDev);
    add(
      name,
      ok,
      `${status}; thumbprint=${parsed.thumbprint || "none"}; currentRoot=${parsed.currentRoot}; currentPublisher=${parsed.currentPublisher}; machineRoot=${parsed.machineRoot}; machinePublisher=${parsed.machinePublisher}`
    );
  } catch {
    add(name, false, text || result.stderr.trim() || "signature check failed");
  }
}

function checkAndroidSignature(name, relativePath) {
  const sdkRoot = path.join(root, "tools", "android-sdk");
  const jdkRoot = path.join(root, "tools", "jdk-21");
  const apksignerJar = path.join(sdkRoot, "build-tools", "36.0.0", "lib", "apksigner.jar");
  const javaExe = path.join(jdkRoot, "bin", process.platform === "win32" ? "java.exe" : "java");
  const apkPath = path.join(root, relativePath);
  if (!fs.existsSync(apksignerJar) || !fs.existsSync(javaExe)) {
    add(name, false, "missing local Android SDK/JDK tools");
    return;
  }
  const env = {
    ...process.env,
    JAVA_HOME: jdkRoot,
    PATH: [path.join(jdkRoot, "bin"), process.env.PATH || process.env.Path || ""].join(path.delimiter)
  };
  const result = spawnSync(javaExe, ["-jar", apksignerJar, "verify", "--verbose", "--print-certs", apkPath], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  add(name, result.status === 0 && output.includes("Verifies") && output.includes("Verified using v2 scheme"), firstInterestingLine(output));
}

function checkAndroidBundleSignature(name, relativePath) {
  const jdkRoot = path.join(root, "tools", "jdk-21");
  const jarsignerExe = path.join(jdkRoot, "bin", process.platform === "win32" ? "jarsigner.exe" : "jarsigner");
  const aabPath = path.join(root, relativePath);
  if (!fs.existsSync(jarsignerExe) || !fs.existsSync(aabPath)) {
    add(name, false, "missing local JDK jarsigner or AAB artifact");
    return;
  }
  const result = spawnSync(jarsignerExe, ["-verify", "-certs", aabPath], {
    cwd: root,
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  add(name, result.status === 0, firstInterestingLine(output));
}

function checkCommand(name, command) {
  const [file, ...args] = command;
  const result = spawnSync(file, args, { cwd: root, encoding: "utf8" });
  const output = `${result.stdout}\n${result.stderr}`;
  add(name, result.status === 0, firstInterestingLine(output));
}

function firstInterestingLine(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && /\[(ok|fail)\]|Verifies|Verified using v2|Signer #1 certificate DN|X\.509|签名者|jar verified|jar 已验证|ERROR/i.test(line)) || "no output";
}

function add(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function printResults() {
  let failed = false;
  for (const check of checks) {
    console.log(`[${check.ok ? "ok" : "fail"}] ${check.name}: ${check.detail}`);
    failed ||= !check.ok;
  }
  console.log("[info] iOS signed IPA is not asserted here; Windows cannot create one without macOS/Xcode/Apple signing.");
  if (failed) process.exitCode = 1;
}
