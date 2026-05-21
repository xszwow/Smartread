#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const BASE_URL = process.env.SMARTREAD_BASE_URL || 'http://127.0.0.1:4173';
const ROOT = path.resolve(__dirname, '..');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const OUT_DIR = path.join(ROOT, 'test-artifacts', `mobile-empty-shelf-${STAMP}`);

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 844 };

const scenarioUser = { id: 'usr-playwright-empty-shelf', email: 'playwright-empty-shelf@example.test' };
const restoredBooks = [
  {
    id: 'srv-restored-1',
    title: '移动空书架回归样本',
    sourceId: 'mock://zlib/restored-1',
    extension: 'txt',
    mimeType: 'text/plain',
    progress: 38,
    currentPage: 3,
    totalPages: 8,
    lastRead: Date.now() - 120000,
    addedAt: Date.now() - 3600000,
    coverUrl: null
  },
  {
    id: 'srv-restored-2',
    title: 'Z-Library 恢复书籍',
    sourceId: 'mock://zlib/restored-2',
    extension: 'epub',
    mimeType: 'application/epub+zip',
    progress: 0,
    currentPage: 0,
    totalPages: 0,
    lastRead: 0,
    addedAt: Date.now() - 7200000,
    coverUrl: null
  }
];
const unreadBooks = restoredBooks.map((book, index) => ({
  ...book,
  id: `srv-unread-${index + 1}`,
  sourceId: `mock://zlib/unread-${index + 1}`,
  progress: 0,
  currentPage: 0,
  totalPages: 0,
  lastRead: 0,
  addedAt: Date.now() - (index + 1) * 1800000
}));

const scenarios = [
  {
    id: '01-390x844-guest-empty',
    viewport: MOBILE,
    auth: false,
    zlibBound: false,
    books: [],
    checks: ['guest-empty']
  },
  {
    id: '02-390x844-auth-empty-unbound',
    viewport: MOBILE,
    auth: true,
    zlibBound: false,
    books: [],
    expectedPrimary: 'continue',
    checks: ['metro-home', 'import-page', 'online-page', 'account-page', 'mobile-settings', 'zlib-unbound']
  },
  {
    id: '03-390x844-auth-empty-bound',
    viewport: MOBILE,
    auth: true,
    zlibBound: true,
    books: [],
    expectedPrimary: 'continue',
    checks: ['metro-home', 'online-page', 'zlib-bound']
  },
  {
    id: '04-390x844-auth-books-unread',
    viewport: MOBILE,
    auth: true,
    zlibBound: true,
    books: unreadBooks,
    expectedPrimary: 'continue',
    checks: ['metro-home', 'library-page', 'online-page', 'account-page']
  },
  {
    id: '05-390x844-restored-shelf-recent',
    viewport: MOBILE,
    auth: true,
    zlibBound: true,
    books: restoredBooks,
    expectedPrimary: 'continue',
    checks: ['metro-home', 'continue-opens-reader', 'mobile-settings']
  },
  {
    id: '06-1280x844-desktop-auth-empty-regression',
    viewport: DESKTOP,
    auth: true,
    zlibBound: false,
    books: [],
    checks: ['auth-empty', 'desktop-regression']
  }
];

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
}

