// Рендер сетки календаря, раскрытие дня, кастомные события, индикатор свежести.

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
//  РАСКЛАДКА «+ ЗАМЕТКА»
// ------------------------------------------------------------
//  Изначально кнопка стоит в .schedule-item-top рядом со временем.
//  Если при верстке она «уехала» на вторую строку (перенос из-за
//  нехватки ширины) — переносим её в .schedule-item-footer.
// ============================================================

function _layoutScheduleNotes(rootEl) {
    const scope = rootEl || document;
    scope.querySelectorAll('.schedule-item').forEach(card => {
        const top    = card.querySelector('.schedule-item-top');
        const footer = card.querySelector('.schedule-item-footer');
        if (!top || !footer) return;

        // Кнопку ищем по обоим местам — она могла остаться в футере от прошлого рендера
        let note = top.querySelector('.add-task-btn') || footer.querySelector('.add-task-btn');
        if (!note) return;

        // 1) Сбрасываем: возвращаем в top, чтобы замерить «идеальное» положение
        if (note.parentElement !== top) top.appendChild(note);

        const timeEl = top.querySelector('.schedule-item-time');
        if (!timeEl) return;

        // 2) Замеряем: если top-кнопка оказалась ниже времени — значит перенеслась
        const timeTop = timeEl.getBoundingClientRect().top;
        const noteTop = note.getBoundingClientRect().top;

        if (noteTop > timeTop + 4) {
            footer.appendChild(note);
        }
    });
}

// ============================================================
//  КАРТОЧКА СОБЫТИЯ
// ============================================================

function _renderEventCard(ev) {
    const safeSubject = escapeJsString(ev.lesson || '');

    const teacherHtml = (ev.teacher && showTeacher)
        ? `<div class="schedule-item-teacher">${escapeHtml(ev.teacher)}</div>` : '';
    const locationHtml = (ev.location && showLocation)
        ? `<div class="schedule-item-location">${escapeHtml(ev.location)}</div>` : '';

    return `
        <div class="schedule-item event-card shadow-sm"
             style="border-left: 3px solid var(--event-color);">
            <div class="schedule-item-top">
                <span class="schedule-item-time">
                    <strong class="text-primary">${ev.time_range}</strong>
                    <span class="schedule-item-edit"
                          onclick="openCustomScheduleModal('${ev.date}', ${ev.custom_id})"
                          title="Редактировать">✏️</span>
                </span>
                <span class="add-task-btn"
                      onclick="createTaskFromSchedule('${ev.date}', '${safeSubject}')">+ Заметка</span>
            </div>
            <div class="schedule-item-badge">
                <span class="badge bg-success" style="font-size: 0.7em;">Событие</span>
            </div>
            <div class="schedule-item-title">${escapeHtml(ev.lesson)}</div>
            ${teacherHtml}
            ${locationHtml}
            <div class="schedule-item-footer"></div>
        </div>
    `;
}

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

