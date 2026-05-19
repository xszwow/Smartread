/* ===== AI 服务模块：Web 走后端代理；手机单机版直连用户配置的 OpenAI-compatible 接口 ===== */
const AIService = {

    async chat(messages, onChunk) {
        if (!AIConfig.isConfigured()) throw new Error('请先在设置中配置 AI API Key');
        if (window.SmartReadNativeBackend?.enabled) {
            return this.nativeBackendChat(messages, onChunk);
        }
        if (window.SmartReadNativeStandalone?.enabled) {
            return this.directNativeChat(messages, onChunk);
        }

        const resp = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                messages,
                stream: !!onChunk
            })
        });

        if (!resp.ok) {
            let message = `AI 服务错误 (${resp.status})`;
            try {
                const data = await resp.json();
                message = data?.error || message;
            } catch {}
            throw new Error(message);
        }

        if (!onChunk) {
            const data = await resp.json();
            return data.choices?.[0]?.message?.content || '';
        }

        return this.readStream(resp.body, onChunk);
    },

    async nativeBackendChat(messages, onChunk) {
        const cfg = AIConfig.load();
        const data = await SmartReadAPI.aiChat({
            model: cfg.model,
            messages,
            stream: false
        });
        const content = this.extractContent(data);
        if (onChunk && content) onChunk(content, content);
        return content;
    },

    async directNativeChat(messages, onChunk) {
        const cfg = window.SmartReadNativeStandalone.readAIConfig();
        if (!cfg.apiKey) throw new Error('请先在设置中配置 AI API Key');
        const url = this.toChatCompletionsURL(cfg.baseURL);
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`
            },
            body: JSON.stringify({
                model: cfg.model,
                messages,
                stream: false
            })
        });
        if (!resp.ok) {
            let message = `AI 服务错误 (${resp.status})`;
            try {
                const data = await resp.json();
                message = data?.error?.message || data?.error || message;
            } catch {}
            throw new Error(message);
        }
        const data = await resp.json();
        const content = this.extractContent(data);
        if (onChunk && content) onChunk(content, content);
        return content;
    },

    extractContent(data) {
        if (typeof data === 'string') return data;
        return data?.choices?.[0]?.message?.content ||
            data?.choices?.[0]?.delta?.content ||
            data?.content ||
            data?.text ||
            '';
    },

    toChatCompletionsURL(baseURL) {
        const url = new URL(normalizeUrlInput(baseURL || 'https://api.openai.com/v1/chat/completions'));
        let pathname = url.pathname.replace(/\/+$/, '');
        if (!pathname.endsWith('/chat/completions')) {
            if (!pathname.endsWith('/v1')) pathname += '/v1';
            pathname += '/chat/completions';
        }
        url.pathname = pathname;
        url.search = '';
        url.hash = '';
        return url.toString();
    },

    async readStream(body, onChunk) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let result = '', buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') return result;
                try {
                    const json = JSON.parse(data);
                    if (json.error) throw new Error(json.error);
                    const delta = json.choices?.[0]?.delta?.content || '';
                    if (delta) { result += delta; onChunk(delta, result); }
                } catch (err) {
                    if (err instanceof Error && err.message && err.message !== 'Unexpected end of JSON input') {
                        if (data.startsWith('{')) throw err;
                    }
                }
            }
        }
        return result;
    }
};