function requestOk(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function canAutoStartServer(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function ensurePreviewServer() {
  if (await requestOk(BASE_URL)) {
    return { started: false, stop: async () => {} };
  }
  if (process.env.SMARTREAD_E2E_NO_AUTOSTART === '1' || !canAutoStartServer(BASE_URL)) {
    assert(false, `无法访问 ${BASE_URL}。请先启动本地预览服务。`);
  }

  const parsed = new URL(BASE_URL);
  const serverEntry = path.join(ROOT, 'dist', 'server', 'index.js');
  assert(fs.existsSync(serverEntry), '缺少 dist/server/index.js，请先运行 npm run build。');

  const logDir = path.join(ROOT, 'test-artifacts', 'mobile-e2e-server');
  fs.mkdirSync(logDir, { recursive: true });
  const stdout = fs.createWriteStream(path.join(logDir, 'server.out.log'), { flags: 'w' });
  const stderr = fs.createWriteStream(path.join(logDir, 'server.err.log'), { flags: 'w' });
  const server = spawn(process.execPath, [serverEntry], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname,
      PORT: parsed.port || '4173'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(stdout);
  server.stderr.pipe(stderr);

  let exitInfo = null;
  server.once('exit', (code, signal) => {
    exitInfo = { code, signal };
  });

  for (let i = 0; i < 40; i += 1) {
    if (await requestOk(BASE_URL)) {
      return {
        started: true,
        stop: async () => {
          if (!server.killed && server.exitCode === null) server.kill();
          stdout.end();
          stderr.end();
        }
      };
    }
    if (exitInfo) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!server.killed && server.exitCode === null) server.kill();
  stdout.end();
  stderr.end();
  const detail = exitInfo ? `本地预览服务提前退出：${exitInfo.code ?? exitInfo.signal}` : '本地预览服务启动超时';
  assert(false, `${detail}。日志：${logDir}`);
}

async function launchBrowser() {
  try {
    return {
      browser: await chromium.launch({ channel: 'msedge', headless: true }),
      browserName: 'Microsoft Edge'
    };
  } catch (error) {
    return {
      browser: await chromium.launch({ headless: true }),
      browserName: `Playwright Chromium fallback (${error.message.split('\n')[0]})`
    };
  }
}

async function installRoutes(context, scenario) {
  scenario.searchRequests = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== new URL(BASE_URL).origin) {
      if (url.pathname.endsWith('.js')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      }
      return route.abort().catch(() => {});
    }

    if (!url.pathname.startsWith('/api/')) return route.continue();

    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body)
    });

    if (url.pathname === '/api/auth/config') {
      return json({
        zlibRegisterUrl: 'https://z-lib.fm/registration',
        emailDomainWhitelist: [],
        aiDefaults: {
          baseURL: 'http://127.0.0.1:3002/v1/chat/completions',
          model: 'gpt-5.5'
        }
      });
    }

    if (url.pathname === '/api/auth/me') {
      return json({
        user: scenario.auth ? scenarioUser : null,
        aiConfigured: false,
        zlibBound: Boolean(scenario.auth && scenario.zlibBound)
      });
    }

    if (url.pathname === '/api/ai/config/status') {
      return json({ configured: false, keyPreview: '', baseURL: '', model: '' });
    }

    if (url.pathname === '/api/books' && request.method() === 'GET') {
      return json({ books: scenario.auth ? scenario.books : [] });
    }

    if (/^\/api\/books\/[^/]+\/file$/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '第一章\n\n这是移动端继续阅读回归测试内容。'
      });
    }

    if (url.pathname === '/api/book-sources/zlib/bind') {
      scenario.zlibBound = true;
      return json({ ok: true, zlibBound: true, boundEmail: 'zlib@example.test' });
    }

    if (url.pathname === '/api/book-sources/zlib/unbind') {
      scenario.zlibBound = false;
      return json({ ok: true, zlibBound: false });
    }

    if (url.pathname === '/api/zlib/search') {
      const page = Number(url.searchParams.get('page') || '1');
      scenario.searchRequests.push({
        q: url.searchParams.get('q') || '',
        page: String(page),
        format: url.searchParams.get('format') || ''
      });
      return json({
        page,
        totalPages: 3,
        hasNext: page < 3,
        results: [
          {
            sourceId: `mock-search-${page}`,
            title: `在线找书结果 第 ${page} 页`,
            authors: ['SmartRead QA'],
            extension: 'txt',
            year: '2026',
            sizeLabel: '12 KB',
            coverUrl: null
          }
        ]
      });
    }

    return json({ ok: true });
  });
}

async function waitForAppReady(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const view = document.getElementById('bookshelf-view');
    return Boolean(
      typeof App !== 'undefined'
      && typeof Bookshelf !== 'undefined'
      && view
      && !view.classList.contains('is-booting')
    );
  }, null, { timeout: 15000 });
  await page.waitForTimeout(250);
}

async function screenshot(page, name, options = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  return file;
}

async function screenshotPair(page, name) {
  return {
    viewport: await screenshot(page, `${name}-viewport`),
    fullPage: await screenshot(page, `${name}-fullpage`, { fullPage: true })
  };
}

async function isVisibleInViewport(page, selector) {
  return page.evaluate((target) => {
    const el = document.querySelector(target);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.top < window.innerHeight
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || '1') > 0;
  }, selector);
}

