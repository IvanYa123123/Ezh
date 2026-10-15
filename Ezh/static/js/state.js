// Глобальное состояние приложения.
//
// v3.14.1:
//   • В объединённом режиме друзья и преподаватели всегда живут в одной
//     зоне. При переключении вкладки скрытая секция подтягивается к
//     видимой — иначе она остаётся в старой зоне и «прыгает» при
//     смене таба.

let currentBaseDate = new Date();
currentBaseDate.setDate(currentBaseDate.getDate() - (currentBaseDate.getDay() === 0 ? 6 : currentBaseDate.getDay() - 1));

let cachedSchedule = [];
let cachedLabs = {};
let cachedSubjectSettings = {};
let globalChart = null;
let globalLabChart = null;
let currentSubjectsList = [];

let validGroups = new Set();
let allGroups = [];
let groupsLoaded = false;

let friendsList = [];
let friendsSchedules = {};
let visibleFriends = new Set(JSON.parse(localStorage.getItem('visibleFriends') || '[]'));
let draggingFriendId = null;
let editingFriendId = null;
let draggingDropdownFriendId = null;
let customCategories = JSON.parse(localStorage.getItem('customCategories') || '[]');

let expandedDayDateStr = null;
let customScheduleItems = [];

let showTeacher  = localStorage.getItem('showTeacher')  !== 'false';
let showLocation = localStorage.getItem('showLocation') !== 'false';
let showFriends  = localStorage.getItem('showFriends')  !== 'false';

let showStatus = localStorage.getItem('showStatus') !== 'false';
let statusFormat = localStorage.getItem('statusFormat') || 'interval';
let statusPrecision = localStorage.getItem('statusPrecision') || 'min';
if (!['min', 'sec', 'cs'].includes(statusPrecision)) statusPrecision = 'min';

function getStatusTickMs() {
    if (statusPrecision === 'cs')  return 100;
    if (statusPrecision === 'sec') return 1000;
    return 30000;
}
let _statusIntervalId = null;

let notificationsEnabled = localStorage.getItem('notificationsEnabled') === 'true';

let notificationAdvance = parseInt(localStorage.getItem('notificationAdvance') || '', 10);
let notificationUnit    = localStorage.getItem('notificationUnit') || '';

if (isNaN(notificationAdvance) || notificationAdvance < 1) {
    const legacy = parseInt(localStorage.getItem('notificationMinutes') || '15', 10);
    notificationAdvance = (isNaN(legacy) || legacy < 1) ? 15 : legacy;
}
if (notificationAdvance > 60) notificationAdvance = 60;

if (!['min', 'hour', 'day', 'week'].includes(notificationUnit)) {
    notificationUnit = 'min';
}

let theme = localStorage.getItem('theme') || 'light';

let taskDatesSet = new Set();

let loaderInterval = null;

function saveVisibleFriends() {
    localStorage.setItem('visibleFriends', JSON.stringify([...visibleFriends]));
}

let showWidgetMiniCal = localStorage.getItem('showWidgetMiniCal') !== 'false';
let showWidgetGlobal  = localStorage.getItem('showWidgetGlobal')  !== 'false';
let showWidgetLabs    = localStorage.getItem('showWidgetLabs')    !== 'false';
let showWidgetPacing  = localStorage.getItem('showWidgetPacing')  !== 'false';
let showWidgetNotes   = localStorage.getItem('showWidgetNotes')   !== 'false';

let showFriendsSection  = localStorage.getItem('showFriendsSection')  !== 'false';
let showTeachersSection = localStorage.getItem('showTeachersSection') !== 'false';

let separateFriendsTeachers = localStorage.getItem('separateFriendsTeachers') === 'true';
let friendsTeachersTab = localStorage.getItem('friendsTeachersTab') || 'friends';

// ============================================================
//  ОБЪЕДИНЁННЫЙ ВИДЖЕТ ДРУЗЬЯ/ПРЕПОДАВАТЕЛИ
// ============================================================

