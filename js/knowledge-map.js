/* ===== 知识图谱/思维导图模块 ===== */
const KnowledgeMap = {
    data: { title: '', children: [] },

    // AI 生成当前已读内容的知识结构
    async generate(bookTitle, pagesRead) {
        const summary = pagesRead.map((p, i) =>
            `第${i + 1}页：${p.substring(0, 150)}`
        ).join('\n');

        const messages = [
            { role: 'system', content: `你是知识结构分析专家。请将用户已阅读的书籍内容整理为思维导图结构。
返回严格的JSON格式（不要markdown代码块），结构如下：
{"title":"书名","children":[{"title":"主题1","children":[{"title":"要点1"},{"title":"要点2"}]},{"title":"主题2","children":[]}]}
最多3层深度，每层最多5个节点。只返回JSON。` },
            { role: 'user', content: `书名：${bookTitle}\n已读内容：\n${summary}` }
        ];
        const raw = await AIService.chat(messages);
        try {
            const match = raw.match(/\{[\s\S]*\}/);
            this.data = JSON.parse(match ? match[0] : raw);
        } catch {
            this.data = { title: bookTitle, children: [{ title: '解析失败，请重试' }] };
        }
        return this.data;
    },

    // 渲染思维导图到容器
    render(container) {
        container.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '500');
        svg.style.minWidth = '600px';
        container.appendChild(svg);
        this.drawNode(svg, this.data, 300, 30, 0, 580, 0);
    },

    drawNode(svg, node, x, y, minX, maxX, depth) {
        const colors = ['#e8b34a', '#6ec6ff', '#81c784', '#ff8a65', '#ba68c8'];
        const color = colors[depth % colors.length];
        const r = depth === 0 ? 8 : 5;
        const fontSize = depth === 0 ? 14 : 12;

        // 绘制圆点
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x); circle.setAttribute('cy', y);
        circle.setAttribute('r', r); circle.setAttribute('fill', color);
        svg.appendChild(circle);

        // 绘制文字
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x); text.setAttribute('y', y - r - 6);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#1d1d1f'); text.setAttribute('font-size', fontSize);
        text.textContent = (node.title || '').substring(0, 15);
        svg.appendChild(text);

        // 递归绘制子节点
        if (!node.children || !node.children.length) return;
        const count = node.children.length;
        const childWidth = (maxX - minX) / count;
        const childY = y + 80;

        node.children.forEach((child, i) => {
            const childX = minX + childWidth * i + childWidth / 2;
            // 连线
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x); line.setAttribute('y1', y + r);
            line.setAttribute('x2', childX); line.setAttribute('y2', childY - 5);
            line.setAttribute('stroke', color); line.setAttribute('stroke-width', 1.5);
            line.setAttribute('opacity', '0.4');
            svg.appendChild(line);

            this.drawNode(svg, child, childX, childY,
                minX + childWidth * i, minX + childWidth * (i + 1), depth + 1);
        });
    }
};