async function assertNoHorizontalScroll(page) {
  const result = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const width = window.innerWidth;
    const offenders = Array.from(document.querySelectorAll('body *')).flatMap((el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      if (rect.right > width + 1 || rect.left < -1) {
        return [{
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: String(el.className || '').slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        }];
      }
      return [];
    }).slice(0, 8);
    return {
      viewportWidth: width,
      rootScrollWidth: root.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bookshelfScrollWidth: document.getElementById('bookshelf-view')?.scrollWidth || 0,
      offenders
    };
  });

  assert(result.rootScrollWidth <= result.viewportWidth + 1, '页面出现横向滚动', result);
  assert(result.bodyScrollWidth <= result.viewportWidth + 1, 'body 出现横向滚动', result);
  assert(result.bookshelfScrollWidth <= result.viewportWidth + 1, '书架容器出现横向滚动', result);
  assert(result.offenders.length === 0, '存在越界可见元素', result);
  return result;
}

async function assertFirstScreenClean(page, scenario) {
  const result = await page.evaluate(() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const inFirstScreen = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    };
    return {
      bookshelfActive: document.getElementById('bookshelf-view')?.classList.contains('active'),
      readerActive: document.getElementById('reader-view')?.classList.contains('active'),
      loadingVisible: visible('#loading-overlay'),
      settingsOpen: document.getElementById('settings-panel')?.classList.contains('open'),
      headerInFirstScreen: inFirstScreen('.app-header'),
      mobileBrandInFirstScreen: visible('.mobile-empty-brand') && inFirstScreen('.mobile-empty-brand'),
      emptyInFirstScreen: inFirstScreen('#empty-state'),
      cloudInFirstScreen: inFirstScreen('#cloud-section'),
      searchInFirstScreen: visible('.search-box') && inFirstScreen('.search-box'),
      statsInFirstScreen: visible('#stats-panel') && inFirstScreen('#stats-panel'),
      mobileActionsVisible: visible('#mobile-home-actions'),
      mobileActionsInFirstScreen: visible('#mobile-home-actions') && inFirstScreen('#mobile-home-actions'),
      mobileDashboardVisible: visible('#mobile-dashboard-state'),
      mobileDashboardHomeVisible: visible('#mobile-dashboard-home'),
      metroGridVisible: visible('#mobile-metro-grid'),
      onlineDetailVisible: visible('#mobile-empty-online-source'),
      servicesDetailVisible: visible('#mobile-empty-services'),
      visibleContinueInFirstScreen: Array.from(document.querySelectorAll('body *')).some((el) => {
        if (!el.childElementCount && el.textContent?.includes('继续阅读')) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0
            && style.display !== 'none' && style.visibility !== 'hidden';
        }
        return false;
      }),
      bookCards: document.querySelectorAll('.book-card:not(.book-placeholder)').length,
      text: document.body.innerText
    };
  });

  assert(result.bookshelfActive, '书架视图不是 active', result);
  assert(!result.readerActive, '阅读器不应在书架检查中 active', result);
  assert(!result.loadingVisible, '首屏仍有 loading overlay', result);
  assert(!result.settingsOpen, '首屏不应打开设置面板', result);
  if (scenario.viewport.width <= 430 && scenario.auth) {
    assert(result.mobileBrandInFirstScreen, '移动已登录首页首屏缺少应用名称', result);
  } else {
    assert(result.headerInFirstScreen, '首屏缺少应用 header', result);
  }
  if (!scenario.auth) {
    assert(result.cloudInFirstScreen, '未登录状态首屏缺少登录区域', result);
    assert(/登录(?:表哥)?智读/.test(result.text), '未登录状态缺少登录提示', result);
  } else {
    assert(result.emptyInFirstScreen || scenario.books.length > 0 || scenario.viewport.width <= 430, '空书架提示没有出现在首屏', result);
  }
  if (scenario.auth && !scenario.books.length) assert(result.bookCards === 0, '空书架状态不应出现真实书卡', result);
  if (scenario.auth && scenario.viewport.width <= 430) {
    assert(result.mobileDashboardVisible, '移动已登录首页缺少 #mobile-dashboard-state', result);
    assert(result.mobileDashboardHomeVisible, '移动已登录首页缺少磁贴主页', result);
    assert(result.metroGridVisible, '移动已登录首页缺少 Metro 磁贴 grid', result);
    assert(!result.searchInFirstScreen, '移动磁贴首页首屏不应显示 .search-box', result);
    assert(!result.statsInFirstScreen, '移动磁贴首页首屏不应显示 #stats-panel', result);
    assert(!result.mobileActionsInFirstScreen, '移动磁贴首页不应显示旧 #mobile-home-actions', result);
    assert(!result.onlineDetailVisible, '移动磁贴首页不应直接展开在线书源详情', result);
    assert(!result.servicesDetailVisible, '移动磁贴首页不应直接展开账号服务详情', result);
    if (!scenario.books.length) assert(!result.visibleContinueInFirstScreen, '无书状态首屏不应显示继续阅读', result);
  }
  return result;
}

