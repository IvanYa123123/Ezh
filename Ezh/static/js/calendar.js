// Оркестратор календаря: строит сетку из карточек, разложенных
// в calendar-cards.js, и делегирует взаимодействие в calendar-day.js.
//
// v3.15.0: распилен на три файла.

// ============================================================
//  КАСТОМНЫЕ ЭЛЕМЕНТЫ (события и пары, добавленные вручную)
// ============================================================

function getCustomItemsForDate(dateStr) {
    let items = [];
    let [ty, tm, td] = dateStr.split('-');
    let tDate = new Date(ty, tm - 1, td);

    customScheduleItems.forEach(item => {
        let [by, bm, bd] = item.base_date.split('-');
        let bDate = new Date(by, bm - 1, bd);
        if (tDate < bDate) return;

        let exceptions = [];
        try { exceptions = JSON.parse(item.exceptions || '[]'); } catch (e) {}
        if (exceptions.includes(dateStr)) return;

        let diffDays = Math.round(Math.abs(tDate - bDate) / (1000 * 60 * 60 * 24));
        let match = false;
        if (item.recurrence === 'none' && diffDays === 0) match = true;
        else if (item.recurrence === 'weekly' && diffDays % 7 === 0) match = true;
        else if (item.recurrence === 'biweekly' && diffDays % 14 === 0) match = true;

        if (match) {
            items.push({
                is_custom: true,
                custom_id: item.id,
                base_date: item.base_date,
                recurrence: item.recurrence,
                exceptions: item.exceptions,
                is_event: item.is_event === 1,
                date: dateStr,
                time_range: item.time_range,
                lesson: item.lesson,
                type_name: item.type_name,
                teacher: item.teacher,
                location: item.location
            });
        }
    });
    return items;
}

function _sortItemsByTime(a, b) {
    let aTime = a.time_range ? a.time_range.split(' - ')[0] : "99:99";
    let bTime = b.time_range ? b.time_range.split(' - ')[0] : "99:99";
    return aTime.localeCompare(bTime);
}

// ============================================================
//  ИНДЕКС РАСПИСАНИЯ ПО ДАТАМ
// ============================================================

function _buildScheduleByDate() {
    const map = new Map();
    if (!Array.isArray(cachedSchedule)) return map;
    for (let i = 0; i < cachedSchedule.length; i++) {
        const it = cachedSchedule[i];
        let bucket = map.get(it.date);
        if (!bucket) { bucket = []; map.set(it.date, bucket); }
        bucket.push(it);
    }
    return map;
}

// ============================================================
//  КОЛОНКА ДНЯ
// ============================================================

