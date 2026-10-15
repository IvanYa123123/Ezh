// Расписание преподавателей.
// v3.14.2:
//   • saveTeachersOrder работает при недоступном localStorage
//     (in-memory override).
//   • fetchTrackedTeachers защищён счётчиком поколений.

let teachersAllList = null;
let trackedTeachers = [];
let teacherSchedulesCache = {};
let visibleTeachers = new Set(
    JSON.parse(localStorage.getItem('visibleTeachers') || '[]')
);
let _teacherInitDone = false;

let _verticalTeacherIndex = 0;

let _teachersOrderOverride = null;
let _teachersGeneration = 0;

function loadTeachersOrder() {
    if (Array.isArray(_teachersOrderOverride)) return _teachersOrderOverride.slice();
    try {
        const raw = localStorage.getItem('teachersOrder');
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function saveTeachersOrder() {
    const ids = trackedTeachers.map(t => t.id);
    _teachersOrderOverride = ids.slice();
    try {
        localStorage.setItem('teachersOrder', JSON.stringify(ids));
    } catch (e) {
        console.warn('[teachers] не удалось записать порядок в localStorage:', e);
    }
}

function applyTeachersOrder() {
    const order = loadTeachersOrder();
    if (!Array.isArray(order) || order.length === 0) return;
    trackedTeachers.sort((a, b) => {
        let ai = order.indexOf(a.id); if (ai === -1) ai = Number.MAX_SAFE_INTEGER;
        let bi = order.indexOf(b.id); if (bi === -1) bi = Number.MAX_SAFE_INTEGER;
        return ai - bi;
    });
}

// ============================================================
//  ПРОКРУТКА ПО КРУГУ
// ============================================================

let _rotateTeachersBusy = false;

function rotateTeachersRight() {
    if (_rotateTeachersBusy) return;
    if (!Array.isArray(trackedTeachers) || trackedTeachers.length < 2) return;

    _rotateTeachersBusy = true;
    _teachersGeneration++;

    const before = trackedTeachers.map(t => t.id);

    const last = trackedTeachers.pop();
    trackedTeachers.unshift(last);
    saveTeachersOrder();
    _verticalTeacherIndex = 0;
    renderTeachersCalendars();

    const after = trackedTeachers.map(t => t.id);
    if (before.length > 1 && before[0] === after[0] && before.join(',') === after.join(',')) {
        console.warn('[teachers] ротация не дала изменений', { before, after });
    }

    if (typeof _syncFriendsTeachersZone === 'function') {
        try { _syncFriendsTeachersZone(); } catch (e) {}
    }

    setTimeout(() => { _rotateTeachersBusy = false; }, 250);
}

function toggleTeacherPairDetails(cardEl) {
    if (!cardEl) return;
    const details = cardEl.querySelector('.teacher-pair-details');
    if (!details) return;
    details.hidden = !details.hidden;
    cardEl.classList.toggle('is-details-open', !details.hidden);
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (_teacherInitDone) return;
        _teacherInitDone = true;
        initTeachers();
    }, 900);
});

async function initTeachers() {
    await fetchTrackedTeachers();
    renderTeacherDropdown();
    renderTeachersCalendars();
    fetchAllTeacherSchedules().then(() => renderTeachersCalendars());
}

function saveVisibleTeachers() {
    try {
        localStorage.setItem('visibleTeachers', JSON.stringify([...visibleTeachers]));
    } catch (e) {}
}

function toggleTeacherVisibility(id) {
    visibleTeachers.has(id) ? visibleTeachers.delete(id) : visibleTeachers.add(id);
    saveVisibleTeachers();
    renderTeacherDropdown();
    renderTeachersCalendars();
}

function hideAllTeachers(e) {
    if (e) e.preventDefault();
    visibleTeachers.clear();
    saveVisibleTeachers();
    renderTeacherDropdown();
    renderTeachersCalendars();
}

function showAllTeachers(e) {
    if (e) e.preventDefault();
    trackedTeachers.forEach(t => visibleTeachers.add(t.id));
    saveVisibleTeachers();
    renderTeacherDropdown();
    renderTeachersCalendars();
}

