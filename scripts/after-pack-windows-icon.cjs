const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPackWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.projectDir;
  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.join(projectDir, "build", "icon.ico");
  const rceditPath = path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");

  for (const requiredPath of [exePath, iconPath, rceditPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Missing required Windows packaging file: ${requiredPath}`);
    }
  }

  const productVersion =
    appInfo.shortVersionWindows ||
    (typeof appInfo.getVersionInWeirdWindowsForm === "function"
      ? appInfo.getVersionInWeirdWindowsForm()
      : `${appInfo.version}.0`);

  const args = [
    exePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "FileDescription",
    appInfo.productName,
    "--set-version-string",
    "ProductName",
    appInfo.productName,
    "--set-version-string",
    "CompanyName",
    appInfo.companyName || appInfo.productName,
    "--set-version-string",
    "LegalCopyright",
    appInfo.copyright || "",
    "--set-file-version",
    appInfo.shortVersion || appInfo.buildVersion || appInfo.version,
    "--set-product-version",
    productVersion,
  ];

  await runWithRetry(() => execFileSync(rceditPath, args, { stdio: "inherit" }), 5, 1000);
};

async function runWithRetry(action, attempts, delayMs) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      action();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      console.warn(`[windows-icon] rcedit failed, retrying (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}
