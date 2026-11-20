// Нагрузка преподавателя за отображаемую неделю: часы, пары, окна между парами.

function _teachingLoadWeekDates() {
    const base = new Date(currentBaseDate);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        dates.push(getLocalDateStr(d));
    }
    return dates;
}

function _formatTeachingMins(mins) {
    const total = Math.max(0, Math.round(mins));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h && m) return `${h} ч ${m} м`;
    if (h) return `${h} ч`;
    return `${m} м`;
}

function renderTeachingLoad() {
    const card = document.getElementById('widgetTeachingLoadCard');
    if (!card) return;
    if (typeof isTeacherRole !== 'function' || !isTeacherRole() || !showWidgetTeachingLoad) {
        card.style.display = 'none';
        return;
    }

    const dates = _teachingLoadWeekDates();
    const dateSet = new Set(dates);
    const weekItems = cachedSchedule.filter(item => dateSet.has(item.date));

    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    let totalMins = 0;
    let totalPairs = 0;
    let totalGaps = 0;
    let gapMins = 0;
    const dayRows = [];

    dates.forEach((date, index) => {
        const dayPairs = weekItems
            .filter(item => item.date === date)
            .sort((a, b) => parseTimeRangeToMins(a.time_range)[0] - parseTimeRangeToMins(b.time_range)[0]);

        let dayMins = 0;
        let dayGaps = 0;
        let prevEnd = null;

        dayPairs.forEach(pair => {
            const [start, end] = parseTimeRangeToMins(pair.time_range);
            if (end > start) {
                dayMins += end - start;
                if (prevEnd !== null && start - prevEnd > 15) {
                    dayGaps += 1;
                    gapMins += start - prevEnd;
                }
                if (prevEnd === null || end > prevEnd) prevEnd = end;
            }
        });

        totalMins += dayMins;
        totalPairs += dayPairs.length;
        totalGaps += dayGaps;

        if (dayPairs.length > 0) {
            dayRows.push(`
                <div class="teaching-load-day">
                    <span>${dayNames[index]}</span>
                    <span>${dayPairs.length} · ${_formatTeachingMins(dayMins)}${dayGaps ? ` · ${dayGaps} ${plural(dayGaps, 'окно', 'окна', 'окон')}` : ''}</span>
                </div>`);
        }
    });

    const hoursEl = document.getElementById('teachingLoadHours');
    const pairsEl = document.getElementById('teachingLoadPairs');
    const gapsEl = document.getElementById('teachingLoadGaps');
    const detailEl = document.getElementById('teachingLoadDetail');

    if (hoursEl) hoursEl.textContent = (totalMins / 60).toFixed(1).replace('.', ',');
    if (pairsEl) pairsEl.textContent = String(totalPairs);
    if (gapsEl) gapsEl.textContent = String(totalGaps);
    if (detailEl) {
        if (!totalPairs) {
            detailEl.innerHTML = '<div class="teaching-load-empty">На этой неделе пар нет</div>';
        } else {
            const gapLine = totalGaps
                ? `<div class="teaching-load-gap">Окна: ${_formatTeachingMins(gapMins)}</div>`
                : '<div class="teaching-load-gap">Без окон</div>';
            detailEl.innerHTML = dayRows.join('') + gapLine;
        }
    }
}
