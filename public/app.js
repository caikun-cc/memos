// ========== 状态管理 ==========
const state = {
    currentMemoId: null,
    isNewMemo: false,
    memoList: [],
    allTags: [],
    currentFilterTag: null,
    currentTags: [],
    isPreviewMode: false,
    pendingAction: null,
    searchKeyword: '',
    currentMonth: new Date(),
    token: localStorage.getItem('token'),
    isLoggedIn: false
};

// ========== DOM 元素 ==========
const DOM = {
    loginView: document.getElementById('loginView'),
    homeView: document.getElementById('homeView'),
    editorView: document.getElementById('editorView'),
    loginForm: document.getElementById('loginForm'),
    passwordInput: document.getElementById('passwordInput'),
    loginError: document.getElementById('loginError'),
    memoListHome: document.getElementById('memoListHome'),
    tagListEl: document.getElementById('tagList'),
    titleInput: document.getElementById('titleInput'),
    contentEditor: document.getElementById('contentEditor'),
    editorPane: document.getElementById('editorPane'),
    tagsContainer: document.getElementById('tagsContainer'),
    tagInput: document.getElementById('tagInput'),
    previewPane: document.getElementById('previewPane'),
    previewContent: document.getElementById('previewContent'),
    previewBtn: document.getElementById('previewBtn'),
    lastSaved: document.getElementById('lastSaved'),
    confirmModal: document.getElementById('confirmModal'),
    confirmMessage: document.getElementById('confirmMessage'),
    searchInput: document.getElementById('searchInput'),
    calendarDays: document.getElementById('calendarDays'),
    calendarTitle: document.getElementById('calendarTitle'),
    listTitle: document.getElementById('listTitle'),
    memoCount: document.getElementById('memoCount'),
    toolbarTitle: document.getElementById('toolbarTitle'),
    deleteBtnText: document.getElementById('deleteBtnText'),
    // 统计相关
    totalMemos: document.getElementById('totalMemos'),
    totalTags: document.getElementById('totalTags'),
    todayMemos: document.getElementById('todayMemos'),
    // 设置相关
    settingsModal: document.getElementById('settingsModal'),
    oldPasswordInput: document.getElementById('oldPasswordInput'),
    newPasswordInput: document.getElementById('newPasswordInput'),
    tokenExpiresInput: document.getElementById('tokenExpiresInput'),
    jwtSecretInput: document.getElementById('jwtSecretInput'),
    settingsError: document.getElementById('settingsError')
};

// ========== 工具函数 ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;

    return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ========== Toast 提示 ==========
function showToast(message, type = 'info') {
    // 移除已存在的 toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ========== API 调用 ==========
async function fetchAPI(url, options = {}) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        
        // 添加 token
        if (state.token) {
            headers['Authorization'] = `Bearer ${state.token}`;
        }
        
        const response = await fetch(url, {
            headers,
            ...options
        });
        const data = await response.json();
        
        // 处理认证错误
        if (response.status === 401) {
            handleAuthError(data);
            return { success: false, error: data.error, code: data.code };
        }
        
        // 滑动刷新：检查是否有新token
        const newToken = response.headers.get('X-New-Token');
        if (newToken) {
            state.token = newToken;
            localStorage.setItem('token', newToken);
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showToast(error.message || '网络请求失败', 'error');
        return { success: false, error: error.message };
    }
}

// ========== 认证相关 ==========
function handleAuthError(error) {
    state.token = null;
    state.isLoggedIn = false;
    localStorage.removeItem('token');
    showLogin();
    if (error.code === 'TOKEN_EXPIRED') {
        showToast('登录已过期，请重新登录', 'warning');
    }
}

function showLogin() {
    DOM.loginView.classList.remove('hidden');
    DOM.homeView.style.display = 'none';
    DOM.editorView.style.display = 'none';
    DOM.loginError.textContent = '';
    DOM.passwordInput.value = '';
    DOM.passwordInput.focus();
}

function showApp() {
    DOM.loginView.classList.add('hidden');
    DOM.homeView.style.display = 'flex';
}

