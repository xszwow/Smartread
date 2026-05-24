/* ===== Bookshelf module ===== */
const Bookshelf = {
    books: [],
    user: null,
    aiConfigured: false,
    zlibBound: false,
    mobileDashboardView: 'home',
    cloud: {
        results: [],
        serverBooks: [],
        page: 1,
        totalPages: null,
        hasNext: false,
        format: '',
        lastQuery: '',
        rebinding: false,
        message: '',
        zlibRegisterUrl: '',
        authEmail: '',
        codeSent: false,
        busy: false,
        jobs: {}
    },

    async init() {
        this.ensureCloudUI();
        await this.loadAuthConfig();
        await this.refreshCloud();
        this.bindEvents();
    },

    isNativeStandalone() {
        return !!window.SmartReadNativeStandalone?.enabled;
    },

    isNativeBackend() {
        return !!window.SmartReadNativeBackend?.enabled;
    },

    isDesktopRuntime() {
        return window.SmartReadDesktop?.appMode === 'desktop';
    },

    isLocalDesktopUser() {
        return this.isDesktopRuntime() && this.user?.email?.toLowerCase() === 'local-desktop@smartread.local';
    },

    authRequiredMessage(message) {
        if (this.isDesktopRuntime()) {
            return message && !/登录|SmartRead/.test(message)
                ? message
                : '本机书架正在启动，请稍后再试。';
        }
        if (this.isNativeStandalone() || this.isNativeBackend()) {
            return message && !/登录|SmartRead/.test(message)
                ? message
                : '请先进入本机书架。';
        }
        return message || '请先登录 SmartRead。';
    },

    hasNativeBackend() {
        return this.isNativeBackend() || !!window.SmartReadNativeStandalone?.hasNativeBackend?.();
    },

    bindEvents() {
        const localSearchInput = document.getElementById('search-input');
        const runLocalSearch = () => {
            this.search(localSearchInput?.value || '');
            localSearchInput?.blur();
            document.getElementById('shelf-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        document.getElementById('btn-local-search')?.addEventListener('click', runLocalSearch);
        localSearchInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') runLocalSearch();
        });
        document.getElementById('btn-import')?.addEventListener('click', () => {
            if (!this.requireSmartReadSignedIn('请先登录 SmartRead，再导入书籍。')) return;
            document.getElementById('file-input')?.click();
        });
        document.getElementById('file-input')?.addEventListener('change', (event) => {
            this.handleImport(event.target.files);
            event.target.value = '';
        });
    },

    async loadAuthConfig() {
        if (!window.SmartReadAPI?.config) return;
        try {
            const config = await SmartReadAPI.config();
            this.cloud.zlibRegisterUrl = config.zlibRegisterUrl || '';
            if (window.AIConfig?.setDefaults) AIConfig.setDefaults(config.aiDefaults || {});
        } catch {
            this.cloud.zlibRegisterUrl = '';
        }
    },

    ownerKey() {
        return this.user?.email ? this.user.email.toLowerCase() : '';
    },

    localServerBookId(serverBookId) {
        return 'server:' + serverBookId;
    },

    getRecentBook() {
        return this.books
            .filter(book => book.lastRead > 0)
            .sort((a, b) => b.lastRead - a.lastRead)[0] || null;
    },

    openRecentBook() {
        if (!this.requireSmartReadSignedIn(this.isNativeStandalone() ? '请先导入一本本地书。' : '请先登录 SmartRead，再继续阅读。')) return;
        const recent = this.getRecentBook();
        if (recent) {
            this.openBook(recent.id);
            return;
        }
        document.getElementById('shelf-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    focusOnlineSearch() {
        if (!this.requireSmartReadSignedIn('请先登录 SmartRead，再使用在线找书。')) return;
        if (this.isMobileDashboardActive()) {
            this.openMobileOnline();
            return;
        }
        this.renderCloud();
        document.getElementById('cloud-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
            const target = this.zlibBound
                ? document.getElementById('cloud-query')
                : document.getElementById('zlib-bind-email');
            target?.focus();
        }, 250);
    },

    isMobileDashboardActive() {
        const view = document.getElementById('bookshelf-view');
        const isMobile = window.matchMedia?.('(max-width: 640px)').matches || window.innerWidth <= 640;
        return !!this.user && !!view?.classList.contains('is-mobile-dashboard') && isMobile;
    },

    isMobileEmptyShelfActive() {
        return this.isMobileDashboardActive() && this.books.length === 0;
    },

    renderCloudSurface() {
        if (this.isMobileDashboardActive()) this.render();
        else this.renderCloud();
    },

    openMobileDashboardView(viewName, focusSelector = '') {
        if (!this.requireSmartReadSignedIn('请先登录 SmartRead。')) return;
        const allowed = new Set(['home', 'import', 'library', 'online', 'ai', 'account']);
        this.mobileDashboardView = allowed.has(viewName) ? viewName : 'home';
        this.render();
        setTimeout(() => {
            document.getElementById('mobile-dashboard-state')?.scrollIntoView({ block: 'start' });
            if (focusSelector) document.querySelector(focusSelector)?.focus();
        }, 0);
    },

    openMobileHome() {
        this.openMobileDashboardView('home');
    },

    openMobileImport() {
        this.openMobileDashboardView('import');
    },

    openMobileLibrary() {
        this.openMobileDashboardView('library');
    },

    openMobileOnline() {
        const target = this.zlibBound ? '#mobile-cloud-query' : '#mobile-zlib-bind-email';
        this.openMobileDashboardView('online', target);
    },

    openMobileAI() {
        this.openMobileDashboardView('ai');
    },

    openMobileAccount() {
        this.openMobileDashboardView('account');
    },

    triggerMobileImport() {
        if (!this.requireSmartReadSignedIn(this.isNativeStandalone() ? '请先进入本机书架。' : '请先登录 SmartRead，再导入书籍。')) return;
        document.getElementById('file-input')?.click();
    },

    openAISettings() {
        if (!this.requireSmartReadSignedIn(this.isNativeStandalone() ? '请先进入本机书架。' : '请先登录 SmartRead，再配置 AI。')) return;
        App.togglePanel('settings');
    },

    requireSignedIn(message) {
        return this.requireSmartReadSignedIn(message);
    },

    requireSmartReadSignedIn(message) {
        if (this.user) return true;
        this.cloud.message = this.authRequiredMessage(message);
        this.render();
        document.getElementById('cloud-section')?.scrollIntoView({ behavior: 'smooth' });
        return false;
    },

    requireZlibBound(message) {
        if (!this.requireSmartReadSignedIn(this.isNativeStandalone() ? '请先进入本机书架。' : '请先登录 SmartRead。')) return false;
        if (this.zlibBound) return true;
        this.cloud.message = message || '请先绑定 Z-Library 书源。';
        if (this.isMobileDashboardActive()) {
            this.openMobileOnline();
        } else {
            this.renderCloud();
            document.getElementById('cloud-section')?.scrollIntoView({ behavior: 'smooth' });
        }
        return false;
    },

    async loadOwnedBooks() {
        if (!this.user) {
            this.books = [];
            return;
        }
        const ownerKey = this.ownerKey();
        const localBooks = await dbGetAll('books');
        this.books = localBooks.filter(book => book.ownerKey === ownerKey);
    },

    mergeServerBooksIntoShelf(serverBooks) {
        const serverIds = new Set(serverBooks.map(book => book.id));
        const existingById = new Map(this.books.map(book => [book.id, book]));
        const merged = this.books.filter(book => book.source !== 'server' || serverIds.has(book.serverBookId));

        serverBooks.forEach(serverBook => {
            const localId = this.localServerBookId(serverBook.id);
            const existing = existingById.get(localId);
            const localBook = this.toLocalServerBook(serverBook, existing);
            const index = merged.findIndex(book => book.id === localId);
            if (index >= 0) merged[index] = localBook;
            else merged.push(localBook);
        });

        this.books = merged;
    },

    toLocalServerBook(serverBook, existing = null) {
        const localId = this.localServerBookId(serverBook.id);
        const progressSource = existing && (existing.lastRead || 0) > (serverBook.lastRead || 0)
            ? existing
            : serverBook;
        const ext = String(serverBook.extension || '').toLowerCase();
        return {
            id: localId,
            ownerKey: this.ownerKey(),
            serverBookId: serverBook.id,
            source: 'server',
            sourceId: serverBook.sourceId,
            title: serverBook.title,
            type: ext,
            content: existing?.content || null,
            currentPage: progressSource.currentPage || 0,
            currentCfi: progressSource.currentCfi || null,
            totalPages: progressSource.totalPages || 0,
            progress: progressSource.progress || 0,
            addedAt: existing?.addedAt || serverBook.addedAt || Date.now(),
            lastRead: progressSource.lastRead || 0,
            gradient: existing?.gradient || generateBookGradient(serverBook.title),
            coverImg: existing?.coverImg || serverBook.coverUrl || null
        };
    },

    async handleImport(files) {
        if (!files?.length) return;
        if (!this.requireSmartReadSignedIn('请先登录 SmartRead，再导入书籍。')) return;
        const ownerKey = this.ownerKey();
        this.showLoading('正在导入书籍...');
        for (const file of files) {
            try {
                const ext = file.name.split('.').pop().toLowerCase();
                const bookName = file.name.replace(/\.[^.]+$/, '');
                let content = null;
                const sizeMB = (file.size / 1024 / 1024).toFixed(1);
                this.showLoading(`正在导入《${bookName}》（${sizeMB}MB）...`);

                if (ext === 'txt') {
                    content = await readFileAsText(file);
                } else if (ext === 'epub' || ext === 'pdf') {
                    content = new Blob([await readFileAsBuffer(file)],
                        { type: ext === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
                } else {
                    alert('暂不支持这个格式：' + ext);
                    continue;
                }

                let coverImg = null;
                if (ext === 'epub') {
                    this.showLoading('正在提取封面...');
                    const buf = await readFileAsBuffer(file);
                    coverImg = await extractEpubCover(buf);
                }

                const book = {
                    id: genId(),
                    ownerKey,
                    source: 'local',
                    title: bookName,
                    type: ext,
                    content,
                    currentPage: 0,
                    totalPages: 0,
                    progress: 0,
                    addedAt: Date.now(),
                    lastRead: 0,
                    gradient: generateBookGradient(bookName),
                    coverImg
                };
                await dbPut('books', book);
                this.books.push(book);
            } catch (err) {
                alert('导入失败：' + err.message);
                console.error('Import error:', err);
            }
        }
        this.hideLoading();
        this.render();
        // 导入完成后导航到书架
        if (this.isMobileDashboardActive()) {
            this.openMobileLibrary();
        } else {
            document.getElementById('shelf-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    showLoading(msg) {
        let el = document.getElementById('loading-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'loading-overlay';
            el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);' +
                'display:flex;align-items:center;justify-content:center;z-index:9999;' +
                'flex-direction:column;gap:16px;backdrop-filter:blur(6px)';
            document.body.appendChild(el);
        }
        el.innerHTML = `<div style="font-size:2rem;animation:pulse 1.5s infinite">书</div>
            <div style="color:var(--text-primary);font-size:1rem">${escapeHTML(msg)}</div>`;
        el.style.display = 'flex';
    },

    hideLoading() {
        const el = document.getElementById('loading-overlay');
        if (el) el.style.display = 'none';
    },

    finishBoot() {
        document.getElementById('bookshelf-view')?.classList.remove('is-booting');
    },

    render() {
        const view = document.getElementById('bookshelf-view');
        const grid = document.getElementById('bookshelf-grid');
        const empty = document.getElementById('empty-state');
        const heroSection = document.getElementById('hero-section');
        const heroCard = document.getElementById('hero-card');
        const mobileDashboard = document.getElementById('mobile-dashboard-state');
        const shelfCount = document.getElementById('shelf-count');
        const importBtn = document.getElementById('btn-import');
        const searchInput = document.getElementById('search-input');

        if (!grid || !empty || !heroSection) return;
        view?.classList.toggle('is-logged-out', !this.user);
        view?.classList.toggle('is-authenticated', !!this.user);
        view?.classList.toggle('is-mobile-dashboard', !!this.user);
        view?.classList.toggle('is-mobile-empty-shelf', !!this.user && this.books.length === 0);
        this.positionCloudSection();
        if (importBtn) importBtn.disabled = !this.user;
        if (searchInput) searchInput.disabled = !this.user;
        grid.innerHTML = '';

        if (!this.user) {
            this.mobileDashboardView = 'home';
            view?.classList.remove('is-mobile-empty-shelf');
            view?.classList.remove('is-mobile-dashboard');
            if (mobileDashboard) {
                mobileDashboard.classList.add('hidden');
                mobileDashboard.innerHTML = '';
            }
            heroSection.classList.add('hidden');
            empty.style.display = 'block';
            empty.innerHTML = `<div class="empty-icon">书</div>
                <p class="empty-title">请先登录 SmartRead</p>
                <p class="empty-sub">登录后可以导入本地书、保存书架和阅读进度。</p>`;
            if (shelfCount) shelfCount.textContent = '';
            this.updateStats(0, 0, 0);
            this.refreshMobileActions();
            this.renderCloud();
            this.finishBoot();
            return;
        }

        if (!['home', 'import', 'library', 'online', 'ai', 'account'].includes(this.mobileDashboardView)) {
            this.mobileDashboardView = 'home';
        }
        if (mobileDashboard) {
            mobileDashboard.innerHTML = this.mobileDashboardHTML();
            mobileDashboard.classList.remove('hidden');
        }

        empty.style.display = this.books.length ? 'none' : 'block';
        if (!this.books.length) {
            empty.innerHTML = this.emptyShelfHTML();
        }
        if (shelfCount) shelfCount.textContent = this.books.length ? `${this.books.length} 本` : '';

        const recent = this.books.filter(book => book.lastRead > 0)
            .sort((a, b) => b.lastRead - a.lastRead);
        if (recent.length && heroCard) {
            heroSection.classList.remove('hidden');
            const book = recent[0];
            const pct = Math.round(book.progress || 0);
            heroCard.innerHTML = this.heroHTML(book, pct);
            heroCard.onclick = () => this.openBook(book.id);
            heroCard.style.setProperty('--hero-ambient', book.gradient || generateBookGradient(book.title));
        } else {
            heroSection.classList.add('hidden');
        }

        const bookCount = this.books.length;
        const reading = this.books.filter(book => book.progress > 0 && book.progress < 100).length;
        const done = this.books.filter(book => book.progress >= 100).length;
        this.updateStats(bookCount, reading, done);

        const sorted = [...this.books].sort((a, b) => b.addedAt - a.addedAt);
        let html = sorted.map(book => this.cardHTML(book)).join('');
        if (sorted.length > 0 && sorted.length < 4) {
            html += `<div class="book-card book-placeholder" onclick="Bookshelf.requireSmartReadSignedIn('请先登录 SmartRead，再导入书籍。') && document.getElementById('file-input').click()">
                <div class="book-cover"><div class="placeholder-add">+</div></div>
                <div class="book-info"><div class="book-title" style="color:var(--text-muted)">添加书籍</div></div>
            </div>`;
        }
        grid.innerHTML = html;
        this.refreshMobileActions();
        this.renderCloud();
        this.finishBoot();
    },

    refreshMobileActions() {
        const actions = document.getElementById('mobile-home-actions');
        if (!actions) return;
        actions.classList.toggle('hidden', !this.user || this.books.length === 0);
        if (!this.user) return;

        const recent = this.getRecentBook();
        const continueBtn = document.getElementById('mobile-action-continue');
        const continueSub = document.getElementById('mobile-action-continue-sub');
        if (continueBtn) continueBtn.disabled = !recent;
        if (continueBtn) {
            if (recent) continueBtn.title = recent.title;
            else continueBtn.removeAttribute('title');
        }
        if (continueSub) continueSub.textContent = recent ? '继续上次位置' : '先添加一本书';

        const aiAction = document.getElementById('mobile-action-ai');
        const aiSub = document.getElementById('mobile-action-ai-sub');
        if (aiAction) aiAction.classList.toggle('is-ready', this.aiConfigured);
        if (aiSub) aiSub.textContent = this.aiConfigured ? '已配置' : '待配置';
    },

    emptyShelfHTML() {
        return `<div class="desktop-empty-copy">
                <div class="empty-icon">书</div>
                <p class="empty-title">书架还是空的</p>
                <p class="empty-sub">先导入本地 EPUB、PDF、TXT；需要在线找书时再绑定 Z-Library。</p>
                <div class="empty-actions">
                    <button class="btn btn-primary" onclick="document.getElementById('file-input').click()">导入书籍</button>
                    <button class="btn btn-icon" onclick="Bookshelf.focusOnlineSearch()">在线找书</button>
                </div>
            </div>`;
    },

    mobileDashboardHTML() {
        const content = this.mobileDashboardView === 'home'
            ? this.mobileDashboardHomeHTML()
            : this.mobileDashboardPageHTML(this.mobileDashboardView);
        return `<div class="mobile-empty-conversion" data-mobile-dashboard-view="${escapeAttr(this.mobileDashboardView)}">${content}</div>`;
    },

    mobileDashboardHomeHTML() {
        const recent = this.getRecentBook();
        const bookCount = this.books.length;
        const standalone = this.isNativeStandalone();
        const status = recent
            ? `继续《${recent.title}》`
            : (bookCount ? `${bookCount} 本书 / 尚未开始阅读` : '0 本书 / 支持 EPUB · PDF · TXT');
        const tiles = [
            recent
                ? {
                    key: 'continue',
                    size: 'primary',
                    tone: 'continue',
                    kicker: 'CONTINUE',
                    title: '继续阅读',
                    detail: recent.title,
                    meta: `已读 ${Math.round(recent.progress || 0)}%`,
                    coverImg: recent.coverImg || null,
                    onclick: 'Bookshelf.openRecentBook()'
                }
                : {
                    key: 'continue',
                    size: 'primary',
                    tone: bookCount ? 'library' : 'continue',
                    kicker: bookCount ? 'LIBRARY' : 'CONTINUE',
                    title: bookCount ? '打开书架' : '开始阅读',
                    detail: bookCount ? `${bookCount} 本书` : '先导入一本书',
                    meta: bookCount ? '选择一本开始读' : '新建书架',
                    onclick: bookCount ? 'Bookshelf.openMobileLibrary()' : 'Bookshelf.openMobileImport()'
                },
            {
                key: 'library',
                size: 'wide',
                tone: 'library',
                kicker: 'LIBRARY',
                title: '我的书架',
                detail: `${bookCount} 本书`,
                meta: bookCount ? '书架列表' : '暂无书籍',
                onclick: 'Bookshelf.openMobileLibrary()'
            },
            {
                key: 'import',
                size: 'wide',
                tone: 'import',
                kicker: 'LOCAL',
                title: '导入',
                detail: '本地书',
                meta: '文件',
                onclick: 'Bookshelf.openMobileImport()'
            },
            {
            key: 'online',
            size: 'wide',
            tone: 'online',
            kicker: 'ONLINE',
            title: standalone ? '网页书源' : '在线找书',
            detail: standalone ? '不经服务器' : (this.zlibBound ? 'Z-Library 已绑定' : 'Z-Library 待绑定'),
            meta: standalone ? '下载后导入' : (this.zlibBound ? '搜索下载' : '先绑定'),
            onclick: 'Bookshelf.openMobileOnline()'
            },
            {
            key: 'account',
            size: 'small',
            tone: 'account',
            kicker: 'ACCOUNT',
            title: standalone ? '本机' : '账号',
            detail: standalone ? '单机模式' : (this.zlibBound ? '服务正常' : '服务待补齐'),
            meta: '状态',
            onclick: 'Bookshelf.openMobileAccount()'
            },
            {
            key: 'ai',
            size: 'small',
            tone: 'ai',
            kicker: 'AI',
            title: 'AI',
            detail: this.aiConfigured ? '已配置' : '待配置',
            meta: '设置',
            onclick: 'Bookshelf.openMobileAI()'
            }
        ];

        return `<section id="mobile-dashboard-home" class="mobile-dashboard-home" aria-label="智读功能主页">
                <div class="mobile-dashboard-head">
                    <img class="mobile-dashboard-logo" src="images/biaoge-logo.png" alt="表哥智读 logo" width="68" height="68">
                    <div class="mobile-dashboard-title">
                        <div class="mobile-empty-brand">表哥智读</div>
                        <h2>阅读主页</h2>
                        <p>${escapeHTML(status)}</p>
                    </div>
                </div>
                <div id="mobile-metro-grid" class="mobile-metro-grid">
                    ${tiles.map(tile => this.mobileTileHTML(tile)).join('')}
                </div>
            </section>`;
    },

    mobileTileHTML(tile) {
        const cover = tile.coverImg ? this.mobileCoverPreviewHTML(tile.coverImg, tile.title, 'mobile-tile-cover') : '';
        return `<button id="mobile-empty-tile-${escapeAttr(tile.key)}" class="mobile-metro-tile is-${escapeAttr(tile.size)} tile-${escapeAttr(tile.tone)}${cover ? ' has-cover' : ''}" type="button"
                data-mobile-tile="${escapeAttr(tile.key)}" onclick="${escapeAttr(tile.onclick)}">
                <span class="mobile-tile-kicker">${escapeHTML(tile.kicker)}</span>
                <strong>${escapeHTML(tile.title)}</strong>
                <small>${escapeHTML(tile.detail)}</small>
                ${cover}
                <em>${escapeHTML(tile.meta)}</em>
            </button>`;
    },

    mobileDashboardPageHTML(view) {
        const pages = {
            import: {
                kicker: 'LOCAL',
                title: '导入本地书',
                subtitle: 'EPUB / PDF / TXT',
                body: this.mobileImportPageHTML()
            },
            library: {
                kicker: 'LIBRARY',
                title: '我的书架',
                subtitle: this.books.length ? `${this.books.length} 本书` : '书架为空',
                body: this.mobileLibraryPageHTML()
            },
            online: {
                kicker: 'ONLINE',
                title: this.isNativeStandalone() ? '网页书源' : '在线找书',
                subtitle: this.isNativeStandalone() ? '不经过 SmartRead 服务器' : (this.zlibBound ? 'Z-Library 已绑定' : 'Z-Library 待绑定'),
                body: this.mobileEmptyOnlineHTML()
            },
            ai: {
                kicker: 'AI',
                title: 'AI 阅读设置',
                subtitle: this.aiConfigured ? 'API 已配置' : 'API 待配置',
                body: this.mobileAIPageHTML()
            },
            account: {
                kicker: 'ACCOUNT',
                title: this.isNativeStandalone() ? '本机状态' : '账号与服务',
                subtitle: this.isNativeStandalone() ? '手机单机版' : (this.user?.email || 'SmartRead'),
                body: this.mobileEmptyServicesHTML()
            }
        };
        const page = pages[view] || pages.import;
        return `<div class="mobile-dashboard-page" data-mobile-page="${escapeAttr(view)}">
                <div class="mobile-page-bar">
                    <button id="mobile-empty-back" class="mobile-empty-back" type="button" aria-label="返回上一级" onclick="Bookshelf.openMobileHome()">返回上一级</button>
                    <span>智读</span>
                </div>
                <header class="mobile-page-head">
                    <span>${escapeHTML(page.kicker)}</span>
                    <h2>${escapeHTML(page.title)}</h2>
                    <p>${escapeHTML(page.subtitle)}</p>
                </header>
                ${page.body}
            </div>`;
    },

    mobileImportPageHTML() {
        return `<section id="mobile-empty-import-page" class="mobile-empty-section" aria-label="导入本地书">
                <div class="mobile-empty-card mobile-import-card">
                    <h4>选择文件导入</h4>
                    <p>${this.isNativeStandalone() ? '支持 EPUB、PDF、TXT，书籍和进度只保存在本机。' : '支持 EPUB、PDF、TXT，本地书会进入当前 SmartRead 账号的书架。'}</p>
                    <button id="mobile-empty-import-action" class="mobile-empty-primary" type="button" onclick="Bookshelf.triggerMobileImport()">选择文件导入</button>
                    <button class="mobile-empty-secondary" type="button" onclick="Bookshelf.openMobileOnline()">在线找书</button>
                </div>
            </section>`;
    },

    mobileLibraryPageHTML() {
        if (!this.books.length) {
            return `<section id="mobile-empty-library-page" class="mobile-empty-section" aria-label="我的书架">
                    <div class="mobile-empty-card mobile-library-empty-card">
                        <h4>书架还是空的</h4>
                        <p>导入本地书，或进入在线找书下载到书架。</p>
                        <button class="mobile-empty-primary" type="button" onclick="Bookshelf.openMobileImport()">导入本地书</button>
                        <button class="mobile-empty-secondary" type="button" onclick="Bookshelf.openMobileOnline()">在线找书</button>
                    </div>
                </section>`;
        }
        const sorted = [...this.books].sort((a, b) => b.addedAt - a.addedAt);
        return `<section id="mobile-empty-library-page" class="mobile-empty-section" aria-label="我的书架">
                <div class="mobile-library-list">
                    ${sorted.map(book => this.mobileLibraryItemHTML(book)).join('')}
                </div>
            </section>`;
    },

    mobileLibraryItemHTML(book) {
        const pct = Math.round(book.progress || 0);
        const safeId = encodeURIComponent(book.id);
        const title = String(book.title || '未命名书籍');
        const cover = book.coverImg
            ? this.mobileCoverPreviewHTML(book.coverImg, title, 'mobile-library-cover', title.slice(0, 1) || '书')
            : `<span class="mobile-library-cover" style="background:${book.gradient || generateBookGradient(title)}">${escapeHTML(title.slice(0, 1) || '书')}</span>`;
        return `<div class="mobile-library-item">
                <button class="mobile-library-open" type="button" data-book-id="${escapeAttr(book.id)}" onclick="Bookshelf.openBook(decodeURIComponent('${safeId}'))">
                    ${cover}
                    <span class="mobile-library-copy">
                        <strong>${escapeHTML(title)}</strong>
                        <small>${pct > 0 ? `已读 ${pct}%` : '未开始'}</small>
                    </span>
                    <em>打开</em>
                </button>
                <button class="mobile-library-delete" type="button" title="删除" aria-label="删除${escapeAttr(title)}" onclick="Bookshelf.deleteBook(decodeURIComponent('${safeId}'))">✕</button>
            </div>`;
    },

    mobileCoverPreviewHTML(src, title, className, fallback = '书') {
        const safeFallback = escapeHTML(fallback);
        return `<span class="${escapeAttr(className)} has-image">
                <span class="mobile-cover-fallback">${safeFallback}</span>
                <img src="${escapeAttr(src)}" alt="${escapeAttr(title)}" loading="lazy" onerror="this.remove()">
            </span>`;
    },

    mobileEmptyOnlineHTML() {
        if (this.isNativeStandalone() && !this.hasNativeBackend()) return this.mobileStandaloneOnlineHTML();
        const content = this.cloud.rebinding
            ? this.mobileZlibBindHTML(true)
            : this.zlibBound
            ? this.mobileOnlineSearchHTML()
            : this.mobileZlibBindHTML();
        return `<section id="mobile-empty-online-source" class="mobile-empty-section mobile-empty-online" aria-label="在线找书">
                ${content}
            </section>`;
    },

    mobileStandaloneOnlineHTML() {
        return `<section id="mobile-empty-online-source" class="mobile-empty-section mobile-empty-online" aria-label="在线找书">
                <div class="mobile-empty-card mobile-online-search-card">
                    <div>
                        <h4>网页书源</h4>
                        <p>手机单机版不经过 SmartRead 服务器。打开网页书源下载 EPUB/PDF/TXT 后，回到智读导入本地文件。</p>
                    </div>
                    <div class="mobile-empty-search">
                        <input id="mobile-standalone-online-query" class="cloud-query" type="search" enterkeyhint="search" aria-label="搜索网页书源" placeholder="搜索书名、作者、ISBN..."
                            onkeydown="if(event.key==='Enter')Bookshelf.openStandaloneOnlineSearch()">
                        <button class="mobile-empty-primary compact" type="button" onclick="Bookshelf.openStandaloneOnlineSearch()">打开搜索</button>
                    </div>
                    <div class="mobile-format-filter" role="group" aria-label="网页书源快捷入口">
                        <button class="mobile-format-chip is-active" type="button" onclick="Bookshelf.openExternalSource('https://z-library.sk/')">z-library.sk</button>
                        <button class="mobile-format-chip" type="button" onclick="Bookshelf.openExternalSource('https://z-library.is/')">z-library.is</button>
                    </div>
                    <button class="mobile-empty-secondary" type="button" onclick="Bookshelf.openMobileImport()">下载完成后导入</button>
                </div>
            </section>`;
    },

    openExternalSource(url) {
        window.open(url, '_blank', 'noopener,noreferrer');
    },

    openStandaloneOnlineSearch() {
        const input = document.getElementById('mobile-standalone-online-query') || document.getElementById('standalone-online-query');
        const q = input?.value?.trim?.() || '';
        const url = q
            ? 'https://z-library.sk/s/' + encodeURIComponent(q)
            : 'https://z-library.sk/';
        this.openExternalSource(url);
    },

    mobileZlibBindHTML(rebinding = false) {
        const register = this.cloud.zlibRegisterUrl
            ? `<a class="mobile-zlib-register-link" href="${escapeAttr(this.cloud.zlibRegisterUrl)}" rel="noopener noreferrer">注册 Z-Library</a>`
            : '';
        const cancel = rebinding
            ? `<button id="mobile-zlib-rebind-cancel" class="mobile-empty-secondary" type="button" onclick="Bookshelf.cancelZlibRebind()">取消换绑</button>`
            : '';
        return `<div class="mobile-empty-card mobile-zlib-bind-card">
                <div>
                    <h4>${rebinding ? '换绑 Z-Library' : '绑定 Z-Library'}</h4>
                    <p>${rebinding ? '输入新账号后会覆盖当前绑定；取消后仍保留原账号。' : '只在需要在线搜索和下载时使用，不影响本地导入。'}</p>
                </div>
                <div class="mobile-empty-form">
                    <input id="mobile-zlib-bind-email" type="email" autocomplete="username" aria-label="Z-Library 邮箱" placeholder="Z-Library 邮箱">
                    <input id="mobile-zlib-bind-password" type="password" autocomplete="current-password" aria-label="Z-Library 密码" placeholder="Z-Library 密码" onkeydown="if(event.key==='Enter')Bookshelf.bindZlib()">
                    <button class="mobile-empty-primary compact" type="button" onclick="Bookshelf.bindZlib()">${rebinding ? '确认换绑' : '绑定 Z-Library'}</button>
                    ${cancel}
                </div>
                ${register}
                ${this.cloud.message ? `<div class="mobile-empty-message">${escapeHTML(this.cloud.message)}</div>` : ''}
            </div>`;
    },

    mobileOnlineSearchHTML() {
        const selectedFormat = this.cloud.format || '';
        const results = this.cloud.results.length
            ? `<div class="mobile-empty-results">${this.cloud.results.map((result, index) => this.onlineResultHTML(result, index)).join('')}</div>`
            : '<div class="mobile-empty-muted">还没有搜索结果。</div>';
        const pager = this.onlinePagerHTML({ mobile: true });
        return `<div class="mobile-empty-card mobile-online-search-card">
                <div>
                    <h4>Z-Library 搜索</h4>
                    <p>搜索结果下载后会进入当前书架。</p>
                </div>
                <button id="mobile-zlib-rebind" class="mobile-empty-secondary mobile-rebind-action" type="button" onclick="Bookshelf.startZlibRebind()">换绑 Z-Library</button>
                <div class="mobile-empty-search">
                    <input id="mobile-cloud-query" class="cloud-query" type="search" enterkeyhint="search" aria-label="搜索在线书源" placeholder="搜索书名、作者、ISBN..."
                        value="${escapeAttr(this.cloud.lastQuery || '')}"
                        onkeydown="if(event.key==='Enter')Bookshelf.onlineSearch(1)">
                    <button class="mobile-empty-primary compact" type="button" onclick="Bookshelf.onlineSearch(1)">搜索</button>
                </div>
                <div class="mobile-format-filter" role="group" aria-label="热门格式筛选">
                    ${this.mobileFormatButton('', '全部', selectedFormat)}
                    ${this.mobileFormatButton('epub', 'EPUB', selectedFormat)}
                    ${this.mobileFormatButton('pdf', 'PDF', selectedFormat)}
                    ${this.mobileFormatButton('txt', 'TXT', selectedFormat)}
                </div>
                ${this.cloud.message ? `<div class="mobile-empty-message">${escapeHTML(this.cloud.message)}</div>` : ''}
                ${results}
                ${pager}
            </div>`;
    },

    mobileFormatButton(value, label, selectedFormat) {
        const active = (selectedFormat || '') === value;
        return `<button class="mobile-format-chip ${active ? 'is-active' : ''}" type="button" aria-pressed="${active}" onclick="Bookshelf.setOnlineFormat('${value}')">${label}</button>`;
    },

    setOnlineFormat(format) {
        this.cloud.format = format || '';
        if (this.isMobileDashboardActive()) {
            this.render();
        } else {
            this.renderCloud();
        }
    },

    mobileAIPageHTML() {
        return `<section id="mobile-empty-ai-page" class="mobile-empty-section" aria-label="AI 阅读设置">
                <div class="mobile-empty-card mobile-ai-card">
                    <h4>${this.aiConfigured ? 'AI API 已配置' : 'AI API 待配置'}</h4>
                    <p>AI 设置复用当前设置面板，阅读时会用于聊天、讲书和朗读相关能力。</p>
                    <button id="mobile-empty-ai-settings" class="mobile-empty-primary" type="button" onclick="Bookshelf.openAISettings()">打开 AI 设置</button>
                </div>
            </section>`;
    },

    mobileEmptyServicesHTML() {
        if (this.isNativeStandalone()) {
            return `<section id="mobile-empty-services" class="mobile-empty-section mobile-empty-services" aria-label="本机服务">
                    <div class="mobile-empty-card mobile-service-card">
                        <div class="mobile-service-row">
                            <span>运行模式</span>
                            <strong>手机单机版</strong>
                        </div>
                        <div class="mobile-service-row">
                            <span>书架和进度</span>
                            <strong>保存在本机</strong>
                        </div>
                        <div class="mobile-service-row">
                            <span>AI</span>
                            <strong>${this.aiConfigured ? '已配置直连' : '待配置'}</strong>
                        </div>
                        <div class="mobile-service-row">
                            <span>在线书源</span>
                            <strong>网页打开</strong>
                        </div>
                        <button id="mobile-empty-settings" class="mobile-empty-manage" type="button" onclick="Bookshelf.openAISettings()">管理 AI 设置</button>
                        <button class="mobile-empty-manage" type="button" onclick="Bookshelf.openMobileOnline()">网页书源</button>
                    </div>
                </section>`;
        }
        return `<section id="mobile-empty-services" class="mobile-empty-section mobile-empty-services" aria-label="账号与服务">
                <div class="mobile-empty-card mobile-service-card">
                    <div class="mobile-service-row">
                        <span>SmartRead 账号</span>
                        <strong>${escapeHTML(this.user?.email || '未登录')}</strong>
                    </div>
                    <div class="mobile-service-row">
                        <span>AI</span>
                        <strong>${this.aiConfigured ? '已配置' : '待配置'}</strong>
                    </div>
                    <div class="mobile-service-row">
                        <span>Z-Library</span>
                        <strong>${this.zlibBound ? '已绑定' : '待绑定'}</strong>
                    </div>
                    <button id="mobile-empty-settings" class="mobile-empty-manage" type="button" onclick="Bookshelf.openAISettings()">管理设置</button>
                    <button class="mobile-empty-manage" type="button" onclick="Bookshelf.openMobileOnline()">在线书源</button>
                </div>
            </section>`;
    },

    updateStats(total, reading, done) {
        const elTotal = document.getElementById('stat-total');
        const elReading = document.getElementById('stat-reading');
        const elDone = document.getElementById('stat-done');
        if (elTotal) elTotal.textContent = total;
        if (elReading) elReading.textContent = reading;
        if (elDone) elDone.textContent = done;
    },

    cardHTML(book) {
        const pct = Math.round(book.progress || 0);
        const safeTitle = escapeHTML(book.title);
        const safeId = encodeURIComponent(book.id);
        const isServer = book.source === 'server';
        const coverContent = book.coverImg
            ? `<img class="book-cover-img" src="${escapeAttr(book.coverImg)}" alt="${safeTitle}">`
            : `<div class="book-cover-gradient" style="background:${book.gradient || generateBookGradient(book.title)}">${safeTitle}</div>`;
        const progressLabel = isServer && !book.content
            ? '点开后缓存并阅读'
            : (pct > 0 ? `已读 ${pct}%` : '未开始');
        return `<div class="book-card" data-id="${escapeAttr(book.id)}" onclick="Bookshelf.openBook(decodeURIComponent('${safeId}'))">
            <div class="book-cover">${coverContent}</div>
            ${isServer ? '<span class="book-cloud-badge">ZLib</span>' : ''}
            <button class="book-delete" onclick="event.stopPropagation();Bookshelf.deleteBook(decodeURIComponent('${safeId}'))">x</button>
            <div class="book-info">
                <div class="book-title">${safeTitle}</div>
                <div class="book-progress">${progressLabel}</div>
                <div class="book-progress-bar"><div class="book-progress-fill" style="width:${pct}%"></div></div>
            </div>
        </div>`;
    },

    heroHTML(book, pct) {
        const safeTitle = escapeHTML(book.title);
        const heroCover = book.coverImg
            ? `<div class="hero-cover"><img class="book-cover-img" src="${escapeAttr(book.coverImg)}" alt="${safeTitle}"></div>`
            : `<div class="hero-cover" style="background:${book.gradient || generateBookGradient(book.title)}">${safeTitle}</div>`;
        return `${heroCover}
            <div class="hero-info">
                <div class="hero-label">继续阅读</div>
                <div class="hero-title">${safeTitle}</div>
                <div class="hero-subtitle">已读 ${pct}%</div>
                <div class="hero-progress-bar">
                    <div class="hero-progress-fill" style="width:${pct}%"></div>
                </div>
                <button class="hero-cta">阅读</button>
            </div>`;
    },

    async openBook(id) {
        if (!this.requireSmartReadSignedIn()) return;
        const book = this.books.find(item => item.id === id) || await dbGet('books', id);
        if (book?.serverBookId && !book.content) {
            await this.openServerBook(book.serverBookId);
            return;
        }
        await App.openBook(id);
    },

    async deleteBook(id) {
        const book = this.books.find(item => item.id === id) || await dbGet('books', id);
        if (!book) return;
        if (!confirm('确定删除这本书吗？')) return;
        try {
            if (book.serverBookId && window.SmartReadAPI?.deleteServerBook) {
                await SmartReadAPI.deleteServerBook(book.serverBookId);
                this.cloud.serverBooks = this.cloud.serverBooks.filter(item => item.id !== book.serverBookId);
            }
            await dbDelete('books', id);
            this.books = this.books.filter(item => item.id !== id);
            this.render();
        } catch (err) {
            this.cloud.message = '删除失败：' + err.message;
            this.render();
        }
    },

    search(keyword) {
        if (!this.requireSmartReadSignedIn()) return;
        const grid = document.getElementById('bookshelf-grid');
        const key = keyword.trim().toLowerCase();
        if (!key) { this.render(); return; }
        const filtered = this.books.filter(book => book.title.toLowerCase().includes(key));
        grid.innerHTML = filtered.length
            ? filtered.map(book => this.cardHTML(book)).join('')
            : '<p style="color:var(--text-muted);padding:40px;text-align:center">没有找到相关书籍。</p>';
    },

    ensureCloudUI() {
        if (document.getElementById('cloud-section')) return;
        const shelf = document.getElementById('shelf-section');
        if (!shelf) return;
        const section = document.createElement('section');
        section.id = 'cloud-section';
        section.className = 'cloud-section';
        section.innerHTML = `
            <div class="cloud-card">
                <div class="cloud-card-head">
                    <div>
                        <div id="cloud-kicker" class="cloud-kicker">SMARTREAD</div>
                        <h2 id="cloud-title" class="cloud-title">先登录，再进入阅读体验</h2>
                    </div>
                </div>
                <div id="cloud-body" class="cloud-body"></div>
            </div>
            <div id="desktop-ai-api-card" class="desktop-ai-api-card desktop-settings-card hidden" aria-label="设置"></div>`;
        shelf.insertAdjacentElement('afterend', section);
    },

    positionCloudSection() {
        const section = document.getElementById('cloud-section');
        const stats = document.getElementById('stats-panel');
        const shelf = document.getElementById('shelf-section');
        const content = document.querySelector('.bookshelf-content');
        if (!section || !content) return;
        if (!this.user) {
            const anchor = stats || shelf;
            if (anchor && section.nextElementSibling !== anchor) content.insertBefore(section, anchor);
            return;
        }
        if (shelf && shelf.nextElementSibling !== section) shelf.insertAdjacentElement('afterend', section);
    },

    async refreshCloud() {
        if (!window.SmartReadAPI) return;
        try {
            const me = await SmartReadAPI.me();
            this.user = me.user || null;
            this.aiConfigured = !!me.aiConfigured;
            this.zlibBound = !!me.zlibBound;
            if (this.user && window.AIConfig?.refresh) {
                await AIConfig.refresh();
                this.aiConfigured = AIConfig.isConfigured();
            }
            if (this.user) {
                await this.loadOwnedBooks();
                const data = await SmartReadAPI.serverBooks().catch(() => ({ books: [] }));
                this.cloud.serverBooks = data.books || [];
                this.mergeServerBooksIntoShelf(this.cloud.serverBooks);
            } else {
                this.books = [];
                this.cloud.serverBooks = [];
                this.aiConfigured = false;
                this.zlibBound = false;
                this.cloud.rebinding = false;
            }
        } catch (err) {
            this.user = null;
            this.books = [];
            this.cloud.serverBooks = [];
            this.aiConfigured = false;
            this.zlibBound = false;
            this.cloud.rebinding = false;
            this.cloud.message = err.message;
        }
        this.render();
    },

    renderCloud() {
        const body = document.getElementById('cloud-body');
        if (!body) return;
        this.renderDesktopAIConfig();
        const kicker = document.getElementById('cloud-kicker');
        const title = document.getElementById('cloud-title');
        if (this.isNativeStandalone()) {
            if (kicker) kicker.textContent = 'LOCAL';
            if (title) title.textContent = this.hasNativeBackend() ? '本机原生书源' : '本机单机版';
            body.innerHTML = this.hasNativeBackend()
                ? this.nativeBackendCloudHTML()
                : this.standaloneCloudHTML();
            return;
        }
        if (this.isLocalDesktopUser()) {
            if (kicker) kicker.textContent = 'LOCAL';
            if (title) title.textContent = '本机书架';
            body.innerHTML = this.desktopLocalCloudHTML();
            return;
        }
        if (this.isDesktopRuntime() && !this.user) {
            if (kicker) kicker.textContent = 'LOCAL';
            if (title) title.textContent = '本机书架';
            body.innerHTML = this.desktopLocalUnavailableHTML();
            return;
        }
        if (kicker) kicker.textContent = this.user ? 'ONLINE' : 'SMARTREAD';
        if (title) title.textContent = this.user ? '在线找书' : '登录智读';
        if (!this.user) {
            body.innerHTML = this.authHTML();
            return;
        }

        body.innerHTML = this.zlibBound && !this.cloud.rebinding
            ? this.onlineSearchPanelHTML()
            : this.onlineSearchDisabledHTML();
    },

    renderDesktopAIConfig() {
        const card = document.getElementById('desktop-ai-api-card');
        if (!card) return;
        if (!this.user) {
            card.classList.add('hidden');
            card.innerHTML = '';
            return;
        }
        const isLocalDesktop = this.isLocalDesktopUser();
        const accountPanel = isLocalDesktop
            ? ''
            : `<section class="cloud-settings-panel" aria-label="账号">
                    <div class="cloud-panel-head">
                        <div>
                            <span>ACCOUNT</span>
                            <h3>账号</h3>
                        </div>
                        <p>本地书架和阅读进度会按邮箱隔离保存。</p>
                    </div>
                    <div class="cloud-account-row">
                        <div>
                            <strong>${escapeHTML(this.user.email)}</strong>
                            <span>SmartRead 已登录。</span>
                        </div>
                        <button class="btn btn-icon" onclick="Bookshelf.logout()">退出</button>
                    </div>
                </section>`;
        card.classList.remove('hidden');
        card.innerHTML = `<div class="cloud-panel-head">
                <div>
                    <span>SETTINGS</span>
                    <h3>设置</h3>
                </div>
                <p>${isLocalDesktop ? '在线书源和 AI API 在这里管理，桌面版默认进入本机书架。' : '账号、在线书源和 AI API 统一在这里管理，搜索区只负责找书下载。'}</p>
            </div>
            ${this.globalCloudMessageHTML()}
            <div class="desktop-settings-grid">
                ${accountPanel}
                ${this.cloudServiceConfigHTML()}
                <section class="cloud-api-panel" aria-label="AI API 配置">
                    <div class="cloud-panel-head">
                        <div>
                            <span>API</span>
                            <h3>AI API</h3>
                        </div>
                        <p>阅读、讲书和问答的接口设置。</p>
                    </div>
                    <button class="desktop-ai-api-status ${this.aiConfigured ? 'is-ready' : ''}" type="button" onclick="App.togglePanel('settings')">
                        <span>AI API</span>
                        <strong>${this.aiConfigured ? '已配置' : '待配置'}</strong>
                        <em>打开配置</em>
                    </button>
                </section>
            </div>`;
    },

    cloudServiceConfigHTML() {
        const zlibControl = this.cloud.rebinding
            ? this.zlibBindHTML(true)
            : this.zlibBound
                ? this.zlibBoundHTML()
                : this.zlibBindHTML();
        return `<section class="cloud-source-panel" aria-label="书源绑定">
                <div class="cloud-panel-head">
                    <div>
                        <span>SOURCE</span>
                        <h3>书源绑定</h3>
                    </div>
                    <p>Z-Library 只负责在线找书和下载。</p>
                </div>
                ${zlibControl}
            </section>`;
    },

    onlineSearchDisabledHTML() {
        const message = this.cloud.rebinding
            ? '正在换绑书源，完成或取消后再搜索。'
            : '先在下方设置里绑定 Z-Library 书源，再在线找书。';
        return `<section class="cloud-search-panel" aria-label="搜索下载">
                <div class="cloud-panel-head">
                    <div>
                        <span>SEARCH</span>
                        <h3>搜索下载</h3>
                    </div>
                    <p>输入书名、作者或 ISBN，下载完成后自动进入当前书架。</p>
                </div>
                <div class="cloud-empty">${message}</div>
            </section>`;
    },

    onlineSearchPanelHTML() {
        return `<section class="cloud-search-panel" aria-label="搜索下载">
                <div class="cloud-panel-head">
                    <div>
                        <span>SEARCH</span>
                        <h3>搜索下载</h3>
                    </div>
                    <p>输入书名、作者或 ISBN，下载完成后自动进入当前书架。</p>
                </div>
                ${this.onlineSearchHTML()}
            </section>`;
    },

    nativeBackendCloudHTML() {
        return `<div class="cloud-account-row">
                <div>
                    <strong>本机书架</strong>
                    <span>Android 原生层保存书源账号、下载文件和在线书籍记录，不依赖 SmartRead 服务器。</span>
                </div>
            </div>
            ${this.globalCloudMessageHTML()}
            ${this.cloudServiceConfigHTML()}
            ${this.zlibBound && !this.cloud.rebinding ? this.onlineSearchPanelHTML() : ''}`;
    },

    desktopLocalCloudHTML() {
        return `<div class="cloud-account-row">
                <div>
                    <strong>本机书架</strong>
                    <span>桌面版默认直接进入；书籍、AI 设置和阅读进度保存在这台电脑。</span>
                </div>
            </div>
            ${this.globalCloudMessageHTML()}
            ${this.cloudServiceConfigHTML()}
            ${this.zlibBound && !this.cloud.rebinding ? this.onlineSearchPanelHTML() : ''}`;
    },

    desktopLocalUnavailableHTML() {
        return `<div class="cloud-account-row">
                <div>
                    <strong>本机书架</strong>
                    <span>正在连接本机服务。桌面版无需邮箱验证码。</span>
                </div>
            </div>
            ${this.globalCloudMessageHTML()}`;
    },

    standaloneCloudHTML() {
        return `<div class="cloud-account-row">
                <div>
                    <strong>本机书架</strong>
                    <span>不依赖 SmartRead 服务器；书籍、笔记和阅读进度保存在当前设备。</span>
                </div>
            </div>
            <section class="cloud-config-panel" aria-label="网页书源入口">
                <div class="cloud-panel-head">
                    <div>
                        <span>CONFIG</span>
                        <h3>网页书源入口</h3>
                    </div>
                    <p>单机模式只负责打开外部书源，下载后的文件再回到智读导入。</p>
                </div>
                <div class="zlib-bind-card is-bound">
                    <div>
                        <h3>网页书源</h3>
                        <span>打开外部网页下载书籍文件，回到智读后导入本地。</span>
                    </div>
                    <div class="zlib-bound-actions">
                        <button class="btn btn-icon" onclick="Bookshelf.openExternalSource('https://z-library.sk/')">z-library.sk</button>
                        <button class="btn btn-icon" onclick="Bookshelf.openExternalSource('https://z-library.is/')">z-library.is</button>
                    </div>
                </div>
            </section>
            <section class="cloud-search-panel" aria-label="网页书源搜索">
                <div class="cloud-panel-head">
                    <div>
                        <span>SEARCH</span>
                        <h3>网页搜索</h3>
                    </div>
                    <p>搜索入口独立出来，避免和书源配置混在一起。</p>
                </div>
                <div class="online-search-tools">
                <input id="standalone-online-query" class="cloud-query" type="search" enterkeyhint="search" aria-label="搜索网页书源" placeholder="搜索书名、作者、ISBN..."
                    onkeydown="if(event.key==='Enter')Bookshelf.openStandaloneOnlineSearch()">
                <button class="btn btn-primary" onclick="Bookshelf.openStandaloneOnlineSearch()">打开搜索</button>
                </div>
            </section>`;
    },

    authHTML() {
        return `
            <div class="cloud-auth">
                <div class="login-mark" aria-hidden="true">
                    <img src="images/biaoge-logo.png" alt="">
                </div>
                <div>
                    <h3>登录表哥智读</h3>
                    <p>用邮箱验证码继续，进入你的书架、阅读进度和 AI 设置。</p>
                </div>
                <div class="cloud-form-grid zlib-login-grid">
                    <input id="cloud-auth-email" type="email" autocomplete="email" aria-label="邮箱" placeholder="邮箱"
                        value="${escapeAttr(this.cloud.authEmail || '')}"
                        onkeydown="if(event.key==='Enter')Bookshelf.requestEmailCode()">
                    <input id="cloud-auth-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6 位验证码" placeholder="6 位验证码"
                        onkeydown="if(event.key==='Enter')Bookshelf.verifyEmailLogin()">
                    <button class="btn btn-primary" onclick="${this.cloud.codeSent ? 'Bookshelf.verifyEmailLogin()' : 'Bookshelf.requestEmailCode()'}" ${this.cloud.busy ? 'disabled' : ''}>
                        ${this.cloud.codeSent ? '登录' : '获取验证码'}
                    </button>
                </div>
                <p class="login-footnote">验证码 10 分钟内有效。未注册邮箱会自动创建账号。</p>
                ${this.cloud.message ? `<div class="cloud-message">${escapeHTML(this.cloud.message)}</div>` : ''}
            </div>`;
    },

    zlibBindHTML(rebinding = false) {
        const register = this.cloud.zlibRegisterUrl
            ? `<a class="zlib-register-link" href="${escapeAttr(this.cloud.zlibRegisterUrl)}" rel="noopener noreferrer">没有 Z-Library 账号？去官网注册</a>`
            : '';
        const cancel = rebinding
            ? `<button class="btn btn-icon" onclick="Bookshelf.cancelZlibRebind()" ${this.cloud.busy ? 'disabled' : ''}>取消换绑</button>`
            : '';
        return `
            <div class="zlib-bind-card">
                <div>
                    <h3>${rebinding ? '换绑在线书源' : '绑定在线书源'}</h3>
                    <span>${rebinding ? '输入新 Z-Library 账号后会覆盖当前绑定；取消后保留原账号。' : '只在需要在线搜索和下载时绑定，不影响本地导入和阅读。'}</span>
                </div>
                <div class="cloud-form-grid">
                    <input id="zlib-bind-email" type="email" autocomplete="username" aria-label="Z-Library 邮箱" placeholder="Z-Library 邮箱">
                    <input id="zlib-bind-password" type="password" autocomplete="current-password" aria-label="Z-Library 密码" placeholder="Z-Library 密码"
                        onkeydown="if(event.key==='Enter')Bookshelf.bindZlib()">
                    <button class="btn btn-primary" onclick="Bookshelf.bindZlib()" ${this.cloud.busy ? 'disabled' : ''}>${rebinding ? '确认换绑' : '绑定'}</button>
                    ${cancel}
                </div>
                ${register}
            </div>`;
    },

    zlibBoundHTML() {
        return `
            <div class="zlib-bind-card is-bound">
                <div>
                    <h3>Z-Library 书源已绑定</h3>
                    <span>在线下载完成后会进入主书架，和本地书一起阅读。</span>
                </div>
                <div class="zlib-bound-actions">
                    <button class="btn btn-icon" onclick="Bookshelf.startZlibRebind()" ${this.cloud.busy ? 'disabled' : ''}>换绑</button>
                    <button class="btn btn-icon" onclick="Bookshelf.unbindZlib()" ${this.cloud.busy ? 'disabled' : ''}>解绑</button>
                </div>
            </div>`;
    },

    onlineSearchHTML() {
        const selectedFormat = this.cloud.format || '';
        const results = this.cloud.results.length
            ? this.cloud.results.map((result, index) => this.onlineResultHTML(result, index)).join('')
            : '<div class="cloud-empty">还没有搜索结果。</div>';
        return `
            <div class="online-search-tools">
                <input id="cloud-query" class="cloud-query" type="search" enterkeyhint="search" aria-label="搜索在线书源" placeholder="搜索书名、作者、ISBN..."
                    value="${escapeAttr(this.cloud.lastQuery || '')}"
                    onkeydown="if(event.key==='Enter')Bookshelf.onlineSearch(1)">
                <select id="cloud-format" aria-label="选择书籍格式">
                    <option value="" ${selectedFormat === '' ? 'selected' : ''}>EPUB/PDF/TXT</option>
                    <option value="epub" ${selectedFormat === 'epub' ? 'selected' : ''}>EPUB</option>
                    <option value="pdf" ${selectedFormat === 'pdf' ? 'selected' : ''}>PDF</option>
                    <option value="txt" ${selectedFormat === 'txt' ? 'selected' : ''}>TXT</option>
                </select>
                <button class="btn btn-primary" onclick="Bookshelf.onlineSearch(1)" ${this.cloud.busy ? 'disabled' : ''}>搜索</button>
            </div>
            ${this.searchCloudMessageHTML()}
            <div class="online-results">${results}</div>
            ${this.onlinePagerHTML()}`;
    },

    isSearchCloudMessage(message = this.cloud.message) {
        return message === '请输入搜索关键词。'
            || message === '正在搜索...'
            || message === '没有找到结果。'
            || message.startsWith('搜索失败:');
    },

    globalCloudMessageHTML() {
        if (!this.cloud.message || this.isSearchCloudMessage()) return '';
        return `<div class="cloud-message">${escapeHTML(this.cloud.message)}</div>`;
    },

    searchCloudMessageHTML() {
        if (!this.cloud.message || !this.isSearchCloudMessage()) return '';
        return `<div class="cloud-message cloud-search-message">${escapeHTML(this.cloud.message)}</div>`;
    },

    onlinePagerHTML(options = {}) {
        const mobile = !!options.mobile;
        const currentPage = Math.max(1, Number(this.cloud.page) || 1);
        const totalPages = Number.isFinite(Number(this.cloud.totalPages)) && Number(this.cloud.totalPages) > 0
            ? Number(this.cloud.totalPages)
            : null;
        const canPrev = !this.cloud.busy && currentPage > 1;
        const canNext = !this.cloud.busy && (
            totalPages !== null
                ? currentPage < totalPages
                : Boolean(this.cloud.hasNext && this.cloud.results.length)
        );
        if (mobile && !this.cloud.lastQuery && !this.cloud.results.length && currentPage === 1) return '';
        const pagerClass = mobile ? 'mobile-search-pager' : 'cloud-pager';
        const buttonClass = mobile ? 'mobile-pager-btn' : 'btn btn-icon';
        const stateClass = mobile ? 'mobile-pager-state' : '';
        const prevData = mobile ? ' data-mobile-online-page="prev"' : '';
        const nextData = mobile ? ' data-mobile-online-page="next"' : '';
        const pageText = totalPages ? `第 ${currentPage} / ${totalPages} 页` : `第 ${currentPage} 页`;
        return `<div class="${pagerClass}" aria-label="搜索结果分页">
                <button class="${buttonClass}" type="button"${prevData} onclick="Bookshelf.onlineSearch(${Math.max(1, currentPage - 1)})" ${canPrev ? '' : 'disabled'}>上一页</button>
                <span class="${stateClass}">${pageText}</span>
                <button class="${buttonClass}" type="button"${nextData} onclick="Bookshelf.onlineSearch(${currentPage + 1})" ${canNext ? '' : 'disabled'}>下一页</button>
            </div>`;
    },

    onlineResultHTML(result, index) {
        const authors = (result.authors || []).join(', ') || '未知作者';
        const inShelf = this.cloud.serverBooks.some(book => book.sourceId === result.sourceId);
        const coverUrl = result.coverUrl && !/cover-not-exists/i.test(result.coverUrl)
            ? result.coverUrl
            : '';
        return `
            <article class="online-result">
                <div class="online-cover">${coverUrl ? `<img src="${escapeAttr(coverUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('书'))">` : '书'}</div>
                <div class="online-info">
                    <h3>${escapeHTML(result.title)}</h3>
                    <p>${escapeHTML(authors)}</p>
                    <div class="online-meta">
                        <span>${escapeHTML((result.extension || '').toUpperCase())}</span>
                        <span>${escapeHTML(result.year || '')}</span>
                        <span>${escapeHTML(result.sizeLabel || '')}</span>
                    </div>
                </div>
                ${this.downloadButtonHTML(result, index, inShelf)}
            </article>`;
    },

    downloadButtonHTML(result, index, inShelf) {
        const job = this.cloud.jobs[result.sourceId];
        const status = inShelf ? 'saved' : job?.status;
        if (status === 'queued' || status === 'running') {
            const label = status === 'queued' ? '排队中' : '下载中';
            return `<button class="btn btn-primary download-action is-running" disabled>
                <span class="download-ring" aria-hidden="true"></span>${label}
            </button>`;
        }
        if (status === 'saved') {
            return `<button class="btn btn-primary download-action is-saved" disabled>
                <span class="download-check" aria-hidden="true">✓</span>已入书架
            </button>`;
        }
        if (status === 'failed') {
            return `<button class="btn btn-primary download-action is-failed" onclick="Bookshelf.downloadOnline(${index})">
                重试
            </button>`;
        }
        return `<button class="btn btn-primary download-action" onclick="Bookshelf.downloadOnline(${index})">下载</button>`;
    },

    getAuthInput() {
        return {
            email: document.getElementById('cloud-auth-email')?.value.trim() || '',
            code: document.getElementById('cloud-auth-code')?.value.trim() || ''
        };
    },

    inputValue(ids) {
        const items = ids
            .map(id => document.getElementById(id))
            .filter(Boolean);
        const visible = items.find(el => el.offsetParent !== null);
        return (visible || items[0])?.value?.trim?.() || '';
    },

    getZlibInput() {
        return {
            email: this.inputValue(['mobile-zlib-bind-email', 'zlib-bind-email']),
            password: this.inputValue(['mobile-zlib-bind-password', 'zlib-bind-password'])
        };
    },

    getOnlineSearchInput() {
        return {
            q: this.inputValue(['mobile-cloud-query', 'cloud-query']) || this.cloud.lastQuery || '',
            format: this.inputValue(['cloud-format']) || this.cloud.format || ''
        };
    },

    async requestEmailCode() {
        if (this.cloud.busy) return;
        const { email } = this.getAuthInput();
        await this.runCloudAction(async () => {
            this.cloud.busy = true;
            this.cloud.authEmail = email;
            this.cloud.message = '正在发送验证码...';
            this.renderCloud();
            await SmartReadAPI.requestEmailCode(email);
            this.cloud.codeSent = true;
            this.cloud.message = '验证码已发送，请查看邮箱。';
        }, '发送失败');
        this.cloud.busy = false;
        this.render();
    },

    async verifyEmailLogin() {
        if (this.cloud.busy) return;
        const { email, code } = this.getAuthInput();
        await this.runCloudAction(async () => {
            this.cloud.busy = true;
            this.cloud.authEmail = email;
            this.cloud.message = '正在登录...';
            this.renderCloud();
            await SmartReadAPI.verifyEmailCode(email, code);
            this.cloud.codeSent = false;
            this.cloud.message = '';
            await this.refreshCloud();
        }, '登录失败');
        this.cloud.busy = false;
        this.render();
    },

    async bindZlib() {
        if (this.cloud.busy || !this.requireSmartReadSignedIn()) return;
        const { email, password } = this.getZlibInput();
        await this.runCloudAction(async () => {
            this.cloud.busy = true;
            this.cloud.message = '正在绑定 Z-Library 书源...';
            this.renderCloudSurface();
            await this.withTimeout(
                SmartReadAPI.bindZlib({ email, password }),
                45000,
                '绑定 Z-Library 超时，请检查网络后重试。'
            );
            this.zlibBound = true;
            this.cloud.rebinding = false;
            this.cloud.message = '';
            await this.refreshCloud();
        }, '绑定失败');
        this.cloud.busy = false;
        this.render();
    },

    async unbindZlib() {
        if (this.cloud.busy || !this.requireSmartReadSignedIn()) return;
        await this.runCloudAction(async () => {
            this.cloud.busy = true;
            await SmartReadAPI.unbindZlib();
            this.zlibBound = false;
            this.cloud.rebinding = false;
            this.cloud.results = [];
            this.cloud.jobs = {};
            this.cloud.message = '已解绑 Z-Library 书源。';
        }, '解绑失败');
        this.cloud.busy = false;
        this.render();
    },

    startZlibRebind() {
        if (!this.requireSmartReadSignedIn()) return;
        this.cloud.rebinding = true;
        this.cloud.message = '';
        this.renderCloudSurface();
    },

    cancelZlibRebind() {
        this.cloud.rebinding = false;
        this.cloud.message = '';
        this.renderCloudSurface();
    },

    async login() {
        return this.bindZlib();
    },

    async logout() {
        await this.runCloudAction(async () => {
            await SmartReadAPI.logout();
            this.user = null;
            this.books = [];
            this.aiConfigured = false;
            this.zlibBound = false;
            this.cloud.rebinding = false;
            this.cloud.results = [];
            this.cloud.serverBooks = [];
            this.cloud.jobs = {};
            this.cloud.page = 1;
            this.cloud.totalPages = null;
            this.cloud.hasNext = false;
            this.cloud.format = '';
            this.cloud.codeSent = false;
            this.cloud.authEmail = '';
            this.cloud.message = '';
            if (window.AIConfig) {
                AIConfig.status.configured = false;
                AIConfig.status.keyPreview = '';
            }
        }, '退出失败');
        this.render();
    },

    async onlineSearch(page = 1) {
        if (!this.requireZlibBound('请先绑定 Z-Library 书源，再搜索。')) return;
        const { q, format } = this.getOnlineSearchInput();
        if (!q) {
            this.cloud.message = '请输入搜索关键词。';
            this.renderCloudSurface();
            return;
        }
        await this.runCloudAction(async () => {
            this.cloud.busy = true;
            this.cloud.message = '正在搜索...';
            this.cloud.lastQuery = q;
            this.cloud.format = format;
            this.renderCloudSurface();
            const data = await SmartReadAPI.searchZlib({ q, page, format });
            this.cloud.results = data.results || [];
            this.cloud.page = data.page || page;
            this.cloud.totalPages = data.totalPages || null;
            this.cloud.hasNext = typeof data.hasNext === 'boolean'
                ? data.hasNext
                : (this.cloud.totalPages ? this.cloud.page < this.cloud.totalPages : this.cloud.results.length > 0);
            this.cloud.message = this.cloud.results.length ? '' : '没有找到结果。';
        }, '搜索失败');
        this.cloud.busy = false;
        this.renderCloudSurface();
    },

    async downloadOnline(index) {
        const result = this.cloud.results[index];
        if (!result || !this.requireZlibBound('请先绑定 Z-Library 书源，再下载。')) return;
        try {
            const format = (result.extension || document.getElementById('cloud-format')?.value || '').toLowerCase();
            if (!['epub', 'pdf', 'txt'].includes(format)) throw new Error('请选择 EPUB、PDF 或 TXT 格式。');
            this.cloud.jobs[result.sourceId] = { status: 'queued' };
            this.renderCloudSurface();
            const data = await SmartReadAPI.startZlibDownload({
                sourceId: result.sourceId,
                format,
                metadata: result
            });
            this.cloud.jobs[result.sourceId] = { status: data.status || 'queued', jobId: data.jobId };
            this.renderCloudSurface();
            this.pollDownload(data.jobId, result.sourceId);
        } catch (err) {
            this.cloud.jobs[result.sourceId] = { status: 'failed', error: err.message };
            this.cloud.message = '下载失败：' + err.message;
            this.renderCloudSurface();
        }
    },

    async pollDownload(jobId, sourceId) {
        try {
            const data = await SmartReadAPI.downloadJob(jobId);
            const job = data.job;
            this.cloud.jobs[sourceId] = {
                status: job.status,
                error: job.error,
                jobId,
                bookId: job.bookId
            };
            if (job.status === 'saved') {
                this.cloud.message = '已保存到主书架。';
                if (job.book) this.upsertServerBook(job.book);
                await this.refreshServerBooks();
                this.render();
                return;
            }
            if (job.status === 'failed') {
                this.cloud.message = job.error || '下载失败。';
                this.renderCloudSurface();
                return;
            }
            this.renderCloudSurface();
            setTimeout(() => this.pollDownload(jobId, sourceId), 1200);
        } catch (err) {
            this.cloud.jobs[sourceId] = { status: 'failed', error: err.message, jobId };
            this.cloud.message = err.message;
            this.renderCloudSurface();
        }
    },

    upsertServerBook(serverBook) {
        const index = this.cloud.serverBooks.findIndex(book => book.id === serverBook.id);
        if (index >= 0) this.cloud.serverBooks[index] = serverBook;
        else this.cloud.serverBooks.unshift(serverBook);
        this.mergeServerBooksIntoShelf(this.cloud.serverBooks);
    },

    async refreshServerBooks() {
        if (!this.user) return;
        const data = await SmartReadAPI.serverBooks();
        this.cloud.serverBooks = data.books || [];
        this.mergeServerBooksIntoShelf(this.cloud.serverBooks);
    },

    async openServerBook(bookId) {
        await this.runCloudAction(async () => {
            const serverBook = (this.cloud.serverBooks || []).find(book => book.id === bookId);
            if (!serverBook) throw new Error('找不到服务器书籍。');
            this.cloud.message = '正在缓存到本地...';
            this.renderCloudSurface();
            const resp = await SmartReadAPI.fetchBookFile(bookId);
            if (!resp.ok) {
                let error = '获取书籍文件失败。';
                try { error = (await resp.json()).error || error; } catch {}
                throw new Error(error);
            }
            const blob = await resp.blob();
            const ext = serverBook.extension.toLowerCase();
            let content;
            let coverImg = serverBook.coverUrl || null;
            if (ext === 'txt') {
                content = await blob.text();
            } else {
                const buffer = await blob.arrayBuffer();
                content = new Blob([buffer], { type: serverBook.mimeType || blob.type });
                if (ext === 'epub' && !coverImg) coverImg = await extractEpubCover(buffer.slice(0));
            }

            const localId = this.localServerBookId(serverBook.id);
            const existing = await dbGet('books', localId);
            const book = this.toLocalServerBook(serverBook, existing);
            book.content = content;
            book.coverImg = coverImg || book.coverImg;
            await dbPut('books', book);
            const index = this.books.findIndex(item => item.id === localId);
            if (index >= 0) this.books[index] = book;
            else this.books.push(book);
            this.cloud.message = '';
            this.render();
            await App.openBook(localId);
        }, '打开服务器书籍失败');
    },

    async runCloudAction(action, prefix) {
        try {
            await action();
        } catch (err) {
            this.cloud.message = `${prefix}: ${err.message}`;
            this.renderCloudSurface();
        }
    },

    withTimeout(promise, timeoutMs, message) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            Promise.resolve(promise)
                .then(resolve, reject)
                .finally(() => clearTimeout(timer));
        });
    }
};
