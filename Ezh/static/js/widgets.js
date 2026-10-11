// Виджеты: графики Chart.js, управление лабами, модалка статистики.

async function updateLabsCache() {
    const group = document.getElementById("groupSelect").value.trim();
    if (!group) return;
    try { cachedLabs = await apiLoadLabs(group); }
    catch (e) { cachedLabs = {}; }
}

function showStats() {
    const group = document.getElementById("groupSelect").value.trim();
    if (!group || cachedSchedule.length === 0) return alert("Сначала загрузите расписание!");

    new bootstrap.Modal(document.getElementById('statsModal')).show();
    let stats = {};
    let todayStr = getLocalDateStr(new Date());

    cachedSchedule.forEach(item => {
        let subject = item.lesson;
        let type = item.type_name;
        if (!stats[subject]) stats[subject] = { display: subject, types: {} };
        if (!stats[subject].types[type]) stats[subject].types[type] = { past: 0, future: 0 };
        (item.date < todayStr ? stats[subject].types[type].past++ : stats[subject].types[type].future++);
    });

    let html = '<div class="row">';
    for (let subject in stats) {
        html += `<div class="col-md-6 mb-3"><div class="card h-100 border-0 shadow-sm"><div class="card-header bg-light fw-bold" style="font-size:0.9em" title="${escapeHtml(subject)}">${escapeHtml(stats[subject].display)}</div><div class="card-body py-2"><div class="row">`;
        for (let type in stats[subject].types) {
            let past = stats[subject].types[type].past;
            let future = stats[subject].types[type].future;
            html += `<div class="col-6 mb-2"><div class="border rounded p-2 text-center bg-white shadow-sm"><small class="text-muted d-block border-bottom mb-1" style="font-size:0.75em">${type}</small><span class="text-danger fw-bold" title="Прошло">✔ ${past}</span> | <span class="text-success fw-bold" title="Осталось">⏳ ${future}</span></div></div>`;
        }
        html += `</div></div></div></div>`;
    }
    html += '</div>';
    if (Object.keys(stats).length === 0) html = "<p class='text-center'>Нет данных для выбранной группы.</p>";
    document.getElementById('statsContent').innerHTML = html;
}

function showLabs() {
    const group = document.getElementById("groupSelect").value.trim();
    if (!group || cachedSchedule.length === 0) return alert("Сначала загрузите расписание!");
    renderLabsContent();
    new bootstrap.Modal(document.getElementById('labsModal')).show();
}

function renderLabsContent() {
    let labItems = cachedSchedule.filter(item => item.type_name === 'ЛЗ' || item.type_name === 'ПЗ');
    let uniqueSubjects = [...new Set(labItems.map(item => `${item.lesson} (${item.type_name})`))].sort();
    currentSubjectsList = uniqueSubjects;

    let html = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="text-muted small">Внесите изменения и нажмите "Сохранить все"</span>
            <button class="btn btn-sm btn-primary px-4 shadow-sm" onclick="saveAllLabs()">Сохранить все</button>
        </div>
        <div class="list-group mb-3">
    `;

    uniqueSubjects.forEach((subjKey, idx) => {
        let comp = cachedLabs[subjKey] ? cachedLabs[subjKey].completed : 0;
        let tot = cachedLabs[subjKey] ? cachedLabs[subjKey].total : 0;
        let percent = tot > 0 ? Math.round((comp / tot) * 100) : 0;
        let displaySubj = getDisplaySubjectKey(subjKey);
        html += `
            <div class="list-group-item border-0 shadow-sm mb-2 rounded">
                <h6 class="mb-2 fw-bold" style="font-size:0.9em" title="${escapeHtml(subjKey)}">${escapeHtml(displaySubj)}</h6>
                <div class="d-flex align-items-center gap-2 mb-2">
                    <span style="font-size: 0.85em;">Сдано:</span>
                    <input type="number" id="lab-comp-${idx}" class="form-control form-control-sm" style="width: 70px" value="${comp}" min="0">
                    <span style="font-size: 0.85em;">из</span>
                    <input type="number" id="lab-tot-${idx}" class="form-control form-control-sm" style="width: 70px" value="${tot}" min="0">
                </div>
                <div class="progress" style="height: 10px;">
                    <div class="progress-bar ${percent === 100 ? 'bg-success' : 'bg-info'}" role="progressbar" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    });
    html += `</div><div class="d-flex justify-content-end mb-2"><button class="btn btn-sm btn-primary px-4 shadow-sm" onclick="saveAllLabs()">Сохранить все</button></div>`;

    if (uniqueSubjects.length === 0) html = "<p class='text-center'>Нет данных.</p>";
    document.getElementById('labsContent').innerHTML = html;
}

