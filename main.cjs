const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, shell } = require("electron");

let mainWindow = null;
let serverProcess = null;
let serverUrl = "";
let serverLogPath = "";

app.setName("SmartRead");
app.setAppUserModelId("com.smartread.desktop");

if (process.env.SMARTREAD_USER_DATA_DIR) {
  app.setPath("userData", process.env.SMARTREAD_USER_DATA_DIR);
}

async function startLocalServer() {
  const port = await findOpenPort();
  const serverEntry = resolveServerEntry();
  const frontendDir = resolveFrontendDir();
  const dataDir = process.env.SMARTREAD_DATA_DIR || path.join(app.getPath("userData"), "data");
  serverLogPath = path.join(app.getPath("userData"), "smartread-server.log");
  fs.mkdirSync(path.dirname(serverLogPath), { recursive: true });
  fs.writeFileSync(serverLogPath, `SmartRead server log ${new Date().toISOString()}\n`, "utf8");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    SMARTREAD_DEPLOYMENT: "desktop",
    SMARTREAD_DESKTOP: "1",
    SMARTREAD_DATA_DIR: dataDir,
    SMARTREAD_FRONTEND_DIR: frontendDir,
    HOST: "127.0.0.1",
    PORT: String(port)
  };

  serverProcess = spawn(process.execPath, [serverEntry], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout?.on("data", chunk => writeServerLog("stdout", chunk));
  serverProcess.stderr?.on("data", chunk => writeServerLog("stderr", chunk));
  serverProcess.on("exit", (code, signal) => {
    if (app.isQuitting) return;
    dialog.showErrorBox(
      "SmartRead 服务已停止",
      `本地阅读服务意外退出：${code ?? signal ?? "unknown"}\n日志：${serverLogPath}`
    );
    app.quit();
  });

  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${serverUrl}/api/health`, 30000);
  return serverUrl;
}

function writeServerLog(stream, chunk) {
  const text = `[${new Date().toISOString()}] [${stream}] ${String(chunk)}`;
  if (stream === "stderr") console.error(text.trimEnd());
  else console.log(text.trimEnd());
  if (!serverLogPath) return;
  fs.appendFile(serverLogPath, text, () => {});
}

function resolveServerEntry() {
  const unpackedEntry = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "server", "index.js")
    : "";
  if (unpackedEntry && fs.existsSync(unpackedEntry)) return unpackedEntry;
  return path.resolve(__dirname, "../dist/server/index.js");
}

function resolveFrontendDir() {
  const unpackedRoot = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : "";
  if (unpackedRoot && fs.existsSync(path.join(unpackedRoot, "index.html"))) return unpackedRoot;
  return path.resolve(__dirname, "..");
}

async function createWindow() {
  const url = await startLocalServer();
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 390,
    minHeight: 720,
    title: "SmartRead",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isLocalUrl(targetUrl)) return { action: "allow" };
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (isLocalUrl(targetUrl)) return;
    event.preventDefault();
    shell.openExternal(targetUrl);
  });

  await mainWindow.loadURL(url);
}

function isLocalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.origin === serverUrl;
  } catch {
    return false;
  }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(url, response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
      request.setTimeout(1000, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for SmartRead local server"));
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

app.whenReady().then(createWindow).catch(error => {
  dialog.showErrorBox("SmartRead 启动失败", error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
