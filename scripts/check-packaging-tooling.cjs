const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bundledNodeDir = path.join(root, "tools", "node-v24.15.0-win-x64");
const bundledNpm = path.join(bundledNodeDir, process.platform === "win32" ? "npm.cmd" : "bin/npm");
const checks = [
  {
    name: "npm",
    ok: commandExists("npm") || fs.existsSync(bundledNpm),
    detail: "Install Node.js with npm on PATH, or keep the bundled tools/node-v24.15.0-win-x64 runtime."
  },
  {
    name: "electron",
    ok: exists("node_modules/electron"),
    detail: "Run npm install so the Electron desktop shell can start and package."
  },
  {
    name: "electron-builder",
    ok: exists("node_modules/electron-builder"),
    detail: "Run npm install so Windows installer packaging is available."
  },
  {
    name: "@capacitor/cli",
    ok: exists("node_modules/@capacitor/cli"),
    detail: "Run npm install before mobile sync/open commands."
  },
  {
    name: "@capacitor/android",
    ok: exists("node_modules/@capacitor/android"),
    detail: "Run npm install, then npm run mobile:sync to create/update Android native project."
  },
  {
    name: "@capacitor/ios",
    ok: exists("node_modules/@capacitor/ios"),
    detail: "Run npm install on macOS, then npm run mobile:sync to create/update iOS native project."
  }
];

let failed = false;
for (const check of checks) {
  if (check.ok) {
    console.log(`[ok] ${check.name}`);
    continue;
  }
  failed = true;
  console.log(`[missing] ${check.name}: ${check.detail}`);
}

if (failed) process.exitCode = 1;

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function commandExists(command) {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "command", [
    process.platform === "win32" ? command : "-v",
    ...(process.platform === "win32" ? [] : [command])
  ], {
    encoding: "utf8",
    shell: process.platform !== "win32"
  });
  return result.status === 0;
}