async function saveAllLabs() {
    const group = document.getElementById("groupSelect").value.trim();
    let payload = [];
    currentSubjectsList.forEach((subject, idx) => {
        let comp = parseInt(document.getElementById(`lab-comp-${idx}`).value) || 0;
        let tot = parseInt(document.getElementById(`lab-tot-${idx}`).value) || 0;
        if (comp > tot) comp = tot;
        payload.push({ group, subject, completed: comp, total: tot });
    });
    try { await apiSaveLabs(payload); } catch (e) { return alert("Не удалось сохранить лабы"); }
    await updateLabsCache();
    renderCharts();
    let modal = bootstrap.Modal.getInstance(document.getElementById('labsModal'));
    if (modal) modal.hide();
}

// ============================================================
//  ГРАФИКИ
// ============================================================
// Все цвета читаются через getThemeColor() (см. utils.js) — он берёт
// значения из CSS-переменных текущей темы.
//
// ВАЖНО (фикс «растянутой/пропадающей диаграммы»):
//   • options.responsive: true + maintainAspectRatio: false —
//     Chart.js сам следит за размером контейнера через ResizeObserver.
//   • Перед new Chart() ЯВНО выставляем canvas.width/height по
//     родителю. Без этого Chart.js создаёт canvas с дефолтными
//     300×150 и «расплющивает» его на всю ширину карточки.

function _setCanvasInitialSize(canvasEl) {
    if (!canvasEl) return;
    const parent = canvasEl.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w > 0 && h > 0) {
        canvasEl.width  = w;
        canvasEl.height = h;
        canvasEl.style.width  = w + 'px';
        canvasEl.style.height = h + 'px';
    }
}

function renderCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js не загружен — графики пропущены.");
        return;
    }

    const cPassed     = getThemeColor('--chart-passed',       '#6366f1');
    const cRemaining  = getThemeColor('--chart-remaining',    '#cbd5e1');
    const cLabDone    = getThemeColor('--chart-lab-done',     '#14b8a6');
    const cLabLeft    = getThemeColor('--chart-lab-left',     '#f59e0b');
    const cText       = getThemeColor('--text-secondary',     '#64748b');
    const cTooltipBg  = getThemeColor('--chart-tooltip-bg',   'rgba(15, 23, 42, 0.92)');
    const cTooltipTx  = getThemeColor('--chart-tooltip-text', '#f8fafc');
    const cBorder     = getThemeColor('--border-color',       '#e2e8f0');

    const tooltipOpts = {
        backgroundColor: cTooltipBg,
        titleColor:      cTooltipTx,
        bodyColor:       cTooltipTx,
        borderColor:     cBorder,
        borderWidth:     1,
        padding:         8,
        cornerRadius:    6,
        displayColors:   false,
    };

    // --- Общий график «прошло / осталось» ---
    let passed = 0, remaining = 0;
    let todayStr = getLocalDateStr(new Date());
    cachedSchedule.forEach(item => { item.date < todayStr ? passed++ : remaining++; });

    const canvas1 = document.getElementById('globalStatsChart');
    if (!canvas1) return;

    if (globalChart) {
        globalChart.data.datasets[0].data = [passed, remaining];
        globalChart.data.datasets[0].backgroundColor = [cPassed, cRemaining];
        globalChart.options.plugins.legend.labels.color = cText;
        globalChart.options.plugins.tooltip = Object.assign(
            {}, globalChart.options.plugins.tooltip, tooltipOpts
        );
        globalChart.update('none');
    } else {
        _setCanvasInitialSize(canvas1);
        globalChart = new Chart(canvas1.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Прошло', 'Осталось'],
                datasets: [{ data: [passed, remaining], backgroundColor: [cPassed, cRemaining], borderWidth: 0 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                plugins: {
                    legend: { position: 'bottom', labels: { color: cText } },
                    tooltip: tooltipOpts,
                }
            }
        });
    }

    // --- График лабораторных ---
    let labItems = cachedSchedule.filter(item => item.type_name === 'ЛЗ' || item.type_name === 'ПЗ');
    let validSubjects = new Set(labItems.map(item => `${item.lesson} (${item.type_name})`));
    let totLabs = 0, compLabs = 0;
    for (let subj in cachedLabs) {
        if (!validSubjects.has(subj)) continue;
        totLabs += cachedLabs[subj].total;
        compLabs += cachedLabs[subj].completed;
    }
    let uncompLabs = Math.max(0, totLabs - compLabs);
    let labData = totLabs === 0 ? [0, 1] : [compLabs, uncompLabs];
    let labColors = totLabs === 0 ? [cRemaining, cRemaining] : [cLabDone, cLabLeft];
    let labLabels = totLabs === 0 ? ['Нет данных', ''] : ['Сдано', 'Осталось'];

    const canvas2 = document.getElementById('labStatsChart');
    if (!canvas2) return;

    if (globalLabChart) {
        globalLabChart.data.datasets[0].data = labData;
        globalLabChart.data.datasets[0].backgroundColor = labColors;
        globalLabChart.data.labels = labLabels;
        globalLabChart.options.plugins.legend.labels.color = cText;
        globalLabChart.options.plugins.tooltip = Object.assign(
            {}, globalLabChart.options.plugins.tooltip, tooltipOpts
        );
        globalLabChart.update('none');
    } else {
        _setCanvasInitialSize(canvas2);
        globalLabChart = new Chart(canvas2.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: labLabels,
                datasets: [{ data: labData, backgroundColor: labColors, borderWidth: 0 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                plugins: {
                    legend: { position: 'bottom', labels: { color: cText } },
                    tooltip: tooltipOpts,
                }
            }
        });
    }

    renderLabPacing();
}

// Пересоздаёт чарты с актуальной палитрой темы.
function refreshChartsTheme() {
    if (typeof globalChart !== 'undefined' && globalChart) {
        try { globalChart.destroy(); } catch (e) {}
        globalChart = null;
    }
    if (typeof globalLabChart !== 'undefined' && globalLabChart) {
        try { globalLabChart.destroy(); } catch (e) {}
        globalLabChart = null;
    }
    if (typeof cachedSchedule !== 'undefined'
        && Array.isArray(cachedSchedule)
        && cachedSchedule.length > 0) {
        try { renderCharts(); }
        catch (e) { console.error('[theme] renderCharts failed', e); }
    }
}

// ============================================================
//  ТЕМП СДАЧИ ЛАБ
// ============================================================

