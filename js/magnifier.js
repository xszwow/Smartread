const Magnifier = {
    enabled: false,
    scale: 2,
    minScale: 1.25,
    maxScale: 3.5,
    step: 0.25,
    width: 260,
    height: 260,
    doubleTapDelay: 650,
    doubleTapDistance: 48,
    moveTolerance: 12,
    view: null,
    reader: null,
    book: null,
    button: null,
    hitArea: null,
    lens: null,
    hint: null,
    sourceClone: null,
    observer: null,
    pointerId: null,
    lastPointer: null,
    openPointer: null,
    activePointer: null,
    lastOpenTap: null,
    lastActiveTap: null,
    hintTimer: null,
    refreshTimer: null,
    scrollRaf: null,
    suppressDblClickUntil: 0,
    cleanupToken: 0,
    desktopPdfPointers: new Set(),
    desktopPdfHadMultiTouch: false,
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
        this.hint.textContent = '双击关闭，拖动移动，+/- 调倍率，Esc 退出';

        this.reader.append(this.hitArea, this.lens, this.hint);

        this.button.addEventListener('click', () => this.toggle());
        this.reader.addEventListener('pointerdown', e => this.handleReaderPointerDown(e), true);
        this.reader.addEventListener('pointermove', e => this.handleReaderPointerMove(e), true);
        this.reader.addEventListener('pointerup', e => this.handleReaderPointerUp(e), true);
        this.reader.addEventListener('pointercancel', e => this.cancelOpenPointer(e), true);
        this.reader.addEventListener('dblclick', e => this.handleReaderDblClick(e), true);

        this.hitArea.addEventListener('pointerdown', e => this.handleHitAreaPointerDown(e));
        this.hitArea.addEventListener('pointermove', e => this.handleHitAreaPointerMove(e));
        this.hitArea.addEventListener('pointerup', e => this.handleHitAreaPointerUp(e));
        this.hitArea.addEventListener('pointercancel', e => this.handleHitAreaPointerCancel(e));
        this.hitArea.addEventListener('dblclick', e => this.handleActiveDblClick(e));
        this.hitArea.addEventListener('wheel', e => this.handleWheel(e), { passive: false });

        this.book.addEventListener('scroll', () => this.handleContentScroll(), { passive: true });
        this.reader.addEventListener('scroll', () => this.handleContentScroll(), { passive: true });
        document.addEventListener('keydown', e => this.handleKeydown(e));
        document.addEventListener('reader-page-change', () => this.handlePageChange());
        window.addEventListener('resize', () => this.handlePageChange());

        this.applyScale();
    },

    toggle() {
        if (this.isDesktopVisualMode()) {
            if (this.enabled) this.disable();
            Reader.toggleDesktopVisualZoom(this.getDesktopVisualCenter());
            return;
        }
        if (this.enabled) this.disable();
        else this.enableAtCenter();
    },

    enable() {
        if (!this.view || !this.reader || !this.book || !this.lens) return false;
        this.cleanupToken += 1;
        this.enabled = true;
        this.pointerId = null;
        this.activePointer = null;
        this.lastActiveTap = null;
        this.view.classList.add('magnifier-mode');
        this.button?.classList.add('is-tool-active');
        this.button?.setAttribute('aria-pressed', 'true');
        this.applyScale();
        this.refreshClone();
        this.startObserver();
        this.showHint();
        return true;
    },

    enableAtCenter() {
        if (!this.enable()) return;
        const rect = this.reader.getBoundingClientRect();
        this.moveTo({
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            preventDefault() { }
        });
    },

    enableAtEvent(e) {
        if (!this.enable()) return;
        this.moveTo(this.normalizePointerEvent(e));
    },

    disable() {
        if (!this.view) return;
        const cleanupToken = ++this.cleanupToken;
        this.enabled = false;
        this.view.classList.remove('magnifier-mode');
        this.button?.classList.remove('is-tool-active');
        this.button?.setAttribute('aria-pressed', 'false');
        this.hideLens();
        this.hideHint();
        this.stopObserver();
        this.clearRefreshTimer();
        this.releaseCapturedPointer();
        this.pointerId = null;
        this.lastPointer = null;
        this.openPointer = null;
        this.activePointer = null;
        this.lastOpenTap = null;
        this.lastActiveTap = null;
        this.desktopPdfPointers.clear();
        this.desktopPdfHadMultiTouch = false;
        requestAnimationFrame(() => setTimeout(() => {
            if (!this.enabled && cleanupToken === this.cleanupToken) this.clearClone();
        }, 0));
    },

    handleReaderPointerDown(e) {
        if (this.isDesktopVisualTarget(e.target)) {
            this.desktopPdfPointers.add(e.pointerId);
            if (this.desktopPdfPointers.size > 1) {
                this.desktopPdfHadMultiTouch = true;
                this.lastOpenTap = null;
                this.openPointer = null;
                return;
            }
            if (this.desktopPdfHadMultiTouch) return;
            const point = this.getEventPoint(e);
            this.openPointer = this.createPointerState(e, point);
            return;
        }
        if (!this.canUseReaderGesture(e)) return;
        const point = this.getEventPoint(e);
        if (this.isDoubleTap(this.lastOpenTap, point)) {
            e.preventDefault();
            e.stopPropagation();
            this.lastOpenTap = null;
            this.openPointer = null;
            this.suppressDblClickReplay();
            this.enableAtEvent(e);
            return;
        }
        this.openPointer = this.createPointerState(e, point);
    },

    handleReaderPointerMove(e) {
        this.markPointerMove(this.openPointer, e);
    },

    handleReaderPointerUp(e) {
        if (this.isDesktopVisualMode() && this.desktopPdfPointers.has(e.pointerId)) {
            this.desktopPdfPointers.delete(e.pointerId);
            if (this.desktopPdfHadMultiTouch) {
                this.openPointer = null;
                this.lastOpenTap = null;
                if (!this.desktopPdfPointers.size) this.desktopPdfHadMultiTouch = false;
                return;
            }
            const point = this.finishTapPointer(this.openPointer, e);
            this.openPointer = null;
            if (!point) {
                this.lastOpenTap = null;
                return;
            }
            if (this.isDoubleTap(this.lastOpenTap, point)) {
                this.lastOpenTap = null;
                this.suppressDblClickReplay();
                Reader.toggleDesktopVisualZoom({ clientX: e.clientX, clientY: e.clientY });
                return;
            }
            this.lastOpenTap = point;
            return;
        }
        const point = this.finishTapPointer(this.openPointer, e);
        this.openPointer = null;
        if (point) this.lastOpenTap = point;
    },

    cancelOpenPointer(e) {
        if (this.isDesktopVisualMode() && e && this.desktopPdfPointers.has(e.pointerId)) {
            this.desktopPdfPointers.delete(e.pointerId);
            if (!this.desktopPdfPointers.size) this.desktopPdfHadMultiTouch = false;
            this.lastOpenTap = null;
        }
        if (!e || this.samePointer(this.openPointer, e)) this.openPointer = null;
    },

    handleReaderDblClick(e) {
        if (!this.isReaderActive()) return;
        if (this.shouldSuppressDblClick()) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (this.isDesktopVisualTarget(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            this.suppressDblClickReplay();
            Reader.toggleDesktopVisualZoom({ clientX: e.clientX, clientY: e.clientY });
            return;
        }
        if (this.enabled || this.isIgnoredTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        this.suppressDblClickReplay();
        this.enableAtEvent(e);
    },

    handleHitAreaPointerDown(e) {
        if (!this.enabled) return;
        const point = this.getEventPoint(e);
        e.preventDefault();
        e.stopPropagation();
        if (this.isDoubleTap(this.lastActiveTap, point)) {
            this.lastActiveTap = null;
            this.activePointer = null;
            this.suppressDblClickReplay();
            this.disable();
            return;
        }
        this.activePointer = this.createPointerState(e, point);
        this.pointerId = e.pointerId;
        try { this.hitArea.setPointerCapture(e.pointerId); } catch { }
        this.moveTo(e);
    },

    handleHitAreaPointerMove(e) {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        this.markPointerMove(this.activePointer, e);
        this.moveTo(e);
    },

    handleHitAreaPointerUp(e) {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        const point = this.finishTapPointer(this.activePointer, e);
        this.activePointer = null;
        this.releasePointer(e);
        if (point) this.lastActiveTap = point;
    },

    handleHitAreaPointerCancel(e) {
        this.activePointer = null;
        this.releasePointer(e);
    },

    handleActiveDblClick(e) {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.shouldSuppressDblClick()) return;
        this.suppressDblClickReplay();
        this.disable();
    },

    canUseReaderGesture(e) {
        return this.isReaderActive()
            && !this.enabled
            && !this.shouldSuppressDblClick()
            && !this.isIgnoredTarget(e.target);
    },

    createPointerState(e, point) {
        return {
            id: e.pointerId,
            x: point.x,
            y: point.y,
            time: point.time,
            moved: false
        };
    },

    markPointerMove(state, e) {
        if (!state || !this.samePointer(state, e)) return;
        const point = this.getEventPoint(e);
        if (Math.hypot(point.x - state.x, point.y - state.y) > this.moveTolerance) {
            state.moved = true;
        }
    },

    finishTapPointer(state, e) {
        if (!state || !this.samePointer(state, e)) return null;
        const point = this.getEventPoint(e);
        const duration = point.time - state.time;
        const distance = Math.hypot(point.x - state.x, point.y - state.y);
        if (state.moved || duration > this.doubleTapDelay || distance > this.moveTolerance) return null;
        return point;
    },

    samePointer(state, e) {
        return !!state && state.id === e.pointerId;
    },

    getEventPoint(e) {
        return {
            x: e.clientX,
            y: e.clientY,
            time: performance.now()
        };
    },

    isDoubleTap(last, point) {
        if (!last) return false;
        return point.time - last.time <= this.doubleTapDelay
            && Math.hypot(point.x - last.x, point.y - last.y) <= this.doubleTapDistance;
    },

    suppressDblClickReplay() {
        this.suppressDblClickUntil = performance.now() + this.doubleTapDelay;
    },

    shouldSuppressDblClick() {
        return performance.now() < this.suppressDblClickUntil;
    },

    normalizePointerEvent(e) {
        return {
            clientX: e.clientX,
            clientY: e.clientY,
            preventDefault: () => e.preventDefault?.()
        };
    },

    isDesktopPdfMode() {
        return this.isDesktopVisualMode() && Reader.book?.type === 'pdf';
    },

    isDesktopVisualMode() {
        return window.SmartReadDesktop?.appMode === 'desktop'
            && typeof Reader !== 'undefined'
            && Reader.isDesktopVisualZoomReading?.();
    },

    isDesktopPdfTarget(target) {
        return this.isDesktopVisualTarget(target) && Reader.book?.type === 'pdf';
    },

    isDesktopVisualTarget(target) {
        if (!this.isDesktopVisualMode()) return false;
        if (Reader.book?.type === 'pdf') return !!target?.closest?.('#pdf-page-stage');
        if (Reader.book?.type === 'epub') return !!target?.closest?.('#book-content.book-epub, .epub-container, .epub-view');
        if (Reader.book?.type === 'txt') return !!target?.closest?.('#book-content.book-txt');
        return false;
    },

    getDesktopVisualCenter() {
        if (Reader.book?.type === 'epub') return Reader.getDesktopEpubViewportCenter();
        if (Reader.book?.type === 'txt') return Reader.getDesktopTextViewportCenter?.() || Reader.getPdfViewportCenter();
        return Reader.getPdfViewportCenter();
    },

    moveTo(e) {
        if (!this.enabled || !this.reader || !this.book || !this.lens) return;
        e.preventDefault?.();
        if (!this.sourceClone) this.refreshClone();

        const readerRect = this.reader.getBoundingClientRect();
        const bookRect = this.book.getBoundingClientRect();
        const contentSize = this.getContentSize();
        const contentX = this.clamp(e.clientX - bookRect.left + this.book.scrollLeft, 0, contentSize.width);
        const contentY = this.clamp(e.clientY - bookRect.top + this.book.scrollTop, 0, contentSize.height);
        const lensX = this.clamp(e.clientX - readerRect.left, this.width / 2, Math.max(this.width / 2, readerRect.width - this.width / 2));
        const lensY = this.clamp(e.clientY - readerRect.top, this.height / 2, Math.max(this.height / 2, readerRect.height - this.height / 2));

        this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
        this.lens.style.left = lensX + 'px';
        this.lens.style.top = lensY + 'px';
        this.lens.classList.add('is-visible');

        if (this.sourceClone) {
            const x = this.width / 2 - contentX * this.scale;
            const y = this.height / 2 - contentY * this.scale;
            this.sourceClone.style.transform = `translate(${x}px, ${y}px) scale(${this.scale})`;
        }
    },

    refreshClone() {
        if (!this.enabled || !this.book || !this.lens) return;
        this.clearClone();
        const clone = this.book.cloneNode(true);
        const size = this.getContentSize();
        clone.removeAttribute('id');
        clone.classList.add('reader-magnifier-source');
        clone.setAttribute('aria-hidden', 'true');
        clone.style.width = size.width + 'px';
        clone.style.height = size.height + 'px';
        clone.style.minHeight = size.height + 'px';
        clone.scrollTop = 0;
        clone.scrollLeft = 0;
        this.stripDuplicateIds(clone);
        this.copyCanvases(this.book, clone);
        this.sourceClone = clone;
        this.lens.appendChild(clone);
        this.applyScale();
        this.repositionLastPointer();
    },

    getContentSize() {
        return {
            width: Math.max(1, this.book.scrollWidth, this.book.clientWidth, this.book.offsetWidth),
            height: Math.max(1, this.book.scrollHeight, this.book.clientHeight, this.book.offsetHeight)
        };
    },

    copyCanvases(source, target) {
        const sourceCanvases = source.querySelectorAll('canvas');
        const targetCanvases = target.querySelectorAll('canvas');
        sourceCanvases.forEach((canvas, index) => {
            const targetCanvas = targetCanvases[index];
            if (!targetCanvas) return;
            targetCanvas.width = canvas.width;
            targetCanvas.height = canvas.height;
            targetCanvas.style.width = canvas.style.width || canvas.clientWidth + 'px';
            targetCanvas.style.height = canvas.style.height || canvas.clientHeight + 'px';
            try {
                targetCanvas.getContext('2d')?.drawImage(canvas, 0, 0);
            } catch { }
        });
    },

    stripDuplicateIds(root) {
        root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
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
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            this.setScale(this.scale - this.step);
        } else if (e.key === '0') {
            e.preventDefault();
            this.setScale(2);
        } else {
            return;
        }
        this.repositionLastPointer();
        this.showHint();
    },

    setScale(value) {
        const next = this.clamp(Number(value) || this.scale, this.minScale, this.maxScale);
        this.scale = Math.round(next * 100) / 100;
        this.applyScale();
    },

    applyScale() {
        if (this.lens) this.lens.dataset.scale = this.scale.toFixed(2).replace(/\.?0+$/, '') + 'x';
    },

    handleContentScroll() {
        if (!this.enabled || !this.lastPointer || this.scrollRaf) return;
        this.scrollRaf = requestAnimationFrame(() => {
            this.scrollRaf = null;
            this.repositionLastPointer();
        });
    },

    handlePageChange() {
        this.lastOpenTap = null;
        this.lastActiveTap = null;
        this.desktopPdfPointers.clear();
        this.desktopPdfHadMultiTouch = false;
        if (!this.enabled) return;
        this.hideLens();
        this.scheduleRefresh();
    },

    scheduleRefresh(delay = 80) {
        if (!this.enabled) return;
        this.clearRefreshTimer();
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refreshClone();
        }, delay);
    },

    clearRefreshTimer() {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
    },

    startObserver() {
        this.stopObserver();
        if (typeof MutationObserver === 'undefined' || !this.book) return;
        this.observer = new MutationObserver(() => this.scheduleRefresh(120));
        this.observer.observe(this.book, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true
        });
    },

    stopObserver() {
        this.observer?.disconnect();
        this.observer = null;
    },

    releasePointer(e) {
        if (this.hitArea?.hasPointerCapture?.(e.pointerId)) {
            try { this.hitArea.releasePointerCapture(e.pointerId); } catch { }
        }
        if (this.pointerId === e.pointerId) this.pointerId = null;
    },

    releaseCapturedPointer() {
        if (this.pointerId != null && this.hitArea?.hasPointerCapture?.(this.pointerId)) {
            try { this.hitArea.releasePointerCapture(this.pointerId); } catch { }
        }
    },

    repositionLastPointer() {
        if (!this.lastPointer) return;
        this.moveTo({
            ...this.lastPointer,
            preventDefault() { }
        });
    },

    clearClone() {
        this.sourceClone?.remove();
        this.sourceClone = null;
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

    isReaderActive() {
        return !!this.view?.classList.contains('active');
    },

    isIgnoredTarget(target) {
        return !!target?.closest?.('button, input, textarea, select, a, label, [contenteditable="true"], .float-nav-btn, .reader-magnifier-hit, .reader-magnifier-lens');
    },

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
};
