// Кастомное расписание (события и пары) + настройки предметов.

const classTimes = {
    "1": {start: "08:30", end: "10:00"},
    "2": {start: "10:10", end: "11:40"},
    "3": {start: "11:50", end: "13:20"},
    "4": {start: "14:00", end: "15:30"},
    "5": {start: "15:40", end: "17:10"},
    "6": {start: "17:20", end: "18:50"},
    "7": {start: "19:00", end: "20:30"},
    "8": {start: "20:40", end: "22:10"}
};

function updateTimeFromClassNum() {
    let num = document.getElementById('csClassNum').value;
    if (classTimes[num]) {
        document.getElementById('csTimeStart').value = classTimes[num].start;
        document.getElementById('csTimeEnd').value   = classTimes[num].end;
    }
}

function toggleCsFields() {
    let isEvent = document.getElementById('csTypeEvent').checked;
    document.getElementById('csClassFields').style.display = isEvent ? 'none' : 'block';
    document.getElementById('csLessonLabel').textContent = isEvent ? 'Текст события' : 'Название предмета';

    let selectNum   = document.getElementById('csClassNum');
    let timeWrapper = document.getElementById('csTimeWrapper');

    if (isEvent) {
        selectNum.style.display = 'none';
        timeWrapper.style.display = 'flex';
    } else {
        selectNum.style.display = 'block';
        timeWrapper.style.display = 'flex';
        updateTimeFromClassNum();
    }
}

function checkScheduleConflict(baseDateStr, timeRange, recurrence, ignoreCustomId = null) {
    let datesToCheck = [];
    let [y, m, d] = baseDateStr.split('-');
    let currD = new Date(y, m - 1, d);

    if (recurrence === 'none') {
        datesToCheck.push(baseDateStr);
    } else {
        let limit = recurrence === 'weekly' ? 25 : 12;
        for (let i = 0; i < limit; i++) {
            datesToCheck.push(getLocalDateStr(new Date(currD)));
            currD.setDate(currD.getDate() + (recurrence === 'weekly' ? 7 : 14));
        }
    }

    for (let checkDate of datesToCheck) {
        let dayConflicts = [];
        let daySched = cachedSchedule.filter(x => x.date === checkDate);
        for (let item of daySched) if (isTimeOverlap(timeRange, item.time_range)) dayConflicts.push(`парой "${item.lesson}"`);

        let customSched = getCustomItemsForDate(checkDate);
        for (let item of customSched) {
            if (item.custom_id == ignoreCustomId) continue;
            if (isTimeOverlap(timeRange, item.time_range)) {
                let kind = item.is_event ? 'событием' : 'кастомной парой';
                dayConflicts.push(`${kind} "${item.lesson}"`);
            }
        }

        if (dayConflicts.length === 1) return { conflict: true, msg: `Внимание! На ${checkDate} обнаружено пересечение с ${dayConflicts[0]}.` };
        if (dayConflicts.length > 1) return { conflict: true, msg: `Внимание! На ${checkDate} присутствуют многочисленные пересечения.` };
    }
    return null;
}

function askRecurrenceMode(actionTitle, targetDate) {
    return new Promise((resolve) => {
        document.getElementById('recurrenceActionTitle').textContent = actionTitle;
        let btnSingle = document.getElementById('btnRecurrenceSingle');
        let btnAll = document.getElementById('btnRecurrenceAll');
        btnSingle.textContent = `Только на этой неделе (${targetDate})`;

        let modalEl = document.getElementById('recurrenceActionModal');
        let modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

        let newBtnSingle = btnSingle.cloneNode(true);
        btnSingle.parentNode.replaceChild(newBtnSingle, btnSingle);
        let newBtnAll = btnAll.cloneNode(true);
        btnAll.parentNode.replaceChild(newBtnAll, btnAll);

        let resolved = false;
        newBtnSingle.onclick = () => { resolved = true; modalEl.addEventListener('hidden.bs.modal', () => resolve("1"), { once: true }); modal.hide(); };
        newBtnAll.onclick = () => { resolved = true; modalEl.addEventListener('hidden.bs.modal', () => resolve("2"), { once: true }); modal.hide(); };
        modalEl.addEventListener('hidden.bs.modal', () => { if (!resolved) resolve(null); }, { once: true });
        modal.show();
    });
}

