/* ===== Native standalone runtime: no SmartRead server required ===== */
(function () {
    const nativeConfig = window.SmartReadNativeConfig || {};
    const enabled = nativeConfig.appMode === 'mobile' && nativeConfig.standalone !== false;
    if (!enabled) return;

    const AI_KEY = 'smartread.native.aiConfig';
    const localUser = {
        id: 'local-device',
        email: 'local-device@smartread.local',
        displayName: '本机书架'
    };

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
        onlineHome: 'https://z-library.sk/'
    };

    const baseAPI = window.SmartReadAPI || {};
    window.SmartReadAPI = {
        ...baseAPI,
        async config() {
            const ai = readAIConfig();
            return {
                deploymentMode: 'native-standalone',
                zlibRegisterUrl: 'https://z-library.sk/',
                aiDefaults: {
                    baseURL: ai.baseURL,
                    model: ai.model
                }
            };
        },
        async me() {
            const ai = readAIConfig();
            return {
                user: localUser,
                aiConfigured: ai.configured,
                zlibBound: false,
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
            return { books: [] };
        },
        async updateBookProgress() {
            return { ok: true };
        },
        async deleteServerBook() {
            return { ok: true };
        },
        async fetchBookFile() {
            throw new Error('手机单机版没有 SmartRead 服务器书籍。');
        },
        async bindZlib() {
            throw new Error('手机单机版不绑定 SmartRead 服务器书源。请在网页书源下载后导入本地。');
        },
        async unbindZlib() {
            return { ok: true };
        },
        async searchZlib() {
            throw new Error('手机单机版不经过 SmartRead 服务器搜索。请打开网页书源，下载后导入本地。');
        },
        async startZlibDownload() {
            throw new Error('手机单机版不经过 SmartRead 服务器下载。请下载文件后导入本地。');
        },
        async downloadJob() {
            throw new Error('手机单机版没有服务器下载任务。');
        }
    };
})();
