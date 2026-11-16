// Глобальный поиск: инлайн-поле в шапке + модалка (fallback для Ctrl+K).
// v3.18.0: поле #globalSearchInput вместо кнопки. Результаты —
// выпадашкой под полем, как у автокомплита группы.
// v3.19.0: Защита от автозаполнения браузера при фоновых процессах.

let _searchDebounceTimer = null;
let _searchResults = { tasks: [], events: [], lessons: [], teachers: [], rooms: [] };
let _searchLastQuery = '';

const _searchMeta = { count: 0, query: '' };

const SEARCHABLE_WIDGETS = [
    { id: 'widgetMiniCalCard', name: 'Мини-календарь', group: 'Виджеты' },
    { id: 'widgetGlobalCard', name: 'Глобальный виджет', group: 'Виджеты' },
    { id: 'widgetLabsCard', name: 'Лабораторные', group: 'Виджеты' },
    { id: 'widgetSuggestionsCard', name: 'Подсказки', group: 'Виджеты' },
    { id: 'widgetPacingCard', name: 'Темп семестра', group: 'Виджеты' },
    { id: 'widgetNotesCard1', name: 'Заметки', group: 'Виджеты' },
    { id: 'widgetMoodleAvgGradeCard', name: 'Средний балл', group: 'Pro-виджеты' },
    { id: 'widgetMoodleSubjectGradesCard', name: 'Баллы по предмету', group: 'Pro-виджеты' },
    { id: 'widgetLabsProCard', name: 'Статистика сдач', group: 'Pro-виджеты' },
];

