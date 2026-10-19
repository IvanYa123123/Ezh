// Поштучный список лаб/ПЗ по предмету: открыть модалку, отметить,
// переименовать, добавить, удалить последнюю.
//
// Использует cachedLabs (сводка) и cachedSchedule (для дат пар),
// поэтому должен грузиться после widgets.js и calendar.js.
// API-обёртки (api*LabItem) — из api.js.

let _labItemsCurrentSubject = null;
let _labItemsCurrentGroup = null;
let _labItemsCache = {};

// ============================================================
//  ДАТЫ ПАР ПО ПРЕДМЕТУ
// ============================================================

function _datesForSubject(subject) {
    const dates = [];
    cachedSchedule.forEach(item => {
        const key = `${item.lesson} (${item.type_name})`;
        if (key === subject && item.date) dates.push(item.date);
    });
    dates.sort();
    return dates;
}

// Примерная дата сдачи k-й лабы: k-я по счёту пара из списка.
// Если пар больше, чем лаб — берём ближайшую подходящую.
function _computeDueDate(dates, k, total) {
    if (!dates.length || total <= 0) return null;
    const M = dates.length;
    let idx = Math.ceil(k * M / total) - 1;
    if (idx < 0) idx = 0;
    if (idx >= M) idx = M - 1;
    return dates[idx];
}

// ============================================================
//  ОТКРЫТИЕ МОДАЛКИ
// ============================================================