async function ensureMobileHome(page) {
  const back = page.locator('#mobile-empty-back');
  if (await back.isVisible({ timeout: 500 }).catch(() => false)) {
    await back.click({ timeout: 5000 });
  }
  await page.waitForSelector('#mobile-dashboard-home', { state: 'visible', timeout: 5000 });
}

async function assertMetroDashboard(page, scenario) {
  await ensureMobileHome(page);
  const result = await page.evaluate((expectedPrimary) => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const tiles = Array.from(document.querySelectorAll('.mobile-metro-tile')).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        key: el.getAttribute('data-mobile-tile'),
        area: Math.round(rect.width * rect.height),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        primary: el.classList.contains('is-primary'),
        text: el.innerText
      };
    });
    const largest = [...tiles].sort((a, b) => b.area - a.area)[0] || null;
    const expected = tiles.find((tile) => tile.key === expectedPrimary);
    const grid = document.getElementById('mobile-metro-grid')?.getBoundingClientRect();
    const dashboard = document.getElementById('mobile-dashboard-home')?.getBoundingClientRect();
    return {
      tiles,
      largest,
      expected,
      distinctAreaCount: new Set(tiles.map((tile) => tile.area)).size,
      gridTop: grid ? Math.round(grid.top) : null,
      gridBottom: grid ? Math.round(grid.bottom) : null,
      dashboardHeight: dashboard ? Math.round(dashboard.height) : null,
      viewportHeight: window.innerHeight,
      onlineDetailVisible: visible('#mobile-empty-online-source'),
      servicesDetailVisible: visible('#mobile-empty-services')
    };
  }, scenario.expectedPrimary);

  assert(result.tiles.length >= 4, '磁贴主页入口数量不足', result);
  assert(result.expected?.primary, `主磁贴不是 ${scenario.expectedPrimary}`, result);
  assert(result.largest?.key === scenario.expectedPrimary, `最大磁贴不是 ${scenario.expectedPrimary}`, result);
  assert(result.distinctAreaCount >= 2, '磁贴大小没有明显差异', result);
  assert(result.gridTop !== null && result.gridTop < 170, '磁贴区域没有进入首屏核心位置', result);
  assert(result.gridBottom !== null && result.gridBottom > result.viewportHeight * 0.32, '磁贴区域过短，首屏仍像空白说明页', result);
  assert(!result.onlineDetailVisible && !result.servicesDetailVisible, '主页不应直接展开功能详情', result);
  return result;
}

async function assertTilePageRoundTrip(page, tileKey, selector, expectedText, scenarioId) {
  await ensureMobileHome(page);
  await page.locator(`[data-mobile-tile="${tileKey}"]`).click({ timeout: 5000 });
  await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
  const result = await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    const back = document.getElementById('mobile-empty-back');
    const home = document.getElementById('mobile-dashboard-home');
    return {
      text: target?.innerText || '',
      hasBack: Boolean(back),
      homeVisible: Boolean(home && getComputedStyle(home).display !== 'none')
    };
  }, selector);
  assert(result.hasBack, `${tileKey} 功能页缺少返回上一级`, result);
  assert(!result.homeVisible, `${tileKey} 功能页不应同时显示主页`, result);
  if (expectedText) assert(result.text.includes(expectedText), `${tileKey} 功能页缺少预期内容`, result);
  await screenshotPair(page, `${scenarioId}-${tileKey}-page`);
  await page.locator('#mobile-empty-back').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-dashboard-home', { state: 'visible', timeout: 5000 });
  return result;
}

