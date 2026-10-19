// Сводка лабораторных: модалка управления, панель деталей
// для горизонтального режима, «Темп сдачи лаб».

// ============================================================
//  МОДАЛКА «ЛАБОРАТОРНЫЕ»
// ============================================================

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
//  КОМПАКТНАЯ ПАНЕЛЬ ДЕТАЛЕЙ (горизонтальный режим)
// ============================================================

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

// ============================================================
//  ТЕМП СДАЧИ ЛАБ
// ------------------------------------------------------------
//  Сравнивает фактические сдачи с «планом»: сколько пар предмета
//  уже прошло — столько лаб и должно быть сдано (пропорционально).
//  Клик по строке открывает поштучный список (lab-items.js).
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