function renderLabPacing() {
    const container = document.getElementById('labPacingContent');
    if (!cachedLabs || Object.keys(cachedLabs).length === 0) {
        container.innerHTML = "<div class='text-center text-muted small mt-2'>Нет данных</div>";
        return;
    }

    let todayStr = getLocalDateStr(new Date());
    let scheduleStats = {};
    cachedSchedule.forEach(item => {
        if (item.type_name === 'ЛЗ' || item.type_name === 'ПЗ') {
            let subjKey = `${item.lesson} (${item.type_name})`;
            if (!scheduleStats[subjKey]) scheduleStats[subjKey] = { passed: 0, total: 0 };
            scheduleStats[subjKey].total++;
            if (item.date < todayStr) scheduleStats[subjKey].passed++;
        }
    });

    let validSubjects = new Set(Object.keys(scheduleStats));
    let html = '<div class="list-group list-group-flush">';
    let hasData = false;

    for (let subj in cachedLabs) {
        if (!validSubjects.has(subj)) continue;
        let data = cachedLabs[subj];
        if (data.total === 0) continue;
        hasData = true;
        let stats = scheduleStats[subj];

        // ============================================================
        //  Расчёт плана «сколько лаб должно быть сдано к сегодня».
        // ------------------------------------------------------------
        //  Идея: к сегодняшнему дню прошло `stats.passed` пар из
        //  `stats.total` всего. Значит, освоено `passed/total` семестра.
        //  Ожидаемое число сданных лаб = floor(N * passed / total),
        //  где N = data.total (всего лаб по плану).
        //
        //  Округление вниз (Math.floor) — иначе план обгоняет реальность.
        //
        //  Частные случаи:
        //    • прошла последняя пара → план = все лабы (data.total)
        //    • ни одна пара ещё не прошла → план = 0
        // ============================================================
        let expectedCount = 0;
        if (stats.total > 0) {
            if (stats.passed >= stats.total) {
                expectedCount = data.total;
            } else {
                expectedCount = Math.floor(data.total * stats.passed / stats.total);
            }
        }
        if (expectedCount > data.total) expectedCount = data.total;
        if (expectedCount < 0) expectedCount = 0;

        let actualCount = data.completed;
        let statusClass = actualCount >= expectedCount ? 'text-success' : 'text-danger';
        let icon = actualCount >= expectedCount ? '✅' : '⚠️';
        let displaySubj = getDisplaySubjectKey(subj);

        // Делаем всю строку кликабельной: клик по предмету → окно предмета.
        html += `<div class="d-flex justify-content-between align-items-center mb-2 border-bottom pb-1 lab-pacing-row" style="cursor:pointer;" title="Открыть список лаб" onclick="openLabItemsModal('${escapeJsString(subj)}')"><span class="text-truncate me-2" style="max-width: 65%; font-size: 0.8em;">${escapeHtml(displaySubj)}</span><span class="fw-bold ${statusClass}" style="font-size: 0.8em; white-space: nowrap;">${actualCount} / ${expectedCount} ${icon}</span></div>`;
    }
    html += '</div>';

    container.innerHTML = hasData ? html : "<div class='text-center text-muted small mt-2'>Нет данных</div>";
}

// ============================================================
//  ОКНО ПРЕДМЕТА: СПИСОК ЛАБ/ПЗ
// ------------------------------------------------------------
//  Логика:
//   1) Считаем, сколько у предмета пар ЛЗ/ПЗ в семестре (по
//      cachedSchedule) — это и есть "total" лаб.
//   2) Синкаем lab_items на сервере (создаём недостающие до total).
//      Sync работает только «в плюс» — ручные добавления не затираются.
//   3) Для каждой лабы k (1..N) считаем примерную дату сдачи:
//      берём список дат пар ЛЗ/ПЗ, отсортированный по возрастанию,
//      и раскидываем N лаб равномерно по этому списку.
//      dateIdx = ceil(k * M / N), M — число дат.
//   4) Рендерим строки: чекбокс | название (inline-edit) | дата
//      сдачи. Просроченные (дата < сегодня и не completed) —
//      красным цветом.
//   5) Кнопки «+ Добавить» и «🗑 Удалить последнюю» правят список.
//      Каждое изменение пересчитывает lab_progress на сервере —
//      «Управление лабораторными» и графики обновляются автоматически.
// ============================================================

let _labItemsCurrentSubject = null;
let _labItemsCurrentGroup = null;
let _labItemsCache = {};      // { [subject]: [ {id, idx, title, completed, due_date} ] }

