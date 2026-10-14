// Навигация по календарю: заметки, события, стрелки.

function computeNextNoteDate(currentDateStr) {
    let sorted = [...taskDatesSet].sort();
    return sorted.find(d => d > currentDateStr) || null;
}
function computePrevNoteDate(currentDateStr) {
    let sorted = [...taskDatesSet].sort().reverse();
    return sorted.find(d => d < currentDateStr) || null;
}

function findNextEventDate(fromDateStr) {
    let [y, m, d] = fromDateStr.split('-').map(Number);
    let start = new Date(y, m - 1, d);
    for (let i = 1; i <= 730; i++) {
        let dt = new Date(start);
        dt.setDate(dt.getDate() + i);
        let dateStr = getLocalDateStr(dt);
        if (getCustomItemsForDate(dateStr).some(x => x.is_event)) return dateStr;
    }
    return null;
}
function findPrevEventDate(fromDateStr) {
    let [y, m, d] = fromDateStr.split('-').map(Number);
    let start = new Date(y, m - 1, d);
    for (let i = 1; i <= 730; i++) {
        let dt = new Date(start);
        dt.setDate(dt.getDate() - i);
        let dateStr = getLocalDateStr(dt);
        if (getCustomItemsForDate(dateStr).some(x => x.is_event)) return dateStr;
    }
    return null;
}

function navigateNote(fromDateStr, direction) {
    let target = direction > 0
        ? computeNextNoteDate(fromDateStr)
        : computePrevNoteDate(fromDateStr);
    if (target) jumpToDate(target);
}

function navigateEvent(fromDateStr, direction) {
    let target = direction > 0
        ? findNextEventDate(fromDateStr)
        : findPrevEventDate(fromDateStr);
    if (target) jumpToDate(target);
}

// ============================================================
//  СТРЕЛКИ ← →
// ------------------------------------------------------------
//  • День развёрнут (fullscreen-day) → шаг на 1 день.
//  • Иначе                          → шаг на неделю.
//  Вызывается из HTML вместо changeWeek.
// ============================================================

function navigatePrev() {
    if (expandedDayDateStr) _navigateDay(-1);
    else                    changeWeek(-1);
}
function navigateNext() {
    if (expandedDayDateStr) _navigateDay(1);
    else                    changeWeek(1);
}

function _navigateDay(offset) {
    window._calDir = offset > 0 ? 'right' : 'left';
    let [y, m, d] = expandedDayDateStr.split('-').map(Number);
    let target = new Date(y, m - 1, d);
    target.setDate(target.getDate() + offset);
    let targetStr = getLocalDateStr(target);

    let dow = target.getDay();
    if (dow === 0) dow = 7;
    let monday = new Date(target);
    monday.setDate(monday.getDate() - (dow - 1));

    currentBaseDate = monday;
    expandedDayDateStr = targetStr;
    renderCalendar();
    if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
}

function jumpToDate(dateStr) {
    let [y, m, d] = dateStr.split('-').map(Number);
    let target = new Date(y, m - 1, d);
    let dow = target.getDay();
    if (dow === 0) dow = 7;
    let monday = new Date(target);
    monday.setDate(monday.getDate() - (dow - 1));

    currentBaseDate = monday;
    expandedDayDateStr = dateStr;
    renderCalendar();

    setTimeout(() => {
        let el = document.getElementById(`day-col-${dateStr}`);
        if (!el) return;
        let headerEl = document.querySelector('.controls-header');
        let offset = headerEl ? headerEl.offsetHeight + 20 : 90;
        let top = window.pageYOffset + el.getBoundingClientRect().top - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 80);
}