function applyFriendsTeachersVisibility() {
    const friendsEl  = document.getElementById('friendsSection');
    const teachersEl = document.getElementById('teachersSection');
    const btnToTeachers = document.getElementById('switchTabToTeachersBtn');
    const btnToFriends  = document.getElementById('switchTabToFriendsBtn');
    if (!friendsEl || !teachersEl) return;

    const showF = showFriendsSection;
    const showT = showTeachersSection;

    if (separateFriendsTeachers) {
        friendsEl.style.display  = showF ? '' : 'none';
        teachersEl.style.display = showT ? '' : 'none';
        if (btnToTeachers) btnToTeachers.style.display = 'none';
        if (btnToFriends)  btnToFriends.style.display  = 'none';
        return;
    }

    if (!showF && !showT) {
        friendsEl.style.display  = 'none';
        teachersEl.style.display = 'none';
        if (btnToTeachers) btnToTeachers.style.display = 'none';
        if (btnToFriends)  btnToFriends.style.display  = 'none';
        return;
    }

    let tab = friendsTeachersTab;
    if (!showF && showT) tab = 'teachers';
    if (showF && !showT) tab = 'friends';

    if (tab === 'friends') {
        friendsEl.style.display  = '';
        teachersEl.style.display = 'none';
        if (btnToTeachers) btnToTeachers.style.display = showT ? '' : 'none';
        if (btnToFriends)  btnToFriends.style.display  = 'none';
    } else {
        friendsEl.style.display  = 'none';
        teachersEl.style.display = '';
        if (btnToTeachers) btnToTeachers.style.display = 'none';
        if (btnToFriends)  btnToFriends.style.display  = showF ? '' : 'none';
    }
}

// ------------------------------------------------------------
//  Синхронизация зоны размещения.
//  В объединённом режиме обе секции должны лежать в одной
//  зоне (#mainColumnSections или #rightWidgetsZone). Иначе
//  при переключении вкладки скрытая секция остаётся в старой
//  зоне, и пользователь видит «прыжок» раздела между областями.
// ------------------------------------------------------------

function _syncFriendsTeachersZone() {
    if (separateFriendsTeachers) return;

    const friendsEl  = document.getElementById('friendsSection');
    const teachersEl = document.getElementById('teachersSection');
    if (!friendsEl || !teachersEl) return;

    const fVisible = friendsEl.style.display !== 'none';
    const tVisible = teachersEl.style.display !== 'none';

    let activeEl, inactiveEl;
    if (fVisible && !tVisible) {
        activeEl = friendsEl;
        inactiveEl = teachersEl;
    } else if (tVisible && !fVisible) {
        activeEl = teachersEl;
        inactiveEl = friendsEl;
    } else {
        // Обе видны (раздельный или init) или обе скрыты — синхронизировать нечего.
        return;
    }

    const activeZone = activeEl.parentElement;
    if (!activeZone) return;
    if (inactiveEl.parentElement === activeZone) return;

    // Переносим неактивную секцию сразу за активной — порядок в зоне сохраняется.
    activeZone.insertBefore(inactiveEl, activeEl.nextSibling);

    if (typeof _saveLayout === 'function') {
        try { _saveLayout(); } catch (e) {}
    }
    if (typeof _updateHorizontalLayout === 'function') {
        try { _updateHorizontalLayout(); } catch (e) {}
    }
}

function switchFriendsTeachersTab(tab) {
    if (tab !== 'friends' && tab !== 'teachers') return;
    friendsTeachersTab = tab;
    try { localStorage.setItem('friendsTeachersTab', tab); } catch (e) {}

    // ВАЖНО: синхронизация зоны ДО смены display — чтобы неактивная
    // секция уже стояла в целевой зоне, когда мы её покажем.
    _syncFriendsTeachersZone();

    applyFriendsTeachersVisibility();

    if (typeof renderTeachersCalendars === 'function') {
        try { renderTeachersCalendars(); } catch (e) { console.error(e); }
    }
    if (typeof renderFriendsCalendar === 'function') {
        try { renderFriendsCalendar(); } catch (e) { console.error(e); }
    }
}

// ============================================================
//  SYNC TIMES
// ============================================================

