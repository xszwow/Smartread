const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.resolve(__dirname, "..");
const exePath = process.env.SMARTREAD_TEST_EXE || path.join(root, "release", "win-unpacked", "SmartRead.exe");
const outDir = process.env.SMARTREAD_TEST_ARTIFACT_DIR || path.join(root, "test-artifacts", "packaged-desktop-pdf-touch");
const samplePath = path.join(outDir, "touch-sample.pdf");

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(exePath)) throw new Error(`Packaged app not found: ${exePath}`);
  fs.mkdirSync(outDir, { recursive: true });
  writeSamplePdf(samplePath);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-pdf-touch-data-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-pdf-touch-user-"));
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
        shelfBeforePdf: await app.evaluate(({ BrowserWindow }) => {
          const webContents = BrowserWindow.getAllWindows()[0].webContents;
          webContents.setZoomFactor(1.2);
          return webContents.getZoomFactor();
        })
      }
    };
    await page.locator(".book-card").first().click();
    await page.waitForFunction(
      () => Reader.book?.type === "pdf"
        && Reader.pdfRenderedPage === 0
        && document.getElementById("pdf-page-canvas")?.width > 0,
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(() => App.desktopPdfZoomRoutingEnabled === true, null, { timeout: 10000 });
    await page.waitForTimeout(80);

    result.routing.pdfShell = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    result.render = await page.evaluate(() => {
      const canvas = document.getElementById("pdf-page-canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      const step = Math.max(4, Math.floor(pixels.length / 25000 / 4) * 4);
      for (let i = 0; i < pixels.length; i += step) {
        if (pixels[i] < 238 || pixels[i + 1] < 238 || pixels[i + 2] < 238) ink += 1;
      }
      return { pages: Reader.pdfDoc.numPages, width: canvas.width, height: canvas.height, ink };
    });
    result.nativeDrag = await page.evaluate(() => {
      const canvas = document.getElementById("pdf-page-canvas");
      const rect = canvas.getBoundingClientRect();
      const eventResult = (event) => {
        const allowed = canvas.dispatchEvent(event);
        return { allowed, defaultPrevented: event.defaultPrevented };
      };
      const dragstart = eventResult(new Event("dragstart", { bubbles: true, cancelable: true }));
      const selectstart = eventResult(new Event("selectstart", { bubbles: true, cancelable: true }));
      const pointerdown = eventResult(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 91,
        pointerType: "touch",
        button: 0,
        buttons: 1,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
      Reader.pdfPointerMap.clear();
      Reader.pdfPointerPinchState = null;
      Reader.cancelPdfPan();
      Reader.pdfNativeZoomBlockedUntil = 0;
      return { dragstart, selectstart, pointerdown };
    });

    await page.locator("#btn-magnifier").click();
    result.button = await page.evaluate(() => ({
      zoom: Reader.pdfZoom,
      lens: Magnifier.enabled,
      mode: document.getElementById("reader-view").classList.contains("magnifier-mode")
    }));
    await page.locator("#btn-magnifier").click();

    const canvas = await page.locator("#pdf-page-canvas").boundingBox();
    await page.mouse.dblclick(canvas.x + canvas.width / 2, canvas.y + Math.min(180, canvas.height / 2), { delay: 35 });
    result.doubleClick = await page.evaluate(() => ({
      zoom: Reader.pdfZoom,
      lens: Magnifier.enabled,
      mode: document.getElementById("reader-view").classList.contains("magnifier-mode")
    }));
    await page.locator("#btn-magnifier").click();
    await page.waitForTimeout(180);

    const stage = await page.locator("#pdf-page-stage").boundingBox();
    const center = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await dispatchPinchStart(cdp, center);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        point(center.x - 180, center.y, 1),
        point(center.x + 180, center.y, 2)
      ]
    });
    result.livePinch = await page.evaluate(() => ({
      zoom: Reader.pdfZoom,
      rendering: Reader.pdfIsRendering,
      pendingRender: !!Reader.pdfZoomRenderTimer
    }));
    const beforeDuplicateNative = await page.evaluate(() => Reader.pdfZoom);
    await dispatchCtrlWheel(page, center);
    const duringTouchWheel = await page.evaluate(() => Reader.pdfZoom);
    await sendNativeZoom(app, "in");
    const duringTouchNative = await page.evaluate(() => Reader.pdfZoom);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await dispatchCtrlWheel(page, center);
    const immediateWheel = await page.evaluate(() => Reader.pdfZoom);
    await sendNativeZoom(app, "in");
    const immediateNative = await page.evaluate(() => Reader.pdfZoom);
    await page.waitForTimeout(600);
    result.pinch = await page.evaluate(() => {
      const stage = document.getElementById("pdf-page-stage");
      return {
        zoom: Reader.pdfZoom,
        rangeX: stage.scrollWidth - stage.clientWidth,
        rangeY: stage.scrollHeight - stage.clientHeight,
        lens: Magnifier.enabled,
        rendering: Reader.pdfIsRendering
      };
    });
    result.duplicateNative = { beforeDuplicateNative, duringTouchWheel, duringTouchNative, immediateWheel, immediateNative };

    await page.evaluate(() => {
      const stage = document.getElementById("pdf-page-stage");
      stage.scrollLeft = Math.floor((stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.floor((stage.scrollHeight - stage.clientHeight) / 2);
      window.__pdfPanBefore = { left: stage.scrollLeft, top: stage.scrollTop, zoom: Reader.pdfZoom };
    });
    await touchTap(cdp, center, 3);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(center.x, center.y, 4)] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(center.x - 60, center.y - 70, 4)] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    result.tapDrag = await page.evaluate(() => {
      const stage = document.getElementById("pdf-page-stage");
      return { before: window.__pdfPanBefore, after: { left: stage.scrollLeft, top: stage.scrollTop, zoom: Reader.pdfZoom } };
    });
    await touchTap(cdp, center, 5);
    result.followingTapZoom = await page.evaluate(() => Reader.pdfZoom);

    result.touchFallback = await page.evaluate(() => {
      const center = Reader.getPdfViewportCenter();
      const touches = (spread) => [
        { clientX: center.clientX - spread, clientY: center.clientY },
        { clientX: center.clientX + spread, clientY: center.clientY }
      ];
      const event = (values) => ({ touches: values, preventDefault() {}, stopPropagation() {} });
      Reader.setPdfZoom(1, center);
      Reader.pdfPointerMap.clear();
      Reader.handlePdfPinchStart(event(touches(45)));
      Reader.handlePdfPinchMove(event(touches(145)));
      const live = {
        zoom: Reader.pdfZoom,
        rendering: Reader.pdfIsRendering,
        pendingRender: !!Reader.pdfZoomRenderTimer,
        nativeBlocked: performance.now() < Reader.pdfNativeZoomBlockedUntil
      };
      Reader.handlePdfPinchEnd(event([]));
      return { ...live, renderScheduledOnEnd: !!Reader.pdfZoomRenderTimer };
    });

    await page.evaluate(() => {
      Reader.setPdfZoom(1, Reader.getPdfViewportCenter());
      App.desktopPointer = null;
      App.desktopPdfZoomEventAt = 0;
      Reader.pdfNativeZoomBlockedUntil = 0;
    });
    const nativeEvent = await sendNativeZoom(app, "in");
    await page.waitForTimeout(120);
    result.native = {
      pdf: await page.evaluate(() => Reader.pdfZoom),
      shell: nativeEvent.shell,
      prevented: nativeEvent.prevented
    };
    await page.screenshot({ path: path.join(outDir, "verified.png"), fullPage: true });
    await page.locator("#btn-back").click();
    await page.waitForFunction(() => document.getElementById("bookshelf-view")?.classList.contains("active"), null, { timeout: 10000 });
    await page.waitForTimeout(80);
    const shelfEvent = await sendNativeZoom(app, "in");
    result.routing.shelfAfterPdf = shelfEvent.shell;
    result.routing.shelfEventPrevented = shelfEvent.prevented;

    assertResult(result);
    console.log(`desktop PDF touch smoke ok (${exePath}): ${JSON.stringify(result)}`);
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

