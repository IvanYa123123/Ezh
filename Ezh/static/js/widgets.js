// Оркестратор виджетов: сводка лаб, графики Chart.js, тема.
//
// v3.15.1:
//   • Анимация появления графиков (rotate + scale, 900ms, easeOutQuart).
//   • При обновлении — анимация только если данные реально изменились,
//     иначе update('none') — при драге виджета и смене размера окна
//     график не «дёргается».
//   • refreshChartsTheme больше не destroy+recreate: цвета обновляются
//     на месте. Иначе при перетаскивании пикера цвета график мерцал.
//   • hoverOffset: 8 — сектор графика отъезжает от центра на hover.

// ============================================================
//  СВОДКА ЛАБ
// ============================================================

async function updateLabsCache() {
    const group = document.getElementById("groupSelect").value.trim();
    if (!group) return;
    try { cachedLabs = await apiLoadLabs(group); }
    catch (e) { cachedLabs = {}; }
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

// Общие настройки анимации для обоих doughnut-графиков.
// animateRotate + animateScale дают появление «сектор растёт
// из центра и проворачивается в кольцо».
const _CHART_ANIM = {
    duration: 900,
    easing: 'easeOutQuart',
    animateRotate: true,
    animateScale: true,
};

function _chartAnimationConfig() {
    return Object.assign({}, _CHART_ANIM);
}

// Собирает общие tooltip-настройки. Вызывается при каждом renderCharts,
// потому что цвета темы могли поменяться.
function _buildTooltipOpts() {
    return {
        backgroundColor: getThemeColor('--chart-tooltip-bg',   'rgba(15, 23, 42, 0.92)'),
        titleColor:      getThemeColor('--chart-tooltip-text', '#f8fafc'),
        bodyColor:       getThemeColor('--chart-tooltip-text', '#f8fafc'),
        borderColor:     getThemeColor('--border-color',       '#e2e8f0'),
        borderWidth:     1,
        padding:         8,
        cornerRadius:    6,
        displayColors:   false,
    };
}

function _chartDataChanged(chart, newData) {
    if (!chart || !chart.data || !chart.data.datasets || !chart.data.datasets[0]) {
        return true;
    }
    const old = chart.data.datasets[0].data || [];
    if (old.length !== newData.length) return true;
    for (let i = 0; i < newData.length; i++) {
        if (old[i] !== newData[i]) return true;
    }
    return false;
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

    const tooltipOpts = _buildTooltipOpts();

    // --- График 1: остаток пар ---
    let passed = 0, remaining = 0;
    let todayStr = getLocalDateStr(new Date());
    cachedSchedule.forEach(item => { item.date < todayStr ? passed++ : remaining++; });

    const canvas1 = document.getElementById('globalStatsChart');
    if (canvas1) {
        if (globalChart) {
            const newData = [passed, remaining];
            const changed = _chartDataChanged(globalChart, newData);

            globalChart.data.datasets[0].data = newData;
            globalChart.data.datasets[0].backgroundColor = [cPassed, cRemaining];
            globalChart.options.plugins.legend.labels.color = cText;
            globalChart.options.plugins.tooltip = Object.assign(
                {}, globalChart.options.plugins.tooltip, tooltipOpts
            );

            // Если данные реально изменились — обновляем с анимацией.
            // Если нет (drag/theme/resize) — мгновенно, чтобы не мигало.
            globalChart.update(changed ? undefined : 'none');
        } else {
            _setCanvasInitialSize(canvas1);
            globalChart = new Chart(canvas1.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Прошло', 'Осталось'],
                    datasets: [{
                        data: [passed, remaining],
                        backgroundColor: [cPassed, cRemaining],
                        borderWidth: 0,
                        hoverOffset: 8,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: _chartAnimationConfig(),
                    plugins: {
                        legend: { position: 'bottom', labels: { color: cText } },
                        tooltip: tooltipOpts,
                    }
                }
            });
        }
    }

    // --- График 2: лабораторные ---
    let labItems = cachedSchedule.filter(item => item.type_name === 'ЛЗ' || item.type_name === 'ПЗ');
    let validSubjects = new Set(labItems.map(item => `${item.lesson} (${item.type_name})`));
    let totLabs = 0, compLabs = 0;
    for (let subj in cachedLabs) {
        if (!validSubjects.has(subj)) continue;
        totLabs += cachedLabs[subj].total;
        compLabs += cachedLabs[subj].completed;
    }
    let uncompLabs = Math.max(0, totLabs - compLabs);
    let labData    = totLabs === 0 ? [0, 1] : [compLabs, uncompLabs];
    let labColors  = totLabs === 0 ? [cRemaining, cRemaining] : [cLabDone, cLabLeft];
    let labLabels  = totLabs === 0 ? ['Нет данных', ''] : ['Сдано', 'Осталось'];

    const canvas2 = document.getElementById('labStatsChart');
    if (canvas2) {
        if (globalLabChart) {
            const changed = _chartDataChanged(globalLabChart, labData);

            globalLabChart.data.datasets[0].data = labData;
            globalLabChart.data.datasets[0].backgroundColor = labColors;
            globalLabChart.data.labels = labLabels;
            globalLabChart.options.plugins.legend.labels.color = cText;
            globalLabChart.options.plugins.tooltip = Object.assign(
                {}, globalLabChart.options.plugins.tooltip, tooltipOpts
            );

            globalLabChart.update(changed ? undefined : 'none');
        } else {
            _setCanvasInitialSize(canvas2);
            globalLabChart = new Chart(canvas2.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: labLabels,
                    datasets: [{
                        data: labData,
                        backgroundColor: labColors,
                        borderWidth: 0,
                        hoverOffset: 8,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: _chartAnimationConfig(),
                    plugins: {
                        legend: { position: 'bottom', labels: { color: cText } },
                        tooltip: tooltipOpts,
                    }
                }
            });
        }
    }

    // Боковые панели в горизонтальном режиме + темп сдачи
    _renderGlobalStatsDetails();
    _renderLabStatsDetails();
    renderLabPacing();
}

// ============================================================
//  СМЕНА ТЕМЫ
// ------------------------------------------------------------
//  Раньше здесь был destroy + пересоздание — при перетаскивании
//  пикера цвета график мерцал и переанимировался десятки раз
//  в секунду. Теперь просто перекрашиваем на месте, без анимации.
// ============================================================

function refreshChartsTheme() {
    const cText      = getThemeColor('--text-secondary', '--');
    const tooltipOpts = _buildTooltipOpts();

    if (typeof globalChart !== 'undefined' && globalChart) {
        try {
            globalChart.data.datasets[0].backgroundColor = [
                getThemeColor('--chart-passed',    '#6366f1'),
                getThemeColor('--chart-remaining', '#cbd5e1'),
            ];
            globalChart.options.plugins.legend.labels.color = getThemeColor('--text-secondary', '#64748b');
            globalChart.options.plugins.tooltip = Object.assign(
                {}, globalChart.options.plugins.tooltip, tooltipOpts
            );
            globalChart.update('none');
        } catch (e) {
            console.error('[theme] globalChart update failed', e);
        }
    }

    if (typeof globalLabChart !== 'undefined' && globalLabChart) {
        try {
            globalLabChart.data.datasets[0].backgroundColor = [
                getThemeColor('--chart-lab-done', '#14b8a6'),
                getThemeColor('--chart-lab-left', '#f59e0b'),
            ];
            globalLabChart.options.plugins.legend.labels.color = getThemeColor('--text-secondary', '#64748b');
            globalLabChart.options.plugins.tooltip = Object.assign(
                {}, globalLabChart.options.plugins.tooltip, tooltipOpts
            );
            globalLabChart.update('none');
        } catch (e) {
            console.error('[theme] globalLabChart update failed', e);
        }
    }
}