function loadSyncTimes() {
    try {
        const raw = localStorage.getItem('sync_times');
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
}

function saveSyncTime(group, subgroup) {
    try {
        const map = loadSyncTimes();
        map[`${group}_${subgroup}`] = Date.now();
        localStorage.setItem('sync_times', JSON.stringify(map));
    } catch (e) {}
}

function getSyncTime(group, subgroup) {
    const map = loadSyncTimes();
    return map[`${group}_${subgroup}`] || null;
}

// ============================================================
//  UNDO
// ============================================================

let _undoTimer = null;
let _undoCallback = null;

function scheduleUndo(message, callback, durationMs = 6000) {
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    _undoCallback = callback;

    if (typeof showUndoBar === 'function') {
        showUndoBar(message, () => {
            const cb = _undoCallback;
            _undoCallback = null;
            if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
            if (typeof hideUndoBar === 'function') hideUndoBar();
            if (typeof cb === 'function') cb();
        });
    }

    _undoTimer = setTimeout(() => {
        _undoCallback = null;
        _undoTimer = null;
        if (typeof hideUndoBar === 'function') hideUndoBar();
    }, durationMs);
}

function cancelUndo() {
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    _undoCallback = null;
    if (typeof hideUndoBar === 'function') hideUndoBar();
}

// ============================================================
//  ВИДЖЕТ «ЗАМЕТКИ»
// ============================================================

function initNotesWidget() {
    const ta = document.getElementById('notesWidgetText');
    if (!ta) return;
    try { ta.value = localStorage.getItem('notesWidget') || ''; } catch (e) {}
}

function onNotesWidgetInput(el) {
    if (!el) return;
    try { localStorage.setItem('notesWidget', el.value); } catch (e) {}
}

function moveNotesWidget() {
    console.warn('[state] moveNotesWidget() устарела');
}

function restoreNotesWidgetZone() {}

// ============================================================
//  ВЕРТИКАЛЬНЫЙ РЕЖИМ: ДЕНЬ
// ============================================================

let _verticalDayOffset = null;

function _getVerticalDate() {
    if (expandedDayDateStr) {
        const [y, m, d] = expandedDayDateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    if (_verticalDayOffset !== null) {
        const d = new Date(currentBaseDate);
        d.setDate(d.getDate() + _verticalDayOffset);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const base = new Date(currentBaseDate);
    base.setHours(0, 0, 0, 0);
    const diff = Math.round((today - base) / 86400000);
    if (diff >= 0 && diff <= 6) return today;
    return base;
}

function _setVerticalDate(date) {
    const base = new Date(currentBaseDate);
    base.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    _verticalDayOffset = Math.round((d - base) / 86400000);
}

function verticalDayPrev() {
    if (expandedDayDateStr) {
        if (typeof _navigateDay === 'function') _navigateDay(-1);
        return;
    }
    const cur = _getVerticalDate();
    cur.setDate(cur.getDate() - 1);
    _setVerticalDate(cur);
    _rerenderSections();
}

function verticalDayNext() {
    if (expandedDayDateStr) {
        if (typeof _navigateDay === 'function') _navigateDay(1);
        return;
    }
    const cur = _getVerticalDate();
    cur.setDate(cur.getDate() + 1);
    _setVerticalDate(cur);
    _rerenderSections();
}

function _rerenderSections() {
    if (typeof renderFriendsCalendar === 'function') renderFriendsCalendar();
    if (typeof renderTeachersCalendars === 'function') renderTeachersCalendars();
}

// ============================================================
//  МИНИ-КАЛЕНДАРЬ: ПАНЕЛЬ СОБЫТИЙ
// ============================================================

let _miniCalEventsTimer = null;
let _miniCalEventsToken = 0;

function refreshMiniCalEvents() {
    if (_miniCalEventsTimer) clearTimeout(_miniCalEventsTimer);
    _miniCalEventsTimer = setTimeout(_renderMiniCalEventsNow, 150);
}

async function _renderMiniCalEventsNow() {
    const container = document.getElementById('miniCalEvents');
    if (!container) return;

    const card = document.getElementById('widgetMiniCalCard');
    if (!card || !card.classList.contains('is-horizontal')) {
        container.innerHTML = '';
        return;
    }

    const token = ++_miniCalEventsToken;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = getLocalDateStr(today);
    const MAX_DAYS = 90;

    const events = [];
    for (let i = 0; i < MAX_DAYS; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateStr(d);

        let items = [];
        try { items = getCustomItemsForDate(dateStr) || []; } catch (e) { continue; }

        items.forEach(ev => {
            if (!ev.is_event) return;
            events.push({
                date: dateStr,
                time: ev.time_range || '',
                title: ev.lesson || 'Событие',
            });
        });
    }

    let tasks = [];
    try {
        const endD = new Date(today);
        endD.setDate(endD.getDate() + MAX_DAYS);
        const endStr = getLocalDateStr(endD);
        const raw = await apiLoadTasks(todayStr, endStr);
        tasks = (Array.isArray(raw) ? raw : [])
            .filter(t => t.status !== 'completed')
            .map(t => ({
                date: t.date,
                time: '',
                title: t.text || 'Заметка',
            }));
    } catch (e) {
        tasks = [];
    }

    if (token !== _miniCalEventsToken) return;

    const sorter = (a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.time || '').localeCompare(b.time || '');
    };
    events.sort(sorter);
    tasks.sort(sorter);

    const eventsLimited = events.slice(0, 30);
    const tasksLimited  = tasks.slice(0, 30);

    let html = '<div class="mini-cal-events-cols">';

    html += '<div class="mini-cal-events-col">';
    html += '<div class="mini-cal-events-col-header">📝 Заметки</div>';
    if (tasksLimited.length === 0) {
        html += '<div class="mini-cal-events-empty">Нет заметок</div>';
    } else {
        tasksLimited.forEach(item => { html += _renderMiniCalRow(item); });
    }
    html += '</div>';

    html += '<div class="mini-cal-events-col">';
    html += '<div class="mini-cal-events-col-header">🎯 События</div>';
    if (eventsLimited.length === 0) {
        html += '<div class="mini-cal-events-empty">Нет событий</div>';
    } else {
        eventsLimited.forEach(item => { html += _renderMiniCalRow(item); });
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
}

function _renderMiniCalRow(item) {
    const timeHtml = item.time
        ? `<span class="mini-cal-events-time">${escapeHtml(item.time.split(' - ')[0])}</span>`
        : '<span class="mini-cal-events-time mini-cal-events-time-empty">—</span>';
    return '<div class="mini-cal-events-item">'
         + `<span class="mini-cal-events-date">${escapeHtml(formatDateRu(item.date))}</span>`
         + timeHtml
         + `<span class="mini-cal-events-title">${escapeHtml(item.title)}</span>`
         + '</div>';
}

// ============================================================
//  DRAG & DROP ВИДЖЕТОВ (Pointer Events + SVG-ёжик)
// ============================================================

const _widgetZoneIds = [
    'rightWidgetsZone',
    'underCalendarWidgetsZone',
    'mainColumnSections',
];

const _WIDE_ZONE_IDS = [
    'underCalendarWidgetsZone',
    'mainColumnSections',
];

const _ROW_WRAP_ZONE_IDS = [];

const WIDGET_LAYOUT_KEY = 'widgetLayout';

const _HORIZONTAL_PLACEHOLDER_H = 200;
const _VERTICAL_PLACEHOLDER_W = 320;
const _VERTICAL_PLACEHOLDER_H = 180;
const _PLACEHOLDER_HYSTERESIS = 30;

const _DRAG_EDGE_PX = 90;
const _DRAG_EDGE_STEP = 14;
const _DRAG_EDGE_THROTTLE = 16;

const _DRAG_HEDGEHOG_URL  = '/static/img/hedgehog.svg';
const _DRAG_HEDGEHOG_SIZE = 64;

let _hedgehogSvgMarkup = '';

const _LEG_DURATION_SLOW = 1.20;
const _LEG_DURATION_FAST = 0.15;
const _LEG_SPEED_LOW  = 0.2;
const _LEG_SPEED_HIGH = 2.5;
const _LEG_SPEED_EMA = 0.35;
const _DRAG_DIR_MIN_PX = 1.5;

let _dragStartSize = { w: 0, h: 0 };
let _lastEdgeScrollTs = 0;
let _dragState = null;
let _ghostEl = null;
let _cursorStyleInjected = false;

function _ensureDragCursorStyle() {
    if (_cursorStyleInjected) return;
    _cursorStyleInjected = true;
    const s = document.createElement('style');
    s.id = 'drag-cursor-style';
    s.textContent = `
        body.widget-dragging,
        body.widget-dragging * {
            cursor: grabbing !important;
        }
    `;
    document.head.appendChild(s);
}

function initWidgetDragAndDrop() {
    document.querySelectorAll('.widget-drag-handle, .section-drag-handle')
        .forEach(h => h.removeAttribute('draggable'));

    _ensureDragCursorStyle();
    _preloadHedgehogSvg();

    _restoreLayout();
    _widgetZoneIds.forEach(id => _initSortableZone(id));

    _applyHorizontalLayoutSync();

    // После восстановления раскладки могли оказаться ситуации,
    // когда в объединённом режиме секции лежат в разных зонах.
    // Подтягиваем скрытую к видимой.
    if (typeof _syncFriendsTeachersZone === 'function') {
        try { _syncFriendsTeachersZone(); } catch (e) {}
    }
}

function _preloadHedgehogSvg() {
    fetch(_DRAG_HEDGEHOG_URL)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        })
        .then(text => { _hedgehogSvgMarkup = text; })
        .catch(e => {
            console.warn('[drag] не удалось загрузить hedgehog.svg:', e);
            _hedgehogSvgMarkup = '<div style="font-size:56px;line-height:1;">🦔</div>';
        });
}

function _widgetZoneSelector() {
    return '.widget-card, [data-draggable-section]';
}

function _isWideZone(el) {
    return !!(el && el.id && _WIDE_ZONE_IDS.indexOf(el.id) !== -1);
}

function _isRowWrapZone(el) {
    return !!(el && el.id && _ROW_WRAP_ZONE_IDS.indexOf(el.id) !== -1);
}

// ============================================================
//  ИНИЦИАЛИЗАЦИЯ ЗОНЫ
// ============================================================

function _initSortableZone(zoneId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    if (zone.dataset.dragInit === '1') return;
    zone.dataset.dragInit = '1';

    zone.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (_dragState) return;

        const handle = e.target.closest('.widget-drag-handle, .section-drag-handle');
        if (!handle || !zone.contains(handle)) return;

        const card = handle.closest(_widgetZoneSelector());
        if (!card || !zone.contains(card)) return;

        e.preventDefault();
        _startDrag(card, e);
    });
}

