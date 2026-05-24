const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const { _electron: electron } = require("playwright");

const root = path.resolve(__dirname, "..");
const exePath = process.env.SMARTREAD_TEST_EXE || path.join(root, "release", "win-unpacked", "SmartRead.exe");
const outDir = process.env.SMARTREAD_TEST_ARTIFACT_DIR || path.join(root, "test-artifacts", "packaged-desktop-epub-image-touch");
const samplePath = path.join(outDir, "image-touch-sample.epub");

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(exePath)) throw new Error(`Packaged app not found: ${exePath}`);
  fs.mkdirSync(outDir, { recursive: true });
  await writeSampleEpub(samplePath);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-epub-touch-data-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-epub-touch-user-"));
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
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.waitForFunction(
      () => document.getElementById("bookshelf-view")?.classList.contains("is-authenticated")
        && window.SmartReadDesktop?.appMode === "desktop",
      null,
      { timeout: 60000 }
    );
    await importSampleBook(page, samplePath);
    await page.waitForSelector(".book-card", { timeout: 15000 });
    const result = {
      routing: {
        shelfBeforeEpub: await app.evaluate(({ BrowserWindow }) => {
          const webContents = BrowserWindow.getAllWindows()[0].webContents;
          webContents.setZoomFactor(1.2);
          return webContents.getZoomFactor();
        })
      }
    };

    await page.locator(".book-card").first().click();
    await page.waitForFunction(
      () => Reader.book?.type === "epub"
        && Reader.epubLayoutReady
        && Reader.isDesktopEpubImagePageActive?.()
        && document.getElementById("book-content")?.classList.contains("desktop-epub-visual")
        && document.querySelector("#book-content iframe")?.contentDocument?.body?.classList.contains("smartread-desktop-epub-image-page"),
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(() => App.desktopPdfZoomRoutingEnabled === true, null, { timeout: 10000 });
    await waitForDesktopEpubImageFrame(page);

    result.routing.epubShell = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    result.initial = await page.evaluate(() => {
      const stage = document.getElementById("book-content");
      const frame = stage.querySelector("iframe");
      const doc = frame.contentDocument;
      return {
        active: Reader.isDesktopEpubImagePageActive(),
        visual: stage.classList.contains("desktop-epub-visual"),
        frameClass: doc.body.classList.contains("smartread-desktop-epub-image-page"),
        zoom: Reader.epubZoom
      };
    });

    result.nativeDrag = await page.evaluate(() => {
      const doc = document.querySelector("#book-content iframe").contentDocument;
      const target = doc.querySelector("img");
      const eventResult = event => {
        const allowed = target.dispatchEvent(event);
        return { allowed, defaultPrevented: event.defaultPrevented };
      };
      return {
        dragstart: eventResult(new Event("dragstart", { bubbles: true, cancelable: true })),
        selectstart: eventResult(new Event("selectstart", { bubbles: true, cancelable: true })),
        mousedown: eventResult(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 220, clientY: 280 }))
      };
    });

    await page.locator("#btn-magnifier").click();
    await page.waitForTimeout(80);
    result.button = await page.evaluate(() => ({
      zoom: Reader.epubZoom,
      lens: Magnifier.enabled,
      mode: document.getElementById("reader-view").classList.contains("magnifier-mode"),
      zoomed: document.getElementById("book-content").classList.contains("desktop-epub-zoomed")
    }));

    result.doubleTap = await page.evaluate(() => {
      Reader.setDesktopEpubZoom(1, Reader.getDesktopEpubViewportCenter());
      const doc = document.querySelector("#book-content iframe").contentDocument;
      const target = doc.querySelector("img");
      const rect = target.getBoundingClientRect();
      const x = rect.left + Math.min(260, rect.width / 2);
      const y = rect.top + Math.min(320, rect.height / 2);
      const dispatch = (type, id) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: "touch",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y
      }));
      dispatch("pointerdown", 21);
      dispatch("pointerup", 21);
      dispatch("pointerdown", 22);
      dispatch("pointerup", 22);
      return {
        zoom: Reader.epubZoom,
        lens: Magnifier.enabled,
        mode: document.getElementById("reader-view").classList.contains("magnifier-mode")
      };
    });

    result.pinch = await page.evaluate(() => {
      Reader.setDesktopEpubZoom(1, Reader.getDesktopEpubViewportCenter());
      const doc = document.querySelector("#book-content iframe").contentDocument;
      const target = doc.querySelector("img");
      const rect = target.getBoundingClientRect();
      const y = rect.top + Math.min(330, rect.height / 2);
      const dispatch = (type, id, x) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: "touch",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y
      }));
      dispatch("pointerdown", 31, rect.left + 260);
      dispatch("pointerdown", 32, rect.left + 360);
      dispatch("pointermove", 31, rect.left + 140);
      dispatch("pointermove", 32, rect.left + 480);
      dispatch("pointerup", 31, rect.left + 140);
      dispatch("pointerup", 32, rect.left + 480);
      const stage = document.getElementById("book-content");
      return {
        zoom: Reader.epubZoom,
        rangeX: stage.scrollWidth - stage.clientWidth,
        rangeY: stage.scrollHeight - stage.clientHeight,
        lens: Magnifier.enabled
      };
    });

    result.pan = await page.evaluate(() => {
      Reader.setDesktopEpubZoom(2, Reader.getDesktopEpubViewportCenter());
      const stage = document.getElementById("book-content");
      stage.scrollLeft = Math.floor((stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.floor((stage.scrollHeight - stage.clientHeight) / 2);
      const before = { left: stage.scrollLeft, top: stage.scrollTop, zoom: Reader.epubZoom };
      const doc = stage.querySelector("iframe").contentDocument;
      const target = doc.querySelector("img");
      const rect = target.getBoundingClientRect();
      const x = rect.left + Math.min(380, rect.width / 2);
      const y = rect.top + Math.min(420, rect.height / 2);
      const dispatch = (type, clientX, clientY) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "touch",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX,
        clientY
      }));
      dispatch("pointerdown", x, y);
      dispatch("pointermove", x - 80, y - 70);
      dispatch("pointerup", x - 80, y - 70);
      return { before, after: { left: stage.scrollLeft, top: stage.scrollTop, zoom: Reader.epubZoom } };
    });

    await page.evaluate(() => {
      Reader.setDesktopEpubZoom(1, Reader.getDesktopEpubViewportCenter());
      App.desktopPointer = Reader.getDesktopEpubViewportCenter();
      App.desktopPdfZoomEventAt = 0;
      Reader.epubNativeZoomBlockedUntil = 0;
    });
    const nativeEvent = await sendNativeZoom(app, "in");
    await page.waitForTimeout(120);
    result.native = {
      epub: await page.evaluate(() => Reader.epubZoom),
      shell: nativeEvent.shell,
      prevented: nativeEvent.prevented
    };

    await page.screenshot({ path: path.join(outDir, "verified.png"), fullPage: true });
    assertResult(result);
    console.log(`desktop EPUB image touch smoke ok (${exePath}): ${JSON.stringify(result)}`);
    passed = true;
  } finally {
    if (!passed && page) await page.screenshot({ path: path.join(outDir, "failure.png"), fullPage: true }).catch(() => {});
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function importSampleBook(page, samplePath) {
  const button = page.locator("#btn-import:visible, .desktop-empty-copy .btn-primary:visible, #mobile-empty-import-action:visible").first();
  if (await button.count() === 0) throw new Error("Packaged app did not expose a visible import control");
  const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
  await button.click();
  await (await chooser).setFiles(samplePath);
}

async function sendNativeZoom(app, direction) {
  return app.evaluate(({ BrowserWindow }, value) => {
    const webContents = BrowserWindow.getAllWindows()[0].webContents;
    let prevented = false;
    webContents.emit("zoom-changed", { preventDefault() { prevented = true; } }, value);
    return { prevented, shell: webContents.getZoomFactor() };
  }, direction);
}

async function waitForDesktopEpubImageFrame(page) {
  await page.waitForFunction(
    () => {
      const frame = document.querySelector("#book-content iframe");
      return !!frame?.contentDocument?.body?.classList.contains("smartread-desktop-epub-image-page");
    },
    null,
    { timeout: 10000 }
  );
  await page.waitForTimeout(250);
  await page.waitForFunction(
    () => {
      const frame = document.querySelector("#book-content iframe");
      return !!frame?.contentDocument?.body?.classList.contains("smartread-desktop-epub-image-page");
    },
    null,
    { timeout: 10000 }
  );
}

function assertResult(result) {
  const panChanged = result.pan.after.left !== result.pan.before.left
    || result.pan.after.top !== result.pan.before.top;
  const pass = result.initial.active && result.initial.visual && result.initial.frameClass
    && result.routing.shelfBeforeEpub > 1
    && result.routing.epubShell === 1
    && result.nativeDrag.dragstart.defaultPrevented && !result.nativeDrag.dragstart.allowed
    && result.nativeDrag.selectstart.defaultPrevented && !result.nativeDrag.selectstart.allowed
    && result.nativeDrag.mousedown.defaultPrevented && !result.nativeDrag.mousedown.allowed
    && result.button.zoom === 2 && !result.button.lens && !result.button.mode && result.button.zoomed
    && result.doubleTap.zoom === 2 && !result.doubleTap.lens && !result.doubleTap.mode
    && result.pinch.zoom > 2 && result.pinch.rangeY > 0 && !result.pinch.lens
    && result.pan.after.zoom === result.pan.before.zoom && panChanged
    && result.native.epub > 1 && result.native.shell === 1 && result.native.prevented;
  if (!pass) throw new Error(`Packaged desktop EPUB image touch validation failed: ${JSON.stringify(result)}`);
}

async function writeSampleEpub(filePath) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file("OPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">smartread-epub-image-touch</dc:identifier>
    <dc:title>SmartRead EPUB image touch test</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="page" href="page.xhtml" media-type="application/xhtml+xml"/>
    <item id="scan" href="images/page.svg" media-type="image/svg+xml"/>
  </manifest>
  <spine><itemref idref="page"/></spine>
</package>`);
  zip.file("OPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>nav</title></head>
  <body><nav epub:type="toc"><ol><li><a href="page.xhtml">Page</a></li></ol></nav></body>
</html>`);
  zip.file("OPS/page.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Scan</title>
    <style>body{margin:0;padding:0} img{display:block;width:900px;height:1300px}</style>
  </head>
  <body><img src="images/page.svg" width="900" height="1300" alt="scan page"/></body>
</html>`);
  zip.file("OPS/images/page.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300" viewBox="0 0 900 1300">
  <rect width="900" height="1300" fill="white"/>
  <rect x="24" y="24" width="852" height="1252" fill="none" stroke="#111" stroke-width="8"/>
  <text x="80" y="120" font-family="Arial, sans-serif" font-size="48" fill="#111">SmartRead image page</text>
  <text x="80" y="190" font-family="Arial, sans-serif" font-size="34" fill="#111">Pinch, drag, no magnifier lens</text>
  <circle cx="220" cy="380" r="110" fill="none" stroke="#111" stroke-width="8"/>
  <path d="M420 300h300v220H420z M460 350h220 M460 410h220 M460 470h160" fill="none" stroke="#111" stroke-width="9"/>
  <path d="M120 720c120-180 220 160 340-20s210-120 310 60" fill="none" stroke="#111" stroke-width="10"/>
  <path d="M120 960h660 M150 1040h520 M180 1120h610" stroke="#111" stroke-width="8"/>
</svg>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(filePath, buffer);
}
