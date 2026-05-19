/* ===== Android native backend bridge: zlib / AI / shelf live inside the APK ===== */
(function () {
    const config = window.SmartReadNativeConfig || {};
    const isNative = !!window.Capacitor?.isNativePlatform?.();
    const plugin = window.Capacitor?.Plugins?.SmartReadBackend;
    if (!isNative || !config.nativeBackend || !plugin) return;

    document.documentElement.classList.add('native-backend-runtime');
    window.SmartReadNativeBackend = { enabled: true };

    async function call(method, payload = {}) {
        if (typeof plugin[method] !== 'function') {
            throw new Error(`Android native backend missing method: ${method}`);
        }
        return plugin[method](payload);
    }

    const baseAPI = window.SmartReadAPI || {};
    window.SmartReadAPI = {
        ...baseAPI,
        deploymentMode: 'android-native-backend',
        config: () => call('config'),
        me: () => call('me'),
        login: (email, password) => call('login', { email, password }),
        requestEmailCode: (email) => call('requestEmailCode', { email }),
        verifyEmailCode: (email, code) => call('verifyEmailCode', { email, code }),
        logout: () => call('logout'),
        aiConfigStatus: () => call('aiConfigStatus'),
        saveAIConfig: (payload) => call('saveAIConfig', payload),
        aiChat: (payload) => call('aiChat', payload),
        ttsStatus: () => call('ttsStatus'),
        ttsSpeak: (payload) => call('ttsSpeak', payload),
        ttsStop: () => call('ttsStop'),
        recognizeSpeech: (payload = {}) => call('recognizeSpeech', payload),
        bindZlib: (payload) => call('bindZlib', payload),
        unbindZlib: () => call('unbindZlib'),
        searchZlib: ({ q, page = 1, format = '' }) => call('searchZlib', { q, page, format }),
        startZlibDownload: (payload) => call('startZlibDownload', payload),
        downloadJob: (jobId) => call('downloadJob', { jobId }),
        serverBooks: () => call('serverBooks'),
        updateBookProgress: (bookId, payload) => call('updateBookProgress', { bookId, ...payload }),
        deleteServerBook: (bookId) => call('deleteServerBook', { bookId }),
        async fetchBookFile(bookId) {
            const file = await call('fetchBookFile', { bookId });
            let body;
            if (file.filePath && window.Capacitor?.convertFileSrc) {
                const localPath = String(file.filePath).startsWith('file://')
                    ? file.filePath
                    : `file://${file.filePath}`;
                const localResp = await fetch(window.Capacitor.convertFileSrc(localPath));
                if (!localResp.ok) throw new Error('读取本机书籍文件失败');
                body = await localResp.blob();
            } else {
                body = Uint8Array.from(atob(file.base64 || ''), char => char.charCodeAt(0));
            }
            return new Response(body, {
                status: 200,
                headers: {
                    'content-type': file.mimeType || 'application/octet-stream',
                    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName || `${bookId}.bin`)}`
                }
            });
        }
    };
    SmartReadAPI = window.SmartReadAPI;
})();
