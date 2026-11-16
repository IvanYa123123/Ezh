// Глобальное состояние приложения.
//
// v3.18.0:
//   • updateGroupDisplay() — синхронизирует текст в #groupDisplay
//     со значениями скрытых #groupSelect / #subgroupSelect.

let currentBaseDate = new Date();
currentBaseDate.setDate(currentBaseDate.getDate() - (currentBaseDate.getDay() === 0 ? 6 : currentBaseDate.getDay() - 1));

let cachedSchedule = [];
let cachedLabs = {};
let cachedSubjectSettings = {};
let globalChart = null;
let globalLabChart = null;
let globalLabChartPro = null;
let currentSubjectsList = [];

let validGroups = new Set();
let allGroups = [];
let groupsLoaded = false;

function _safeLocalStorageArray(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn(`[state] ignoring corrupted localStorage key ${key}`, e);
        return [];
    }
}

let friendsList = [];
let friendsSchedules = {};
let visibleFriends = new Set(_safeLocalStorageArray('visibleFriends'));
let draggingFriendId = null;
let editingFriendId = null;
let draggingDropdownFriendId = null;
let customCategories = _safeLocalStorageArray('customCategories');

let expandedDayDateStr = null;
let customScheduleItems = [];

let showTeacher  = localStorage.getItem('showTeacher')  !== 'false';
let showLocation = localStorage.getItem('showLocation') !== 'false';

let showStatus = localStorage.getItem('showStatus') !== 'false';
let statusFormat = localStorage.getItem('statusFormat') || 'interval';
let statusPrecision = localStorage.getItem('statusPrecision') || 'min';
let sharedPairFormat = localStorage.getItem('sharedPairFormat') || 'time';
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
let taskCountsByDate = {};
let taskSeverityByDate = {};

let loaderInterval = null;

let showSleepMode = localStorage.getItem('showSleepMode') !== 'false';

function saveVisibleFriends() {
    localStorage.setItem('visibleFriends', JSON.stringify([...visibleFriends]));
}

// Базовые виджеты
let showWidgetMiniCal = localStorage.getItem('showWidgetMiniCal') !== 'false';
let showWidgetGlobal  = localStorage.getItem('showWidgetGlobal')  !== 'false';
let showWidgetLabs    = localStorage.getItem('showWidgetLabs')    !== 'false';
let showWidgetSuggestions = localStorage.getItem('showWidgetSuggestions') !== 'false';
let showWidgetPacing  = localStorage.getItem('showWidgetPacing')  !== 'false';

// Виджеты Заметок (1, 2, 3)
let showWidgetNotes1 = localStorage.getItem('showWidgetNotes1') !== 'false';
let showWidgetNotes2 = localStorage.getItem('showWidgetNotes2') === 'true';
let showWidgetNotes3 = localStorage.getItem('showWidgetNotes3') === 'true';
let showWidgetNotes4 = localStorage.getItem('showWidgetNotes4') === 'true';
let showWidgetNotes5 = localStorage.getItem('showWidgetNotes5') === 'true';
let showWidgetNotes6 = localStorage.getItem('showWidgetNotes6') === 'true';
let showWidgetNotes7 = localStorage.getItem('showWidgetNotes7') === 'true';
let showWidgetNotes8 = localStorage.getItem('showWidgetNotes8') === 'true';
let showWidgetNotes9 = localStorage.getItem('showWidgetNotes9') === 'true';
let showWidgetNotes10 = localStorage.getItem('showWidgetNotes10') === 'true';

function getNoteWidgetVisibility(idx) {
    switch (Number(idx)) {
        case 1: return showWidgetNotes1;
        case 2: return showWidgetNotes2;
        case 3: return showWidgetNotes3;
        case 4: return showWidgetNotes4;
        case 5: return showWidgetNotes5;
        case 6: return showWidgetNotes6;
        case 7: return showWidgetNotes7;
        case 8: return showWidgetNotes8;
        case 9: return showWidgetNotes9;
        case 10: return showWidgetNotes10;
        default: return false;
    }
}

function setNoteWidgetVisibility(idx, value) {
    const v = !!value;
    switch (Number(idx)) {
        case 1: showWidgetNotes1 = v; break;
        case 2: showWidgetNotes2 = v; break;
        case 3: showWidgetNotes3 = v; break;
        case 4: showWidgetNotes4 = v; break;
        case 5: showWidgetNotes5 = v; break;
        case 6: showWidgetNotes6 = v; break;
        case 7: showWidgetNotes7 = v; break;
        case 8: showWidgetNotes8 = v; break;
        case 9: showWidgetNotes9 = v; break;
        case 10: showWidgetNotes10 = v; break;
        default: return;
    }
    try { localStorage.setItem(`showWidgetNotes${idx}`, v ? 'true' : 'false'); } catch (e) {}
}

