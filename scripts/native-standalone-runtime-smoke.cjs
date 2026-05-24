const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "test-artifacts", `native-standalone-runtime-${timestamp()}`);
const mobileIndex = path.join(root, "mobile-www", "index.html");

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(mobileIndex)) {
    throw new Error("mobile-www/index.html is missing. Run npm run mobile:prepare first.");
  }
  fs.mkdirSync(outDir, { recursive: true });

  const networkFailures = [];
  const consoleErrors = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: findInstalledChrome()
  });

  let page;
  let ok = false;
  try {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true
    });
    page.on("request", request => {
      const url = request.url();
      if (/\/api\//.test(url)) networkFailures.push(`unexpected api request: ${url}`);
    });
    page.on("requestfailed", request => {
      const url = request.url();
      if (/\/api\//.test(url)) networkFailures.push(`failed api request: ${url}`);
    });
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", error => consoleErrors.push(error.message));

    await page.goto(fileUrl(mobileIndex), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#bookshelf-view.is-authenticated.is-mobile-dashboard", { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById("bookshelf-view")?.classList.contains("is-booting"), null, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      title: document.title,
      nativeStandalone: !!window.SmartReadNativeStandalone?.enabled,
      nativeClass: document.documentElement.classList.contains("native-standalone-runtime"),
      userEmail: typeof Bookshelf !== "undefined" ? (Bookshelf.user?.email || "") : "",
      classes: document.getElementById("bookshelf-view")?.className || "",
      bodyText: document.body.innerText.slice(0, 2000)
    }));

    const failures = [];
    if (!state.nativeStandalone) failures.push("native standalone runtime is not enabled");
    if (!state.nativeClass) failures.push("native standalone CSS class is missing");
    if (state.userEmail !== "local-device@smartread.local") failures.push(`unexpected native user: ${state.userEmail}`);
    if (!state.classes.includes("is-authenticated")) failures.push(`bookshelf is not authenticated: ${state.classes}`);
    if (state.classes.includes("is-logged-out")) failures.push(`bookshelf is still logged out: ${state.classes}`);
    if (!/本机书架|我的书架|导入\s*本地书/.test(state.bodyText)) failures.push("native home text did not render");
    if (/获取验证码|登录 SmartRead/.test(state.bodyText)) failures.push("native home rendered SmartRead login copy");
    failures.push(...networkFailures, ...consoleErrors.filter(message => /\/api\/|ERR_FAILED|CORS/i.test(message)));

    await page.screenshot({ path: path.join(outDir, "native-home.png"), fullPage: true });
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ok: failures.length === 0, state, failures, networkFailures, consoleErrors }, null, 2) + "\n", "utf8");

    if (failures.length) {
      throw new Error(failures.join(" | "));
    }
    ok = true;
    console.log(`native standalone runtime smoke ok: ${path.relative(root, outDir)}`);
  } finally {
    if (!ok && page) {
      await page.screenshot({ path: path.join(outDir, "failure.png"), fullPage: true }).catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function findInstalledChrome() {
  const browsers = [
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ];
  const installed = browsers.find(browserPath => fs.existsSync(browserPath));
  if (installed) return installed;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "ms-playwright"),
    path.join(process.env.USERPROFILE || "", "AppData", "Local", "ms-playwright")
  ];
  for (const rootDir of candidates) {
    const chrome = findFile(rootDir, "chrome.exe");
    if (chrome) return chrome;
  }
  return undefined;
}

function findFile(rootDir, fileName) {
  if (!rootDir || !fs.existsSync(rootDir)) return "";
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath;
    }
  }
  return "";
}
