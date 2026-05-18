/* ===== 聊天互动模块 ===== */
const Chat = {
    messages: [],   // 对话历史
    isSending: false,
    requestId: 0,
    speechSeq: 0,
    inputControlsBound: false,

    // 发送消息
    async send(userMsg) {
        const text = String(userMsg ?? '').trim();
        if (!text || this.isSending) return false;

        return this.runAssistantFlow(text, async (onChunk) => {
            const messages = await this.buildRequestMessages(text);
            return AIService.chat(messages, onChunk);
        }, {
            errorPrefix: '发送失败',
            historyUser: text,
            speak: false
        });
    },

    async runAssistantFlow(userText, runner, options = {}) {
        const text = String(userText ?? '').trim();
        if (!text || this.isSending) {
            this.focusInput();
            return false;
        }

        const currentRequest = ++this.requestId;
        let assistantBubble = null;
        let fullReply = '';

        this.hideWelcome();
        this.setBusy(true);
        this.renderMessage('user', text);
        this.setInput('');
        this.showTyping();

        const applyChunk = (chunk, total) => {
            if (!this.isCurrentRequest(currentRequest)) return;
            fullReply = String(total ?? (fullReply + (chunk ?? '')));
            if (!assistantBubble) {
                assistantBubble = this.createAssistantBubble();
                this.hideTyping();
            }
            this.updateAssistantBubble(assistantBubble, fullReply);
        };

        try {
            const result = await runner(applyChunk);
            if (!this.isCurrentRequest(currentRequest)) return null;

            if (!fullReply && typeof result === 'string') fullReply = result;
            fullReply = String(fullReply || '').trim();
            if (!fullReply) throw new Error('AI 没有返回内容');

            if (!assistantBubble) assistantBubble = this.createAssistantBubble();
            this.hideTyping();
            this.finalizeAssistantBubble(assistantBubble, fullReply);

            this.messages.push({ role: 'user', content: options.historyUser || text });
            this.messages.push({ role: 'assistant', content: fullReply });

            if (options.speak === true) this.speakAssistantBubble(assistantBubble, fullReply);
            return fullReply;
        } catch (err) {
            if (!this.isCurrentRequest(currentRequest)) return null;
            this.hideTyping();
            if (assistantBubble && !assistantBubble.textContent.trim()) {
                assistantBubble.closest('.chat-msg')?.remove();
            }
            this.renderMessage('error', `${options.errorPrefix || '请求失败'}: ${this.getErrorMessage(err)}`);
            return null;
        } finally {
            if (this.isCurrentRequest(currentRequest)) this.setBusy(false);
        }
    },

    async buildRequestMessages(userMsg) {
        let pageText = '';
        let images = [];
        let readingContext = '';

        try {
            pageText = Reader.getCurrentText() || '';
        } catch { }

        try {
            readingContext = await Reader.getCurrentReadingContext(pageText);
        } catch { }

        try {
            images = await Reader.getPageImages();
        } catch { }

        const imageNote = images.length > 0
            ? '\n当前页面图片已随本次用户消息附上。回答必须基于图片中实际可见的文字和画面，不要编造看不见的细节，不要写舞台动作。'
            : '\n本次没有成功提取到当前页面图片；如果问题依赖图片内容，请说明无法可靠看图。';

        const sysMessages = [
            { role: 'system', content: AIReader.getSystemPrompt('zh-CN') },
            {
                role: 'system',
                content: (readingContext || '当前阅读位置：未能获取。') +
                    '\n请把用户的问题理解为围绕这本书、这个章节和这一页展开；当用户说“这章”“这一页”“这里”时，优先指代上述位置。' +
                    imageNote
            },
            {
                role: 'system',
                content: pageText
                    ? '用户当前正在阅读的内容文本：\n' + pageText
                    : '当前页面没有提取到可用文本，请根据用户问题直接回答。'
            }
        ];

        const currentUserMsg = images.length > 0
            ? {
                role: 'user',
                content: [
                    { type: 'text', text: userMsg },
                    ...images.map(b64 => ({
                        type: 'image_url',
                        image_url: { url: b64, detail: 'high' }
                    }))
                ]
            }
            : { role: 'user', content: userMsg };

        // 历史记录保持纯文本，当前消息才带图片，节省上下文并兼容更多模型。
        return [...sysMessages, ...this.messages, currentUserMsg];
    },

    renderMessage(role, text) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'chat-msg chat-' + role;
        if (role === 'user') {
            div.innerHTML = `<div class="chat-bubble user-bubble">${escapeHTML(text)}</div>`;
        } else if (role === 'error') {
            div.innerHTML = `<div class="chat-ai-avatar">✦</div><div class="chat-bubble ai-bubble">${escapeHTML(text)}</div>`;
        } else {
            div.className = 'chat-msg chat-assistant';
            div.dataset.speechId = this.nextSpeechId();
            div.dataset.speechText = text;
            div.innerHTML = this.getAssistantInnerHTML(text, false);
        }
        container.appendChild(div);
        if (role === 'assistant') this.updateVoiceControls();
        this.scrollToBottom();
        return div;
    },

    createAssistantBubble() {
        const container = document.getElementById('chat-messages');
        if (!container) return null;
        const div = document.getElementById('chat-typing-row') || document.createElement('div');
        div.className = 'chat-msg chat-assistant is-streaming';
        div.removeAttribute('id');
        div.dataset.speechId = this.nextSpeechId();
        div.dataset.speechText = '';
        div.innerHTML = this.getAssistantInnerHTML('', true);
        if (!div.parentNode) container.appendChild(div);
        return div.querySelector('.ai-bubble');
    },

    updateAssistantBubble(bubble, text) {
        if (!bubble) return;
        const row = bubble.closest('.chat-msg');
        bubble.innerHTML = this.formatMarkdown(text);
        if (row) {
            row.dataset.speechText = text;
            const btn = row.querySelector('.chat-voice-btn');
            if (btn) btn.disabled = row.classList.contains('is-streaming') || !String(text || '').trim();
        }
        this.updateVoiceControls();
        this.scrollToBottom();
    },

    finalizeAssistantBubble(bubble, text) {
        const row = bubble?.closest('.chat-msg');
        if (row) row.classList.remove('is-streaming');
        this.updateAssistantBubble(bubble, text);
    },

    getAssistantInnerHTML(text, disabled) {
        return `
            <div class="chat-ai-line">
                <div class="chat-ai-avatar">✦</div>
                ${this.getVoiceButtonHTML(disabled || !String(text || '').trim())}
            </div>
            <div class="chat-bubble ai-bubble">${this.formatMarkdown(text)}</div>`;
    },

    getVoiceButtonHTML(disabled) {
        return `<button class="chat-voice-btn" onclick="Chat.toggleMessageSpeech(this)" title="朗读回复" aria-label="朗读回复"${disabled ? ' disabled' : ''}>
            ${this.getVoiceIcon('play')}
        </button>`;
    },

    getVoiceIcon(state) {
        if (state === 'pause') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1.2"></rect><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"></rect></svg>';
        }
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8v12.4c0 .9 1 1.4 1.8.9l9.2-6.2a1.1 1.1 0 0 0 0-1.8L9.8 4.9C9 4.4 8 4.9 8 5.8z"></path></svg>';
    },

    nextSpeechId() {
        this.speechSeq += 1;
        return 'chat-' + this.speechSeq;
    },

    toggleMessageSpeech(btn) {
        if (!TTS.isSupported()) {
            alert('当前浏览器不支持朗读功能');
            return;
        }
        const row = btn?.closest('.chat-msg');
        const bubble = row?.querySelector('.ai-bubble');
        const speechId = row?.dataset.speechId;
        const text = row?.dataset.speechText || bubble?.innerText || '';
        const clean = Voice.cleanForSpeech(text);
        if (!row || !bubble || !speechId || !clean) return;

        const isSameMessage = TTS.source === 'chat' && TTS.sourceId === speechId;
        if (isSameMessage && (TTS.speaking || TTS.paused)) {
            if (TTS.paused) TTS.resume();
            else TTS.pause();
            return;
        }

        TTS.speak(clean, { source: 'chat', sourceId: speechId, root: bubble });
    },

    speakAssistantBubble(bubble, text) {
        const row = bubble?.closest('.chat-msg');
        const speechId = row?.dataset.speechId;
        if (!bubble || !speechId) return;
        Voice.speakResponse(text, { source: 'chat', sourceId: speechId, root: bubble });
    },

    updateVoiceControls(detail = null) {
        const state = detail || {
            supported: TTS.isSupported(),
            source: TTS.source,
            sourceId: TTS.sourceId,
            speaking: TTS.speaking,
            paused: TTS.paused,
            completed: TTS.completed
        };

        document.querySelectorAll('.chat-voice-btn').forEach(btn => {
            const row = btn.closest('.chat-msg');
            const speechId = row?.dataset.speechId;
            const hasText = !!String(row?.dataset.speechText || '').trim();
            const isStreaming = row?.classList.contains('is-streaming');
            const isSupported = state.supported !== false;
            const isSame = state.source === 'chat' && state.sourceId === speechId;
            const isActive = isSame && (state.speaking || state.paused);
            const iconState = isActive && !state.paused ? 'pause' : 'play';

            btn.disabled = !isSupported || isStreaming || !hasText;
            btn.classList.toggle('is-active', isActive && !state.paused);
            btn.classList.toggle('is-paused', isActive && state.paused);
            btn.innerHTML = this.getVoiceIcon(iconState);
            btn.title = !isSupported
                ? '当前浏览器不支持朗读'
                : isActive
                ? (state.paused ? '继续朗读' : '暂停朗读')
                : (isSame && state.completed ? '重新朗读' : '朗读回复');
            btn.setAttribute('aria-label', btn.title);
        });
    },

    showTyping() {
        const container = document.getElementById('chat-messages');
        if (!container || document.getElementById('chat-typing-row')) return;

        const div = document.createElement('div');
        div.id = 'chat-typing-row';
        div.className = 'chat-msg chat-assistant chat-typing-row is-streaming';
        div.innerHTML = `
            <div class="chat-ai-line">
                <div class="chat-ai-avatar">✦</div>
                <div class="chat-inline-dots" aria-label="正在回复">
                    <span></span><span></span><span></span>
                </div>
            </div>`;
        container.appendChild(div);
        this.scrollToBottom();
    },

    hideTyping() {
        document.getElementById('chat-typing-row')?.remove();
        const legacy = document.getElementById('chat-typing');
        if (legacy) legacy.classList.add('hidden');
    },

    formatMarkdown(text) {
        return renderMarkdownSafe(text);
    },

    scrollToBottom() {
        const el = document.getElementById('chat-messages');
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    },

    setInput(val) {
        const el = document.getElementById('chat-input');
        if (el) el.value = val;
        this.updateInputState();
    },

    focusInput() {
        const el = document.getElementById('chat-input');
        if (el && !el.disabled) el.focus();
    },

    hideWelcome() {
        document.getElementById('chat-welcome')?.remove();
    },

    setBusy(isBusy) {
        this.isSending = isBusy;
        const input = document.getElementById('chat-input');
        const wrap = document.querySelector('.chat-input-wrap');
        const sendBtn = document.querySelector('.chat-send-btn');
        const suggestionBtns = document.querySelectorAll('.chat-suggestion-btn');

        if (input) input.disabled = isBusy;
        if (wrap) {
            wrap.classList.toggle('is-busy', isBusy);
            wrap.setAttribute('aria-busy', String(isBusy));
        }
        if (sendBtn) {
            sendBtn.disabled = isBusy;
            sendBtn.classList.toggle('is-loading', isBusy);
        }
        suggestionBtns.forEach(btn => { btn.disabled = isBusy; });

        if (typeof Voice !== 'undefined') Voice.updateBtn();
        this.updateInputState();
    },

    bindInputControls() {
        if (this.inputControlsBound) return;
        const input = document.getElementById('chat-input');
        const wrap = document.querySelector('.chat-input-wrap');
        if (!input || !wrap) return;
        this.inputControlsBound = true;

        wrap.addEventListener('pointerdown', (event) => {
            if (input.disabled) return;
            if (event.target.closest('button')) return;
            input.focus({ preventScroll: true });
        });
        wrap.addEventListener('click', (event) => {
            if (input.disabled) return;
            if (event.target.closest('button')) return;
            input.focus({ preventScroll: true });
        });
        input.addEventListener('focus', () => this.updateInputState());
        input.addEventListener('blur', () => this.updateInputState());
        input.addEventListener('input', () => this.updateInputState());
        this.updateInputState();
    },

    updateInputState() {
        const input = document.getElementById('chat-input');
        const wrap = document.querySelector('.chat-input-wrap');
        const sendBtn = document.getElementById('btn-chat-send');
        if (!input || !wrap) return;
        const hasText = !!input.value.trim();
        const focused = document.activeElement === input;
        wrap.classList.toggle('is-focused', focused);
        wrap.classList.toggle('has-input', hasText);
        if (sendBtn) sendBtn.disabled = this.isSending || !hasText;
    },

    isCurrentRequest(id) {
        return id === this.requestId;
    },

    getErrorMessage(err) {
        return err?.message || String(err || '未知错误');
    },

    getWelcomeHTML() {
        return `
            <div id="chat-welcome" class="chat-welcome">
                <div class="chat-welcome-icon">✦</div>
                <h3>智读 AI</h3>
                <p>关于当前阅读内容，你可以问我任何问题</p>
                <div class="chat-suggestions">
                    <button class="chat-suggestion-btn" onclick="App.sendChatText('帮我总结这一页的要点')">📝 帮我总结这一页的要点</button>
                    <button class="chat-suggestion-btn" onclick="App.sendChatText('用简单的话解释一下')">💡 用简单的话解释一下</button>
                    <button class="chat-suggestion-btn" onclick="App.sendChatText('这段内容有什么深层含义？')">🔍 这段内容有什么深层含义？</button>
                </div>
            </div>`;
    },

    reset() {
        this.requestId++;
        this.messages = [];
        if (TTS.source === 'chat') TTS.stop();
        this.setBusy(false);
        this.hideTyping();
        this.setInput('');
        const el = document.getElementById('chat-messages');
        if (el) el.innerHTML = this.getWelcomeHTML();
    }
};

document.addEventListener('tts-state-change', (e) => Chat.updateVoiceControls(e.detail));
