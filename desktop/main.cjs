const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, shell, session, ipcMain } = require("electron");

let mainWindow = null;
let serverProcess = null;
let serverUrl = "";
let serverLogPath = "";
const desktopStartedAt = Date.now();
const desktopLogBuffer = [];
const speechRecognitionProcesses = new Map();

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
  flushDesktopLogBuffer();
  writeDesktopLog(`Starting local server on 127.0.0.1:${port}`);
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
  writeDesktopLog(`Local server healthy at ${serverUrl}`);
  return serverUrl;
}

function writeServerLog(stream, chunk) {
  const text = `[${new Date().toISOString()}] [${stream}] ${String(chunk)}`;
  if (stream === "stderr") console.error(text.trimEnd());
  else console.log(text.trimEnd());
  if (!serverLogPath) return;
  fs.appendFile(serverLogPath, text, () => {});
}

function writeDesktopLog(message) {
  const text = `[desktop +${Date.now() - desktopStartedAt}ms] ${message}`;
  if (!serverLogPath) {
    desktopLogBuffer.push(text);
    return;
  }
  writeServerLog("desktop", `${text}\n`);
}

function flushDesktopLogBuffer() {
  while (desktopLogBuffer.length) {
    writeServerLog("desktop", `${desktopLogBuffer.shift()}\n`);
  }
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
  writeDesktopLog("Creating main window");
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 390,
    minHeight: 720,
    title: "SmartRead",
    show: false,
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

  await mainWindow.loadURL(startupUrl());
  writeDesktopLog("Startup page rendered");
  if (!mainWindow.isDestroyed()) {
    mainWindow.show();
    writeDesktopLog("Main window shown");
  }
  const url = await startLocalServer();
  writeDesktopLog(`Loading app shell from ${url}`);
  loadWindowWithRetry(mainWindow, url);
}

function isLocalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.origin === serverUrl;
  } catch {
    return false;
  }
}

function configureDesktopPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents.getURL();
    callback(isLocalUrl(requestingUrl) && isMicrophonePermission(permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestingUrl = requestingOrigin || details?.requestingUrl || webContents.getURL();
    return isLocalUrl(requestingUrl) && isMicrophonePermission(permission, details);
  });
}

function configureLocalSpeechRecognition() {
  ipcMain.handle("smartread:speech-recognize", async (event, options = {}) => {
    const requestingUrl = event.senderFrame?.url || event.sender.getURL();
    if (!isLocalUrl(requestingUrl)) {
      return { ok: false, code: "unauthorized", error: "语音输入只允许 SmartRead 本地页面调用" };
    }
    if (process.platform !== "win32") {
      return { ok: false, code: "unsupported-platform", error: "本地语音输入当前只支持 Windows 桌面版" };
    }
    const lang = normalizeSpeechLang(options.lang);
    return runWindowsSpeechRecognition(event.sender.id, lang);
  });

  ipcMain.handle("smartread:speech-recognize-cancel", (event) => {
    cancelSpeechRecognition(event.sender.id);
    return { ok: true };
  });
}

function normalizeSpeechLang(lang) {
  const value = String(lang || "").trim();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(value) ? value : "zh-CN";
}

function cancelSpeechRecognition(senderId) {
  const child = speechRecognitionProcesses.get(senderId);
  if (child && !child.killed) child.kill();
  speechRecognitionProcesses.delete(senderId);
}

function runWindowsSpeechRecognition(senderId, lang) {
  cancelSpeechRecognition(senderId);
  const timeoutMs = 24000;
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_SPEECH_RECOGNITION_SCRIPT
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      SMARTREAD_STT_LANG: lang,
      SMARTREAD_STT_TIMEOUT_SECONDS: "18"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  speechRecognitionProcesses.set(senderId, child);

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cancelSpeechRecognition(senderId);
      resolve({ ok: false, code: "timeout", error: "本地语音识别超时，请重试" });
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      speechRecognitionProcesses.delete(senderId);
      resolve({ ok: false, code: "local-failed", error: error.message });
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      speechRecognitionProcesses.delete(senderId);
      const text = stdout.trim();
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({
          ok: false,
          code: "local-failed",
          error: stderr.trim() || text || "本地语音识别没有返回有效结果"
        });
      }
    });
  });
}