function _renderDayColumn(dateStr, displayDate, isToday, eventItems, pairItems, isExpanded) {
    let eventsHtml = "";
    if (eventItems.length > 0) {
        eventsHtml = '<div class="day-events-block mt-2">';
        eventItems.forEach(ev => { eventsHtml += _renderEventCard(ev); });
        eventsHtml += '</div>';
    }

    let scheduleHtml = "";
    if (pairItems.length > 0) {
        const startTime = fixTime(pairItems[0].time_range.split(' - ')[0]);
        const endTime   = fixTime(pairItems[pairItems.length - 1].time_range.split(' - ')[1]);
        const expandedClass = isExpanded ? ' expanded' : '';
        const arrowIcon = isExpanded ? '▲' : '▼';

        scheduleHtml += `
            <div class="schedule-summary shadow-sm" onclick="toggleSchedule('${dateStr}')">
                🕒 Пары: ${startTime} - ${endTime} <span id="arrow-${dateStr}">${arrowIcon}</span>
            </div>
            <div id="schedule-details-${dateStr}"${expandedClass}>
                <div class="schedule-details-inner">
        `;
        pairItems.forEach(item => { scheduleHtml += _renderPairCard(item); });
        scheduleHtml += `</div></div>`;
    } else if (eventItems.length === 0) {
        scheduleHtml = `<div class="empty-state-inline">
            <span class="empty-state-inline-icon">☕</span>
            <span>Свободный день</span>
        </div>`;
    }

    return `
        <div class="day-col ${isToday ? 'day-today' : ''}" id="day-col-${dateStr}" ondragover="allowDrop(event)" ondrop="drop(event, '${dateStr}')">
            <div class="day-header">
                <span class="day-nav-center">${displayDate}</span>
            </div>

            <div class="day-schedule-wrap">
                <div class="mb-2">${scheduleHtml}</div>
                ${eventsHtml}
            </div>

            <div class="day-tasks-wrap d-flex flex-column" style="flex-grow: 1;">
                <div id="tasks-${dateStr}" style="flex-grow: 1; min-height: 50px;"></div>

                <div id="expand-btn-wrap-${dateStr}" style="display: none; text-align: center; margin-top: 6px;">
                    <button type="button" class="day-expand-btn" onclick="toggleExpandDay('${dateStr}')">
                        <span class="day-expand-icon">▼</span>
                        <span class="day-expand-label">Развернуть</span>
                    </button>
                </div>

                <div class="text-center mt-2 d-flex justify-content-center gap-2">
                    <button class="btn btn-outline-primary btn-sm rounded-circle fw-bold shadow-sm"
                            style="width: 28px; height: 28px; line-height: 12px; padding: 0;"
                            onclick="toggleTaskInput('${dateStr}')" title="Добавить заметку">+</button>
                    <button class="btn btn-outline-success btn-sm rounded-circle fw-bold shadow-sm"
                            style="width: 28px; height: 28px; line-height: 12px; padding: 0;"
                            onclick="openCustomScheduleModal('${dateStr}')" title="Добавить в расписание">+</button>
                </div>

                <div id="task-input-wrap-${dateStr}" style="display: none;" class="mt-2">
                    <textarea id="task-input-${dateStr}" class="form-control form-control-sm"
                           placeholder="Текст заметки" rows="2" style="resize: none;"
                           onkeydown="handleNewTask(event, '${dateStr}')"
                           onblur="handleTaskBlur('${dateStr}')"></textarea>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
//  ГЛАВНЫЙ РЕНДЕР
// ============================================================

async function renderCalendar() {
    const calDir = window._calDir;
    window._calDir = null;

    // Запоминаем, какие дни были развёрнуты
    let openDays = new Set();
    document.querySelectorAll('div[id^="schedule-details-"]').forEach(el => {
        if (el.classList.contains('expanded')) {
            openDays.add(el.id.replace('schedule-details-', ''));
        }
    });

    updateWeekDropdown();

    const cal = document.getElementById("calendar");
    if (!cal) return;

    cal.classList.remove('slide-left', 'slide-right', 'fade-in');
    void cal.offsetWidth;
    if (calDir === 'right')      cal.classList.add('slide-right');
    else if (calDir === 'left')  cal.classList.add('slide-left');
    else                         cal.classList.add('fade-in');

    cal.innerHTML = "";

    const startStr = getLocalDateStr(currentBaseDate);
    const endD = new Date(currentBaseDate);
    endD.setDate(endD.getDate() + 6);
    const endStr = getLocalDateStr(endD);
    const realTodayStr = getLocalDateStr(new Date());

    const currentGroup = (document.getElementById('groupSelect')?.value || '').trim();
    if (!currentGroup || cachedSchedule.length === 0) {
        cal.innerHTML = `
            <div class="empty-state empty-state-wide">
                <div class="empty-state-icon">📚</div>
                <div class="empty-state-title">${currentGroup ? 'Расписание не загружено' : 'Выберите группу'}</div>
                <div class="empty-state-text">${currentGroup
                    ? 'Нажмите «Найти» ещё раз или обновите страницу.'
                    : 'Введите номер группы в строке поиска сверху и нажмите «Найти».'}</div>
            </div>`;
        if (typeof renderSyncFreshness === 'function') renderSyncFreshness();
        if (typeof renderMiniCalendar === 'function') renderMiniCalendar();
        return;
    }

    const scheduleByDate = _buildScheduleByDate();
    const htmlParts = [];

    for (let i = 0; i < 7; i++) {
        const d = new Date(currentBaseDate);
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateStr(d);
        const displayDate = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
        const isToday = (dateStr === realTodayStr);

        const daySchedule = scheduleByDate.get(dateStr) || [];
        const customItems = getCustomItemsForDate(dateStr);
        const allItems = daySchedule.concat(customItems);

        const eventItems = allItems.filter(x => x.is_custom && x.is_event);
        const pairItems  = allItems.filter(x => !(x.is_custom && x.is_event));

        eventItems.sort(_sortItemsByTime);
        pairItems.sort(_sortItemsByTime);

        const isExpanded = openDays.has(dateStr);
        htmlParts.push(_renderDayColumn(dateStr, displayDate, isToday, eventItems, pairItems, isExpanded));
    }

    cal.innerHTML = htmlParts.join('');

    // Раскладываем «+ Заметка»: где поместилась — в топе, где нет — в футере
    _layoutScheduleNotes(cal);

    try {
        let tasks = await apiLoadTasks(startStr, endStr);
        if (typeof renderTasksStaggered === 'function') {
            renderTasksStaggered(tasks);
        } else {
            tasks.forEach(t => renderTask(t));
        }
    } catch (e) { console.error("Tasks load error", e); }

    renderFriendsCalendar(calDir);
    if (typeof renderTeachersCalendars === 'function') renderTeachersCalendars();

    if (typeof renderSyncFreshness === 'function') renderSyncFreshness();
    if (typeof renderMiniCalendar === 'function') renderMiniCalendar();

    if (expandedDayDateStr) {
        let grid = document.querySelector('.calendar-grid');
        let col = document.getElementById(`day-col-${expandedDayDateStr}`);
        if (col) {
            col.classList.add('fullscreen-day');
            grid.classList.add('has-fullscreen');

            let btn = document.querySelector(`#expand-btn-wrap-${expandedDayDateStr} .day-expand-btn`);
            if (btn) {
                btn.classList.add('is-expanded');
                let lbl = btn.querySelector('.day-expand-label');
                if (lbl) lbl.textContent = 'Свернуть';
            }

            let details = document.getElementById(`schedule-details-${expandedDayDateStr}`);
            let arrow   = document.getElementById(`arrow-${expandedDayDateStr}`);
            if (details) details.classList.add('expanded');
            if (arrow) arrow.textContent = "▲";
            rebalanceDayText(expandedDayDateStr);
        } else {
            expandedDayDateStr = null;
        }
    }
}