// ============================================================
//  СТАРТ / ДВИЖЕНИЕ / КОНЕЦ
// ============================================================

function _startDrag(card, e) {
    _dragState = {
        card: card,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: performance.now(),
        speedEma: 0,
        dir: 0,
    };

    _dragStartSize = { w: card.offsetWidth, h: card.offsetHeight };

    card.classList.add('widget-dragging');
    document.body.classList.add('widget-dragging');
    window._draggingWidgetId = card.id;

    _createGhost(e.clientX, e.clientY);
    _scheduleDragLayoutRefresh();

    document.addEventListener('pointermove', _onDragMove, { passive: false });
    document.addEventListener('pointerup', _onDragUp);
    document.addEventListener('pointercancel', _onDragCancel);
    document.addEventListener('wheel', _onDragWheel, { passive: false, capture: true });
    document.addEventListener('keydown', _onDragKey, true);

    _onDragMove(e);
}

function _onDragMove(e) {
    if (!_dragState) return;
    e.preventDefault();

    const now = performance.now();
    const dt = Math.max(1, now - _dragState.lastT);
    const dx = e.clientX - _dragState.lastX;
    const dy = e.clientY - _dragState.lastY;
    const instantSpeed = Math.sqrt(dx * dx + dy * dy) / dt;

    _dragState.lastX = e.clientX;
    _dragState.lastY = e.clientY;
    _dragState.lastT = now;

    const k = _LEG_SPEED_EMA;
    _dragState.speedEma = _dragState.speedEma * (1 - k) + instantSpeed * k;

    const t = Math.max(0, Math.min(1,
        (_dragState.speedEma - _LEG_SPEED_LOW) /
        (_LEG_SPEED_HIGH - _LEG_SPEED_LOW)
    ));
    const legDuration = _LEG_DURATION_SLOW +
        (_LEG_DURATION_FAST - _LEG_DURATION_SLOW) * t;

    let newDir = _dragState.dir;
    if (Math.abs(dx) > _DRAG_DIR_MIN_PX) {
        newDir = dx > 0 ? 1 : -1;
    }

    const inner = _ghostEl && _ghostEl.firstElementChild;
    if (inner) {
        const svg = inner.querySelector('svg') || inner;
        svg.style.setProperty('--leg-duration', legDuration.toFixed(3) + 's');

        if (newDir !== 0 && newDir !== _dragState.dir) {
            _dragState.dir = newDir;
            inner.classList.toggle('is-flipped', newDir < 0);
        }
    }

    _moveGhost(e.clientX, e.clientY);
    _autoScrollIfNearEdge(e);

    const zone = _zoneUnderPoint(e.clientX, e.clientY);
    if (!zone) {
        _removeDropPlaceholder();
        return;
    }

    _positionPlaceholder(zone, _dragState.card, e);
}

