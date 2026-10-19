// Виджет «Остаток пар»: модалка со статистикой + компактная
// панель деталей для горизонтального режима.

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

// ============================================================
//  КОМПАКТНАЯ ПАНЕЛЬ ДЕТАЛЕЙ (горизонтальный режим)
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