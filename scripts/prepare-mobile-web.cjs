const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "mobile-www");
const stageDir = path.join(root, `mobile-www.tmp-${process.pid}`);
const apiBaseUrl = process.env.SMARTREAD_NATIVE_API_BASE_URL || "";
const nativeBackend = process.env.SMARTREAD_NATIVE_BACKEND !== "0";
const standalone = process.env.SMARTREAD_NATIVE_STANDALONE === "1";

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

try {
  copyFile("index.html");
  copyFile("index.css");
  copyDir("css");
  copyDir("js");
  copyDir("images");

  const config = [
    "window.SmartReadNativeConfig = {",
    `  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},`,
    `  nativeBackend: ${nativeBackend ? "true" : "false"},`,
    `  standalone: ${standalone ? "true" : "false"},`,
    "  appMode: 'mobile'",
    "};",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(stageDir, "native-config.js"), config, "utf8");

  const indexPath = path.join(stageDir, "index.html");
  let index = fs.readFileSync(indexPath, "utf8");
  if (!index.includes("native-config.js")) {
    index = index.replace(
      /<script src="js\/api\.js"/,
      '<script src="native-config.js"></script>\n    <script src="js/api.js"'
    );
    fs.writeFileSync(indexPath, index, "utf8");
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  try {
    fs.renameSync(stageDir, outDir);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(stageDir, outDir, { recursive: true });
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
} catch (error) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  throw error;
}

function copyFile(relativePath) {
  fs.copyFileSync(path.join(root, relativePath), path.join(stageDir, relativePath));
}

function copyDir(relativePath) {
  fs.cpSync(path.join(root, relativePath), path.join(stageDir, relativePath), {
    recursive: true
  });
}
