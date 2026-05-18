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

    init() {
        if (!this.isSupported()) {
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
        return !!(this.synth && typeof window.SpeechSynthesisUtterance === 'function');
    },

    loadVoices() {
        const select = document.getElementById('tts-voice');
        if (!this.isSupported()) {
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
        this.playbackToken++;
        this.stopWatchdog();
        if (this.synth.speaking || this.synth.pending || this.synth.paused) {
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
        this.speaking = true;
        this.paused = false;
        this.startWatchdog();
        this.updateUI();
        this.speakNext();
    },

    speakNext() {

        if (this.currentSentence >= this.sentences.length || !this.speaking) {
            this.currentUtterance = null;
            this.clearHighlight();
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
        if (!isRetryingCurrentSentence) {
            try {
                this.highlightSentence(sentence);
            } catch (err) {
                console.warn('TTS highlight failed:', err);
            }
        }
        this.updateUI();
        const utt = new window.SpeechSynthesisUtterance(speechText);
        utt.voice = this.selectedVoice;
        utt.lang = this.selectedVoice?.lang || document.documentElement.lang || 'zh-CN';
        utt.rate = this.speed;
        const token = this.playbackToken;
        this.currentUtterance = utt;
        this.currentSpeechText = speechText;
        this.sentenceStartedAt = Date.now();
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
        if (this.isSupported() && (this.synth.speaking || this.synth.pending || this.synth.paused)) {
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
                const contents = Reader.epubRendition.getContents();
                if (contents && contents.length > 0) {
                    const content = contents[0];
                    const doc = content.document;
                    const range = Reader._getCurrentEpubRange?.(content, doc) || null;
                    return { el: doc.body, doc, range };
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
            if (this.isSentenceEnd(source, i)) {
                this.pushChunk(chunks, source, start, i + 1);
                start = i + 1;
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
        if ('。！？!?'.includes(ch)) return true;
        if (ch !== '.') return false;

        const prev = source[index - 1] || '';
        const next = source[index + 1] || '';
        if (/\d/.test(prev)) return false;
        if (/\d/.test(next)) return false;
        return true;
    },

    highlightSentence(sentence) {
        this.clearHighlight();
        const { el, doc, range } = this.getContentRoot();
        if (!el) return;
        const textIndex = this.buildTextIndex(el, doc, range);
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

    rememberHighlightMatch(match) {
        this.highlightCursor = Math.max(this.highlightCursor, match.start + match.length);
        this.lastHighlightedSentenceIndex = this.currentSentence;
    },

    buildTextIndex(root, doc, range = null) {
        const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
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
            for (let i = bounds.start; i < bounds.end; i++) {
                const ch = value[i];
                this.appendExactIndex(exact, node, i, ch);
                this.appendLooseIndex(loose, node, i, ch);
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
            if (idx >= 0) return { map, start: idx, length: prefix.length };
        }
        return null;
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
        targetNode.parentNode.insertBefore(span, targetNode);
        span.appendChild(targetNode);
        return span;
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
        docs.forEach(doc => {
            doc.querySelectorAll('.tts-highlight').forEach(el => this.unwrapHighlight(el));
        });
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
        if (this.isSupported()) this.synth.cancel();
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
        this.rootOverride = null;
        this.sentences = [];
        this.currentSentence = 0;
        this.updateUI();
    },

    pause() {
        if (this.isSupported() && this.speaking && !this.paused) {
            this.synth.pause();
            this.paused = true;
            this.stopWatchdog();
            this.updateUI();
        }
    },

    resume() {
        if (this.isSupported() && this.paused) {
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
        const nextIndex = Math.max(
            0,
            Math.min(this.sentences.length - 1, this.currentSentence + delta)
        );
        this.playbackToken++;
        this.synth.cancel();
        this.currentSentence = nextIndex;
        if (delta < 0) this.highlightCursor = 0;
        this.lastHighlightedSentenceIndex = -1;
        this.lastWatchdogRestartAt = 0;
        this.speaking = true;
        this.paused = false;
        this.completed = false;
        this.clearHighlight();
        this.startWatchdog();
        this.updateUI();
        this.speakNext();
    },

    previousSentence() {
        this.jumpBy(-1);
    },

    nextSentence() {
        this.jumpBy(1);
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
