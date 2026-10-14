// Виджеты: графики Chart.js, управление лабами, модалка статистики.

async function updateLabsCache() {
    const group = document.getElementById("groupSelect").value.trim();
    if (!group) return;
    try { cachedLabs = await apiLoadLabs(group); }
    catch (e) { cachedLabs = {}; }
}

// ============================================================
//  МОДАЛКА «ОСТАТОК ПАР»
// ============================================================

function showStats() {
    const group = document.getElementById("groupSelect").value.trim();
    if (!group || cachedSchedule.length === 0) return alert("Сначала загрузите расписание!");

    new bootstrap.Modal(document.getElementById('statsModal')).show();

    let stats = {};
    let todayStr = getLocalDateStr(new Date());
    let totalPast = 0, totalFuture = 0;

    cachedSchedule.forEach(item => {
        let subject = item.lesson;
        let type = item.type_name;
        if (!stats[subject]) stats[subject] = { display: subject, types: {} };
        if (!stats[subject].types[type]) stats[subject].types[type] = { past: 0, future: 0 };
        if (item.date < todayStr) {
            stats[subject].types[type].past++;
            totalPast++;
        } else {
            stats[subject].types[type].future++;
            totalFuture++;
        }
    });

    let html = `
        <div class="stats-summary">
            <div class="stats-summary-item">
                <div class="stats-summary-num stats-summary-past">${totalPast}</div>
                <div class="stats-summary-label">Прошло</div>
            </div>
            <div class="stats-summary-item">
                <div class="stats-summary-num stats-summary-future">${totalFuture}</div>
                <div class="stats-summary-label">Осталось</div>
            </div>
        </div>
        <div class="stats-grid">
    `;

    for (let subject in stats) {
        let subj = stats[subject];
        html += `
            <div class="stats-card">
                <div class="stats-card-header" title="${escapeHtml(subj.display)}">${escapeHtml(subj.display)}</div>
                <div class="stats-card-body">
        `;
        for (let type in subj.types) {
            let past = subj.types[type].past;
            let future = subj.types[type].future;
            let total = past + future;
            let pct = total > 0 ? Math.round((past / total) * 100) : 0;
            html += `
                <div class="stats-row">
                    <div class="stats-row-head">
                        <span class="stats-row-label">${escapeHtml(type)}</span>
                        <span class="stats-row-counts">
                            <span class="stats-row-past">${past}</span>
                            <span class="stats-row-sep">/</span>
                            <span class="stats-row-total">${total}</span>
                        </span>
                    </div>
                    <div class="stats-row-bar">
                        <div class="stats-row-bar-fill" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }
        html += `</div></div>`;
    }
    html += '</div>';

    if (Object.keys(stats).length === 0) {
        html = "<p class='text-center'>Нет данных для выбранной группы.</p>";
    }
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

// ============================================================
//  ДЕТАЛИ ДЛЯ ГОРИЗОНТАЛЬНЫХ ВИДЖЕТОВ-ГРАФИКОВ
// ------------------------------------------------------------
//  Дублируют данные из подробных модалок, но в компактном виде:
//    • «Остаток пар» — список предметов с прошло/всего.
//    • «Лабораторные» — список предметов с сдано/всего лаб.
//  Показываются только когда виджет лежит в горизонтальной зоне
//  (см. CSS: #underCalendarWidgetsZone .widget-details-wrap).
// ============================================================

function _renderGlobalStatsDetails() {
    const el = document.getElementById('globalStatsDetails');
    if (!el) return;

    const todayStr = getLocalDateStr(new Date());
    const stats = {};

    cachedSchedule.forEach(item => {
        const subj = item.lesson;
        if (!stats[subj]) stats[subj] = { past: 0, total: 0 };
        stats[subj].total++;
        if (item.date < todayStr) stats[subj].past++;
    });

    const subjects = Object.keys(stats).sort((a, b) => a.localeCompare(b, 'ru'));

    if (subjects.length === 0) {
        el.innerHTML = '<div class="text-muted small">Нет данных</div>';
        return;
    }

    let html = '';
    subjects.forEach(subj => {
        const s = stats[subj];
        html += `
            <div class="widget-details-row" title="${escapeHtml(subj)}">
                <span class="widget-details-title">${escapeHtml(getDisplaySubjectKey(subj))}</span>
                <span class="widget-details-nums">${s.past} / ${s.total}</span>
            </div>
        `;
    });
    el.innerHTML = html;
}

function _renderLabStatsDetails() {
    const el = document.getElementById('labStatsDetails');
    if (!el) return;

    const validSubjects = new Set(
        cachedSchedule
            .filter(item => item.type_name === 'ЛЗ' || item.type_name === 'ПЗ')
            .map(item => `${item.lesson} (${item.type_name})`)
    );

    const items = Object.keys(cachedLabs || {})
        .filter(subj => validSubjects.has(subj) && cachedLabs[subj].total > 0)
        .sort((a, b) => a.localeCompare(b, 'ru'));

    if (items.length === 0) {
        el.innerHTML = '<div class="text-muted small">Нет данных</div>';
        return;
    }

    let html = '';
    items.forEach(subj => {
        const data = cachedLabs[subj];
        html += `
            <div class="widget-details-row" title="${escapeHtml(subj)}">
                <span class="widget-details-title">${escapeHtml(getDisplaySubjectKey(subj))}</span>
                <span class="widget-details-nums">${data.completed} / ${data.total}</span>
            </div>
        `;
    });
    el.innerHTML = html;
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

    let passed = 0, remaining = 0;
    let todayStr = getLocalDateStr(new Date());
    cachedSchedule.forEach(item => { item.date < todayStr ? passed++ : remaining++; });

    const canvas1 = document.getElementById('globalStatsChart');
    if (canvas1) {
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
    }

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
    if (canvas2) {
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
    }

    // Наполняем боковые панели деталей (видны в горизонтальной зоне)
    _renderGlobalStatsDetails();
    _renderLabStatsDetails();

    renderLabPacing();
}

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
    if (!container) return;

    if (!cachedLabs || Object.keys(cachedLabs).length === 0) {
        container.innerHTML = '<div class="text-center text-muted small mt-2">Нет данных</div>';
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
    let html = '';
    let hasData = false;

    for (let subj in cachedLabs) {
        if (!validSubjects.has(subj)) continue;
        let data = cachedLabs[subj];
        if (data.total === 0) continue;
        hasData = true;

        let stats = scheduleStats[subj];

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

        const actualCount = data.completed;

        let level = 'is-empty';
        if (expectedCount > 0) {
            if (actualCount >= expectedCount) level = 'is-ok';
            else if (actualCount * 2 >= expectedCount) level = 'is-warn';
            else level = 'is-danger';
        } else if (actualCount > 0) {
            level = 'is-ok';
        }

        const displaySubj = getDisplaySubjectKey(subj);
        const safeSubj = escapeJsString(subj);

        html += `
            <div class="pacing-row" title="Открыть список лаб" onclick="openLabItemsModal('${safeSubj}')">
                <span class="pacing-row-title">${escapeHtml(displaySubj)}</span>
                <span class="pacing-row-counts ${level}">
                    <span class="pacing-num-actual">${actualCount}</span><span class="pacing-num-sep">/</span><span class="pacing-num-plan">${expectedCount}</span>
                </span>
            </div>
        `;
    }

    container.innerHTML = hasData
        ? html
        : '<div class="text-center text-muted small mt-2">Нет данных</div>';
}

// ============================================================
//  ОКНО ПРЕДМЕТА: СПИСОК ЛАБ/ПЗ
// ============================================================

let _labItemsCurrentSubject = null;
let _labItemsCurrentGroup = null;
let _labItemsCache = {};

function _datesForSubject(subject) {
    const dates = [];
    cachedSchedule.forEach(item => {
        const key = `${item.lesson} (${item.type_name})`;
        if (key === subject && item.date) dates.push(item.date);
    });
    dates.sort();
    return dates;
}

function _computeDueDate(dates, k, total) {
    if (!dates.length || total <= 0) return null;
    const M = dates.length;
    let idx = Math.ceil(k * M / total) - 1;
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

async function _reloadLabItems() {
    if (!_labItemsCurrentSubject || !_labItemsCurrentGroup) return;

    const subjectKey = _labItemsCurrentSubject;
    const group = _labItemsCurrentGroup;

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