function _onDragUp(e) {
    if (!_dragState) return;

    const card = _dragState.card;
    const ph = window._dropPlaceholder;

    if (ph && ph.parentElement) {
        ph.parentElement.insertBefore(card, ph);
    }

    _endDrag();
}

function _onDragCancel() {
    if (!_dragState) return;
    _endDrag();
}

function _onDragKey(e) {
    if (!_dragState) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        _endDrag();
    }
}

function _onDragWheel(e) {
    if (!_dragState) return;
    e.preventDefault();
    window.scrollBy(0, e.deltaY);
}

function _endDrag() {
    if (!_dragState) return;

    const card = _dragState.card;
    _dragState = null;

    card.classList.remove('widget-dragging');
    document.body.classList.remove('widget-dragging');
    window._draggingWidgetId = null;
    _dragStartSize = { w: 0, h: 0 };

    _destroyGhost();
    _removeDropPlaceholder();

    document.removeEventListener('pointermove', _onDragMove);
    document.removeEventListener('pointerup', _onDragUp);
    document.removeEventListener('pointercancel', _onDragCancel);
    document.removeEventListener('wheel', _onDragWheel, { capture: true });
    document.removeEventListener('keydown', _onDragKey, true);

    _scheduleDragLayoutRefresh();
    _updateHorizontalLayout();

    _saveLayout();
    _refreshAfterMove(card);
}