function renderTeacherDropdown() {
    const dropdown = document.getElementById('teacherTogglesDropdown');
    if (!dropdown) return;

    const parts = [];

    if (trackedTeachers.length === 0) {
        parts.push('<li><span class="dropdown-item text-muted small text-center d-block py-2">Пока никого нет</span></li>');
    } else {
        const allVisible = trackedTeachers.every(t => visibleTeachers.has(t.id));
        const toggleText = allVisible ? '🚫 Скрыть всех' : '👁 Показать всех';
        const toggleFn = allVisible ? 'hideAllTeachers' : 'showAllTeachers';
        parts.push(
            `<li><a class="dropdown-item text-primary fw-bold" href="#" onclick="${toggleFn}(event)">${toggleText}</a></li>`
          + `<li><hr class="dropdown-divider m-0"></li>`
        );

        trackedTeachers.forEach(t => {
            const isChecked = visibleTeachers.has(t.id) ? 'checked' : '';
            parts.push(`
                <li>
                    <div class="dropdown-item d-flex justify-content-between align-items-center py-1"
                         onclick="toggleTeacherVisibility(${t.id}); event.stopPropagation();"
                         style="cursor: pointer;">
                        <div class="form-check m-0 flex-grow-1" style="cursor: pointer;">
                            <input class="form-check-input" type="checkbox" ${isChecked} style="pointer-events: none;">
                            <label class="form-check-label fw-bold" style="cursor: pointer; font-size: 0.9em;">
                                🎓 ${escapeHtml(t.name)}
                            </label>
                        </div>
                    </div>
                </li>
            `);
        });
    }

    dropdown.innerHTML = parts.join('');
}

async function ensureAllTeachersLoaded() {
    if (teachersAllList) return teachersAllList;
    try {
        const resp = await fetch('/api/teachers');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        teachersAllList = await resp.json();
    } catch (e) {
        console.error('[teachers] load all failed', e);
        teachersAllList = [];
    }
    return teachersAllList;
}

async function fetchTrackedTeachers() {
    const myGen = ++_teachersGeneration;

    let list = [];
    try {
        const resp = await fetch('/api/tracked_teachers');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        list = await resp.json();
    } catch (e) {
        console.error('[teachers] load tracked failed', e);
        list = [];
    }

    if (myGen !== _teachersGeneration) return;

    trackedTeachers = Array.isArray(list) ? list : [];
    applyTeachersOrder();

    let changed = false;
    trackedTeachers.forEach(t => {
        if (!visibleTeachers.has(t.id)) {
            const savedRaw = localStorage.getItem('visibleTeachers');
            if (savedRaw === null) {
                visibleTeachers.add(t.id);
                changed = true;
            }
        }
    });
    if (changed) saveVisibleTeachers();
}

async function fetchAllTeacherSchedules() {
    const promises = trackedTeachers.map(t => loadTeacherSchedule(t.slug));
    await Promise.all(promises);
}

async function loadTeacherSchedule(slug, force) {
    if (teacherSchedulesCache[slug] && !force) return teacherSchedulesCache[slug];
    try {
        const url = '/api/teacher_schedule?slug=' + encodeURIComponent(slug) + (force ? '&force=1' : '');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        teacherSchedulesCache[slug] = Array.isArray(data) ? data : [];
        return teacherSchedulesCache[slug];
    } catch (e) {
        console.error('[teachers] schedule load failed', slug, e);
        teacherSchedulesCache[slug] = [];
        return [];
    }
}

