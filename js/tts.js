/* ===== TTS 朗读模块 ===== */
const TTS = {
    synth: window.speechSynthesis,
    speaking: false,
    voices: [],
    selectedVoice: null,
    sentences: [],
    currentSentence: 0,
    speed: 1.0,
    paused: false,
    completed: false,
    source: null,
    sourceId: null,
    rootOverride: null,
    currentUtterance: null,
    playbackToken: 0,
    watchdogTimer: null,
    sentenceStartedAt: 0,
    lastWatchdogRestartAt: 0,
    currentSpeechText: '',
    currentSentenceRetryCount: 0,
    retrySentenceIndex: -1,
    selectedVoiceKey: '',
    highlightCursor: 0,
    lastHighlightedSentenceIndex: -1,
    sentenceTargetsReady: false,
    sentenceTargets: [],
    sentenceTargetRoot: null,
    sentenceTargetClickHandler: null,

    init() {
        if (this.isNativeSpeech()) {
            this.loadVoices();
            this.updateUI();
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.checkPlaybackHealth(true);
            });
            return;
        }
        if (!this.isWebSpeechSupported()) {
            this.loadVoices();
            this.updateUI();
            return;
        }
        this.loadVoices();
        this.synth.onvoiceschanged = () => this.loadVoices();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.checkPlaybackHealth(true);
        });
    },

    isSupported() {
        return this.isNativeSpeech() || this.isWebSpeechSupported();
    },

    isWebSpeechSupported() {
        return !!(this.synth && typeof window.SpeechSynthesisUtterance === 'function');
    },

    isNativeSpeech() {
        return !!(window.SmartReadNativeBackend?.enabled && window.SmartReadAPI?.ttsSpeak);
    },

    loadVoices() {
        const select = document.getElementById('tts-voice');
        if (this.isNativeSpeech()) {
            this.voices = [];
            this.selectedVoice = null;
            if (select) {
                select.innerHTML = '<option>Android 本机朗读</option>';
                select.disabled = true;
            }
            return;
        }
        if (!this.isWebSpeechSupported()) {
            this.voices = [];
            this.selectedVoice = null;
            if (select) {
                select.innerHTML = '<option>当前浏览器不支持朗读</option>';
                select.disabled = true;
            }
            return;
        }

        const allVoices = this.synth.getVoices();
        const preferredVoices = allVoices.filter(v =>
            v.lang.startsWith('zh') || v.lang.startsWith('en')
        );
        this.voices = preferredVoices.length ? preferredVoices : allVoices;
        const previousKey = this.selectedVoiceKey || this.getVoiceKey(this.selectedVoice);
        let selectedIndex = previousKey
            ? this.voices.findIndex(v => this.getVoiceKey(v) === previousKey)
            : -1;
        if (selectedIndex < 0) selectedIndex = 0;
        this.selectedVoice = this.voices[selectedIndex] || null;
        this.selectedVoiceKey = this.getVoiceKey(this.selectedVoice);

        if (!select) return;
        select.disabled = this.voices.length === 0;
        select.innerHTML = this.voices.map((v, i) =>
            `<option value="${i}">${escapeHTML(v.name)} (${escapeHTML(v.lang)})</option>`
        ).join('') || '<option>正在加载系统语音...</option>';
        if (this.selectedVoice) select.value = String(selectedIndex);
    },

    getVoiceKey(voice) {
        if (!voice) return '';
        return voice.voiceURI || `${voice.name}|${voice.lang}`;
    },

    speak(text, options = {}) {
        if (!this.isSupported()) {
            console.warn('TTS is not supported in this browser.');
            this.speaking = false;
            this.paused = false;
            this.completed = false;
            this.updateUI();
            return;
        }

        // Only cancel the browser synth if it's actually doing something.
        // Edge/Chrome reject synth.speak() shortly after an unnecessary cancel().
        const token = ++this.playbackToken;
        this.stopWatchdog();
        const stopBeforeStart = this.isNativeSpeech()
            ? SmartReadAPI.ttsStop?.().catch(() => undefined)
            : null;
        if (this.isNativeSpeech()) {
            // Android stop is asynchronous. Starting a new utterance before it
            // resolves lets the late stop cancel the fresh utterance.
        } else if (this.synth.speaking || this.synth.pending || this.synth.paused) {
            this.synth.cancel();
        }
        this.speaking = false;
        this.paused = false;
        this.completed = false;
        this.source = null;
        this.sourceId = null;
        this.currentUtterance = null;
        this.currentSpeechText = '';
        this.currentSentenceRetryCount = 0;
        this.retrySentenceIndex = -1;
        this.lastWatchdogRestartAt = 0;
        this.highlightCursor = 0;
        this.lastHighlightedSentenceIndex = -1;
        this.clearHighlight();
        this.clearSentenceTargets();
        this.rootOverride = null;
        this.sentences = [];
        this.currentSentence = 0;

        text = String(text || '');
        if (!text.trim()) { this.updateUI(); return; }
        this.source = options.source || null;
        this.sourceId = options.sourceId || null;
        this.rootOverride = options.root || null;
        this.completed = false;
        this.sentences = this.splitSentences(text);

        const startIndex = Number.isFinite(Number(options.startIndex))
            ? Math.floor(Number(options.startIndex))
            : 0;
        this.currentSentence = Math.max(0, Math.min(startIndex, this.sentences.length));
        this.prepareSentenceTargets();
        this.speaking = true;
        this.paused = false;
        this.updateUI();
        if (stopBeforeStart) {
            stopBeforeStart.finally(() => {
                this.startPlaybackAfterStateUpdate(token);
            });
            return;
        }
        this.startPlaybackAfterStateUpdate(token);
    },

    startPlaybackAfterStateUpdate(token) {
        const run = () => {
            if (token !== this.playbackToken || !this.speaking || this.paused) return;
            this.startWatchdog();
            this.speakNext();
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => setTimeout(run, 0));
            return;
        }
        setTimeout(run, 0);
    },

    speakNext() {

        if (this.currentSentence >= this.sentences.length || !this.speaking) {
            this.currentUtterance = null;
            this.speaking = false;
            this.paused = false;
            this.completed = this.sentences.length > 0;
            this.stopWatchdog();
            this.updateUI();
            return;
        }
        const sentence = this.sentences[this.currentSentence].trim();
        if (!sentence) { this.currentSentence++; this.speakNext(); return; }
        if (this.isStandaloneSpeechLabel(sentence)) {
            if (this.currentSentence + 1 < this.sentences.length) {
                this.sentences[this.currentSentence + 1] = sentence + ' ' + this.sentences[this.currentSentence + 1];
            }
            this.currentSentence++;
            this.speakNext();
            return;
        }
        const speechText = this.prepareUtteranceText(sentence);
        if (!speechText) { this.currentSentence++; this.speakNext(); return; }
        const isRetryingCurrentSentence = this.retrySentenceIndex === this.currentSentence &&
            this.currentSentenceRetryCount > 0;
        if (this.retrySentenceIndex !== this.currentSentence) {
            this.retrySentenceIndex = this.currentSentence;
            this.currentSentenceRetryCount = 0;
        }
        this.updateUI();
        if (!isRetryingCurrentSentence) {
            const sentenceIndex = this.currentSentence;
            try {
                this.highlightSentence(sentence);
                this.ensureCurrentSentenceHighlight(sentence, sentenceIndex);
            } catch (err) {
                console.warn('TTS highlight failed:', err);
            }
        }
        const token = this.playbackToken;
        this.currentSpeechText = speechText;
        this.sentenceStartedAt = Date.now();
        if (this.isNativeSpeech()) {
            this.currentUtterance = null;
            SmartReadAPI.ttsSpeak({
                text: speechText,
                rate: this.speed,
                lang: document.documentElement.lang || 'zh-CN'
            })
                .then(() => this.finishCurrentSentence(token))
                .catch(error => this.handleUtteranceError(token, {
                    error: error?.message || 'native-tts-error'
                }));
            return;
        }
        const utt = new window.SpeechSynthesisUtterance(speechText);
        utt.voice = this.selectedVoice;
        utt.lang = this.selectedVoice?.lang || document.documentElement.lang || 'zh-CN';
        utt.rate = this.speed;
        this.currentUtterance = utt;
        utt.onstart = () => {
            if (token !== this.playbackToken) return;
            this.sentenceStartedAt = Date.now();
        };
        utt.onend = () => { this.finishCurrentSentence(token); };
        utt.onerror = (event) => { this.handleUtteranceError(token, event); };
        try {
            this.synth.speak(utt);
        } catch (err) {
            console.warn('TTS speak failed:', err);
            this.retryCurrentSentence(token, 300);
        }
    },

    prepareUtteranceText(text) {
        const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
        return String(text || '')
            .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, m => '第' + (circled.indexOf(m) + 1) + '，')
            .replace(/^【\s*注释\s*】\s*注[：:]\s*/u, '注释，注，')
            .replace(/^【\s*([^】]{1,12})\s*】\s*/u, '$1，')
            .replace(/^注[：:]\s*/u, '注，')
            // Some Web Speech voices treat annotation/book-title brackets as hard stops.
            .replace(/[【】〖〗「」『』《》〈〉（）()［］\[\]{}]/g, '，')
            .replace(/[：:；;]/g, '，')
            .replace(/[“”"‘’']/g, '')
            .replace(/[—–-]{2,}/g, '，')
            .replace(/\s+/g, ' ')
            .replace(/，{2,}/g, '，')
            .replace(/^[\s，、。,.!?！？]+|[\s，、]+$/g, '')
            .trim();
    },

    finishCurrentSentence(token) {
        if (token !== this.playbackToken) return;
        const elapsed = Date.now() - this.sentenceStartedAt;
        const textLen = (this.currentSpeechText || '').length;
        // Utterance likely dropped if it ended in < 500ms for non-trivial text
        if (elapsed < 500 && textLen > 3) {
            this.retryCurrentSentence(token, 250);
            return;
        }
        this.currentUtterance = null;
        this.currentSentence++;
        this.currentSentenceRetryCount = 0;
        // Longer delay lets Chrome fully reset between utterances
        setTimeout(() => {
            if (token === this.playbackToken) this.speakNext();
        }, 250);
    },

    handleUtteranceError(token, event) {
        if (token !== this.playbackToken) return;
        const error = event?.error || 'unknown';
        if (this.isFatalSpeechError(error)) {
            this.failPlayback('TTS error: ' + error);
            return;
        }
        console.warn('TTS utterance error, retrying current sentence:', error);
        this.retryCurrentSentence(token, 350);
    },

    isFatalSpeechError(error) {
        return ['not-allowed', 'service-not-allowed', 'language-unavailable', 'voice-unavailable'].includes(error);
    },

    retryCurrentSentence(token, delay = 300) {
        if (token !== this.playbackToken || !this.speaking) return;
        this.currentUtterance = null;
        this.currentSentenceRetryCount++;
        if (this.currentSentenceRetryCount > 3) {
            this.failPlayback('TTS failed repeatedly on the current sentence.');
            return;
        }
        setTimeout(() => {
            if (token === this.playbackToken && this.speaking && !this.paused) this.speakNext();
        }, delay);
    },

    failPlayback(reason) {
        console.warn(reason);
        this.playbackToken++;
        this.stopWatchdog();
        if (this.isNativeSpeech()) {
            SmartReadAPI.ttsStop?.().catch(() => undefined);
        } else if (this.isWebSpeechSupported() && (this.synth.speaking || this.synth.pending || this.synth.paused)) {
            this.synth.cancel();
        }
        this.speaking = false;
        this.paused = false;
        this.completed = false;
        this.currentUtterance = null;
        this.currentSpeechText = '';
        this.currentSentenceRetryCount = 0;
        this.retrySentenceIndex = -1;
        this.lastWatchdogRestartAt = 0;
        this.clearHighlight();
        this.updateUI();
    },

    startWatchdog() {
        this.stopWatchdog();
        this.watchdogTimer = setInterval(() => this.checkPlaybackHealth(), 1200);
    },

    stopWatchdog() {
        if (!this.watchdogTimer) return;
        clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
    },

    checkPlaybackHealth(force = false) {
        if (!this.isSupported()) return;
        if (!this.speaking || this.paused || !this.sentences.length) return;
        if (this.currentSentence >= this.sentences.length) return;

        const now = Date.now();
        const elapsed = now - this.sentenceStartedAt;
        const isOverdue = elapsed > this.estimateUtteranceDuration(this.currentSpeechText);
        if (this.isNativeSpeech()) {
            if (!isOverdue) return;
            this.currentSentenceRetryCount++;
            if (this.currentSentenceRetryCount > 1) {
                this.failPlayback('Android TTS watchdog stopped after a stalled sentence.');
                return;
            }
            const token = ++this.playbackToken;
            const stopPromise = SmartReadAPI.ttsStop?.().catch(() => undefined);
            Promise.resolve(stopPromise).finally(() => {
                if (token === this.playbackToken && this.speaking && !this.paused) this.speakNext();
            });
            return;
        }
        if ((this.synth.speaking || this.synth.pending) && !isOverdue) return;
        if (!force && now - this.sentenceStartedAt < 1800) return;
        if (now - this.lastWatchdogRestartAt < 1800) return;

        this.lastWatchdogRestartAt = now;
        this.playbackToken++;
        this.currentUtterance = null;
        this.synth.cancel();
        if (isOverdue) {
            this.currentSentenceRetryCount++;
            if (this.currentSentenceRetryCount > 2) {
                this.failPlayback('TTS watchdog stopped after repeated stalls.');
                return;
            }
        }
        setTimeout(() => {
            if (this.speaking && !this.paused) this.speakNext();
        }, 0);
    },

    estimateUtteranceDuration(text) {
        const length = String(text || '').length;
        const byLength = (length * 230) / Math.max(0.5, this.speed || 1);
        return Math.max(4200, Math.min(45000, byLength + 3000));
    },

    // 获取实际内容所在的根元素和document
    getContentRoot() {
        if (this.rootOverride) {
            return { el: this.rootOverride, doc: this.rootOverride.ownerDocument || document };
        }
        // EPUB: 内容在 iframe 里
        if (Reader.book?.type === 'epub' && Reader.epubRendition) {
            try {
                const current = Reader.getCurrentEpubContent?.();
                if (current?.body && current?.doc) {
                    return {
                        el: current.body,
                        doc: current.doc,
                        range: null,
                        visibleBounds: Reader._epubVisibleBounds?.(current.body, current.doc) || null
                    };
                }
            } catch {}
        }
        // TXT / 降级
        return { el: document.getElementById('book-content'), doc: document };
    },

    splitSentences(text) {
        const source = this.normalizeSpeechSource(String(text || '').replace(/\r/g, '').trim());
        if (!source) return [];
        const raw = this.mergeSpeechLabels(this.collectSentenceChunks(source));
        const sentences = [];
        for (const item of raw) {
            const sentence = item.trim();
            if (!sentence) continue;
            if (!this.isSpeakableSentence(sentence) && !this.isStandaloneSpeechLabel(sentence)) continue;
            if (sentence.length <= 180) {
                sentences.push(sentence);
                continue;
            }
            for (let i = 0; i < sentence.length; i += 120) {
                const part = sentence.slice(i, i + 120).trim();
                if (part) sentences.push(part);
            }
        }
        return sentences.length ? sentences : [source];
    },

    normalizeSpeechSource(text) {
        return String(text || '')
            // EPUB/TXT often puts labels like "【注释】" on their own line.
            .replace(/(【[^】]{1,12}】)\s*\n+\s*(?=\S)/g, '$1 ')
            .replace(/(〖[^〗]{1,12}〗)\s*\n+\s*(?=\S)/g, '$1 ')
            .trim();
    },

    mergeSpeechLabels(chunks) {
        const merged = [];
        for (const chunk of chunks) {
            const current = String(chunk || '').trim();
            if (!current) continue;
            if (this.isStandaloneSpeechLabel(current)) {
                if (merged.length && this.isStandaloneSpeechLabel(merged[merged.length - 1])) {
                    merged[merged.length - 1] += ' ' + current;
                } else {
                    merged.push(current);
                }
                continue;
            }
            if (merged.length && this.isStandaloneSpeechLabel(merged[merged.length - 1])) {
                merged[merged.length - 1] += ' ' + current;
            } else {
                merged.push(current);
            }
        }
        return merged;
    },

    isStandaloneSpeechLabel(text) {
        const value = String(text || '').trim();
        return /^【[^】]{1,12}】$/.test(value) ||
            /^〖[^〗]{1,12}〗$/.test(value) ||
            /^(注释|注|译文|说明|按语|题解|校注|原文|白话)$/.test(value);
    },

    collectSentenceChunks(source) {
        const chunks = [];
        let start = 0;
        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (ch === '\n') {
                this.pushChunk(chunks, source, start, i);
                while (i + 1 < source.length && source[i + 1] === '\n') i++;
                start = i + 1;
                continue;
            }
            const sentenceEnd = this.findSentenceEnd(source, i);
            if (sentenceEnd > i) {
                this.pushChunk(chunks, source, start, sentenceEnd);
                i = sentenceEnd - 1;
                start = sentenceEnd;
            }
        }
        this.pushChunk(chunks, source, start, source.length);
        return chunks.length ? chunks : [source];
    },

    pushChunk(chunks, source, start, end) {
        const chunk = source.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
    },

    isSentenceEnd(source, index) {
        const ch = source[index];
        if ('。！？!?；;｡'.includes(ch)) return true;
        if (ch === '…') return true;
        if (ch !== '.') return false;

        const prev = source[index - 1] || '';
        const next = source[index + 1] || '';
        if (/\d/.test(prev) && /\d/.test(next)) return false;
        return true;
    },

    findSentenceEnd(source, index) {
        if (!this.isSentenceEnd(source, index)) return -1;
        let end = index + 1;
        while (end < source.length && this.isTrailingSentencePunctuation(source[end])) end++;
        while (end < source.length && this.isClosingSentenceMark(source[end])) end++;
        return end;
    },

    isTrailingSentencePunctuation(ch) {
        return '。！？!?；;…｡'.includes(ch || '');
    },

    isClosingSentenceMark(ch) {
        return '”’"\'」』）)]］】》〉}｝'.includes(ch || '');
    },

    isSpeakableSentence(text) {
        return !!this.prepareUtteranceText(text);
    },

    highlightSentence(sentence) {
        this.clearHighlight();
        const { el, doc, range, visibleBounds } = this.getContentRoot();
        if (!el) return;
        const textIndex = this.buildTextIndex(el, doc, range, { visibleBounds });
        const match = this.findHighlightMatch(textIndex, sentence, this.highlightCursor);
        if (match) {
            if (this.applyHighlightSafe(doc, match.map, match.start, match.length)) {
                this.rememberHighlightMatch(match);
                return;
            }
        }
        // 降级：简单前缀匹配
        const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
        const walker = doc.createTreeWalker(el, nodeFilter.SHOW_TEXT);
        const prefix = sentence.slice(0, 20);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!this.rangeIntersectsNode(range, node)) continue;
            const bounds = this.getRangeTextBounds(node, node.textContent || '', range);
            const searchable = (node.textContent || '').slice(bounds.start, bounds.end);
            const idx = searchable.indexOf(prefix);
            if (idx >= 0) {
                try {
                    const start = bounds.start + idx;
                    const end = Math.min(start + sentence.length, bounds.end);
                    const span = this.wrapTextNodeSafe(doc, node, start, end);
                    this.scrollHighlightIntoView(doc, span);
                    this.lastHighlightedSentenceIndex = this.currentSentence;
                } catch {}
                break;
            }
        }
    },

    ensureCurrentSentenceHighlight(sentence, sentenceIndex) {
        const token = this.playbackToken;
        const retry = () => {
            if (token !== this.playbackToken || !this.speaking || this.paused) return;
            if (this.currentSentence !== sentenceIndex) return;
            if (this.hasVisibleSentenceHighlight(sentenceIndex)) return;
            try {
                this.highlightSentence(sentence);
            } catch (err) {
                console.warn('TTS highlight retry failed:', err);
            }
        };
        [40, 120, 260, 520, 900].forEach(delay => {
            setTimeout(() => {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(retry);
                    return;
                }
                retry();
            }, delay);
        });
    },

    hasVisibleSentenceHighlight(sentenceIndex) {
        const selector = `.tts-highlight[data-tts-sentence-index="${sentenceIndex}"]`;
        for (const doc of this.getTtsDocuments()) {
            const highlights = doc.querySelectorAll(selector);
            for (const highlight of highlights) {
                if (this.isHighlightVisible(highlight, doc)) return true;
            }
        }
        return false;
    },

    isHighlightVisible(highlight, doc) {
        if (!highlight?.isConnected) return false;
        const view = doc.defaultView || window;
        const style = view.getComputedStyle?.(highlight);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        return Array.from(highlight.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
    },

    rememberHighlightMatch(match) {
        this.highlightCursor = Math.max(this.highlightCursor, match.start + match.length);
        this.lastHighlightedSentenceIndex = this.currentSentence;
    },

    buildTextIndex(root, doc, range = null, options = {}) {
        const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
        const visibleBounds = options.visibleBounds || null;
        const walker = doc.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return nodeFilter.FILTER_REJECT;
                if (parent.closest('script, style, noscript')) {
                    return nodeFilter.FILTER_REJECT;
                }
                if (!this.rangeIntersectsNode(range, node)) {
                    return nodeFilter.FILTER_REJECT;
                }
                return nodeFilter.FILTER_ACCEPT;
            }
        });
        const exact = { text: '', map: [], lastWasSpace: true };
        const loose = { text: '', map: [], lastWasSeparator: true };

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const value = node.textContent || '';
            const bounds = this.getRangeTextBounds(node, value, range);
            const segments = this.getIndexedTextSegments(node, value, bounds, doc, visibleBounds);
            for (const segment of segments) {
                for (let i = segment.start; i < segment.end; i++) {
                    const ch = value[i];
                    this.appendExactIndex(exact, node, i, ch);
                    this.appendLooseIndex(loose, node, i, ch);
                }
            }
        }

        this.trimIndexTail(exact, ' ');
        this.trimIndexTail(loose, ' ');
        return {
            exactText: exact.text,
            exactMap: exact.map,
            looseText: loose.text,
            looseMap: loose.map
        };
    },

    getIndexedTextSegments(node, value, bounds, doc, visibleBounds) {
        if (!visibleBounds) return [bounds];
        const segments = [];
        const source = String(value || '');
        const candidates = typeof Reader !== 'undefined' && typeof Reader._textNodeSegments === 'function'
            ? Reader._textNodeSegments(source)
            : [{ start: bounds.start, end: bounds.end }];
        for (const candidate of candidates) {
            const start = Math.max(bounds.start, candidate.start);
            const end = Math.min(bounds.end, candidate.end);
            if (start >= end) continue;
            if (this.textSegmentIntersectsBounds(node, start, end, doc, visibleBounds)) {
                segments.push({ start, end });
            }
        }
        return segments;
    },

    textSegmentIntersectsBounds(node, start, end, doc, bounds) {
        try {
            const range = doc.createRange();
            range.setStart(node, start);
            range.setEnd(node, end);
            return Array.from(range.getClientRects()).some(rect =>
                rect.right > bounds.left && rect.left < bounds.right &&
                rect.bottom > bounds.top && rect.top < bounds.bottom
            );
        } catch {
            return true;
        }
    },

    rangeIntersectsNode(range, node) {
        if (!range || !node) return true;
        try {
            return range.intersectsNode(node);
        } catch {
            return true;
        }
    },

    getRangeTextBounds(node, value, range) {
        let start = 0;
        let end = value.length;
        if (range) {
            if (node === range.startContainer) {
                start = Math.max(0, Math.min(range.startOffset, value.length));
            }
            if (node === range.endContainer) {
                end = Math.max(start, Math.min(range.endOffset, value.length));
            }
        }
        return { start, end };
    },

    appendExactIndex(index, node, offset, ch) {
        if (this.isMatchSpace(ch)) {
            if (!index.lastWasSpace && index.text) {
                index.text += ' ';
                index.map.push({ node, offset });
                index.lastWasSpace = true;
            }
            return;
        }
        index.text += ch;
        index.map.push({ node, offset });
        index.lastWasSpace = false;
    },

    appendLooseIndex(index, node, offset, ch) {
        if (this.isLooseSeparator(ch)) {
            if (!index.lastWasSeparator && index.text) {
                index.text += ' ';
                index.map.push({ node, offset });
                index.lastWasSeparator = true;
            }
            return;
        }
        index.text += ch;
        index.map.push({ node, offset });
        index.lastWasSeparator = false;
    },

    trimIndexTail(index, char) {
        while (index.text.endsWith(char)) {
            index.text = index.text.slice(0, -1);
            index.map.pop();
        }
    },

    findHighlightMatch(index, sentence, startAt = 0) {
        const target = this.normalizeForMatch(sentence);
        if (!target) return null;

        const exact = this.findInIndex(index.exactText, index.exactMap, target, startAt);
        if (exact) return exact;

        const looseTarget = this.normalizeLooseForMatch(sentence);
        const loose = this.findInIndex(index.looseText, index.looseMap, looseTarget, startAt);
        if (loose) return loose;

        return null;
    },

    findInIndex(indexText, map, target, startAt = 0) {
        if (!indexText || !target) return null;
        const from = Math.max(0, Math.min(Math.floor(Number(startAt)) || 0, indexText.length));
        let exact = indexText.indexOf(target, from);
        if (exact < 0 && from > 0) exact = indexText.indexOf(target);
        if (exact >= 0) return { map, start: exact, length: target.length };

        const max = Math.min(target.length, 80);
        for (let len = max; len >= 10; len -= 6) {
            const prefix = target.slice(0, len).trim();
            if (!prefix) continue;
            let idx = indexText.indexOf(prefix, from);
            if (idx < 0 && from > 0) idx = indexText.indexOf(prefix);
            if (idx >= 0) {
                return {
                    map,
                    start: idx,
                    length: Math.min(target.length, Math.max(prefix.length, indexText.length - idx))
                };
            }
        }
        return null;
    },

    prepareSentenceTargets() {
        this.sentenceTargetsReady = false;
        this.sentenceTargets = [];
        this.unbindSentenceTargetClick();
        if (this.source !== 'book' || !this.sentences.length) return;
        const { el, doc, range, visibleBounds } = this.getContentRoot();
        if (!el || !doc) return;

        try {
            const textIndex = this.buildTextIndex(el, doc, range, { visibleBounds });
            const targets = [];
            let cursor = 0;
            this.sentences.forEach((sentence, index) => {
                const text = String(sentence || '').trim();
                if (!text || (!this.isStandaloneSpeechLabel(text) && !this.isSpeakableSentence(text))) return;
                const match = this.findHighlightMatch(textIndex, text, cursor);
                if (!match) return;
                const entries = match.map.slice(match.start, match.start + match.length).filter(Boolean);
                const segments = this.buildHighlightSegments(entries);
                if (segments.length) targets.push({ index, segments });
                cursor = Math.max(cursor, match.start + match.length);
            });

            this.sentenceTargets = targets;
            this.sentenceTargetsReady = targets.length > 0;
            if (this.sentenceTargetsReady) this.bindSentenceTargetClick(el, doc);
        } catch (err) {
            console.warn('TTS sentence target preparation failed:', err);
            this.clearSentenceTargets();
        }
    },

    bindSentenceTargetClick(root, doc) {
        this.unbindSentenceTargetClick();
        const handler = (event) => this.handleSentenceTargetClick(event, doc);
        root.addEventListener('click', handler, true);
        this.sentenceTargetRoot = root;
        this.sentenceTargetClickHandler = handler;
    },

    unbindSentenceTargetClick() {
        if (this.sentenceTargetRoot && this.sentenceTargetClickHandler) {
            this.sentenceTargetRoot.removeEventListener('click', this.sentenceTargetClickHandler, true);
        }
        this.sentenceTargetRoot = null;
        this.sentenceTargetClickHandler = null;
    },

    handleSentenceTargetClick(event, doc) {
        if (this.source !== 'book' || !this.sentenceTargetsReady) return;
        const highlighted = event.target?.closest?.('.tts-highlight[data-tts-sentence-index]');
        if (highlighted) {
            const index = Number(highlighted.dataset.ttsSentenceIndex);
            if (Number.isFinite(index)) {
                event.preventDefault();
                event.stopPropagation();
                this.jumpToSentence(index);
                return;
            }
        }
        const point = this.getTextPointFromEvent(event, doc);
        if (!point?.node) return;
        const target = this.findSentenceTargetByTextPoint(point.node, point.offset);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        this.jumpToSentence(target.index);
    },

    getTextPointFromEvent(event, doc) {
        const x = event.clientX;
        const y = event.clientY;
        if (doc.caretPositionFromPoint) {
            const pos = doc.caretPositionFromPoint(x, y);
            if (pos?.offsetNode) return { node: pos.offsetNode, offset: pos.offset };
        }
        if (doc.caretRangeFromPoint) {
            const range = doc.caretRangeFromPoint(x, y);
            if (range?.startContainer) return { node: range.startContainer, offset: range.startOffset };
        }
        return this.getFallbackTextPoint(event.target);
    },

    getFallbackTextPoint(target) {
        const node = target?.nodeType === 3
            ? target
            : target?.closest?.('.tts-highlight')?.firstChild || target?.firstChild;
        if (!node || node.nodeType !== 3) return null;
        return { node, offset: 0 };
    },

    findSentenceTargetByTextPoint(node, offset) {
        let best = null;
        for (const target of this.sentenceTargets) {
            for (const segment of target.segments) {
                if (segment.node !== node) continue;
                if (offset < segment.start || offset > segment.end) continue;
                if (!best || target.index < best.index) best = target;
            }
        }
        return best;
    },

    applyHighlightSafe(doc, map, start, length) {
        const entries = map.slice(start, start + length).filter(Boolean);
        const segments = this.buildHighlightSegments(entries);
        if (!segments.length) return false;

        try {
            const spans = [];
            // 从后往前处理，避免偏移量变化
            for (let i = segments.length - 1; i >= 0; i--) {
                const span = this.wrapTextNodeSafe(
                    doc,
                    segments[i].node,
                    segments[i].start,
                    segments[i].end
                );
                if (span) spans.unshift(span);
            }
            this.scrollHighlightIntoView(doc, spans[0]);
            return true;
        } catch {
            return false;
        }
    },

    scrollHighlightIntoView(doc, span) {
        if (!span) return;
        // EPUB paginated mode uses columns inside an iframe. Native scrolling
        // moves the iframe viewport vertically and breaks the page layout.
        if (this.isEpubDocument(doc)) return;
        span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    },

    isEpubDocument(doc) {
        return !!(
            doc &&
            doc !== document &&
            Reader?.book?.type === 'epub' &&
            Reader?.epubRendition
        );
    },

    buildHighlightSegments(entries) {
        const segments = [];
        let current = null;
        for (const entry of entries) {
            if (!entry?.node || typeof entry.offset !== 'number') continue;
            if (current && current.node === entry.node && entry.offset === current.end) {
                current.end = entry.offset + 1;
                continue;
            }
            current = { node: entry.node, start: entry.offset, end: entry.offset + 1 };
            segments.push(current);
        }
        return segments.filter(seg => seg.end > seg.start);
    },

    wrapTextNodeSafe(doc, node, start, end) {
        if (!node || !node.parentNode || node.nodeType !== 3) return null;
        const text = node.textContent || '';
        const safeStart = Math.max(0, Math.min(start, text.length));
        const safeEnd = Math.max(safeStart, Math.min(end, text.length));
        if (safeStart >= safeEnd) return null;

        // 用 splitText 安全地分割文本节点，不破坏父元素结构
        const targetNode = safeStart > 0 ? node.splitText(safeStart) : node;
        if (safeEnd - safeStart < targetNode.textContent.length) {
            targetNode.splitText(safeEnd - safeStart);
        }

        const span = doc.createElement('span');
        span.className = 'tts-highlight';
        this.decorateHighlightSpan(span);
        targetNode.parentNode.insertBefore(span, targetNode);
        span.appendChild(targetNode);
        return span;
    },

    decorateHighlightSpan(span) {
        if (!span) return;
        const sentenceIndex = String(this.currentSentence);
        span.dataset.ttsSentenceIndex = sentenceIndex;
        span.setAttribute('role', 'button');
        span.setAttribute('tabindex', '0');
        span.setAttribute('aria-label', `从第 ${this.currentSentence + 1} 句开始朗读`);
        const replayFromHighlight = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const index = Number(span.dataset.ttsSentenceIndex);
            if (Number.isFinite(index)) this.jumpToSentence(index);
        };
        span.addEventListener('click', replayFromHighlight);
        span.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            replayFromHighlight(event);
        });
    },

    normalizeForMatch(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    },

    normalizeLooseForMatch(text) {
        const source = this.normalizeForMatch(text);
        let result = '';
        let lastWasSeparator = true;
        for (const ch of source) {
            if (this.isLooseSeparator(ch)) {
                if (!lastWasSeparator && result) {
                    result += ' ';
                    lastWasSeparator = true;
                }
                continue;
            }
            result += ch;
            lastWasSeparator = false;
        }
        return result.trim();
    },

    isMatchSpace(ch) {
        return ch === '\u00a0' || /\s/.test(ch);
    },

    isLooseSeparator(ch) {
        return this.isMatchSpace(ch) || /[，,。.!！？?；;：:、|]/.test(ch);
    },

    clearHighlight() {
        const docs = this.getTtsDocuments();
        docs.forEach(doc => {
            doc.querySelectorAll('.tts-highlight').forEach(el => this.unwrapHighlight(el));
        });
    },

    clearSentenceTargets() {
        this.unbindSentenceTargetClick();
        this.sentenceTargets = [];
        const docs = this.getTtsDocuments();
        docs.forEach(doc => {
            doc.querySelectorAll('.tts-sentence').forEach(el => this.unwrapHighlight(el));
        });
        this.sentenceTargetsReady = false;
    },

    getTtsDocuments() {
        const docs = new Set([document]);
        try {
            if (this.rootOverride?.ownerDocument) docs.add(this.rootOverride.ownerDocument);
            const contents = Reader?.epubRendition?.getContents?.() || [];
            contents.forEach(content => {
                if (content?.document) docs.add(content.document);
            });
            const { doc } = this.getContentRoot();
            if (doc) docs.add(doc);
        } catch {}
        return docs;
    },

    unwrapHighlight(el) {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
    },

    stop() {
        this.playbackToken++;
        this.stopWatchdog();
        if (this.isNativeSpeech()) SmartReadAPI.ttsStop?.().catch(() => undefined);
        else if (this.isWebSpeechSupported()) this.synth.cancel();
        this.speaking = false;
        this.paused = false;
        this.completed = false;
        this.source = null;
        this.sourceId = null;
        this.currentUtterance = null;
        this.currentSpeechText = '';
        this.currentSentenceRetryCount = 0;
        this.retrySentenceIndex = -1;
        this.lastWatchdogRestartAt = 0;
        this.highlightCursor = 0;
        this.lastHighlightedSentenceIndex = -1;
        this.clearHighlight();
        this.clearSentenceTargets();
        this.rootOverride = null;
        this.sentences = [];
        this.currentSentence = 0;
        this.updateUI();
    },

    pause() {
        if (this.isNativeSpeech() && this.speaking && !this.paused) {
            this.playbackToken++;
            SmartReadAPI.ttsStop?.().catch(() => undefined);
            this.paused = true;
            this.stopWatchdog();
            this.updateUI();
            return;
        }
        if (this.isWebSpeechSupported() && this.speaking && !this.paused) {
            this.synth.pause();
            this.paused = true;
            this.stopWatchdog();
            this.updateUI();
        }
    },

    resume() {
        if (this.isNativeSpeech() && this.paused) {
            const token = ++this.playbackToken;
            this.paused = false;
            this.speaking = true;
            this.sentenceStartedAt = Date.now();
            this.lastWatchdogRestartAt = 0;
            this.updateUI();
            this.startPlaybackAfterStateUpdate(token);
            return;
        }
        if (this.isWebSpeechSupported() && this.paused) {
            this.synth.resume();
            this.paused = false;
            this.sentenceStartedAt = Date.now();
            this.lastWatchdogRestartAt = 0;
            this.startWatchdog();
            this.updateUI();
            setTimeout(() => this.checkPlaybackHealth(true), 500);
        }
    },

    jumpBy(delta) {
        if (!this.isSupported()) return;
        if (!this.sentences.length || (!this.speaking && !this.paused && !this.completed)) return;
        const direction = delta < 0 ? -1 : 1;
        const nextIndex = this.findNavigableSentenceIndex(this.currentSentence + direction, direction);
        if (nextIndex < 0) {
            this.updateUI();
            return;
        }
        const token = ++this.playbackToken;
        const stopBeforeJump = this.isNativeSpeech()
            ? SmartReadAPI.ttsStop?.().catch(() => undefined)
            : null;
        if (!stopBeforeJump && this.isWebSpeechSupported()) this.synth.cancel();
        this.currentSentence = nextIndex;
        if (delta < 0) this.highlightCursor = 0;
        this.lastHighlightedSentenceIndex = -1;
        this.lastWatchdogRestartAt = 0;
        this.speaking = true;
        this.paused = false;
        this.completed = false;
        this.clearHighlight();
        this.updateUI();
        if (stopBeforeJump) {
            stopBeforeJump.finally(() => {
                this.startPlaybackAfterStateUpdate(token);
            });
            return;
        }
        this.startPlaybackAfterStateUpdate(token);
    },

    jumpToSentence(index) {
        if (!this.isSupported()) return;
        if (!this.sentences.length) return;
        const rawIndex = Math.max(0, Math.min(this.sentences.length - 1, Number(index) || 0));
        const forwardIndex = this.findNavigableSentenceIndex(rawIndex, 1);
        const backwardIndex = this.findNavigableSentenceIndex(rawIndex, -1);
        const targetIndex = forwardIndex >= 0 ? forwardIndex : backwardIndex;
        if (targetIndex < 0) {
            this.updateUI();
            return;
        }
        const token = ++this.playbackToken;
        const stopBeforeJump = this.isNativeSpeech()
            ? SmartReadAPI.ttsStop?.().catch(() => undefined)
            : null;
        if (!stopBeforeJump && this.isWebSpeechSupported()) this.synth.cancel();
        this.currentSentence = targetIndex;
        this.highlightCursor = 0;
        this.lastHighlightedSentenceIndex = -1;
        this.lastWatchdogRestartAt = 0;
        this.speaking = true;
        this.paused = false;
        this.completed = false;
        this.clearHighlight();
        this.updateUI();
        if (stopBeforeJump) {
            stopBeforeJump.finally(() => {
                this.startPlaybackAfterStateUpdate(token);
            });
            return;
        }
        this.startPlaybackAfterStateUpdate(token);
    },

    previousSentence() {
        this.jumpBy(-1);
    },

    nextSentence() {
        this.jumpBy(1);
    },

    findNavigableSentenceIndex(startIndex, direction) {
        const step = direction < 0 ? -1 : 1;
        const initialIndex = Number(startIndex);
        if (!Number.isFinite(initialIndex) || initialIndex < 0 || initialIndex >= this.sentences.length) {
            return -1;
        }
        let index = initialIndex;
        while (index >= 0 && index < this.sentences.length) {
            const sentence = String(this.sentences[index] || '').trim();
            if (sentence && (this.isStandaloneSpeechLabel(sentence) || this.isSpeakableSentence(sentence))) {
                return index;
            }
            index += step;
        }
        return -1;
    },

    setVoice(index) {
        const selectedIndex = Number(index);
        this.selectedVoice = this.voices[selectedIndex] || this.voices[0] || null;
        this.selectedVoiceKey = this.getVoiceKey(this.selectedVoice);
    },

    setSpeed(val) {
        const next = parseFloat(val);
        this.speed = Number.isFinite(next) ? Math.max(0.5, Math.min(2, next)) : 1;
        document.querySelectorAll('#speed-value, #speed-display').forEach(label => {
            label.textContent = this.speed.toFixed(1) + 'x';
        });
        this.updateUI();
    },

    updateUI() {
        document.querySelectorAll('.btn-tts-play').forEach(btn => {
            if (!this.isSupported()) {
                btn.textContent = '朗读不可用';
                btn.disabled = true;
                return;
            }
            btn.disabled = false;
            const isBookTTS = this.speaking && (this.source === 'book' || !this.source);
            btn.textContent = isBookTTS
                ? (this.paused ? '▶ 继续' : '⏹ 停止')
                : '▶ 开始朗读';
        });
        document.dispatchEvent(new CustomEvent('tts-state-change', {
            detail: {
                supported: this.isSupported(),
                speaking: this.speaking,
                paused: this.paused,
                completed: this.completed,
                source: this.source,
                sourceId: this.sourceId,
                currentSentence: this.currentSentence,
                totalSentences: this.sentences.length,
                speed: this.speed
            }
        }));
    }
};