// ============================================================
//  SVG-ЁЖИК-ПРИЗРАК
// ============================================================

function _createGhost(x, y) {
    _destroyGhost();

    const wrap = document.createElement('div');
    wrap.className = 'drag-hedgehog-wrap';
    wrap.style.width  = _DRAG_HEDGEHOG_SIZE + 'px';
    wrap.style.height = _DRAG_HEDGEHOG_SIZE + 'px';
    wrap.style.transform = 'translate(-9999px, -9999px)';

    const inner = document.createElement('div');
    inner.className = 'drag-hedgehog';
    inner.innerHTML = _hedgehogSvgMarkup ||
        '<div style="font-size:56px;line-height:1;">🦔</div>';

    const svg = inner.querySelector('svg');
    if (svg) svg.style.setProperty('--leg-duration', _LEG_DURATION_SLOW.toFixed(3) + 's');

    wrap.appendChild(inner);
    document.body.appendChild(wrap);

    _ghostEl = wrap;
    _moveGhost(x, y);
}

function _moveGhost(x, y) {
    if (!_ghostEl) return;
    const half = _DRAG_HEDGEHOG_SIZE / 2;
    _ghostEl.style.transform = 'translate(' + (x - half) + 'px, ' + (y - half) + 'px)';
}

function _destroyGhost() {
    if (_ghostEl && _ghostEl.parentElement) {
        _ghostEl.parentElement.removeChild(_ghostEl);
    }
    _ghostEl = null;
}

// ============================================================
//  ОПРЕДЕЛЕНИЕ ЗОНЫ ПОД КУРСОРОМ
// ============================================================

function _zoneUnderPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el) {
        const zone = el.closest('#rightWidgetsZone, #underCalendarWidgetsZone, #mainColumnSections');
        if (zone) return zone;
    }

    const _pad = 20;
    const candidates = [];

    for (const id of _widgetZoneIds) {
        const z = document.getElementById(id);
        if (!z) continue;
        const r = z.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (x >= r.left - _pad && x <= r.right + _pad) {
            candidates.push({ zone: z, rect: r });
        }
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].zone;

    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
        let dist = 0;
        if (y < c.rect.top)         dist = c.rect.top - y;
        else if (y > c.rect.bottom) dist = y - c.rect.bottom;
        if (dist < bestDist) {
            bestDist = dist;
            best     = c.zone;
        }
    }
    return best;
}

// ============================================================
//  АВТОСКРОЛЛ У КРАЯ
// ============================================================

function _autoScrollIfNearEdge(e) {
    if (!_dragState) return;

    const now = Date.now();
    if (now - _lastEdgeScrollTs < _DRAG_EDGE_THROTTLE) return;

    const y = e.clientY;
    const h = window.innerHeight;

    if (y < _DRAG_EDGE_PX) {
        _lastEdgeScrollTs = now;
        window.scrollBy(0, -_DRAG_EDGE_STEP);
    } else if (y > h - _DRAG_EDGE_PX) {
        _lastEdgeScrollTs = now;
        window.scrollBy(0, _DRAG_EDGE_STEP);
    }
}

