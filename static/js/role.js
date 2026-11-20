// Режим работы: студент или преподаватель.
// Выбор хранится в localStorage и применяется при загрузке страницы.

const EZH_ROLE_KEY = 'ezhUserRole';
const EZH_TEACHER_SLUG_KEY = 'ezhTeacherSlug';
const EZH_TEACHER_NAME_KEY = 'ezhTeacherName';

let _roleTeachers = null;
let _roleTeacherSelected = null;

function getEzhTeacher() {
    return {
        slug: localStorage.getItem(EZH_TEACHER_SLUG_KEY) || '',
        name: localStorage.getItem(EZH_TEACHER_NAME_KEY) || ''
    };
}

function saveEzhTeacher(slug, name) {
    localStorage.setItem(EZH_TEACHER_SLUG_KEY, slug || '');
    localStorage.setItem(EZH_TEACHER_NAME_KEY, name || '');
}

// Приводит ответ /api/teacher_schedule к формату главного календаря.
function teacherScheduleItems(raw) {
    const t = getEzhTeacher();
    return (Array.isArray(raw) ? raw : []).map(item => Object.assign({}, item, {
        subgroup: 0,
        teacher: t.name || item.teacher || ''
    }));
}

function getEzhRole() {
    const role = localStorage.getItem(EZH_ROLE_KEY);
    return role === 'teacher' ? 'teacher' : (role === 'student' ? 'student' : '');
}

function isTeacherRole() {
    return getEzhRole() === 'teacher';
}

function chooseUserRole(role) {
    if (role === 'teacher') { openTeacherRolePicker(); return; }
    if (role !== 'student') return;
    localStorage.setItem(EZH_ROLE_KEY, role);
    const modalEl = document.getElementById('roleSelectModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
    location.reload();
}

async function openTeacherRolePicker() {
    if (typeof bootstrap === 'undefined') return;
    const roleEl = document.getElementById('roleSelectModal');
    const modalEl = document.getElementById('roleTeacherModal');
    if (!modalEl) return;

    const showPicker = function () {
        bootstrap.Modal.getOrCreateInstance(modalEl, {
            backdrop: 'static', keyboard: false
        }).show();
        setTimeout(function () {
            const inp = document.getElementById('roleTeacherInput');
            if (inp) inp.focus();
        }, 250);
    };

    if (roleEl && roleEl.classList.contains('show')) {
        const rm = bootstrap.Modal.getInstance(roleEl);
        roleEl.addEventListener('hidden.bs.modal', showPicker, { once: true });
        if (rm) rm.hide();
    } else {
        showPicker();
    }

    _roleTeacherSelected = null;
    const confirmBtn = document.getElementById('roleTeacherConfirm');
    if (confirmBtn) confirmBtn.disabled = true;

    if (_roleTeachers) { renderRoleTeachers(''); return; }
    const hint = document.getElementById('roleTeacherHint');
    if (hint) hint.textContent = 'Загрузка списка…';
    try {
        const resp = await apiFetch('/api/teachers');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const raw = await resp.json();
        _roleTeachers = (Array.isArray(raw) ? raw : [])
            .filter(t => t && t.slug && t.name)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    } catch (e) {
        console.error('[role] teachers load failed', e);
        _roleTeachers = [];
        if (hint) hint.textContent = 'Не удалось загрузить список. Проверьте соединение.';
    }
    renderRoleTeachers('');
}

function _roleTeacherMatch(name, query) {
    const n = String(name || '').toLowerCase().replace(/ё/g, 'е');
    const q = String(query || '').toLowerCase().replace(/ё/g, 'е').trim();
    if (!q) return true;
    return q.split(/\s+/).every(part => n.includes(part));
}

function renderRoleTeachers(query) {
    const list = document.getElementById('roleTeacherList');
    const hint = document.getElementById('roleTeacherHint');
    if (!list) return;
    if (!_roleTeachers) _roleTeachers = [];
    const matches = _roleTeachers.filter(t => _roleTeacherMatch(t.name, query)).slice(0, 60);
    list.innerHTML = '';
    if (!matches.length) {
        if (hint) hint.textContent = query ? 'Никого не найдено. Уточните фамилию.' : 'Список пуст.';
        return;
    }
    if (hint) hint.textContent = query ? `Найдено: ${matches.length}` : `Выберите себя из списка (${_roleTeachers.length})`;
    matches.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'role-teacher-item';
        btn.dataset.slug = t.slug;
        btn.dataset.name = t.name;
        btn.textContent = t.name;
        btn.onclick = () => selectRoleTeacher(t.slug, t.name, btn);
        list.appendChild(btn);
    });
}