function _datesForSubject(subject) {
    // Возвращает отсортированный список дат (YYYY-MM-DD), где у предмета
    // есть пара. subject — полный ключ вида "Математика (ЛЗ)".
    const dates = [];
    cachedSchedule.forEach(item => {
        const key = `${item.lesson} (${item.type_name})`;
        if (key === subject && item.date) dates.push(item.date);
    });
    dates.sort();
    return dates;
}

function _computeDueDate(dates, k, total) {
    // Раскидываем total лаб на dates.length дат.
    // k — 1-based номер лабы.
    if (!dates.length || total <= 0) return null;
    const M = dates.length;
    let idx = Math.ceil(k * M / total) - 1;   // 0-based
    if (idx < 0) idx = 0;
    if (idx >= M) idx = M - 1;
    return dates[idx];
}

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

// Перезагружает данные окна с сервера и перерисовывает.
async function _reloadLabItems() {
    if (!_labItemsCurrentSubject || !_labItemsCurrentGroup) return;

    const subjectKey = _labItemsCurrentSubject;
    const group = _labItemsCurrentGroup;

    // 1) Синкаем с сервером: сколько пар ЛЗ/ПЗ — столько и записей
    //    должно быть минимум. Sync работает только «в плюс» — если
    //    пользователь добавил лишние лабы вручную, они сохранятся.
    const totalCount = (cachedLabs[subjectKey] && cachedLabs[subjectKey].total) || 0;
    if (totalCount > 0) {
        try {
            await apiSyncLabItems(group, [{ subject: subjectKey, count: totalCount }]);
        } catch (e) {
            console.error('[lab_items] sync failed', e);
        }
    }

    // 2) Тянем список.
    let grouped = {};
    try { grouped = await apiLoadLabItems(group); }
    catch (e) { grouped = {}; }

    const items = Array.isArray(grouped[subjectKey]) ? grouped[subjectKey] : [];

    // 3) Считаем даты сдачи.
    const dates = _datesForSubject(subjectKey);
    const enriched = items.map(it => ({
        ...it,
        due_date: _computeDueDate(dates, it.idx, items.length || totalCount),
    }));

    _labItemsCache[subjectKey] = enriched;
    renderLabItemsList();
}

function renderLabItemsList() {
    const container = document.getElementById('labItemsContent');
    if (!container) return;

    const subjectKey = _labItemsCurrentSubject;
    if (!subjectKey) return;

    const items = _labItemsCache[subjectKey] || [];
    const todayStr = getLocalDateStr(new Date());

    // Панель действий — всегда сверху, даже если список пуст
    // (тогда можно добавить первую лабу).
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

async function onLabItemToggle(id, isCompleted) {
    try {
        await apiUpdateLabItem(id, { completed: isCompleted ? 1 : 0 });
    } catch (e) {
        console.error('[lab_items] update failed', e);
        alert('Не удалось сохранить');
        return;
    }
    // Локально обновим кэш, чтобы не мигать
    const subjectKey = _labItemsCurrentSubject;
    if (subjectKey && _labItemsCache[subjectKey]) {
        const it = _labItemsCache[subjectKey].find(x => x.id === id);
        if (it) it.completed = isCompleted ? 1 : 0;
    }
    renderLabItemsList();
    // Обновим агрегат — пересчитывается на сервере, но локально тоже
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

// ============================================================
//  ДОБАВИТЬ / УДАЛИТЬ ПОСЛЕДНЮЮ ЛАБУ
// ============================================================

async function onAddLabItem() {
    if (!_labItemsCurrentSubject || !_labItemsCurrentGroup) return;
    try {
        await apiAddLabItem(_labItemsCurrentGroup, _labItemsCurrentSubject);
    } catch (e) {
        console.error('[lab_items] add failed', e);
        alert('Не удалось добавить');
        return;
    }
    // Сервер пересчитал lab_progress. Обновляем локальный кэш агрегатов,
    // затем перезагружаем окно предмета и все виджеты.
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