// ============================================================
//  ИНДИКАТОР СВЕЖЕСТИ
// ============================================================

function _formatAgo(ms) {
    const diff = Date.now() - ms;
    if (diff < 60 * 1000) return 'только что';
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
    return 'давно';
}

function renderSyncFreshness() {
    const el = document.getElementById('syncFreshness');
    if (!el) return;

    const group    = (document.getElementById('groupSelect')?.value || '').trim();
    const subgroup = document.getElementById('subgroupSelect')?.value || '0';
    if (!group) { el.textContent = ''; return; }

    const ts = (typeof getSyncTime === 'function') ? getSyncTime(group, subgroup) : null;
    if (!ts) {
        el.innerHTML = `<span class="sync-fresh sync-fresh-cache" title="Расписание загружено из локального кэша">📦 из кэша</span>`;
        return;
    }

    const age = Date.now() - ts;
    const isFresh = age < 6 * 60 * 60 * 1000;
    const cls = isFresh ? 'sync-fresh-ok' : 'sync-fresh-cache';
    const icon = isFresh ? '🔄' : '📦';
    const hint = isFresh ? 'Синхронизировано недавно' : 'Давно не синхронизировано';

    el.innerHTML = `<span class="sync-fresh ${cls}" title="${hint}">${icon} ${_formatAgo(ts)}</span>`;
}