// Pro виджеты (появляются только при активном Pro)
let showWidgetLabsPro    = localStorage.getItem('showWidgetLabsPro')    !== 'false';
let showWidgetMoodleAvg  = localStorage.getItem('showWidgetMoodleAvg')  !== 'false';
let showWidgetMoodleSubj = localStorage.getItem('showWidgetMoodleSubj') !== 'false';

let showFriendsSection  = localStorage.getItem('showFriendsSection')  !== 'false';
let showTeachersSection = localStorage.getItem('showTeachersSection') !== 'false';

let separateFriendsTeachers = localStorage.getItem('separateFriendsTeachers') === 'true';
let friendsTeachersTab = localStorage.getItem('friendsTeachersTab') || 'friends';

// ============================================================
//  ГРУППА В ШАПКЕ
// ============================================================
//  В шапке отображается #groupDisplay (текст). Реальные
//  значения для логики хранятся в скрытых #groupSelect и
//  #subgroupSelect. Эта функция синхронизирует отображение.
// ============================================================

function updateGroupDisplay() {
    const displayEl = document.getElementById('groupDisplay');
    const groupInput = document.getElementById('groupSelect');
    const subgroupInput = document.getElementById('subgroupSelect');
    if (!displayEl || !groupInput) return;

    const group = (groupInput.value || '').trim();
    const subgroup = subgroupInput ? subgroupInput.value : '0';

    if (!group) {
        displayEl.textContent = 'Группа не выбрана';
        displayEl.classList.add('group-display-empty');
        displayEl.title = 'Выберите группу — здесь или в настройках';
        return;
    }

    let text = group;
    if (subgroup === '1') text += ' · 1 подгр.';
    else if (subgroup === '2') text += ' · 2 подгр.';
    else text += ' · все';

    displayEl.textContent = text;
    displayEl.classList.remove('group-display-empty');
    displayEl.title = 'Изменить можно в настройках';
}

// ============================================================
//  ВИДИМОСТЬ ВИДЖЕТОВ И ПРО-РЕЖИМ
// ============================================================

function hideWidget(widgetId, toggleId) {
    const widget = document.getElementById(widgetId);
    if (widget) widget.style.display = 'none';

    if (toggleId === 'settingsToggleWidgetMiniCal') { showWidgetMiniCal = false; localStorage.setItem('showWidgetMiniCal', 'false'); }
    else if (toggleId === 'settingsToggleWidgetGlobal') { showWidgetGlobal = false; localStorage.setItem('showWidgetGlobal', 'false'); }
    else if (toggleId === 'settingsToggleWidgetLabs') { showWidgetLabs = false; localStorage.setItem('showWidgetLabs', 'false'); }
    else if (toggleId === 'settingsToggleWidgetSuggestions') { showWidgetSuggestions = false; localStorage.setItem('showWidgetSuggestions', 'false'); }
    else if (toggleId === 'settingsToggleWidgetPacing') { showWidgetPacing = false; localStorage.setItem('showWidgetPacing', 'false'); }
    else if (toggleId && toggleId.startsWith('settingsToggleWidgetNotes')) {
        const n = parseInt(toggleId.replace('settingsToggleWidgetNotes', ''), 10);
        if (n >= 1 && n <= 10) setNoteWidgetVisibility(n, false);
    }
    else if (toggleId === 'settingsToggleWidgetLabsPro') { showWidgetLabsPro = false; localStorage.setItem('showWidgetLabsPro', 'false'); }
    else if (toggleId === 'settingsToggleWidgetMoodleAvg') { showWidgetMoodleAvg = false; localStorage.setItem('showWidgetMoodleAvg', 'false'); }
    else if (toggleId === 'settingsToggleWidgetMoodleSubj') { showWidgetMoodleSubj = false; localStorage.setItem('showWidgetMoodleSubj', 'false'); }

    const checkbox = document.getElementById(toggleId);
    if (checkbox) checkbox.checked = false;

    if (typeof renderNotesToggleRow === 'function') renderNotesToggleRow();
}

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
        return;
    }

    const activeZone = activeEl.parentElement;
    if (!activeZone) return;
    if (inactiveEl.parentElement === activeZone) return;

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
//  ВИДЖЕТ «ЗАМЕТКИ» (до 10 штук, с форматированием)
// ============================================================

const NOTE_WIDGET_COUNT = 10;