async function dispatchPinchStart(cdp, center) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      point(center.x - 55, center.y, 1),
      point(center.x + 55, center.y, 2)
    ]
  });
}

async function touchTap(cdp, center, id) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(center.x, center.y, id)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function dispatchCtrlWheel(page, center) {
  await page.locator("#pdf-page-stage").dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: -120,
    clientX: center.x,
    clientY: center.y
  });
}

function point(x, y, id) {
  return { x, y, id, radiusX: 3, radiusY: 3 };
}

function assertResult(result) {
  const panChanged = result.tapDrag.after.left !== result.tapDrag.before.left
    || result.tapDrag.after.top !== result.tapDrag.before.top;
  const pass = result.render.pages === 1
    && result.render.ink > 0
    && result.nativeDrag.dragstart.defaultPrevented && !result.nativeDrag.dragstart.allowed
    && result.nativeDrag.selectstart.defaultPrevented && !result.nativeDrag.selectstart.allowed
    && result.nativeDrag.pointerdown.defaultPrevented && !result.nativeDrag.pointerdown.allowed
    && result.button.zoom === 2 && !result.button.lens && !result.button.mode
    && result.doubleClick.zoom === 2 && !result.doubleClick.lens && !result.doubleClick.mode
    && result.livePinch.zoom > 2 && !result.livePinch.rendering && !result.livePinch.pendingRender
    && result.pinch.zoom > 2 && result.pinch.rangeY > 0 && !result.pinch.lens && !result.pinch.rendering
    && result.duplicateNative.beforeDuplicateNative === result.duplicateNative.duringTouchWheel
    && result.duplicateNative.beforeDuplicateNative === result.duplicateNative.duringTouchNative
    && result.duplicateNative.beforeDuplicateNative === result.duplicateNative.immediateWheel
    && result.duplicateNative.beforeDuplicateNative === result.duplicateNative.immediateNative
    && result.tapDrag.after.zoom === result.tapDrag.before.zoom && panChanged
    && result.followingTapZoom === result.tapDrag.before.zoom
    && result.touchFallback.zoom > 2 && !result.touchFallback.rendering
    && !result.touchFallback.pendingRender && result.touchFallback.nativeBlocked
    && result.touchFallback.renderScheduledOnEnd
    && result.native.pdf > 1 && result.native.shell === 1 && result.native.prevented
    && Math.abs(result.routing.shelfBeforePdf - 1.2) < 0.005
    && result.routing.pdfShell === 1
    && Math.abs(result.routing.shelfAfterPdf - 1.2) < 0.005
    && !result.routing.shelfEventPrevented;
  if (!pass) throw new Error(`Packaged desktop PDF touch validation failed: ${JSON.stringify(result)}`);
}

function writeSamplePdf(filePath) {
  const stream = "BT\n/F1 34 Tf\n72 700 Td\n(SmartRead PDF touch test) Tj\n0 -54 Td\n/F1 20 Tf\n(Zoom and pan this rendered page.) Tj\nET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(filePath, pdf, "ascii");
}
