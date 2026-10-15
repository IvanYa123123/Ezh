// Навигация по неделям + сброс вертикального дня при смене недели.

const _WEEK_PARITY_ANCHOR_MS = Date.UTC(2020, 0, 6);

function _weekParityLabel(weekDate) {
    const d = new Date(Date.UTC(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate()));
    const days = Math.floor((d - _WEEK_PARITY_ANCHOR_MS) / 86400000);
    const weeks = Math.floor(days / 7);

    return (weeks % 2 === 0)
        ? { label: 'Ч',  cls: 'week-even', title: 'Чётная неделя' }
        : { label: 'НЧ', cls: 'week-odd',  title: 'Нечётная неделя' };
}

function updateWeekDropdown() {
    let menu = document.getElementById("weekDropdownMenu");
    let btn = document.getElementById("weekDropdownBtn");
    if (!menu || !btn) return;
    menu.innerHTML = "";

    let realBase = new Date();
    realBase.setDate(realBase.getDate() - (realBase.getDay() === 0 ? 6 : realBase.getDay() - 1));
    realBase.setHours(0, 0, 0, 0);

    let currBase = new Date(currentBaseDate);
    currBase.setHours(0, 0, 0, 0);
    let currentOffset = Math.round((currBase - realBase) / (7 * 24 * 60 * 60 * 1000));

    for (let i = -20; i <= 20; i++) {
        let d = new Date(realBase);
        d.setDate(d.getDate() + (i * 7));
        let endD = new Date(d);
        endD.setDate(endD.getDate() + 6);
        let label = `${d.toLocaleDateString('ru-RU', {day:'numeric', month:'short'})} - ${endD.toLocaleDateString('ru-RU', {day:'numeric', month:'short'})}`;
        if (i === 0) label = `🏠 Текущая: ${label}`;

        const parity = _weekParityLabel(d);

        let li = document.createElement('li');
        let a = document.createElement('a');
        a.className = 'dropdown-item week-item' + (i === currentOffset ? ' active' : '');
        a.href = '#';
        a.title = parity.title;
        a.innerHTML = `<span class="week-item-label">${label}</span>
                       <span class="week-badge ${parity.cls}">${parity.label}</span>`;
        a.onclick = (e) => { e.preventDefault(); jumpToWeek(i); };
        li.appendChild(a);
        menu.appendChild(li);
    }

    let dBtn = new Date(realBase);
    dBtn.setDate(dBtn.getDate() + (currentOffset * 7));
    let endDBtn = new Date(dBtn);
    endDBtn.setDate(endDBtn.getDate() + 6);
    const btnParity = _weekParityLabel(dBtn);
    btn.innerHTML = `📅 ${dBtn.toLocaleDateString('ru-RU', {day:'numeric', month:'short'})} - ${endDBtn.toLocaleDateString('ru-RU', {day:'numeric', month:'short'})} <span class="week-badge ${btnParity.cls}">${btnParity.label}</span>`;

    btn.addEventListener('shown.bs.dropdown', () => {
        setTimeout(() => {
            let active = menu.querySelector('.dropdown-item.active');
            if (active) active.scrollIntoView({ block: 'center' });
        }, 30);
    }, { once: true });
}

function jumpToWeek(offsetVal) {
    let realBase = new Date();
    realBase.setDate(realBase.getDate() - (realBase.getDay() === 0 ? 6 : realBase.getDay() - 1));
    currentBaseDate = new Date(realBase);
    currentBaseDate.setDate(currentBaseDate.getDate() + (parseInt(offsetVal) * 7));
    if (expandedDayDateStr !== null) expandedDayDateStr = getLocalDateStr(currentBaseDate);
    if (typeof _verticalDayOffset !== 'undefined') _verticalDayOffset = null;
    renderCalendar();
    if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
}

function goToToday() {
    let realTodayStr = getLocalDateStr(new Date());
    currentBaseDate = new Date();
    currentBaseDate.setDate(currentBaseDate.getDate() - (currentBaseDate.getDay() === 0 ? 6 : currentBaseDate.getDay() - 1));
    if (expandedDayDateStr !== null) expandedDayDateStr = realTodayStr;
    if (typeof _verticalDayOffset !== 'undefined') _verticalDayOffset = null;
    renderCalendar();
    if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
}

function changeWeek(offset) {
    window._calDir = offset > 0 ? 'right' : 'left';
    currentBaseDate.setDate(currentBaseDate.getDate() + (offset * 7));
    if (expandedDayDateStr !== null) expandedDayDateStr = getLocalDateStr(currentBaseDate);
    if (typeof _verticalDayOffset !== 'undefined') _verticalDayOffset = null;
    renderCalendar();
    if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
}