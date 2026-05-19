/* ===== Native standalone runtime: no SmartRead server required ===== */
(function () {
    const nativeConfig = window.SmartReadNativeConfig || {};
    const enabled = nativeConfig.appMode === 'mobile' && nativeConfig.standalone !== false;
    if (!enabled) return;
    document.documentElement.classList.add('native-standalone-runtime');

    const AI_KEY = 'smartread.native.aiConfig';
    const localUser = {
        id: 'local-device',
        email: 'local-device@smartread.local',
        displayName: '本机书架'
    };

    function nativeBackend() {
        return window.Capacitor?.Plugins?.SmartReadBackend || null;
    }

    function hasNativeBackend() {
        return !!nativeBackend();
    }

    async function callNative(method, payload = {}) {
        const plugin = nativeBackend();
        if (!plugin || typeof plugin[method] !== 'function') {
            throw new Error('当前运行环境没有可用的 Android 原生书源。');
        }
        return plugin[method](payload);
    }

    function readAIConfig() {
        try {
            const parsed = JSON.parse(localStorage.getItem(AI_KEY) || '{}');
            return {
                configured: Boolean(parsed.apiKey),
                baseURL: parsed.baseURL || 'https://api.openai.com/v1/chat/completions',
                model: parsed.model || 'gpt-5.5',
                keyPreview: maskApiKey(parsed.apiKey || ''),
                apiKey: parsed.apiKey || ''
            };
        } catch {
            return {
                configured: false,
                baseURL: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-5.5',
                keyPreview: '',
                apiKey: ''
            };
        }
    }

    function saveAIConfig(payload = {}) {
        const existing = readAIConfig();
        const apiKey = String(payload.apiKey || '').trim() || existing.apiKey || '';
        const baseURL = String(payload.baseURL || existing.baseURL || '').trim();
        const model = String(payload.model || existing.model || '').trim();
        if (!baseURL || !/^https?:\/\//i.test(baseURL)) {
            throw new Error('API Base URL 必须是 http/https 地址');
        }
        if (!model) throw new Error('请输入模型名称');
        if (!apiKey) throw new Error('请输入 API Key');
        const next = { apiKey, baseURL, model };
        localStorage.setItem(AI_KEY, JSON.stringify(next));
        const status = readAIConfig();
        return {
            configured: true,
            baseURL: status.baseURL,
            model: status.model,
            keyPreview: status.keyPreview
        };
    }

    function maskApiKey(apiKey) {
        if (!apiKey) return '';
        if (apiKey.length <= 10) return `${apiKey.slice(0, 2)}...${apiKey.slice(-2)}`;
        return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
    }

    window.SmartReadNativeStandalone = {
        enabled: true,
        user: localUser,
        readAIConfig,
        saveAIConfig,
        hasNativeBackend,
        onlineHome: 'https://z-library.sk/'
    };

    const baseAPI = window.SmartReadAPI || {};
    window.SmartReadAPI = {
        ...baseAPI,
        async config() {
            const ai = readAIConfig();
            const backendConfig = hasNativeBackend()
                ? await callNative('config').catch(() => ({}))
                : {};
            return {
                ...backendConfig,
                deploymentMode: 'native-standalone',
                zlibRegisterUrl: backendConfig.zlibRegisterUrl || 'https://z-library.sk/',
                aiDefaults: {
                    baseURL: ai.baseURL,
                    model: ai.model
                }
            };
        },
        async me() {
            const ai = readAIConfig();
            const backendMe = hasNativeBackend()
                ? await callNative('me').catch(() => ({}))
                : {};
            return {
                user: localUser,
                aiConfigured: ai.configured,
                zlibBound: !!backendMe.zlibBound,
                nativeStandalone: true
            };
        },
        async logout() {
            return { ok: true };
        },
        async requestEmailCode() {
            throw new Error('手机单机版不需要邮箱验证码登录。');
        },
        async verifyEmailCode() {
            return this.me();
        },
        async aiConfigStatus() {
            const ai = readAIConfig();
            return {
                configured: ai.configured,
                baseURL: ai.baseURL,
                model: ai.model,
                keyPreview: ai.keyPreview
            };
        },
        async saveAIConfig(payload) {
            return saveAIConfig(payload);
        },
        async serverBooks() {
            return hasNativeBackend() ? callNative('serverBooks') : { books: [] };
        },
        async updateBookProgress(bookId, payload = {}) {
            return hasNativeBackend()
                ? callNative('updateBookProgress', { bookId, ...payload })
                : { ok: true };
        },
        async deleteServerBook(bookId) {
            return hasNativeBackend()
                ? callNative('deleteServerBook', { bookId })
                : { ok: true };
        },
        async fetchBookFile(bookId) {
            const file = await callNative('fetchBookFile', { bookId });
            const blob = base64ToBlob(file.base64 || '', file.mimeType || 'application/octet-stream');
            return new Response(blob, {
                status: 200,
                headers: { 'content-type': blob.type }
            });
        },
        async bindZlib(payload) {
            return callNative('bindZlib', payload);
        },
        async unbindZlib() {
            return hasNativeBackend() ? callNative('unbindZlib') : { ok: true };
        },
        async searchZlib(payload) {
            return callNative('searchZlib', payload);
        },
        async startZlibDownload(payload) {
            return callNative('startZlibDownload', payload);
        },
        async downloadJob(jobId) {
            return callNative('downloadJob', { jobId });
        }
    };
    SmartReadAPI = window.SmartReadAPI;

    function base64ToBlob(base64, mimeType) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mimeType });
    }
})();
