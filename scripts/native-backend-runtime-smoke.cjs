const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "test-artifacts", `native-backend-runtime-${timestamp()}`);
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

  const apiRequests = [];
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
    await page.addInitScript(() => {
      const books = [];
      const user = { id: "android-local", email: "local-device@smartread.local", displayName: "本机书架" };
      const ok = value => Promise.resolve(value);
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          SmartReadBackend: {
            config: () => ok({
              deploymentMode: "android-native-backend",
              zlibMirror: "https://z-lib.fm",
              zlibMirrors: ["https://z-lib.fm"],
              zlibRegisterUrl: "https://z-lib.fm/registration",
              aiDefaults: { baseURL: "http://123.56.164.230:3002/v1/chat/completions", model: "test-model" }
            }),
            me: () => ok({ authenticated: true, user, zlibBound: false, nativeBackend: true }),
            login: () => ok({ authenticated: true, user }),
            requestEmailCode: () => ok({ ok: true, expiresInMs: 600000, cooldownMs: 0 }),
            verifyEmailCode: () => ok({ authenticated: true, user }),
            logout: () => ok({ ok: true }),
            aiConfigStatus: () => ok({ configured: true, baseURL: "http://123.56.164.230:3002/v1/chat/completions", model: "test-model" }),
            saveAIConfig: payload => ok({ configured: true, ...payload }),
            aiChat: () => ok({ text: "native ai ok", content: "native ai ok" }),
            bindZlib: () => ok({ authenticated: true, user, zlibBound: true }),
            unbindZlib: () => ok({ ok: true }),
            searchZlib: () => ok({
              page: 1,
              total: 1,
              totalPages: 1,
              results: [{
                id: "native-zlib-book",
                title: "Native Backend Test Book",
                author: "SmartRead",
                extension: "epub",
                downloadPath: "/dl/1"
              }]
            }),
            startZlibDownload: () => ok({ id: "native-job-1", status: "completed", progress: 100 }),
            downloadJob: () => ok({ id: "native-job-1", status: "completed", progress: 100 }),
            serverBooks: () => ok({ books }),
            updateBookProgress: payload => ok({ ok: true, bookId: payload.bookId }),
            deleteServerBook: () => ok({ ok: true }),
            fetchBookFile: () => ok({ fileName: "test.txt", mimeType: "text/plain", base64: "bmF0aXZl" })
          }
        }
      };
    });

    page.on("request", request => {
      const url = request.url();
      if (/\/api\//.test(url)) apiRequests.push(url);
    });
    page.on("requestfailed", request => {
      const url = request.url();
      if (/\/api\//.test(url)) apiRequests.push(`failed: ${url}`);
    });
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", error => consoleErrors.push(error.message));

    await page.goto(fileUrl(mobileIndex), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#bookshelf-view", { timeout: 10000 });
    await page.waitForFunction(() => document.documentElement.classList.contains("native-backend-runtime"), null, { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById("bookshelf-view")?.classList.contains("is-booting"), null, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      title: document.title,
      nativeBackend: !!window.SmartReadNativeBackend?.enabled,
      nativeClass: document.documentElement.classList.contains("native-backend-runtime"),
      standalone: !!window.SmartReadNativeStandalone?.enabled,
      deploymentMode: window.SmartReadAPI?.deploymentMode || "",
      userEmail: typeof Bookshelf !== "undefined" ? (Bookshelf.user?.email || "") : "",
      classes: document.getElementById("bookshelf-view")?.className || "",
      bodyText: document.body.innerText.slice(0, 2000)
    }));

    const failures = [];
    if (!state.nativeBackend) failures.push("native backend runtime is not enabled");
    if (!state.nativeClass) failures.push("native backend CSS class is missing");
    if (state.standalone) failures.push("native standalone runtime should not be enabled");
    if (state.deploymentMode !== "android-native-backend") failures.push(`unexpected deployment mode: ${state.deploymentMode}`);
    if (state.userEmail !== "local-device@smartread.local") failures.push(`unexpected native user: ${state.userEmail}`);
    if (!state.classes.includes("is-authenticated")) failures.push(`bookshelf is not authenticated: ${state.classes}`);
    if (!/书架|导入|Z-Library|搜索/.test(state.bodyText)) failures.push("native home did not render expected controls");
    if (/获取验证码|登录 SmartRead|6 位验证码/.test(state.bodyText)) failures.push("native backend home still rendered SmartRead email-code login");
    failures.push(...apiRequests);
    failures.push(...consoleErrors.filter(message => /\/api\/|ERR_FAILED|CORS|ReferenceError|TypeError/i.test(message)));

    await page.screenshot({ path: path.join(outDir, "native-backend-home.png"), fullPage: true });
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ok: failures.length === 0, state, failures, apiRequests, consoleErrors }, null, 2) + "\n", "utf8");

    if (failures.length) {
      throw new Error(failures.join(" | "));
    }
    ok = true;
    console.log(`native backend runtime smoke ok: ${path.relative(root, outDir)}`);
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
