/* ===== 阅读器模块 ===== */
const Reader = {
    book: null,
    pages: [],
    currentPage: 0,
    fontSize: 22,
    epubRendition: null,
    epubBook: null,
    epubLayoutReady: false,
    pdfUrl: null,
    pdfDoc: null,
    pdfRenderTask: null,
    pdfRenderId: 0,
    pdfIsRendering: false,
    pdfRenderedPage: null,
    currentLocation: null,
    _tocCache: null,
    isNavigating: false,
    pendingNavDelta: 0,
    readingVersion: 0,
    layoutSyncTimer: null,
    layoutSyncRaf: null,
    layoutSyncTimers: new Set(),
    layoutObserver: null,
    lastLayoutSize: null,
    layoutRedisplayTimer: null,
    epubFontSizeOverride: false,
    serverProgressTimer: null,

    async open(bookId) {
        this.book = await dbGet('books', bookId);
        if (!this.book) return;
        this.currentLocation = null;
        this._tocCache = null;
        this.isNavigating = false;
        this.pendingNavDelta = 0;
        if (this.layoutSyncTimer) {
            clearTimeout(this.layoutSyncTimer);
            this.layoutSyncTimer = null;
        }
        if (this.layoutSyncTimers) {
            this.layoutSyncTimers.forEach(timer => clearTimeout(timer));
            this.layoutSyncTimers.clear();
        }
        if (this.layoutSyncRaf) {
            cancelAnimationFrame(this.layoutSyncRaf);
            this.layoutSyncRaf = null;
        }
        if (this.layoutObserver) {
            this.layoutObserver.disconnect();
            this.layoutObserver = null;
        }
        if (this.layoutRedisplayTimer) {
            clearTimeout(this.layoutRedisplayTimer);
            this.layoutRedisplayTimer = null;
        }
        this.lastLayoutSize = null;

        // 清理旧的 EPUB 实例
        if (this.epubBook) {
            try { this.epubBook.destroy(); } catch { }
            this.epubBook = null;
            this.epubRendition = null;
            this.epubLayoutReady = false;
        }
        if (this.pdfUrl) {
            URL.revokeObjectURL(this.pdfUrl);
            this.pdfUrl = null;
        }
        if (this.pdfRenderTask) {
            const task = this.pdfRenderTask;
            try { task.cancel(); } catch { }
            try { await task.promise; } catch { }
            this.pdfRenderTask = null;
        }
        if (this.pdfDoc) {
            const doc = this.pdfDoc;
            this.pdfDoc = null;
            try { await doc.destroy(); } catch { }
        }
        this.pdfRenderId++;
        this.pdfIsRendering = false;
        this.pdfRenderedPage = null;

        const readerTitle = document.getElementById('reader-book-title');
        if (readerTitle) readerTitle.textContent = this.book.title;
        this.setContentMode(this.book.type);
        this.fontSize = this.book.type === 'epub' ? 16 : 22;
        this.epubFontSizeOverride = false;
        this.updateFontSize();

        if (this.book.type === 'txt') {
            this.openTxt();
        } else if (this.book.type === 'epub') {
            await this.openEpub();
        } else if (this.book.type === 'pdf') {
            await this.openPdf();
        }
    },

    setContentMode(type) {
        const container = document.getElementById('book-content');
        if (!container) return;
        container.classList.remove('book-txt', 'book-epub', 'book-pdf');
        container.classList.add(`book-${type || 'txt'}`);
        document.getElementById('reader-content')
            ?.classList.toggle('reader-stable-pan', type === 'epub' || type === 'pdf');
    },

    nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    },

    getReaderContentSize(container = document.getElementById('book-content')) {
        const rect = container?.getBoundingClientRect();
        return {
            width: Math.max(1, Math.floor(rect?.width || 0)),
            height: Math.max(1, Math.floor(rect?.height || 0))
        };
    },

    openTxt() {
        const container = document.getElementById('book-content');
        this.setContentMode('txt');
        container.style.height = '';
        this.pages = splitTextToPages(this.book.content);
        this.book.totalPages = this.pages.length;
        this.currentPage = Math.min(this.book.currentPage || 0, this.pages.length - 1);
        this.renderPage();
    },

    async openEpub() {
        const container = document.getElementById('book-content');
        this.setContentMode('epub');
        container.innerHTML = '<p style="text-align:center;padding:60px;color:var(--text-secondary)">📖 正在加载…</p>';
        // 让容器完全填满可用空间（由flex布局控制）
        container.style.height = '100%';

        try {
            // Blob -> ArrayBuffer
            let data = this.book.content;
            if (data instanceof Blob) {
                data = await data.arrayBuffer();
            }

            const zipLib = typeof JSZip !== 'undefined'
                ? JSZip
                : await window.SmartReadVendor?.ensureJSZip?.();
            if (!zipLib) throw new Error('EPUB 依赖 JSZip 未加载，请稍后重试');

            const epubFactory = typeof ePub !== 'undefined'
                ? ePub
                : await window.SmartReadVendor?.ensureEpub?.();
            if (!epubFactory) throw new Error('EPUB 渲染库未加载，请检查网络后重试');
            const epub = epubFactory(data, { replacements: 'blobUrl' });
            this.epubBook = epub;
            container.innerHTML = '';
            await this.nextFrame();
            this.epubRendition = epub.renderTo(container, {
                width: '100%',
                height: '100%',
                spread: 'none',
                flow: 'paginated',
                manager: 'default'
            });
            this.epubLayoutReady = false;
            this.lastLayoutSize = null;
            if (typeof this.epubRendition.flow === 'function') this.epubRendition.flow('paginated');
            if (typeof this.epubRendition.spread === 'function') this.epubRendition.spread('none');
            this.startLayoutObserver();

            // 通过 hooks 注入样式，约束 EPUB 内部图文块，避免固定宽高内容撑出当前页。
            const activeBookId = this.book.id;
            this.epubRendition.hooks.content.register((contents) => {
                const doc = contents.document;
                const style = doc.createElement('style');
                style.textContent = `
                html, body {
                    background: transparent !important;
                    margin: 0 !important;
                    overflow-wrap: break-word !important;
                }
                *, *::before, *::after {
                    box-sizing: border-box !important;
                }
                body {
                    padding: 5px !important;
                    min-width: 0 !important;
                }
                p, li, dd, dt, blockquote, figcaption,
                section, article, aside, header, footer {
                    overflow-wrap: break-word !important;
                    word-break: break-word !important;
                }
                p.picture, p.picture_center, p.picture_left, p.picture_right,
                .picture, .picture_center, .picture_left, .picture_right {
                    margin-top: 0.25em !important;
                    margin-bottom: 0.25em !important;
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                }
                body.smartread-epub-image-page p.picture,
                body.smartread-epub-image-page p.picture_center,
                body.smartread-epub-image-page p.picture_left,
                body.smartread-epub-image-page p.picture_right {
                    line-height: 0 !important;
                    margin-top: 0 !important;
                    margin-bottom: 0 !important;
                }
                img, svg, video, canvas, object, embed, image {
                    max-width: 100% !important;
                    max-inline-size: 100% !important;
                    object-fit: contain !important;
                }
                svg {
                    overflow: hidden !important;
                }
                pre {
                    white-space: pre-wrap !important;
                    overflow-wrap: anywhere !important;
                    word-break: break-word !important;
                }
                table {
                    max-width: 100% !important;
                    border-collapse: collapse !important;
                }
                th, td {
                    max-width: 100% !important;
                    overflow-wrap: anywhere !important;
                    word-break: break-word !important;
                }
                code {
                    white-space: pre-wrap !important;
                    overflow-wrap: anywhere !important;
                    word-break: break-word !important;
                }
                .tts-highlight {
                    background: rgba(232, 179, 74, 0.34) !important;
                    border-radius: 3px !important;
                    padding: 0 2px !important;
                    -webkit-box-decoration-break: clone;
                    box-decoration-break: clone;
                }
            `;
                doc.head.appendChild(style);
                Reader.applyThemeToEpubDocument(doc);
                if (Reader.epubFontSizeOverride) {
                    doc.body.style.setProperty('font-size', Reader.fontSize + 'px', 'important');
                }
                // 只缩小 padding，不完全清除（epub.js 翻页依赖 padding）
                const body = doc.body;
                body.style.setProperty('padding-top', '5px', 'important');
                body.style.setProperty('padding-bottom', '5px', 'important');
                body.style.setProperty('padding-left', '5px', 'important');
                body.style.setProperty('padding-right', '5px', 'important');
                const syncEpubContentLayout = () => {
                    if (Reader.book?.id !== activeBookId) return;
                    Reader.normalizeEpubOverflowingContent(doc);
                };
                syncEpubContentLayout();
                doc.querySelectorAll('img, svg, image, video, canvas, object, embed').forEach(el => {
                    el.addEventListener('load', () => {
                        syncEpubContentLayout();
                    }, { once: true });
                    el.addEventListener('error', syncEpubContentLayout, { once: true });
                });
                // 转发 iframe 内的 mouseup，使划词提问可以捕获选区
                doc.addEventListener('mouseup', (e) => {
                    const sel = doc.getSelection();
                    const text = sel ? sel.toString().trim() : '';
                    if (text.length >= 2) {
                        const frame = doc.defaultView?.frameElement;
                        const rect = frame?.getBoundingClientRect?.() ||
                            contents.content?.getBoundingClientRect?.() ||
                            { left: 0, top: 0 };
                        Selection.removePopup();
                        Selection.showPopup(e.clientX + rect.left, e.clientY + rect.top, text);
                    }
                });
                doc.addEventListener('keydown', (e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    if (e.key === 'ArrowLeft') Reader.prevPage();
                    if (e.key === 'ArrowRight') Reader.nextPage();
                });
            });

            // 翻页进度监听 — 立即注册，不等 locations
            let locationsReady = false;
            this.epubRendition.on('relocated', (location) => {
                if (!location || !location.start) return;
                let percent = 0;
                if (locationsReady) {
                    const pct = epub.locations.percentageFromCfi(location.start.cfi);
                    percent = Math.round(pct * 100);
                } else {
                    const spineLen = epub.spine?.length || epub.spine?.items?.length || 1;
                    const idx = location.start.index || 0;
                    const d = location.start.displayed;
                    const chapterPct = d ? (d.page / d.total) : 0;
                    percent = Math.round(((idx + chapterPct) / spineLen) * 100);
                }
                const progressBar = document.getElementById('progress-bar');
                const progressText = document.getElementById('progress-text');
                if (progressBar) progressBar.style.width = percent + '%';
                if (progressText) progressText.textContent = percent + '%';
                this.book.progress = percent;
                this.book.currentCfi = location.start.cfi;
                const page = location.start.displayed?.page || 1;
                this.currentPage = Math.max(0, page - 1);
                this.book.currentPage = this.currentPage;
                this.book.lastRead = Date.now();
                dbPut('books', this.book);
                const idx = Bookshelf.books.findIndex(b => b.id === this.book.id);
                if (idx >= 0) Bookshelf.books[idx] = { ...this.book };
                this.scheduleServerProgressSync();
            });
            await this.epubRendition.display(this.book.currentCfi || undefined);
            this.epubLayoutReady = true;
            this.lastLayoutSize = null;
            this.scheduleLayoutSync(0);
            // 后台生成精确定位（不阻塞首屏渲染）
            epub.ready.then(() => epub.locations.generate(1024)).then(() => {
                locationsReady = true;
            }).catch(err => console.warn('locations generate failed:', err));
            // 渲染完成
        } catch (err) {
            this.epubLayoutReady = false;
            container.innerHTML = `<p style="text-align:center;padding:60px;color:#ff6b6b">
                ❌ 加载失败: ${escapeHTML(err.message)}<br>
                <small style="color:var(--text-muted)">大文件加载可能需要较长时间，请稍后重试</small></p>`;
            console.error('EPUB load error:', err);
        }
    },

    normalizeEpubOverflowingContent(doc) {
        if (!doc?.body) return;
        const viewport = this._epubViewport(doc.body, doc);
        const pageWidth = viewport.width > 10 ? Math.max(1, Math.floor(viewport.width - 10)) : 0;
        const pageHeight = viewport.height > 10 ? Math.max(1, Math.floor(viewport.height - 10)) : 0;
        const profile = this.getEpubContentProfile(doc, pageWidth, pageHeight);
        const mixedMediaMaxHeight = pageHeight
            ? Math.max(120, Math.min(Math.floor(pageHeight * 0.46), 360))
            : 0;
        const imagePageMaxHeight = pageHeight && profile.isImageDominant && !profile.isImageSequence && profile.textLength > 0
            ? Math.max(180, Math.floor(pageHeight * 0.82))
            : pageHeight;
        const mediaMaxHeight = profile.isMixedMedia ? mixedMediaMaxHeight : imagePageMaxHeight;
        const set = (el, prop, value) => el.style.setProperty(prop, value, 'important');
        const fitMedia = new Set(profile.fitMedia || []);

        doc.body.classList.toggle('smartread-epub-mixed-media', profile.isMixedMedia);
        doc.body.classList.toggle('smartread-epub-image-page', profile.isImageDominant);
        doc.body.classList.toggle('smartread-epub-image-sequence', profile.isImageSequence);

        doc.querySelectorAll('img, svg, image, video, canvas, object, embed').forEach(el => {
            set(el, 'box-sizing', 'border-box');
            if (pageWidth) {
                set(el, 'max-width', pageWidth + 'px');
                set(el, 'max-inline-size', pageWidth + 'px');
            }
            if (mediaMaxHeight) {
                set(el, 'max-height', mediaMaxHeight + 'px');
                set(el, 'max-block-size', mediaMaxHeight + 'px');
            }
            set(el, 'object-fit', 'contain');
            set(el, 'min-width', '0');
            if (fitMedia.has(el)) {
                set(el, 'display', 'block');
                set(el, 'width', 'auto');
                set(el, 'height', 'auto');
                set(el, 'margin-left', 'auto');
                set(el, 'margin-right', 'auto');
            }
        });

        this.applyEpubImageSequenceBreaks(doc, profile, set);

        const maybeFixedWidth = 'figure, .figure, table, pre, blockquote, div, section, article, aside, [width], [style*="width"], [style*="min-width"]';
        doc.querySelectorAll(maybeFixedWidth).forEach(el => {
            if (el === doc.body || el === doc.documentElement) return;
            if (!this.isEpubElementOverflowing(el, pageWidth, pageHeight)) return;
            set(el, 'box-sizing', 'border-box');
            if (pageWidth) {
                set(el, 'max-width', pageWidth + 'px');
                set(el, 'max-inline-size', pageWidth + 'px');
            }
            set(el, 'min-width', '0');
            set(el, 'overflow-wrap', 'anywhere');
            set(el, 'word-break', 'break-word');
        });

        doc.querySelectorAll('table').forEach(el => {
            if (!this.isEpubElementOverflowing(el, pageWidth, pageHeight)) return;
            set(el, 'width', '100%');
            set(el, 'table-layout', 'fixed');
        });

        doc.querySelectorAll('pre, code').forEach(el => {
            set(el, 'white-space', 'pre-wrap');
            set(el, 'overflow-wrap', 'anywhere');
            set(el, 'word-break', 'break-word');
        });
    },

    getEpubContentProfile(doc, pageWidth = 0, pageHeight = 0) {
        const media = Array.from(doc.querySelectorAll('img, svg, image, video, canvas, object, embed'));
        const text = (doc.body?.innerText || '')
            .replace(/\s+/g, '')
            .replace(/[\u200b-\u200d\ufeff]/g, '');
        const bodyText = Array.from(doc.querySelectorAll('p, li, dd, dt, blockquote, figcaption'))
            .map(el => el.innerText || el.textContent || '')
            .join('')
            .replace(/\s+/g, '')
            .replace(/[\u200b-\u200d\ufeff]/g, '');
        const textLength = text.length;
        const bodyTextLength = bodyText.length;
        const mediaInfo = media
            .map(el => this.getEpubMediaProfile(el, pageWidth, pageHeight))
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);
        const meaningfulMedia = mediaInfo.filter(item => item.isMeaningful);
        const pageLikeMedia = meaningfulMedia.filter(item => item.isPageLike);
        const primary = meaningfulMedia[0] || null;
        const textIsLight = bodyTextLength < 220 && textLength < 420;
        const textIsTiny = bodyTextLength < 40 && textLength < 120;
        const pageLikeShare = meaningfulMedia.length ? pageLikeMedia.length / meaningfulMedia.length : 0;
        const isImageSequence = pageLikeMedia.length >= 2 && textLength < 520 && pageLikeShare >= 0.55;
        const hasSingleScanPage = !!primary &&
            pageLikeMedia.includes(primary) &&
            textIsLight &&
            (primary.isLargeIntrinsic || primary.areaRatio >= 0.12);
        const hasDominantVisual = !!primary &&
            textIsLight &&
            (primary.areaRatio >= 0.30 || (primary.isLargeIntrinsic && primary.isPageLike));
        const isImageDominant = meaningfulMedia.length > 0 &&
            (textIsTiny || isImageSequence || hasSingleScanPage || hasDominantVisual);
        const isMixedMedia = meaningfulMedia.length > 0 &&
            !isImageDominant &&
            (bodyTextLength >= 12 || textLength >= 80);
        const fitMedia = meaningfulMedia
            .filter(item => item.isPageLike || (isImageDominant && item === primary))
            .map(item => item.el);

        return {
            media,
            mediaInfo,
            pageLikeMedia,
            fitMedia,
            textLength,
            bodyTextLength,
            isMixedMedia,
            isImageDominant,
            isImageSequence
        };
    },

    getEpubMediaProfile(el, pageWidth = 0, pageHeight = 0) {
        try {
            const rect = el.getBoundingClientRect();
            const tag = (el.tagName || '').toLowerCase();
            const attrWidth = parseFloat(el.getAttribute?.('width') || '') || 0;
            const attrHeight = parseFloat(el.getAttribute?.('height') || '') || 0;
            const viewBox = tag === 'svg' ? this.getSvgViewBoxSize(el) : null;
            const naturalWidth = el.naturalWidth || attrWidth || viewBox?.width || rect.width || 0;
            const naturalHeight = el.naturalHeight || attrHeight || viewBox?.height || rect.height || 0;
            const renderedWidth = rect.width || attrWidth || naturalWidth || 0;
            const renderedHeight = rect.height || attrHeight || naturalHeight || 0;
            const width = Math.max(renderedWidth, naturalWidth, 0);
            const height = Math.max(renderedHeight, naturalHeight, 0);
            const aspect = width > 0 ? height / width : 0;
            const intrinsicArea = naturalWidth * naturalHeight;
            const renderedArea = renderedWidth * renderedHeight;
            const viewportArea = Math.max(1, pageWidth * pageHeight);
            const areaRatio = viewportArea ? renderedArea / viewportArea : 0;
            const isMeaningful = width >= 48 && height >= 48;
            const isPortraitPage = aspect >= 1.12 && aspect <= 2.65;
            const isLargeIntrinsic =
                (naturalWidth >= 320 && naturalHeight >= 420) ||
                intrinsicArea >= 150000;
            const isTallInView = pageHeight ? renderedHeight >= pageHeight * 0.34 : false;
            const isWideInView = pageWidth ? renderedWidth >= pageWidth * 0.34 : false;
            const isPageLike = isPortraitPage &&
                (isLargeIntrinsic || areaRatio >= 0.10 || (isTallInView && isWideInView));

            return {
                el,
                width,
                height,
                naturalWidth,
                naturalHeight,
                renderedWidth,
                renderedHeight,
                aspect,
                intrinsicArea,
                renderedArea,
                areaRatio,
                isMeaningful,
                isPortraitPage,
                isLargeIntrinsic,
                isPageLike,
                score: Math.max(renderedArea, intrinsicArea * 0.35)
            };
        } catch {
            return null;
        }
    },

    getSvgViewBoxSize(el) {
        const raw = el.getAttribute?.('viewBox') || '';
        const parts = raw.trim().split(/[\s,]+/).map(Number);
        if (parts.length >= 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
            return { width: Math.abs(parts[2]), height: Math.abs(parts[3]) };
        }
        return null;
    },

    applyEpubImageSequenceBreaks(doc, profile, set) {
        const sequence = profile?.isImageSequence ? profile.pageLikeMedia || [] : [];
        if (!sequence.length) return;
        sequence.forEach((item, index) => {
            const block = this.getEpubMediaBlock(item.el, doc);
            if (!block || block === doc.body || block === doc.documentElement) return;
            set(block, 'break-inside', 'avoid');
            set(block, 'page-break-inside', 'avoid');
            set(block, '-webkit-column-break-inside', 'avoid');
            if (index < sequence.length - 1) {
                set(block, 'break-after', 'column');
                set(block, 'page-break-after', 'always');
                set(block, '-webkit-column-break-after', 'always');
            }
        });
    },

    getEpubMediaBlock(el, doc) {
        const selector = 'p.picture, p.picture_center, p.picture_left, p.picture_right, figure, .figure, .picture, .picture_center, .picture_left, .picture_right';
        const closest = el.closest?.(selector);
        if (closest && closest !== doc.body && closest !== doc.documentElement) return closest;
        const parent = el.parentElement;
        if (!parent || parent === doc.body || parent === doc.documentElement) return el;
        const textLength = (parent.innerText || parent.textContent || '').replace(/\s+/g, '').length;
        if (parent.children.length <= 3 && textLength < 120) return parent;
        return el;
    },

    isEpubElementOverflowing(el, pageWidth, pageHeight) {
        if (!el || (!pageWidth && !pageHeight)) return false;
        try {
            const rect = el.getBoundingClientRect();
            const scrollW = el.scrollWidth || 0;
            const scrollH = el.scrollHeight || 0;
            return (
                (pageWidth && (rect.width > pageWidth + 2 || scrollW > pageWidth + 2)) ||
                (pageHeight && rect.height > pageHeight + 2 && /^(img|svg|image|video|canvas|object|embed)$/i.test(el.tagName || '')) ||
                (rect.left < -2 || (pageWidth && rect.right > pageWidth + 2 && rect.left < pageWidth))
            );
        } catch {
            return false;
        }
    },

    async openPdf() {
        const container = document.getElementById('book-content');
        this.setContentMode('pdf');
        container.style.height = '100%';
        this.pages = [];
        this.currentPage = Math.max(0, this.book.currentPage || 0);
        container.innerHTML = `
            <div class="pdf-reader">
                <div id="pdf-page-stage" class="pdf-page-stage">
                    <canvas id="pdf-page-canvas" class="pdf-page-canvas"></canvas>
                    <div id="pdf-loading" class="pdf-status">正在加载 PDF...</div>
                </div>
                <div id="pdf-page-indicator" class="pdf-page-indicator"></div>
            </div>`;

        try {
            const pdfjs = await this.ensurePdfJs();
            const data = await this.getPdfData();
            const loadingTask = pdfjs.getDocument({ data });
            this.pdfDoc = await loadingTask.promise;
            this.book.totalPages = this.pdfDoc.numPages || 1;
            this.currentPage = Math.min(this.currentPage, this.book.totalPages - 1);
            await this.renderPdfPage();
            await this.saveProgress();
        } catch (err) {
            container.innerHTML = `<p style="text-align:center;padding:60px;color:#ff6b6b">
                PDF 加载失败: ${escapeHTML(err.message)}</p>`;
            console.error('PDF load error:', err);
        }
    },

    async ensurePdfJs() {
        const pdfjs = window.pdfjsLib || await window.SmartReadVendor?.ensurePdfJs?.();
        if (!pdfjs) throw new Error('PDF 渲染库未加载，请检查网络后刷新页面');
        if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc =
                'js/vendor/pdf.worker.min.js';
        }
        return pdfjs;
    },

    async getPdfData() {
        let data = this.book.content;
        if (data instanceof Blob) data = await data.arrayBuffer();
        if (data instanceof ArrayBuffer) return data.slice(0);
        if (ArrayBuffer.isView(data)) {
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }
        return new Blob([data], { type: 'application/pdf' }).arrayBuffer();
    },

    async renderPdfPage() {
        if (!this.pdfDoc) return;
        const renderId = ++this.pdfRenderId;
        const pageIndex = this.currentPage;
        const canvas = document.getElementById('pdf-page-canvas');
        const stage = document.getElementById('pdf-page-stage');
        const loading = document.getElementById('pdf-loading');
        const indicator = document.getElementById('pdf-page-indicator');
        if (!canvas || !stage) return;

        this.pdfIsRendering = true;
        this.pdfRenderedPage = null;

        if (this.pdfRenderTask) {
            const oldTask = this.pdfRenderTask;
            try { oldTask.cancel(); } catch { }
            try { await oldTask.promise; } catch { }
            if (renderId !== this.pdfRenderId) return;
            this.pdfRenderTask = null;
        }

        if (loading) {
            loading.textContent = '正在渲染页面...';
            loading.classList.remove('hidden');
        }

        try {
            const page = await this.pdfDoc.getPage(pageIndex + 1);
            if (renderId !== this.pdfRenderId) return;

            const stageRect = stage.getBoundingClientRect();
            const pageViewport = page.getViewport({ scale: 1 });
            const availableWidth = Math.max(320, (stageRect.width || window.innerWidth) - 32);
            const availableHeight = Math.max(320, (stageRect.height || window.innerHeight) - 32);
            const fitScale = Math.min(
                availableWidth / pageViewport.width,
                availableHeight / pageViewport.height
            );
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            const viewport = page.getViewport({ scale: Math.max(0.1, fitScale) * pixelRatio });
            const displayWidth = Math.max(1, Math.floor(viewport.width / pixelRatio));
            const displayHeight = Math.max(1, Math.floor(viewport.height / pixelRatio));

            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';

            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            this.pdfRenderTask = page.render({ canvasContext: ctx, viewport });
            await this.pdfRenderTask.promise;
            if (renderId !== this.pdfRenderId) return;
            this.pdfRenderTask = null;

            if (loading) loading.classList.add('hidden');
            if (indicator) {
                indicator.textContent = `第 ${pageIndex + 1} 页 / 共 ${this.pdfDoc.numPages} 页`;
            }
            this.pdfRenderedPage = pageIndex;
            this.currentLocation = this._buildPdfLocation();
            this.updateProgress();
        } catch (err) {
            if (err?.name === 'RenderingCancelledException') return;
            if (loading) {
                loading.textContent = 'PDF 页面渲染失败';
                loading.classList.remove('hidden');
            }
            console.error('PDF render error:', err);
        } finally {
            if (renderId === this.pdfRenderId) this.pdfIsRendering = false;
        }
    },

    async getTOC() {
        if (this.book?.type === 'epub' && this.epubBook) {
            if (this._tocCache) return this._tocCache;
            const nav = await this.epubBook.navigation;
            const items = [];
            const flatten = (list, depth) => {
                for (const ch of list) {
                    items.push({ label: ch.label.trim(), href: ch.href, depth });
                    if (ch.subitems?.length) flatten(ch.subitems, depth + 1);
                }
            };
            flatten(nav.toc, 0);
            this._tocCache = items;
            return items;
        }
        if (this.book?.type === 'pdf' && this.pdfDoc) {
            if (this._tocCache) return this._tocCache;
            const outline = await this.pdfDoc.getOutline?.();
            if (!outline?.length) return [];
            const items = [];
            const flatten = async (list, depth) => {
                for (const entry of list) {
                    const pageIndex = await this.pdfOutlinePageIndex(entry);
                    if (pageIndex != null) {
                        items.push({
                            label: (entry.title || `第 ${pageIndex + 1} 页`).trim(),
                            href: `pdf:${pageIndex}`,
                            depth
                        });
                    }
                    if (entry.items?.length) await flatten(entry.items, depth + 1);
                }
            };
            await flatten(outline, 0);
            this._tocCache = items;
            return items;
        }
        return [];
    },

    currentThemePalette() {
        if (document.body?.classList.contains('theme-dark')) {
            return {
                bg: '#1c1c1e',
                text: '#f5f5f7',
                mediaFilter: 'invert(1) hue-rotate(180deg) contrast(0.92) brightness(0.88)'
            };
        }
        if (document.body?.classList.contains('theme-sepia')) {
            return {
                bg: '#f3e0b4',
                text: '#372713',
                mediaFilter: 'sepia(0.62) saturate(0.72) brightness(0.96) contrast(0.96)'
            };
        }
        return {
            bg: '#ffffff',
            text: '#1d1d1f',
            mediaFilter: 'none'
        };
    },

    applyThemeToEpubDocument(doc) {
        if (!doc?.documentElement || !doc.body) return;
        const theme = this.currentThemePalette();
        doc.documentElement.style.setProperty('background', theme.bg, 'important');
        doc.documentElement.style.setProperty('color', theme.text, 'important');
        doc.body.style.setProperty('background', theme.bg, 'important');
        doc.body.style.setProperty('color', theme.text, 'important');
        doc.querySelectorAll('p, li, dd, dt, blockquote, figcaption, section, article, aside, header, footer, h1, h2, h3, h4, h5, h6, span, div')
            .forEach(el => el.style.setProperty('color', theme.text, 'important'));
        doc.querySelectorAll('img, svg, video, canvas, object, embed, image')
            .forEach(el => el.style.setProperty('filter', theme.mediaFilter, 'important'));
    },

    applyThemeToEmbeddedContent() {
        if (this.book?.type !== 'epub' || !this.epubRendition) return;
        try {
            const contents = this.epubRendition.getContents?.() || [];
            contents.forEach(content => this.applyThemeToEpubDocument(content.document));
        } catch (err) {
            console.warn('EPUB theme sync failed:', err);
        }
    },

    async pdfOutlinePageIndex(entry) {
        if (!this.pdfDoc || !entry?.dest) return null;
        try {
            const dest = typeof entry.dest === 'string'
                ? await this.pdfDoc.getDestination(entry.dest)
                : entry.dest;
            const pageRef = dest?.[0];
            if (!pageRef) return null;
            const index = await this.pdfDoc.getPageIndex(pageRef);
            return Number.isFinite(index) ? index : null;
        } catch (err) {
            console.warn('PDF outline destination failed:', err);
            return null;
        }
    },

    display(target) {
        if (this.book?.type === 'pdf' && this.pdfDoc && typeof target === 'string' && target.startsWith('pdf:')) {
            const pageIndex = Number.parseInt(target.slice(4), 10);
            if (!Number.isFinite(pageIndex)) return;
            const total = this.pdfDoc.numPages || this.book.totalPages || 1;
            this.currentPage = Math.max(0, Math.min(pageIndex, total - 1));
            this.renderPdfPage()
                .then(() => this.saveProgress())
                .then(() => this.notifyReadingPositionChanged())
                .catch(err => console.warn('PDF display failed:', err));
            return;
        }
        if (this.book?.type === 'epub' && this.epubRendition) {
            // 只停止朗读书本内容的 TTS
            if (TTS.source !== 'ai' && TTS.source !== 'chat') {
                TTS.stop();
            }
            this.lastLayoutSize = null;
            this.epubRendition.display(target)
                .then(() => {
                    this.scheduleLayoutSync(60);
                    this.notifyReadingPositionChanged();
                })
                .catch(err => console.warn('EPUB display failed:', err));
        }
    },

    renderPage() {
        const el = document.getElementById('book-content');
        if (this.pages.length === 0) { el.textContent = '内容为空'; return; }
        const text = this.pages[this.currentPage] || '';
        el.innerHTML = text.split('\n').map(p =>
            p.trim() ? `<p>${escapeHTML(p.trim())}</p>` : ''
        ).join('');
        this.currentLocation = this._buildTxtLocation(text);
        this.updateProgress();
    },

    nextPage() {
        this.navigatePage(1);
    },

    prevPage() {
        this.navigatePage(-1);
    },

    async navigatePage(delta) {
        if (!this.book || !delta) return;
        this.stopPlaybackForNavigation();

        if (this.book.type === 'epub' && this.epubRendition) {
            await this.navigateEpub(delta);
            return;
        }

        if (this.book.type === 'pdf' && this.pdfDoc) {
            await this.navigatePdf(delta);
            return;
        }

        if (this.book.type === 'txt') {
            this.navigateTxt(delta);
        }
    },

    navigateTxt(delta) {
        const next = this.currentPage + delta;
        if (next < 0 || next >= this.pages.length) return;
        this.currentPage = next;
        this.renderPage();
        this.saveProgress();
        this.notifyReadingPositionChanged();
    },

    async navigatePdf(delta) {
        const total = this.pdfDoc?.numPages || this.book?.totalPages || 1;
        const next = this.currentPage + delta;
        if (next < 0 || next >= total) return;
        this.currentPage = next;
        await this.renderPdfPage();
        await this.saveProgress();
        this.notifyReadingPositionChanged();
    },

    async navigateEpub(delta) {
        if (this.isNavigating) {
            this.pendingNavDelta = Math.max(-1, Math.min(1, this.pendingNavDelta + delta));
            return;
        }

        this.isNavigating = true;
        try {
            if (delta > 0) {
                await this.epubRendition.next();
            } else {
                await this.epubRendition.prev();
            }
            this.notifyReadingPositionChanged();
        } catch (err) {
            console.warn('EPUB navigation failed:', err);
        } finally {
            setTimeout(() => {
                this.isNavigating = false;
                const pending = this.pendingNavDelta;
                this.pendingNavDelta = 0;
                if (pending) this.navigateEpub(pending);
            }, 60);
        }
    },

    stopPlaybackForNavigation() {
        // 只停止朗读书本内容的 TTS，不干扰 AI 解读或聊天朗读
        if (TTS.source === 'ai' || TTS.source === 'chat') return;
        if (TTS.speaking || TTS.paused) {
            TTS.stop();
        }
    },

    notifyReadingPositionChanged() {
        this.readingVersion++;
        document.dispatchEvent(new CustomEvent('reader-page-change', {
            detail: {
                version: this.readingVersion,
                bookId: this.book?.id,
                currentPage: this.currentPage,
                type: this.book?.type
            }
        }));
    },

    markReadingPositionChanging() {
        this.notifyReadingPositionChanged();
    },

    updateProgress() {
        let pct = 0;
        if (this.book?.type === 'epub' && this.epubRendition) {
            const loc = this.epubRendition.location;
            if (loc?.start?.percentage) {
                pct = Math.round(loc.start.percentage * 100);
            } else {
                pct = Math.round(this.book.progress || 0);
            }
        } else if (this.book?.type === 'pdf') {
            const total = this.pdfDoc?.numPages || this.book.totalPages || 1;
            pct = Math.round(((this.currentPage + 1) / total) * 100);
        } else {
            const total = this.pages.length || 1;
            pct = Math.round(((this.currentPage + 1) / total) * 100);
        }

        const bar = document.getElementById('progress-bar');
        const txt = document.getElementById('progress-text');
        const title = document.getElementById('reader-book-title');

        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = pct + '%';
        if (title && this.book) title.textContent = this.book.title;
        if (this.book) this.book.progress = pct;
        if (typeof App !== 'undefined' && App.updateMobileReaderMeta) {
            App.updateMobileReaderMeta();
        }
    },

    scheduleLayoutSync(delay = 0) {
        const run = () => {
            if (delay > 0) this.layoutSyncTimer = null;
            if (this.layoutSyncRaf) cancelAnimationFrame(this.layoutSyncRaf);
            this.layoutSyncRaf = requestAnimationFrame(() => {
                this.layoutSyncRaf = null;
                this.syncLayout();
            });
        };

        if (delay > 0) {
            const timer = setTimeout(() => {
                this.layoutSyncTimers?.delete(timer);
                run();
            }, delay);
            this.layoutSyncTimers?.add(timer);
        } else {
            run();
        }
    },

    startLayoutObserver() {
        if (this.layoutObserver) {
            this.layoutObserver.disconnect();
            this.layoutObserver = null;
        }
        const container = document.getElementById('book-content');
        if (!container || typeof ResizeObserver === 'undefined') return;
        this.layoutObserver = new ResizeObserver(() => {
            this.scheduleLayoutSync(100);
        });
        this.layoutObserver.observe(container);
    },

    syncLayout(force = false) {
        if (this.book?.type === 'epub' && this.epubRendition) {
            if (!this.epubLayoutReady) return;
            if (!this.epubRendition.manager?.layout) return;
            const container = document.getElementById('book-content');
            const { width, height } = this.getReaderContentSize(container);
            if (!width || !height) return;
            const sizeKey = `${width}x${height}`;
            if (!force && this.lastLayoutSize === sizeKey) return;
            this.lastLayoutSize = sizeKey;
            try {
                this.epubRendition.resize(width, height);
                requestAnimationFrame(() => {
                    if (this.book?.type !== 'epub' || !this.epubRendition) return;
                    const contents = this.epubRendition.getContents?.() || [];
                    contents.forEach(content => this.normalizeEpubOverflowingContent(content?.document));
                    const hasLiveFrame = !!container.querySelector('iframe');
                    if (!contents.length || !hasLiveFrame) {
                        const locationTarget = this.epubRendition.location?.start?.cfi || this.book.currentCfi || null;
                        this.scheduleEpubRedisplay(locationTarget, 80);
                    }
                });
            } catch (err) {
                console.warn('EPUB resize failed:', err);
            }
        }
    },

    scheduleEpubRedisplay(target = null, delay = 120) {
        if (this.layoutRedisplayTimer) clearTimeout(this.layoutRedisplayTimer);
        this.layoutRedisplayTimer = setTimeout(() => {
            this.layoutRedisplayTimer = null;
            this.redisplayCurrentEpubLocation(target);
        }, delay);
    },

    async redisplayCurrentEpubLocation(target = null) {
        if (this.book?.type !== 'epub' || !this.epubRendition) return;
        // 初始加载期间不重复 display，避免闪烁
        const container = document.getElementById('book-content');
        if (container?.classList.contains('epub-loading')) return;
        const locationTarget = target || this.epubRendition.location?.start?.cfi || this.book.currentCfi || undefined;
        try {
            await this.epubRendition.display(locationTarget);
            this.epubLayoutReady = true;
            const contents = this.epubRendition.getContents?.() || [];
            contents.forEach(content => this.normalizeEpubOverflowingContent(content?.document));
        } catch (err) {
            console.warn('EPUB redisplay failed:', err);
        }
    },

    async saveProgress() {
        if (!this.book) return;
        if (this.book.type === 'txt') {
            this.book.currentPage = this.currentPage;
            this.book.progress = ((this.currentPage + 1) / (this.pages.length || 1)) * 100;
        } else if (this.book.type === 'epub' && this.epubRendition) {
            const loc = this.epubRendition.location;
            if (loc?.start?.cfi) this.book.currentCfi = loc.start.cfi;
            this.book.currentPage = this.currentPage;
        } else if (this.book.type === 'pdf') {
            const total = this.pdfDoc?.numPages || this.book.totalPages || 1;
            this.book.currentPage = this.currentPage;
            this.book.totalPages = total;
            this.book.progress = ((this.currentPage + 1) / total) * 100;
        }
        this.book.lastRead = Date.now();
        await dbPut('books', this.book);
        // 同步书架数据
        const idx = Bookshelf.books.findIndex(b => b.id === this.book.id);
        if (idx >= 0) Bookshelf.books[idx] = { ...this.book };
        this.scheduleServerProgressSync();
    },

    scheduleServerProgressSync() {
        if (!this.book?.serverBookId || !window.SmartReadAPI?.updateBookProgress) return;
        if (this.serverProgressTimer) clearTimeout(this.serverProgressTimer);
        this.serverProgressTimer = setTimeout(() => {
            this.syncServerProgress();
        }, 400);
    },

    syncServerProgress() {
        if (!this.book?.serverBookId || !window.SmartReadAPI?.updateBookProgress) return;
        SmartReadAPI.updateBookProgress(this.book.serverBookId, {
            currentPage: this.book.currentPage || 0,
            currentCfi: this.book.currentCfi || null,
            progress: this.book.progress || 0,
            totalPages: this.book.totalPages || null,
            lastRead: this.book.lastRead || Date.now()
        }).catch(err => console.warn('Server progress sync failed:', err));
    },

    updateFontSize() {
        const el = document.getElementById('book-content');
        el.style.fontSize = this.fontSize + 'px';
        const disp = document.getElementById('font-size-display');
        if (disp) disp.textContent = this.fontSize + 'px';
        // 同步 EPUB iframe 内的字体大小
        if (this.epubRendition) {
            try {
                const contents = this.epubRendition.getContents();
                if (contents && contents.length > 0) {
                    contents.forEach(content => {
                        const body = content?.document?.body;
                        if (!body) return;
                        body.style.setProperty('font-size', this.fontSize + 'px', 'important');
                        this.normalizeEpubOverflowingContent(content.document);
                    });
                }
            } catch { }
        }
        this.lastLayoutSize = null;
        this.scheduleLayoutSync(120);
    },

    changeFontSize(delta) {
        this.fontSize = Math.min(40, Math.max(14, this.fontSize + delta));
        if (this.book?.type === 'epub') this.epubFontSizeOverride = true;
        this.updateFontSize();
    },

    async waitForCurrentPageReady(timeout = 1200) {
        if (this.book?.type === 'pdf') {
            await this.waitForCurrentPdfRender(timeout);
            return;
        }
        if (this.book?.type !== 'epub' || !this.epubRendition) return;

        const start = performance.now();
        while (this.isNavigating && performance.now() - start < timeout) {
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        await this.nextFrame();
        await this.nextFrame();
        await this.waitForCurrentEpubImages(Math.max(200, timeout - (performance.now() - start)));
    },

    async waitForCurrentEpubImages(timeout = 800) {
        if (this.book?.type !== 'epub' || !this.epubRendition) return;
        let images = [];
        try {
            const contents = this.epubRendition.getContents?.() || [];
            images = contents.flatMap(content => Array.from(content?.document?.images || []));
        } catch {
            return;
        }
        const pending = images.filter(img => !img.complete || !img.naturalWidth);
        if (!pending.length) return;
        await new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                pending.forEach(img => {
                    img.removeEventListener('load', check);
                    img.removeEventListener('error', check);
                });
                resolve();
            };
            const check = () => {
                if (pending.every(img => img.complete || img.naturalWidth)) finish();
            };
            const timer = setTimeout(finish, Math.max(0, timeout));
            pending.forEach(img => {
                img.addEventListener('load', check, { once: true });
                img.addEventListener('error', check, { once: true });
            });
            check();
        });
    },

    getCurrentText() {
        if (this.book?.type === 'txt') {
            return this.pages[this.currentPage] || '';
        }
        if (this.book?.type === 'pdf') {
            return '';
        }
        // EPUB: 只提取当前可视页面的文字（而非整个章节）
        if (this.book?.type === 'epub' && this.epubRendition) {
            try {
                const current = this.getCurrentEpubContent();
                const contents = current
                    ? [current.content]
                    : (this.epubRendition.getContents() || []);
                const visibleTexts = [];
                const rangeTexts = [];
                let hasCurrentPageMedia = false;
                for (const content of contents) {
                    const doc = content?.document;
                    const body = doc?.body;
                    if (!body) continue;
                    const visibleText = this._getVisibleText(body, doc);
                    if (visibleText) visibleTexts.push(visibleText);
                    const rangeText = this._getEpubLocationText(content, doc);
                    if (rangeText) rangeTexts.push(rangeText);
                    if (this._hasCurrentPageMedia(content, doc)) hasCurrentPageMedia = true;
                }
                const visible = visibleTexts.join('\n').trim();
                if (visible) return visible;
                if (hasCurrentPageMedia) return '';
                return rangeTexts.join('\n').trim();
            } catch { }
        }
        // 降级：从容器取
        const el = document.getElementById('book-content');
        return el?.innerText || '';
    },

    getCurrentEpubContent() {
        if (this.book?.type !== 'epub' || !this.epubRendition) return null;
        let contents = [];
        try {
            contents = this.epubRendition.getContents?.() || [];
        } catch {
            return null;
        }
        const candidates = contents
            .map(content => {
                const doc = content?.document;
                const body = doc?.body;
                if (!doc || !body) return null;
                const range = this._getCurrentEpubRange(content, doc);
                return {
                    content,
                    doc,
                    body,
                    href: this._getEpubContentHref(content, doc),
                    range,
                    area: this._epubContentFrameIntersectionArea(doc)
                };
            })
            .filter(Boolean);
        if (!candidates.length) return null;
        const currentHref = this._normalizeEpubHref(
            this.epubRendition.location?.start?.href ||
            this.epubRendition.location?.start?.url ||
            ''
        );
        const hrefMatches = currentHref
            ? candidates.filter(item => this._epubHrefMatches(item.href, currentHref))
            : [];
        const pool = hrefMatches.length ? hrefMatches : candidates;
        return pool.find(item => item.range && item.area > 0) ||
            pool.find(item => item.area > 0) ||
            pool.find(item => item.range) ||
            pool.sort((a, b) => b.area - a.area)[0] ||
            pool[0];
    },

    _getEpubContentHref(content, doc) {
        const raw =
            content?.section?.href ||
            content?.section?.url ||
            content?.href ||
            content?.url ||
            doc?.location?.pathname ||
            doc?.URL ||
            '';
        return this._normalizeEpubHref(raw);
    },

    _epubHrefMatches(contentHref, currentHref) {
        const content = this._normalizeEpubHref(contentHref);
        const current = this._normalizeEpubHref(currentHref);
        if (!content || !current) return false;
        return content === current ||
            content.endsWith('/' + current) ||
            current.endsWith('/' + content);
    },

    _epubContentFrameIntersectionArea(doc) {
        try {
            const frame = doc?.defaultView?.frameElement;
            const book = document.getElementById('book-content');
            if (!frame || !book) return 0;
            const frameRect = frame.getBoundingClientRect();
            const bookRect = book.getBoundingClientRect();
            const width = Math.max(0, Math.min(frameRect.right, bookRect.right) - Math.max(frameRect.left, bookRect.left));
            const height = Math.max(0, Math.min(frameRect.bottom, bookRect.bottom) - Math.max(frameRect.top, bookRect.top));
            return width * height;
        } catch {
            return 0;
        }
    },

    async getCurrentReadingContext(pageText = null) {
        const location = await this.getCurrentLocation();
        return this.formatReadingContext(location, pageText);
    },

    async getCurrentLocation() {
        if (!this.book) {
            return {
                bookTitle: '未知书籍',
                bookType: 'unknown',
                chapterTitle: '未知章节',
                pageLabel: '未知页',
                progressText: '0%'
            };
        }

        if (this.book.type === 'txt') {
            const text = this.pages[this.currentPage] || '';
            this.currentLocation = this._buildTxtLocation(text);
            return this.currentLocation;
        }

        if (this.book.type === 'epub' && this.epubRendition) {
            const loc = this.epubRendition.location;
            if (loc?.start) {
                this.currentLocation = await this._buildEpubLocation(loc);
            }
            return this.currentLocation || this._fallbackLocation();
        }

        if (this.book.type === 'pdf') {
            this.currentLocation = this._buildPdfLocation();
            return this.currentLocation;
        }

        return this._fallbackLocation();
    },

    formatReadingContext(location, pageText = null) {
        const loc = location || this._fallbackLocation();
        const lines = [
            '当前阅读位置：',
            `- 书名：${loc.bookTitle || '未知书籍'}`,
            `- 格式：${String(loc.bookType || 'unknown').toUpperCase()}`,
            `- 章节：${loc.chapterTitle || '未知章节'}`,
            `- 页码：${loc.pageLabel || '未知页'}`,
            `- 阅读进度：${loc.progressText || '0%'}`
        ];
        if (loc.chapterHref) lines.push(`- 章节文件：${loc.chapterHref}`);
        if (loc.cfi) lines.push(`- EPUB CFI：${loc.cfi}`);
        const text = String(pageText ?? '').trim();
        if (!text) lines.push('- 当前页文字：未提取到文字，可能是图片页、PDF页或空白页。');
        return lines.join('\n');
    },

    _fallbackLocation() {
        const progress = Math.round(this.book?.progress || 0);
        return {
            bookTitle: this.book?.title || '未知书籍',
            bookType: this.book?.type || 'unknown',
            chapterTitle: this.book?.type === 'pdf' ? 'PDF页面' : '未知章节',
            pageLabel: this.book?.type === 'txt'
                ? `第${this.currentPage + 1}页 / 共${this.pages.length || 1}页`
                : `${progress}%附近`,
            progressText: progress + '%'
        };
    },

    _buildPdfLocation() {
        const total = this.pdfDoc?.numPages || this.book?.totalPages || 1;
        const page = Math.min(total, Math.max(1, this.currentPage + 1));
        const progress = Math.round((page / total) * 100);
        return {
            bookTitle: this.book?.title || '未知书籍',
            bookType: 'pdf',
            chapterTitle: 'PDF页面',
            currentPage: page,
            totalPages: total,
            pageLabel: `第 ${page} 页 / 共 ${total} 页`,
            progressText: progress + '%'
        };
    },

    _buildTxtLocation(pageText) {
        const total = this.pages.length || 1;
        const progress = Math.round(((this.currentPage + 1) / total) * 100);
        return {
            bookTitle: this.book?.title || '未知书籍',
            bookType: 'txt',
            chapterTitle: this._inferTxtChapter(pageText) || '未识别章节',
            currentPage: this.currentPage + 1,
            totalPages: total,
            pageLabel: `第${this.currentPage + 1}页 / 共${total}页`,
            progressText: progress + '%'
        };
    },

    _inferTxtChapter(pageText) {
        const heading = this._findChapterHeading(pageText);
        if (heading) return heading;
        for (let i = this.currentPage - 1; i >= 0; i--) {
            const prevHeading = this._findChapterHeading(this.pages[i]);
            if (prevHeading) return prevHeading;
        }
        return '';
    },

    _findChapterHeading(text) {
        const lines = String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
        const chapterRe = /^(第[一二三四五六七八九十百千万零〇\d]+[章节回部卷篇].{0,40}|chapter\s+\d+.{0,40}|part\s+\d+.{0,40}|[一二三四五六七八九十百千万零〇\d]+[、.]\s*.{1,40})$/i;
        return lines.find(line => chapterRe.test(line)) || '';
    },

    async _buildEpubLocation(location) {
        const start = location.start || {};
        const displayed = start.displayed || {};
        const progress = this._epubProgressPercent(location);
        const href = start.href || start.url || '';
        const chapterTitle = await this._findEpubChapterTitle(href);
        const chapterIndex = typeof start.index === 'number' ? start.index + 1 : null;
        const chapterFallback = chapterIndex ? `第${chapterIndex}章附近` : '未知章节';
        const chapterPage = displayed.page || null;
        const chapterTotal = displayed.total || null;

        return {
            bookTitle: this.book?.title || '未知书籍',
            bookType: 'epub',
            chapterTitle: chapterTitle || chapterFallback,
            chapterHref: href,
            chapterIndex,
            chapterPage,
            chapterTotalPages: chapterTotal,
            currentPage: chapterPage,
            totalPages: chapterTotal,
            pageLabel: chapterPage && chapterTotal
                ? `本章第${chapterPage}页 / 共${chapterTotal}页`
                : `${progress}%附近`,
            progressText: progress + '%',
            cfi: start.cfi || ''
        };
    },

    _epubProgressPercent(location) {
        const fromLocation = location?.start?.percentage;
        if (typeof fromLocation === 'number') return Math.round(fromLocation * 100);
        return Math.round(this.book?.progress || 0);
    },

    async _findEpubChapterTitle(href) {
        if (!href) return '';
        try {
            const toc = await this.getTOC();
            const normalizedHref = this._normalizeEpubHref(href);
            let best = null;
            for (const item of toc) {
                const itemHref = this._normalizeEpubHref(item.href);
                if (!itemHref) continue;
                const isMatch = normalizedHref === itemHref ||
                    normalizedHref.endsWith('/' + itemHref) ||
                    itemHref.endsWith('/' + normalizedHref);
                if (isMatch && (!best || itemHref.length > this._normalizeEpubHref(best.href).length)) {
                    best = item;
                }
            }
            return best?.label || '';
        } catch {
            return '';
        }
    },

    _normalizeEpubHref(href) {
        return String(href || '')
            .split('#')[0]
            .replace(/^\/+/, '')
            .replace(/\\/g, '/')
            .trim();
    },

    _getEpubLocationText(contents, doc) {
        const loc = this.epubRendition?.location;
        const startCfi = loc?.start?.cfi;
        const endCfi = loc?.end?.cfi;
        if (!startCfi || !endCfi || !contents?.range) return '';
        try {
            const startRange = contents.range(startCfi);
            const endRange = contents.range(endCfi);
            if (!startRange || !endRange) return '';
            const range = doc.createRange();
            range.setStart(startRange.startContainer, startRange.startOffset);
            range.setEnd(endRange.startContainer, endRange.startOffset);
            return range.toString().replace(/\s+/g, ' ').trim();
        } catch {
            return '';
        }
    },

    _hasCurrentPageMedia(content, doc) {
        const body = doc?.body;
        if (!body) return false;
        const viewport = this._epubViewport(body, doc);
        const candidates = this._collectEpubImageCandidates(content, doc, viewport);
        return candidates.some(item => item.visible || item.inRange) ||
            (body.classList.contains('smartread-epub-image-page') && candidates.length > 0);
    },

    // 提取 EPUB 分页模式下当前可视页面的文字
    _getVisibleText(body, doc) {
        // epub.js paginated 模式用 CSS columns；长文本节点会横跨多列，
        // 因此按短片段测量 range，避免把整章当作当前页。
        const bounds = this._epubVisibleBounds(body, doc);
        const texts = [];
        const walker = doc.createTreeWalker(body, doc.defaultView.NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const segments = this._textNodeSegments(node.textContent);
            for (const seg of segments) {
                const txt = seg.text.trim();
                if (!txt) continue;
                try {
                    const range = doc.createRange();
                    range.setStart(node, seg.start);
                    range.setEnd(node, seg.end);
                    const rects = Array.from(range.getClientRects());
                    const visible = rects.some(rect =>
                        rect.right > bounds.left && rect.left < bounds.right &&
                        rect.bottom > bounds.top && rect.top < bounds.bottom
                    );
                    if (visible) texts.push(txt);
                } catch { }
            }
        }
        return texts.join('').replace(/\s+/g, ' ').trim();
    },

    _epubViewport(body, doc) {
        const win = doc.defaultView || {};
        let visibleWidth = 0;
        let visibleHeight = 0;
        let frameEl = win.frameElement || null;
        while (frameEl) {
            const rect = frameEl.getBoundingClientRect?.();
            if (rect?.width > 0) visibleWidth = visibleWidth ? Math.min(visibleWidth, rect.width) : rect.width;
            if (rect?.height > 0) visibleHeight = visibleHeight ? Math.min(visibleHeight, rect.height) : rect.height;
            frameEl = frameEl.parentElement;
        }
        return {
            width: Math.floor(visibleWidth || doc.documentElement.clientWidth || body.clientWidth || win.innerWidth || 0),
            height: Math.floor(visibleHeight || doc.documentElement.clientHeight || body.clientHeight || win.innerHeight || 0)
        };
    },

    _epubVisibleBounds(body, doc) {
        const viewport = this._epubViewport(body, doc);
        const fallback = {
            left: 0,
            top: 0,
            right: viewport.width,
            bottom: viewport.height,
            width: viewport.width,
            height: viewport.height
        };
        const frameEl = doc?.defaultView?.frameElement;
        const clipEl = frameEl?.closest?.('.epub-container') || frameEl?.parentElement || null;
        if (!frameEl || !clipEl) return fallback;
        try {
            const frameRect = frameEl.getBoundingClientRect();
            const clipRect = clipEl.getBoundingClientRect();
            const docWidth = doc.defaultView?.innerWidth || doc.documentElement?.clientWidth || viewport.width;
            const docHeight = doc.defaultView?.innerHeight || doc.documentElement?.clientHeight || viewport.height;
            const left = Math.max(0, clipRect.left - frameRect.left);
            const top = Math.max(0, clipRect.top - frameRect.top);
            const right = Math.min(docWidth, clipRect.right - frameRect.left);
            const bottom = Math.min(docHeight, clipRect.bottom - frameRect.top);
            if (right <= left || bottom <= top) return fallback;
            return { left, top, right, bottom, width: right - left, height: bottom - top };
        } catch {
            return fallback;
        }
    },

    _textNodeSegments(text) {
        const segments = [];
        const source = String(text || '');
        const re = /[^。！？.!?\n]+[。！？.!?\n]?|\n+/g;
        let match;
        while ((match = re.exec(source))) {
            const raw = match[0];
            if (raw.length <= 80) {
                segments.push({ text: raw, start: match.index, end: match.index + raw.length });
                continue;
            }
            for (let i = 0; i < raw.length; i += 80) {
                const part = raw.slice(i, i + 80);
                segments.push({
                    text: part,
                    start: match.index + i,
                    end: match.index + i + part.length
                });
            }
        }
        return segments;
    },

    // 提取当前页面的图片（base64）
    async getPageImages() {
        const images = [];
        let imgElements = [];
        // EPUB: 从 iframe 内部获取
        if (this.book?.type === 'epub' && this.epubRendition) {
            await this.waitForCurrentPageReady(1000);
            try {
                const current = this.getCurrentEpubContent();
                const contents = current ? [current.content] : (this.epubRendition.getContents() || []);
                const candidates = [];
                for (const content of contents) {
                    const doc = content?.document;
                    const body = doc?.body;
                    if (!body) continue;
                    const viewport = this._epubViewport(body, doc);
                    candidates.push(...this._collectEpubImageCandidates(content, doc, viewport));
                }
                imgElements = this._rankImageCandidates(candidates, { requireCurrentPage: true }).map(item => item.el);
            } catch { }
        } else if (this.book?.type === 'pdf') {
            await this.waitForCurrentPdfRender();
            if (this.pdfIsRendering || this.pdfRenderedPage !== this.currentPage) {
                return images;
            }
            const canvas = document.getElementById('pdf-page-canvas');
            const base64 = this.canvasToBase64(canvas);
            if (base64) images.push(base64);
            return images;
        } else {
            const container = document.getElementById('book-content');
            const rect = container?.getBoundingClientRect();
            const viewW = rect?.width || window.innerWidth;
            const viewH = rect?.height || window.innerHeight;
            imgElements = this._rankImageCandidates(
                this._collectImageCandidates(document, viewW, viewH, '#book-content ')
            ).map(item => item.el);
        }
        for (const img of imgElements.slice(0, 3)) { // 最多3张
            try {
                const base64 = await this.imgToBase64(img);
                if (base64) images.push(base64);
            } catch { }
        }
        return images;
    },

    async waitForCurrentPdfRender(timeout = 1600) {
        if (this.book?.type !== 'pdf') return;
        const targetPage = this.currentPage;
        const start = performance.now();
        while (
            this.currentPage === targetPage &&
            (this.pdfIsRendering || this.pdfRenderedPage !== targetPage) &&
            performance.now() - start < timeout
        ) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    },

    _collectEpubImageCandidates(content, doc, viewport) {
        const bounds = viewport?.left == null ? this._epubVisibleBounds(doc.body, doc) : viewport;
        const candidates = this._collectImageCandidates(doc, bounds);
        const pageRange = this._getCurrentEpubRange(content, doc);
        return candidates.map(item => ({
            ...item,
            inRange: pageRange ? this._rangeIntersectsElement(pageRange, item.el) : false
        }));
    },

    _collectImageCandidates(doc, viewW, viewH, scope = '') {
        const seen = new Set();
        const candidates = [];
        const add = (el) => {
            if (!el || seen.has(el)) return;
            seen.add(el);
            const hasSource = !!(this.getImageSourceInfo(el).raw || this.getBackgroundImageSourceInfo(el).raw);
            const isDrawable = /^(img|svg|image|canvas|object)$/i.test(el.tagName || '');
            if (!hasSource && !isDrawable) return;
            candidates.push({
                el,
                hasSource,
                inRange: false,
                visible: this._isElementVisibleInViewport(el, viewW, viewH),
                area: this._elementArea(el)
            });
        };

        const selector = scope + 'img, ' + scope + 'svg, ' + scope + 'image, ' +
            scope + 'canvas, ' + scope + 'object[type^="image"]';
        doc.querySelectorAll(selector).forEach(add);

        // 漫画 EPUB 常把整页图放在 CSS background-image 上。
        const bgSelector = scope ? scope + '*' : '*';
        doc.querySelectorAll(bgSelector).forEach(el => {
            if (this.getBackgroundImageSourceInfo(el).raw) add(el);
        });

        return candidates;
    },

    _rankImageCandidates(candidates, options = {}) {
        const unique = [];
        const seen = new Set();
        for (const item of candidates) {
            if (!item?.el || seen.has(item.el)) continue;
            seen.add(item.el);
            unique.push(item);
        }
        const currentPage = unique.filter(item => item.inRange || item.visible);
        const pool = options.requireCurrentPage ? currentPage : (currentPage.length ? currentPage : unique);
        return pool
            .filter(item => item.area > 1 || item.visible || item.inRange || item.hasSource)
            .sort((a, b) =>
                Number(b.inRange) - Number(a.inRange) ||
                Number(b.visible) - Number(a.visible) ||
                b.area - a.area
            );
    },

    _getCurrentEpubRange(contents, doc) {
        const loc = this.epubRendition?.location;
        const startCfi = loc?.start?.cfi;
        const endCfi = loc?.end?.cfi;
        if (!startCfi || !endCfi || !contents?.range) return null;
        try {
            const startRange = contents.range(startCfi);
            const endRange = contents.range(endCfi);
            if (!startRange || !endRange) return null;
            const range = doc.createRange();
            range.setStart(startRange.startContainer, startRange.startOffset);
            range.setEnd(endRange.startContainer, endRange.startOffset);
            return range;
        } catch {
            return null;
        }
    },

    _rangeIntersectsElement(range, el) {
        try {
            if (range.intersectsNode?.(el)) return true;
        } catch { }
        try {
            const doc = el.ownerDocument;
            const elRange = doc.createRange();
            elRange.selectNode(el);
            return range.compareBoundaryPoints(3, elRange) > 0 &&
                range.compareBoundaryPoints(1, elRange) < 0;
        } catch {
            return false;
        }
    },

    _elementArea(el) {
        try {
            const rect = el.getBoundingClientRect();
            const naturalW = el.naturalWidth || 0;
            const naturalH = el.naturalHeight || 0;
            return Math.max(rect.width * rect.height, naturalW * naturalH, 0);
        } catch {
            return 0;
        }
    },

    _isElementVisibleInViewport(el, viewW, viewH) {
        try {
            const bounds = typeof viewW === 'object'
                ? viewW
                : { left: 0, top: 0, right: viewW, bottom: viewH };
            const rect = el.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 &&
                rect.right > bounds.left && rect.left < bounds.right &&
                rect.bottom > bounds.top && rect.top < bounds.bottom;
        } catch {
            return false;
        }
    },

    async imgToBase64(el) {
        if (!el) return null;
        const tag = el.tagName?.toLowerCase();
        if (tag === 'canvas') {
            return this.canvasToBase64(el);
        }
        if (tag === 'svg') {
            return this.svgToBase64(el);
        }

        const source = this.getImageSourceInfo(el);
        const background = this.getBackgroundImageSourceInfo(el);
        const directUrl = source.url || background.url;
        const rawUrl = source.raw || background.raw || directUrl;
        if (directUrl?.startsWith('data:image/')) return directUrl;

        if (tag === 'img') {
            const drawn = await this.canvasImageToBase64(el);
            if (drawn) return drawn;
        }

        const fetched = await this.fetchImageAsDataUrl(directUrl);
        if (fetched) return fetched;

        const epubResource = await this.fetchEpubImageAsDataUrl(rawUrl, el);
        if (epubResource) return epubResource;

        return null;
    },

    getImageSourceInfo(el) {
        const raw = el.currentSrc ||
            el.src ||
            el.href?.baseVal ||
            el.getAttribute?.('href') ||
            el.getAttribute?.('xlink:href') ||
            el.getAttribute?.('data-src') ||
            '';
        return { raw, url: this.resolveElementUrl(raw, el) };
    },

    getImageSource(el) {
        return this.getImageSourceInfo(el).url;
    },

    getBackgroundImageSourceInfo(el) {
        let raw = '';
        try {
            const win = el.ownerDocument?.defaultView || window;
            const style = win.getComputedStyle(el);
            const bg = style?.backgroundImage || '';
            const match = bg.match(/url\((['"]?)(.*?)\1\)/);
            raw = match?.[2] || '';
        } catch { }
        return { raw, url: this.resolveElementUrl(raw, el) };
    },

    resolveElementUrl(raw, el) {
        if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('http')) {
            return raw;
        }
        try {
            return new URL(raw, el.ownerDocument?.baseURI || document.baseURI).href;
        } catch {
            return raw;
        }
    },

    async fetchImageAsDataUrl(url) {
        if (!url || /^(#|javascript:)/i.test(url)) return null;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            if (!blob.type.startsWith('image/')) return null;
            return await this.blobToDataUrl(blob);
        } catch {
            return null;
        }
    },

    async fetchEpubImageAsDataUrl(rawUrl, el) {
        const archive = this.epubBook?.archive;
        if (!archive?.getBlob || !rawUrl || /^(data:|blob:|https?:|#|javascript:)/i.test(rawUrl)) {
            return null;
        }

        for (const path of this.getEpubResourceCandidates(rawUrl, el)) {
            try {
                const mime = this.mimeFromPath(path);
                const blob = await archive.getBlob(path, mime);
                if (!blob || blob.size === 0) continue;
                const typedBlob = blob.type ? blob : new Blob([blob], { type: mime });
                if (!typedBlob.type.startsWith('image/')) continue;
                return await this.blobToDataUrl(typedBlob);
            } catch { }
        }
        return null;
    },

    getEpubResourceCandidates(rawUrl, el) {
        const raw = String(rawUrl || '')
            .split('#')[0]
            .split('?')[0]
            .replace(/^\/+/, '')
            .trim();
        const clean = this.safeDecodeURIComponent(raw);
        if (!clean) return [];

        const candidates = new Set([clean, this.normalizePath(clean)]);
        const href = this.epubRendition?.location?.start?.href || '';
        const dir = href.includes('/') ? href.split('/').slice(0, -1).join('/') + '/' : '';
        if (dir) candidates.add(this.normalizePath(dir + clean));

        try {
            const resolved = this.epubBook?.resolve?.(clean);
            if (resolved) candidates.add(this.normalizePath(resolved));
        } catch { }

        const baseUri = el?.ownerDocument?.baseURI || '';
        if (baseUri && !baseUri.startsWith('blob:')) {
            try {
                const path = new URL(clean, baseUri).pathname.replace(/^\/+/, '');
                candidates.add(this.normalizePath(path));
            } catch { }
        }

        return Array.from(candidates).filter(Boolean);
    },

    safeDecodeURIComponent(value) {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    },

    normalizePath(path) {
        try {
            return new URL(path, 'https://epub.local/').pathname.replace(/^\/+/, '');
        } catch {
            return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        }
    },

    mimeFromPath(path) {
        const ext = String(path || '').split('.').pop().toLowerCase();
        const map = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp'
        };
        return map[ext] || 'image/jpeg';
    },

    blobToDataUrl(blob) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    },

    canvasToBase64(canvas) {
        if (!canvas || !canvas.width || !canvas.height) return null;
        try {
            const max = 1100;
            const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
            const out = document.createElement('canvas');
            out.width = Math.max(1, Math.round(canvas.width * scale));
            out.height = Math.max(1, Math.round(canvas.height * scale));
            const ctx = out.getContext('2d', { alpha: false });
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, out.width, out.height);
            ctx.drawImage(canvas, 0, 0, out.width, out.height);
            return out.toDataURL('image/jpeg', 0.8);
        } catch {
            return null;
        }
    },

    async canvasImageToBase64(img) {
        if (!img.complete || !img.naturalWidth) {
            await new Promise(resolve => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
                setTimeout(resolve, 1200);
            });
        }
        if (!img.naturalWidth || !img.naturalHeight) return null;

        try {
            const max = 900;
            const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.75);
        } catch {
            return null;
        }
    },

    svgToBase64(svg) {
        try {
            const clone = svg.cloneNode(true);
            if (!clone.getAttribute('xmlns')) {
                clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            }
            const text = new XMLSerializer().serializeToString(clone);
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
        } catch {
            return null;
        }
    }
};
