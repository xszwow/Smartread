/* ===== 划词提问模块 ===== */
const Selection = {
    popup: null,
    _selectedText: '',
    _selectionTimer: null,
    _lastPointer: null,

    init() {
        document.addEventListener('mouseup', (e) => this.handleSelectionPointer(e));
        document.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse') return;
            this.handleSelectionPointer(e);
        });
        document.addEventListener('touchend', (e) => {
            const touch = e.changedTouches?.[0];
            this.handleSelectionPointer(touch || e);
        }, { passive: true });
        document.addEventListener('selectionchange', () => {
            if (!this.isMobileReaderActive()) return;
            this.scheduleSelectionPopup();
        });
        document.addEventListener('mousedown', (e) => {
            if (this.popup && this.popup.contains(e.target)) return;
            this.removePopup();
        });
        document.addEventListener('touchstart', (e) => {
            if (this.popup && this.popup.contains(e.target)) return;
            this.removePopup();
        }, { passive: true });
    },

    isReaderActive() {
        return !!document.getElementById('reader-view')?.classList.contains('active');
    },

    isMobileReaderActive() {
        return this.isReaderActive() && App.isSmallScreen?.();
    },

    handleSelectionPointer(e) {
        if (!this.isReaderActive()) return;
        if (this.popup && this.popup.contains(e.target)) return;
        this._lastPointer = e?.clientX != null ? { x: e.clientX, y: e.clientY } : null;
        this.scheduleSelectionPopup();
    },

    scheduleSelectionPopup(delay = 120) {
        clearTimeout(this._selectionTimer);
        this._selectionTimer = setTimeout(() => this.showFromCurrentSelection(), delay);
    },

    showFromCurrentSelection() {
        if (!this.isReaderActive()) return;
        const sel = window.getSelection();
        const text = sel?.toString().trim() || '';
        this.removePopup();
        if (text.length < 2) return;

        const anchor = this.selectionAnchor(sel);
        const x = this._lastPointer?.x || anchor.x;
        const y = this._lastPointer?.y || anchor.y;
        this.showPopup(x, y, text);
    },

    selectionAnchor(sel) {
        try {
            const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
            const rect = range?.getBoundingClientRect();
            if (rect && (rect.width || rect.height)) {
                return { x: rect.left + rect.width / 2, y: rect.top };
            }
        } catch {}
        return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    },

    showPopup(x, y, text) {
        this._selectedText = text;
        this.popup = document.createElement('div');
        this.popup.className = 'selection-popup';
        this.popup.addEventListener('mousedown', e => e.stopPropagation());
        const btnAI = document.createElement('button');
        btnAI.textContent = App.isSmallScreen?.() ? '解释' : 'AI解读';
        btnAI.addEventListener('click', () => Selection.askAI(Selection._selectedText));
        const btnQ = document.createElement('button');
        btnQ.textContent = '提问';
        btnQ.addEventListener('click', () => Selection.askCustom(Selection._selectedText));
        const btnNote = document.createElement('button');
        btnNote.textContent = '笔记';
        btnNote.addEventListener('click', () => Selection.saveNote(Selection._selectedText));
        this.popup.appendChild(btnAI);
        this.popup.appendChild(btnQ);
        if (App.isSmallScreen?.()) this.popup.appendChild(btnNote);
        this.popup.style.left = '0px';
        this.popup.style.top = '0px';
        document.body.appendChild(this.popup);
        this.positionPopup(x, y);
    },

    positionPopup(x, y) {
        if (!this.popup) return;
        const margin = 8;
        const rect = this.popup.getBoundingClientRect();
        const readerView = document.getElementById('reader-view');
        const bottomInset = readerView
            ? parseFloat(getComputedStyle(readerView).getPropertyValue('--reader-bottom-inset')) || 0
            : 0;
        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - bottomInset - rect.height - margin);
        let left = x - rect.width / 2;
        let top = y - rect.height - 12;
        if (top < margin) top = y + 12;
        left = Math.max(margin, Math.min(left, maxLeft));
        top = Math.max(margin, Math.min(top, maxTop));
        this.popup.style.left = Math.round(left) + 'px';
        this.popup.style.top = Math.round(top) + 'px';
    },

    removePopup() {
        clearTimeout(this._selectionTimer);
        if (this.popup) { this.popup.remove(); this.popup = null; }
    },

    async askAI(text) {
        this.removePopup();
        if (!App.ensureAIConfigured()) return;
        const rp = document.getElementById('right-panel');
        if (App.isSmallScreen?.()) App.openMobileDrawer('chat');
        else if (rp.classList.contains('collapsed')) App.toggleRightPanel();
        App.switchTab('chat');
        await Chat.runAssistantFlow(
            `请解读："${text}"`,
            (onChunk) => AIReader.askAboutSelection(text, '请详细解读这段内容', onChunk),
            {
                errorPrefix: '解读失败',
                historyUser: `请解读："${text}"`,
                speak: true
            }
        );
    },

    askCustom(text) {
        this.removePopup();
        const rp = document.getElementById('right-panel');
        if (App.isSmallScreen?.()) App.openMobileDrawer('chat');
        else if (rp.classList.contains('collapsed')) App.toggleRightPanel();
        App.switchTab('chat');
        const input = document.getElementById('chat-input');
        if (input) {
            input.value = `关于"${text}"，`;
            input.focus();
        }
    },

    saveNote(text) {
        this.removePopup();
        if (!Reader.book) return;
        Notes.add(Reader.book.id, Reader.currentPage, text.slice(0, 50), text);
        this.showSavedHint();
    },

    showSavedHint() {
        const el = document.createElement('div');
        el.className = 'selection-saved-hint';
        el.textContent = '已加入笔记';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1400);
    }
};
