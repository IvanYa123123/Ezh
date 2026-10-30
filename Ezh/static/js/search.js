// Глобальный поиск: инлайн-поле в шапке + модалка (fallback для Ctrl+K).
// v3.18.0: поле #globalSearchInput вместо кнопки. Результаты —
// выпадашкой под полем, как у автокомплита группы.

let _searchDebounceTimer = null;
let _searchResults = { tasks: [], events: [] };
let _searchLastQuery = '';

const _searchMeta = { count: 0, query: '' };

// === Инлайн-поиск в шапке ===
let _inlineSearchDebounce = null;
let _inlineSearchQuery = '';
let _inlineSearchDropdown = null;

function initInlineSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;

    if (!_inlineSearchDropdown) {
        _inlineSearchDropdown = document.createElement('div');
        _inlineSearchDropdown.id = 'globalSearchResults';
        _inlineSearchDropdown.className = 'autocomplete-list';
        document.body.appendChild(_inlineSearchDropdown);
    }
    const dropdown = _inlineSearchDropdown;

    function position() {
        const rect = input.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 2) + 'px';
        dropdown.style.width = Math.max(rect.width, 400) + 'px';
    }
    function hide() { dropdown.style.display = 'none'; }
    function show() { position(); dropdown.style.display = 'block'; }

    async function fetchAndRender(query) {
        try {
            const data = await apiSearch(query);
            if (_inlineSearchQuery !== query) return;
            _renderInlineResults(data, query);
            show();
        } catch (e) {
            console.error('[inline-search] failed', e);
        }
    }

    function _renderInlineResults(data, q) {
        const tasks  = Array.isArray(data.tasks)  ? data.tasks  : [];
        const events = Array.isArray(data.events) ? data.events : [];

        if (tasks.length === 0 && events.length === 0) {
            dropdown.innerHTML = `<div class="autocomplete-item autocomplete-empty">Ничего не найдено по «${escapeHtml(q)}»</div>`;
            return;
        }

        let html = '';
        if (tasks.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">📝 Заметки</div>`;
            tasks.slice(0, 5).forEach(t => {
                html += `<div class="autocomplete-item" data-date="${escapeAttr(t.date)}" style="display: flex; align-items: baseline; gap: 8px; white-space: normal;">
                    <span style="color: var(--text-muted); font-size: 0.8em; flex-shrink: 0; min-width: 68px;">${formatDateRu(t.date)}</span>
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${highlightText(t.text, q)}</span>
                </div>`;
            });
        }
        if (events.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">🎯 События</div>`;
            events.slice(0, 5).forEach(ev => {
                html += `<div class="autocomplete-item" data-date="${escapeAttr(ev.base_date)}" style="display: flex; align-items: baseline; gap: 8px; white-space: normal;">
                    <span style="color: var(--text-muted); font-size: 0.8em; flex-shrink: 0; min-width: 68px;">${formatDateRu(ev.base_date)}</span>
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${highlightText(ev.lesson, q)}</span>
                </div>`;
            });
        }
        dropdown.innerHTML = html;
    }

    input.addEventListener('input', () => {
        _inlineSearchQuery = input.value.trim();
        if (_inlineSearchDebounce) clearTimeout(_inlineSearchDebounce);
        if (_inlineSearchQuery.length < 2) { hide(); return; }
        _inlineSearchDebounce = setTimeout(() => fetchAndRender(_inlineSearchQuery), 220);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) {
            _inlineSearchQuery = q;
            fetchAndRender(q);
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(hide, 180);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { hide(); input.blur(); }
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = dropdown.querySelector('.autocomplete-item[data-date]');
            if (first) onInlineSearchClick(first.dataset.date);
        }
    });

    dropdown.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.autocomplete-item[data-date]');
        if (!item) return;
        e.preventDefault();
        onInlineSearchClick(item.dataset.date);
    });

    window.addEventListener('scroll', () => { if (dropdown.style.display === 'block') position(); }, true);
    window.addEventListener('resize', () => { if (dropdown.style.display === 'block') position(); });
}

function onInlineSearchClick(dateStr) {
    const input = document.getElementById('globalSearchInput');
    if (input) input.value = '';
    if (_inlineSearchDropdown) _inlineSearchDropdown.style.display = 'none';
    if (typeof jumpToDate === 'function') jumpToDate(dateStr);
}

// === Модалка поиска (Ctrl+K fallback) ===

function openSearchModal() {
    const modalEl = document.getElementById('searchModal');
    if (!modalEl) {
        console.warn('[search] modal #searchModal не найден в DOM');
        return;
    }
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
}

function closeSearchModal() {
    const modalEl = document.getElementById('searchModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
}

function initSearch() {
    const input = document.getElementById('searchInput');
    const modalEl = document.getElementById('searchModal');

    if (!input) return;
    if (!modalEl) return;

    input.addEventListener('input', () => {
        if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(() => runSearch(input.value), 220);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            jumpToFirstResult();
        }
    });

    modalEl.addEventListener('shown.bs.modal', () => {
        input.focus();
        input.select();
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
        input.value = '';
        _searchResults = { tasks: [], events: [] };
        _searchLastQuery = '';
        _searchMeta.count = 0;
        _searchMeta.query = '';
        renderSearchResults();
    });
}

