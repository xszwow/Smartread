/* ===== 主应用模块 ===== */
const App = {
    aiReadRequestId: 0,
    mobileSubtitleMode: 'large',
    defaultRightPanelWidth: 380,
    mobileMoreOpen: false,
    mobileDrawerExpanded: false,
    mobileActiveTool: null,
    aiTTSPreviewText: '',
    aiTTSPreviewSentences: [],
    aiTTSSelectedIndex: 0,
    popupPanelNames: ['tts', 'theme', 'font', 'settings', 'notes', 'map', 'toc'],
    activePopupPanel: null,
    lastPanelTrigger: null,

    async init() {
        this.mobileSubtitleMode = this.loadMobileSubtitlesSetting();
        await Bookshelf.init();
        await AIConfig.refresh();
        TTS.init();
        this.bindNav();
        this.bindReaderControls();
        this.bindMobileAISubtitles();
        this.buildPanels();
        this.syncRightPanelAccessibility();
        this.syncLeftSidebarAccessibility();
        this.syncTabsAccessibility('chat');
        this.updateMobileToolbarState();
        Selection.init();
        Voice.init();
        Chat.bindInputControls();
        Magnifier.init();
        document.addEventListener('tts-state-change', () => this.updateTTSControls());
        document.addEventListener('reader-page-change', () => this.handleReaderPageChange());
        window.addEventListener('resize', () => {
            this.syncMobileReaderChrome();
            this.syncReaderLayout();
        });
        // 浏览器返回键支持
        window.addEventListener('popstate', (e) => {
            if (!e.state || e.state.view === 'bookshelf') {
                this.returnToBookshelf();
            }
        });
        // 初始化 history state
        history.replaceState({ view: 'bookshelf' }, '');
    },

    returnToBookshelf() {
        Magnifier.disable();
        this.closeMobileMore();
        this.setMobileReaderChromeVisible(false);
        this.showView('bookshelf');
        Reader.saveProgress();
        Bookshelf.render();
        this.clearAITTSPreview();
        document.getElementById('ai-tts-bar')?.classList.add('hidden');
        TTS.stop();
    },

    bindNav() {
        document.getElementById('btn-back').addEventListener('click', () => {
            if (history.state && history.state.view === 'reader') {
                history.back();
            } else {
                this.returnToBookshelf();
            }
        });
    },

    showView(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(name + '-view').classList.add('active');
        if (name !== 'reader') {
            this.setMobileReaderChromeVisible(false);
            this.closeMobileMore();
        }
    },

    async openBook(bookId) {
        if (!Bookshelf.user) {
            Bookshelf.requireSmartReadSignedIn?.('请先登录 SmartRead，再阅读。');
            return;
        }
        this.aiReadRequestId++;
        TTS.stop();
        Magnifier.disable();
        history.pushState({ view: 'reader', bookId }, '');
        this.showView('reader');
        AIReader.reset();
        Chat.reset();
        this.clearAITTSPreview();
        document.getElementById('ai-tts-bar')?.classList.add('hidden');
        this.syncDefaultReaderPanels();
        await Reader.open(bookId);
        this.syncMobileReaderChrome();
        this.updateMobileReaderMeta();
        this.syncReaderLayout();
    },

    bindReaderControls() {
        document.getElementById('btn-prev').addEventListener('click', () => Reader.prevPage());
        document.getElementById('btn-next').addEventListener('click', () => Reader.nextPage());
        document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
        document.addEventListener('keydown', (e) => {
            if (!document.getElementById('reader-view').classList.contains('active')) return;
            if (this.isTypingTarget(e.target)) return;
            if (e.key === 'ArrowLeft') Reader.prevPage();
            if (e.key === 'ArrowRight') Reader.nextPage();
        });
        // 弹出面板
        document.getElementById('btn-theme').addEventListener('click', () => this.togglePanel('theme'));
        document.getElementById('btn-font-size').addEventListener('click', () => this.togglePanel('font'));
        document.getElementById('btn-settings').addEventListener('click', () => this.togglePanel('settings'));
        document.getElementById('btn-notes').addEventListener('click', () => this.showNotes());
        document.getElementById('btn-map').addEventListener('click', () => this.showKnowledgeMap());
        document.getElementById('btn-toc').addEventListener('click', () => this.showTOC());
        document.getElementById('overlay').addEventListener('click', () => this.closeAllPanels());
        document.getElementById('btn-toggle-chat').addEventListener('click', () => this.toggleRightPanel());
        document.addEventListener('pointerdown', (e) => this.handleLeftSidebarOutsidePointer(e));
        this.bindMobileDrawerHandle();
        document.querySelector('.sidebar')?.addEventListener('click', (e) => {
            if (this.isSmallScreen() && e.target.closest('.sb-btn')) {
                setTimeout(() => this.closeMobileMenu(), 0);
            }
        });
    },

    bindMobileDrawerHandle() {
        const handle = document.getElementById('mobile-drawer-handle');
        if (!handle) return;
        let startY = null;
        let dragging = false;
        handle.addEventListener('pointerdown', (event) => {
            if (!this.isSmallScreen()) return;
            startY = event.clientY;
            dragging = true;
            handle.setPointerCapture?.(event.pointerId);
        });
        handle.addEventListener('pointerup', (event) => {
            if (!dragging || startY == null) return;
            const deltaY = event.clientY - startY;
            dragging = false;
            startY = null;
            if (Math.abs(deltaY) < 16) {
                this.toggleMobileDrawerExpanded();
                return;
            }
            this.setMobileDrawerExpanded(deltaY < 0);
        });
        handle.addEventListener('pointercancel', () => {
            dragging = false;
            startY = null;
        });
    },

    buildPanels() {
        // 主题面板
        document.getElementById('theme-panel').innerHTML = `
            <div class="panel-header"><h3>🎨 阅读主题</h3>
                <button class="btn btn-icon" type="button" aria-label="关闭阅读主题" onclick="App.closeAllPanels()">✕</button></div>
            <div class="theme-options">
                <button class="theme-btn" type="button" onclick="App.setTheme('theme-dark')">🌙 深色</button>
                <button class="theme-btn" type="button" onclick="App.setTheme('')">☀️ 浅色</button>
                <button class="theme-btn" type="button" onclick="App.setTheme('theme-sepia')">📜 护眼</button></div>`;
        // 字体面板
        document.getElementById('font-panel').innerHTML = `
            <div class="panel-header"><h3>阅读显示</h3>
                <button class="btn btn-icon" type="button" aria-label="关闭阅读显示" onclick="App.closeAllPanels()">✕</button></div>
            <div class="control-group"><label>主题</label>
                <div class="theme-options">
                    <button class="theme-btn" type="button" onclick="App.setTheme('theme-dark')">深色</button>
                    <button class="theme-btn" type="button" onclick="App.setTheme('')">浅色</button>
                    <button class="theme-btn" type="button" onclick="App.setTheme('theme-sepia')">护眼</button>
                </div></div>
            <div class="control-group"><label>字号</label></div>
            <div class="font-size-controls">
                <button class="btn btn-icon" type="button" onclick="Reader.changeFontSize(-2)">A-</button>
                <span id="font-size-display">22px</span>
                <button class="btn btn-icon" type="button" onclick="Reader.changeFontSize(2)">A+</button></div>`;
        // 设置面板
        const cfg = AIConfig.load();
        document.getElementById('settings-panel').innerHTML = `
            <div class="panel-header"><h3>AI API 设置</h3>
                <button class="btn btn-icon" type="button" aria-label="关闭 AI API 设置" onclick="App.closeAllPanels()">✕</button></div>
            <div class="settings-group"><label for="cfg-url">API Base URL</label>
                <input id="cfg-url" type="url" inputmode="url" autocomplete="off" value="${escapeAttr(cfg.baseURL)}" placeholder="https://api.openai.com/v1/chat/completions"></div>
            <div class="settings-group"><label for="cfg-key">API Key${cfg.keyPreview ? `（当前 ${escapeHTML(cfg.keyPreview)}）` : ''}</label>
                <input id="cfg-key" type="password" autocomplete="new-password" value="" placeholder="${cfg.configured ? '留空则保持原 Key' : 'sk-...'}"></div>
            <div class="settings-group"><label for="cfg-model">模型名称</label>
                <input id="cfg-model" autocomplete="off" value="${escapeAttr(cfg.model)}" placeholder="gpt-5.5"></div>
            <button class="btn btn-primary" type="button" style="width:100%;margin-top:12px" onclick="App.saveSettings()">保存设置</button>`;
        this.popupPanelNames.forEach(name => this.preparePopupPanel(name));
        TTS.loadVoices();
    },

    togglePanel(name) {
        const panel = document.getElementById(name + '-panel');
        const overlay = document.getElementById('overlay');
        if (!panel) return;
        const isOpen = panel.classList.contains('open');
        this.lastPanelTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.closeAllPanels({ restoreFocus: false });
        if (!isOpen) {
            this.preparePopupPanel(name);
            this.setElementInert(panel, false);
            panel.setAttribute('aria-hidden', 'false');
            panel.classList.remove('hidden');
            this.activePopupPanel = panel;
            requestAnimationFrame(() => {
                panel.classList.add('open');
                this.focusPopupPanel(panel);
            });
            overlay.classList.remove('hidden');
        }
        this.updateMobileToolbarState();
    },

    closeAllPanels(options = {}) {
        const restoreFocus = options.restoreFocus !== false;
        this.popupPanelNames.forEach(n => {
            const p = document.getElementById(n + '-panel');
            if (!p) return;
            p.classList.remove('open');
            p.setAttribute('aria-hidden', 'true');
            this.setElementInert(p, true);
            setTimeout(() => { if (!p.classList.contains('open')) p.classList.add('hidden'); }, 200);
        });
        document.getElementById('overlay').classList.add('hidden');
        this.activePopupPanel = null;
        if (this.mobileActiveTool === 'display' || this.mobileActiveTool === 'toc') {
            this.mobileActiveTool = null;
        }
        if (restoreFocus && this.lastPanelTrigger?.isConnected) {
            this.lastPanelTrigger.focus({ preventScroll: true });
        }
        if (restoreFocus) this.lastPanelTrigger = null;
        this.updateMobileToolbarState();
    },

    preparePopupPanel(name) {
        const panel = document.getElementById(name + '-panel');
        if (!panel) return;
        const title = panel.querySelector('h1,h2,h3');
        if (title) {
            if (!title.id) title.id = `${name}-panel-title`;
            panel.setAttribute('aria-labelledby', title.id);
            panel.removeAttribute('aria-label');
        } else {
            panel.setAttribute('aria-label', panel.getAttribute('data-dialog-label') || '弹出面板');
            panel.removeAttribute('aria-labelledby');
        }
        panel.querySelectorAll('.panel-header .btn-icon').forEach(btn => {
            btn.setAttribute('type', 'button');
            if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', '关闭面板');
        });
    },

    setElementInert(el, inert) {
        if (!el) return;
        if ('inert' in el) el.inert = inert;
        if (inert) el.setAttribute('inert', '');
        else el.removeAttribute('inert');
    },

    getFocusableElements(root) {
        if (!root) return [];
        const selector = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');
        return Array.from(root.querySelectorAll(selector))
            .filter(el => {
                if (el.closest('[inert]')) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            });
    },

    focusPopupPanel(panel) {
        const focusable = this.getFocusableElements(panel);
        const preferred = focusable.find(el => el.matches('input,textarea,select,[data-autofocus]')) ||
            focusable.find(el => !el.closest('.panel-header')) ||
            focusable[0];
        (preferred || panel).focus({ preventScroll: true });
    },

    handleGlobalKeydown(event) {
        if (event.key === 'Escape') {
            if (this.activePopupPanel) {
                event.preventDefault();
                this.closeAllPanels();
                return;
            }
            if (this.mobileMoreOpen) {
                event.preventDefault();
                this.closeMobileMore();
                return;
            }
            const rightPanel = document.getElementById('right-panel');
            if (rightPanel && !rightPanel.classList.contains('collapsed')) {
                event.preventDefault();
                this.closeRightPanel();
                return;
            }
            const leftSidebar = document.getElementById('left-sidebar');
            if (leftSidebar && !leftSidebar.classList.contains('collapsed')) {
                event.preventDefault();
                this.closeLeftSidebar();
            }
        }

        if (event.key === 'Tab' && this.activePopupPanel) {
            this.trapFocusInPanel(event, this.activePopupPanel);
        }
    },

    trapFocusInPanel(event, panel) {
        const focusable = this.getFocusableElements(panel);
        if (!focusable.length) {
            event.preventDefault();
            panel.focus({ preventScroll: true });
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    },

    toggleRightPanel() {
        const panel = document.getElementById('right-panel');
        const btn = document.getElementById('btn-toggle-chat');
        const willOpen = panel.classList.contains('collapsed');
        const wasCollapsed = panel.classList.contains('collapsed');
        this.closeMobileMore();
        panel.classList.toggle('collapsed');
        btn.classList.toggle('active');
        this.syncRightPanelAccessibility();
        if (willOpen && this.isSmallScreen()) {
            this.switchTab('ai');
            this.closeMobileMenu();
        }
        this.updateMobileToolbarState();
        if (wasCollapsed !== panel.classList.contains('collapsed') && this.isRightPanelLayoutAffecting()) {
            this.syncReaderLayout();
        }
    },

    closeRightPanel() {
        const panel = document.getElementById('right-panel');
        const btn = document.getElementById('btn-toggle-chat');
        const hadFocus = panel?.contains(document.activeElement);
        const wasCollapsed = panel?.classList.contains('collapsed') ?? true;
        panel?.classList.add('collapsed');
        btn?.classList.remove('active');
        this.setMobileDrawerExpanded(false);
        this.syncRightPanelAccessibility();
        if (hadFocus) btn?.focus({ preventScroll: true });
        this.updateMobileToolbarState();
        if (!wasCollapsed && this.isRightPanelLayoutAffecting()) {
            this.syncReaderLayout();
        }
    },

    openRightPanel(tab = null) {
        const panel = document.getElementById('right-panel');
        const btn = document.getElementById('btn-toggle-chat');
        if (!panel) return;
        if (tab) this.switchTab(tab);
        const wasCollapsed = panel.classList.contains('collapsed');
        panel.classList.remove('collapsed');
        btn?.classList.add('active');
        this.syncRightPanelAccessibility();
        this.updateMobileToolbarState();
        if (wasCollapsed && this.isRightPanelLayoutAffecting()) {
            this.syncReaderLayout();
        }
    },

    isRightPanelLayoutAffecting() {
        return !this.isSmallScreen();
    },

    syncDefaultReaderPanels() {
        if (this.isSmallScreen()) {
            this.closeRightPanel();
            return;
        }
        this.openRightPanel('chat');
    },

    syncRightPanelAccessibility() {
        const panel = document.getElementById('right-panel');
        const btn = document.getElementById('btn-toggle-chat');
        if (!panel) return;
        const collapsed = panel.classList.contains('collapsed');
        panel.setAttribute('aria-hidden', String(collapsed));
        this.setElementInert(panel, collapsed);
        btn?.setAttribute('aria-expanded', String(!collapsed));
    },

    isSmallScreen() {
        return window.matchMedia?.('(max-width: 1024px)').matches || window.innerWidth <= 1024;
    },

    toggleMobileMenu() {
        if (!this.isSmallScreen()) return;
        const view = document.getElementById('reader-view');
        const willOpen = !view?.classList.contains('mobile-menu-open');
        if (willOpen) this.openMobileMenu();
        else this.closeMobileMenu();
    },

    openMobileMenu() {
        if (!this.isSmallScreen()) return;
        document.getElementById('reader-view')?.classList.add('mobile-menu-open');
        document.getElementById('mobile-menu-scrim')?.classList.remove('hidden');
    },

    closeMobileMenu() {
        document.getElementById('reader-view')?.classList.remove('mobile-menu-open');
        document.getElementById('mobile-menu-scrim')?.classList.add('hidden');
    },

    syncMobileReaderChrome() {
        if (!document.getElementById('reader-view')?.classList.contains('active')) return;
        if (this.isSmallScreen()) {
            this.setMobileReaderChromeVisible(true);
            this.closeRightPanel();
            this.switchTab('ai');
        } else {
            this.setMobileReaderChromeVisible(false);
            this.closeMobileMenu();
            this.closeMobileMore();
            this.setMobileDrawerExpanded(false);
        }
        this.updateMobileReaderMeta();
        this.updateAITTSControls();
        this.updateMobileToolbarState();
        this.syncReaderLayout();
    },

    setMobileReaderChromeVisible(visible) {
        ['mobile-reader-topbar', 'mobile-reader-toolbar'].forEach(id => {
            document.getElementById(id)?.classList.toggle('hidden', !visible);
        });
    },

    syncMobileReaderInsets() {
        const view = document.getElementById('reader-view');
        if (!view) return;

        let topInset = 0;
        let bottomInset = 0;
        if (view.classList.contains('active') && this.isSmallScreen()) {
            const imagePage = this.isMobileReaderImagePage();
            ['btn-mobile-ai-start', 'mobile-ai-player', 'mobile-tts-player', 'mobile-ai-subtitles', 'mobile-reader-toolbar'].forEach(id => {
                if (imagePage && id === 'btn-mobile-ai-start') return;
                const el = document.getElementById(id);
                if (!this.isVisibleBox(el)) return;
                if (id === 'mobile-ai-subtitles' && el.classList.contains('subtitle-large')) return;
                const rect = el.getBoundingClientRect();
                bottomInset = Math.max(bottomInset, Math.ceil(window.innerHeight - rect.top + 16));
            });
        }

        const nextTop = topInset + 'px';
        const nextBottom = bottomInset + 'px';
        view.style.setProperty('--reader-top-inset', nextTop);
        view.style.setProperty('--reader-bottom-inset', nextBottom);
        // 移动端工具层是悬浮层，不能反向驱动 EPUB/PDF 重新分页。
    },

    isMobileReaderImagePage() {
        const book = document.getElementById('book-content');
        if (!book?.classList.contains('book-epub')) return false;
        return Array.from(book.querySelectorAll('iframe')).some(frame => {
            try {
                return frame.contentDocument?.body?.classList.contains('smartread-epub-image-page');
            } catch {
                return false;
            }
        });
    },

    isVisibleBox(el) {
        if (!el || el.classList.contains('hidden')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    },

    syncAdaptiveRightPanel() {
        const view = document.getElementById('reader-view');
        const panel = document.getElementById('right-panel');
        if (!view || !panel) return;

        if (!view.classList.contains('active') || this.isSmallScreen() || panel.classList.contains('collapsed')) {
            panel.style.removeProperty('--right-panel-width');
            return;
        }

        const readerMain = document.querySelector('.reader-main');
        const readerRect = readerMain?.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const availableWidth = Math.floor((readerRect?.width || 0) + (panelRect?.width || 0));
        if (!availableWidth) return;

        const minReaderWidth = this.getMinimumReaderWidth(availableWidth);
        const maxPanelWidth = Math.max(0, availableWidth - minReaderWidth);
        if (!maxPanelWidth) {
            panel.style.removeProperty('--right-panel-width');
            return;
        }

        const minPanelWidth = Math.min(
            maxPanelWidth,
            Math.min(this.defaultRightPanelWidth, Math.max(280, Math.floor(availableWidth * 0.28)))
        );
        const defaultPanelWidth = this.clamp(this.defaultRightPanelWidth, minPanelWidth, maxPanelWidth);
        const contentWidth = this.measureShrinkableBookWidth();
        let nextPanelWidth = defaultPanelWidth;

        if (contentWidth > 0) {
            const readerBreathingRoom = Math.max(48, Math.min(96, Math.floor(availableWidth * 0.04)));
            const targetReaderWidth = this.clamp(
                Math.ceil(contentWidth + readerBreathingRoom),
                minReaderWidth,
                availableWidth - minPanelWidth
            );
            nextPanelWidth = this.clamp(availableWidth - targetReaderWidth, minPanelWidth, maxPanelWidth);
        }

        panel.style.setProperty('--right-panel-width', Math.round(nextPanelWidth) + 'px');
    },

    getMinimumReaderWidth(availableWidth) {
        return Math.min(760, Math.max(460, Math.floor(availableWidth * 0.42)));
    },

    measureShrinkableBookWidth() {
        const book = document.getElementById('book-content');
        if (!book) return 0;
        const bookRect = book.getBoundingClientRect();
        if (bookRect.width <= 0 || bookRect.height <= 0) return 0;

        if (book.classList.contains('book-pdf')) {
            return this.measurePdfContentWidth(book, bookRect);
        }

        if (book.classList.contains('book-epub')) {
            return this.measureEpubMediaPageWidth(book);
        }

        return 0;
    },

    measurePdfContentWidth(book, boundaryRect) {
        const canvas = book.querySelector('#pdf-page-canvas, .pdf-page-canvas, canvas');
        return this.measureElementWidthWithin(canvas, boundaryRect);
    },

    measureEpubMediaPageWidth(book) {
        const frames = Array.from(book.querySelectorAll('iframe'));
        let bestWidth = 0;

        frames.forEach(frame => {
            let doc = null;
            try {
                doc = frame.contentDocument;
            } catch {
                doc = null;
            }
            if (!doc?.body) return;

            const media = this.measureFrameMedia(doc, frame);
            const textLength = (doc.body.innerText || '').replace(/\s+/g, '').length;
            const imagePage = doc.body.classList.contains('smartread-epub-image-page');
            const mediaDominant = media.areaRatio > 0.28 && textLength < 800;
            if ((imagePage || mediaDominant) && media.width > bestWidth) {
                bestWidth = media.width;
            }
        });

        return Math.round(bestWidth);
    },

    measureFrameMedia(doc, frame) {
        const frameRect = frame.getBoundingClientRect();
        const viewportWidth = Math.max(1, doc.documentElement?.clientWidth || frameRect.width || 1);
        const viewportHeight = Math.max(1, doc.documentElement?.clientHeight || frameRect.height || 1);
        const scaleX = frameRect.width / viewportWidth;
        const scaleY = frameRect.height / viewportHeight;
        let bestWidth = 0;
        let bestArea = 0;

        doc.querySelectorAll('img, svg, canvas, video, object, embed').forEach(el => {
            const rect = el.getBoundingClientRect();
            const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
            const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
            if (visibleWidth < 24 || visibleHeight < 24) return;

            const width = visibleWidth * scaleX;
            const area = width * visibleHeight * scaleY;
            bestWidth = Math.max(bestWidth, width);
            bestArea = Math.max(bestArea, area);
        });

        return {
            width: Math.min(bestWidth, frameRect.width),
            areaRatio: bestArea / Math.max(1, frameRect.width * frameRect.height)
        };
    },

    measureElementWidthWithin(el, boundaryRect) {
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        const width = Math.min(rect.right, boundaryRect.right) - Math.max(rect.left, boundaryRect.left);
        const height = Math.min(rect.bottom, boundaryRect.bottom) - Math.max(rect.top, boundaryRect.top);
        if (width < 24 || height < 24) return 0;
        return Math.round(width);
    },

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    },

    ensureAIConfigured() {
        if (AIConfig.isConfigured()) return true;
        alert('请先在设置中配置 AI API Key');
        this.togglePanel('settings');
        return false;
    },

    syncReaderLayout() {
        this.syncAdaptiveRightPanel();
        if (typeof Reader?.scheduleLayoutSync !== 'function') return;
        Reader.scheduleLayoutSync(0);
        Reader.scheduleLayoutSync(300);
        Reader.scheduleLayoutSync(650);
    },

    openLeftSidebar(title, contentHTML) {
        const sb = document.getElementById('left-sidebar');
        document.getElementById('ls-title').textContent = title;
        document.getElementById('ls-content').innerHTML = contentHTML;
        sb.classList.remove('collapsed');
        this.syncLeftSidebarAccessibility();
        this.mobileActiveTool = 'toc';
        // 高亮对应的活动条按钮
        document.querySelectorAll('.sb-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-toc')?.classList.add('active');
        this.updateMobileToolbarState();
        if (!this.isSmallScreen()) this.syncReaderLayout();
    },

    closeLeftSidebar() {
        const sidebar = document.getElementById('left-sidebar');
        const btn = document.getElementById('btn-toc');
        const hadFocus = sidebar?.contains(document.activeElement);
        sidebar?.classList.add('collapsed');
        btn?.classList.remove('active');
        this.syncLeftSidebarAccessibility();
        if (this.mobileActiveTool === 'toc') this.mobileActiveTool = null;
        if (hadFocus) btn?.focus({ preventScroll: true });
        this.updateMobileToolbarState();
        if (!this.isSmallScreen()) this.syncReaderLayout();
    },

    handleLeftSidebarOutsidePointer(event) {
        if (!document.getElementById('reader-view')?.classList.contains('active')) return;
        const sidebar = document.getElementById('left-sidebar');
        if (!sidebar || sidebar.classList.contains('collapsed')) return;
        const target = event.target;
        if (sidebar.contains(target)) return;
        if (target.closest?.('#btn-toc, #btn-mobile-toc')) return;
        this.closeLeftSidebar();
    },

    switchTab(tab) {
        this.syncTabsAccessibility(tab);
        this.updateMobileToolbarState();
    },

    syncLeftSidebarAccessibility() {
        const sidebar = document.getElementById('left-sidebar');
        const btn = document.getElementById('btn-toc');
        if (!sidebar) return;
        const collapsed = sidebar.classList.contains('collapsed');
        sidebar.setAttribute('aria-hidden', String(collapsed));
        this.setElementInert(sidebar, collapsed);
        btn?.setAttribute('aria-controls', 'left-sidebar');
        btn?.setAttribute('aria-expanded', String(!collapsed));
    },

    syncTabsAccessibility(activeTab = document.querySelector('.rp-tab.active')?.dataset.tab || 'chat') {
        document.querySelectorAll('.rp-tab').forEach(tabButton => {
            const selected = tabButton.dataset.tab === activeTab;
            tabButton.classList.toggle('active', selected);
            tabButton.setAttribute('aria-selected', String(selected));
            tabButton.setAttribute('tabindex', selected ? '0' : '-1');
        });
        document.querySelectorAll('.rp-content').forEach(content => {
            const selected = content.id === 'rp-' + activeTab;
            content.classList.toggle('active', selected);
            content.setAttribute('aria-hidden', String(!selected));
        });
    },

    openMobileDrawer(tab = 'ai') {
        if (!this.isSmallScreen()) {
            if (document.getElementById('right-panel')?.classList.contains('collapsed')) this.toggleRightPanel();
            this.switchTab(tab);
            return;
        }
        const panel = document.getElementById('right-panel');
        const btn = document.getElementById('btn-toggle-chat');
        this.closeMobileMore();
        this.switchTab(tab);
        panel?.classList.remove('collapsed');
        btn?.classList.add('active');
        this.syncRightPanelAccessibility();
        this.updateMobileToolbarState();
    },

    setMobileDrawerExpanded(expanded) {
        const next = !!expanded && this.isSmallScreen();
        this.mobileDrawerExpanded = next;
        document.getElementById('reader-view')?.classList.toggle('mobile-drawer-expanded', next);
        const handle = document.getElementById('mobile-drawer-handle');
        handle?.setAttribute('aria-expanded', String(next));
        handle?.setAttribute('aria-label', next ? '收起 AI 抽屉' : '展开 AI 抽屉');
    },

    toggleMobileDrawerExpanded() {
        if (!this.isSmallScreen()) return;
        if (document.getElementById('right-panel')?.classList.contains('collapsed')) {
            this.openMobileDrawer('ai');
        }
        this.setMobileDrawerExpanded(!this.mobileDrawerExpanded);
    },

    openMobileAI() {
        if (!this.isSmallScreen()) {
            this.openMobileDrawer('ai');
            return;
        }
        this.closeMobileMore();
        this.closeMobileMenu();
        if (TTS.source === 'book') TTS.stop();
        this.mobileActiveTool = 'ai';
        this.switchTab('ai');
        this.closeRightPanel();
        this.updateAITTSControls();
        this.updateMobileToolbarState();
    },

    async openMobileTTS() {
        this.closeMobileMore();
        this.closeMobileMenu();
        this.closeRightPanel();
        if (this.mobileActiveTool === 'ai') this.mobileActiveTool = null;
        await this.toggleMobileBookTTS('toggle');
    },

    openMobileDisplay() {
        this.closeMobileMore();
        this.mobileActiveTool = 'display';
        this.togglePanel('font');
        this.updateMobileToolbarState();
    },

    toggleMobileMore() {
        if (!this.isSmallScreen()) return;
        const next = !this.mobileMoreOpen;
        this.mobileMoreOpen = next;
        this.mobileActiveTool = next ? 'more' : null;
        document.getElementById('mobile-more-menu')?.classList.toggle('hidden', !next);
        document.getElementById('mobile-more-scrim')?.classList.toggle('hidden', !next);
        this.updateMobileToolbarState();
    },

    closeMobileMore() {
        this.mobileMoreOpen = false;
        if (this.mobileActiveTool === 'more') this.mobileActiveTool = null;
        document.getElementById('mobile-more-menu')?.classList.add('hidden');
        document.getElementById('mobile-more-scrim')?.classList.add('hidden');
        this.updateMobileToolbarState();
    },

    toggleMagnifierFromMobile() {
        this.closeMobileMore();
        this.closeAllPanels({ restoreFocus: false });
        Magnifier.toggle();
        this.updateMobileToolbarState();
    },

    updateMobileToolbarState() {
        const panel = document.getElementById('right-panel');
        const activeTab = document.querySelector('.rp-tab.active')?.dataset.tab || '';
        const panelOpen = !!panel && !panel.classList.contains('collapsed');
        const activePopupId = this.activePopupPanel?.id || '';
        const leftSidebar = document.getElementById('left-sidebar');
        const leftSidebarOpen = !!leftSidebar && !leftSidebar.classList.contains('collapsed');
        const tocBtn = document.getElementById('btn-mobile-toc');
        const displayBtn = document.getElementById('btn-mobile-display');
        const aiBtn = document.getElementById('btn-mobile-ai');
        const ttsBtn = document.getElementById('btn-mobile-tts');
        const moreBtn = document.getElementById('btn-mobile-more');
        const bookTTSActive = TTS.source === 'book' && (TTS.speaking || TTS.paused || TTS.completed);
        const aiActive = !bookTTSActive && (this.mobileActiveTool === 'ai' || (panelOpen && activeTab === 'ai'));
        const displayActive = this.mobileActiveTool === 'display' || activePopupId === 'font-panel';
        const tocActive = this.mobileActiveTool === 'toc' || leftSidebarOpen;
        tocBtn?.classList.toggle('is-active', tocActive);
        displayBtn?.classList.toggle('is-active', displayActive);
        aiBtn?.classList.toggle('is-active', aiActive);
        ttsBtn?.classList.toggle('is-active', bookTTSActive);
        const magnifierActive = typeof Magnifier !== 'undefined' && Magnifier.enabled;
        moreBtn?.classList.toggle('is-active', this.mobileMoreOpen || magnifierActive);
        tocBtn?.setAttribute('aria-pressed', String(tocActive));
        displayBtn?.setAttribute('aria-pressed', String(displayActive));
        aiBtn?.setAttribute('aria-pressed', String(aiActive));
        ttsBtn?.setAttribute('aria-pressed', String(bookTTSActive));
        moreBtn?.setAttribute('aria-pressed', String(this.mobileMoreOpen || magnifierActive));
    },

    updateMobileReaderMeta() {
        const title = document.getElementById('reader-book-title');
        const progressText = document.getElementById('progress-text');
        const progressBar = document.getElementById('progress-bar');
        if (!title && !progressText && !progressBar) return;
        const book = Reader.book;
        const pct = Math.max(0, Math.min(100, Math.round(book?.progress || 0)));
        if (title) title.textContent = book?.title || '';
        if (progressText) progressText.textContent = pct + '%';
        if (progressBar) progressBar.style.width = pct + '%';
    },

    isTypingTarget(target) {
        const tag = target?.tagName?.toLowerCase();
        return tag === 'input' ||
            tag === 'textarea' ||
            tag === 'select' ||
            target?.isContentEditable;
    },

    setTheme(cls) {
        document.body.classList.remove('theme-dark', 'theme-sepia');
        if (cls) document.body.classList.add(cls);
        Reader.applyThemeToEmbeddedContent?.();
    },

    startTTS() {
        if (!TTS.isSupported()) {
            alert('当前浏览器不支持朗读功能');
            return;
        }
        const isBookTTS = TTS.source === 'book' || !TTS.source;
        if (isBookTTS && TTS.paused) { TTS.resume(); return; }
        if (isBookTTS && TTS.speaking) { TTS.stop(); return; }

        const text = Reader.getCurrentText();
        if (!text || !text.trim()) {
            alert('当前页面没有可朗读的文字内容');
            return;
        }
        this.closeAllPanels();
        if (TTS.speaking || TTS.paused) TTS.stop();
        TTS.speak(text, { source: 'book' });
    },

    // AI 讲书
    async triggerAIRead() {
        if (!this.ensureAIConfigured()) return;
        // 桌面端打开右侧面板；手机端直接在后台解读，不挡书。
        const rp = document.getElementById('right-panel');
        this.switchTab('ai');
        if (this.isSmallScreen()) {
            this.closeRightPanel();
            this.closeMobileMenu();
        } else if (rp.classList.contains('collapsed')) {
            this.toggleRightPanel();
        }

        const contentEl = document.getElementById('ai-content');
        const ttsBar = document.getElementById('ai-tts-bar');
        const startBtn = document.getElementById('btn-ai-start');
        const lang = document.getElementById('ai-lang')?.value || 'zh-CN';
        const requestId = ++this.aiReadRequestId;
        let startVersion = Reader.readingVersion;
        const startBookId = Reader.book?.id;
        const isCurrentAIRead = () =>
            requestId === this.aiReadRequestId &&
            startVersion === Reader.readingVersion &&
            startBookId === Reader.book?.id;
        let renderTimer = null;
        let pendingRender = '';
        const renderAI = (full, force = false) => {
            pendingRender = String(full || '');
            if (!isCurrentAIRead()) return;
            const commit = () => {
                renderTimer = null;
                if (!isCurrentAIRead()) return;
                contentEl.innerHTML = '<div class="ai-explain-box">' +
                    Chat.formatMarkdown(pendingRender) + '</div>';
            };
            if (force) {
                if (renderTimer) {
                    clearTimeout(renderTimer);
                    renderTimer = null;
                }
                commit();
                return;
            }
            if (!renderTimer) renderTimer = setTimeout(commit, 90);
        };

        // 禁用按钮防重复
        this.setAIStartLoading(true);
        contentEl.innerHTML = this.getAILoadingHTML('正在解读当前页', '正在读取文字和画面内容');
        ttsBar?.classList.add('hidden');
        this.clearAITTSPreview();
        TTS.stop(); // 停止之前的朗读
        this.updateAITTSControls();

        try {
            await Reader.waitForCurrentPageReady?.();
            if (requestId !== this.aiReadRequestId || startBookId !== Reader.book?.id) return;
            startVersion = Reader.readingVersion;
            const text = Reader.getCurrentText();
            contentEl.innerHTML = '';
            let aiResult = '';
            // 按所选语言调用讲解
            await AIReader.explainPage(text, (chunk, full) => {
                if (!isCurrentAIRead()) return;
                aiResult = full;
                renderAI(full);
            }, lang);

            // AI 讲完 → 显示 TTS 控制条（用户可手动点击朗读）
            if (aiResult && isCurrentAIRead()) {
                renderAI(aiResult, true);
                this.syncAITTSPreviewFromContent();
                if (this.isSmallScreen()) {
                    this.mobileSubtitleMode = 'large';
                    this.saveMobileSubtitlesSetting();
                }
                ttsBar?.classList.remove('hidden');
                this.updateAITTSControls();
                if (this.isSmallScreen()) this.closeRightPanel();
            }
        } catch (err) {
            if (isCurrentAIRead()) {
                contentEl.innerHTML = `<p style="color:#ff6b6b">错误: ${escapeHTML(err.message)}</p>`;
            }
        } finally {
            if (renderTimer) clearTimeout(renderTimer);
            if (startBtn && requestId === this.aiReadRequestId) {
                this.setAIStartLoading(false);
            }
        }
    },

    setAIStartLoading(isLoading) {
        document.querySelectorAll('#btn-ai-start, #btn-mobile-ai-start').forEach(startBtn => {
            const label = startBtn.querySelector('.ai-start-label');
            startBtn.disabled = isLoading;
            startBtn.classList.toggle('is-loading', isLoading);
            if (label) label.textContent = isLoading ? '解读中' : '开始解读';
        });
    },

    getAILoadingHTML(title, sub) {
        return `<div class="ai-loading-state" role="status" aria-live="polite">
            <div class="ai-loading-orbit" aria-hidden="true"></div>
            <div>
                <div class="ai-loading-text">${escapeHTML(title)}</div>
                <div class="ai-loading-sub">${escapeHTML(sub)}</div>
            </div>
        </div>`;
    },

    handleReaderPageChange() {
        this.aiReadRequestId++;
        if (TTS.source === 'ai' && (TTS.speaking || TTS.paused)) {
            TTS.stop();
        }
        this.clearAITTSPreview();
        const startBtn = document.getElementById('btn-ai-start');
        const contentEl = document.getElementById('ai-content');
        const ttsBar = document.getElementById('ai-tts-bar');
        if (startBtn) this.setAIStartLoading(false);
        ttsBar?.classList.add('hidden');
        if (contentEl && document.getElementById('rp-ai')?.classList.contains('active')) {
            contentEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0">已翻到新页面，点击「开始解读」讲解当前页</p>';
        }
        this.updateMobileReaderMeta();
        this.updateAITTSControls();
    },

    getAITTSText() {
        const raw = document.getElementById('ai-content')?.innerText || '';
        return raw;
    },

    getAITTSSentences(text = this.getAITTSText()) {
        if (typeof TTS === 'undefined' || typeof TTS.splitSentences !== 'function') return [];
        return TTS.splitSentences(text)
            .map(sentence => String(sentence || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    },

    syncAITTSPreviewFromContent() {
        const text = this.getAITTSText();
        this.aiTTSPreviewText = text;
        this.aiTTSPreviewSentences = this.getAITTSSentences(text);
        if (this.aiTTSPreviewSentences.length === 0) {
            this.aiTTSSelectedIndex = 0;
        } else {
            this.aiTTSSelectedIndex = Math.max(
                0,
                Math.min(this.aiTTSSelectedIndex, this.aiTTSPreviewSentences.length - 1)
            );
        }
        return this.aiTTSPreviewSentences;
    },

    clearAITTSPreview() {
        this.aiTTSPreviewText = '';
        this.aiTTSPreviewSentences = [];
        this.aiTTSSelectedIndex = 0;
    },

    startAITTSAt(index = 0) {
        const text = this.aiTTSPreviewText || this.getAITTSText();
        const root = document.getElementById('ai-content');
        const sentences = this.aiTTSPreviewSentences.length
            ? this.aiTTSPreviewSentences
            : this.getAITTSSentences(text);
        if (!text.trim() || !root || !sentences.length) return;

        const startIndex = Math.max(0, Math.min(Math.floor(Number(index) || 0), sentences.length - 1));
        this.aiTTSPreviewText = text;
        this.aiTTSPreviewSentences = sentences;
        this.aiTTSSelectedIndex = startIndex;
        if (TTS.speaking || TTS.paused) TTS.stop();
        TTS.speak(text, { source: 'ai', root, startIndex });
    },

    jumpToAISentence(index) {
        if (!TTS.isSupported()) {
            alert('当前浏览器不支持朗读功能');
            return;
        }
        const sentences = TTS.source === 'ai' && TTS.sentences.length
            ? TTS.sentences
            : (this.aiTTSPreviewSentences.length ? this.aiTTSPreviewSentences : this.syncAITTSPreviewFromContent());
        if (!sentences.length) return;

        const targetIndex = Math.max(0, Math.min(Math.floor(Number(index) || 0), sentences.length - 1));
        this.aiTTSSelectedIndex = targetIndex;
        if (TTS.source === 'ai' && TTS.sentences.length && (TTS.speaking || TTS.paused || TTS.completed)) {
            TTS.jumpToSentence(targetIndex);
        } else {
            this.startAITTSAt(targetIndex);
        }
        this.updateAITTSControls();
    },

    loadMobileSubtitlesSetting() {
        try {
            const v = localStorage.getItem('smartread.mobileSubtitleMode');
            if (v === 'small' || v === 'off') return v;
            // migrate old boolean setting
            const legacy = localStorage.getItem('smartread.mobileSubtitles');
            if (legacy === 'off') return 'off';
            return 'large';
        } catch {
            return 'large';
        }
    },

    saveMobileSubtitlesSetting() {
        try {
            localStorage.setItem('smartread.mobileSubtitleMode', this.mobileSubtitleMode);
        } catch { }
    },

    cycleMobileSubtitles() {
        const order = ['large', 'small', 'off'];
        const idx = order.indexOf(this.mobileSubtitleMode);
        this.mobileSubtitleMode = order[(idx + 1) % order.length];
        this.saveMobileSubtitlesSetting();
        this.updateAITTSControls();
    },

    getCurrentAISubtitleText() {
        if (TTS.source !== 'ai' || !TTS.sentences.length) return '';
        const index = Math.min(TTS.currentSentence, TTS.sentences.length - 1);
        return String(TTS.sentences[index] || '').replace(/\s+/g, ' ').trim();
    },

    getMobileAISentences() {
        if (TTS.source === 'ai' && TTS.sentences.length) return TTS.sentences;
        if (this.aiTTSPreviewSentences.length) return this.aiTTSPreviewSentences;
        return this.syncAITTSPreviewFromContent();
    },

    renderMobileAISubtitleText(el, { showSubtitles, mode, currentSubtitle, sentences = [], currentIndex = -1 }) {
        if (!el) return;
        const useSentenceList = showSubtitles &&
            mode === 'large' &&
            sentences.length > 0;

        el.classList.toggle('has-sentence-highlight', useSentenceList);
        if (!showSubtitles) {
            el.textContent = '';
            return;
        }
        if (!useSentenceList) {
            el.textContent = currentSubtitle;
            return;
        }

        const activeIndex = Number.isFinite(currentIndex)
            ? Math.max(-1, Math.min(currentIndex, sentences.length - 1))
            : -1;
        const fragment = document.createDocumentFragment();
        sentences.forEach((sentence, index) => {
            const text = String(sentence || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-ai-subtitle-sentence';
            button.dataset.aiSentenceIndex = String(index);
            button.classList.toggle('is-past', activeIndex >= 0 && index < activeIndex);
            button.classList.toggle('is-current', index === activeIndex);
            button.classList.toggle('is-future', activeIndex >= 0 && index > activeIndex);
            button.title = `从第 ${index + 1} 句开始朗读`;
            button.setAttribute('aria-label', `从第 ${index + 1} 句开始朗读`);
            if (index === activeIndex) button.setAttribute('aria-current', 'true');
            button.textContent = text;
            fragment.appendChild(button);
        });
        el.replaceChildren(fragment);
        if (activeIndex >= 0) {
            requestAnimationFrame(() => {
                el.querySelector('.mobile-ai-subtitle-sentence.is-current')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            });
        }
    },

    updateTTSControls() {
        this.updateAITTSControls();
        this.updateMobileBookTTSControls();
    },

    getBookTTSText() {
        return Reader.getCurrentText() || '';
    },

    async startMobileBookTTS() {
        await Reader.waitForCurrentPageReady?.(1200);
        const text = this.getBookTTSText();
        if (!text || !text.trim()) {
            alert('当前页面没有可朗读的文字内容');
            return;
        }
        if (TTS.speaking || TTS.paused) TTS.stop();
        TTS.speak(text, { source: 'book' });
    },

    getMobileBookTTSNavIndex(direction) {
        if (TTS.source !== 'book' || !TTS.sentences.length) return -1;
        const step = direction < 0 ? -1 : 1;
        const startIndex = TTS.currentSentence + step;
        if (typeof TTS.findNavigableSentenceIndex === 'function') {
            return TTS.findNavigableSentenceIndex(startIndex, step);
        }
        return startIndex >= 0 && startIndex < TTS.sentences.length ? startIndex : -1;
    },

    updateMobileBookTTSControls() {
        const player = document.getElementById('mobile-tts-player');
        const toggle = document.getElementById('btn-mobile-book-tts-toggle');
        const prev = document.getElementById('btn-mobile-book-tts-prev');
        const next = document.getElementById('btn-mobile-book-tts-next');
        const ttsSupported = TTS.isSupported();
        const isBookTTS = TTS.source === 'book';
        const isActive = isBookTTS && (TTS.speaking || TTS.paused);
        const isVisible = this.isSmallScreen() && isBookTTS && (TTS.speaking || TTS.paused || TTS.completed);
        const prevIndex = this.getMobileBookTTSNavIndex(-1);
        const nextIndex = this.getMobileBookTTSNavIndex(1);

        if (player) {
            player.classList.toggle('hidden', !isVisible);
            player.classList.toggle('is-playing', isActive && !TTS.paused);
        }
        if (prev) prev.disabled = !ttsSupported || !isVisible || prevIndex < 0;
        if (next) next.disabled = !ttsSupported || !isVisible || nextIndex < 0;
        if (toggle) {
            const label = !ttsSupported
                ? '朗读不可用'
                : isActive
                    ? (TTS.paused ? '继续' : '暂停')
                    : (isBookTTS && TTS.completed ? '重播' : '播放');
            toggle.disabled = !ttsSupported;
            toggle.title = label;
            toggle.setAttribute('aria-label', label);
        }
        this.updateMobileToolbarState();
        this.syncMobileReaderInsets();
        requestAnimationFrame(() => this.syncMobileReaderInsets());
    },

    async toggleMobileBookTTS(action) {
        if (!TTS.isSupported()) {
            alert('当前浏览器不支持朗读功能');
            return;
        }
        if (action === 'prev') {
            if (TTS.source === 'book') TTS.previousSentence();
            this.updateTTSControls();
            return;
        }
        if (action === 'next') {
            if (TTS.source === 'book') TTS.nextSentence();
            this.updateTTSControls();
            return;
        }
        if (TTS.source === 'book' && (TTS.speaking || TTS.paused)) {
            if (TTS.paused) TTS.resume();
            else TTS.pause();
            this.updateTTSControls();
            return;
        }
        await this.startMobileBookTTS();
        this.updateTTSControls();
    },

    updateAITTSControls() {
        const toggleBtn = document.getElementById('btn-ai-tts-toggle');
        const prevBtn = document.getElementById('btn-ai-tts-prev');
        const nextBtn = document.getElementById('btn-ai-tts-next');
        const speedBtn = document.getElementById('btn-ai-tts-speed');
        const mobilePlayer = document.getElementById('mobile-ai-player');
        const mobileToggle = document.getElementById('btn-mobile-ai-tts-toggle');
        const mobilePrev = document.getElementById('btn-mobile-ai-tts-prev');
        const mobileNext = document.getElementById('btn-mobile-ai-tts-next');
        const mobileStart = document.getElementById('btn-mobile-ai-start');
        const mobileCaptionToggle = document.getElementById('btn-mobile-subtitles-toggle');
        const mobileSubtitles = document.getElementById('mobile-ai-subtitles');
        const mobileSubtitleText = document.getElementById('mobile-ai-subtitle-text');
        const ttsBar = document.getElementById('ai-tts-bar');

        const ttsSupported = TTS.isSupported();
        const isAITTS = TTS.source === 'ai';
        const isBookTTS = TTS.source === 'book';
        const isActive = isAITTS && (TTS.speaking || TTS.paused);
        const canNavigateAITTS = isAITTS && TTS.sentences.length > 0 && (isActive || TTS.completed);
        const hasAIResult = !!ttsBar && !ttsBar.classList.contains('hidden');
        const currentSubtitle = this.getCurrentAISubtitleText();
        const mode = this.mobileSubtitleMode;
        const aiSentences = hasAIResult ? this.getMobileAISentences() : [];
        const currentAIIndex = isAITTS && TTS.sentences.length
            ? Math.min(TTS.currentSentence, TTS.sentences.length - 1)
            : -1;

        if (toggleBtn) {
            toggleBtn.disabled = !ttsSupported || !hasAIResult;
            toggleBtn.textContent = !ttsSupported
                ? '朗读不可用'
                : isActive
                    ? (TTS.paused ? '▶ 继续' : '⏸ 暂停')
                    : (isAITTS && TTS.completed ? '↻ 重播' : '▶ 听解读');
        }

        if (prevBtn) prevBtn.disabled = !ttsSupported || !canNavigateAITTS || TTS.currentSentence <= 0;
        if (nextBtn) nextBtn.disabled = !ttsSupported || !canNavigateAITTS || TTS.currentSentence >= TTS.sentences.length - 1;
        if (speedBtn) {
            speedBtn.disabled = !ttsSupported;
            speedBtn.textContent = TTS.speed.toFixed(1) + 'x';
        }

        if (mobilePlayer) {
            const showMobilePlayer = this.isSmallScreen() && hasAIResult && !isBookTTS;
            mobilePlayer.classList.toggle('hidden', !showMobilePlayer);
            mobilePlayer.classList.toggle('is-playing', isActive && !TTS.paused);
        }
        if (mobileStart) {
            const showMobileStart = this.isSmallScreen() && !hasAIResult && !isBookTTS;
            mobileStart.classList.toggle('hidden', !showMobileStart);
        }
        if (mobilePrev) mobilePrev.disabled = !ttsSupported || !canNavigateAITTS || TTS.currentSentence <= 0;
        if (mobileNext) mobileNext.disabled = !ttsSupported || !canNavigateAITTS || TTS.currentSentence >= TTS.sentences.length - 1;
        if (mobileToggle) {
            mobileToggle.disabled = !ttsSupported || !hasAIResult;
            const label = !ttsSupported
                ? '朗读不可用'
                : isActive
                    ? (TTS.paused ? '继续' : '暂停')
                    : (isAITTS && TTS.completed ? '重播' : '播放');
            mobileToggle.title = label;
            mobileToggle.setAttribute('aria-label', label);
        }
        if (mobileCaptionToggle) {
            const modeLabels = { large: '字幕大', small: '字幕小', off: '字幕关' };
            mobileCaptionToggle.textContent = modeLabels[mode] || '字幕关';
            mobileCaptionToggle.title = '切换字幕模式';
            mobileCaptionToggle.setAttribute('aria-label', '切换字幕模式');
            mobileCaptionToggle.classList.toggle('is-on', mode !== 'off');
        }
        if (mobileSubtitles) {
            const showLargeText = this.isSmallScreen() &&
                hasAIResult &&
                !isBookTTS &&
                mode === 'large' &&
                aiSentences.length > 0;
            const showSmallSubtitle = this.isSmallScreen() &&
                hasAIResult &&
                isActive &&
                mode === 'small' &&
                !!currentSubtitle;
            const showSubtitles = (showLargeText || showSmallSubtitle) &&
                mode !== 'off' &&
                !isBookTTS;
            mobileSubtitles.classList.toggle('hidden', !showSubtitles);
            mobileSubtitles.classList.toggle('is-paused', TTS.paused);
            mobileSubtitles.classList.toggle('subtitle-large', mode === 'large');
            mobileSubtitles.classList.toggle('subtitle-small', mode === 'small');
            this.renderMobileAISubtitleText(mobileSubtitleText, {
                showSubtitles,
                mode,
                currentSubtitle,
                sentences: aiSentences,
                currentIndex: currentAIIndex
            });
        }
        this.updateMobileToolbarState();
        this.syncMobileReaderInsets();
        requestAnimationFrame(() => this.syncMobileReaderInsets());
    },

    cycleAITTSSpeed() {
        const speeds = [0.8, 1, 1.2, 1.5, 2];
        const currentIndex = speeds.findIndex(v => Math.abs(v - TTS.speed) < 0.01);
        const nextSpeed = speeds[(currentIndex + 1) % speeds.length] || 1;
        TTS.setSpeed(nextSpeed);
    },

    // AI 解读朗读控制：上一句 / 播放暂停 / 下一句
    toggleAITTS(action) {
        if (!TTS.isSupported()) {
            alert('当前浏览器不支持朗读功能');
            return;
        }
        if (action === 'toggle') {
            if (TTS.source === 'ai' && (TTS.speaking || TTS.paused)) {
                if (TTS.paused) TTS.resume();
                else TTS.pause();
                return;
            }

            this.jumpToAISentence(0);
        } else if (action === 'prev') {
            if (TTS.source !== 'ai') return;
            TTS.previousSentence();
        } else if (action === 'next') {
            if (TTS.source !== 'ai') return;
            TTS.nextSentence();
        }
        this.updateAITTSControls();
    },

    bindMobileAISubtitles() {
        const subtitles = document.getElementById('mobile-ai-subtitles');
        if (!subtitles) return;
        subtitles.addEventListener('click', (event) => {
            const target = event.target?.closest?.('.mobile-ai-subtitle-sentence[data-ai-sentence-index]');
            if (!target || !subtitles.contains(target)) return;
            const index = Number(target.dataset.aiSentenceIndex);
            if (!Number.isFinite(index)) return;
            event.preventDefault();
            event.stopPropagation();
            this.jumpToAISentence(index);
        });
    },

    sendChat() {
        if (!this.ensureAIConfigured()) return;
        const input = document.getElementById('chat-input');
        if (input && input.value.trim()) {
            return Chat.send(input.value.trim());
        }
    },

    sendChatText(text) {
        if (!this.ensureAIConfigured()) return;
        if (text && text.trim()) {
            return Chat.send(text.trim());
        }
    },

    async saveSettings() {
        if (!Bookshelf.user) {
            Bookshelf.requireSmartReadSignedIn?.('请先登录 SmartRead，再配置 AI API。');
            return;
        }
        try {
            await AIConfig.save({
                baseURL: normalizeUrlInput(document.getElementById('cfg-url').value),
                apiKey: document.getElementById('cfg-key').value.trim(),
                model: document.getElementById('cfg-model').value.trim()
            });
            Bookshelf.aiConfigured = AIConfig.isConfigured();
            Bookshelf.renderCloud?.();
            this.buildPanels();
            alert('设置已保存');
            this.closeAllPanels();
        } catch (err) {
            alert('保存失败：' + err.message);
        }
    },

    showNotes() {
        if (!Reader.book) return;
        const bookId = Reader.book.id;
        const notes = Notes.getAll(bookId);
        const panel = document.getElementById('notes-panel');
        panel.innerHTML = `
            <div class="panel-header"><h3>📝 读书笔记</h3>
                <button class="btn btn-icon" type="button" aria-label="关闭读书笔记" onclick="App.closeAllPanels()">✕</button></div>
            <button class="btn btn-primary" style="width:100%;margin-bottom:16px"
                onclick="App.aiGenerateNote()">🤖 AI 生成本页笔记</button>
            <div id="notes-list">${notes.length
                ? notes.map(n => `<div class="ai-explain-box" style="margin-bottom:8px">
                    <div style="font-size:0.75rem;color:var(--text-muted)">第${n.page + 1}页</div>
                    <div style="font-size:0.85rem;margin-top:4px">${escapeHTML(n.note)}</div>
                    <button class="btn btn-icon" style="margin-top:6px;font-size:0.75rem"
                        onclick="App.deleteNote('${n.id}')">🗑 删除</button></div>`).join('')
                : '<p style="color:var(--text-muted);text-align:center">暂无笔记</p>'
            }</div>`;
        this.togglePanel('notes');
    },

    async showTOC() {
        if (!Reader.book) return;
        const sb = document.getElementById('left-sidebar');
        // 如果已经打开了目录侧边栏，则关闭
        if (!sb.classList.contains('collapsed')) {
            this.closeLeftSidebar(); return;
        }
        const toc = await Reader.getTOC();
        const html = toc.length
            ? '<div class="toc-list">' + toc.map(item =>
                `<div class="toc-item toc-depth-${Math.min(item.depth, 3)}" onclick="App.goToChapter(decodeURIComponent('${encodeURIComponent(item.href)}'))">${escapeHTML(item.label)}</div>`
            ).join('') + '</div>'
            : '<p style="color:var(--text-muted);text-align:center;padding:40px 0">暂无目录</p>';
        this.openLeftSidebar('目录', html);
    },

    goToChapter(href) {
        Reader.display(href);
    },

    async aiGenerateNote() {
        const el = document.getElementById('notes-list');
        el.innerHTML = '<p style="animation:pulse 1.5s infinite">🤖 AI 正在生成笔记...</p>';
        try {
            const text = Reader.getCurrentText();
            let result = '';
            await Notes.generateNote(text, (chunk, full) => {
                result = full;
                el.innerHTML = '<div class="ai-explain-box">' + Chat.formatMarkdown(full) + '</div>';
            });
            Notes.add(Reader.book.id, Reader.currentPage, text.slice(0, 50), result);
        } catch (err) {
            el.innerHTML = `<p style="color:#ff6b6b">错误: ${escapeHTML(err.message)}</p>`;
        }
    },

    deleteNote(noteId) {
        if (!Reader.book) return;
        Notes.remove(Reader.book.id, noteId);
        this.showNotes();
    },

    async showKnowledgeMap() {
        if (!this.ensureAIConfigured()) return;
        const panel = document.getElementById('map-panel');
        panel.innerHTML = `<div class="panel-header"><h3>🗺️ 知识图谱</h3>
            <button class="btn btn-icon" type="button" aria-label="关闭知识图谱" onclick="App.closeAllPanels()">✕</button></div>
            <p style="animation:pulse 1.5s infinite">🤖 正在生成知识图谱...</p>`;
        this.togglePanel('map');
        try {
            const pages = AIReader.context.length > 0
                ? AIReader.context : [Reader.getCurrentText()];
            await KnowledgeMap.generate(Reader.book?.title || '未知', pages);
            panel.innerHTML = `<div class="panel-header"><h3>🗺️ 知识图谱</h3>
                <button class="btn btn-icon" type="button" aria-label="关闭知识图谱" onclick="App.closeAllPanels()">✕</button></div>
                <div id="map-container" style="overflow:auto;padding:16px"></div>`;
            this.preparePopupPanel('map');
            KnowledgeMap.render(document.getElementById('map-container'));
        } catch (err) {
            panel.innerHTML += `<p style="color:#ff6b6b">错误: ${escapeHTML(err.message)}</p>`;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