function filterRoleTeachers(value) {
    renderRoleTeachers(value);
}

function selectRoleTeacher(slug, name, btn) {
    _roleTeacherSelected = { slug, name };
    document.querySelectorAll('#roleTeacherList .role-teacher-item').forEach(el => {
        el.classList.toggle('selected', el === btn);
    });
    const confirmBtn = document.getElementById('roleTeacherConfirm');
    if (confirmBtn) confirmBtn.disabled = false;
    const hint = document.getElementById('roleTeacherHint');
    if (hint) hint.textContent = 'Выбрано: ' + name;
}

function confirmTeacherRole() {
    if (!_roleTeacherSelected || !_roleTeacherSelected.slug) return;
    saveEzhTeacher(_roleTeacherSelected.slug, _roleTeacherSelected.name);
    localStorage.setItem(EZH_ROLE_KEY, 'teacher');
    location.reload();
}

function changeUserRole() {
    if (!confirm('Сменить режим работы? Страница будет перезагружена.')) return;
    localStorage.removeItem(EZH_ROLE_KEY);
    location.reload();
}

function _setHidden(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.style.display = hidden ? 'none' : '';
}

function applyUserRole() {
    const role = getEzhRole();
    if (!role) return;

    const teacher = role === 'teacher';
    document.body.classList.toggle('role-teacher', teacher);
    document.body.classList.toggle('role-student', !teacher);
    window.ezhUserRole = role;

    const label = document.getElementById('currentRoleLabel');
    if (label) label.textContent = teacher ? 'Преподаватель' : 'Студент';

    // Вместо группы у преподавателя — его ФИО.
    const displayEl = document.getElementById('groupDisplay');
    if (displayEl) {
        const t = getEzhTeacher();
        if (teacher) {
            displayEl.textContent = t.name || 'Выберите ФИО';
            displayEl.classList.toggle('group-display-empty', !t.name);
            displayEl.title = 'Ваше ФИО — нажмите, чтобы изменить';
            displayEl.onclick = function () { openTeacherRolePicker(); };
        } else {
            displayEl.onclick = function () { openSettingsModal(); };
        }
    }
    _setHidden('groupSettingsGroup', teacher);
    const subgroupEl = document.getElementById('subgroupSelect');
    if (subgroupEl) subgroupEl.style.display = 'none';

    // В режиме преподавателя та же настройка показывает группы студентов.
    const teacherLabel = document.getElementById('settingsTeacherLabel');
    if (teacherLabel) {
        teacherLabel.textContent = teacher ? 'Группа студентов' : 'ФИО преподавателей';
    }

    // Настройки: у преподавателя нет друзей и Pro-режима.
    const proGroup = document.getElementById('proSettingsGroup');
    if (proGroup) proGroup.style.display = teacher ? 'none' : '';
    const friendsSetting = document.getElementById('settingsToggleFriendsSection');
    if (friendsSetting) {
        const row = friendsSetting.closest('label');
        if (row) row.style.display = teacher ? 'none' : '';
    }
    const separateSetting = document.getElementById('settingsToggleSeparateFriendsTeachers');
    if (separateSetting) {
        const row = separateSetting.closest('label');
        if (row) row.style.display = teacher ? 'none' : '';
    }

    // Настройки виджетов, которых у преподавателя нет.
    ['settingsToggleWidgetLabs', 'settingsToggleWidgetSuggestions', 'settingsToggleWidgetPacing'].forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        const cell = cb.closest('.col-6') || cb.closest('label');
        if (cell) cell.style.display = teacher ? 'none' : '';
    });

    if (teacher) {
        _setHidden('friendsSection', true);

        // Про-режим и его виджеты преподавателю не нужны.
        document.querySelectorAll('.pro-widget').forEach(el => { el.style.display = 'none'; });
        _setHidden('widgetLabsCard', true);
        _setHidden('widgetPacingCard', true);
        _setHidden('widgetSuggestionsCard', true);
        _setHidden('app-mode-badge', true);

        if (typeof setProMode === 'function') {
            try { setProMode(false); } catch (e) { console.error(e); }
        }

        // В разделе преподавателей кнопка называется «коллега».
        document.querySelectorAll('button[onclick="showAddTeacherModal()"]').forEach(btn => {
            btn.textContent = '+ Добавить коллегу';
        });
        const addTeacherTitle = document.querySelector('#addTeacherModal .modal-title');
        if (addTeacherTitle) addTeacherTitle.textContent = '🎓 Добавить коллегу';
        const teacherInput = document.getElementById('teacherAddInput');
        if (teacherInput) teacherInput.placeholder = 'Фамилия, имя или отчество коллеги';

        if (typeof showTeachersSection !== 'undefined') showTeachersSection = true;
        if (typeof separateFriendsTeachers !== 'undefined') separateFriendsTeachers = true;
        if (typeof friendsTeachersTab !== 'undefined') friendsTeachersTab = 'teachers';
        if (typeof applyFriendsTeachersVisibility === 'function') {
            try { applyFriendsTeachersVisibility(); } catch (e) { console.error(e); }
        }

        // Вкладки «Коллеги ↔ Аудитория» доступны только преподавателю.
        const switchToRoom = document.getElementById('switchTabToRoomBtn');
        if (switchToRoom) switchToRoom.style.display = '';
        const roomToTeachers = document.getElementById('switchRoomToTeachersBtn');
        if (roomToTeachers) roomToTeachers.style.display = '';
        _setHidden('roomSection', false);
    } else {
        _setHidden('widgetLabsCard', false);
        _setHidden('widgetPacingCard', false);
        _setHidden('widgetSuggestionsCard', false);
        _setHidden('app-mode-badge', false);
        _setHidden('roomSection', true);
        const switchToRoom = document.getElementById('switchTabToRoomBtn');
        if (switchToRoom) switchToRoom.style.display = 'none';
    }

    if (typeof applyWidgetVisibility === 'function') {
        try { applyWidgetVisibility(); } catch (e) { console.error(e); }
    }
    if (typeof initRoomsSection === 'function') {
        try { initRoomsSection(); } catch (e) { console.error(e); }
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const role = getEzhRole();

    // Отмена выбора ФИО возвращает к выбору роли.
    const teacherModalEl = document.getElementById('roleTeacherModal');
    if (teacherModalEl) {
        teacherModalEl.addEventListener('hidden.bs.modal', function () {
            if (getEzhRole()) return;
            const roleModalEl = document.getElementById('roleSelectModal');
            if (roleModalEl && typeof bootstrap !== 'undefined') {
                bootstrap.Modal.getOrCreateInstance(roleModalEl, {
                    backdrop: 'static', keyboard: false
                }).show();
            }
        });
    }

    if (!role) {
        const modalEl = document.getElementById('roleSelectModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            bootstrap.Modal.getOrCreateInstance(modalEl, {
                backdrop: 'static',
                keyboard: false
            }).show();
        }
        return;
    }
    applyUserRole();
    if (role === 'teacher') {
        const t = getEzhTeacher();
        if (!t.slug) {
            setTimeout(openTeacherRolePicker, 300);
        }
    }
});