async function runSearch(rawQuery) {
    const q = (rawQuery || '').trim();
    _searchLastQuery = q;
    _searchMeta.query = q;

    const container = document.getElementById('searchResults');

    if (q.length < 2) {
        _searchResults = { tasks: [], events: [] };
        _searchMeta.count = 0;
        renderSearchResults();
        return;
    }

    if (container) {
        container.innerHTML = '<div class="text-center text-muted small py-4">⏳ Ищем…</div>';
    }

    try {
        const data = await apiSearch(q);
        if (q !== _searchLastQuery) return;

        _searchResults = {
            tasks:  Array.isArray(data.tasks)  ? data.tasks  : [],
            events: Array.isArray(data.events) ? data.events : []
        };
        _searchMeta.count = (typeof data.count === 'number')
            ? data.count
            : (_searchResults.tasks.length + _searchResults.events.length);
        renderSearchResults();

    } catch (e) {
        console.error('[search] request failed:', e);
        if (container) {
            const status = e && e.status ? ` (HTTP ${e.status})` : '';
            container.innerHTML = `
                <div class="text-center text-danger small py-4">
                    ❌ Ошибка поиска${status}<br>
                    <span class="text-muted">${escapeHtml(e.message || String(e))}</span>
                </div>`;
        }
    }
}

function renderSearchResults() {
    const container = document.getElementById('searchResults');
    if (!container) return;

    const q = _searchLastQuery;

    if (q.length < 2) {
        container.innerHTML = '<div class="text-center text-muted small py-4">Начните вводить запрос (минимум 2 символа)</div>';
        return;
    }

    const tasks  = _searchResults.tasks  || [];
    const events = _searchResults.events || [];

    if (tasks.length === 0 && events.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted small py-4">
                Ничего не найдено по запросу «${escapeHtml(q)}»
            </div>
            <div class="search-meta">Запрос: «${escapeHtml(q)}» · Найдено: 0</div>`;
        return;
    }

    let html = '';

    if (tasks.length > 0) {
        html += `<div class="search-section-title">📝 Заметки · ${tasks.length}</div>`;
        tasks.forEach(t => {
            const label = statusLabel(t.status);
            const color = statusColor(t.status);
            const dateStr = formatDateRu(t.date);
            html += `
                <div class="search-result-card" onclick="onSearchResultClick('${t.date}')">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <span class="text-muted small">📅 ${dateStr}</span>
                        <span class="badge" style="background:${color}; font-size:0.65em;">${label}</span>
                    </div>
                    <div class="search-result-text">${highlightText(t.text, q)}</div>
                </div>`;
        });
    }

    if (events.length > 0) {
        html += `<div class="search-section-title mt-3">🎯 События и пары · ${events.length}</div>`;
        events.forEach(ev => {
            const kindLabel = ev.is_event ? 'Событие' : 'Пара';
            const kindColor = ev.is_event ? '#10b981' : '#8b5cf6';
            const dateStr = formatDateRu(ev.base_date);
            const time = ev.time_range ? ` · ${ev.time_range}` : '';

            const extra = [];
            if (ev.type_name) extra.push(escapeHtml(ev.type_name));
            if (ev.location)  extra.push(escapeHtml(ev.location));
            if (ev.teacher)   extra.push(escapeHtml(ev.teacher));
            const extraHtml = extra.length
                ? `<div class="text-muted small mt-1">${extra.join(' · ')}</div>`
                : '';

            html += `
                <div class="search-result-card" onclick="onSearchResultClick('${ev.base_date}')">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <span class="text-muted small">📅 ${dateStr}${time}</span>
                        <span class="badge" style="background:${kindColor}; font-size:0.65em;">${kindLabel}</span>
                    </div>
                    <div class="search-result-text">${highlightText(ev.lesson, q)}</div>
                    ${extraHtml}
                </div>`;
        });
    }

    html += `<div class="search-meta">Запрос: «${escapeHtml(q)}» · Найдено: ${_searchMeta.count}</div>`;

    container.innerHTML = html;
}

function onSearchResultClick(dateStr) {
    closeSearchModal();
    if (typeof jumpToDate === 'function') jumpToDate(dateStr);
}

function jumpToFirstResult() {
    if (_searchLastQuery.length < 2) return;
    const t = _searchResults.tasks || [];
    const e = _searchResults.events || [];
    if (t.length > 0) return onSearchResultClick(t[0].date);
    if (e.length > 0) return onSearchResultClick(e[0].base_date);
}

function statusLabel(s) {
    return ({
        green: 'Обычная',
        orange: 'Важная',
        red: 'Срочная',
        completed: 'Выполнено'
    })[s] || s || '';
}

function statusColor(s) {
    return ({
        green: '#10b981',
        orange: '#f59e0b',
        red: '#ef4444',
        completed: '#94a3b8'
    })[s] || '#94a3b8';
}

function highlightText(text, query) {
    const safeText = escapeHtml(text || '');
    if (!query) return safeText;

    const safeQuery = escapeHtml(query);
    const regexSafe = safeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!regexSafe) return safeText;

    try {
        const regex = new RegExp(`(${regexSafe})`, 'gi');
        return safeText.replace(regex, '<mark>$1</mark>');
    } catch (e) {
        return safeText;
    }
}