// ============================================================
//  ФОРМАТ ВИДЖЕТА
// ============================================================

let _hLayoutRaf = null;

function _applyHorizontalLayoutSync() {
    document.querySelectorAll(_widgetZoneSelector()).forEach(el => {
        const isHorizontal = _isWideZone(el.parentElement);
        el.classList.toggle('is-horizontal', isHorizontal);
        el.classList.toggle('is-vertical', !isHorizontal);
    });
}

function _updateHorizontalLayout() {
    _applyHorizontalLayoutSync();

    if (_hLayoutRaf) cancelAnimationFrame(_hLayoutRaf);
    _hLayoutRaf = requestAnimationFrame(() => {
        _hLayoutRaf = null;
        _applyHorizontalLayoutSync();

        if (typeof globalChart !== 'undefined' && globalChart) {
            try { globalChart.resize(); } catch (e) {}
        }
        if (typeof globalLabChart !== 'undefined' && globalLabChart) {
            try { globalLabChart.resize(); } catch (e) {}
        }

        if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
    });
}

window._updateHorizontalLayout = _updateHorizontalLayout;

let _dragLayoutTimer = null;

function _scheduleDragLayoutRefresh() {
    if (_dragLayoutTimer) clearTimeout(_dragLayoutTimer);
    _dragLayoutTimer = setTimeout(() => {
        _dragLayoutTimer = null;
        _updateHorizontalLayout();
    }, 60);
}

// ============================================================
//  ПОЗИЦИОНИРОВАНИЕ ПЛЕЙСХОЛДЕРА
// ============================================================

