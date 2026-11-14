// Взаимодействие с днём: раскрыть/свернуть пары, развернуть день,
// перебалансировать длинный текст заметок.
// Работает в паре с calendar.js и calendar-cards.js.

// ============================================================
//  РАСКРЫТИЕ СПИСКА ПАР В КОЛОНКЕ
// ============================================================

function toggleSchedule(dateStr) {
    let details = document.getElementById(`schedule-details-${dateStr}`);
    let arrow = document.getElementById(`arrow-${dateStr}`);
    if (!details) return;
    const nowExpanded = details.classList.toggle('expanded');
    if (arrow) arrow.textContent = nowExpanded ? '▲' : '▼';

    // Пересчёт раскладки «+ Заметка» при развороте
    _layoutScheduleNotes();
}

// ============================================================
//  РАЗВОРОТ ДНЯ НА ВСЮ ШИРИНУ
// ============================================================

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

// ============================================================
//  БАЛАНСИРОВКА ТЕКСТА ЗАМЕТОК В КОЛОНКЕ
// ------------------------------------------------------------
//  Если заметки не помещаются — режем их до N символов и
//  показываем кнопку «Развернуть». В fullscreen-режиме
//  показывает полный текст.
// ============================================================

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