async function showAddTeacherModal() {
    const inp = document.getElementById('teacherAddInput');
    const hint = document.getElementById('teacherAddHint');
    const sugg = document.getElementById('teacherAddSuggestions');
    if (inp) inp.value = '';
    if (hint) hint.textContent = 'Загрузка списка…';
    if (sugg) sugg.innerHTML = '';

    const modalEl = document.getElementById('addTeacherModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();

    await ensureAllTeachersLoaded();
    renderTeacherSuggestions('');

    setTimeout(() => { if (inp) inp.focus(); }, 200);
}

function onTeacherSearchFocus() {
    if (!teachersAllList) return;
    const inp = document.getElementById('teacherAddInput');
    renderTeacherSuggestions(inp ? inp.value : '');
}

function onTeacherSearchInput(value) {
    renderTeacherSuggestions(value);
}

function getMyGroupSurnames() {
    const surnames = new Set();
    if (!Array.isArray(cachedSchedule)) return surnames;
    cachedSchedule.forEach(item => {
        const t = (item.teacher || '').trim();
        if (!t) return;
        const first = t.split(/\s+/)[0];
        if (first && first.length >= 3) surnames.add(first.toLowerCase());
    });
    return surnames;
}

function renderTeacherSuggestions(query) {
    const container = document.getElementById('teacherAddSuggestions');
    const hint = document.getElementById('teacherAddHint');
    if (!container || !hint) return;

    if (!teachersAllList || teachersAllList.length === 0) {
        container.innerHTML = '<div class="text-center text-muted small py-3">Список преподавателей загружается…</div>';
        hint.textContent = '';
        return;
    }

    const q = (query || '').trim().toLowerCase();
    const trackedSlugs = new Set(trackedTeachers.map(t => t.slug));

    let filtered;
    let mode;

    if (!q) {
        const mySurnames = getMyGroupSurnames();
        if (mySurnames.size > 0) {
            filtered = teachersAllList.filter(t => {
                const first = (t.name || '').split(/\s+/)[0].toLowerCase();
                return first && mySurnames.has(first);
            });
            mode = 'mine';
            if (filtered.length === 0) {
                filtered = teachersAllList.slice(0, 30);
                mode = 'all';
            }
        } else {
            filtered = teachersAllList.slice(0, 30);
            mode = 'all';
        }
    } else if (q.length < 2) {
        filtered = [];
        mode = 'short';
    } else {
        filtered = teachersAllList.filter(t => (t.name || '').toLowerCase().includes(q)).slice(0, 50);
        mode = 'search';
    }

    if (mode === 'mine') hint.textContent = `Ваши преподаватели (${filtered.length}). Начните вводить фамилию — найдём среди всех.`;
    else if (mode === 'search') hint.textContent = `Найдено: ${filtered.length}`;
    else if (mode === 'short') hint.textContent = 'Введите минимум 2 символа';
    else hint.textContent = `Всего: ${teachersAllList.length}. Показаны первые ${filtered.length}. Начните вводить фамилию для поиска.`;

    if (filtered.length === 0) {
        container.innerHTML = mode === 'short'
            ? '<div class="text-center text-muted small py-3">—</div>'
            : '<div class="text-center text-muted small py-3">Ничего не найдено</div>';
        return;
    }

    const parts = [];
    filtered.forEach(t => {
        const isTracked = trackedSlugs.has(t.slug);
        const cls = isTracked ? ' teacher-suggestion-disabled' : '';
        const clickAttr = isTracked ? '' : `onclick="addTrackedTeacher('${escapeJsString(t.slug)}', '${escapeJsString(t.name)}')"`;
        const badge = isTracked ? '<span class="teacher-suggestion-badge">добавлен</span>' : '<span class="teacher-suggestion-arrow">+</span>';
        parts.push(`<div class="teacher-suggestion${cls}" ${clickAttr}><span class="teacher-suggestion-name">${escapeHtml(t.name)}</span>${badge}</div>`);
    });
    container.innerHTML = parts.join('');
}

async function addTrackedTeacher(slug, name) {
    let newId = null;
    try {
        const resp = await fetch('/api/tracked_teachers', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name, slug})
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (data && data.id) {
            newId = data.id;
            visibleTeachers.add(data.id);
            saveVisibleTeachers();
        }
    } catch (e) {
        console.error('[teachers] add failed', e);
        alert('Не удалось добавить преподавателя');
        return;
    }

    const modalEl = document.getElementById('addTeacherModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    await fetchTrackedTeachers();

    if (newId !== null) {
        const order = loadTeachersOrder() || [];
        if (Array.isArray(order) && !order.includes(newId)) {
            order.push(newId);
            _teachersOrderOverride = order.slice();
            try { localStorage.setItem('teachersOrder', JSON.stringify(order)); } catch (e) {}
        }
    }

    renderTeacherDropdown();
    renderTeachersCalendars();

    loadTeacherSchedule(slug).then(() => renderTeachersCalendars());

    if (typeof showUpdateNotification === 'function') showUpdateNotification(`Добавлен: ${name}`);
}

async function deleteTrackedTeacher(id) {
    const teacher = trackedTeachers.find(t => t.id === id);
    if (!teacher) return;
    if (!confirm(`Убрать преподавателя «${teacher.name}» из списка?`)) return;

    try {
        const resp = await fetch('/api/tracked_teachers/' + id, {method: 'DELETE'});
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
    } catch (e) {
        console.error('[teachers] delete failed', e);
        alert('Не удалось удалить');
        return;
    }

    visibleTeachers.delete(id);
    saveVisibleTeachers();
    _verticalTeacherIndex = 0;

    const order = loadTeachersOrder();
    if (Array.isArray(order)) {
        const idx = order.indexOf(id);
        if (idx !== -1) {
            order.splice(idx, 1);
            _teachersOrderOverride = order.slice();
            try { localStorage.setItem('teachersOrder', JSON.stringify(order)); } catch (e) {}
        }
    }

    await fetchTrackedTeachers();
    renderTeacherDropdown();
    renderTeachersCalendars();
}

// ============================================================
//  ПОДСЧЁТ ОБЩИХ ПАР (для преподавателей)
// ============================================================

function _countCommonPairsForTeacher(teacherDayPairs, myDaySchedule) {
    const myGroup = (document.getElementById('groupSelect')?.value || '').trim().toUpperCase();
    if (!myGroup || !teacherDayPairs.length || !myDaySchedule.length) return 0;

    let count = 0;
    teacherDayPairs.forEach(p => {
        if (!Array.isArray(p.groups)) return;
        const hasMyGroup = p.groups.some(g => String(g).toUpperCase() === myGroup);
        if (!hasMyGroup) return;
        const timeMatch = myDaySchedule.find(m => m.time_range === p.time_range);
        if (timeMatch) count++;
    });
    return count;
}

// ============================================================
//  ВЕРТИКАЛЬНЫЙ РЕЖИМ: НАВИГАЦИЯ
// ============================================================

function _isTeachersSectionVertical() {
    const s = document.getElementById('teachersSection');
    if (!s) return false;
    return !_isWideZone(s.parentElement);
}

function _getVerticalTeachersList() {
    if (!Array.isArray(trackedTeachers)) return [];
    return trackedTeachers;
}

function verticalTeacherPrev() {
    const list = _getVerticalTeachersList();
    if (list.length === 0) return;
    _verticalTeacherIndex = (_verticalTeacherIndex - 1 + list.length) % list.length;
    renderTeachersCalendars();
}

function verticalTeacherNext() {
    const list = _getVerticalTeachersList();
    if (list.length === 0) return;
    _verticalTeacherIndex = (_verticalTeacherIndex + 1) % list.length;
    renderTeachersCalendars();
}

// ============================================================
//  ВЕРТИКАЛЬНЫЙ РЕЖИМ: РЕНДЕР
// ============================================================

async function _renderTeachersVertical() {
    const container = document.getElementById('teachersCalendarsContainer');
    if (!container) return;

    container.innerHTML = '';
    container.classList.add('is-vertical');

    const list = _getVerticalTeachersList();

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎓</div>
                <div class="empty-state-title">Пока никого нет</div>
                <div class="empty-state-text">Добавьте преподавателя в горизонтальном режиме.</div>
            </div>`;
        return;
    }

    if (_verticalTeacherIndex >= list.length) _verticalTeacherIndex = 0;
    const teacher = list[_verticalTeacherIndex];

    const showSwitchBtn = (typeof separateFriendsTeachers !== 'undefined')
        && !separateFriendsTeachers
        && (typeof showFriendsSection !== 'undefined') && showFriendsSection;

    const switchHtml = showSwitchBtn
        ? `<div class="fv-switch-row">
               <button type="button" class="fv-switch-btn"
                       onclick="switchFriendsTeachersTab('friends')"
                       title="Показать друзей">👥 Друзья</button>
           </div>`
        : '';

    if (!(teacher.slug in teacherSchedulesCache)) {
        container.innerHTML = `
            <div class="teacher-vertical-card">
                <div class="fv-nav-row">
                    <button type="button" class="fv-arrow" onclick="verticalTeacherPrev()" title="Предыдущий">‹</button>
                    <div class="fv-name-wrap">
                        <div class="fv-name">🎓 ${escapeHtml(teacher.name)}</div>
                    </div>
                    <button type="button" class="fv-arrow" onclick="verticalTeacherNext()" title="Следующий">›</button>
                </div>
                <div class="fv-counter">${_verticalTeacherIndex + 1} / ${list.length}</div>
                <div class="fv-empty">Загрузка расписания…</div>
                ${switchHtml}
            </div>`;
        await loadTeacherSchedule(teacher.slug);
        if (!_isTeachersSectionVertical()) return;
        if (list[_verticalTeacherIndex] !== teacher) return;
        renderTeachersCalendars();
        return;
    }

    const pairs = teacherSchedulesCache[teacher.slug] || [];

    const date = _getVerticalDate();
    const dateStr = getLocalDateStr(date);
    const todayStr = getLocalDateStr(new Date());
    const isToday = dateStr === todayStr;

    const dayPairs = pairs
        .filter(p => p.date === dateStr)
        .sort((a, b) => (a.n || 0) - (b.n || 0));

    const myDaySched = cachedSchedule.filter(p => p.date === dateStr);

    let summaryHtml = '';
    if (dayPairs.length === 0) {
        summaryHtml = `<div class="fv-empty">Выходной</div>`;
    } else {
        const fStart = dayPairs[0].time_range.split(' - ')[0].trim();
        const fEnd   = dayPairs[dayPairs.length - 1].time_range.split(' - ')[1].trim();

        const locations = new Set();
        dayPairs.forEach(p => {
            if (p.location) locations.add(p.location);
        });
        const locStr = [...locations].slice(0, 3).join(', ');

        const commonCount = _countCommonPairsForTeacher(dayPairs, myDaySched);
        const commonHtml = commonCount > 0
            ? `<div class="fv-common">🤝 ${commonCount} ${plural(commonCount, 'общая пара', 'общие пары', 'общих пар')}</div>`
            : '';

        summaryHtml = `
            <div class="fv-time">🕒 ${fStart} — ${fEnd}</div>
            ${locStr ? `<div class="fv-campus">📍 ${escapeHtml(locStr)}</div>` : ''}
            <div class="fv-pairs-count">${dayPairs.length} ${plural(dayPairs.length, 'пара', 'пары', 'пар')}</div>
            ${commonHtml}
        `;
    }

    const dateLabel = date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });

    container.innerHTML = `
        <div class="teacher-vertical-card">
            <div class="fv-nav-row">
                <button type="button" class="fv-arrow" onclick="verticalTeacherPrev()" title="Предыдущий">‹</button>
                <div class="fv-name-wrap">
                    <div class="fv-name">🎓 ${escapeHtml(teacher.name)}</div>
                </div>
                <button type="button" class="fv-arrow" onclick="verticalTeacherNext()" title="Следующий">›</button>
            </div>
            <div class="fv-counter">${_verticalTeacherIndex + 1} / ${list.length}</div>

            <div class="fv-day-row">
                <button type="button" class="fv-day-arrow" onclick="verticalDayPrev()" title="Предыдущий день">‹</button>
                <div class="fv-date">${dateLabel}${isToday ? ' · сегодня' : ''}</div>
                <button type="button" class="fv-day-arrow" onclick="verticalDayNext()" title="Следующий день">›</button>
            </div>

            <div class="fv-summary">${summaryHtml}</div>
            ${switchHtml}
        </div>
    `;
}

// ============================================================
//  ОСНОВНОЙ РЕНДЕР
// ============================================================

function renderTeachersCalendars() {
    if (_isTeachersSectionVertical()) {
        _renderTeachersVertical();
        return;
    }

    const container = document.getElementById('teachersCalendarsContainer');
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('is-vertical');

    if (!trackedTeachers || trackedTeachers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎓</div>
                <div class="empty-state-title">Пока никого нет</div>
                <div class="empty-state-text">Нажмите «+ Добавить преподавателя», чтобы видеть его расписание рядом со своим.</div>
            </div>`;
        return;
    }

    const visible = trackedTeachers.filter(t => visibleTeachers.has(t.id));

    if (visible.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-title">Все преподаватели скрыты</div>
                <div class="empty-state-text">Выберите, кого показывать, в меню «Кого показывать?».</div>
            </div>`;
        return;
    }

    const realTodayStr = getLocalDateStr(new Date());

    visible.forEach(t => {
        const pairs = teacherSchedulesCache[t.slug] || [];
        const isLoading = !(t.slug in teacherSchedulesCache);

        const wrapper = document.createElement('div');
        wrapper.className = 'teacher-wrapper bg-white rounded shadow-sm px-2 pb-2 pt-1';
        wrapper.dataset.teacherId = t.id;

        const header = document.createElement('div');
        header.className = 'fw-bold text-primary mb-2 ps-1 pt-1 teacher-header-row d-flex align-items-center';
        header.innerHTML = `
            <span class="flex-grow-1">🎓 ${escapeHtml(t.name)}</span>
            <button class="btn btn-sm btn-link text-primary p-0 me-2 text-decoration-none"
                    onclick="teacherRefresh('${escapeJsString(t.slug)}')"
                    title="Обновить расписание">🔄</button>
            <button class="btn btn-sm btn-link text-danger p-0 text-decoration-none"
                    onclick="deleteTrackedTeacher(${t.id})"
                    title="Убрать из списка">🗑️</button>
        `;
        wrapper.appendChild(header);

        if (isLoading) {
            const loadDiv = document.createElement('div');
            loadDiv.className = 'text-center text-muted small py-3';
            loadDiv.textContent = 'Загрузка расписания…';
            wrapper.appendChild(loadDiv);
            container.appendChild(wrapper);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'calendar-grid w-100';

        const dayParts = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(currentBaseDate);
            d.setDate(d.getDate() + i);
            const dateStr = getLocalDateStr(d);
            const displayDate = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });

            const dayPairs = pairs.filter(p => p.date === dateStr).sort((a, b) => (a.n || 0) - (b.n || 0));
            const isToday = dateStr === realTodayStr ? ' day-today' : '';

            let html = `<div class="teacher-col${isToday}">`;
            html += `<div class="teacher-day-header">${displayDate}</div>`;

            if (dayPairs.length === 0) {
                html += '<div class="text-muted text-center mt-2" style="font-size:0.8em;">—</div>';
            } else {
                dayPairs.forEach(p => {
                    const badge = p.type_name
                        ? `<span class="badge bg-secondary ms-1" style="font-size:0.6em;">${escapeHtml(p.type_name)}</span>`
                        : '';
                    const locHtml = p.location ? `<div class="teacher-pair-location">🚪 ${escapeHtml(p.location)}</div>` : '';
                    const groupsHtml = (p.groups && p.groups.length)
                        ? `<div class="text-muted" style="font-size:0.85em;">${p.groups.map(g => escapeHtml(g)).join(', ')}</div>`
                        : '';

                    html += `
                        <div class="teacher-pair-card" onclick="toggleTeacherPairDetails(this)" title="Показать/скрыть подробности">
                            <div class="teacher-pair-head">
                                <strong class="text-primary">${escapeHtml(p.time_range)}</strong>${badge}
                                <span class="teacher-pair-toggle">▼</span>
                            </div>
                            ${locHtml}
                            <div class="teacher-pair-details" hidden>
                                <div>${escapeHtml(p.lesson)}</div>
                                ${groupsHtml}
                            </div>
                        </div>`;
                });
            }
            html += `</div>`;
            dayParts.push(html);
        }
        grid.innerHTML = dayParts.join('');
        wrapper.appendChild(grid);
        container.appendChild(wrapper);
    });
}

async function teacherRefresh(slug) {
    await loadTeacherSchedule(slug, true);
    renderTeachersCalendars();
    if (typeof showUpdateNotification === 'function') showUpdateNotification('Расписание преподавателя обновлено');
}