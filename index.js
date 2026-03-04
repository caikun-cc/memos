const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { marked } = require('marked');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8022;
const MEMOS_DIR = path.join(__dirname, 'memos');

// ========== 简单缓存 ==========
const cache = {
    memos: null,
    tags: null,
    lastUpdate: 0,
    TTL: 5000 // 5秒缓存
};

function invalidateCache() {
    cache.memos = null;
    cache.tags = null;
    cache.lastUpdate = 0;
}

async function isCacheValid() {
    return cache.memos && (Date.now() - cache.lastUpdate) < cache.TTL;
}

// ========== 确保备忘录目录存在 ==========
async function ensureMemosDir() {
    try {
        await fs.access(MEMOS_DIR);
    } catch {
        await fs.mkdir(MEMOS_DIR, { recursive: true });
    }
}

// 初始化时创建目录
ensureMemosDir();

// ========== 中间件 ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== 日志中间件 ==========
const logColors = {
    reset: '\x1b[0m',
    status: (code) => code < 400 ? '\x1b[32m' : '\x1b[31m',
    method: {
        'GET': '\x1b[36m',
        'POST': '\x1b[33m',
        'PUT': '\x1b[34m',
        'DELETE': '\x1b[35m'
    }
};

app.use((req, res, next) => {
    const start = Date.now();
    const timestamp = new Date().toLocaleString('zh-CN', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { reset } = logColors;
        const statusColor = logColors.status(res.statusCode);
        const methodColor = logColors.method[req.method] || '';
        
        console.log(`[${timestamp}] ${methodColor}${req.method}${reset} ${req.url} ${statusColor}${res.statusCode}${reset} - ${duration}ms`);
    });
    
    next();
});

// ========== 输入验证中间件 ==========
function validateMemoInput(req, res, next) {
    const { title, content, tags } = req.body;
    
    // 标题验证
    if (title !== undefined) {
        if (typeof title !== 'string') {
            return res.status(400).json({ success: false, error: '标题必须是字符串' });
        }
        if (title.length > 200) {
            return res.status(400).json({ success: false, error: '标题长度不能超过200字符' });
        }
    }
    
    // 内容验证
    if (content !== undefined) {
        if (typeof content !== 'string') {
            return res.status(400).json({ success: false, error: '内容必须是字符串' });
        }
        if (content.length > 100000) {
            return res.status(400).json({ success: false, error: '内容长度不能超过100000字符' });
        }
    }
    
    // 标签验证
    if (tags !== undefined) {
        if (!Array.isArray(tags)) {
            return res.status(400).json({ success: false, error: '标签必须是数组' });
        }
        if (tags.length > 20) {
            return res.status(400).json({ success: false, error: '标签数量不能超过20个' });
        }
        for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length > 50) {
                return res.status(400).json({ success: false, error: '每个标签长度不能超过50字符' });
            }
        }
    }
    
    next();
}

// ========== XSS 防护配置 ==========
marked.setOptions({
    mangle: false,
    headerIds: false
});

// 简单的 XSS 过滤（移除 script 标签和危险属性）
function sanitizeHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/on\w+='[^']*'/gi, '')
        .replace(/javascript:/gi, '');
}

// ========== 辅助函数 ==========
async function readAllMemos() {
    // 检查缓存
    if (await isCacheValid()) {
        return cache.memos;
    }
    
    const files = await fs.readdir(MEMOS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    const memos = await Promise.all(
        jsonFiles.map(async file => {
            const content = await fs.readFile(path.join(MEMOS_DIR, file), 'utf-8');
            return JSON.parse(content);
        })
    );
    
    // 更新缓存
    cache.memos = memos;
    cache.lastUpdate = Date.now();
    
    return memos;
}

// ========== API 路由 ==========

// 获取所有标签
app.get('/api/tags', async (req, res) => {
    try {
        const memos = await readAllMemos();
        const tagsSet = new Set();
        
        memos.forEach(memo => {
            if (memo.tags && Array.isArray(memo.tags)) {
                memo.tags.forEach(tag => tagsSet.add(tag));
            }
        });
        
        res.json({ success: true, data: Array.from(tagsSet).sort() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取所有备忘录列表
app.get('/api/memos', async (req, res) => {
    try {
        const { tag } = req.query;
        const memos = await readAllMemos();
        
        let result = memos.map(memo => {
            const previewText = memo.content.substring(0, 300);
            const rawHtml = marked(previewText);
            const previewHtml = sanitizeHtml(rawHtml);
            return {
                id: memo.id,
                title: memo.title,
                tags: memo.tags || [],
                createdAt: memo.createdAt,
                updatedAt: memo.updatedAt,
                pinned: memo.pinned || false,
                preview: memo.content.substring(0, 100),
                previewHtml,
                hasMore: memo.content.length > 300
            };
        }).sort((a, b) => {
            // 置顶优先
            if (a.pinned !== b.pinned) {
                return b.pinned ? 1 : -1;
            }
            // 然后按更新时间排序
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
        
        // 按标签筛选
        if (tag) {
            result = result.filter(m => m.tags.includes(tag));
        }
        
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取单个备忘录
app.get('/api/memos/:id', async (req, res) => {
    try {
        const filePath = path.join(MEMOS_DIR, `${req.params.id}.json`);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        const content = await fs.readFile(filePath, 'utf-8');
        const memo = JSON.parse(content);
        res.json({ success: true, data: memo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 创建备忘录
app.post('/api/memos', validateMemoInput, async (req, res) => {
    try {
        const { title, content, tags } = req.body;
        const id = uuidv4();
        const now = new Date().toISOString();
        const memo = {
            id,
            title: title || '无标题',
            content: content || '',
            tags: tags || [],
            pinned: false,
            createdAt: now,
            updatedAt: now
        };
        
        await fs.writeFile(path.join(MEMOS_DIR, `${id}.json`), JSON.stringify(memo, null, 2));
        invalidateCache();
        res.json({ success: true, data: memo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 更新备忘录
app.put('/api/memos/:id', validateMemoInput, async (req, res) => {
    try {
        const filePath = path.join(MEMOS_DIR, `${req.params.id}.json`);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        const existing = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        const updated = {
            ...existing,
            title: req.body.title ?? existing.title,
            content: req.body.content ?? existing.content,
            tags: req.body.tags ?? existing.tags ?? [],
            updatedAt: new Date().toISOString()
        };
        
        await fs.writeFile(filePath, JSON.stringify(updated, null, 2));
        invalidateCache();
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 切换置顶状态
app.patch('/api/memos/:id/pinned', async (req, res) => {
    try {
        const filePath = path.join(MEMOS_DIR, `${req.params.id}.json`);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        const existing = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        const updated = {
            ...existing,
            pinned: !existing.pinned,
            updatedAt: new Date().toISOString()
        };
        
        await fs.writeFile(filePath, JSON.stringify(updated, null, 2));
        invalidateCache();
        res.json({ success: true, data: { id: req.params.id, pinned: updated.pinned } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 删除备忘录
app.delete('/api/memos/:id', async (req, res) => {
    try {
        const filePath = path.join(MEMOS_DIR, `${req.params.id}.json`);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        await fs.unlink(filePath);
        invalidateCache();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 渲染Markdown
app.post('/api/render', async (req, res) => {
    try {
        const rawHtml = marked(req.body.content || '');
        const safeHtml = sanitizeHtml(rawHtml);
        res.json({ success: true, html: safeHtml });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