function _noteEscapeText(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sanitizeNoteHtml(html) {
    const host = document.createElement('div');
    host.innerHTML = String(html || '');

    const allowedTags = new Set(['B', 'STRONG', 'BR', 'DIV', 'SPAN', 'P']);
    const allowedClass = /^(note-check|note-check-box|note-check-text|note-size-[sml]|done)$/;
    const dropTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);

    const clean = (parent) => {
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType === 3) continue;
            if (child.nodeType !== 1) {
                child.remove();
                continue;
            }
            const tag = child.tagName;
            if (dropTags.has(tag)) {
                child.remove();
                continue;
            }
            if (tag === 'FONT') {
                const size = child.getAttribute('size');
                const span = document.createElement('span');
                span.className = 'note-size-' + (
                    size === '1' || size === '2' ? 's'
                        : size === '5' || size === '6' || size === '7' ? 'l' : 'm');
                while (child.firstChild) span.appendChild(child.firstChild);
                child.replaceWith(span);
                clean(parent);
                continue;
            }
            if (!allowedTags.has(tag)) {
                const frag = document.createDocumentFragment();
                while (child.firstChild) frag.appendChild(child.firstChild);
                child.replaceWith(frag);
                clean(parent);
                continue;
            }
            for (const attr of Array.from(child.attributes)) {
                if (attr.name !== 'class' && attr.name !== 'contenteditable') {
                    child.removeAttribute(attr.name);
                }
            }
            if (child.classList.length) {
                const keep = Array.from(child.classList).filter(c => allowedClass.test(c));
                if (keep.length) child.className = keep.join(' ');
                else child.removeAttribute('class');
            }
            clean(child);
        }
    };

    clean(host);
    return host.innerHTML;
}

function _currentNoteBlock(ed) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.anchorNode;
    if (!node || !ed.contains(node)) return null;
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el.parentElement !== ed) el = el.parentElement;
    return el;
}

function _placeNoteCaret(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ed = el.closest('[contenteditable="true"]');
    if (ed) ed.focus();
}

function _makeNoteCheckItem() {
    const item = document.createElement('div');
    item.className = 'note-check';
    const box = document.createElement('span');
    box.className = 'note-check-box';
    box.setAttribute('contenteditable', 'false');
    box.textContent = '☐';
    const text = document.createElement('span');
    text.className = 'note-check-text';
    text.innerHTML = '<br>';
    item.appendChild(box);
    item.appendChild(text);
    return item;
}

function _saveNote(ed) {
    if (!ed || !ed.id) return;
    const idx = ed.id.replace('notesWidgetText', '');
    if (!idx) return;
    try {
        localStorage.setItem(`notesWidgetHtml${idx}`, sanitizeNoteHtml(ed.innerHTML));
        localStorage.setItem(`notesWidget${idx}`, ed.innerText || '');
    } catch (e) {
        console.warn('[notes] не удалось сохранить заметку', e);
    }
}

function _ensureNoteToolbar(ed) {
    if (ed.dataset.noteToolbar === '1') return;
    ed.dataset.noteToolbar = '1';

    const bar = document.createElement('div');
    bar.className = 'note-toolbar';
    bar.innerHTML = `
        <button type="button" class="note-tool-btn" data-note-act="bold" title="Жирный"><b>B</b></button>
        <span class="note-tool-sep"></span>
        <button type="button" class="note-tool-btn" data-note-act="check" title="Пункт с галочкой">☑</button>
    `;
    ed.parentNode.insertBefore(bar, ed);

    bar.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) e.preventDefault();
    });

    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-note-act]');
        if (!btn) return;
        const act = btn.dataset.noteAct;
        if (act === 'bold') {
            document.execCommand('styleWithCSS', false, false);
            document.execCommand('bold');
        } else if (act === 'check') {
            toggleNoteCheck(ed);
        }
        _saveNote(ed);
    });
}

function toggleNoteCheck(ed) {
    let block = _currentNoteBlock(ed);

    if (!block || block === ed) {
        block = document.createElement('div');
        if (ed.childNodes.length) {
            while (ed.firstChild) block.appendChild(ed.firstChild);
        } else {
            block.innerHTML = '<br>';
        }
        ed.appendChild(block);
    }

    if (block.classList.contains('note-check')) {
        const text = block.querySelector('.note-check-text');
        const div = document.createElement('div');
        div.innerHTML = text ? text.innerHTML : '<br>';
        block.replaceWith(div);
        _placeNoteCaret(div);
    } else {
        const text = document.createElement('span');
        text.className = 'note-check-text';
        while (block.firstChild) text.appendChild(block.firstChild);
        if (!text.innerHTML.trim()) text.innerHTML = '<br>';

        const item = document.createElement('div');
        item.className = 'note-check';
        const box = document.createElement('span');
        box.className = 'note-check-box';
        box.setAttribute('contenteditable', 'false');
        box.textContent = '☐';
        item.appendChild(box);
        item.appendChild(text);
        block.replaceWith(item);
        _placeNoteCaret(text);
    }
    _saveNote(ed);
}

