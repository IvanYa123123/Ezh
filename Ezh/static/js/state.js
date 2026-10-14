// Глобальное состояние приложения.

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
    console.warn('[state] moveNotesWidget() устарела — используйте drag-n-drop');
}

function restoreNotesWidgetZone() {
    // Заглушка — положение восстанавливает _restoreLayout().
}

// ============================================================
//  МИНИ-КАЛЕНДАРЬ: ПАНЕЛЬ СОБЫТИЙ
// ------------------------------------------------------------
//  v3.6.8:
//    • Токен _miniCalEventsToken — защита от гонки. Если
//      _renderMiniCalEventsNow запущен несколько раз подряд,
//      старые ответы игнорируются.
//    • Обе коллекции (задачи и события) синхронизируются с
//      БД и локальным состоянием.
// ============================================================

let _miniCalEventsTimer = null;
let _miniCalEventsToken = 0;

function refreshMiniCalEvents() {
    if (_miniCalEventsTimer) clearTimeout(_miniCalEventsTimer);
    _miniCalEventsTimer = setTimeout(_renderMiniCalEventsNow, 120);
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

    // --- 1) Кастомные события ---
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

    // --- 2) Задачи (незавершённые) ---
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

    // Проверка токена: если за время await кто-то запустил ещё раз — выходим
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
//  DRAG & DROP ВИДЖЕТОВ И РАЗДЕЛОВ
// ============================================================

const _widgetZoneIds = [
    'rightWidgetsZone',
    'underCalendarWidgetsZone',
    'mainColumnSections',
];

const WIDGET_LAYOUT_KEY = 'widgetLayout';

function initWidgetDragAndDrop() {
    document.querySelectorAll('.widget-drag-handle, .section-drag-handle')
        .forEach(h => h.setAttribute('draggable', 'true'));

    _restoreLayout();
    _widgetZoneIds.forEach(id => _initSortableZone(id));
    _initSidebarColumnForwarder();
    _updateHorizontalLayout();
}

function _widgetZoneSelector() {
    return '.widget-card, [data-draggable-section]';
}

function _updateHorizontalLayout() {
    document.querySelectorAll('.widget-card').forEach(card => {
        const parent = card.parentElement;
        const isHorizontal = !!(parent && parent.id !== 'rightWidgetsZone');
        card.classList.toggle('is-horizontal', isHorizontal);
    });

    if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
}

function _initSidebarColumnForwarder() {
    const col = document.querySelector('.sidebar-column');
    if (!col) return;
    if (col.dataset.dropForward === '1') return;
    col.dataset.dropForward = '1';

    const zone = document.getElementById('rightWidgetsZone');
    if (!zone) return;

    col.addEventListener('dragover', (e) => {
        if (!window._draggingWidgetId) return;
        if (zone.contains(e.target)) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const dragged = document.getElementById(window._draggingWidgetId);
        if (!dragged) return;

        _showDropPlaceholderAtEnd(zone, dragged);
    });

    col.addEventListener('drop', (e) => {
        if (!window._draggingWidgetId) return;
        if (zone.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        const dragged = document.getElementById(window._draggingWidgetId);
        if (!dragged) { _removeDropPlaceholder(); return; }

        const ph = window._dropPlaceholder;
        if (ph && ph.parentElement === zone) {
            ph.parentElement.insertBefore(dragged, ph);
        } else {
            zone.appendChild(dragged);
        }

        _removeDropPlaceholder();
        _saveLayout();
        _refreshAfterMove(dragged);
    });
}

function _initSortableZone(zoneId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    if (zone.dataset.dragInit === '1') return;
    zone.dataset.dragInit = '1';

    zone.addEventListener('dragstart', (e) => {
        const handle = e.target.closest('.widget-drag-handle, .section-drag-handle');
        if (!handle || !zone.contains(handle)) return;

        const card = handle.closest(_widgetZoneSelector());
        if (!card || !zone.contains(card)) return;

        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', card.id); } catch (err) {}

        card.classList.add('widget-dragging');
        document.body.classList.add('widget-dragging');
        window._draggingWidgetId = card.id;
    });

    zone.addEventListener('dragend', (e) => {
        const card = e.target.closest && e.target.closest(_widgetZoneSelector());
        if (card) card.classList.remove('widget-dragging');

        document.body.classList.remove('widget-dragging');
        document.querySelectorAll(_widgetZoneSelector())
            .forEach(c => c.classList.remove('widget-drop-target'));

        _removeDropPlaceholder();
        window._draggingWidgetId = null;
    });

    zone.addEventListener('dragover', (e) => {
        if (!window._draggingWidgetId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const dragged = document.getElementById(window._draggingWidgetId);
        if (!dragged) return;

        if (e.target.closest && e.target.closest('.widget-drop-placeholder')) return;

        let targetCard = e.target.closest(_widgetZoneSelector());
        if (targetCard === dragged) targetCard = null;

        if (targetCard) {
            _positionPlaceholderByCard(zone, targetCard, e);
            return;
        }

        _positionPlaceholderByNearest(zone, dragged, e);
    });

    zone.addEventListener('drop', (e) => {
        if (!window._draggingWidgetId) return;
        e.preventDefault();
        e.stopPropagation();

        const dragged = document.getElementById(window._draggingWidgetId);
        if (!dragged) { _removeDropPlaceholder(); return; }

        const ph = window._dropPlaceholder;
        if (ph && ph.parentElement) {
            ph.parentElement.insertBefore(dragged, ph);
        } else if (dragged.parentElement !== zone) {
            zone.appendChild(dragged);
        } else {
            _removeDropPlaceholder();
            return;
        }

        _removeDropPlaceholder();
        _saveLayout();
        _refreshAfterMove(dragged);
    });
}

function _positionPlaceholderByCard(zone, targetCard, e) {
    const rect = targetCard.getBoundingClientRect();
    const zoneStyle = getComputedStyle(zone);
    let before;

    if (zoneStyle.display === 'flex' && zoneStyle.flexWrap === 'wrap') {
        const inSameRow = e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4;
        before = inSameRow
            ? (e.clientX < rect.left + rect.width / 2)
            : (e.clientY < rect.top + rect.height / 2);
    } else {
        before = e.clientY < rect.top + rect.height / 2;
    }

    _showDropPlaceholder(targetCard, before);
}

function _positionPlaceholderByNearest(zone, dragged, e) {
    const cards = [...zone.querySelectorAll(_widgetZoneSelector())]
        .filter(c => c !== dragged && c !== window._dropPlaceholder);

    if (cards.length === 0) {
        _showDropPlaceholderAtEnd(zone, dragged);
        return;
    }

    const zoneStyle = getComputedStyle(zone);
    const isHorizontalWrap = zoneStyle.display === 'flex' && zoneStyle.flexWrap === 'wrap';

    if (isHorizontalWrap) {
        _showDropPlaceholderAtEnd(zone, dragged);
        return;
    }

    let closest = null;
    let minDist = Infinity;
    for (const c of cards) {
        const r = c.getBoundingClientRect();
        const midY = r.top + r.height / 2;
        const dist = Math.abs(e.clientY - midY);
        if (dist < minDist) {
            minDist = dist;
            closest = c;
        }
    }

    if (!closest) {
        _showDropPlaceholderAtEnd(zone, dragged);
        return;
    }

    const r = closest.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    _showDropPlaceholder(closest, before);
}

function _showDropPlaceholder(targetCard, before) {
    const current = window._dropPlaceholder;

    if (current
        && current.dataset.forId === targetCard.id
        && current.dataset.before === String(before)
        && current.parentElement === targetCard.parentElement) {
        return;
    }

    _removeDropPlaceholder();

    const dragged = window._draggingWidgetId
        ? document.getElementById(window._draggingWidgetId)
        : null;
    const source = dragged || targetCard;
    const w = source.offsetWidth;
    const h = source.offsetHeight;

    const ph = document.createElement('div');
    ph.className = 'widget-drop-placeholder';
    ph.dataset.forId = targetCard.id;
    ph.dataset.before = String(before);
    if (w) ph.style.width = w + 'px';
    if (h) ph.style.height = h + 'px';
    ph.style.flex = '0 0 auto';

    const parent = targetCard.parentElement;
    if (!parent) return;

    if (before) {
        parent.insertBefore(ph, targetCard);
    } else {
        parent.insertBefore(ph, targetCard.nextSibling);
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

    const w = dragged.offsetWidth;
    const h = dragged.offsetHeight;

    const ph = document.createElement('div');
    ph.className = 'widget-drop-placeholder';
    ph.dataset.atEnd = '1';
    if (w) ph.style.width = w + 'px';
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
    _updateHorizontalLayout();

    setTimeout(() => {
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
    }, 60);
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