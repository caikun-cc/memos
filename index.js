const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { marked } = require('marked');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8022;
const MEMOS_DIR = path.join(__dirname, 'memos');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ========== 配置管理 ==========
let config = {
    password: 'admin123',
    jwtSecret: 'default-secret-key',
    tokenExpiresIn: '7d'
};

async function loadConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        config = JSON.parse(data);
    } catch (error) {
        // 配置文件不存在，使用默认值并创建
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
}

async function saveConfig() {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 初始化配置
loadConfig();

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

// ========== 认证中间件 ==========
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: '未登录', code: 'UNAUTHORIZED' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.user = decoded;
        
        // 滑动刷新：检查token剩余有效期，如果小于1天则刷新
        const tokenExp = decoded.exp * 1000; // 转换为毫秒
        const now = Date.now();
        const remainingTime = tokenExp - now;
        const oneDay = 24 * 60 * 60 * 1000; // 1天的毫秒数
        
        if (remainingTime < oneDay && remainingTime > 0) {
            const newToken = generateToken(decoded.loginTime);
            res.setHeader('X-New-Token', newToken);
        }
        
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: '登录已过期，请重新登录', code: 'TOKEN_EXPIRED' });
    }
}

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

// 获取备忘录文件路径
function getMemoPath(id) {
    return path.join(MEMOS_DIR, `${id}.json`);
}

// 检查备忘录是否存在
async function memoExists(id) {
    try {
        await fs.access(getMemoPath(id));
        return true;
    } catch {
        return false;
    }
}

// 生成 JWT token
function generateToken(loginTime) {
    return jwt.sign(
        { loginTime },
        config.jwtSecret,
        { expiresIn: config.tokenExpiresIn }
    );
}

// ========== API 路由 ==========

// ========== 认证 API ==========
// 登录
app.post('/api/auth/login', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({ success: false, error: '请输入密码' });
        }
        
        if (password !== config.password) {
            return res.status(401).json({ success: false, error: '密码错误' });
        }
        
        const token = generateToken(new Date().toISOString());
        
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 验证 token
app.get('/api/auth/verify', authMiddleware, (req, res) => {
    res.json({ success: true, message: 'Token 有效' });
});

// 获取当前配置（不返回密码）
app.get('/api/auth/config', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: {
            tokenExpiresIn: config.tokenExpiresIn
        }
    });
});

// 修改配置
app.post('/api/auth/config', authMiddleware, async (req, res) => {
    try {
        const { oldPassword, newPassword, tokenExpiresIn, jwtSecret } = req.body;
        let needNewToken = false;
        
        // 如果要修改密码，需要验证原密码
        if (newPassword) {
            if (!oldPassword) {
                return res.status(400).json({ success: false, error: '请输入原密码' });
            }
            if (oldPassword !== config.password) {
                return res.status(400).json({ success: false, error: '原密码错误' });
            }
            if (newPassword.length < 4) {
                return res.status(400).json({ success: false, error: '新密码长度至少4位' });
            }
            config.password = newPassword;
            // 修改密码时自动重新生成JWT密钥，使旧token失效
            config.jwtSecret = crypto.randomBytes(32).toString('hex');
            needNewToken = true;
        }
        
        // 修改过期时间
        if (tokenExpiresIn) {
            const validFormats = /^\d+[hdmy]$/; // 如 7d, 24h, 1m, 1y
            if (!validFormats.test(tokenExpiresIn)) {
                return res.status(400).json({ success: false, error: '过期时间格式错误，如：7d, 24h, 1m, 1y' });
            }
            config.tokenExpiresIn = tokenExpiresIn;
        }
        
        // 修改JWT密钥
        if (jwtSecret) {
            if (jwtSecret.length < 16) {
                return res.status(400).json({ success: false, error: 'JWT密钥长度至少16位' });
            }
            config.jwtSecret = jwtSecret;
            needNewToken = true;
        }
        
        await saveConfig();
        
        // 如果需要新token，生成并返回
        if (needNewToken) {
            return res.json({ success: true, message: '配置已保存', token: generateToken(new Date().toISOString()) });
        }
        
        res.json({ success: true, message: '配置已保存' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取所有标签
app.get('/api/tags', authMiddleware, async (req, res) => {
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
app.get('/api/memos', authMiddleware, async (req, res) => {
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
app.get('/api/memos/:id', authMiddleware, async (req, res) => {
    try {
        if (!await memoExists(req.params.id)) {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        const memo = JSON.parse(await fs.readFile(getMemoPath(req.params.id), 'utf-8'));
        res.json({ success: true, data: memo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 创建备忘录
app.post('/api/memos', authMiddleware, validateMemoInput, async (req, res) => {
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
        
        await fs.writeFile(getMemoPath(id), JSON.stringify(memo, null, 2));
        invalidateCache();
        res.json({ success: true, data: memo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 更新备忘录
app.put('/api/memos/:id', authMiddleware, validateMemoInput, async (req, res) => {
    try {
        if (!await memoExists(req.params.id)) {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        const filePath = getMemoPath(req.params.id);
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
app.patch('/api/memos/:id/pinned', authMiddleware, async (req, res) => {
    try {
        if (!await memoExists(req.params.id)) {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        const filePath = getMemoPath(req.params.id);
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
app.delete('/api/memos/:id', authMiddleware, async (req, res) => {
    try {
        if (!await memoExists(req.params.id)) {
            return res.status(404).json({ success: false, error: '备忘录不存在' });
        }
        
        await fs.unlink(getMemoPath(req.params.id));
        invalidateCache();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 渲染Markdown
app.post('/api/render', authMiddleware, async (req, res) => {
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
