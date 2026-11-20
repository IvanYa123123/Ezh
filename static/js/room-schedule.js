// Раздел «Аудитория» в режиме преподавателя: несколько комнат, папки, видимость.

const ROOMS_KEY = 'savedRooms';
const VISIBLE_ROOMS_KEY = 'visibleRooms';

let roomLocationsCache = null;
const roomSchedules = {};
const roomLoading = {};
const roomErrors = {};

function _readRoomsJson(key, fallback) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        return parsed == null ? fallback : parsed;
    } catch (e) {
        return fallback;
    }
}

function getSavedRooms() {
    const stored = localStorage.getItem(ROOMS_KEY);
    if (stored !== null) {
        let raw = [];
        try { raw = JSON.parse(stored); } catch (e) { raw = []; }
        if (!Array.isArray(raw)) return [];
        return raw.filter(r => r && typeof r.slug === 'string' && r.slug)
            .map(r => ({ slug: r.slug, name: String(r.name || r.slug), category: String(r.category || '') }));
    }

    // Миграция со старого одиночного виджета (только если списка ещё нет).
    const legacySlug = localStorage.getItem('roomSlug');
    if (legacySlug) {
        const legacy = [{ slug: legacySlug, name: localStorage.getItem('roomName') || legacySlug, category: '' }];
        saveSavedRooms(legacy);
        localStorage.setItem(VISIBLE_ROOMS_KEY, JSON.stringify([legacySlug]));
        localStorage.removeItem('roomSlug');
        localStorage.removeItem('roomName');
        return legacy;
    }
    return [];
}

function saveSavedRooms(rooms) {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
}

function getVisibleRoomSlugs() {
    const rooms = getSavedRooms();
    const all = rooms.map(r => r.slug);
    const raw = _readRoomsJson(VISIBLE_ROOMS_KEY, null);
    if (!Array.isArray(raw)) return all;
    return raw.filter(s => typeof s === 'string' && all.includes(s));
}

function saveVisibleRoomSlugs(slugs) {
    localStorage.setItem(VISIBLE_ROOMS_KEY, JSON.stringify(slugs));
}

