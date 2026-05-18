/* ===== AI 配置模块：只保存服务端状态，不在浏览器存 API Key ===== */
const AIConfig = {
    defaults: {
        baseURL: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-5.5'
    },
    status: {
        configured: false,
        baseURL: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-5.5',
        keyPreview: ''
    },

    setDefaults(defaults = {}) {
        if (defaults.baseURL) this.defaults.baseURL = defaults.baseURL;
        if (defaults.model) this.defaults.model = defaults.model;
        this.status.baseURL = this.status.baseURL || this.defaults.baseURL;
        this.status.model = this.status.model || this.defaults.model;
    },

    load() {
        return {
            baseURL: this.status.baseURL || this.defaults.baseURL,
            apiKey: '',
            model: this.status.model || this.defaults.model,
            keyPreview: this.status.keyPreview || '',
            configured: !!this.status.configured
        };
    },

    async refresh() {
        if (!window.SmartReadAPI?.aiConfigStatus) return this.load();
        try {
            const status = await SmartReadAPI.aiConfigStatus();
            this.status = {
                configured: !!status.configured,
                baseURL: status.baseURL || this.defaults.baseURL,
                model: status.model || this.defaults.model,
                keyPreview: status.keyPreview || ''
            };
        } catch {
            this.status = {
                configured: false,
                baseURL: this.defaults.baseURL,
                model: this.defaults.model,
                keyPreview: ''
            };
        }
        return this.load();
    },

    async save(config) {
        const payload = {
            baseURL: normalizeUrlInput(config.baseURL || this.defaults.baseURL),
            apiKey: String(config.apiKey || '').trim(),
            model: String(config.model || this.defaults.model).trim()
        };
        const status = await SmartReadAPI.saveAIConfig(payload);
        this.status = {
            configured: !!status.configured,
            baseURL: status.baseURL || payload.baseURL,
            model: status.model || payload.model,
            keyPreview: status.keyPreview || ''
        };
        return this.load();
    },

    isConfigured() {
        return !!this.status.configured;
    }
};