function _visibleCards(zone, excluded) {
    return [...zone.querySelectorAll(_widgetZoneSelector())]
        .filter(c => c !== excluded)
        .filter(c => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
}

function _positionPlaceholder(zone, dragged, e) {
    if (!zone.clientWidth || !zone.clientHeight) return;

    const ph = window._dropPlaceholder;

    let targetCard = e.target && e.target.closest && e.target.closest(_widgetZoneSelector());
    if (targetCard === dragged || targetCard === ph) targetCard = null;
    if (targetCard) {
        const tr = targetCard.getBoundingClientRect();
        if (tr.width === 0 || tr.height === 0) targetCard = null;
    }

    if (!targetCard) {
        const cards = _visibleCards(zone, dragged).filter(c => c !== ph);

        if (cards.length === 0) {
            _showDropPlaceholderAtEnd(zone, dragged);
            return;
        }

        let closest = null;
        let minDist = Infinity;
        for (const c of cards) {
            const r = c.getBoundingClientRect();
            const midY = r.top + r.height / 2;
            const dist = Math.abs(e.clientY - midY);
            if (dist < minDist) { minDist = dist; closest = c; }
        }
        targetCard = closest;
    }

    if (!targetCard) {
        _showDropPlaceholderAtEnd(zone, dragged);
        return;
    }

    const rect = targetCard.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const distFromCenter = e.clientY - center;

    let before;
    if (_isRowWrapZone(zone)) {
        const sameRow = e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4;
        before = sameRow
            ? (e.clientX < rect.left + rect.width / 2)
            : (e.clientY < center);
    } else {
        before = distFromCenter < 0;
    }

    if (ph
        && ph.parentElement === zone
        && ph.dataset.forId === targetCard.id) {
        const prevBefore = ph.dataset.before === 'true';
        if (prevBefore !== before && Math.abs(distFromCenter) < _PLACEHOLDER_HYSTERESIS) {
            return;
        }
    }

    _showDropPlaceholder(targetCard, before);
}

// ============================================================
//  ПЛЕЙСХОЛДЕР
// ============================================================

function _calcPlaceholderSize(zone, dragged) {
    if (_isWideZone(zone)) {
        const zoneW = zone.clientWidth || 0;
        return { w: zoneW, h: _HORIZONTAL_PLACEHOLDER_H };
    }

    if (_dragStartSize.w > 0 && _dragStartSize.h > 0) {
        return { w: _dragStartSize.w, h: _dragStartSize.h };
    }
    return { w: _VERTICAL_PLACEHOLDER_W, h: _VERTICAL_PLACEHOLDER_H };
}

function _showDropPlaceholder(targetCard, before) {
    const current = window._dropPlaceholder;
    const dragged = _dragState ? _dragState.card : null;
    const zone = targetCard.parentElement;
    if (!zone) return;

    const { w, h } = _calcPlaceholderSize(zone, dragged);

    if (current
        && current.dataset.forId === targetCard.id
        && current.dataset.before === String(before)
        && current.parentElement === zone) {
        if (w && current.style.width  !== w + 'px') current.style.width  = w + 'px';
        if (h && current.style.height !== h + 'px') current.style.height = h + 'px';
        return;
    }

    _removeDropPlaceholder();

    const ph = document.createElement('div');
    ph.className = 'widget-drop-placeholder';
    ph.dataset.forId = targetCard.id;
    ph.dataset.before = String(before);
    if (w) ph.style.width  = w + 'px';
    if (h) ph.style.height = h + 'px';
    ph.style.flex = '0 0 auto';

    if (before) {
        zone.insertBefore(ph, targetCard);
    } else {
        zone.insertBefore(ph, targetCard.nextSibling);
    }

    window._dropPlaceholder = ph;
}

function _showDropPlaceholderAtEnd(zone, dragged) {
    const current = window._dropPlaceholder;

    if (current
        && current.parentElement === zone
        && current.dataset.atEnd === '1'
        && !current.nextElementSibling) {
        return;
    }

    _removeDropPlaceholder();

    const { w, h } = _calcPlaceholderSize(zone, dragged);

    const ph = document.createElement('div');
    ph.className = 'widget-drop-placeholder';
    ph.dataset.atEnd = '1';
    if (w) ph.style.width  = w + 'px';
    if (h) ph.style.height = h + 'px';
    ph.style.flex = '0 0 auto';

    zone.appendChild(ph);
    window._dropPlaceholder = ph;
}

function _removeDropPlaceholder() {
    const ph = window._dropPlaceholder;
    if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
    window._dropPlaceholder = null;
}

function _refreshAfterMove(card) {
    _applyHorizontalLayoutSync();
    _updateHorizontalLayout();

    setTimeout(() => {
        _applyHorizontalLayoutSync();

        if (typeof renderFriendsCalendar === 'function') renderFriendsCalendar();
        if (typeof renderTeachersCalendars === 'function') renderTeachersCalendars();

        // После перетаскивания одной из секций в объединённом режиме
        // подтягиваем вторую, чтобы они не разъехались по зонам.
        if (typeof _syncFriendsTeachersZone === 'function') {
            try { _syncFriendsTeachersZone(); } catch (e) {}
        }

        if (card.id === 'widgetMiniCalCard' && typeof refreshMiniCalEvents === 'function') {
            try { refreshMiniCalEvents(); } catch (e) { console.error(e); }
        }
        if (card.id === 'widgetGlobalCard' && typeof _renderGlobalStatsDetails === 'function') {
            try { _renderGlobalStatsDetails(); } catch (e) { console.error(e); }
        }
        if (card.id === 'widgetLabsCard' && typeof _renderLabStatsDetails === 'function') {
            try { _renderLabStatsDetails(); } catch (e) { console.error(e); }
        }
        if (typeof renderCharts === 'function') {
            try { renderCharts(); } catch (e) { console.error(e); }
        }

        if (typeof globalChart !== 'undefined' && globalChart) {
            try { globalChart.resize(); } catch (e) {}
        }
        if (typeof globalLabChart !== 'undefined' && globalLabChart) {
            try { globalLabChart.resize(); } catch (e) {}
        }
    }, 80);
}

function _saveLayout() {
    const layout = {};
    _widgetZoneIds.forEach(id => {
        const zone = document.getElementById(id);
        if (!zone) return;
        layout[id] = [...zone.querySelectorAll(_widgetZoneSelector())].map(c => c.id);
    });
    try { localStorage.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(layout)); } catch (e) {}
}

function _restoreLayout() {
    let layout;
    try {
        layout = JSON.parse(localStorage.getItem(WIDGET_LAYOUT_KEY) || 'null');
    } catch (e) { return; }
    if (!layout || typeof layout !== 'object') return;

    const allCards = {};
    document.querySelectorAll(_widgetZoneSelector()).forEach(c => { allCards[c.id] = c; });

    _widgetZoneIds.forEach(zoneId => {
        const zone = document.getElementById(zoneId);
        if (!zone) return;
        const ids = Array.isArray(layout[zoneId]) ? layout[zoneId] : [];
        ids.forEach(id => {
            const card = allCards[id];
            if (card) zone.appendChild(card);
        });
    });
}