async function handleLogin(e) {
    e.preventDefault();
    
    const password = DOM.passwordInput.value;
    if (!password) {
        DOM.loginError.textContent = '请输入密码';
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await response.json();
        
        if (data.success) {
            state.token = data.token;
            state.isLoggedIn = true;
            localStorage.setItem('token', data.token);
            showApp();
            loadMemoList();
            loadTags();
            renderCalendar();
        } else {
            DOM.loginError.textContent = data.error || '登录失败';
        }
    } catch (error) {
        DOM.loginError.textContent = '网络错误，请重试';
    }
}

async function checkAuth() {
    if (!state.token) {
        showLogin();
        return false;
    }
    
    const result = await fetchAPI('/api/auth/verify');
    if (result.success) {
        state.isLoggedIn = true;
        showApp();
        return true;
    } else {
        showLogin();
        return false;
    }
}

// ========== 设置相关 ==========
async function openSettings() {
    // 加载当前配置
    const result = await fetchAPI('/api/auth/config');
    if (result.success) {
        DOM.tokenExpiresInput.value = result.data.tokenExpiresIn;
    }
    
    // 清空其他字段
    DOM.oldPasswordInput.value = '';
    DOM.newPasswordInput.value = '';
    DOM.jwtSecretInput.value = '';
    DOM.settingsError.textContent = '';
    
    DOM.settingsModal.classList.add('show');
}

function closeSettings() {
    DOM.settingsModal.classList.remove('show');
}

async function saveSettings() {
    const oldPassword = DOM.oldPasswordInput.value.trim();
    const newPassword = DOM.newPasswordInput.value.trim();
    const tokenExpiresIn = DOM.tokenExpiresInput.value.trim();
    const jwtSecret = DOM.jwtSecretInput.value.trim();
    
    // 检查是否有修改
    if (!oldPassword && !newPassword && !tokenExpiresIn && !jwtSecret) {
        DOM.settingsError.textContent = '没有要保存的修改';
        return;
    }
    
    // 如果修改密码，需要填写原密码
    if (newPassword && !oldPassword) {
        DOM.settingsError.textContent = '修改密码需要输入原密码';
        return;
    }
    
    const body = {};
    if (newPassword) {
        body.oldPassword = oldPassword;
        body.newPassword = newPassword;
    }
    if (tokenExpiresIn) {
        body.tokenExpiresIn = tokenExpiresIn;
    }
    if (jwtSecret) {
        body.jwtSecret = jwtSecret;
    }
    
    const result = await fetchAPI('/api/auth/config', {
        method: 'POST',
        body: JSON.stringify(body)
    });
    
    if (result.success) {
        // 如果返回了新token，更新本地token
        if (result.token) {
            state.token = result.token;
            localStorage.setItem('token', result.token);
        }
        
        showToast('设置已保存', 'success');
        closeSettings();
        
        // 清空输入框
        DOM.oldPasswordInput.value = '';
        DOM.newPasswordInput.value = '';
        DOM.jwtSecretInput.value = '';
        DOM.settingsError.textContent = '';
    } else {
        DOM.settingsError.textContent = result.error || '保存失败';
    }
}

// ========== 备忘录列表 ==========
async function loadMemoList() {
    const url = state.currentFilterTag ? `/api/memos?tag=${encodeURIComponent(state.currentFilterTag)}` : '/api/memos';
    const result = await fetchAPI(url);
    if (result.success) {
        state.memoList = result.data;
        updateStats();
        renderMemoList();
        renderCalendar();
    }
}

async function loadTags() {
    const result = await fetchAPI('/api/tags');
    if (result.success) {
        state.allTags = result.data;
        renderTagList();
        updateStats();
    }
}

function updateStats() {
    DOM.totalMemos.textContent = state.memoList.length;
    DOM.totalTags.textContent = state.allTags.length;

    const today = new Date().toDateString();
    const todayCount = state.memoList.filter(m => new Date(m.createdAt).toDateString() === today).length;
    DOM.todayMemos.textContent = todayCount;
}