const WINDOWS_SPEECH_RECOGNITION_SCRIPT = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
function Write-JsonResult($value) {
  $value | ConvertTo-Json -Compress -Depth 5 | Write-Output
}
try {
  Add-Type -AssemblyName System.Speech
  $lang = if ($env:SMARTREAD_STT_LANG) { $env:SMARTREAD_STT_LANG } else { "zh-CN" }
  $timeoutSeconds = 18
  if ($env:SMARTREAD_STT_TIMEOUT_SECONDS) {
    $parsed = 0
    if ([int]::TryParse($env:SMARTREAD_STT_TIMEOUT_SECONDS, [ref]$parsed)) {
      $timeoutSeconds = [Math]::Max(5, [Math]::Min(60, $parsed))
    }
  }
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo($lang)
  $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  $selected = $recognizers | Where-Object { $_.Culture.Name -ieq $culture.Name } | Select-Object -First 1
  if (-not $selected) {
    $selected = $recognizers | Where-Object { $_.Culture.TwoLetterISOLanguageName -ieq $culture.TwoLetterISOLanguageName } | Select-Object -First 1
  }
  if (-not $selected) {
    Write-JsonResult ([pscustomobject]@{
      ok = $false
      code = "missing-recognizer"
      error = "Windows 未安装匹配的本地语音识别器"
      requested = $culture.Name
      installed = @($recognizers | ForEach-Object { "$($_.Culture.Name) $($_.Name)" })
    })
    exit 0
  }

  $engine = $null
  try {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList $selected
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    $engine.SetInputToDefaultAudioDevice()
    $result = $engine.Recognize([TimeSpan]::FromSeconds($timeoutSeconds))
    if ($null -eq $result) {
      Write-JsonResult ([pscustomobject]@{
        ok = $false
        code = "no-speech"
        error = "没有识别到语音"
        recognizer = $selected.Name
        lang = $selected.Culture.Name
      })
    } else {
      Write-JsonResult ([pscustomobject]@{
        ok = $true
        text = $result.Text
        confidence = $result.Confidence
        recognizer = $selected.Name
        lang = $selected.Culture.Name
      })
    }
  } finally {
    if ($engine) { $engine.Dispose() }
  }
} catch {
  $message = $_.Exception.Message
  $code = "local-failed"
  if ($message -match "audio|microphone|input|device") { $code = "audio-capture" }
  Write-JsonResult ([pscustomobject]@{
    ok = $false
    code = $code
    error = $message
  })
}
`;

function isMicrophonePermission(permission, details) {
  if (permission === "microphone") return true;
  if (permission !== "media") return false;
  const mediaTypes = details?.mediaTypes;
  return !Array.isArray(mediaTypes) || mediaTypes.includes("audio");
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

function startupUrl() {
  const logoPath = path.join(resolveFrontendDir(), "images", "biaoge-logo.png");
  const logoDataUrl = fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
    : "";
  const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>表哥智读 SmartRead</title>
<style>
  :root { color-scheme: light; font-family: "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: #17120f; }
  main { width: min(420px, calc(100vw - 48px)); text-align: center; }
  .logo { display: block; width: 72px; height: 72px; margin: 0 auto 20px; object-fit: contain; }
  .brand { color: #b20d23; font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: 0; }
  h1 { margin: 18px 0 8px; font-size: 20px; font-weight: 600; line-height: 1.35; letter-spacing: 0; }
  p { margin: 0; color: #5e4934; font-size: 14px; line-height: 1.55; }
  .bar { margin-top: 28px; height: 4px; border-radius: 999px; background: #f1e3e6; overflow: hidden; }
  .bar::before { content: ""; display: block; width: 38%; height: 100%; border-radius: inherit; background: #b20d23; animation: move 1.15s ease-in-out infinite; }
  @keyframes move { 0% { transform: translateX(-100%); } 100% { transform: translateX(270%); } }
</style>
<main>
  ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="">` : ""}
  <div class="brand">表哥智读</div>
  <h1>正在启动</h1>
  <p>正在进入本机书架</p>
  <div class="bar" aria-hidden="true"></div>
</main>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadWindowWithRetry(window, url) {
  let attempts = 0;
  let loaded = false;

  const tryLoad = async () => {
    attempts += 1;
    try {
      await waitForServer(`${url}/api/health`, 5000);
    } catch (error) {
      handleWindowLoadFailure(window, url, attempts, error, tryLoad);
      return;
    }
    if (window.isDestroyed()) return;
    window.loadURL(url).catch(error => {
      writeServerLog("stderr", `Window load promise attempt ${attempts} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  };

  window.webContents.on("did-finish-load", () => {
    loaded = true;
  });
  window.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || loaded || window.isDestroyed() || errorCode === -3) return;
    handleWindowLoadFailure(window, validatedURL || url, attempts, new Error(`${errorDescription} (${errorCode}) loading '${validatedURL || url}'`), tryLoad);
  });

  tryLoad();
}

function handleWindowLoadFailure(window, url, attempts, error, retry) {
  writeServerLog("stderr", `Window load attempt ${attempts} failed: ${error instanceof Error ? error.message : String(error)}\n`);
  if (attempts < 3 && !window.isDestroyed()) {
    setTimeout(retry, 500);
    return;
  }
  dialog.showErrorBox("SmartRead 启动失败", error instanceof Error ? error.message : String(error));
  app.quit();
}

app.whenReady().then(() => {
  configureDesktopPermissions();
  configureLocalSpeechRecognition();
  return createWindow();
}).catch(error => {
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