function openCustomScheduleModal(dateStr, itemId = null) {
    document.getElementById('csTargetDate').value = dateStr;
    let modalTitle = document.getElementById('customScheduleModalTitle');
    let delBtn = document.getElementById('csDeleteBtn');

    if (itemId) {
        let item = customScheduleItems.find(i => i.id === itemId);
        if (!item) return;
        document.getElementById('csId').value = item.id;
        document.getElementById('csBaseDate').value = item.base_date;
        modalTitle.textContent = 'Редактировать';
        delBtn.style.display = 'block';

        let timeParts = item.time_range.split('-');
        let tStart = timeParts[0].trim();
        let tEnd = timeParts[1].trim();
        document.getElementById('csTimeStart').value = tStart;
        document.getElementById('csTimeEnd').value = tEnd;

        if (item.is_event) {
            document.getElementById('csTypeEvent').checked = true;
        } else {
            document.getElementById('csTypeClass').checked = true;
            for (let num in classTimes) {
                if (classTimes[num].start === tStart && classTimes[num].end === tEnd) {
                    document.getElementById('csClassNum').value = num;
                    break;
                }
            }
        }

        document.getElementById('csLesson').value = item.lesson;
        document.getElementById('csTypeName').value = item.type_name || '';
        document.getElementById('csTeacher').value = item.teacher || '';
        document.getElementById('csLocation').value = item.location || '';
        document.getElementById('csRecurrence').value = item.recurrence || 'none';
    } else {
        document.getElementById('csId').value = '';
        document.getElementById('csBaseDate').value = dateStr;
        modalTitle.textContent = 'Добавить в расписание';
        delBtn.style.display = 'none';
        document.getElementById('csTypeEvent').checked = true;

        let now = new Date();
        let h = now.getHours();
        document.getElementById('csTimeStart').value = String(h).padStart(2, '0') + ':00';
        document.getElementById('csTimeEnd').value   = String((h + 1) % 24).padStart(2, '0') + ':00';

        document.getElementById('csLesson').value = '';
        document.getElementById('csTypeName').value = '';
        document.getElementById('csTeacher').value = '';
        document.getElementById('csLocation').value = '';
        document.getElementById('csRecurrence').value = 'none';
    }
    toggleCsFields();

    let modalEl = document.getElementById('customScheduleModal');
    let modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
}

async function saveCustomSchedule() {
    let group = document.getElementById('groupSelect').value.trim();
    let id = document.getElementById('csId').value;
    let targetDate = document.getElementById('csTargetDate').value;
    let start = document.getElementById('csTimeStart').value;
    let end = document.getElementById('csTimeEnd').value;

    if (start >= end) return alert("Ошибка: Начальное время должно быть строго раньше времени окончания!");
    let time_range = `${start} - ${end}`;

    let payload = {
        group: group,
        base_date: document.getElementById('csBaseDate').value,
        is_event: document.getElementById('csTypeEvent').checked ? 1 : 0,
        time_range: time_range,
        lesson: document.getElementById('csLesson').value.trim(),
        type_name: document.getElementById('csTypeName').value.trim(),
        teacher: document.getElementById('csTeacher').value.trim(),
        location: document.getElementById('csLocation').value.trim(),
        recurrence: document.getElementById('csRecurrence').value,
        exceptions: '[]'
    };

    if (!start || !end || !payload.lesson) return alert("Заполните время и название!");

    let conflict = checkScheduleConflict(payload.base_date, payload.time_range, payload.recurrence, id);
    if (conflict && !confirm(conflict.msg + "\n\nВсё равно сохранить?")) return;

    try {
        if (id) {
            let originalItem = customScheduleItems.find(i => i.id == id);
            if (originalItem && originalItem.recurrence !== 'none') {
                let mode = await askRecurrenceMode("Изменить событие", targetDate);
                if (mode === "1") {
                    let ex = JSON.parse(originalItem.exceptions || '[]');
                    if (!ex.includes(targetDate)) ex.push(targetDate);
                    await apiUpdateCustomSchedule(id, {...originalItem, exceptions: JSON.stringify(ex)});
                    payload.base_date = targetDate;
                    payload.recurrence = 'none';
                    await apiCreateCustomSchedule(payload);
                    let mainModal = bootstrap.Modal.getInstance(document.getElementById('customScheduleModal'));
                    if (mainModal) mainModal.hide();
                    await refreshCustomSchedule();
                    return;
                } else if (mode !== "2") return;
            }
            payload.exceptions = originalItem ? originalItem.exceptions : '[]';
            await apiUpdateCustomSchedule(id, payload);
        } else {
            await apiCreateCustomSchedule(payload);
        }
    } catch (e) { return alert("Не удалось сохранить: " + e.message); }

    let mainModal = bootstrap.Modal.getInstance(document.getElementById('customScheduleModal'));
    if (mainModal) mainModal.hide();
    await refreshCustomSchedule();
}