function renderTagList() {
    DOM.tagListEl.innerHTML = '';

    if (state.allTags.length === 0) {
        return;
    }

    state.allTags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = `filter-tag ${tag === state.currentFilterTag ? 'active' : ''}`;
        tagEl.textContent = tag;
        tagEl.onclick = () => filterByTag(tag);
        DOM.tagListEl.appendChild(tagEl);
    });
}

function filterByTag(tag) {
    if (state.currentFilterTag === tag) {
        tag = null; // 取消筛选
    }
    state.currentFilterTag = tag;
    DOM.listTitle.textContent = tag ? `标签: ${tag}` : '全部备忘录';
    loadMemoList();
    renderTagList();
}

function clearTagFilter() {
    filterByTag(null);
}

function searchMemos() {
    state.searchKeyword = DOM.searchInput.value.toLowerCase().trim();
    renderMemoList();
}

// 排序函数：置顶优先，然后按更新时间
function sortMemos(memos) {
    return [...memos].sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

// ========== 卡片渲染（提取公共逻辑） ==========
function createMemoCard(memo) {
    const card = document.createElement('div');
    card.className = `memo-card ${memo.pinned ? 'pinned' : ''}`;

    const date = new Date(memo.updatedAt);
    const dateStr = formatDate(date);

    let tagsHtml = '';
    if (memo.tags && memo.tags.length > 0) {
        tagsHtml = `<div class="memo-card-tags">
            ${memo.tags.slice(0, 3).map(t => `<span class="memo-card-tag">${escapeHtml(t)}</span>`).join('')}
            ${memo.tags.length > 3 ? `<span class="memo-card-tag">+${memo.tags.length - 3}</span>` : ''}
        </div>`;
    }

    card.innerHTML = `
        <div class="memo-card-header">
            <div class="memo-card-title">
                ${memo.pinned ? '<span class="pin-icon">📌</span>' : ''}
                ${escapeHtml(memo.title)}
            </div>
            <div class="memo-card-actions">
                <button class="pin-btn ${memo.pinned ? 'pinned' : ''}" onclick="event.stopPropagation(); togglePin('${memo.id}')" title="${memo.pinned ? '取消置顶' : '置顶'}">
                    ${memo.pinned ? '📌' : '📍'}
                </button>
                <span class="memo-card-date">${dateStr}</span>
            </div>
        </div>
        <div class="memo-card-preview markdown-preview collapsed">${memo.previewHtml || escapeHtml(memo.preview)}</div>
        ${memo.hasMore ? '<button class="expand-btn" onclick="event.stopPropagation(); toggleExpand(this)">展开</button>' : ''}
        ${tagsHtml}
    `;

    card.onclick = (e) => {
        if (!e.target.closest('.pin-btn')) {
            openMemo(memo.id);
        }
    };

    return card;
}

function renderMemoList(filteredList = null) {
    let list = filteredList || state.memoList;

    // 搜索过滤
    if (!filteredList && state.searchKeyword) {
        list = state.memoList.filter(m =>
            m.title.toLowerCase().includes(state.searchKeyword) ||
            m.preview.toLowerCase().includes(state.searchKeyword)
        );
    }

    DOM.memoCount.textContent = `${list.length} 条`;

    // 首页列表
    DOM.memoListHome.innerHTML = '';

    if (list.length === 0) {
        DOM.memoListHome.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-muted);"><div style="font-size: 48px; margin-bottom: 16px;">📭</div><p>暂无备忘录</p></div>';
        return;
    }

    list.forEach(memo => {
        DOM.memoListHome.appendChild(createMemoCard(memo));
    });
}

// ========== 备忘录操作 ==========
function createNewMemo() {
    state.isNewMemo = true;
    state.currentMemoId = null;
    state.currentTags = [];

    // 进入编辑页面
    DOM.homeView.style.display = 'none';
    DOM.editorView.style.display = 'flex';

    // 重置编辑器状态
    DOM.titleInput.value = '';
    DOM.toolbarTitle.textContent = '新建备忘录';
    DOM.contentEditor.value = '';
    DOM.lastSaved.textContent = '未保存';

    // 重置预览模式
    state.isPreviewMode = false;
    DOM.previewBtn.classList.remove('active');
    DOM.editorPane.style.display = 'flex';
    DOM.previewPane.style.display = 'none';

    // 渲染空标签
    renderTags();

    // 新建模式下删除按钮显示"取消"
    DOM.deleteBtnText.textContent = '取消';

    // 聚焦标题输入框
    DOM.titleInput.focus();
}