function addSavedRoom(slug, name) {
    if (!slug) return;
    const rooms = getSavedRooms();
    if (!rooms.some(r => r.slug === slug)) {
        rooms.push({ slug, name: name || slug, category: '' });
        saveSavedRooms(rooms);
    }
    const visible = getVisibleRoomSlugs();
    if (!visible.includes(slug)) visible.push(slug);
    saveVisibleRoomSlugs(visible);
    const modalEl = document.getElementById('roomPickerModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
    renderRoomsSection();
    loadRoomSchedules(false);
}

function removeSavedRoom(slug) {
    const rooms = getSavedRooms();
    const room = rooms.find(r => r.slug === slug);
    if (!room) return;
    if (!confirm(`Убрать аудиторию «${room.name}»?`)) return;
    saveSavedRooms(rooms.filter(r => r.slug !== slug));
    saveVisibleRoomSlugs(getVisibleRoomSlugs().filter(s => s !== slug));
    delete roomSchedules[slug];
    delete roomLoading[slug];
    delete roomErrors[slug];
    renderRoomsSection();
    renderRoomToggles();
}

function _cleanRoomFolderName(value) {
    return String(value || '').replace(/["'<>\\]/g, '').trim();
}

function editRoomCategory(slug) {
    const rooms = getSavedRooms();
    const room = rooms.find(r => r.slug === slug);
    if (!room) return;
    const value = prompt('Папка для аудитории (пусто — без папки):', room.category || '');
    if (value === null) return;
    room.category = _cleanRoomFolderName(value);
    saveSavedRooms(rooms);
    renderRoomsSection();
    renderRoomToggles();
}

function renameRoomFolder(oldName) {
    if (!oldName) return;
    const value = prompt('Новое название папки:', oldName);
    if (value === null) return;
    const name = _cleanRoomFolderName(value);
    const rooms = getSavedRooms();
    rooms.forEach(r => { if (r.category === oldName) r.category = name; });
    saveSavedRooms(rooms);
    renderRoomsSection();
    renderRoomToggles();
}

function deleteRoomFolder(name) {
    if (!name) return;
    if (!confirm(`Удалить папку «${name}»? Аудитории останутся без папки.`)) return;
    const rooms = getSavedRooms();
    rooms.forEach(r => { if (r.category === name) r.category = ''; });
    saveSavedRooms(rooms);
    renderRoomsSection();
    renderRoomToggles();
}

function toggleRoomVisibility(slug, visible) {
    const rooms = getSavedRooms();
    let visibleSlugs = getVisibleRoomSlugs().filter(s => rooms.some(r => r.slug === s));
    if (visible) {
        if (!visibleSlugs.includes(slug)) visibleSlugs.push(slug);
    } else {
        visibleSlugs = visibleSlugs.filter(s => s !== slug);
    }
    saveVisibleRoomSlugs(visibleSlugs);
    renderRoomsSection();
    loadRoomSchedules(false);
}

function renderRoomToggles() {
    const list = document.getElementById('roomTogglesDropdown');
    if (!list) return;
    const rooms = getSavedRooms();
    if (!rooms.length) {
        list.innerHTML = '<li><span class="dropdown-item-text small text-muted">Аудитории не добавлены</span></li>';
        return;
    }
    const visible = getVisibleRoomSlugs();
    const categories = [...new Set(rooms.map(r => r.category || ''))];
    let html = '';
    categories.forEach(cat => {
        if (cat) {
            html += `<li><h6 class="dropdown-header d-flex align-items-center gap-2">📁 ${escapeHtml(cat)}
                <button type="button" class="btn btn-sm btn-link p-0 text-secondary" onclick="renameRoomFolder('${escapeJsString(cat)}')" title="Переименовать папку">✏️</button>
                <button type="button" class="btn btn-sm btn-link p-0 text-danger" onclick="deleteRoomFolder('${escapeJsString(cat)}')" title="Удалить папку">✕</button></h6></li>`;
        }
        rooms.filter(r => (r.category || '') === cat).forEach(room => {
            html += `<li><label class="dropdown-item d-flex align-items-center gap-2">
                <input class="form-check-input mt-0" type="checkbox" ${visible.includes(room.slug) ? 'checked' : ''}
                       onchange="toggleRoomVisibility('${escapeJsString(room.slug)}', this.checked)">
                <span>${escapeHtml(room.name)}</span></label></li>`;
        });
    });
    list.innerHTML = html;
}

// Номер учебной недели для даты из главного календаря (неделя начинается с понедельника).
function _academicWeekForDate(date) {
    const d = new Date(date);
    const year = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
    const sep1 = new Date(year, 8, 1);
    const monday = new Date(sep1);
    monday.setDate(sep1.getDate() - ((sep1.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - monday) / 86400000);
    return Math.max(1, Math.floor(diff / 7) + 1);
}

function _normTeacherName(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function _isMyTeacher(teacherName) {
    const me = (typeof getEzhTeacher === 'function') ? getEzhTeacher() : null;
    if (!me || !me.name || !teacherName) return false;
    const a = _normTeacherName(teacherName);
    const b = _normTeacherName(me.name);
    if (!a || !b) return false;
    if (a === b) return true;
    const at = a.split(' ');
    const bt = b.split(' ');
    if (at[0] !== bt[0]) return false;
    const tail = tokens => tokens.slice(1).join('').replace(/[^a-zа-я]/g, '');
    const ai = tail(at);
    const bi = tail(bt);
    return !!ai && !!bi && (ai.startsWith(bi) || bi.startsWith(ai));
}

function _roomPairRange(pair) {
    if (pair && pair.start && pair.end) return `${pair.start} - ${pair.end}`;
    if (pair && pair.time) return String(pair.time).replace(/[–—]/g, '-');
    return '';
}

function _roomBusyNow(data) {
    const today = getLocalDateStr(new Date());
    const day = (data.days || []).find(d => d.date === today);
    if (!day) return null;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return (day.pairs || []).find(p => {
        if (!_isMyTeacher(p.teacher)) return false;
        const [startMins, endMins] = parseTimeRangeToMins(_roomPairRange(p));
        return startMins && endMins && nowMins >= startMins && nowMins < endMins;
    }) || null;
}

function _renderRoomDays(data) {
    const byDate = {};
    (Array.isArray(data.days) ? data.days : []).forEach(day => { byDate[day.date] = day; });
    const todayIso = getLocalDateStr(new Date());
    const today = new Date(currentBaseDate);

    let html = '<div class="calendar-grid w-100 six-day-grid">';
    for (let i = 0; i < 6; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateStr(d);
        const day = byDate[dateStr];
        const isToday = dateStr === todayIso;
        const header = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' });

        const pairs = ((day && day.pairs) || []).map(p => {
            const mine = _isMyTeacher(p.teacher);
            return `
            <div class="teacher-pair-card room-pair-card${mine ? ' room-pair-mine' : ''}">
                <div class="teacher-pair-head">
                    <span class="room-pair-time">${escapeHtml(p.time || '')}</span>
                    ${p.type ? `<span class="room-pair-type">${escapeHtml(p.type)}</span>` : ''}
                    ${mine ? '<span class="room-pair-me">вы</span>' : ''}
                </div>
                <div class="room-pair-lesson">${escapeHtml(p.lesson || '')}</div>
                ${p.groups && p.groups.length ? `<div class="room-pair-meta">${escapeHtml(p.groups.join(', '))}</div>` : ''}
                ${p.teacher ? `<div class="room-pair-teacher">${escapeHtml(p.teacher)}</div>` : ''}
            </div>`;
        }).join('');

        html += `
            <div class="teacher-col room-col${isToday ? ' day-today' : ''}">
                <div class="teacher-day-header">${escapeHtml(header)}</div>
                ${pairs || '<div class="room-day-empty">Свободно</div>'}
            </div>`;
    }
    html += '</div>';
    return html;
}

function _renderRoomCard(room) {
    const data = roomSchedules[room.slug];
    let body;
    if (roomLoading[room.slug]) {
        body = '<div class="weather-loading">Загрузка расписания…</div>';
    } else if (roomErrors[room.slug] || !data) {
        body = `<div class="room-empty">
            <div class="small text-muted mb-2">Не удалось загрузить расписание</div>
            <button class="btn btn-sm btn-outline-secondary" onclick="loadRoomSchedules(true)">Повторить</button>
        </div>`;
    } else {
        body = _renderRoomDays(data);
    }
    const categoryBadge = room.category
        ? `<span class="room-category-badge">📁 ${escapeHtml(room.category)}</span>`
        : '';
    const busyNow = data ? _roomBusyNow(data) : null;
    const stale = data && data.stale ? '<span class="weather-offline">офлайн</span>' : '';
    return `<div class="teacher-wrapper room-wrapper bg-white rounded shadow-sm px-2 pb-2 pt-1" data-room-slug="${escapeAttr(room.slug)}">
        <div class="teacher-header-row fw-bold text-primary mb-2 ps-1 pt-1">
            <span class="flex-grow-1 room-card-name">🚪 ${escapeHtml(room.name)}</span>
            ${categoryBadge}
            ${busyNow ? '<span class="room-busy-me" title="В этой аудитории сейчас ваша пара">● сейчас ваша пара</span>' : ''}
            ${stale}
            <button type="button" class="btn btn-sm btn-link text-primary p-0 me-2 text-decoration-none"
                    onclick="refreshRoomCard('${escapeJsString(room.slug)}')" title="Обновить расписание">🔄</button>
            <button type="button" class="btn btn-sm btn-link text-primary p-0 me-2 text-decoration-none"
                    onclick="editRoomCategory('${escapeJsString(room.slug)}')" title="Папка">📁</button>
            <button type="button" class="btn btn-sm btn-link text-danger p-0 text-decoration-none"
                    onclick="removeSavedRoom('${escapeJsString(room.slug)}')" title="Убрать аудиторию">🗑️</button>
        </div>
        <div class="room-card-body px-0">${body}</div>
    </div>`;
}

function renderRoomsSection() {
    const section = document.getElementById('roomSection');
    if (!section) return;
    const teacher = typeof isTeacherRole === 'function' && isTeacherRole();
    if (!teacher || !showWidgetRoom) {
        section.style.display = 'none';
        return;
    }
    const rooms = getSavedRooms();
    const container = document.getElementById('roomsCalendarsContainer');

    // Вкладка «Коллеги» активна — раздел скрыт, пока пользователь не переключится.
    const tab = localStorage.getItem('teacherMainTab') || 'teachers';
    if (tab !== 'room') {
        section.style.display = 'none';
        renderRoomToggles();
        return;
    }
    const teachersSection = document.getElementById('teachersSection');
    if (teachersSection) teachersSection.style.display = 'none';

    if (!rooms.length) {
        section.style.display = '';
        if (container) {
            container.innerHTML = `<div class="room-empty room-empty-section">
                <div class="small text-muted mb-2">Аудитории пока не добавлены</div>
                <button class="btn btn-sm btn-outline-primary fw-bold" onclick="openRoomPicker()">+ Добавить аудиторию</button>
            </div>`;
        }
        renderRoomToggles();
        return;
    }

    const visible = getVisibleRoomSlugs();
    const shown = rooms.filter(r => visible.includes(r.slug));

    section.style.display = '';

    if (!shown.length) {
        if (container) {
            container.innerHTML = `<div class="room-empty room-empty-section">
                <div class="small text-muted mb-2">Все аудитории скрыты</div>
                <button class="btn btn-sm btn-outline-primary fw-bold" onclick="openRoomPicker()">+ Добавить аудиторию</button>
            </div>`;
        }
        renderRoomToggles();
        return;
    }

    const categories = [...new Set(shown.map(r => r.category || ''))];
    const html = categories.map(cat => {
        const cards = shown.filter(r => (r.category || '') === cat).map(_renderRoomCard).join('');
        const head = cat
            ? `<div class="room-folder-head"><span>📁 ${escapeHtml(cat)}</span>
                 <button type="button" class="btn btn-sm btn-link p-0" onclick="renameRoomFolder('${escapeJsString(cat)}')" title="Переименовать">✏️</button>
                 <button type="button" class="btn btn-sm btn-link p-0 text-danger" onclick="deleteRoomFolder('${escapeJsString(cat)}')" title="Удалить папку">✕</button></div>`
            : '';
        return `<div class="room-folder">${head}${cards}</div>`;
    }).join('');

    if (container) container.innerHTML = html;
    renderRoomToggles();
}

async function refreshRoomCard(slug) {
    if (!slug) return;
    const week = _academicWeekForDate(currentBaseDate);
    roomLoading[slug] = true;
    roomErrors[slug] = false;
    renderRoomsSection();
    try {
        const url = `/api/room_schedule?slug=${encodeURIComponent(slug)}&week=${week}&force=1`;
        const data = await apiGet(url);
        roomSchedules[slug] = data;
    } catch (e) {
        console.error('room schedule refresh:', slug, e);
        roomErrors[slug] = true;
    } finally {
        roomLoading[slug] = false;
        renderRoomsSection();
    }
}

async function loadRoomSchedules(force) {
    const teacher = typeof isTeacherRole === 'function' && isTeacherRole();
    if (!teacher) return;
    if (!force && (localStorage.getItem('teacherMainTab') || 'teachers') !== 'room') return;
    const slugs = getVisibleRoomSlugs();
    if (!slugs.length) return;
    const week = _academicWeekForDate(currentBaseDate);
    await Promise.all(slugs.map(async slug => {
        if (!force && roomSchedules[slug] && roomSchedules[slug].week === week) return;
        roomLoading[slug] = true;
        roomErrors[slug] = false;
        renderRoomsSection();
        try {
            const url = `/api/room_schedule?slug=${encodeURIComponent(slug)}&week=${week}${force ? '&force=1' : ''}`;
            const data = await apiGet(url);
            roomSchedules[slug] = data;
        } catch (e) {
            console.error('room schedule:', slug, e);
            roomErrors[slug] = true;
        } finally {
            roomLoading[slug] = false;
        }
    }));
    renderRoomsSection();
}

function refreshRoomsForCurrentWeek() {
    if (typeof isTeacherRole !== 'function' || !isTeacherRole() || !showWidgetRoom) return;
    if ((localStorage.getItem('teacherMainTab') || 'teachers') !== 'room') return;
    renderRoomsSection();
    loadRoomSchedules(false);
}

function refreshRoomSchedules() {
    loadRoomSchedules(true);
}

function switchTeacherMainTab(tab) {
    localStorage.setItem('teacherMainTab', tab === 'room' ? 'room' : 'teachers');
    const teachersSection = document.getElementById('teachersSection');
    const roomSection = document.getElementById('roomSection');
    if (teachersSection) teachersSection.style.display = tab === 'room' ? 'none' : '';
    if (roomSection) roomSection.style.display = tab === 'room' && showWidgetRoom ? '' : 'none';
    if (tab === 'room') {
        renderRoomsSection();
        loadRoomSchedules(false);
    }
}

function initRoomsSection() {
    if (typeof isTeacherRole !== 'function' || !isTeacherRole()) return;
    try { localStorage.removeItem('roomWeek'); } catch (e) {}
    const roomBtn = document.getElementById('switchTabToRoomBtn');
    if (roomBtn) roomBtn.style.display = showWidgetRoom ? '' : 'none';
    renderRoomToggles();
    renderRoomsSection();

    // Восстанавливаем активную вкладку после перезагрузки: «Коллеги» или
    // «Аудитория». Иначе обе секции остаются видимыми и виджет делится на два.
    const teachersSection = document.getElementById('teachersSection');
    const roomSection = document.getElementById('roomSection');
    const tab = localStorage.getItem('teacherMainTab') || 'teachers';
    const showRoom = tab === 'room' && showWidgetRoom;
    if (teachersSection) teachersSection.style.display = showRoom ? 'none' : '';
    if (roomSection) roomSection.style.display = showRoom ? '' : 'none';
    if (showRoom) loadRoomSchedules(false);
}

// --- Выбор аудитории ---

function _renderRoomPickerList() {
    const list = document.getElementById('roomPickerList');
    if (!list) return;
    const q = (document.getElementById('roomSearchInput')?.value || '').trim().toLowerCase();
    const added = new Set(getSavedRooms().map(r => r.slug));
    const items = (roomLocationsCache || []).filter(item =>
        !q || item.name.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q)
    );
    if (!items.length) {
        list.innerHTML = '<div class="small text-muted p-3 text-center">Ничего не найдено</div>';
        return;
    }
    list.innerHTML = items.map(item => `
        <button type="button" class="room-pick-item${added.has(item.slug) ? ' active' : ''}"
                data-slug="${escapeAttr(item.slug)}" data-name="${escapeAttr(item.name)}">
            <span>${escapeHtml(item.name)}</span>
            <span class="room-pick-slug">${escapeHtml(item.slug)}</span>
        </button>`).join('');
}

function filterRoomPicker() {
    _renderRoomPickerList();
}

async function openRoomPicker() {
    const modalEl = document.getElementById('roomPickerModal');
    if (!modalEl || typeof bootstrap === 'undefined') return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    const list = document.getElementById('roomPickerList');
    if (list) list.innerHTML = '<div class="small text-muted p-3 text-center">Загрузка списка аудиторий…</div>';
    try {
        if (!roomLocationsCache) {
            const data = await apiGet('/api/locations');
            roomLocationsCache = data.items || [];
        }
        _renderRoomPickerList();
    } catch (e) {
        console.error('locations:', e);
        if (list) list.innerHTML = '<div class="small text-muted p-3 text-center">Не удалось загрузить список аудиторий</div>';
    }
}

function selectRoom(slug, name) {
    addSavedRoom(slug, name);
}

document.addEventListener('DOMContentLoaded', function () {
    const list = document.getElementById('roomPickerList');
    if (list) {
        list.addEventListener('click', function (ev) {
            const btn = ev.target.closest('.room-pick-item');
            if (!btn) return;
            selectRoom(btn.dataset.slug, btn.dataset.name);
        });
    }
    const search = document.getElementById('roomSearchInput');
    if (search) search.addEventListener('input', filterRoomPicker);
    if (typeof isTeacherRole === 'function' && isTeacherRole()) initRoomsSection();
});