async function renderCalendar() {
    const calDir = window._calDir;
    window._calDir = null;

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

    let startStr = getLocalDateStr(currentBaseDate);
    let endD = new Date(currentBaseDate);
    endD.setDate(endD.getDate() + 6);
    let endStr = getLocalDateStr(endD);
    let realTodayStr = getLocalDateStr(new Date());

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
        let d = new Date(currentBaseDate);
        d.setDate(d.getDate() + i);
        let dateStr = getLocalDateStr(d);
        let displayDate = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

        let isTodayClass = (dateStr === realTodayStr) ? "day-today" : "";
        let daySchedule = scheduleByDate.get(dateStr) || [];
        let customItems = getCustomItemsForDate(dateStr);
        let allItems = daySchedule.concat(customItems);

        let eventItems = allItems.filter(x => x.is_custom && x.is_event);
        let pairItems  = allItems.filter(x => !(x.is_custom && x.is_event));

        eventItems.sort(_sortItemsByTime);
        pairItems.sort(_sortItemsByTime);

        let eventsHtml = "";
        if (eventItems.length > 0) {
            eventsHtml = '<div class="day-events-block mt-2">';
            eventItems.forEach(ev => { eventsHtml += _renderEventCard(ev); });
            eventsHtml += '</div>';
        }

        let scheduleHtml = "";
        if (pairItems.length > 0) {
            let startTime = fixTime(pairItems[0].time_range.split(' - ')[0]);
            let endTime = fixTime(pairItems[pairItems.length - 1].time_range.split(' - ')[1]);
            let isExpanded = openDays.has(dateStr);
            let expandedClass = isExpanded ? ' expanded' : '';
            let arrowIcon = isExpanded ? '▲' : '▼';

            scheduleHtml += `
                <div class="schedule-summary shadow-sm" onclick="toggleSchedule('${dateStr}')">
                    🕒 Пары: ${startTime} - ${endTime} <span id="arrow-${dateStr}">${arrowIcon}</span>
                </div>
                <div id="schedule-details-${dateStr}"${expandedClass}>
                    <div class="schedule-details-inner">
            `;

            pairItems.forEach(item => {
                let origLesson = item.lesson;
                let subjectKey = item.is_custom ? origLesson : `${item.lesson} (${item.type_name})`;
                let safeSubjectKey = escapeJsString(subjectKey);
                let displayLesson = origLesson;
                let lessonLink = "";
                let displayTeacher = item.teacher || "";
                let displayLocation = item.location || "";
                let customName = '';

                if (!item.is_custom && cachedSubjectSettings[subjectKey]) {
                    if (cachedSubjectSettings[subjectKey].custom_name) {
                        customName = cachedSubjectSettings[subjectKey].custom_name;
                        displayLesson = customName;
                    }
                    if (cachedSubjectSettings[subjectKey].link) lessonLink = cachedSubjectSettings[subjectKey].link;
                    if (cachedSubjectSettings[subjectKey].teacher) displayTeacher = cachedSubjectSettings[subjectKey].teacher;
                    if (cachedSubjectSettings[subjectKey].location) displayLocation = cachedSubjectSettings[subjectKey].location;
                }

                let taskSubjectLabel;
                if (item.is_custom) taskSubjectLabel = item.lesson;
                else if (customName) taskSubjectLabel = `${customName} (${item.type_name})`;
                else taskSubjectLabel = subjectKey;
                let safeTaskSubject = escapeJsString(taskSubjectLabel);

                let lessonHtml = lessonLink
                    ? `<a href="${lessonLink}" target="_blank" class="text-decoration-none fw-bold" style="color: var(--accent);" title="${escapeHtml(origLesson)}">${escapeHtml(displayLesson)}</a>`
                    : `<span title="${escapeHtml(origLesson)}">${escapeHtml(displayLesson)}</span>`;

                if (!item.is_custom) {
                    lessonHtml += ` <span style="cursor:pointer; font-size: 0.9em; opacity: 0.4;" onclick="openSubjectSettings('${safeSubjectKey}')" title="Настроить предмет">⚙️</span>`;
                }

                let typeBadge = '';
                if (item.is_custom && item.is_event) {
                    typeBadge = `<span class="badge bg-success" style="font-size: 0.7em;">Событие</span>`;
                } else if (item.type_name) {
                    typeBadge = `<span class="badge bg-secondary" style="font-size: 0.7em;">${item.type_name}</span>`;
                }

                let editIconHtml = item.is_custom
                    ? `<span class="schedule-item-edit"
                            onclick="openCustomScheduleModal('${item.date}', ${item.custom_id})"
                            title="Редактировать">✏️</span>`
                    : '';

                let teacherHtml = (displayTeacher && showTeacher)
                    ? `<div class="schedule-item-teacher">${escapeHtml(displayTeacher)}</div>` : '';
                let locationHtml = (displayLocation && showLocation)
                    ? `<div class="schedule-item-location">${escapeHtml(displayLocation)}</div>` : '';

                let customStyle = item.is_custom
                    ? (item.is_event ? 'border-left: 3px solid var(--event-color);' : 'border-left: 3px solid var(--custom-pair-color);')
                    : 'border-left: 3px solid var(--accent);';

                scheduleHtml += `
                    <div class="schedule-item shadow-sm" style="${customStyle}">
                        <div class="schedule-item-top">
                            <span class="schedule-item-time">
                                <strong class="text-primary">${item.time_range}</strong>
                                ${editIconHtml}
                            </span>
                            <span class="add-task-btn" onclick="createTaskFromSchedule('${item.date}', '${safeTaskSubject}')">+ Заметка</span>
                        </div>
                        ${typeBadge ? `<div class="schedule-item-badge">${typeBadge}</div>` : ''}
                        <div class="schedule-item-title">${lessonHtml}</div>
                        ${teacherHtml}
                        ${locationHtml}
                        <div class="schedule-item-footer"></div>
                    </div>
                `;
            });
            scheduleHtml += `</div></div>`;
        } else if (eventItems.length === 0) {
            scheduleHtml = `<div class="empty-state-inline">
                <span class="empty-state-inline-icon">☕</span>
                <span>Свободный день</span>
            </div>`;
        }

        htmlParts.push(`
            <div class="day-col ${isTodayClass}" id="day-col-${dateStr}" ondragover="allowDrop(event)" ondrop="drop(event, '${dateStr}')">
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
        `);
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

function toggleSchedule(dateStr) {
    let details = document.getElementById(`schedule-details-${dateStr}`);
    let arrow = document.getElementById(`arrow-${dateStr}`);
    if (!details) return;
    const nowExpanded = details.classList.toggle('expanded');
    if (arrow) arrow.textContent = nowExpanded ? '▲' : '▼';

    // Пересчёт раскладки «+ Заметка» при развороте
    _layoutScheduleNotes();
}

function toggleExpandDay(dateStr) {
    let grid = document.querySelector('.calendar-grid');
    let col  = document.getElementById(`day-col-${dateStr}`);
    let btn  = document.querySelector(`#expand-btn-wrap-${dateStr} .day-expand-btn`);
    let headerEl = document.querySelector('.controls-header');
    let headerOffset = headerEl ? headerEl.offsetHeight + 25 : 90;

    function scrollToCol(alignTop) {
        let rect = col.getBoundingClientRect();
        let targetY = window.pageYOffset + rect.top - (alignTop ? headerOffset : 0);
        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    }

    if (col.classList.contains('fullscreen-day')) {
        col.classList.remove('fullscreen-day');
        grid.classList.remove('has-fullscreen');
        if (btn) {
            btn.classList.remove('is-expanded');
            let lbl = btn.querySelector('.day-expand-label');
            if (lbl) lbl.textContent = 'Развернуть';
        }
        expandedDayDateStr = null;
        let details = document.getElementById(`schedule-details-${dateStr}`);
        let arrow   = document.getElementById(`arrow-${dateStr}`);
        if (details) details.classList.remove('expanded');
        if (arrow)   arrow.textContent = "▼";
        rebalanceDayText(dateStr);
        _layoutScheduleNotes();
    } else {
        col.classList.add('fullscreen-day');
        grid.classList.add('has-fullscreen');
        if (btn) {
            btn.classList.add('is-expanded');
            let lbl = btn.querySelector('.day-expand-label');
            if (lbl) lbl.textContent = 'Свернуть';
        }
        expandedDayDateStr = dateStr;
        let details = document.getElementById(`schedule-details-${dateStr}`);
        let arrow   = document.getElementById(`arrow-${dateStr}`);
        if (details) details.classList.add('expanded');
        if (arrow) arrow.textContent = "▲";
        setTimeout(() => {
            scrollToCol(true);
            _layoutScheduleNotes();
        }, 60);
    }
}

function rebalanceDayText(dateStr) {
    let container = document.getElementById(`tasks-${dateStr}`);
    if (!container) return;
    let cards = Array.from(container.querySelectorAll('.task-card'));
    let wrap  = document.getElementById(`expand-btn-wrap-${dateStr}`);
    let col   = document.getElementById(`day-col-${dateStr}`);
    let isExpanded = col && col.classList.contains('fullscreen-day');

    if (cards.length === 0) {
        if (wrap) wrap.style.display = isExpanded ? 'block' : 'none';
        return;
    }

    let lengths = cards.map(card => {
        let fullEl = card.querySelector('.task-text-full');
        return fullEl ? fullEl.textContent.length : 0;
    });
    let totalLen = lengths.reduce((s, n) => s + n, 0);

    const SHOW_BTN_THRESHOLD = 50;
    let showButton = totalLen > SHOW_BTN_THRESHOLD || isExpanded;
    if (wrap) wrap.style.display = showButton ? 'block' : 'none';

    const SINGLE_NOTE_LIMIT = 50;
    const MULTI_TOTAL_LIMIT = 80;
    let shouldTrim = cards.length === 1 ? lengths[0] > SINGLE_NOTE_LIMIT : totalLen > MULTI_TOTAL_LIMIT;

    if (!shouldTrim) {
        cards.forEach(card => {
            let shortEl = card.querySelector('.task-text-short');
            let fullEl  = card.querySelector('.task-text-full');
            if (shortEl && fullEl) { shortEl.textContent = fullEl.textContent; shortEl.style.opacity = ''; }
        });
        return;
    }

    if (cards.length === 1) {
        let shortEl = cards[0].querySelector('.task-text-short');
        let fullEl  = cards[0].querySelector('.task-text-full');
        if (shortEl && fullEl) shortEl.textContent = fullEl.textContent.slice(0, SINGLE_NOTE_LIMIT).trimEnd() + '…';
        return;
    }

    const TOTAL_BUDGET = MULTI_TOTAL_LIMIT;
    let share = Math.floor(TOTAL_BUDGET / cards.length);
    let remainder = TOTAL_BUDGET - share * cards.length;

    cards.forEach((card, idx) => {
        let shortEl = card.querySelector('.task-text-short');
        let fullEl  = card.querySelector('.task-text-full');
        if (!shortEl || !fullEl) return;
        let full = fullEl.textContent;
        let limit = share + (idx < remainder ? 1 : 0);
        shortEl.textContent = full.length <= limit ? full : full.slice(0, limit).trimEnd() + '…';
    });
}

// Пересчёт при изменении размера окна — ширина колонок меняется,
// значит «+ Заметка» может помещаться или не помещаться по-новому.
window.addEventListener('resize', () => {
    if (typeof _layoutScheduleNotes === 'function') _layoutScheduleNotes();
});