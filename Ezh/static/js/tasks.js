// Заметки: создание, редактирование, цвета, drag-n-drop, undo.
// Обновление карточки — in-place, чтобы CSS-transition плавно менял
// border-left-color при переключении статуса.
//
// v3.6.1: после успешного apiUpdateTask дёргаем refreshMiniCalEvents(),
// чтобы панель заметок/событий справа от миникалендаря (в горизонтальном
// режиме) всегда была синхронна с данными в БД.

const _taskBlurTimers = {};

function toggleTaskInput(dateStr) {
    let wrap = document.getElementById(`task-input-wrap-${dateStr}`);
    let input = document.getElementById(`task-input-${dateStr}`);
    if (wrap.style.display === "none") {
        wrap.style.display = "block"; input.focus();
    } else { wrap.style.display = "none"; }
}

function handleNewTask(e, dateStr) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
}

function handleTaskBlur(dateStr) {
    if (_taskBlurTimers[dateStr]) {
        clearTimeout(_taskBlurTimers[dateStr]);
        delete _taskBlurTimers[dateStr];
    }
    const input = document.getElementById(`task-input-${dateStr}`);
    const wrap  = document.getElementById(`task-input-wrap-${dateStr}`);
    if (!input) return;
    const text = input.value.trim();
    if (text === '') { if (wrap) wrap.style.display = "none"; return; }
    input.value = '';
    _taskBlurTimers[dateStr] = setTimeout(() => {
        delete _taskBlurTimers[dateStr];
        createTask(dateStr, text, 'green');
        if (wrap) wrap.style.display = "none";
    }, 100);
}

function askTaskKind() {
    return new Promise((resolve) => {
        const modalEl = document.getElementById('taskKindModal');

        if (!modalEl || typeof bootstrap === 'undefined') {
            if (confirm('Создать заметку «Сделать»?\n\nOK — Сделать, Отмена — «Сдать».')) return resolve('do');
            if (confirm('Создать заметку «Сдать»?')) return resolve('submit');
            return resolve(null);
        }

        const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

        const btnDoOld     = document.getElementById('btnTaskKindDo');
        const btnSubmitOld = document.getElementById('btnTaskKindSubmit');

        const btnDo     = btnDoOld.cloneNode(true);
        const btnSubmit = btnSubmitOld.cloneNode(true);
        btnDoOld.parentNode.replaceChild(btnDo, btnDoOld);
        btnSubmitOld.parentNode.replaceChild(btnSubmit, btnSubmitOld);

        let resolved = false;
        const finish = (value) => {
            if (resolved) return;
            resolved = true;
            modalEl.addEventListener('hidden.bs.modal', () => resolve(value), { once: true });
            modal.hide();
        };

        btnDo.onclick     = () => finish('do');
        btnSubmit.onclick = () => finish('submit');

        modalEl.addEventListener('hidden.bs.modal', () => {
            if (!resolved) resolve(null);
        }, { once: true });

        modal.show();
    });
}

async function createTaskFromSchedule(date, subject) {
    const kind = await askTaskKind();
    if (!kind) return;
    const prefix = kind === 'do' ? 'Сделать: ' : 'Сдать: ';
    createTask(date, prefix + subject, 'orange');
}

async function createTask(date, text, status) {
    try {
        let data = await apiCreateTask({date, text, status});
        taskDatesSet.add(date);
        renderTask({id: data.id, date, text, status}, { animate: true });
        if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
        if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();

        const taskId = data.id;
        scheduleUndo('Заметка добавлена', async () => {
            try {
                await apiDeleteTask(taskId);
                const el = document.getElementById(`task-${taskId}`);
                if (el) { el.remove(); rebalanceDayText(date); }
                refreshTaskDates();
                if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
            } catch (e) { console.error(e); }
        });
    } catch (e) { console.error("createTask failed", e); }
}

function renderTask(task, options = {}) {
    const { animate = false, stagger = -1 } = options;
    const container = document.getElementById(`tasks-${task.date}`);
    if (!container) return;

    let div = document.getElementById(`task-${task.id}`);

    if (div) {
        if (div.parentElement !== container) {
            container.appendChild(div);
        }
        _updateTaskCard(div, task);
        rebalanceDayText(task.date);
        return;
    }

    div = _buildTaskCard(task);
    if (animate) div.classList.add('task-pop-in');
    if (stagger >= 0) div.style.animationDelay = `${Math.min(stagger * 45, 450)}ms`;
    container.appendChild(div);
    rebalanceDayText(task.date);
}

function _buildTaskCard(task) {
    let div = document.createElement('div');
    div.className = `task-card status-${task.status}`;
    div.id = `task-${task.id}`;
    div.draggable = true;

    if (task.status === 'completed') div.classList.add('task-completed');
    _applyOverdueClass(div, task);

    let spanText = document.createElement('div');
    spanText.className = 'task-text';
    let safeText = task.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    spanText.innerHTML = `<span class="task-text-short">${safeText}</span><span class="task-text-full">${safeText}</span>`;
    spanText.onclick = () => { if (task.status !== 'completed') toggleColor(task.id, task.status); };

    let actions = document.createElement('div');
    actions.className = 'task-actions';
    _fillTaskActions(actions, task);

    div.appendChild(spanText);
    div.appendChild(actions);
    div.ondragstart = (e) => { e.dataTransfer.setData("text/plain", JSON.stringify(task)); };
    return div;
}

