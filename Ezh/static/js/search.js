// Глобальный поиск по заметкам и событиям.
// v3.16.0: используется err.status из api.js.

let _searchDebounceTimer = null;
let _searchResults = { tasks: [], events: [] };
let _searchLastQuery = '';

const _searchMeta = { count: 0, query: '' };

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

    if (!input) {
        console.warn('[search] #searchInput не найден — поиск не инициализирован');
        return;
    }
    if (!modalEl) {
        console.warn('[search] #searchModal не найден');
        return;
    }

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

    console.log('[search] initialized');
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
                Ничего не найдено по запросу «${escapeHtml(q)}»<br>
                <span class="text-muted" style="font-size:0.85em;">Проверьте раскладку и попробуйте другую форму слова</span>
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

// ─── helpers ──────────────────────────────────────────────

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