function _bindNoteEditor(ed) {
    ed.addEventListener('input', () => {
        clearTimeout(ed._noteSaveTimer);
        ed._noteSaveTimer = setTimeout(() => _saveNote(ed), 250);
    });
    ed.addEventListener('blur', () => _saveNote(ed));

    ed.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    });

    ed.addEventListener('click', (e) => {
        const box = e.target.closest('.note-check-box');
        if (!box) return;
        const item = box.closest('.note-check');
        if (!item) return;
        const done = item.classList.toggle('done');
        box.textContent = done ? '☑' : '☐';
        _saveNote(ed);
    });

    ed.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;

        // e.target здесь — сам contenteditable-редактор, поэтому пункт
        // определяем по текущему блоку выделения, а не по e.target.
        const block = _currentNoteBlock(ed);
        const item = (block && block.classList && block.classList.contains('note-check'))
            ? block : null;
        if (!item) return;
        e.preventDefault();

        const text = item.querySelector('.note-check-text');
        if (text && !(text.innerText || '').trim()) {
            const div = document.createElement('div');
            div.innerHTML = '<br>';
            item.replaceWith(div);
            _placeNoteCaret(div);
            _saveNote(ed);
            return;
        }

        const next = _makeNoteCheckItem();
        const nextText = next.querySelector('.note-check-text');

        // Если курсор стоит в середине пункта — переносим «хвост» в новый пункт.
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount && text && text.contains(sel.anchorNode)) {
                const caret = sel.getRangeAt(0);
                const tail = document.createRange();
                tail.selectNodeContents(text);
                tail.setStart(caret.endContainer, caret.endOffset);
                const frag = tail.extractContents();
                const holder = document.createElement('div');
                holder.appendChild(frag);
                if (holder.innerHTML.trim()) nextText.innerHTML = holder.innerHTML;
            }
        } catch (err) {}

        item.after(next);
        _placeNoteCaret(nextText);
        _saveNote(ed);
    });
}

function initNotesWidget() {
    for (let i = 1; i <= NOTE_WIDGET_COUNT; i++) {
        const ed = document.getElementById(`notesWidgetText${i}`);
        if (!ed) continue;

        _ensureNoteToolbar(ed);

        if (ed.dataset.noteReady !== '1') {
            ed.dataset.noteReady = '1';

            let html = '';
            try {
                html = localStorage.getItem(`notesWidgetHtml${i}`) || '';
            } catch (e) {}

            if (!html) {
                try {
                    const legacy = localStorage.getItem(`notesWidget${i}`) || '';
                    if (legacy) html = _noteEscapeText(legacy).replace(/\n/g, '<br>');
                } catch (e) {}
            }

            ed.innerHTML = sanitizeNoteHtml(html);
            _bindNoteEditor(ed);
        }
    }
}

function onNotesWidgetInput(el) {
    _saveNote(el);
}

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
            console.warn('[drag] не удалось загрузить hedgehog:', e);
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
        if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) {
            try { globalLabChartPro.resize(); } catch (e) {}
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

        if (typeof _syncFriendsTeachersZone === 'function') {
            try { _syncFriendsTeachersZone(); } catch (e) {}
        }

        if (card.id === 'widgetMiniCalCard' && typeof refreshMiniCalEvents === 'function') {
            try { refreshMiniCalEvents(); } catch (e) { console.error(e); }
        }
        if (card.id === 'widgetGlobalCard' && typeof _renderGlobalStatsDetails === 'function') {
            try { _renderGlobalStatsDetails(); } catch (e) { console.error(e); }
        }
        if (card.id === 'widgetLabsProCard' && typeof renderProLabDetails === 'function') {
            try { renderProLabDetails(); } catch (e) { console.error(e); }
        }

        if (card.id === 'widgetSuggestionsCard' && typeof renderSuggestionsHtml === 'function' && _suggestionsCache) {
            try { renderSuggestionsHtml(_suggestionsCache); } catch (e) { console.error(e); }
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
        if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) {
            try { globalLabChartPro.resize(); } catch (e) {}
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

    let dropped = false;
    const cleanedLayout = {};

    _widgetZoneIds.forEach(zoneId => {
        const zone = document.getElementById(zoneId);
        const ids = Array.isArray(layout[zoneId]) ? layout[zoneId] : [];
        const keptIds = [];

        ids.forEach(id => {
            const card = allCards[id];
            if (card) {
                if (zone) zone.appendChild(card);
                keptIds.push(id);
            } else {
                dropped = true;
            }
        });

        cleanedLayout[zoneId] = keptIds;
    });

    if (dropped) {
        try {
            localStorage.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(cleanedLayout));
        } catch (e) {}
    }
}