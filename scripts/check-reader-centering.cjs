#!/usr/bin/env node

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const viewports = [
  { name: 'mobile-360', width: 360, height: 780 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'mobile-600', width: 600, height: 960 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-landscape-844', width: 844, height: 390 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 }
];

main().catch(error => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: findBrowserExecutable()
  });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      await mockApi(page);
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.getElementById('bookshelf-view')?.classList.contains('is-booting'));
      const result = await measureReader(page, viewport);
      console.log(`${viewport.name}: ${JSON.stringify(result)}`);
      assert(result.bookCenterDelta <= 1, `${viewport.name} book-content is not centered in reader-main`, result);
      assert(result.mainCenterDelta <= 1, `${viewport.name} reader-main has unexpected centering drift`, result);
      if (viewport.width <= 1024) {
        assert(result.bookLeftDelta <= 1 && result.bookRightDelta <= 1, `${viewport.name} mobile book-content does not fill reader-main symmetrically`, result);
        assert(result.bottomInsetIgnoresAiStart, `${viewport.name} image page still reserves extra AI start space`, result);
      } else {
        assert(result.panelOpen, `${viewport.name} desktop panel should be open by default`, result);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  const fs = require('node:fs');
  return candidates.find(file => fs.existsSync(file));
}

async function measureReader(page, viewport) {
  await page.evaluate(() => {
    const reader = document.getElementById('reader-view');
    const bookshelf = document.getElementById('bookshelf-view');
    const panel = document.getElementById('right-panel');
    bookshelf?.classList.remove('active');
    reader?.classList.add('active');
    panel?.classList.toggle('collapsed', window.innerWidth <= 1024);
    App.syncRightPanelAccessibility();
    App.setMobileReaderChromeVisible(window.innerWidth <= 1024);
    App.updateAITTSControls();

    const book = document.getElementById('book-content');
    book.className = 'book-text book-epub';
    book.innerHTML = '<iframe id="test-epub-frame" style="width:100%;height:100%;border:0;display:block"></iframe>';
    const frame = document.getElementById('test-epub-frame');
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><body class="smartread-epub-image-page" style="margin:0;padding:5px">
      <img id="test-cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='900'%3E%3Crect width='600' height='900' fill='%235a9a9d'/%3E%3C/svg%3E" style="max-width:100%;max-height:100%;object-fit:contain;display:block">
    </body></html>`);
    doc.close();
    App.syncMobileReaderInsets();
  });
  await page.waitForTimeout(80);

  return page.evaluate(() => {
    const main = document.querySelector('.reader-main').getBoundingClientRect();
    const book = document.getElementById('book-content').getBoundingClientRect();
    const panel = document.getElementById('right-panel');
    const toolbar = document.getElementById('mobile-reader-toolbar')?.getBoundingClientRect();
    const start = document.getElementById('btn-mobile-ai-start')?.getBoundingClientRect();
    const view = document.getElementById('reader-view');
    const inset = parseFloat(getComputedStyle(view).getPropertyValue('--reader-bottom-inset')) || 0;
    const expectedToolbarInset = toolbar ? Math.ceil(window.innerHeight - toolbar.top + 16) : 0;
    const aiStartWouldInset = start ? Math.ceil(window.innerHeight - start.top + 16) : 0;
    return {
      viewportWidth: window.innerWidth,
      mainLeft: Math.round(main.left * 100) / 100,
      mainRight: Math.round(main.right * 100) / 100,
      bookLeft: Math.round(book.left * 100) / 100,
      bookRight: Math.round(book.right * 100) / 100,
      mainCenterDelta: Math.abs(((main.left + main.right) / 2) - ((book.left + book.right) / 2)),
      bookCenterDelta: Math.abs(((book.left + book.right) / 2) - ((main.left + main.right) / 2)),
      bookLeftDelta: Math.abs(book.left - main.left),
      bookRightDelta: Math.abs(book.right - main.right),
      readerBottomInset: inset,
      expectedToolbarInset,
      aiStartWouldInset,
      bottomInsetIgnoresAiStart: aiStartWouldInset <= expectedToolbarInset || Math.abs(inset - expectedToolbarInset) <= 1,
      panelOpen: !!panel && !panel.classList.contains('collapsed')
    };
  });
}

async function mockApi(page) {
  await page.route('**/api/auth/config**', route => route.fulfill({ json: {
    zlibRegisterUrl: '',
    zlibMirror: '',
    zlibEgress: 'direct',
    zlibProxyLabel: null,
    zlibMirrors: [],
    emailDomainWhitelist: [],
    aiDefaults: { baseURL: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.5' }
  }}));
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user: { id: 'test-user', email: 'test@example.local' },
    aiConfigured: false,
    zlibBound: false
  }}));
  await page.route('**/api/books', route => route.fulfill({ json: { books: [] } }));
}

function startServer() {
  const child = spawn(process.execPath, [
    path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(ROOT, 'server', 'index.ts')
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(PORT),
      SMARTREAD_DEPLOYMENT: 'desktop'
    },
    stdio: 'ignore'
  });

  return waitForServer().then(() => child).catch(error => {
    child.kill();
    throw error;
  });
}

function waitForServer() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${BASE_URL}/api/health`, res => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > 20000) reject(new Error('Timed out waiting for test server'));
      else setTimeout(tick, 250);
    };
    tick();
  });
}

function assert(condition, message, detail) {
  if (condition) return;
  const error = new Error(message);
  error.detail = detail;
  throw error;
}
