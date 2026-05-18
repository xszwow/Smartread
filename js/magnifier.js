const Magnifier = {
    enabled: false,
    scale: 2,
    minScale: 1.25,
    maxScale: 3.5,
    step: 0.25,
    width: 260,
    height: 260,
    view: null,
    reader: null,
    book: null,
    button: null,
    hitArea: null,
    lens: null,
    hint: null,
    sourceClone: null,
    pointerId: null,
    lastPointer: null,
    hintTimer: null,
    refreshTimers: new Set(),
    observer: null,
    frameHandlerObserver: null,
    handledFrames: new WeakSet(),

    init() {
        this.view = document.getElementById('reader-view');
        this.reader = document.getElementById('reader-content');
        this.book = document.getElementById('book-content');
        this.button = document.getElementById('btn-magnifier');
        if (!this.view || !this.reader || !this.book || !this.button) return;

        this.hitArea = document.createElement('div');
        this.hitArea.className = 'reader-magnifier-hit';
        this.hitArea.setAttribute('aria-hidden', 'true');

        this.lens = document.createElement('div');
        this.lens.className = 'reader-magnifier-lens';
        this.lens.setAttribute('aria-hidden', 'true');
        this.lens.style.setProperty('--magnifier-width', this.width + 'px');
        this.lens.style.setProperty('--magnifier-height', this.height + 'px');

        this.hint = document.createElement('div');
        this.hint.className = 'reader-magnifier-hint';
        this.hint.textContent = '双击关闭，滚轮 / +/- 调倍率，Esc 退出';

        this.reader.append(this.hitArea, this.lens, this.hint);
        this.button.addEventListener('click', () => this.toggle());
        this.reader.addEventListener('dblclick', e => this.handleReaderDblClick(e), true);
        this.hitArea.addEventListener('pointerenter', e => this.moveTo(e));
        this.hitArea.addEventListener('pointermove', e => this.moveTo(e));
        this.hitArea.addEventListener('pointerdown', e => this.capturePointer(e));
        this.hitArea.addEventListener('pointerup', e => this.releasePointer(e));
        this.hitArea.addEventListener('pointercancel', e => this.releasePointer(e));
        this.hitArea.addEventListener('pointerleave', () => {
            if (this.pointerId == null) this.hideLens();
        });
        this.hitArea.addEventListener('wheel', e => this.handleWheel(e), { passive: false });
        this.hitArea.addEventListener('dblclick', e => this.handleActiveDblClick(e));
        document.addEventListener('keydown', e => this.handleKeydown(e));
        document.addEventListener('reader-page-change', () => {
            this.handlePageChange();
            this.scheduleFrameHandlerInstall();
        });
        window.addEventListener('resize', () => {
            this.handlePageChange();
            this.scheduleFrameHandlerInstall();
        });
        this.applyScale();
        this.startFrameHandlerObserver();
        this.scheduleFrameHandlerInstall();
    },

    toggle() {
        if (this.enabled) this.disable();
        else this.enable();
    },

    enable() {
        if (!this.view || !this.reader || !this.book) return;
        this.enabled = true;
        this.view.classList.add('magnifier-mode');
        this.button?.classList.add('is-tool-active');
        this.button?.setAttribute('aria-pressed', 'true');
        this.applyScale();
        this.refreshClone();
        this.startObserver();
        this.showHint();
    },

    enableAtEvent(e) {
        if (!this.view || !this.reader || !this.book) return;
        if (!this.enabled) this.enable();
        this.moveTo(this.normalizePointerEvent(e));
    },

    disable() {
        this.enabled = false;
        this.view?.classList.remove('magnifier-mode');
        this.button?.classList.remove('is-tool-active');
        this.button?.setAttribute('aria-pressed', 'false');
        this.hideLens();
        this.hideHint();
        this.clearClone();
        this.stopObserver();
        this.clearRefreshTimers();
        if (this.pointerId != null && this.hitArea?.hasPointerCapture?.(this.pointerId)) {
            try { this.hitArea.releasePointerCapture(this.pointerId); } catch { }
        }
        this.pointerId = null;
        this.lastPointer = null;
    },

    handleReaderDblClick(e) {
        if (!this.isReaderActive()) return;
        if (this.enabled) return;
        if (this.isIgnoredDoubleClickTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        this.enableAtEvent(e);
    },

    handleFrameDblClick(e, frame) {
        if (!this.isReaderActive()) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.enabled) {
            this.disable();
            return;
        }
        const frameRect = frame.getBoundingClientRect();
        this.enableAtEvent({
            clientX: frameRect.left + e.clientX,
            clientY: frameRect.top + e.clientY,
            preventDefault() { },
            stopPropagation() { }
        });
    },

    handleActiveDblClick(e) {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        this.disable();
    },

    capturePointer(e) {
        if (!this.enabled) return;
        this.pointerId = e.pointerId;
        try { this.hitArea.setPointerCapture(e.pointerId); } catch { }
        this.moveTo(e);
    },

    releasePointer(e) {
        if (this.hitArea?.hasPointerCapture?.(e.pointerId)) {
            try { this.hitArea.releasePointerCapture(e.pointerId); } catch { }
        }
        if (this.pointerId === e.pointerId) this.pointerId = null;
    },

    moveTo(e) {
        if (!this.enabled || !this.reader || !this.book || !this.lens) return;
        e.preventDefault?.();
        if (!this.sourceClone) this.refreshClone();

        const readerRect = this.reader.getBoundingClientRect();
        const bookRect = this.book.getBoundingClientRect();
        const halfWidth = this.width / 2;
        const halfHeight = this.height / 2;
        const centerX = this.clamp(e.clientX - readerRect.left, 0, readerRect.width);
        const centerY = this.clamp(e.clientY - readerRect.top, 0, readerRect.height);
        const bookX = this.clamp(e.clientX - bookRect.left, 0, Math.max(1, bookRect.width));
        const bookY = this.clamp(e.clientY - bookRect.top, 0, Math.max(1, bookRect.height));

        this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
        this.lens.style.left = centerX + 'px';
        this.lens.style.top = centerY + 'px';
        this.lens.classList.add('is-visible');

        if (this.sourceClone) {
            const x = halfWidth - bookX * this.scale;
            const y = halfHeight - bookY * this.scale;
            this.sourceClone.style.transform = `translate(${x}px, ${y}px) scale(${this.scale})`;
        }
    },

    normalizePointerEvent(e) {
        return {
            clientX: e.clientX,
            clientY: e.clientY,
            preventDefault: () => e.preventDefault?.(),
            stopPropagation: () => e.stopPropagation?.()
        };
    },

    handleWheel(e) {
        if (!this.enabled) return;
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 : -1;
        this.setScale(this.scale + direction * this.step);
        this.moveTo(e);
        this.showHint();
    },

    handleKeydown(e) {
        if (!this.enabled) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            this.disable();
            return;
        }
        if (typeof App !== 'undefined' && App.isTypingTarget?.(e.target)) return;
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            this.setScale(this.scale + this.step);
            this.repositionLastPointer();
            this.showHint();
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            this.setScale(this.scale - this.step);
            this.repositionLastPointer();
            this.showHint();
        } else if (e.key === '0') {
            e.preventDefault();
            this.setScale(2);
            this.repositionLastPointer();
            this.showHint();
        }
    },

    setScale(value) {
        const next = this.clamp(Number(value) || this.scale, this.minScale, this.maxScale);
        this.scale = Math.round(next * 100) / 100;
        this.applyScale();
    },

    applyScale() {
        if (this.lens) this.lens.dataset.scale = this.formatScale();
    },

    formatScale() {
        return this.scale.toFixed(2).replace(/\.?0+$/, '') + 'x';
    },

    refreshClone() {
        if (!this.enabled || !this.book || !this.lens) return;
        this.clearClone();

        const imageClone = this.createImagePageClone();
        if (imageClone) {
            this.sourceClone = imageClone;
            this.lens.appendChild(imageClone);
            this.applyScale();
            this.repositionLastPointer();
            return;
        }

        const clone = this.book.cloneNode(true);
        clone.removeAttribute('id');
        clone.classList.add('reader-magnifier-source');
        clone.setAttribute('aria-hidden', 'true');
        clone.style.width = Math.max(1, this.book.clientWidth || this.book.offsetWidth) + 'px';
        clone.style.height = Math.max(1, this.book.clientHeight || this.book.offsetHeight) + 'px';
        clone.style.fontSize = getComputedStyle(this.book).fontSize;
        this.stripDuplicateIds(clone);
        this.copyCanvases(this.book, clone);
        this.copyIframes(this.book, clone);

        this.sourceClone = clone;
        this.lens.appendChild(clone);
        this.applyScale();
        this.repositionLastPointer();
    },

    createImagePageClone() {
        if (!this.book?.classList.contains('book-epub')) return null;
        const frame = this.book.querySelector('iframe');
        if (!frame) return null;

        try {
            const doc = frame.contentDocument;
            const body = doc?.body;
            if (!doc || !body) return null;

            const text = (body.innerText || body.textContent || '').replace(/\s+/g, '').trim();
            const images = Array.from(doc.images || [])
                .filter(img => {
                    const rect = img.getBoundingClientRect();
                    return (img.currentSrc || img.src || img.getAttribute('src')) &&
                        (img.complete || img.naturalWidth > 0) &&
                        rect.width > 4 &&
                        rect.height > 4;
                });
            if (!images.length || text.length > 20) return null;

            const bookRect = this.book.getBoundingClientRect();
            const frameRect = frame.getBoundingClientRect();
            const clone = document.createElement('div');
            clone.className = 'book-text book-epub reader-magnifier-source reader-magnifier-image-page';
            clone.setAttribute('aria-hidden', 'true');
            clone.style.width = Math.max(1, this.book.clientWidth || this.book.offsetWidth) + 'px';
            clone.style.height = Math.max(1, this.book.clientHeight || this.book.offsetHeight) + 'px';

            images.forEach(sourceImg => {
                const rect = sourceImg.getBoundingClientRect();
                const img = document.createElement('img');
                img.decoding = 'sync';
                img.loading = 'eager';
                img.src = sourceImg.currentSrc || sourceImg.src || sourceImg.getAttribute('src');
                img.alt = '';
                img.style.left = (frameRect.left + rect.left - bookRect.left) + 'px';
                img.style.top = (frameRect.top + rect.top - bookRect.top) + 'px';
                img.style.width = rect.width + 'px';
                img.style.height = rect.height + 'px';
                clone.appendChild(img);
            });

            return clone;
        } catch {
            return null;
        }
    },

    clearClone() {
        this.sourceClone?.remove();
        this.sourceClone = null;
    },

    stripDuplicateIds(root) {
        root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    },

    copyCanvases(sourceRoot, cloneRoot) {
        const sources = sourceRoot.querySelectorAll('canvas');
        const targets = cloneRoot.querySelectorAll('canvas');
        sources.forEach((source, index) => {
            const target = targets[index];
            if (!target) return;
            target.width = source.width;
            target.height = source.height;
            target.style.cssText = source.style.cssText;
            try {
                target.getContext('2d')?.drawImage(source, 0, 0);
            } catch { }
        });
    },

    copyIframes(sourceRoot, cloneRoot) {
        const sources = sourceRoot.querySelectorAll('iframe');
        const targets = cloneRoot.querySelectorAll('iframe');
        sources.forEach((source, index) => {
            const target = targets[index];
            if (!target) return;
            target.style.cssText = source.style.cssText;
            if (source.width) target.width = source.width;
            if (source.height) target.height = source.height;
            try {
                const doc = source.contentDocument;
                if (!doc?.documentElement) {
                    if (source.src) target.src = source.src;
                    return;
                }
                const scrollState = this.getFrameScrollState(source, doc);
                const docClone = doc.documentElement.cloneNode(true);
                docClone.querySelectorAll('script').forEach(el => el.remove());
                this.prepareFrameCloneDocument(doc, docClone);
                target.removeAttribute('src');
                target.srcdoc = '<!doctype html>\n' + docClone.outerHTML;
                target.addEventListener('load', () => {
                    this.restoreFrameScrollState(target, scrollState);
                    this.repositionLastPointer();
                }, { once: true });
            } catch { }
        });
    },

    prepareFrameCloneDocument(sourceDoc, docClone) {
        this.ensureCloneBase(sourceDoc, docClone);
        this.copyResolvedAttributes(sourceDoc, docClone, '[src]', 'src', el => el.currentSrc || el.src);
        this.copyResolvedAttributes(sourceDoc, docClone, '[href]', 'href', el => el.href);
        this.copyResolvedAttributes(sourceDoc, docClone, 'image[href]', 'href', el => el.href?.baseVal || el.getAttribute('href'));
        this.copyResolvedAttributes(sourceDoc, docClone, 'image[xlink\\:href]', 'xlink:href', el => el.href?.baseVal || el.getAttribute('xlink:href'));
        this.copyResolvedSrcsets(sourceDoc, docClone);
    },

    ensureCloneBase(sourceDoc, docClone) {
        const baseURI = sourceDoc.baseURI || sourceDoc.location?.href;
        if (!baseURI) return;
        let head = docClone.querySelector('head');
        if (!head) {
            head = sourceDoc.createElement('head');
            docClone.insertBefore(head, docClone.firstChild);
        }
        let base = head.querySelector('base');
        if (!base) {
            base = sourceDoc.createElement('base');
            head.insertBefore(base, head.firstChild);
        }
        base.setAttribute('href', baseURI);
    },

    copyResolvedAttributes(sourceDoc, docClone, selector, attr, valueGetter) {
        const sources = sourceDoc.querySelectorAll(selector);
        const targets = docClone.querySelectorAll(selector);
        sources.forEach((source, index) => {
            const target = targets[index];
            if (!target) return;
            const raw = valueGetter(source) || source.getAttribute(attr);
            const resolved = this.resolveResourceUrl(raw, sourceDoc.baseURI);
            if (resolved) target.setAttribute(attr, resolved);
        });
    },

    copyResolvedSrcsets(sourceDoc, docClone) {
        const sources = sourceDoc.querySelectorAll('[srcset]');
        const targets = docClone.querySelectorAll('[srcset]');
        sources.forEach((source, index) => {
            const target = targets[index];
            if (!target) return;
            const srcset = source.getAttribute('srcset') || '';
            const resolved = srcset.split(',')
                .map(part => {
                    const trimmed = part.trim();
                    if (!trimmed) return '';
                    const pieces = trimmed.split(/\s+/);
                    const url = this.resolveResourceUrl(pieces.shift(), sourceDoc.baseURI);
                    return [url, ...pieces].filter(Boolean).join(' ');
                })
                .filter(Boolean)
                .join(', ');
            if (resolved) target.setAttribute('srcset', resolved);
        });
    },

    resolveResourceUrl(value, baseURI) {
        if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:')) return value || '';
        try {
            return new URL(value, baseURI).href;
        } catch {
            return value;
        }
    },

    getFrameScrollState(frame, doc) {
        const win = frame.contentWindow;
        const root = doc.documentElement;
        const body = doc.body;
        return {
            x: win?.scrollX || root?.scrollLeft || body?.scrollLeft || 0,
            y: win?.scrollY || root?.scrollTop || body?.scrollTop || 0,
            rootLeft: root?.scrollLeft || 0,
            rootTop: root?.scrollTop || 0,
            bodyLeft: body?.scrollLeft || 0,
            bodyTop: body?.scrollTop || 0
        };
    },

    restoreFrameScrollState(frame, state) {
        try {
            const win = frame.contentWindow;
            const doc = frame.contentDocument;
            if (win) win.scrollTo(state.x, state.y);
            if (doc?.documentElement) {
                doc.documentElement.scrollLeft = state.rootLeft || state.x || 0;
                doc.documentElement.scrollTop = state.rootTop || state.y || 0;
            }
            if (doc?.body) {
                doc.body.scrollLeft = state.bodyLeft || state.x || 0;
                doc.body.scrollTop = state.bodyTop || state.y || 0;
            }
        } catch { }
    },

    scheduleRefresh(delay = 120) {
        if (!this.enabled) return;
        const timer = setTimeout(() => {
            this.refreshTimers.delete(timer);
            this.refreshClone();
        }, delay);
        this.refreshTimers.add(timer);
    },

    clearRefreshTimers() {
        this.refreshTimers.forEach(timer => clearTimeout(timer));
        this.refreshTimers.clear();
    },

    handlePageChange() {
        if (!this.enabled) return;
        this.hideLens();
        this.clearClone();
        this.scheduleRefresh(80);
        this.scheduleRefresh(360);
    },

    startObserver() {
        this.stopObserver();
        if (typeof MutationObserver === 'undefined' || !this.book) return;
        this.observer = new MutationObserver(() => this.scheduleRefresh(80));
        this.observer.observe(this.book, { childList: true, subtree: true });
    },

    stopObserver() {
        this.observer?.disconnect();
        this.observer = null;
    },

    startFrameHandlerObserver() {
        if (!this.book || typeof MutationObserver === 'undefined') return;
        this.frameHandlerObserver?.disconnect();
        this.frameHandlerObserver = new MutationObserver(() => this.scheduleFrameHandlerInstall());
        this.frameHandlerObserver.observe(this.book, { childList: true, subtree: true });
    },

    scheduleFrameHandlerInstall() {
        setTimeout(() => this.installFrameDblClickHandlers(), 80);
        setTimeout(() => this.installFrameDblClickHandlers(), 450);
    },

    installFrameDblClickHandlers() {
        if (!this.book) return;
        this.book.querySelectorAll('iframe').forEach(frame => {
            if (this.handledFrames.has(frame)) return;
            try {
                const doc = frame.contentDocument;
                if (!doc) return;
                doc.addEventListener('dblclick', e => this.handleFrameDblClick(e, frame), true);
                frame.addEventListener('load', () => {
                    this.handledFrames.delete(frame);
                    this.installFrameDblClickHandlers();
                }, { once: true });
                this.handledFrames.add(frame);
            } catch { }
        });
    },

    isReaderActive() {
        return !!this.view?.classList.contains('active');
    },

    isIgnoredDoubleClickTarget(target) {
        return !!target?.closest?.('button, input, textarea, select, a, .float-nav-btn, .reader-magnifier-hit, .reader-magnifier-lens');
    },

    repositionLastPointer() {
        if (!this.lastPointer) return;
        this.moveTo({
            ...this.lastPointer,
            preventDefault() { }
        });
    },

    showHint() {
        if (!this.hint) return;
        this.hint.classList.add('is-visible');
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => this.hideHint(), 2600);
    },

    hideHint() {
        this.hint?.classList.remove('is-visible');
        clearTimeout(this.hintTimer);
        this.hintTimer = null;
    },

    hideLens() {
        this.lens?.classList.remove('is-visible');
    },

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
};