function goHome() {
    DOM.homeView.style.display = 'flex';
    DOM.editorView.style.display = 'none';
    state.currentMemoId = null;
    state.isNewMemo = false;
}

function openMemo(id) {
    state.isNewMemo = false;
    state.currentMemoId = id;
    DOM.homeView.style.display = 'none';
    DOM.editorView.style.display = 'flex';
    // 非新建备忘录默认显示预览
    state.isPreviewMode = true;
    DOM.previewBtn.classList.add('active');
    DOM.editorPane.style.display = 'none';
    DOM.previewPane.style.display = 'block';
    // 编辑模式下删除按钮显示"删除"
    DOM.deleteBtnText.textContent = '删除';
    selectMemo(id);
}

async function selectMemo(id) {
    const result = await fetchAPI(`/api/memos/${id}`);
    if (result.success) {
        state.currentMemoId = id;
        const memo = result.data;

        DOM.titleInput.value = memo.title;
        DOM.toolbarTitle.textContent = memo.title || '编辑备忘录';
        DOM.contentEditor.value = memo.content;
        state.currentTags = memo.tags || [];
        renderTags();
        DOM.lastSaved.textContent = `最后保存：${formatDate(new Date(memo.updatedAt))}`;

        // 如果预览模式开启，更新预览
        if (state.isPreviewMode) {
            updatePreview();
        }
    }
}

// ========== 创建备忘录 ==========
async function createMemo(silent = false) {
    const result = await fetchAPI('/api/memos', {
        method: 'POST',
        body: JSON.stringify({
            title: DOM.titleInput.value || '无标题',
            content: DOM.contentEditor.value,
            tags: state.currentTags
        })
    });

    if (result.success) {
        state.isNewMemo = false;
        state.currentMemoId = result.data.id;
        DOM.lastSaved.textContent = `最后保存：${formatDate(new Date())}`;
        DOM.toolbarTitle.textContent = DOM.titleInput.value || '编辑备忘录';
        DOM.deleteBtnText.textContent = '删除';
        await loadMemoList();
        await loadTags();

        if (!silent) {
            showSaveSuccess();
        }
        showToast('备忘录创建成功', 'success');
    } else {
        showToast('创建失败，请重试', 'error');
    }
}

// ========== 更新备忘录 ==========
async function updateMemo(silent = false) {
    if (!state.currentMemoId) return;

    const result = await fetchAPI(`/api/memos/${state.currentMemoId}`, {
        method: 'PUT',
        body: JSON.stringify({
            title: DOM.titleInput.value,
            content: DOM.contentEditor.value,
            tags: state.currentTags
        })
    });

    if (result.success) {
        DOM.lastSaved.textContent = `最后保存：${formatDate(new Date())}`;
        DOM.toolbarTitle.textContent = DOM.titleInput.value || '编辑备忘录';
        await loadMemoList();
        await loadTags();

        if (!silent) {
            showSaveSuccess();
        }
    } else {
        showToast('保存失败，请重试', 'error');
    }
}

// ========== 统一保存入口 ==========
async function saveMemo(silent = false) {
    if (state.isNewMemo) {
        return createMemo(silent);
    }
    return updateMemo(silent);
}

function showSaveSuccess() {
    const btn = document.querySelector('.btn-save');
    const originalText = btn.textContent;
    btn.textContent = '已保存 ✓';
    setTimeout(() => btn.textContent = originalText, 1500);
}

function deleteMemo() {
    // 新建模式下不能删除，直接返回首页
    if (state.isNewMemo) {
        goHome();
        return;
    }

    if (!state.currentMemoId) return;

    state.pendingAction = async () => {
        const result = await fetchAPI(`/api/memos/${state.currentMemoId}`, {
            method: 'DELETE'
        });

        if (result.success) {
            state.currentMemoId = null;
            goHome();
            await loadMemoList();
            showToast('备忘录已删除', 'success');
        } else {
            showToast('删除失败，请重试', 'error');
        }
    };

    DOM.confirmMessage.textContent = '确定要删除这个备忘录吗？此操作不可撤销。';
    DOM.confirmModal.classList.add('show');
}

