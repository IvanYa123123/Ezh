// Навигация по неделям + сброс вертикального дня при смене недели.
//
// v3.18.0:
//   • Кнопка недели теперь чередует две подписи: диапазон дат
//     и номер академической недели. Период — 7.5 секунды.
//     Академический номер считается от старта семестра:
//       сентябрь–декабрь → 1 сентября
//       февраль–июнь     → 7 февраля
//       январь           → 1 сентября прошлого года
//       июль–август      → 1 сентября текущего (показывать будет «1 неделя»)
//     Пример: 26 октября 2026 — это 9 неделя осеннего семестра.

const _WEEK_PARITY_ANCHOR_MS = Date.UTC(2020, 0, 6);

let _weekDropdownListenerAdded = false;
let _weekLabelInterval = null;
let _weekLabelPhase = 0;

function _weekParityLabel(weekDate) {
    const d = new Date(Date.UTC(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate()));
    const days = Math.floor((d - _WEEK_PARITY_ANCHOR_MS) / 86400000);
    const weeks = Math.floor(days / 7);

    return (weeks % 2 === 0)
        ? { label: 'Ч',  cls: 'week-even', title: 'Чётная неделя' }
        : { label: 'НЧ', cls: 'week-odd',  title: 'Нечётная неделя' };
}

function _getAcademicWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const y = d.getFullYear();
    const m = d.getMonth();

    let start;
    if (m >= 8) {              // сентябрь–декабрь
        start = new Date(y, 8, 1);
    } else if (m >= 1 && m <= 5) { // февраль–июнь
        start = new Date(y, 1, 7);
    } else if (m === 0) {      // январь — ещё осенний семестр
        start = new Date(y - 1, 8, 1);
    } else {                   // июль–август — хвост прошлого учебного года
        start = new Date(y - 1, 8, 1);
    }
    start.setHours(0, 0, 0, 0);

    const startDow = start.getDay() || 7;
    start.setDate(start.getDate() - (startDow - 1));

    const dateDow = d.getDay() || 7;
    d.setDate(d.getDate() - (dateDow - 1));

    const weeks = Math.round((d - start) / (7 * 24 * 60 * 60 * 1000));
    // Раньше для июля–августа start был в будущем и номер уходил
    // в минус («-20 неделя»). Теперь это конец прошлого года, а
    // минимум — первая неделя.
    return Math.max(1, weeks + 1);
}

function _renderWeekLabel() {
    const btn = document.getElementById('weekDropdownBtn');
    if (!btn) return;

    const dBtn = new Date(currentBaseDate);
    dBtn.setHours(0, 0, 0, 0);
    const endDBtn = new Date(dBtn);
    endDBtn.setDate(endDBtn.getDate() + 6);

    const parity = _weekParityLabel(dBtn);

    let mainText;
    if (_weekLabelPhase === 1) {
        const weekNum = _getAcademicWeekNumber(dBtn);
        mainText = `${weekNum} неделя`;
    } else {
        mainText = `${dBtn.toLocaleDateString('ru-RU', {day:'numeric', month:'short'})} - ${endDBtn.toLocaleDateString('ru-RU', {day:'numeric', month:'short'})}`;
    }

    btn.innerHTML = `📅 ${mainText} <span class="week-badge ${parity.cls}" title="${parity.title}">${parity.label}</span>`;
}

function startWeekLabelRotation() {
    if (_weekLabelInterval) clearInterval(_weekLabelInterval);
    _weekLabelPhase = 0;
    _renderWeekLabel();
    _weekLabelInterval = setInterval(() => {
        _weekLabelPhase = (_weekLabelPhase + 1) % 2;
        _renderWeekLabel();
    }, 7500);
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

    // Кнопку рисуем через общий рендерер, чтобы не терять фазу чередования.
    _renderWeekLabel();

    if (!_weekDropdownListenerAdded) {
        _weekDropdownListenerAdded = true;
        btn.addEventListener('shown.bs.dropdown', () => {
            setTimeout(() => {
                let active = menu.querySelector('.dropdown-item.active');
                if (active) active.scrollIntoView({ block: 'center' });
            }, 30);
        });
    }
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