const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "mobile-www");
const stageDir = path.join(root, `mobile-www.tmp-${process.pid}`);
const apiBaseUrl = process.env.SMARTREAD_NATIVE_API_BASE_URL || "";
const standalone = process.env.SMARTREAD_NATIVE_STANDALONE !== "0";

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

try {
  copyFile("index.html");
  copyDir("css");
  copyDir("js");

  const config = [
    "window.SmartReadNativeConfig = {",
    `  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},`,
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
  fs.renameSync(stageDir, outDir);
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