async function deleteCustomSchedule() {
    let id = document.getElementById('csId').value;
    let targetDate = document.getElementById('csTargetDate').value;
    let originalItem = customScheduleItems.find(i => i.id == id);

    if (originalItem && originalItem.recurrence !== 'none') {
        let mode = await askRecurrenceMode("Удалить событие", targetDate);
        if (mode === "1") {
            let ex = JSON.parse(originalItem.exceptions || '[]');
            if (!ex.includes(targetDate)) ex.push(targetDate);
            await apiUpdateCustomSchedule(id, {...originalItem, exceptions: JSON.stringify(ex)});
            let mainModal = bootstrap.Modal.getInstance(document.getElementById('customScheduleModal'));
            if (mainModal) mainModal.hide();
            await refreshCustomSchedule();
            return;
        } else if (mode !== "2") return;
    } else {
        if (!confirm('Удалить этот элемент?')) return;
    }

    try { await apiDeleteCustomSchedule(id); } catch (e) { return alert("Не удалось удалить"); }

    let mainModal = bootstrap.Modal.getInstance(document.getElementById('customScheduleModal'));
    if (mainModal) mainModal.hide();
    await refreshCustomSchedule();
}

// v3.6.8: прямое обновление панели событий миникалендаря.
// Раньше цепочка шла через renderCalendar → renderMiniCalendar,
// но в некоторых сценариях (виджет свёрнут или вне видимости)
// обновление терялось. Теперь вызываем явно.
async function refreshCustomSchedule() {
    let group = document.getElementById('groupSelect').value.trim();
    try { customScheduleItems = await apiLoadCustomSchedule(group); }
    catch (e) { customScheduleItems = []; }
    renderCalendar();
    if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
}

// --- Настройки предметов ---

async function fetchSubjectSettings() {
    try { cachedSubjectSettings = await apiLoadSubjects(); }
    catch (e) { cachedSubjectSettings = {}; }
}

function openSubjectSettings(origLesson) {
    document.getElementById('origSubjectName').value = origLesson;
    document.getElementById('subjectOrigNameDisplay').textContent = origLesson;

    let s = cachedSubjectSettings[origLesson] || {};
    document.getElementById('subjectCustomName').value = s.custom_name || "";
    document.getElementById('subjectLink').value       = s.link || "";
    document.getElementById('subjectTeacher').value    = s.teacher || "";
    document.getElementById('subjectLocation').value   = s.location || "";

    new bootstrap.Modal(document.getElementById('subjectSettingsModal')).show();
}

async function saveSubjectSettings() {
    let payload = {
        subject: document.getElementById('origSubjectName').value,
        custom_name: document.getElementById('subjectCustomName').value.trim(),
        link: document.getElementById('subjectLink').value.trim(),
        teacher: document.getElementById('subjectTeacher').value.trim(),
        location: document.getElementById('subjectLocation').value.trim()
    };

    try { await apiSaveSubject(payload); } catch (e) { return alert("Не удалось сохранить"); }

    let modalEl = document.getElementById('subjectSettingsModal');
    let modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    await fetchSubjectSettings();
    renderCalendar();
}