async function assertImportPage(page, scenarioId) {
  return assertTilePageRoundTrip(page, 'import', '#mobile-empty-import-page', '选择文件导入', scenarioId);
}

async function assertLibraryPage(page, scenario, scenarioId) {
  const result = await assertTilePageRoundTrip(page, 'library', '#mobile-empty-library-page', scenario.books.length ? '打开' : '书架还是空的', scenarioId);
  if (scenario.books.length) {
    assert(result.text.includes('未开始') || result.text.includes('已读'), '书架功能页没有显示阅读状态', result);
  }
  return result;
}

async function assertOnlinePage(page, scenarioId) {
  return assertTilePageRoundTrip(page, 'online', '#mobile-empty-online-source', 'Z-Library', scenarioId);
}

async function assertAccountPage(page, scenarioId) {
  await ensureMobileHome(page);
  await page.locator('[data-mobile-tile="account"]').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-empty-services', { state: 'visible', timeout: 5000 });
  const result = await page.evaluate(() => {
    const section = document.getElementById('mobile-empty-services');
    const text = section?.innerText || '';
    return {
      text,
      hasBack: Boolean(document.getElementById('mobile-empty-back')),
      hasSmartRead: text.includes('SmartRead 账号'),
      hasAIStatus: text.includes('AI') && text.includes('待配置'),
      hasZlibStatus: text.includes('Z-Library') && (text.includes('已绑定') || text.includes('待绑定'))
    };
  });
  assert(result.hasBack, '账号功能页缺少返回上一级', result);
  assert(result.hasSmartRead && result.hasAIStatus && result.hasZlibStatus, '账号功能页服务状态内容不完整', result);
  await screenshotPair(page, `${scenarioId}-account-page`);
  await page.locator('#mobile-empty-back').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-dashboard-home', { state: 'visible', timeout: 5000 });
  return result;
}