function _searchWidgets(query) {
    const q = (query || '').toLowerCase();
    return SEARCHABLE_WIDGETS.filter(w => w.name.toLowerCase().includes(q));
}

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
        const tasks    = Array.isArray(data.tasks)    ? data.tasks    : [];
        const events   = Array.isArray(data.events)   ? data.events   : [];
        const lessons  = Array.isArray(data.lessons)  ? data.lessons  : [];
        const teachers = Array.isArray(data.teachers) ? data.teachers : [];
        const rooms    = Array.isArray(data.rooms)    ? data.rooms    : [];
        const widgets  = _searchWidgets(q);

        if (tasks.length + events.length + lessons.length + teachers.length + rooms.length + widgets.length === 0) {
            dropdown.innerHTML = `<div class="autocomplete-item autocomplete-empty">Ничего не найдено по «${escapeHtml(q)}»</div>`;
            return;
        }

        let html = '';
        if (tasks.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">📝 Заметки</div>`;
            tasks.slice(0, 4).forEach(t => {
                html += `<div class="autocomplete-item" data-action="date" data-date="${escapeAttr(t.date)}" style="display: flex; align-items: baseline; gap: 8px; white-space: normal;">
                    <span style="color: var(--text-muted); font-size: 0.8em; flex-shrink: 0; min-width: 68px;">${formatDateRu(t.date)}</span>
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${highlightText(t.text, q)}</span>
                </div>`;
            });
        }
        if (lessons.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">📚 Пары</div>`;
            lessons.slice(0, 4).forEach(p => {
                const meta = [p.time_range, p.type_name, p.location].filter(Boolean).map(escapeHtml).join(' · ');
                html += `<div class="autocomplete-item" data-action="date" data-date="${escapeAttr(p.date)}" style="display: flex; align-items: baseline; gap: 8px; white-space: normal;">
                    <span style="color: var(--text-muted); font-size: 0.8em; flex-shrink: 0; min-width: 68px;">${formatDateRu(p.date)}</span>
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${highlightText(p.lesson, q)}${meta ? ' <span class="text-muted small">' + meta + '</span>' : ''}</span>
                </div>`;
            });
        }
        if (events.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">🎯 События</div>`;
            events.slice(0, 4).forEach(ev => {
                html += `<div class="autocomplete-item" data-action="date" data-date="${escapeAttr(ev.base_date)}" style="display: flex; align-items: baseline; gap: 8px; white-space: normal;">
                    <span style="color: var(--text-muted); font-size: 0.8em; flex-shrink: 0; min-width: 68px;">${formatDateRu(ev.base_date)}</span>
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${highlightText(ev.lesson, q)}</span>
                </div>`;
            });
        }
        if (teachers.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">🎓 Преподаватели</div>`;
            teachers.slice(0, 4).forEach(t => {
                html += `<div class="autocomplete-item" data-action="teacher" data-slug="${escapeAttr(t.slug)}" data-name="${escapeAttr(t.name)}">🎓 ${highlightText(t.name, q)}</div>`;
            });
        }
        if (rooms.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">🚪 Аудитории</div>`;
            rooms.slice(0, 4).forEach(r => {
                html += `<div class="autocomplete-item" data-action="room" data-room="${escapeAttr(r)}">🚪 ${highlightText(r, q)}</div>`;
            });
        }
        if (widgets.length > 0) {
            html += `<div class="search-section-title" style="padding: 6px 14px 2px; margin: 0;">🧩 Виджеты</div>`;
            widgets.slice(0, 4).forEach(w => {
                html += `<div class="autocomplete-item" data-action="widget" data-widget="${escapeAttr(w.id)}">🧩 ${highlightText(w.name, q)}</div>`;
            });
        }
        dropdown.innerHTML = html;
    }

    input.addEventListener('input', () => {
        // ЗАЩИТА ОТ АВТОЗАПОЛНЕНИЯ: если браузер вставил текст, пока мы не в поле —
        // немедленно очищаем его и скрываем выпадашку.
        if (document.activeElement !== input) {
            input.value = '';
            _inlineSearchQuery = '';
            hide();
            return;
        }

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
        const item = e.target.closest('.autocomplete-item[data-action]');
        if (!item) return;
        e.preventDefault();
        const action = item.dataset.action;
        if (action === 'teacher') {
            hide();
            onSearchTeacherClick(item.dataset.name || '');
        } else if (action === 'widget') {
            hide();
            if (typeof openSettingsModal === 'function') openSettingsModal();
        } else if (action === 'room') {
            hide();
            const room = item.dataset.room || '';
            if (room && navigator.clipboard) navigator.clipboard.writeText(room).catch(() => {});
            if (typeof showUpdateNotification === 'function') {
                showUpdateNotification(`🚪 ${room} — скопировано`);
            }
        } else {
            onInlineSearchClick(item.dataset.date);
        }
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

async function onSearchTeacherClick(name) {
    if (!name) return;
    if (typeof showAddTeacherModal === 'function') {
        await showAddTeacherModal();
        const input = document.getElementById('teacherAddInput');
        if (input) {
            input.value = name;
            input.focus();
            if (typeof renderTeacherSuggestions === 'function') {
                renderTeacherSuggestions(name);
            }
        }
    }
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
        // Аналогичная защита для поля в модалке
        if (document.activeElement !== input) {
            input.value = '';
            return;
        }
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
        _searchResults = { tasks: [], events: [], lessons: [], teachers: [], rooms: [] };
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
        _searchResults = { tasks: [], events: [], lessons: [], teachers: [], rooms: [] };
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
            tasks:    Array.isArray(data.tasks)    ? data.tasks    : [],
            events:   Array.isArray(data.events)   ? data.events   : [],
            lessons:  Array.isArray(data.lessons)  ? data.lessons  : [],
            teachers: Array.isArray(data.teachers) ? data.teachers : [],
            rooms:    Array.isArray(data.rooms)    ? data.rooms    : []
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

    const tasks    = _searchResults.tasks    || [];
    const events   = _searchResults.events   || [];
    const lessons  = _searchResults.lessons  || [];
    const teachers = _searchResults.teachers || [];
    const rooms    = _searchResults.rooms    || [];
    const widgets  = _searchWidgets(q);

    const total = tasks.length + events.length + lessons.length
        + teachers.length + rooms.length + widgets.length;

    if (total === 0) {
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
                <div class="search-result-card" onclick="onSearchResultClick('${escapeJsString(t.date)}')">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <span class="text-muted small">📅 ${dateStr}</span>
                        <span class="badge" style="background:${color}; font-size:0.65em;">${label}</span>
                    </div>
                    <div class="search-result-text">${highlightText(t.text, q)}</div>
                </div>`;
        });
    }

    if (lessons.length > 0) {
        html += `<div class="search-section-title mt-3">📚 Пары · ${lessons.length}</div>`;
        lessons.forEach(p => {
            const extra = [p.time_range, p.type_name, p.location, p.teacher]
                .filter(Boolean).map(escapeHtml).join(' · ');
            html += `
                <div class="search-result-card" onclick="onSearchResultClick('${escapeJsString(p.date)}')">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <span class="text-muted small">📅 ${formatDateRu(p.date)}</span>
                    </div>
                    <div class="search-result-text">${highlightText(p.lesson, q)}</div>
                    ${extra ? `<div class="text-muted small mt-1">${extra}</div>` : ''}
                </div>`;
        });
    }

    if (events.length > 0) {
        html += `<div class="search-section-title mt-3">🎯 События · ${events.length}</div>`;
        events.forEach(ev => {
            const kindLabel = ev.is_event ? 'Событие' : 'Пара';
            const kindColor = ev.is_event ? '#10b981' : '#8b5cf6';
            const dateStr = formatDateRu(ev.base_date);
            const time = ev.time_range ? ` · ${ev.time_range}` : '';
            const extra = [];
            if (ev.type_name) extra.push(escapeHtml(ev.type_name));
            if (ev.location)  extra.push(escapeHtml(ev.location));
            if (ev.teacher)   extra.push(escapeHtml(ev.teacher));
            html += `
                <div class="search-result-card" onclick="onSearchResultClick('${escapeJsString(ev.base_date)}')">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <span class="text-muted small">📅 ${dateStr}${time}</span>
                        <span class="badge" style="background:${kindColor}; font-size:0.65em;">${kindLabel}</span>
                    </div>
                    <div class="search-result-text">${highlightText(ev.lesson, q)}</div>
                    ${extra.length ? `<div class="text-muted small mt-1">${extra.join(' · ')}</div>` : ''}
                </div>`;
        });
    }

    if (teachers.length > 0) {
        html += `<div class="search-section-title mt-3">🎓 Преподаватели · ${teachers.length}</div>`;
        teachers.forEach(t => {
            html += `
                <div class="search-result-card" onclick="closeSearchModal(); onSearchTeacherClick('${escapeJsString(t.name)}')">
                    <div class="search-result-text">🎓 ${highlightText(t.name, q)}</div>
                    <div class="text-muted small mt-1">Добавить в «Мои преподаватели»</div>
                </div>`;
        });
    }

    if (rooms.length > 0) {
        html += `<div class="search-section-title mt-3">🚪 Аудитории · ${rooms.length}</div>`;
        rooms.forEach(r => {
            html += `
                <div class="search-result-card" onclick="navigator.clipboard && navigator.clipboard.writeText('${escapeJsString(r)}')">
                    <div class="search-result-text">🚪 ${highlightText(r, q)}</div>
                </div>`;
        });
    }

    if (widgets.length > 0) {
        html += `<div class="search-section-title mt-3">🧩 Виджеты · ${widgets.length}</div>`;
        widgets.forEach(w => {
            html += `
                <div class="search-result-card" onclick="closeSearchModal(); openSettingsModal()">
                    <div class="search-result-text">🧩 ${highlightText(w.name, q)}</div>
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
    const l = _searchResults.lessons || [];
    if (t.length > 0) return onSearchResultClick(t[0].date);
    if (l.length > 0) return onSearchResultClick(l[0].date);
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
    const rawText = String(text || '');
    if (!query) return escapeHtml(rawText);

    // Ищем по исходному тексту и экранируем уже найденные фрагменты:
    // раньше regex строился по escapeHtml(query) и не находил & < > ".
    const regexSafe = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!regexSafe) return escapeHtml(rawText);

    try {
        const regex = new RegExp(`(${regexSafe})`, 'gi');
        let result = '';
        let lastIndex = 0;
        let m;
        while ((m = regex.exec(rawText)) !== null) {
            result += escapeHtml(rawText.slice(lastIndex, m.index));
            result += `<mark>${escapeHtml(m[0])}</mark>`;
            lastIndex = m.index + m[0].length;
            if (m[0].length === 0) regex.lastIndex++;
        }
        return result + escapeHtml(rawText.slice(lastIndex));
    } catch (e) {
        return escapeHtml(rawText);
    }
}