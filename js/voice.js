/* ===== 语音互动模块 ===== */
const Voice = {
    recognition: null,
    isListening: false,
    lastError: '',
    localRunId: 0,

    init() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (this.canUseAndroidNativeRecognition()) {
            this.updateBtn();
            return;
        }
        if (this.canUseDesktopLocalRecognition()) {
            this.updateBtn();
            return;
        }
        if (!SR) {
            this.updateBtn();
            return;
        }
        this.recognition = new SR();
        this.recognition.lang = 'zh-CN';
        this.recognition.continuous = false;
        this.recognition.interimResults = false;

        this.recognition.onresult = (e) => {
            const text = e.results[0][0].transcript;
            this.isListening = false;
            this.lastError = '';
            this.updateBtn();
            const input = document.getElementById('chat-input');
            if (input) {
                input.value = text;
                input.focus();
                Chat.updateInputState?.();
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.updateBtn();
        };

        this.recognition.onerror = (event) => {
            this.isListening = false;
            this.lastError = event?.error || 'unknown';
            this.updateBtn();
            alert(this.getRecognitionErrorMessage(this.lastError));
        };
    },

    toggle() {
        if (this.canUseAndroidNativeRecognition()) {
            if (this.isListening) {
                this.cancelAndroidNativeRecognition();
            } else {
                this.startAndroidNativeRecognition();
            }
            return;
        }
        if (this.canUseDesktopLocalRecognition()) {
            if (this.isListening) {
                this.cancelLocalRecognition();
            } else {
                this.startLocalRecognition();
            }
            return;
        }
        if (!this.recognition) {
            alert(this.getUnsupportedMessage());
            return;
        }
        if (this.isListening) {
            this.recognition.stop();
        } else {
            try {
                this.lastError = '';
                this.recognition.start();
                this.isListening = true;
            } catch (error) {
                this.isListening = false;
                this.lastError = error?.message || 'start-failed';
                alert('语音输入启动失败，请稍后重试。');
            }
        }
        this.updateBtn();
    },

    canUseDesktopLocalRecognition() {
        return window.SmartReadDesktop?.platform === 'win32' &&
            typeof window.SmartReadDesktop.recognizeSpeech === 'function';
    },

    canUseAndroidNativeRecognition() {
        return !!(window.SmartReadNativeBackend?.enabled && window.SmartReadAPI?.recognizeSpeech);
    },

    async startAndroidNativeRecognition() {
        const runId = ++this.localRunId;
        this.isListening = true;
        this.lastError = '';
        this.updateBtn();
        try {
            const result = await SmartReadAPI.recognizeSpeech({ lang: 'zh-CN' });
            if (runId !== this.localRunId) return;
            this.isListening = false;
            const text = String(result?.text || '').trim();
            if (!text) {
                this.lastError = 'no-speech';
                this.updateBtn();
                alert(this.getRecognitionErrorMessage('no-speech'));
                return;
            }
            this.applyRecognizedText(text);
            this.updateBtn();
        } catch (error) {
            if (runId !== this.localRunId) return;
            this.isListening = false;
            this.lastError = error?.message || 'native-failed';
            this.updateBtn();
            alert(this.lastError);
        }
    },

    cancelAndroidNativeRecognition() {
        this.localRunId++;
        this.isListening = false;
        this.updateBtn();
    },

    async startLocalRecognition() {
        const runId = ++this.localRunId;
        this.isListening = true;
        this.lastError = '';
        this.updateBtn();
        try {
            const result = await window.SmartReadDesktop.recognizeSpeech({ lang: 'zh-CN' });
            if (runId !== this.localRunId) return;
            this.isListening = false;
            if (!result?.ok) {
                this.lastError = result?.code || 'local-failed';
                this.updateBtn();
                alert(this.getLocalRecognitionErrorMessage(result));
                return;
            }
            const text = String(result.text || '').trim();
            if (!text) {
                this.lastError = 'no-speech';
                this.updateBtn();
                alert(this.getLocalRecognitionErrorMessage({ code: 'no-speech' }));
                return;
            }
            this.lastError = '';
            this.applyRecognizedText(text);
            this.updateBtn();
        } catch (error) {
            if (runId !== this.localRunId) return;
            this.isListening = false;
            this.lastError = 'local-failed';
            this.updateBtn();
            alert(error?.message || '本地语音输入失败。');
        }
    },

    cancelLocalRecognition() {
        this.localRunId++;
        this.isListening = false;
        this.updateBtn();
        window.SmartReadDesktop?.cancelSpeechRecognition?.();
    },

    applyRecognizedText(text) {
        const input = document.getElementById('chat-input');
        if (input) {
            input.value = text;
            input.focus();
            Chat.updateInputState?.();
        }
    },

    getUnsupportedMessage() {
        if (window.SmartReadDesktop) {
            return '当前桌面环境没有可用的本地语音识别接口。';
        }
        if (window.SmartReadNativeBackend?.enabled) {
            return '当前 Android 系统没有可用的语音识别服务。';
        }
        if (!window.isSecureContext) {
            return '语音输入需要 HTTPS 或 localhost 安全上下文。';
        }
        return '当前浏览器不支持语音识别，请使用 Chrome、Edge 或支持 Web Speech 的环境。';
    },

    getRecognitionErrorMessage(error) {
        const messages = {
            'not-allowed': '麦克风权限被拒绝，请在系统或浏览器权限里允许 SmartRead 使用麦克风。',
            'service-not-allowed': '系统或浏览器禁止了语音识别服务。',
            'audio-capture': '没有检测到可用麦克风，请检查输入设备。',
            'network': '语音识别服务连接失败，请检查网络后重试。',
            'no-speech': '没有识别到语音，请靠近麦克风后重试。',
            'aborted': '语音输入已取消。'
        };
        return messages[error] || `语音输入失败：${error || 'unknown'}`;
    },

    getLocalRecognitionErrorMessage(result = {}) {
        const code = result.code || result.error || 'local-failed';
        if (code === 'missing-recognizer') {
            const installed = Array.isArray(result.installed) && result.installed.length
                ? `\n当前已安装：${result.installed.join('、')}`
                : '';
            return `Windows 没有安装中文本地语音识别器。请在系统语言设置里安装中文语音/语音识别组件后重试。${installed}`;
        }
        const messages = {
            'unauthorized': '本地语音输入只允许 SmartRead 页面调用。',
            'unsupported-platform': '本地语音输入当前只支持 Windows 桌面版。',
            'audio-capture': '没有检测到可用麦克风，请检查 Windows 输入设备和麦克风权限。',
            'no-speech': '没有识别到语音，请靠近麦克风后重试。',
            'timeout': '本地语音识别超时，请重试。',
            'local-failed': '本地语音识别启动失败。'
        };
        return messages[code] || result.error || `本地语音输入失败：${code}`;
    },

    updateBtn() {
        const btn = document.getElementById('btn-voice');
        if (!btn) return;
        const androidSupported = this.canUseAndroidNativeRecognition();
        const localSupported = this.canUseDesktopLocalRecognition();
        const supported = androidSupported || localSupported || !!this.recognition;
        const disabled = !supported || Chat.isSending;
        btn.disabled = disabled;
        btn.classList.toggle('is-listening', this.isListening);
        btn.classList.toggle('is-unsupported', !supported);
        btn.title = !supported
            ? this.getUnsupportedMessage()
            : this.lastError
            ? (localSupported
                ? this.getLocalRecognitionErrorMessage({ code: this.lastError })
                : this.getRecognitionErrorMessage(this.lastError))
            : (this.isListening ? '停止语音输入' : (androidSupported ? 'Android 本机语音输入' : (localSupported ? '本地语音输入' : '语音输入')));
        btn.setAttribute('aria-label', btn.title);
    },

    cleanForSpeech(text) {
        // 清理 markdown / HTML 标记
        return String(text || '')
            .replace(/<[^>]*>/g, '')     // HTML 标签
            .replace(/```[\s\S]*?```/g, '') // 代码块
            .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '') // Markdown 表格分隔行
            .replace(/\|/g, ' ')       // 表格列分隔符
            .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // 粗体/斜体
            .replace(/#{1,6}\s?/g, '')   // 标题标记
            .replace(/^\s*>\s?/gm, '')   // 引用标记
            .replace(/[-*]\s/g, '')      // 列表标记
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
            .replace(/`([^`]+)`/g, '$1') // 行内代码
            .replace(/\n{2,}/g, '。')    // 多换行变停顿
            .replace(/\n/g, '，')        // 单换行变逗号
            .trim();
    },

    // AI 回答后用 TTS 朗读
    speakResponse(text, options = {}) {
        const clean = this.cleanForSpeech(text);
        if (clean) TTS.speak(clean, options);
    }
};
