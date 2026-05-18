/* ===== 颜色生成与文件工具 ===== */

// 根据书名生成一致的渐变色
function generateBookGradient(title) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${h1},65%,35%), hsl(${h2},55%,25%))`;
}

// 从 EPUB 提取封面图（返回 base64 data URL 或 null）
async function extractEpubCover(arrayBuffer) {
    try {
        const zipLib = typeof JSZip !== 'undefined'
            ? JSZip
            : await window.SmartReadVendor?.ensureJSZip?.();
        if (!zipLib) return null;
        const zip = await zipLib.loadAsync(arrayBuffer.slice(0));
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) return null;

        const parser = new DOMParser();
        const containerXml = parser.parseFromString(await containerFile.async('text'), 'application/xml');
        const rootfile = containerXml.getElementsByTagName('rootfile')[0];
        const opfPath = rootfile?.getAttribute('full-path');
        if (!opfPath) return null;

        const opfFile = zip.file(opfPath);
        if (!opfFile) return null;
        const opfXml = parser.parseFromString(await opfFile.async('text'), 'application/xml');
        const items = Array.from(opfXml.getElementsByTagName('item'));
        const coverId = opfXml.querySelector('meta[name="cover"]')?.getAttribute('content');
        const coverItem = (coverId && items.find(item => item.getAttribute('id') === coverId)) ||
            items.find(item => (item.getAttribute('properties') || '').split(/\s+/).includes('cover-image')) ||
            items.find(item => /^image\//i.test(item.getAttribute('media-type') || '') &&
                /cover/i.test(`${item.getAttribute('id') || ''} ${item.getAttribute('href') || ''}`));
        const coverHref = coverItem?.getAttribute('href');
        if (!coverHref) return null;

        const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
        const coverPath = normalizeZipPath(baseDir ? `${baseDir}/${coverHref}` : coverHref);
        const caseMatchedPath = Object.keys(zip.files)
            .find(name => name.toLowerCase() === coverPath.toLowerCase());
        const coverFile = zip.file(coverPath) ||
            (caseMatchedPath ? zip.file(caseMatchedPath) : null);
        if (!coverFile) return null;

        const blob = await coverFile.async('blob');
        return await new Promise(resolve => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch { return null; }
}

function normalizeZipPath(path) {
    const parts = [];
    String(path || '').replace(/\\/g, '/').split('/').forEach(part => {
        if (!part || part === '.') return;
        if (part === '..') parts.pop();
        else parts.push(safeDecodeURIComponent(part));
    });
    return parts.join('/');
}

function safeDecodeURIComponent(value) {
    try { return decodeURIComponent(value); }
    catch { return value; }
}

// 生成唯一ID
function genId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// HTML 转义，防止用户内容或书籍内容注入页面
function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizeUrlInput(str) {
    return String(str ?? '').replace(/\s+/g, '').trim();
}

const MarkdownRenderer = {
    get() {
        if (typeof window === 'undefined' || !window.marked?.parse) return null;
        return window.marked;
    }
};

function renderMarkdownSafe(text) {
    const source = String(text ?? '');
    const markedLib = MarkdownRenderer.get();
    if (markedLib) {
        const escapedSource = escapeHTML(source);
        const html = markedLib.parse(escapedSource, {
            async: false,
            breaks: true,
            gfm: true
        });
        return sanitizeRenderedMarkdown(html);
    }
    return renderMarkdownFallback(source);
}

function sanitizeRenderedMarkdown(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowedTags = new Set([
        'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3',
        'H4', 'H5', 'H6', 'HR', 'LI', 'OL', 'P', 'PRE', 'S', 'STRONG',
        'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL'
    ]);

    template.content.querySelectorAll('*').forEach(el => {
        if (!allowedTags.has(el.tagName)) {
            el.replaceWith(...Array.from(el.childNodes));
            return;
        }

        const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
        Array.from(el.attributes).forEach(attr => el.removeAttribute(attr.name));
        if (el.tagName === 'A') {
            if (isSafeMarkdownUrl(href)) {
                el.setAttribute('href', href);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
            } else {
                el.removeAttribute('href');
            }
        }
    });

    return template.innerHTML;
}

function isSafeMarkdownUrl(url) {
    const raw = String(url || '').trim().toLowerCase();
    return raw.startsWith('http://') ||
        raw.startsWith('https://') ||
        raw.startsWith('mailto:') ||
        raw.startsWith('#') ||
        raw.startsWith('/');
}

function renderMarkdownFallback(text) {
    return escapeHTML(text)
        .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
        .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
        .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

// 读取文件内容为文本
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// 读取文件为ArrayBuffer
function readFileAsBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

// 将长文本按页分割（每页约800字）
function splitTextToPages(text, charsPerPage = 800) {
    const pages = [];
    const paragraphs = text.split(/\n\s*\n/);
    let current = '';
    for (const p of paragraphs) {
        if ((current + p).length > charsPerPage && current) {
            pages.push(current.trim());
            current = p + '\n\n';
        } else {
            current += p + '\n\n';
        }
    }
    if (current.trim()) pages.push(current.trim());
    return pages.length ? pages : [text];
}
