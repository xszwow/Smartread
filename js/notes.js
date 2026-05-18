/* ===== 读书笔记模块 ===== */
const Notes = {
    KEY_PREFIX: 'smartread_notes_',

    getAll(bookId) {
        try {
            const raw = localStorage.getItem(this.KEY_PREFIX + bookId);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    },

    save(bookId, notes) {
        localStorage.setItem(this.KEY_PREFIX + bookId, JSON.stringify(notes));
    },

    add(bookId, page, text, note) {
        const notes = this.getAll(bookId);
        notes.push({
            id: genId(), page, text, note,
            createdAt: Date.now()
        });
        this.save(bookId, notes);
        return notes;
    },

    remove(bookId, noteId) {
        let notes = this.getAll(bookId);
        notes = notes.filter(n => n.id !== noteId);
        this.save(bookId, notes);
        return notes;
    },

    // AI 辅助生成读书笔记
    async generateNote(pageText, onChunk) {
        const messages = [
            { role: 'system', content: `你是一个读书笔记助手。根据用户提供的书籍内容，生成结构化的读书笔记。
格式：用 Markdown，包含【核心观点】【关键概念】【个人思考引导】三个部分。简洁有力。` },
            { role: 'user', content: pageText }
        ];
        return await AIService.chat(messages, onChunk);
    }
};
