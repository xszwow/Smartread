/* ===== SmartRead same-origin API client ===== */
const SmartReadAPIBase = (() => {
    const nativeBase = window.SmartReadNativeConfig?.apiBaseUrl || '';
    const metaBase = document.querySelector('meta[name="smartread-api-base"]')?.content || '';
    return String(nativeBase || metaBase || '').replace(/\/$/, '');
})();

const SmartReadAPI = {
    async request(path, options = {}) {
        const url = path.startsWith('http') ? path : SmartReadAPIBase + path;
        const headers = { ...(options.headers || {}) };
        let body = options.body;
        if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }
        const resp = await fetch(url, {
            ...options,
            headers,
            body,
            credentials: 'include'
        });
        const text = await resp.text();
        const data = text ? JSON.parse(text) : null;
        if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
        return data;
    },

    me() {
        return this.request('/api/auth/me');
    },

    config() {
        return this.request('/api/auth/config');
    },

    login(email, password) {
        return this.request('/api/auth/login', {
            method: 'POST',
            body: { email, password }
        });
    },

    requestEmailCode(email) {
        return this.request('/api/auth/email/request', {
            method: 'POST',
            body: { email }
        });
    },

    verifyEmailCode(email, code) {
        return this.request('/api/auth/email/verify', {
            method: 'POST',
            body: { email, code }
        });
    },

    logout() {
        return this.request('/api/auth/logout', { method: 'POST' });
    },

    aiConfigStatus() {
        return this.request('/api/ai/config/status');
    },

    saveAIConfig(payload) {
        return this.request('/api/ai/config', {
            method: 'PUT',
            body: payload
        });
    },

    aiChat(payload) {
        return this.request('/api/ai/chat', {
            method: 'POST',
            body: payload
        });
    },

    bindZlib(payload) {
        return this.request('/api/book-sources/zlib/bind', {
            method: 'POST',
            body: payload
        });
    },

    unbindZlib() {
        return this.request('/api/book-sources/zlib/unbind', { method: 'POST' });
    },

    searchZlib({ q, page = 1, format = '' }) {
        const params = new URLSearchParams({ q, page: String(page) });
        if (format) params.set('format', format);
        return this.request('/api/zlib/search?' + params.toString());
    },

    startZlibDownload(payload) {
        return this.request('/api/zlib/download', {
            method: 'POST',
            body: payload
        });
    },

    downloadJob(jobId) {
        return this.request('/api/downloads/' + encodeURIComponent(jobId));
    },

    serverBooks() {
        return this.request('/api/books');
    },

    updateBookProgress(bookId, payload) {
        return this.request('/api/books/' + encodeURIComponent(bookId) + '/progress', {
            method: 'PATCH',
            body: payload
        });
    },

    deleteServerBook(bookId) {
        return this.request('/api/books/' + encodeURIComponent(bookId), {
            method: 'DELETE'
        });
    },

    fetchBookFile(bookId) {
        return fetch(SmartReadAPIBase + '/api/books/' + encodeURIComponent(bookId) + '/file', {
            credentials: 'include'
        });
    }
};

window.SmartReadAPI = SmartReadAPI;
