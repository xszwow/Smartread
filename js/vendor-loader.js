/* ===== Third-party asset loader ===== */
const SmartReadVendor = {
    inflight: new Map(),
    timeoutMs: 18000,
    sources: {
        jszip: {
            global: 'JSZip',
            urls: ['js/vendor/jszip.min.js']
        },
        pdfjs: {
            global: 'pdfjsLib',
            urls: ['js/vendor/pdf.min.js'],
            workerSrc: 'js/vendor/pdf.worker.min.js'
        },
        epub: {
            global: 'ePub',
            urls: ['js/vendor/epub.min.js']
        },
        marked: {
            global: 'marked',
            urls: ['js/vendor/marked.umd.js']
        }
    },

    async ensure(name) {
        const config = this.sources[name];
        if (!config) throw new Error(`未知资源：${name}`);
        if (window[config.global]) return window[config.global];
        if (!this.inflight.has(name)) {
            this.inflight.set(name, this.loadFromSources(config).finally(() => {
                this.inflight.delete(name);
            }));
        }
        return this.inflight.get(name);
    },

    async ensureJSZip() {
        return this.ensure('jszip');
    },

    async ensureEpub() {
        await this.ensureJSZip();
        return this.ensure('epub');
    },

    async ensurePdfJs() {
        const pdfjs = await this.ensure('pdfjs');
        const workerSrc = this.sources.pdfjs.workerSrc;
        if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        }
        return pdfjs;
    },

    async ensureMarked() {
        return this.ensure('marked');
    },

    async loadFromSources(config) {
        let lastError = null;
        for (const url of config.urls) {
            try {
                await this.injectScript(url, config.global);
                if (window[config.global]) return window[config.global];
                lastError = new Error(`资源已加载但未注册：${config.global}`);
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(`资源加载失败：${lastError?.message || config.global}`);
    },

    injectScript(url, globalName) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-smartread-vendor="${globalName}"]`);
            if (existing) {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => reject(new Error(url)), { once: true });
                return;
            }

            const script = document.createElement('script');
            const timer = window.setTimeout(() => {
                script.remove();
                reject(new Error(`加载超时：${url}`));
            }, this.timeoutMs);
            script.src = url;
            script.async = true;
            script.dataset.smartreadVendor = globalName;
            script.onload = () => {
                window.clearTimeout(timer);
                resolve();
            };
            script.onerror = () => {
                window.clearTimeout(timer);
                script.remove();
                reject(new Error(url));
            };
            document.head.appendChild(script);
        });
    }
};

window.SmartReadVendor = SmartReadVendor;