function _fillTaskActions(actions, task) {
    actions.innerHTML = '';

    if (task.status !== 'completed') {
        const btnEdit = document.createElement('a');
        btnEdit.className = 'task-btn task-edit';
        btnEdit.innerHTML = '✏️';
        btnEdit.onclick = (e) => {
            e.stopPropagation();
            let newText = prompt("Изменить заметку:", task.text);
            if (newText && newText.trim() !== '') {
                task.text = newText.trim();
                updateTaskRequest(task);
            }
        };
        actions.appendChild(btnEdit);
    }

    const btnDel = document.createElement('a');
    btnDel.className = 'task-btn';
    if (task.status === 'completed') { btnDel.innerHTML = '🗑️'; }
    else { btnDel.innerHTML = '×'; btnDel.style.fontSize = '1.3em'; }
    btnDel.onclick = () => handleTaskDeleteClick(task);
    actions.appendChild(btnDel);
}

function _applyOverdueClass(div, task) {
    const todayStr = getLocalDateStr(new Date());
    const isOverdue = task.status !== 'completed' && task.date < todayStr;
    div.classList.toggle('task-overdue', isOverdue);
}

function _updateTaskCard(div, task) {
    div.classList.remove('status-green', 'status-orange', 'status-red');
    div.classList.add(`status-${task.status}`);
    div.classList.toggle('task-completed', task.status === 'completed');
    _applyOverdueClass(div, task);

    const safeText = task.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shortEl = div.querySelector('.task-text-short');
    const fullEl  = div.querySelector('.task-text-full');
    if (shortEl) shortEl.textContent = safeText;
    if (fullEl)  fullEl.textContent  = safeText;

    const actions = div.querySelector('.task-actions');
    if (actions) _fillTaskActions(actions, task);

    const spanText = div.querySelector('.task-text');
    if (spanText) {
        spanText.onclick = () => { if (task.status !== 'completed') toggleColor(task.id, task.status); };
    }

    div.ondragstart = (e) => { e.dataTransfer.setData("text/plain", JSON.stringify(task)); };
}

// v3.6.1: после успешного апдейта дёргаем refreshMiniCalEvents() —
// панель событий справа от миникалендаря обновится (задача могла
// стать completed, переехать на другую дату или переименоваться).
function updateTaskRequest(task) {
    renderTask(task);
    apiUpdateTask(task.id, {date: task.date, text: task.text, status: task.status})
        .then(() => {
            if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
        })
        .catch(e => console.error("updateTask failed", e));
}

function handleTaskDeleteClick(task) {
    if (task.status !== 'completed') {
        const prevStatus = task.status;
        task.status = 'completed';
        updateTaskRequest(task);

        scheduleUndo('Заметка завершена', () => {
            const restored = { ...task, status: prevStatus };
            updateTaskRequest(restored);
        });
    } else {
        const el = document.getElementById(`task-${task.id}`);
        if (!el) return;

        const snapshot = { date: task.date, text: task.text, status: task.status };
        _animateTaskRemoval(el, () => rebalanceDayText(task.date));
        apiDeleteTask(task.id)
            .then(() => {
                refreshTaskDates();
                if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
            })
            .catch(e => console.error(e));

        scheduleUndo('Заметка удалена', async () => {
            try {
                const resp = await apiCreateTask(snapshot);
                taskDatesSet.add(snapshot.date);
                renderTask({id: resp.id, date: snapshot.date, text: snapshot.text, status: snapshot.status}, { animate: true });
                if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
                if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
            } catch (e) { console.error(e); }
        });
    }
}

function _animateTaskRemoval(el, onDone) {
    el.style.pointerEvents = 'none';
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    void el.offsetWidth;
    el.style.opacity = '0';
    el.style.transform = 'scale(0.85)';
    setTimeout(() => {
        el.remove();
        if (typeof onDone === 'function') onDone();
    }, 200);
}

function toggleColor(id, currentStatus) {
    let taskElement = document.getElementById(`task-${id}`);
    if (!taskElement) return;
    let newStatus = currentStatus === 'green' ? 'orange' : (currentStatus === 'orange' ? 'red' : 'green');
    let fullEl = taskElement.querySelector('.task-text-full');
    let text = fullEl ? fullEl.textContent : '';
    let dateId = taskElement.parentElement.id.replace('tasks-', '');
    updateTaskRequest({id, date: dateId, text, status: newStatus});
}

function allowDrop(e) { e.preventDefault(); }

function drop(e, newDate) {
    e.preventDefault();
    let taskData = JSON.parse(e.dataTransfer.getData("text/plain"));
    if (taskData.date === newDate) return;
    let oldDate = taskData.date;

    const snapshot = { ...taskData };

    taskData.date = newDate;
    updateTaskRequest(taskData);
    setTimeout(() => rebalanceDayText(oldDate), 50);
    if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();

    scheduleUndo('Заметка перенесена', () => {
        const back = { ...snapshot, date: oldDate };
        updateTaskRequest(back);
        setTimeout(() => rebalanceDayText(newDate), 50);
        if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
    });
}

async function refreshTaskDates() {
    try {
        let dates = await apiLoadTaskDates();
        taskDatesSet = new Set(dates);
        if (typeof refreshMiniCalendar === 'function') refreshMiniCalendar();
        if (typeof refreshMiniCalEvents === 'function') refreshMiniCalEvents();
    } catch (e) { console.error("refreshTaskDates", e); }
}

function renderTasksStaggered(tasks) {
    if (!Array.isArray(tasks)) return;

    const byDate = {};
    tasks.forEach(t => {
        if (!byDate[t.date]) byDate[t.date] = [];
        byDate[t.date].push(t);
    });

    for (const date in byDate) {
        byDate[date].forEach((t, idx) => {
            renderTask(t, { stagger: idx });
        });
    }
}