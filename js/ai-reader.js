/* ===== AI 读书模式 ===== */
const AIReader = {
    context: [],   // 已读页面摘要，用于上下文积累
    isActive: false,

    // 语言名称映射
    langNames: { 'zh-CN':'中文','en':'English','ja':'日本語','ko':'한국어' },

    // 获取系统提示词
    getSystemPrompt(lang) {
        const name = this.langNames[lang] || '中文';
        return `你是"智读AI"，一位准确、克制、清楚的读书讲解员。你的任务是：
1. 结合当前书籍、章节、页码、页面文字和页面图片讲解内容。
2. 优先描述画面和文字中实际可见的信息，再提炼核心知识点。
3. 对漫画/插画页，只能依据图片中看得见的角色、文字、场景和构图讲解；不要编造动作、对白、身份、情绪或画外情节。
4. 如果需要推断，请明确说“可能”或“从上下文看”，并保持简短。
5. 不要写舞台动作或旁白，例如“笑着”“指向”“把书摊开”“咱们一起看”。
6. 不要使用 emoji，不要使用夸张口吻。
当用户说“这本书”“这一章”“这一页”“这里”时，默认指当前阅读位置。
请全程使用${name}回答，表达自然，但以准确为先。`;
    },

    // AI 讲解当前页（支持图片识别）
    async explainPage(pageText, onChunk, lang = 'zh-CN') {
        const isImagePage = !pageText || pageText.trim().length < 10;
        const readingContext = await Reader.getCurrentReadingContext(pageText);
        const messages = [
            { role: 'system', content: this.getSystemPrompt(lang) },
            { role: 'system', content: readingContext }
        ];
        if (this.context.length > 0) {
            messages.push({
                role: 'system',
                content: '之前已读内容摘要（仅作背景，不得替代当前页图片和当前页文字）：\n' + this.context.join('\n')
            });
        }
        messages.push({
            role: 'system',
            content: '回答当前页时，当前页面图片和当前页面文字优先级最高。如果当前页没有文字，不要从之前摘要里借用旧页面标题来描述当前页。'
        });

        // 提取页面图片
        const images = await Reader.getPageImages();
        const hasImages = images.length > 0;

        // 构建用户消息（支持 vision 格式）
        let userContent;
        const title = Reader.book?.title || '';

        if (hasImages) {
            // 多模态：文字 + 图片
            const textPart = isImagePage
                ? `这是《${title}》中的当前页。请先根据图片中实际可见的文字和画面讲解，不要编造看不见的细节。`
                  + (pageText?.trim() ? `\n页面文字：${pageText.trim()}` : '')
                : `请结合图片和文字内容讲解。先说这一页实际画了什么，再说明知识点；不要写舞台动作或臆测细节。\n\n页面文字：\n${pageText}`;
            userContent = [
                { type: 'text', text: textPart },
                ...images.map(b64 => ({
                    type: 'image_url',
                    image_url: { url: b64, detail: 'high' }
                }))
            ];
        } else {
            userContent = isImagePage
                ? `当前是《${title}》的一页，页面以图片为主，文字很少。` +
                  `当前没有成功提取到页面图片。请只说明无法可靠看图，不要编造画面内容。` +
                  (pageText?.trim() ? `\n页面文字：${pageText.trim()}` : '')
                : `请讲解以下内容：\n\n${pageText}`;
        }

        messages.push({ role: 'user', content: userContent });
        const result = await AIService.chat(messages, onChunk);
        if (!isImagePage) this.addContext(pageText);
        return result;
    },

    // 将页面内容压缩为摘要加入上下文
    async addContext(pageText) {
        const summary = pageText.length > 200
            ? pageText.substring(0, 200) + '...'
            : pageText;
        const loc = Reader.currentLocation;
        const label = loc
            ? `《${loc.bookTitle}》${loc.chapterTitle || '未知章节'} ${loc.pageLabel || ''}`
            : '未知位置';
        this.context.push(`${label}：${summary}`);
        // 只保留最近10页的上下文
        if (this.context.length > 10) this.context.shift();
    },

    // 生成互动卡片（确认用户理解）
    async generateQuizCard(pageText, onChunk) {
        const messages = [
            { role: 'system', content: `基于用户刚读完的内容，生成1-2个简短的互动问题来确认理解。
格式要求：用JSON数组返回，每个问题包含 question 和 hint 字段。
例如：[{"question":"这段的核心观点是什么？","hint":"关注作者对...的看法"}]
只返回JSON，不要其他文字。` },
            { role: 'user', content: pageText }
        ];
        return await AIService.chat(messages, onChunk);
    },

    // 划词提问（支持图片识别）
    async askAboutSelection(selectedText, question, onChunk) {
        const pageText = Reader.getCurrentText();
        const readingContext = await Reader.getCurrentReadingContext(pageText);
        const images = await Reader.getPageImages();
        
        const messages = [
            { role: 'system', content: this.getSystemPrompt('zh-CN') },
            { role: 'system', content: readingContext },
            { role: 'system', content: '当前页面内容文本：\n' + pageText }
        ];

        let userContent;
        if (images.length > 0) {
            userContent = [
                { type: 'text', text: `关于"${selectedText}"，我的问题是：${question}` },
                ...images.map(b64 => ({
                    type: 'image_url',
                    image_url: { url: b64, detail: 'high' }
                }))
            ];
        } else {
            userContent = `关于"${selectedText}"，我的问题是：${question}`;
        }

        messages.push({ role: 'user', content: userContent });
        return await AIService.chat(messages, onChunk);
    },

    // 重置上下文（换书时调用）
    reset() {
        this.context = [];
        this.isActive = false;
        this.targetLang = 'zh-CN';
    },

    // 多语言讲解
    async translateExplain(pageText, targetLang, onChunk) {
        const langNames = {
            'zh-CN': '中文', 'en': '英文', 'ja': '日文',
            'ko': '韩文', 'fr': '法文', 'de': '德文'
        };
        const langName = langNames[targetLang] || targetLang;
        const messages = [
            { role: 'system', content: `你是多语言读书讲解员。请用${langName}讲解以下内容。
如果原文不是${langName}，先翻译核心内容，再用${langName}进行深度解读。` },
            { role: 'user', content: pageText }
        ];
        return await AIService.chat(messages, onChunk);
    },

    // 图表/数据智能解读
    async describeChart(chartDescription, onChunk) {
        const messages = [
            { role: 'system', content: `你是数据可视化解读专家。用户描述了书中的一个图表/表格/数据。
请用通俗易懂的语言解读这个图表的含义、趋势和关键发现。` },
            { role: 'user', content: chartDescription }
        ];
        return await AIService.chat(messages, onChunk);
    }
};
