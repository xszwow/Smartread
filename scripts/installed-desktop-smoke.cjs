const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { _electron: electron } = require("playwright");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "test-artifacts", "installed-desktop-smoke");
const samplePath = path.join(outDir, "sample.txt");

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  const exePath = process.env.SMARTREAD_INSTALLED_EXE || defaultInstalledExe();
  if (!fs.existsSync(exePath)) {
    throw new Error(`Installed SmartRead app not found: ${exePath}`);
  }
  checkWindowsSignature(exePath);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    samplePath,
    [
      "SmartRead installed desktop smoke sample",
      "",
      "This TXT file verifies local import and reader opening in the installed Windows app."
    ].join("\n"),
    "utf8"
  );

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-installed-smoke-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-installed-user-data-"));
  const app = await electron.launch({
    executablePath: exePath,
    args: ["--disable-gpu"],
    timeout: 60000,
    env: {
      ...process.env,
      SMARTREAD_DATA_DIR: dataDir,
      SMARTREAD_USER_DATA_DIR: userDataDir
    }
  });

  let page;
  let passed = false;
  try {
    page = await app.firstWindow({ timeout: 60000 });
    const consoleErrors = [];
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", error => consoleErrors.push(error.message));

    await page.setViewportSize({ width: 1280, height: 844 });
    await assertStartupNotBlank(page, outDir, "Installed");
    await page.waitForSelector("#bookshelf-view", { timeout: 60000 });
    await page.waitForFunction(
      () => document.getElementById("bookshelf-view")?.classList.contains("is-authenticated"),
      null,
      { timeout: 30000 }
    );

    const bodyText = await page.locator("body").innerText({ timeout: 10000 });
    if (/Route GET:\/ not found|Not Found/.test(bodyText)) {
      throw new Error("Installed app loaded server 404 instead of frontend HTML");
    }
    if (!/智读|SmartRead/.test(bodyText)) {
      throw new Error("Installed app did not render SmartRead UI");
    }
    if (/登录表哥智读|获取验证码|cloud-auth-email|6 位验证码/.test(bodyText)) {
      throw new Error("Installed desktop app should enter local shelf without email-code login");
    }
    if (/local-desktop@smartread\.local/.test(bodyText)) {
      throw new Error("Installed desktop app should not expose the internal local desktop account");
    }

    await importSampleBook(page, samplePath, outDir);
    await page.waitForSelector(".book-card", { timeout: 15000 });
    await page.locator(".book-card").first().click();
    await page.waitForSelector("#reader-view.active", { timeout: 15000 });
    const expectedText = "SmartRead installed desktop smoke sample";
    await page.waitForFunction(
      text => document.getElementById("book-content")?.innerText.includes(text),
      expectedText,
      { timeout: 10000 }
    );
    const readerText = await page.locator("#book-content").innerText({ timeout: 10000 });
    if (!readerText.includes(expectedText)) {
      throw new Error("Installed app imported sample TXT but reader did not show its content");
    }
    if (consoleErrors.length) {
      throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);
    }

    await page.screenshot({ path: path.join(outDir, "open.png"), fullPage: true });
    console.log(`installed desktop smoke ok: ${exePath}`);
    passed = true;
  } finally {
    if (!passed && page) {
      await page.screenshot({ path: path.join(outDir, "failure.png"), fullPage: true }).catch(() => {});
    }
    const serverLog = path.join(userDataDir, "smartread-server.log");
    if (fs.existsSync(serverLog)) {
      fs.copyFileSync(serverLog, path.join(outDir, passed ? "server.log" : "server-failure.log"));
    }
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function assertStartupNotBlank(page, outDir, label) {
  await page.waitForFunction(
    () => Boolean(document.body && document.body.innerText.trim().length > 0),
    null,
    { timeout: 3000 }
  );
  await page.screenshot({ path: path.join(outDir, "startup.png"), fullPage: true });
  const text = await page.locator("body").innerText({ timeout: 3000 });
  if (!/SmartRead|正在启动|智读|书架|导入/.test(text)) {
    throw new Error(`${label} app startup window rendered unexpected or blank text: ${JSON.stringify(text.slice(0, 120))}`);
  }
}

function defaultInstalledExe() {
  if (process.platform !== "win32") {
    throw new Error("Installed desktop smoke is currently only defined for Windows");
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is not set");
  return path.join(localAppData, "Programs", "SmartRead", "SmartRead.exe");
}

function checkWindowsSignature(exePath) {
  if (process.platform !== "win32") return;
  const escaped = exePath.replace(/'/g, "''");
  const command = [
    `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    "$thumb=$s.SignerCertificate.Thumbprint",
    "[pscustomobject]@{status=$s.Status.ToString();thumbprint=$thumb;message=$s.StatusMessage} | ConvertTo-Json -Compress"
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  const text = result.stdout.trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(text || result.stderr.trim() || "Installed app signature check failed");
  }
  if (parsed.status !== "Valid") {
    throw new Error(`Installed app signature is ${parsed.status}: ${parsed.message || "no message"}`);
  }
}

async function importSampleBook(page, samplePath, outDir) {
  let importButton = page.locator("#btn-import:visible, .desktop-empty-copy .btn-primary:visible, #mobile-empty-import-action:visible").first();
  if (await importButton.count() === 0) {
    const importTile = page.locator("#mobile-empty-tile-import:visible").first();
    if (await importTile.count() > 0) {
      await importTile.click();
      await page.waitForSelector("#mobile-empty-import-action:visible", { timeout: 10000 });
      importButton = page.locator("#mobile-empty-import-action:visible").first();
    }
  }
  if (await importButton.count() === 0) {
    await page.screenshot({ path: path.join(outDir, "missing-import-control.png"), fullPage: true });
    throw new Error("Installed app did not expose a visible import control");
  }
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  await importButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(samplePath);
}