// ========== 预览功能 ==========
async function togglePreview() {
    state.isPreviewMode = !state.isPreviewMode;

    if (state.isPreviewMode) {
        DOM.previewBtn.classList.add('active');
        DOM.editorPane.style.display = 'none';
        DOM.previewPane.style.display = 'block';
        await updatePreview();
    } else {
        DOM.previewBtn.classList.remove('active');
        DOM.editorPane.style.display = 'flex';
        DOM.previewPane.style.display = 'none';
    }
}

async function updatePreview() {
    const result = await fetchAPI('/api/render', {
        method: 'POST',
        body: JSON.stringify({ content: DOM.contentEditor.value })
    });

    if (result.success) {
        DOM.previewContent.innerHTML = result.html;
    }
}

// ========== 模态框 ==========
function closeModal() {
    DOM.confirmModal.classList.remove('show');
    state.pendingAction = null;
}

async function confirmAction() {
    if (state.pendingAction) {
        await state.pendingAction();
    }
    closeModal();
}

// ========== 标签管理 ==========
function renderTags() {
    DOM.tagsContainer.innerHTML = '';
    state.currentTags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag';
        tagEl.innerHTML = `
            ${escapeHtml(tag)}
            <button class="tag-remove" onclick="removeTag('${escapeHtml(tag)}')">×</button>
        `;
        DOM.tagsContainer.appendChild(tagEl);
    });
}

function addTag(tag) {
    if (!state.currentTags.includes(tag)) {
        state.currentTags.push(tag);
        renderTags();
        // 只有编辑模式才自动保存
        if (!state.isNewMemo && state.currentMemoId) {
            saveMemo(true);
        }
    }
}

function removeTag(tag) {
    state.currentTags = state.currentTags.filter(t => t !== tag);
    renderTags();
    // 只有编辑模式才自动保存
    if (!state.isNewMemo && state.currentMemoId) {
        saveMemo(true);
    }
}

