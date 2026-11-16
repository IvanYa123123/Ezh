// Мини-календарь в сайдбаре.
// Месяц всегда синхронизирован с текущей неделей основной сетки.
// Кнопки ‹ ● › листают основную сетку (на ±4 недели / к сегодня).

const MINI_CAL_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MINI_CAL_MONTHS = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

function renderMiniCalendar() {
    const container = document.getElementById('miniCalendarBody');
    if (!container) return;

    // Месяц = месяц понедельника текущей недели
    const base = new Date(currentBaseDate);
    const year  = base.getFullYear();
    const month = base.getMonth();

    const titleEl = document.getElementById('miniCalendarTitle');
    if (titleEl) titleEl.textContent = `${MINI_CAL_MONTHS[month]} ${year}`;

    const datesWithTasks = (typeof taskDatesSet !== 'undefined') ? taskDatesSet : new Set();
    const taskCounts = (typeof taskCountsByDate !== 'undefined' && taskCountsByDate) ? taskCountsByDate : {};

    const pairCounts = new Map();
    const eventCounts = new Map();
    const addCount = (map, key) => map.set(key, (map.get(key) || 0) + 1);

    if (Array.isArray(cachedSchedule)) {
        cachedSchedule.forEach(item => {
            if (item.date) addCount(pairCounts, item.date);
        });
    }

    if (typeof customScheduleItems !== 'undefined' && Array.isArray(customScheduleItems) && customScheduleItems.length > 0) {
        const firstOfMonth = new Date(year, month, 1);
        const lastOfMonth  = new Date(year, month + 1, 0);
        for (let d = new Date(firstOfMonth); d <= lastOfMonth; d.setDate(d.getDate() + 1)) {
            const ds = getLocalDateStr(d);
            try {
                const items = getCustomItemsForDate(ds);
                (items || []).forEach(ev => addCount(ev.is_event ? eventCounts : pairCounts, ds));
            } catch (e) { /* ignore */ }
        }
    }

    const firstDay = new Date(year, month, 1);
    let firstDow = firstDay.getDay();
    if (firstDow === 0) firstDow = 7;
    firstDow -= 1;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getLocalDateStr(new Date());

    const currentWeekStart = new Date(currentBaseDate);
    currentWeekStart.setHours(0, 0, 0, 0);
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);

    let html = '<div class="mini-cal-grid">';
    MINI_CAL_WEEKDAYS.forEach(w => {
        html += `<div class="mini-cal-weekday">${w}</div>`;
    });

    for (let i = 0; i < firstDow; i++) {
        html += '<div class="mini-cal-day mini-cal-empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const dateStr = getLocalDateStr(date);

        const classes = ['mini-cal-day'];
        if (dateStr === todayStr) classes.push('mini-cal-today');
        if (date >= currentWeekStart && date <= currentWeekEnd) classes.push('mini-cal-current-week');

        let dots = '';
        const pairN = pairCounts.get(dateStr) || 0;
        const eventN = eventCounts.get(dateStr) || 0;
        const noteN = Number(taskCounts[dateStr] || (datesWithTasks.has(dateStr) ? 1 : 0));

        for (let i = 0; i < pairN; i++) {
            dots += `<span class="mini-cal-dot mini-cal-dot-class" title="Пары: ${pairN}"></span>`;
        }
        for (let i = 0; i < eventN; i++) {
            dots += `<span class="mini-cal-dot mini-cal-dot-event" title="События: ${eventN}"></span>`;
        }
        const sev = (typeof taskSeverityByDate !== 'undefined' && taskSeverityByDate)
            ? taskSeverityByDate[dateStr] : '';
        const noteTone = sev === 'red' ? 'note-hard'
            : sev === 'orange' ? 'note-mid'
            : sev === 'green' ? 'note-easy'
            : noteN >= 3 ? 'note-hard' : noteN === 2 ? 'note-mid' : 'note-easy';
        for (let i = 0; i < noteN; i++) {
            dots += `<span class="mini-cal-dot mini-cal-dot-task ${noteTone}" title="Заметки: ${noteN}"></span>`;
        }

        html += `<div class="${classes.join(' ')}" onclick="miniCalPickDate('${dateStr}')" title="${dateStr}">
            <span class="mini-cal-num">${d}</span>
            <span class="mini-cal-dots">${dots}</span>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

// Кнопки мини-календаря листают основную сетку на месяц, а не на
// 28 дней: иначе «следующий месяц» мог остаться в том же месяце
// (2 марта + 4 недели = 30 марта).
function _miniCalShiftMonth(delta) {
    const expandedIdx = (typeof _expandedDayIndex === 'function') ? _expandedDayIndex() : null;
    const base = new Date(currentBaseDate);
    const day = Math.min(base.getDate(), 28);
    let target = new Date(base.getFullYear(), base.getMonth() + delta, day);
    // Понедельник недели, в которую попадает выбранное число месяца.
    const dow = target.getDay() === 0 ? 6 : target.getDay() - 1;
    target.setDate(target.getDate() - dow);
    currentBaseDate = target;
    if (typeof _restoreExpandedDay === 'function') _restoreExpandedDay(expandedIdx);
    if (typeof _verticalDayOffset !== 'undefined') _verticalDayOffset = null;
    renderCalendar();
    refreshMiniCalendar();
}

function miniCalPrevMonth() { _miniCalShiftMonth(-1); }
function miniCalNextMonth() { _miniCalShiftMonth(1);  }
function miniCalToday()     { goToToday();    }

function miniCalPickDate(dateStr) {
    if (typeof jumpToDate === 'function') {
        jumpToDate(dateStr);
    }
}

function refreshMiniCalendar() {
    renderMiniCalendar();
}