async function assertSettingsClick(page, scenarioId) {
  await ensureMobileHome(page);
  await page.locator('[data-mobile-tile="ai"]').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-empty-ai-page', { state: 'visible', timeout: 5000 });
  await page.locator('#mobile-empty-ai-settings').click({ timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('settings-panel')?.classList.contains('open'));
  const visible = await page.locator('#settings-panel').isVisible();
  assert(visible, 'AI 功能页点击设置后没有打开设置面板');
  await screenshotPair(page, `${scenarioId}-settings-open`);
  await page.evaluate(() => App.closeAllPanels());
  await page.waitForFunction(() => !document.getElementById('settings-panel')?.classList.contains('open'), null, { timeout: 5000 });
  const stillOnAI = await page.locator('#mobile-empty-ai-page').isVisible({ timeout: 1000 }).catch(() => false);
  assert(stillOnAI, '关闭设置弹窗后没有停留在 AI 功能页');
  await page.locator('#mobile-empty-back').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-dashboard-home', { state: 'visible', timeout: 5000 });
}

async function openOnlinePage(page) {
  await ensureMobileHome(page);
  await page.locator('[data-mobile-tile="online"]').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-empty-online-source', { state: 'visible', timeout: 5000 });
}

async function assertZlibUnbound(page, scenarioId) {
  await openOnlinePage(page);
  await page.waitForSelector('#mobile-zlib-bind-email', { state: 'visible', timeout: 5000 });
  const result = await page.evaluate(() => ({
    hasBindEmail: Boolean(document.getElementById('mobile-zlib-bind-email')),
    hasBindPassword: Boolean(document.getElementById('mobile-zlib-bind-password')),
    desktopBindEmailVisible: (() => {
      const el = document.getElementById('zlib-bind-email');
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    })(),
    hasBoundCopy: document.body.innerText.includes('绑定 Z-Library'),
    registerHref: document.querySelector('.mobile-zlib-register-link')?.getAttribute('href') || '',
    registerTarget: document.querySelector('.mobile-zlib-register-link')?.getAttribute('target') || '',
    activeId: document.activeElement?.id || ''
  }));
  assert(result.hasBindEmail && result.hasBindPassword, '未绑定状态缺少 Z-Library 绑定输入框', result);
  assert(!result.desktopBindEmailVisible, '移动未绑定状态不应显示桌面 zlib 输入框', result);
  assert(result.hasBoundCopy, '未绑定状态缺少绑定文案', result);
  assert(result.registerHref.startsWith('https://z-lib.fm/registration'), '移动注册 Z-Library 链接缺少正确 href', result);
  assert(result.registerTarget !== '_blank', '移动注册 Z-Library 不应依赖新标签打开', result);
  await screenshotPair(page, `${scenarioId}-zlib-unbound-focus`);
  await page.locator('#mobile-empty-back').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-dashboard-home', { state: 'visible', timeout: 5000 });
  return result;
}

async function assertZlibBound(page, scenario, scenarioId) {
  await openOnlinePage(page);
  await page.waitForSelector('#mobile-cloud-query', { state: 'visible', timeout: 5000 });
  const result = await page.evaluate(() => ({
    hasQuery: Boolean(document.getElementById('mobile-cloud-query')),
    chipLabels: Array.from(document.querySelectorAll('.mobile-format-chip')).map((el) => el.textContent.trim()),
    hasBindEmail: Boolean(document.getElementById('mobile-zlib-bind-email')),
    hasBindPassword: Boolean(document.getElementById('mobile-zlib-bind-password'))
  }));
  assert(result.hasQuery, '已绑定状态缺少在线搜索框', result);
  assert(result.chipLabels.includes('EPUB'), '已绑定状态缺少 EPUB 格式 chip', result);
  assert(!result.hasBindEmail && !result.hasBindPassword, '已绑定状态不应显示 Z-Library 绑定表单', result);
  await page.getByRole('button', { name: 'EPUB' }).click({ timeout: 5000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.mobile-format-chip'))
    .some((el) => el.textContent.trim() === 'EPUB' && el.classList.contains('is-active')));
  await page.locator('#mobile-cloud-query').fill('format epub regression');
  const before = scenario.searchRequests.length;
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/zlib/search?'), { timeout: 5000 });
  await page.locator('.mobile-online-search-card button.mobile-empty-primary').click({ timeout: 5000 });
  await responsePromise;
  const active = await page.evaluate(() => Array.from(document.querySelectorAll('.mobile-format-chip'))
    .some((el) => el.textContent.trim() === 'EPUB' && el.classList.contains('is-active')));
  const request = scenario.searchRequests.slice(before).at(-1);
  assert(active, '点击 EPUB chip 后未保持 active', result);
  assert(request?.format === 'epub', '点击 EPUB chip 后搜索请求没有携带 format=epub', { request, requests: scenario.searchRequests });
  const resultLayout = await page.evaluate(() => {
    const card = document.querySelector('.mobile-empty-results .online-result');
    const cover = card?.querySelector('.online-cover');
    const info = card?.querySelector('.online-info');
    const button = card?.querySelector('.download-action');
    if (!card || !cover || !info || !button) return { hasCard: false };
    const cardRect = card.getBoundingClientRect();
    const coverRect = cover.getBoundingClientRect();
    const infoRect = info.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const verticalOverlap = Math.max(0, Math.min(coverRect.bottom, infoRect.bottom, buttonRect.bottom) -
      Math.max(coverRect.top, infoRect.top, buttonRect.top));
    return {
      hasCard: true,
      cardWidth: cardRect.width,
      viewportWidth: window.innerWidth,
      coverLeft: coverRect.left,
      coverRight: coverRect.right,
      infoLeft: infoRect.left,
      infoRight: infoRect.right,
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      verticalOverlap,
      flexDirection: getComputedStyle(card).flexDirection,
      buttonWidth: buttonRect.width
    };
  });
  assert(resultLayout.hasCard, '移动在线搜索后没有渲染结果卡片', resultLayout);
  assert(resultLayout.flexDirection === 'row', '移动在线搜索结果应为图文横排', resultLayout);
  assert(
    resultLayout.coverLeft < resultLayout.infoLeft &&
      resultLayout.infoLeft < resultLayout.buttonLeft &&
      resultLayout.verticalOverlap > 20,
    '移动在线搜索结果封面、文字、按钮没有处在同一行',
    resultLayout
  );
  assert(resultLayout.buttonWidth < 100, '移动在线搜索结果下载按钮不应占满整行', resultLayout);
  assert(resultLayout.cardWidth <= resultLayout.viewportWidth, '移动在线搜索结果卡片发生横向溢出', resultLayout);
  const pager = await page.evaluate(() => {
    const el = document.querySelector('.mobile-search-pager');
    const next = el?.querySelector('[data-mobile-online-page="next"]');
    return {
      visible: Boolean(el && el.offsetParent !== null),
      text: el?.textContent?.trim().replace(/\s+/g, ' ') || '',
      nextDisabled: next ? next.disabled : null
    };
  });
  assert(pager.visible, '移动在线搜索结果缺少分页条', pager);
  assert(pager.text.includes('第 1 / 3 页'), '移动在线搜索结果分页状态不正确', pager);
  assert(pager.nextDisabled === false, '移动在线搜索结果下一页不应禁用', pager);
  const nextBefore = scenario.searchRequests.length;
  const nextResponsePromise = page.waitForResponse((response) => response.url().includes('/api/zlib/search?'), { timeout: 5000 });
  await page.locator('.mobile-search-pager [data-mobile-online-page="next"]').click({ timeout: 5000 });
  await nextResponsePromise;
  const nextRequest = scenario.searchRequests.slice(nextBefore).at(-1);
  assert(nextRequest?.page === '2', '移动在线搜索结果点击下一页没有请求 page=2', { nextRequest, requests: scenario.searchRequests });
  const pageTwo = await page.evaluate(() => ({
    pagerText: document.querySelector('.mobile-search-pager')?.textContent?.trim().replace(/\s+/g, ' ') || '',
    firstTitle: document.querySelector('.mobile-empty-results .online-result h3')?.textContent?.trim() || ''
  }));
  assert(pageTwo.pagerText.includes('第 2 / 3 页'), '移动在线搜索结果下一页后分页状态不正确', pageTwo);
  assert(pageTwo.firstTitle.includes('第 2 页'), '移动在线搜索结果下一页后没有刷新第二页结果', pageTwo);
  await page.locator('#mobile-zlib-rebind').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-zlib-bind-email', { state: 'visible', timeout: 5000 });
  const rebindForm = await page.evaluate(() => ({
    hasEmail: Boolean(document.getElementById('mobile-zlib-bind-email')),
    hasPassword: Boolean(document.getElementById('mobile-zlib-bind-password')),
    hasCancel: Boolean(document.getElementById('mobile-zlib-rebind-cancel')),
    heading: document.querySelector('.mobile-zlib-bind-card h4')?.textContent?.trim() || '',
    searchVisible: Boolean(document.getElementById('mobile-cloud-query')?.offsetParent)
  }));
  assert(rebindForm.hasEmail && rebindForm.hasPassword, '移动已绑定状态点击换绑后缺少新账号表单', rebindForm);
  assert(rebindForm.hasCancel, '移动换绑表单缺少取消换绑', rebindForm);
  assert(rebindForm.heading.includes('换绑'), '移动换绑表单标题不正确', rebindForm);
  assert(!rebindForm.searchVisible, '移动换绑状态不应同时显示搜索框', rebindForm);
  await page.locator('#mobile-zlib-rebind-cancel').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-cloud-query', { state: 'visible', timeout: 5000 });
  await screenshotPair(page, `${scenarioId}-zlib-bound-search`);
  await page.locator('#mobile-empty-back').click({ timeout: 5000 });
  await page.waitForSelector('#mobile-dashboard-home', { state: 'visible', timeout: 5000 });
  return { ...result, request };
}

async function assertContinueOpensReader(page, scenario) {
  await ensureMobileHome(page);
  const title = scenario.books.find((book) => book.lastRead > 0)?.title || '';
  await page.locator('[data-mobile-tile="continue"]').click({ timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('reader-view')?.classList.contains('active'), null, { timeout: 8000 });
  const result = await page.evaluate(() => ({
    readerActive: document.getElementById('reader-view')?.classList.contains('active'),
    bookshelfActive: document.getElementById('bookshelf-view')?.classList.contains('active'),
    readerTitle: document.getElementById('reader-book-title')?.textContent || '',
    bodyText: document.body.innerText
  }));
  assert(result.readerActive && !result.bookshelfActive, '点击继续阅读没有打开阅读器', result);
  assert(!title || result.readerTitle.includes(title) || result.bodyText.includes('移动端继续阅读回归测试内容'), '阅读器没有打开最近阅读书', result);
  return result;
}

async function assertDesktopRegression(page) {
  const result = await page.evaluate(() => ({
    mobileActionsVisible: (() => {
      const el = document.getElementById('mobile-home-actions');
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && !el.classList.contains('hidden');
    })(),
    statsVisible: (() => {
      const el = document.getElementById('stats-panel');
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })(),
    cloudVisible: (() => {
      const el = document.getElementById('cloud-section');
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })(),
    cloudText: document.getElementById('cloud-section')?.innerText || '',
    headerWidth: Math.round(document.querySelector('.app-header')?.getBoundingClientRect().width || 0)
  }));
  assert(!result.mobileActionsVisible, '桌面回归中不应显示移动快捷操作', result);
  assert(result.statsVisible, '桌面回归中统计栏应保持可见', result);
  assert(result.cloudVisible && result.cloudText.includes('在线书源'), '桌面回归中云书源应保持可见', result);
  return result;
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    deviceScaleFactor: scenario.viewport.width <= 430 ? 3 : 1,
    isMobile: scenario.viewport.width <= 430,
    hasTouch: scenario.viewport.width <= 430,
    locale: 'zh-CN'
  });
  await installRoutes(context, scenario);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push(msg.text());
  });
  page.on('pageerror', (error) => logs.push(error.message));

  try {
    await waitForAppReady(page);
    await screenshotPair(page, scenario.id);

    const checks = {
      noHorizontalScroll: await assertNoHorizontalScroll(page),
      firstScreenClean: await assertFirstScreenClean(page, scenario)
    };

    if (scenario.checks.includes('metro-home')) {
      checks.metroHome = await assertMetroDashboard(page, scenario);
    }
    if (scenario.checks.includes('import-page')) {
      checks.importPage = await assertImportPage(page, scenario.id);
    }
    if (scenario.checks.includes('library-page')) {
      checks.libraryPage = await assertLibraryPage(page, scenario, scenario.id);
    }
    if (scenario.checks.includes('online-page')) {
      checks.onlinePage = await assertOnlinePage(page, scenario.id);
    }
    if (scenario.checks.includes('account-page')) {
      checks.accountPage = await assertAccountPage(page, scenario.id);
    }
    if (scenario.checks.includes('mobile-settings')) {
      checks.mobileSettings = await assertSettingsClick(page, scenario.id).then(() => ({ opened: true }));
    }
    if (scenario.checks.includes('zlib-unbound')) {
      checks.zlibUnbound = await assertZlibUnbound(page, scenario.id);
    }
    if (scenario.checks.includes('zlib-bound')) {
      checks.zlibBound = await assertZlibBound(page, scenario, scenario.id);
    }
    if (scenario.checks.includes('continue-opens-reader')) {
      checks.continueOpensReader = await assertContinueOpensReader(page, scenario);
    }
    if (scenario.checks.includes('desktop-regression')) {
      checks.desktopRegression = await assertDesktopRegression(page);
    }

    assert(!logs.length, '页面产生了控制台错误', logs);
    await screenshotPair(page, `${scenario.id}-final`);
    return { id: scenario.id, ok: true, viewport: scenario.viewport, checks, consoleErrors: logs };
  } catch (error) {
    await screenshotPair(page, `${scenario.id}-failure`).catch(() => {});
    return {
      id: scenario.id,
      ok: false,
      viewport: scenario.viewport,
      error: error.message,
      detail: error.detail || null,
      consoleErrors: logs
    };
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const previewServer = await ensurePreviewServer();
  const { browser, browserName } = await launchBrowser();
  const results = [];
  try {
    for (const scenario of scenarios) {
      process.stdout.write(`[mobile-empty-shelf] ${scenario.id} ... `);
      const result = await runScenario(browser, { ...scenario, books: [...scenario.books] });
      results.push(result);
      process.stdout.write(result.ok ? 'ok\n' : `failed: ${result.error}\n`);
    }
  } finally {
    await browser.close();
    await previewServer.stop();
  }

  const summary = {
    baseUrl: BASE_URL,
    browser: browserName,
    createdAt: new Date().toISOString(),
    outputDir: OUT_DIR,
    previewServerStarted: previewServer.started,
    results
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const failures = results.filter((item) => !item.ok);
  process.stdout.write(`[mobile-empty-shelf] artifacts: ${OUT_DIR}\n`);
  if (failures.length) {
    process.stderr.write(`[mobile-empty-shelf] ${failures.length} scenario(s) failed. See summary.json.\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`[mobile-empty-shelf] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