async function openLabItemsModal(subjectKey) {
    const group = (document.getElementById('groupSelect').value || '').trim();
    if (!group) return;
    if (!cachedLabs[subjectKey] || cachedLabs[subjectKey].total === 0) {
        alert('У этого предмета нет лаб в расписании.');
        return;
    }

    _labItemsCurrentSubject = subjectKey;
    _labItemsCurrentGroup = group;

    const modalEl = document.getElementById('labItemsModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

    document.getElementById('labItemsModalTitle').textContent = getDisplaySubjectKey(subjectKey);
    document.getElementById('labItemsContent').innerHTML =
        '<div class="text-center text-muted small py-4">Загрузка…</div>';
    modal.show();

    await _reloadLabItems();
}

async function _reloadLabItems() {
    if (!_labItemsCurrentSubject || !_labItemsCurrentGroup) return;

    const subjectKey = _labItemsCurrentSubject;
    const group = _labItemsCurrentGroup;

    // Досоздаём недостающие записи: sync только в плюс, лишние не удаляет.
    const totalCount = (cachedLabs[subjectKey] && cachedLabs[subjectKey].total) || 0;
    if (totalCount > 0) {
        try {
            await apiSyncLabItems(group, [{ subject: subjectKey, count: totalCount }]);
        } catch (e) {
            console.error('[lab_items] sync failed', e);
        }
    }

    let grouped = {};
    try { grouped = await apiLoadLabItems(group); }
    catch (e) { grouped = {}; }

    const items = Array.isArray(grouped[subjectKey]) ? grouped[subjectKey] : [];

    const dates = _datesForSubject(subjectKey);
    const enriched = items.map(it => ({
        ...it,
        due_date: _computeDueDate(dates, it.idx, items.length || totalCount),
    }));

    _labItemsCache[subjectKey] = enriched;
    renderLabItemsList();
}

// ============================================================
//  РЕНДЕР СПИСКА
// ============================================================

function renderLabItemsList() {
    const container = document.getElementById('labItemsContent');
    if (!container) return;

    const subjectKey = _labItemsCurrentSubject;
    if (!subjectKey) return;

    const items = _labItemsCache[subjectKey] || [];
    const todayStr = getLocalDateStr(new Date());

    let html = `
        <div class="lab-items-toolbar">
            <div class="small text-muted">
                Всего: <b>${items.length}</b> · Сдано: <b>${items.filter(x => x.completed).length}</b>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold"
                        onclick="onAddLabItem()" title="Добавить ещё одну лабу/ПЗ">+ Добавить</button>
                <button type="button" class="btn btn-sm btn-outline-danger fw-bold"
                        onclick="onRemoveLastLabItem()"
                        ${items.length === 0 ? 'disabled' : ''}
                        title="Удалить последнюю запись">🗑 Удалить последнюю</button>
            </div>
        </div>
    `;

    if (items.length === 0) {
        html += "<div class='text-center text-muted small py-4'>Записей нет. Нажмите «+ Добавить».</div>";
        container.innerHTML = html;
        return;
    }

    html += '<div class="lab-items-list">';

    items.forEach(it => {
        const overdue = !it.completed && it.due_date && it.due_date < todayStr;
        const dueLabel = it.due_date ? formatDateRu(it.due_date) : '—';
        const dueYear  = it.due_date ? it.due_date.slice(0, 4) : '';

        let rowCls = 'lab-item-row';
        if (it.completed) rowCls += ' lab-item-done';
        else if (overdue) rowCls += ' lab-item-overdue';

        html += `
            <div class="${rowCls}" data-id="${it.id}">
                <input type="checkbox" class="lab-item-check"
                       ${it.completed ? 'checked' : ''}
                       onchange="onLabItemToggle(${it.id}, this.checked)">
                <span class="lab-item-title"
                      onclick="onLabItemRename(${it.id}, this)"
                      title="Клик — переименовать">${escapeHtml(it.title)}</span>
                <span class="lab-item-due ${overdue ? 'is-overdue' : ''}"
                      title="${it.due_date ? 'Примерная дата сдачи' : 'Нет даты'}">
                    ${dueLabel}${dueYear ? ' ' + dueYear : ''}
                </span>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

// ============================================================
//  ОБРАБОТЧИКИ
// ============================================================

async function onLabItemToggle(id, isCompleted) {
    try {
        await apiUpdateLabItem(id, { completed: isCompleted ? 1 : 0 });
    } catch (e) {
        console.error('[lab_items] update failed', e);
        alert('Не удалось сохранить');
        return;
    }
    const subjectKey = _labItemsCurrentSubject;
    if (subjectKey && _labItemsCache[subjectKey]) {
        const it = _labItemsCache[subjectKey].find(x => x.id === id);
        if (it) it.completed = isCompleted ? 1 : 0;
    }
    renderLabItemsList();
    await updateLabsCache();
    renderCharts();
}

async function onLabItemRename(id, el) {
    const subjectKey = _labItemsCurrentSubject;
    if (!subjectKey) return;
    const it = (_labItemsCache[subjectKey] || []).find(x => x.id === id);
    if (!it) return;

    const newTitle = prompt('Новое название:', it.title);
    if (newTitle === null) return;
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === it.title) return;

    try {
        await apiUpdateLabItem(id, { title: trimmed });
    } catch (e) {
        console.error('[lab_items] rename failed', e);
        alert('Не удалось переименовать');
        return;
    }
    it.title = trimmed;
    renderLabItemsList();
}

async function onAddLabItem() {
    if (!_labItemsCurrentSubject || !_labItemsCurrentGroup) return;
    try {
        await apiAddLabItem(_labItemsCurrentGroup, _labItemsCurrentSubject);
    } catch (e) {
        console.error('[lab_items] add failed', e);
        alert('Не удалось добавить');
        return;
    }
    await updateLabsCache();
    await _reloadLabItems();
    renderCharts();
}

async function onRemoveLastLabItem() {
    if (!_labItemsCurrentSubject || !_labItemsCurrentGroup) return;
    const items = _labItemsCache[_labItemsCurrentSubject] || [];
    if (items.length === 0) return;

    const last = items[items.length - 1];
    if (!confirm(`Удалить последнюю запись — «${last.title}»?`)) return;

    try {
        await apiRemoveLastLabItem(_labItemsCurrentGroup, _labItemsCurrentSubject);
    } catch (e) {
        console.error('[lab_items] remove_last failed', e);
        alert('Не удалось удалить');
        return;
    }
    await updateLabsCache();
    await _reloadLabItems();
    renderCharts();
}