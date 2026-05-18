const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "dist", "server", "index.js");

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error("dist/server/index.js not found. Run npm run build before desktop smoke test.");
  }

  const port = await findOpenPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-desktop-smoke-"));
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      SMARTREAD_DEPLOYMENT: "desktop",
      SMARTREAD_DESKTOP: "1",
      SMARTREAD_DATA_DIR: dataDir,
      SMARTREAD_BOOK_SOURCE: "mock",
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const config = await waitForJson(`${baseUrl}/api/auth/config`, 12000);
    assert(config.zlibRegisterUrl, "missing zlibRegisterUrl");
    assert(config.zlibMirror, "missing zlibMirror");
    assert(config.zlibEgress, "missing zlibEgress");

    const rootPage = await requestText(`${baseUrl}/`);
    assert(rootPage.includes("SmartRead") || rootPage.includes("智读"), "desktop server did not serve app HTML");

    console.log(`desktop smoke ok: ${baseUrl}`);
  } finally {
    await stopChild(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (stderr && child.exitCode && child.exitCode !== 0) console.error(stderr);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const text = await requestText(url);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode >= 500) {
          reject(new Error(`${url} returned HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    request.on("error", reject);
    request.setTimeout(1000, () => {
      request.destroy(new Error(`${url} timed out`));
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stopChild(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}
