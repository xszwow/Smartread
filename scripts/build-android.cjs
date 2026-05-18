const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mode = (process.argv[2] || "debug").toLowerCase();
const taskByMode = {
  debug: "assembleDebug",
  release: "assembleRelease",
  bundle: "bundleRelease",
  aab: "bundleRelease"
};

if (!taskByMode[mode]) {
  console.error("Usage: node scripts/build-android.cjs <debug|release|bundle|aab>");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");
const jdkDir = path.join(root, "tools", "jdk-21");
const sdkRoot = path.join(root, "tools", "android-sdk");
const nodeDir = path.join(root, "tools", "node-v24.15.0-win-x64");
const npmCmd = fs.existsSync(path.join(nodeDir, "npm.cmd"))
  ? path.join(nodeDir, "npm.cmd")
  : "npm";
const gradleCmd = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

const requiredPaths = [
  [androidDir, "Android project"],
  [jdkDir, "JDK 21"],
  [sdkRoot, "Android SDK"],
  [path.join(sdkRoot, "platforms", "android-36"), "Android platform 36"],
  [path.join(sdkRoot, "build-tools", "36.0.0"), "Android build-tools 36.0.0"]
];

for (const [targetPath, label] of requiredPaths) {
  if (!fs.existsSync(targetPath)) {
    console.error(`[missing] ${label}: ${targetPath}`);
    process.exit(1);
  }
}

const pathEntries = [
  fs.existsSync(nodeDir) ? nodeDir : null,
  path.join(jdkDir, "bin"),
  path.join(sdkRoot, "cmdline-tools", "latest", "bin"),
  path.join(sdkRoot, "platform-tools"),
  process.env.PATH || process.env.Path || ""
].filter(Boolean);

const env = {
  ...process.env,
  JAVA_HOME: jdkDir,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  PATH: pathEntries.join(path.delimiter)
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run(npmCmd, ["run", "mobile:sync"]);
run(path.join(androidDir, gradleCmd), [taskByMode[mode]], { cwd: androidDir });

const artifact = artifactForMode(mode);
if (!fs.existsSync(artifact.path)) {
  console.error(`[missing] Expected Android artifact was not produced: ${artifact.path}`);
  process.exit(1);
}

console.log(`[ok] Android ${artifact.label}: ${artifact.path}`);

function artifactForMode(buildMode) {
  if (buildMode === "bundle" || buildMode === "aab") {
    return {
      label: "release AAB",
      path: path.join(androidDir, "app", "build", "outputs", "bundle", "release", "app-release.aab")
    };
  }
  const apkName = buildMode === "release" ? "app-release.apk" : "app-debug.apk";
  return {
    label: `${buildMode} APK`,
    path: path.join(androidDir, "app", "build", "outputs", "apk", buildMode, apkName)
  };
}