// ========== 日历功能 ==========
function renderCalendar() {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();

    DOM.calendarTitle.textContent = `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const totalDays = lastDay.getDate();

    // 获取有备忘录的日期
    const memoDates = new Set();
    state.memoList.forEach(memo => {
        const date = new Date(memo.createdAt);
        if (date.getFullYear() === year && date.getMonth() === month) {
            memoDates.add(date.getDate());
        }
    });

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    let html = '';

    // 上月的日期
    const prevMonth = new Date(year, month, 0);
    const prevDays = prevMonth.getDate();
    for (let i = startDay - 1; i >= 0; i--) {
        html += `<span class="cal-day other-month">${prevDays - i}</span>`;
    }

    // 当月的日期
    for (let i = 1; i <= totalDays; i++) {
        const isToday = isCurrentMonth && i === today.getDate();
        const hasMemo = memoDates.has(i);
        let classes = 'cal-day';
        if (isToday) classes += ' today';
        if (hasMemo) classes += ' has-memo';
        html += `<span class="${classes}" data-year="${year}" data-month="${month}" data-day="${i}">${i}</span>`;
    }

    // 下月的日期
    const remaining = 42 - (startDay + totalDays);
    for (let i = 1; i <= remaining; i++) {
        html += `<span class="cal-day other-month">${i}</span>`;
    }

    DOM.calendarDays.innerHTML = html;
}

function prevMonth() {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    renderCalendar();
}

function nextMonth() {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    renderCalendar();
}

function filterByDate(year, month, day) {
    // 筛选该日期创建的备忘录
    const filtered = state.memoList.filter(m => {
        const memoDate = new Date(m.createdAt);
        return memoDate.getFullYear() === year &&
            memoDate.getMonth() === month &&
            memoDate.getDate() === day;
    });

    if (filtered.length === 1) {
        openMemo(filtered[0].id);
    } else if (filtered.length > 1) {
        const targetDate = new Date(year, month, day);
        DOM.listTitle.textContent = targetDate.toLocaleDateString('zh-CN');

        DOM.memoCount.textContent = `${filtered.length} 条`;
        DOM.memoListHome.innerHTML = '';
        sortMemos(filtered).forEach(memo => {
            DOM.memoListHome.appendChild(createMemoCard(memo));
        });
    }
}

// ========== 置顶功能 ==========
async function togglePin(id) {
    const result = await fetchAPI(`/api/memos/${id}/pinned`, {
        method: 'PATCH'
    });

    if (result.success) {
        await loadMemoList();
        showToast(result.data.pinned ? '已置顶' : '已取消置顶', 'success');
    } else {
        showToast('操作失败，请重试', 'error');
    }
}

// ========== 展开/折叠预览 ==========
function toggleExpand(btn) {
    const preview = btn.previousElementSibling;
    const isCollapsed = preview.classList.contains('collapsed');
    
    if (isCollapsed) {
        preview.classList.remove('collapsed');
        btn.textContent = '收起';
    } else {
        preview.classList.add('collapsed');
        btn.textContent = '展开';
    }
}

// ========== 自动保存（防抖） ==========
const debouncedSave = debounce(() => {
    if (!state.isNewMemo && state.currentMemoId) {
        saveMemo(true);
    }
}, 2000);

// ========== 事件绑定 ==========
function bindEvents() {
    // 新建备忘录
    document.getElementById('btnNewMemo').addEventListener('click', createNewMemo);
    
    // 搜索
    DOM.searchInput.addEventListener('input', searchMemos);
    
    // 日历导航
    document.getElementById('btnPrevMonth').addEventListener('click', prevMonth);
    document.getElementById('btnNextMonth').addEventListener('click', nextMonth);
    
    // 清除标签筛选
    document.getElementById('btnClearTag').addEventListener('click', clearTagFilter);
    
    // 编辑器操作
    document.getElementById('btnBack').addEventListener('click', goHome);
    document.getElementById('previewBtn').addEventListener('click', togglePreview);
    document.getElementById('deleteBtn').addEventListener('click', deleteMemo);
    document.getElementById('btnSave').addEventListener('click', saveMemo);
    
    // 模态框
    document.getElementById('btnCancelModal').addEventListener('click', closeModal);
    document.getElementById('btnConfirmModal').addEventListener('click', confirmAction);
    
    // 设置
    document.getElementById('btnSettings').addEventListener('click', openSettings);
    document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
    document.getElementById('btnCancelSettings').addEventListener('click', closeSettings);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
    
    // 自动保存
    DOM.contentEditor.addEventListener('input', debouncedSave);
    DOM.titleInput.addEventListener('input', debouncedSave);

    // 标签输入
    DOM.tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && DOM.tagInput.value.trim()) {
            e.preventDefault();
            addTag(DOM.tagInput.value.trim());
            DOM.tagInput.value = '';
        }
    });

    // 日历点击事件委托
    DOM.calendarDays.addEventListener('click', (e) => {
        const dayEl = e.target.closest('.cal-day:not(.other-month)');
        if (dayEl) {
            const year = parseInt(dayEl.dataset.year);
            const month = parseInt(dayEl.dataset.month);
            const day = parseInt(dayEl.dataset.day);
            filterByDate(year, month, day);
        }
    });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    // 绑定登录表单事件
    DOM.loginForm.addEventListener('submit', handleLogin);
    
    // 检查登录状态
    const isAuthed = await checkAuth();
    
    if (isAuthed) {
        loadMemoList();
        loadTags();
        renderCalendar();
    }
    
    bindEvents();
});

// ========== 键盘快捷键 ==========
document.addEventListener('keydown', (e) => {
    // Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveMemo();
    }

    // Ctrl+N 新建
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        createNewMemo();
    }

    // Escape 关闭模态框或返回首页
    if (e.key === 'Escape') {
        if (DOM.confirmModal.classList.contains('show')) {
            closeModal();
        } else if (DOM.editorView.style.display !== 'none') {
            goHome();
        }
    }
});
