let moodleStats = [];
let moodleStatsTimestamp = 0;
let moodleSemesterConfig = {};
try {
    const savedSemesterConfig = localStorage.getItem('moodleSemesterConfig');
    if (savedSemesterConfig) moodleSemesterConfig = JSON.parse(savedSemesterConfig) || {};
} catch (e) {
    console.error('[moodle-pro] broken semester config, resetting', e);
    try { localStorage.removeItem('moodleSemesterConfig'); } catch (_) {}
    moodleSemesterConfig = {};
}
let proSubjectChart = null;
let isMoodleRefreshing = false;
let moodleAbortController = null;

window.hasLoadedMoodleStats = false;

const MOODLE_PRO_ACTIVE_KEY = 'moodleProActivated';
const MOODLE_SYNC_ON_START_KEY = 'moodleSyncOnStart';
const MOODLE_ALL_DONE_KEY = 'moodleAllDoneCourses';
const MOODLE_ALL_DONE_BACKUP_KEY = 'moodleAllDoneBackup';

function _readJsonLocal(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function _writeJsonLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function getForcedDoneCourseIds() {
    const ids = _readJsonLocal(MOODLE_ALL_DONE_KEY, []);
    return Array.isArray(ids) ? ids.map(String) : [];
}

function isCourseForcedDone(course) {
    return !!course && getForcedDoneCourseIds().includes(String(course.id));
}

function setCourseForcedDone(courseId, forced) {
    const ids = new Set(getForcedDoneCourseIds());
    if (forced) ids.add(String(courseId));
    else ids.delete(String(courseId));
    _writeJsonLocal(MOODLE_ALL_DONE_KEY, [...ids]);
}

function getCourseSubjectKeys(course) {
    const keys = new Set();
    if (!course || typeof cachedSchedule === 'undefined' || !Array.isArray(cachedSchedule)) {
        return [];
    }
    const cleanCourse = (course.name || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
    if (!cleanCourse) return [];
    cachedSchedule.forEach(item => {
        if (item.type_name !== 'ЛЗ' && item.type_name !== 'ПЗ') return;
        const lessonName = (item.lesson || '').toLowerCase();
        if (lessonName && (cleanCourse.includes(lessonName) || lessonName.includes(cleanCourse))) {
            keys.add(`${item.lesson} (${item.type_name})`);
        }
    });
    return [...keys];
}

function _courseEffectiveStatus(course, act) {
    return isCourseForcedDone(course) ? 'Сдано' : act.status;
}

function isMoodleProPersisted() {
    try { return localStorage.getItem(MOODLE_PRO_ACTIVE_KEY) === '1'; } catch (e) { return false; }
}

function persistMoodlePro(isActive) {
    try {
        if (isActive) localStorage.setItem(MOODLE_PRO_ACTIVE_KEY, '1');
        else localStorage.removeItem(MOODLE_PRO_ACTIVE_KEY);
    } catch (e) {}
}

function isMoodleSyncOnStartEnabled() {
    try { return localStorage.getItem(MOODLE_SYNC_ON_START_KEY) === '1'; } catch (e) { return false; }
}

function syncMoodleSyncOnStartWarning() {
    const warning = document.getElementById('moodleSyncOnStartWarning');
    if (warning) warning.style.display = isMoodleSyncOnStartEnabled() ? '' : 'none';
}

function onMoodleSyncOnStartChanged(el) {
    const enabled = !!(el && el.checked);
    try { localStorage.setItem(MOODLE_SYNC_ON_START_KEY, enabled ? '1' : '0'); } catch (e) {}
    syncMoodleSyncOnStartWarning();
    if (enabled && typeof showUpdateNotification === 'function') {
        showUpdateNotification('⚠️ Частая синхронизация может привести к временной блокировке Moodle');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const persisted = isMoodleProPersisted();
    let statsRequested = false;
    if (persisted) {
        // Сразу показываем сохранённые данные, не дожидаясь проверки сессии.
        setProMode(true);
        loadMoodleStats(false);
        statsRequested = true;
    }
    try {
        const status = await apiGet('/api/moodle/status');
        const serverActive = !!(status && status.logged_in);
        if (serverActive) persistMoodlePro(true);
        const active = persisted || serverActive;
        setProMode(active);
        if (active) {
            if (!statsRequested) await loadMoodleStats(false);

            // Автосинхронизация — только если пользователь включил её
            // в настройках. По умолчанию выключена.
            if (isMoodleSyncOnStartEnabled() && !sessionStorage.getItem('moodle_bg_refreshed')) {
                sessionStorage.setItem('moodle_bg_refreshed', '1');
                setTimeout(() => {
                    if (!isMoodleSyncOnStartEnabled()) return;
                    console.log('[moodle] starting background sync after 10s delay');
                    loadMoodleStats(true, true);
                }, 10000);
            }
        }
    } catch (e) {
        // Сервер недоступен (нет сети/таймаут) — Pro остаётся включённым,
        // показываем последние сохранённые данные из кэша.
        if (persisted) {
            setProMode(true);
            if (!statsRequested) loadMoodleStats(false);
        }
    }
});

async function openMoodleModal() {
    const modalEl = document.getElementById('moodleModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();

    // Сразу показываем сохранённые данные, не дожидаясь проверки сессии.
    if (window.isProActive || isMoodleProPersisted()) {
        showMoodleStatsView();
        loadMoodleStats(false);
    } else {
        showMoodleLoginView();
    }

    try {
        const status = await apiGet('/api/moodle/status');
        if (status.logged_in) {
            persistMoodlePro(true);
            setProMode(true);
            showMoodleStatsView();
            loadMoodleStats(false);
        } else if (!isMoodleProPersisted()) {
            showMoodleLoginView();
        }
    } catch (e) {}
}

function showMoodleLoginView() {
    const wrap = document.getElementById('moodleLoginWrap');
    if (wrap) wrap.style.display = 'flex';
    document.getElementById('moodleStatsArea').style.display = 'none';
}

function showMoodleStatsView() {
    const wrap = document.getElementById('moodleLoginWrap');
    if (wrap) wrap.style.display = 'none';
    document.getElementById('moodleStatsArea').style.display = 'flex';
}

/* ---------- Pro-виджеты внутри полноэкранной модалки ---------- */
const PRO_WIDGET_IDS = [
    'widgetMoodleAvgGradeCard',
    'widgetMoodleSubjectGradesCard',
    'widgetLabsProCard',
];
let proWidgetHomes = [];
let proWidgetsMounted = false;

function isMoodleModalOpen() {
    const modalEl = document.getElementById('moodleModal');
    return !!(modalEl && modalEl.classList.contains('show'));
}

function resizeProWidgets() {
    setTimeout(() => {
        try {
            if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) globalLabChartPro.resize();
            if (typeof proSubjectChart !== 'undefined' && proSubjectChart) proSubjectChart.resize();
        } catch (e) {}
    }, 120);
}

function mountProWidgetsInModal() {
    const sidebar = document.getElementById('moodleProSidebar');
    if (!sidebar) return;

    if (!proWidgetsMounted) {
        proWidgetHomes = [];
        PRO_WIDGET_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el || !el.parentElement) return;
            const marker = document.createComment('pro-widget-' + id);
            el.parentElement.insertBefore(marker, el);
            proWidgetHomes.push({ el, marker, parent: el.parentElement });
        });
        proWidgetsMounted = true;
    }

    proWidgetHomes.forEach(({ el }) => {
        if (el.parentElement !== sidebar) sidebar.appendChild(el);
        el.style.display = window.hasLoadedMoodleStats ? '' : 'none';
    });

    const empty = document.getElementById('moodleSidebarEmpty');
    if (empty) empty.style.display = 'none';
    resizeProWidgets();
}

function unmountProWidgetsFromModal() {
    if (!proWidgetsMounted) return;
    proWidgetHomes.forEach(({ el, marker, parent }) => {
        if (marker && marker.parentNode) {
            marker.parentNode.replaceChild(el, marker);
        } else if (parent) {
            parent.appendChild(el);
        }
    });
    proWidgetHomes = [];
    proWidgetsMounted = false;

    const empty = document.getElementById('moodleSidebarEmpty');
    if (empty) empty.style.display = '';

    if (typeof applyWidgetVisibility === 'function') applyWidgetVisibility();
    resizeProWidgets();
}

document.addEventListener('DOMContentLoaded', () => {
    const modalEl = document.getElementById('moodleModal');
    if (!modalEl) return;
    modalEl.addEventListener('shown.bs.modal', () => {
        if (window.isProActive) {
            mountProWidgetsInModal();
            if (typeof renderProWidgets === 'function') renderProWidgets();
        }
    });
    modalEl.addEventListener('hidden.bs.modal', unmountProWidgetsFromModal);
});

function setProMode(isActive) {
    const badge = document.getElementById('app-mode-badge');
    window.isProActive = isActive;

    if (isActive) {
        if (badge) {
            badge.className = 'app-mode-badge-stylish pro-mode ms-2';
            badge.textContent = 'Pro';
            badge.title = 'Режим Pro активен (Нажмите для настроек)';
        }
    } else {
        if (badge) {
            badge.className = 'app-mode-badge-stylish basic-mode ms-2';
            badge.textContent = 'Basic';
            badge.title = 'Базовая версия (Нажмите для входа)';
        }
        window.hasLoadedMoodleStats = false;

        if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) {
            globalLabChartPro.destroy();
            globalLabChartPro = null;
        }
        if (typeof proSubjectChart !== 'undefined' && proSubjectChart) {
            proSubjectChart.destroy();
            proSubjectChart = null;
        }
    }

    const proToggles = document.querySelectorAll('.pro-widget-toggle');
    const basicLabsLabel = document.getElementById('label-settingsToggleWidgetLabs');

    proToggles.forEach(el => el.style.display = isActive ? '' : 'none');
    if (basicLabsLabel) basicLabsLabel.style.display = isActive ? 'none' : '';

    if (typeof applyWidgetVisibility === 'function') applyWidgetVisibility();
    if (typeof renderCharts === 'function') renderCharts();
}

async function doMoodleLogin() {
    const user = document.getElementById('moodleUser').value.trim();
    const pass = document.getElementById('moodlePass').value.trim();
    if (!user || !pass) return alert('Введите логин и пароль');

    const btn = document.getElementById('moodleLoginBtn');
    const err = document.getElementById('moodleLoginError');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Вход...';
    err.style.display = 'none';

    try {
        const resp = await apiPost('/api/moodle/login', { username: user, password: pass });
        if (resp.success) {
            persistMoodlePro(true);
            showMoodleStatsView();
            setProMode(true);
            loadMoodleStats(true);
            if (typeof showUpdateNotification === 'function') showUpdateNotification('🎉 Режим Pro активирован!');
        }
    } catch (e) {
        err.textContent = 'Неверный логин или пароль, либо ошибка сети.';
        err.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
    }
}

async function doMoodleLogout(forced = false) {
    if (!forced && !confirm('Выйти из аккаунта Moodle?')) return;
    await apiPost('/api/moodle/logout', {});
    persistMoodlePro(false);
    unmountProWidgetsFromModal();
    showMoodleLoginView();
    setProMode(false);
    sessionStorage.removeItem('moodle_bg_refreshed');

    if (forced) {
        const err = document.getElementById('moodleLoginError');
        if (err) {
            err.textContent = 'Сессия истекла, войдите заново.';
            err.style.display = 'block';
        }
    }
}

function formatAge(ts) {
    if (!ts) return 'нет данных';
    const diff = Math.floor((Date.now() / 1000) - ts);
    if (diff < 60) return 'только что';
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min} мин. назад`;
    const h = Math.floor(min / 60);
    return `${h} ч. назад`;
}

function cancelMoodleRefresh() {
    if (moodleAbortController) {
        moodleAbortController.abort();
    }
    fetch('/api/moodle/cancel', { method: 'POST' }).catch(e => console.error(e));
}

function isMoodleStatsVisible() {
    const area = document.getElementById('moodleStatsArea');
    return !!(area && area.style.display !== 'none');
}

async function loadMoodleStats(force = false, isBackground = false) {
    if (isMoodleRefreshing && force) {
        cancelMoodleRefresh();
        return;
    }

    if (force) {
        isMoodleRefreshing = true;
        moodleAbortController = new AbortController();
    }

    const container = document.getElementById('moodleStatsContent');
    const updateBtn = document.getElementById('moodleUpdateBtn');

    if (updateBtn) {
        if (isMoodleRefreshing && !isBackground) {
            updateBtn.className = 'btn btn-sm btn-danger fw-bold';
            updateBtn.innerHTML = '⏹ Остановить';
            updateBtn.disabled = false;
        } else {
            updateBtn.className = 'btn btn-sm btn-outline-secondary';
            updateBtn.innerHTML = '🔄 Обновить';
            updateBtn.disabled = isBackground;
        }
    }

    if (!isBackground && container && isMoodleStatsVisible()) {
        container.innerHTML = `
            <div class="text-center py-4">
                ${getHedgehogSvgHtml(80)}
                <div class="mt-2 text-muted small">Собираем данные из Moodle (это может занять до 5 минут)...</div>
            </div>`;
    }

    const modeBadge = document.getElementById('app-mode-badge');
    if (modeBadge && modeBadge.textContent === 'Pro') {
        const avgEl = document.getElementById('proAvgGradeText');
        if (!isBackground && avgEl) {
            avgEl.innerHTML = '<span class="spinner-border spinner-border-sm text-primary"></span>';
        }
    }

    try {
        const url = `/api/moodle/stats?force=${force ? '1' : '0'}`;
        const fetchOpts = { headers: authHeaders() };
        if (moodleAbortController) fetchOpts.signal = moodleAbortController.signal;

        // Обычный fetch, а не apiFetch: код ниже обрабатывает 401
        // (выход из Pro) и читает тело ошибки — исключение здесь
        // сломало бы эту ветку.
        const rawResp = await fetch(url, fetchOpts);

        if (rawResp.status === 401) {
            // Сессия истекла. Pro-режим и сохранённые данные не сбрасываем:
            // пользователь увидит кэш и сможет войти заново вручную.
            if (!isBackground) {
                if (container && isMoodleStatsVisible()) {
                    const alertId = 'moodleSessionExpiredAlert';
                    const old = document.getElementById(alertId);
                    if (old) old.remove();
                    container.insertAdjacentHTML('afterbegin', `
                        <div id="${alertId}" class="alert alert-warning py-2 small">
                            Сессия Moodle истекла — показаны сохранённые данные.
                            <button class="btn btn-sm btn-outline-dark ms-2" onclick="showMoodleLoginView()">Войти заново</button>
                        </div>`);
                } else {
                    showMoodleLoginView();
                }
                if (typeof showUpdateNotification === 'function') {
                    showUpdateNotification('⚠️ Сессия Moodle истекла — показаны сохранённые данные');
                }
            }
            return;
        }

        const resp = await rawResp.json();

        if (resp.error) {
            if (resp.error === 'Cancelled') {
                if (typeof showUpdateNotification === 'function') showUpdateNotification('⏹ Обновление остановлено');
                isMoodleRefreshing = false;
                loadMoodleStats(false);
                return;
            }
            throw new Error(resp.error);
        }

        moodleStats = resp.data || [];
        moodleStatsTimestamp = resp.timestamp || 0;

        // Сначала полностью собираем разметку и графики, и только потом
        // показываем Pro-виджеты — чтобы не мелькали пустые карточки.
        renderMoodleStats();
        renderProWidgets();

        window.hasLoadedMoodleStats = true;
        if (typeof applyWidgetVisibility === 'function') applyWidgetVisibility();

        const ageSpan = document.getElementById('moodleDataAge');
        if (ageSpan) {
            const suffix = (resp.stale && moodleStatsTimestamp) ? ' · сохранённые данные' : '';
            ageSpan.textContent = formatAge(moodleStatsTimestamp) + suffix;
        }

    } catch (e) {
        if (e.name === 'AbortError') {
            if (typeof showUpdateNotification === 'function') showUpdateNotification('⏹ Обновление остановлено');
            isMoodleRefreshing = false;
            loadMoodleStats(false);
        } else {
            if (container && !isBackground && document.getElementById('moodleStatsArea').style.display === 'block') {
                container.innerHTML = `<div class="alert alert-danger">Ошибка: ${e.message || 'сессия устарела'}. <button class="btn btn-sm btn-outline-danger ms-2" onclick="openMoodleModal()">Перезайти</button></div>`;
            }
        }
    } finally {
        if (force) {
            isMoodleRefreshing = false;
            moodleAbortController = null;
            if (updateBtn) {
                updateBtn.disabled = false;
                updateBtn.className = 'btn btn-sm btn-outline-secondary';
                updateBtn.innerHTML = '🔄 Обновить';
            }
        }
    }
}

function isCourseInCurrentSchedule(courseName, courseId) {
    if (moodleSemesterConfig[courseId]) {
        return moodleSemesterConfig[courseId] === 'current';
    }
    if (!cachedSchedule || cachedSchedule.length === 0) return true;

    let cleanCourse = courseName.replace(/\([^)]*\)/g, '').trim().toLowerCase();
    return cachedSchedule.some(item => {
        let lessonName = item.lesson.toLowerCase();
        return cleanCourse.includes(lessonName) || lessonName.includes(cleanCourse);
    });
}

function _groupCourseLabs(course) {
    const groups = [];
    const byNum = new Map();
    (course.assignments || []).forEach(act => {
        const num = extractLabNum(act.name);
        if (num) {
            let group = byNum.get(num);
            if (!group) {
                group = { num, key: `lab-${course.id}-${num}`, acts: [] };
                byNum.set(num, group);
                groups.push(group);
            }
            group.acts.push(act);
        } else {
            groups.push({ num: null, key: `one-${course.id}-${groups.length}`, acts: [act] });
        }
    });
    return groups;
}

function _groupIsDone(course, group, forcedDone) {
    if (forcedDone) return true;
    // Если сдана хотя бы одна лаба с таким номером — засчитываем всю группу.
    return group.acts.some(a => a.status === 'Сдано' || a.status === 'На проверке');
}

function _groupRepresentative(group, done) {
    if (done) {
        const doneAct = group.acts.find(a => a.status === 'Сдано' || a.status === 'На проверке');
        if (doneAct) return doneAct;
    }
    return group.acts.find(a => a.grade_num) || group.acts[0];
}

function toggleMoodleLabGroup(btn) {
    const groupKey = btn.dataset.group;
    const rows = document.querySelectorAll(`.moodle-lab-extra[data-group="${groupKey}"]`);
    const open = btn.dataset.open === '1';
    rows.forEach(row => { row.style.display = open ? 'none' : ''; });
    btn.dataset.open = open ? '0' : '1';
    btn.textContent = open ? '▶' : '▼';
}

function renderMoodleStats() {
    const container = document.getElementById('moodleStatsContent');
    if (!moodleStats || moodleStats.length === 0) {
        if (container) container.innerHTML = '<div class="text-muted text-center py-4">Сохранённых данных пока нет. Нажмите «🔄 Обновить», чтобы загрузить их с Moodle.</div>';
        return;
    }

    let currentCourses = moodleStats.filter(c => isCourseInCurrentSchedule(c.name, c.id));
    let visibleCourses = currentCourses.filter(c => c.assignments && c.assignments.length > 0);
    let totalTasks = visibleCourses.reduce((sum, c) => sum + _groupCourseLabs(c).length, 0);

    let html = `
        <div class="moodle-pro-toolbar">
            <div class="small fw-bold text-muted">
                Предметы текущего семестра: ${visibleCourses.length} · заданий: ${totalTasks}
            </div>
            <div class="d-flex gap-2 flex-wrap">
                <button class="btn btn-sm btn-outline-warning fw-bold" onclick="syncMoodleDeadlinesToCalendar()">📅 Дедлайны в календарь</button>
                <button class="btn btn-sm btn-success fw-bold" onclick="syncMoodleToWidgets()">📥 Синхронизировать с виджетами</button>
            </div>
        </div>
        <div class="moodle-segments">
    `;

    if (visibleCourses.length === 0) {
        html += '<div class="text-muted py-4">Для текущего семестра нет заданий.</div>';
    }

    visibleCourses.forEach(course => {
        const forcedDone = isCourseForcedDone(course);
        const labGroups = _groupCourseLabs(course);
        const doneCount = labGroups.filter(g => _groupIsDone(course, g, forcedDone)).length;
        const total = labGroups.length;
        let pct = total > 0 ? Math.round(doneCount * 100 / total) : 0;

        html += `
            <section class="moodle-segment">
                <div class="moodle-seg-head">
                    <div class="moodle-seg-title" title="${escapeHtml(course.name)}">📚 ${escapeHtml(course.name)}</div>
                    <div class="moodle-seg-actions">
                        <span class="badge ${doneCount === total ? 'bg-success' : 'bg-primary'}">${doneCount} / ${total}</span>
                        <button type="button"
                                class="btn btn-sm ${forcedDone ? 'btn-success' : 'btn-outline-success'} moodle-seg-done-btn"
                                onclick="toggleCourseAllDone('${escapeHtml(String(course.id))}')"
                                title="${forcedDone ? 'Снять отметку «все сдано»' : 'Засчитать все лабы по предмету сданными'}">
                            ${forcedDone ? '✓ Все сдано' : 'Все сдано'}
                        </button>
                    </div>
                </div>
                <div class="moodle-seg-progress"><div style="width:${pct}%"></div></div>
                <ul class="moodle-seg-list">
        `;

        labGroups.forEach(group => {
            const groupDone = _groupIsDone(course, group, forcedDone);
            const rep = _groupRepresentative(group, groupDone);
            const hasExtra = group.acts.length > 1;
            const extraRows = hasExtra ? group.acts.filter(a => a !== rep) : [];
            const groupKey = escapeHtml(String(group.key));

            let effStatus = groupDone ? 'Сдано' : _courseEffectiveStatus(course, rep);
            let badgeClass = 'bg-secondary';
            if (effStatus === 'Сдано') badgeClass = 'bg-success';
            else if (effStatus === 'На проверке') badgeClass = 'bg-warning text-dark';
            else if (effStatus === 'Не сдано') badgeClass = 'bg-danger';
            else if (effStatus === 'Тест') badgeClass = 'bg-info text-dark';

            let dueHtml = rep.due ? `<span class="moodle-seg-due">📅 ${escapeHtml(rep.due)}</span>` : '';
            let gradeHtml = (rep.grade && rep.grade !== '—')
                ? `<span class="badge bg-success ms-1">${escapeHtml(rep.grade)}</span>` : '';
            let toggleHtml = hasExtra
                ? `<button type="button" class="moodle-lab-toggle" data-group="${groupKey}" data-open="0" onclick="toggleMoodleLabGroup(this)" title="Показать все лабы с номером ${escapeHtml(String(group.num))}">▶</button>`
                : '';

            html += `
                <li class="moodle-seg-item${groupDone ? ' is-done' : ''} moodle-lab-group" data-group="${groupKey}">
                    <div class="moodle-seg-item-main">
                        <span class="moodle-seg-name" title="${escapeHtml(rep.name)}">${toggleHtml}${moodleActivityNameHtml(rep)}</span>
                        ${dueHtml}
                    </div>
                    <div class="moodle-seg-badges">
                        <span class="badge ${badgeClass}">${escapeHtml(effStatus)}</span>
                        ${gradeHtml}
                    </div>
                </li>
            `;

            extraRows.forEach(act => {
                const st = groupDone ? 'Сдано' : _courseEffectiveStatus(course, act);
                let cls = 'bg-secondary';
                if (st === 'Сдано') cls = 'bg-success';
                else if (st === 'На проверке') cls = 'bg-warning text-dark';
                else if (st === 'Не сдано') cls = 'bg-danger';
                else if (st === 'Тест') cls = 'bg-info text-dark';
                const extraGrade = (act.grade && act.grade !== '—')
                    ? `<span class="badge bg-success ms-1">${escapeHtml(act.grade)}</span>` : '';
                const extraDue = act.due ? `<span class="moodle-seg-due">📅 ${escapeHtml(act.due)}</span>` : '';
                html += `
                    <li class="moodle-seg-item moodle-lab-extra${groupDone ? ' is-done' : ''}" data-group="${groupKey}" style="display:none">
                        <div class="moodle-seg-item-main">
                            <span class="moodle-seg-name" title="${escapeHtml(act.name)}">${moodleActivityNameHtml(act)}</span>
                            ${extraDue}
                        </div>
                        <div class="moodle-seg-badges">
                            <span class="badge ${cls}">${escapeHtml(st)}</span>
                            ${extraGrade}
                        </div>
                    </li>
                `;
            });
        });

        html += `</ul></section>`;
    });
    html += '</div>';
    if (container) container.innerHTML = html;
}

let _allDoneBusy = false;

async function toggleCourseAllDone(courseId) {
    if (_allDoneBusy) return;
    const course = (moodleStats || []).find(c => String(c.id) === String(courseId));
    if (!course) return;
    const forced = isCourseForcedDone(course);
    const label = (course.name || '').split('(')[0].trim() || course.name || 'предмет';

    if (forced) {
        if (!confirm(`Снять отметку «Все сдано» по предмету «${label}»?\n\nРанее отмеченные лабы снова станут несданными.`)) return;
    } else {
        if (!confirm(`Засчитать все лабы по предмету «${label}» сданными?\n\nЛабы будут отмечены в трекере, даже если в Moodle они не сданы.`)) return;
    }
    await _setCourseAllDone(course, !forced);
}

async function _setCourseAllDone(course, forced) {
    _allDoneBusy = true;
    try {
        const groupInput = document.getElementById('groupSelect');
        const group = (groupInput && groupInput.value || '').trim();
        const subjectKeys = getCourseSubjectKeys(course);
        const backupsRaw = _readJsonLocal(MOODLE_ALL_DONE_BACKUP_KEY, {});
        const backups = (backupsRaw && typeof backupsRaw === 'object' && !Array.isArray(backupsRaw))
            ? backupsRaw : {};
        const courseKey = String(course.id);
        let changedIds = [];

        if (group && subjectKeys.length > 0) {
            let grouped = {};
            try {
                grouped = await apiLoadLabItems(group) || {};
            } catch (e) {
                console.error('[moodle-pro] lab_items load failed', e);
            }

            const affected = [];
            subjectKeys.forEach(subj => {
                (Array.isArray(grouped[subj]) ? grouped[subj] : []).forEach(it => affected.push(it));
            });

            if (forced) {
                for (const it of affected) {
                    if (it.completed) continue;
                    try {
                        await apiUpdateLabItem(it.id, { completed: 1 });
                        changedIds.push(it.id);
                    } catch (e) {
                        console.error('[moodle-pro] lab_item update failed', it.id, e);
                    }
                }
                if (changedIds.length > 0) {
                    backups[courseKey] = { ids: changedIds, timestamp: Date.now() };
                }
            } else {
                const backup = backups[courseKey];
                const ids = (backup && Array.isArray(backup.ids)) ? backup.ids : [];
                for (const id of ids) {
                    try {
                        await apiUpdateLabItem(Number(id), { completed: 0 });
                    } catch (e) {
                        console.error('[moodle-pro] lab_item restore failed', id, e);
                    }
                }
                changedIds = ids;
            }
        }

        setCourseForcedDone(course.id, forced);
        if (forced) {
            backups[courseKey] = backups[courseKey] || { ids: changedIds, timestamp: Date.now() };
        } else {
            delete backups[courseKey];
        }
        _writeJsonLocal(MOODLE_ALL_DONE_BACKUP_KEY, backups);

        if (typeof updateLabsCache === 'function') await updateLabsCache();
        if (typeof renderCharts === 'function') renderCharts();
        renderMoodleStats();
        if (window.isProActive) renderProWidgets();
        if (typeof renderSuggestions === 'function') renderSuggestions(true);

        if (typeof showUpdateNotification === 'function') {
            showUpdateNotification(forced
                ? '✅ Все лабы по предмету зачтены'
                : '↩️ Отметка «Все сдано» снята');
        }
    } finally {
        _allDoneBusy = false;
    }
}

function extractLabNum(name) {    const match = name.match(/(?:ЛР|ЛЗ|ПЗ|Лабораторная работа|Практическое задание|Практическая работа|Лабораторное занятие|Лабораторная)\s*№?\s*(\d+(?:\.\d+)?)/i);
    return match ? match[1] : null;
}

const MOODLE_BASE_URL = 'https://do.sevsu.ru';

function getMoodleActivityUrl(act) {
    if (!act || !act.id) return '';
    const type = act.type === 'quiz' ? 'quiz' : 'assign';
    return `${MOODLE_BASE_URL}/mod/${type}/view.php?id=${encodeURIComponent(act.id)}`;
}

function moodleActivityNameHtml(act) {
    const name = escapeHtml(act && act.name ? act.name : '');
    const url = getMoodleActivityUrl(act);
    if (!url) return name;
    return `<a class="moodle-activity-link" href="${escapeHtml(url)}"
               target="_blank" rel="noopener noreferrer"
               title="Открыть в Moodle">${name}<span class="moodle-link-arrow">↗</span></a>`;
}

async function syncMoodleDeadlinesToCalendar() {
    if (!moodleStats || moodleStats.length === 0) {
        alert('Нет данных Moodle. Обновите статистику.');
        return;
    }
    if (!confirm('Добавить дедлайны из Moodle в календарь (за 2 дня до сдачи)?')) return;

    let added = 0;
    let todayStr = getLocalDateStr(new Date());

    for (const course of moodleStats) {
        if (!isCourseInCurrentSchedule(course.name, course.id)) continue;

        let cleanCourse = course.name.replace(/\([^)]*\)/g, '').trim();

        for (const act of course.assignments) {
            if (act.status === 'Сдано' || act.status === 'На проверке' || act.status === 'Черновик') continue;
            if (!act.due_iso) continue;

            let [y, m, d] = act.due_iso.split('-').map(Number);
            let dueDate = new Date(y, m - 1, d);
            dueDate.setDate(dueDate.getDate() - 2);
            let taskDateStr = getLocalDateStr(dueDate);

            if (taskDateStr < todayStr) continue;

            let text = `Сдать: ${cleanCourse} — ${act.name}`;

            let existing = [];
            try { existing = await apiLoadTasks(taskDateStr, taskDateStr); }
            catch (e) { existing = []; }
            if (existing.some(t => t.text === text)) continue;

            try {
                await apiCreateTask({date: taskDateStr, text: text, status: 'red'});
                added++;
            } catch (e) {
                console.error('createTask failed', e);
            }
        }
    }

    if (added > 0) {
        if (typeof refreshTaskDates === 'function') await refreshTaskDates();
        if (typeof renderCalendar === 'function') renderCalendar();
        alert(`Добавлено напоминаний о дедлайнах: ${added}`);
    } else {
        alert('Нет актуальных дедлайнов для добавления (все сдано или даты прошли).');
    }
}

async function syncMoodleToWidgets() {
    if (!cachedSchedule || cachedSchedule.length === 0) {
        alert("Сначала загрузите расписание, чтобы мы знали, к каким предметам привязывать лабы.");
        return;
    }

    const group = (document.getElementById('groupSelect').value || '').trim();
    if (!group) {
        alert('Сначала выберите группу.');
        return;
    }

    if (!confirm("Синхронизировать работы из Moodle с виджетами «Лабораторные»?\n\n"
        + "Отметки лаб будут приведены в соответствие с Moodle: сданные — отмечены, "
        + "несданные — сняты. Предметы, убранные в прошлый семестр, не участвуют.")) return;

    // subject -> Map(номер лабы -> сдана ли)
    // Объединяем несколько курсов, привязанных к одному предмету, чтобы
    // последний курс не перезатирал прогресс предыдущего.
    const subjectLabs = new Map();

    for (const course of moodleStats) {
        if (!isCourseInCurrentSchedule(course.name, course.id)) continue;

        const forcedDone = isCourseForcedDone(course);
        const cleanCourse = course.name.replace(/\([^)]*\)/g, '').trim().toLowerCase();
        const matchingSubjects = new Set();

        cachedSchedule.forEach(item => {
            if (item.type_name !== 'ЛЗ' && item.type_name !== 'ПЗ') return;
            const lessonName = item.lesson.toLowerCase();
            if (cleanCourse.includes(lessonName) || lessonName.includes(cleanCourse)) {
                matchingSubjects.add(`${item.lesson} (${item.type_name})`);
            }
        });
        if (matchingSubjects.size === 0) continue;

        course.assignments.forEach(a => {
            if (a.type !== 'assign') return;
            const num = extractLabNum(a.name);
            if (!num) return;
            const done = forcedDone || a.status === 'Сдано' || a.status === 'На проверке';
            matchingSubjects.forEach(subj => {
                if (!subjectLabs.has(subj)) subjectLabs.set(subj, new Map());
                const labs = subjectLabs.get(subj);
                labs.set(num, (labs.get(num) || false) || done);
            });
        });
    }

    if (subjectLabs.size === 0) {
        alert("Не удалось найти совпадений.");
        return;
    }

    let payload = [];
    subjectLabs.forEach((labs, subject) => {
        payload.push({
            group: group,
            subject: subject,
            completed: [...labs.values()].filter(Boolean).length,
            total: labs.size
        });
    });

    try {
        await apiSaveLabs(payload);

        const currentLabItems = await apiLoadLabItems(group);
        let updatedMarks = 0;

        for (const [subject, labs] of subjectLabs) {
            const items = currentLabItems[subject] || [];
            for (const item of items) {
                const num = extractLabNum(item.title);
                if (num === null || !labs.has(num)) continue;
                const want = labs.get(num) ? 1 : 0;
                if (!!item.completed !== !!want) {
                    await apiUpdateLabItem(item.id, { completed: want });
                    updatedMarks++;
                }
            }
        }

        await updateLabsCache();
        renderCharts();
        renderMoodleStats();
        renderProWidgets();

        // Если открыта модалка «Темп сдачи лаб» — сразу обновляем её,
        // чтобы зачёркивание сданных лаб появилось без переоткрытия.
        const labItemsModal = document.getElementById('labItemsModal');
        if (labItemsModal && labItemsModal.classList.contains('show')
            && typeof _reloadLabItems === 'function') {
            await _reloadLabItems();
        }

        alert(`Синхронизировано предметов: ${payload.length}. Обновлено отметок лаб: ${updatedMarks}.`);
    } catch (e) {
        console.error(e);
        alert("Ошибка при сохранении данных.");
    }
}

// ==========================================
//  РЕНДЕР ПРО-ВИДЖЕТОВ
// ==========================================

function renderProWidgets() {
    if (window.isProActive && isMoodleModalOpen()) mountProWidgetsInModal();
    if (!moodleStats || moodleStats.length === 0) {
        return;
    }

    let currentCourses = moodleStats.filter(c => isCourseInCurrentSchedule(c.name, c.id));

    let totalGradeSum = 0;
    let totalGradeCount = 0;
    let subjectGrades = {};

    currentCourses.forEach(course => {
        let shortName = course.name.split('(')[0].trim();
        if (!subjectGrades[shortName]) subjectGrades[shortName] = [];

        course.assignments.forEach(act => {
            if (act.grade_num !== null && act.grade_num > 0) {
                totalGradeSum += act.grade_num;
                totalGradeCount++;
                subjectGrades[shortName].push(act);
            }
        });
    });

    const avgText = document.getElementById('proAvgGradeText');
    if (avgText) {
        avgText.textContent = totalGradeCount > 0 ? (totalGradeSum / totalGradeCount).toFixed(1) : '—';
    }

    if (window.isProActive) {
        let done = 0, attached = 0, remaining = 0;
        currentCourses.forEach(c => {
            const forcedDone = isCourseForcedDone(c);
            c.assignments.forEach(a => {
                if (a.type !== 'assign') return;
                if (forcedDone || a.status === 'Сдано') done++;
                else if (a.status === 'На проверке' || a.status === 'Черновик') attached++;
                else remaining++;
            });
        });

        // ИСПОЛЬЗУЕМ ЦВЕТА: Сдано (базовый), Прикреплено (оранжевый), Осталось (серый)
        const cDone = getThemeColor('--chart-lab-done', '#14b8a6');
        const cAttached = getThemeColor('--status-orange', '#f59e0b'); 
        const cRemaining = getThemeColor('--chart-remaining', '#cbd5e1');
        const cText = getThemeColor('--text-secondary', '#64748b');

        if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) {
            globalLabChartPro.data.labels = ['Сдано', 'Прикреплено', 'Осталось'];
            globalLabChartPro.data.datasets[0].data = [done, attached, remaining];
            globalLabChartPro.data.datasets[0].backgroundColor = [cDone, cAttached, cRemaining];
            globalLabChartPro.options.plugins.legend.labels.color = cText;
            globalLabChartPro.update('none');
        } else {
            const ctx = document.getElementById('labStatsChartPro');
            if (ctx) {
                globalLabChartPro = new Chart(ctx.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: ['Сдано', 'Прикреплено', 'Осталось'],
                        datasets: [{
                            data: [done, attached, remaining],
                            backgroundColor: [cDone, cAttached, cRemaining],
                            borderWidth: 0,
                            hoverOffset: 8,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { 
                            legend: { position: 'bottom', labels: { color: cText } } 
                        }
                    }
                });
            }
        }

        renderProLabDetails();
    }

    renderProAvgDetails();

    const select = document.getElementById('proSubjectSelect');
    if (select) {
        let currentVal = select.value;
        select.innerHTML = '';
        let keys = Object.keys(subjectGrades).filter(k => subjectGrades[k].length > 0);

        if (keys.length === 0) {
            select.innerHTML = '<option value="">Нет оцененных работ</option>';
            if (proSubjectChart) {
                proSubjectChart.destroy();
                proSubjectChart = null;
            }
            return;
        }

        keys.forEach(k => {
            let opt = document.createElement('option');
            opt.value = k;
            opt.textContent = k;
            select.appendChild(opt);
        });
        if (keys.includes(currentVal)) select.value = currentVal;

        renderProSubjectChart();
    }
}

function renderProLabDetails() {
    const el = document.getElementById('labStatsDetailsPro');
    if (!el) return;

    let currentCourses = moodleStats.filter(c => isCourseInCurrentSchedule(c.name, c.id));
    let subjectStats = {};

    currentCourses.forEach(course => {
        const forcedDone = isCourseForcedDone(course);
        let cleanCourse = course.name.replace(/\([^)]*\)/g, '').trim().toLowerCase();
        let matchingSubjects = new Set();

        cachedSchedule.forEach(item => {
            if (item.type_name !== 'ЛЗ' && item.type_name !== 'ПЗ') return;
            let lessonName = item.lesson.toLowerCase();
            if (cleanCourse.includes(lessonName) || lessonName.includes(cleanCourse)) {
                matchingSubjects.add(`${item.lesson} (${item.type_name})`);
            }
        });

        matchingSubjects.forEach(subj => {
            if (!subjectStats[subj]) subjectStats[subj] = { done: 0, attached: 0, remaining: 0 };

            course.assignments.forEach(a => {
                if (a.type !== 'assign') return;
                if (forcedDone || a.status === 'Сдано') subjectStats[subj].done++;
                else if (a.status === 'На проверке' || a.status === 'Черновик') subjectStats[subj].attached++;
                else subjectStats[subj].remaining++;
            });
        });
    });

    let keys = Object.keys(subjectStats);
    if (keys.length === 0) {
        el.innerHTML = '<div class="text-muted small">Нет данных</div>';
        return;
    }

    let html = '';
    keys.forEach(subj => {
        let st = subjectStats[subj];
        let total = st.done + st.attached + st.remaining;
        if (total === 0) return;

        html += `
            <div class="widget-details-row" title="${escapeHtml(subj)}">
                <span class="widget-details-title">${escapeHtml(subj)}</span>
                <span class="widget-details-nums">
                    <span style="color:var(--chart-lab-done);">${st.done}</span> / 
                    <span style="color:var(--status-orange);">${st.attached}</span> / 
                    <span style="color:var(--text-muted);">${st.remaining}</span>
                </span>
            </div>
        `;
    });
    el.innerHTML = html;
}

function renderProAvgDetails() {
    const el = document.getElementById('proAvgGradeDetails');
    if (!el) return;

    let subjectStats = {};
    let currentCourses = moodleStats.filter(c => isCourseInCurrentSchedule(c.name, c.id));

    currentCourses.forEach(course => {
        let shortName = course.name.split('(')[0].trim();
        if (!subjectStats[shortName]) subjectStats[shortName] = { sum: 0, count: 0 };

        course.assignments.forEach(act => {
            if (act.grade_num !== null && act.grade_num > 0) {
                subjectStats[shortName].sum += act.grade_num;
                subjectStats[shortName].count++;
            }
        });
    });

    let subjects = Object.keys(subjectStats).filter(k => subjectStats[k].count > 0)
                    .sort((a, b) => (subjectStats[b].sum/subjectStats[b].count) - (subjectStats[a].sum/subjectStats[a].count));

    if (subjects.length === 0) {
        el.innerHTML = '<div class="text-muted small">Нет оценок</div>';
        return;
    }

    let html = '';
    subjects.forEach(subj => {
        let avg = (subjectStats[subj].sum / subjectStats[subj].count).toFixed(1);
        html += `
            <div class="widget-details-row" title="${escapeHtml(subj)}">
                <span class="widget-details-title">${escapeHtml(subj)}</span>
                <span class="widget-details-nums">${avg}</span>
            </div>
        `;
    });
    el.innerHTML = html;
}

function renderProSubjectChart() {
    const select = document.getElementById('proSubjectSelect');
    if (!select || !select.value) return;

    let currentCourses = moodleStats.filter(c => isCourseInCurrentSchedule(c.name, c.id));
    let subjectName = select.value;
    let allLabs = [];

    currentCourses.forEach(course => {
        let shortName = course.name.split('(')[0].trim();
        if (shortName === subjectName) {
            course.assignments.forEach(act => {
                if (act.type === 'assign' && extractLabNum(act.name)) {
                    allLabs.push(act);
                }
            });
        }
    });

    let uniqueLabs = {};
    allLabs.forEach(a => {
        let num = extractLabNum(a.name);
        if (!uniqueLabs[num]) uniqueLabs[num] = a;
        else if (a.grade_num && !uniqueLabs[num].grade_num) uniqueLabs[num] = a;
    });

    let sortedNums = Object.keys(uniqueLabs).sort((a,b) => parseFloat(a) - parseFloat(b));
    let sortedLabs = sortedNums.map(n => uniqueLabs[n]);

    let labels = sortedNums.map(n => 'ЛР ' + n);
    let data = sortedLabs.map(a => a.grade_num || null);
    let validGrades = data.filter(x => x !== null);

    let avgGrade = validGrades.length > 0 ? (validGrades.reduce((a,b)=>a+b, 0) / validGrades.length) : 0;
    let maxGrade = validGrades.length > 0 ? Math.max(...validGrades) : 100;

    const detailsEl = document.getElementById('proSubjectGradeDetails');
    if (detailsEl) {
        const avgText = validGrades.length > 0 ? avgGrade.toFixed(1) : '—';
        let html = `
            <div class="widget-details-row pro-subject-avg" title="Средний балл по предмету">
                <span class="widget-details-title">Средний балл</span>
                <span class="widget-details-nums fw-bold">${avgText}</span>
            </div>`;
        sortedLabs.forEach(lab => {
            let gradeText = lab.grade_num ? lab.grade_num : '—';
            html += `
                <div class="widget-details-row" title="${escapeHtml(lab.name)}">
                    <span class="widget-details-title">${moodleActivityNameHtml(lab)}</span>
                    <span class="widget-details-nums">${gradeText}</span>
                </div>
            `;
        });
        if (sortedLabs.length === 0) {
            html += '<div class="text-muted small">Нет оценок по предмету</div>';
        }
        detailsEl.innerHTML = html;
    }

    if (proSubjectChart) { proSubjectChart.destroy(); proSubjectChart = null; }
    const ctx = document.getElementById('proSubjectChart');
    if (ctx && ctx.offsetParent !== null) {
        const cAccent = getThemeColor('--accent', '#6366f1');
        const cText = getThemeColor('--text-secondary', '#64748b');
        const cGrid = getThemeColor('--border-color', '#e2e8f0');
        
        proSubjectChart = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Балл',
                        data: data,
                        backgroundColor: cAccent,
                        borderRadius: 4,
                        barPercentage: 0.6
                    },
                    {
                        type: 'line',
                        label: 'Соединение',
                        data: data,
                        borderColor: getThemeColor('--chart-lab-done', '#14b8a6'),
                        borderWidth: 2,
                        tension: 0.3,
                        spanGaps: true,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: getThemeColor('--chart-lab-done', '#14b8a6'),
                        pointBorderWidth: 2,
                        pointRadius: 4
                    },
                    {
                        type: 'line',
                        label: 'Среднее',
                        data: Array(labels.length).fill(avgGrade),
                        borderColor: getThemeColor('--status-orange', '#f59e0b'),
                        borderDash: [5, 5],
                        borderWidth: 2,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: cText },
                        grid: { color: cGrid }
                    },
                    y: {
                        min: 50,
                        max: Math.max(100, Math.ceil(maxGrade / 10) * 10), 
                        title: { display: true, text: 'Баллы', color: cText },
                        ticks: { color: cText },
                        grid: { color: cGrid }
                    }
                },
                plugins: { 
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: getThemeColor('--chart-tooltip-bg', 'rgba(15, 23, 42, 0.92)'),
                        titleColor: getThemeColor('--chart-tooltip-text', '#f8fafc'),
                        bodyColor: getThemeColor('--chart-tooltip-text', '#f8fafc'),
                        callbacks: {
                            label: function(context) {
                                if (context.dataset.label === 'Среднее') return 'Среднее: ' + context.raw.toFixed(1);
                                return context.raw !== null ? 'Балл: ' + context.raw : 'Не сдано';
                            }
                        }
                    }
                }
            }
        });
    }
}

function refreshProChartsTheme() {
    const tooltipOpts = typeof _buildTooltipOpts === 'function' ? _buildTooltipOpts() : {};

    if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) {
        try {
            const cText = getThemeColor('--text-secondary', '#64748b');
            const cDone = getThemeColor('--chart-lab-done', '#14b8a6');
            const cAttached = getThemeColor('--status-orange', '#f59e0b');
            const cRemaining = getThemeColor('--chart-remaining', '#cbd5e1');

            globalLabChartPro.data.datasets[0].backgroundColor = [cDone, cAttached, cRemaining];
            globalLabChartPro.options.plugins.legend.labels.color = cText;
            if (tooltipOpts.backgroundColor) {
                globalLabChartPro.options.plugins.tooltip = Object.assign({}, globalLabChartPro.options.plugins.tooltip, tooltipOpts);
            }
            globalLabChartPro.update('none');
        } catch(e) { console.error(e); }
    }

    if (typeof proSubjectChart !== 'undefined' && proSubjectChart) {
        try {
            const cText = getThemeColor('--text-secondary', '#64748b');
            const cGrid = getThemeColor('--border-color', '#e2e8f0');
            const cAccent = getThemeColor('--accent', '#6366f1');
            const cGreen = getThemeColor('--chart-lab-done', '#14b8a6');
            const cOrange = getThemeColor('--status-orange', '#f59e0b');
            
            proSubjectChart.data.datasets[0].backgroundColor = cAccent;
            proSubjectChart.data.datasets[1].borderColor = cGreen;
            proSubjectChart.data.datasets[1].pointBorderColor = cGreen;
            proSubjectChart.data.datasets[2].borderColor = cOrange;
            
            proSubjectChart.options.scales.x.ticks.color = cText;
            proSubjectChart.options.scales.x.grid.color = cGrid;
            proSubjectChart.options.scales.y.ticks.color = cText;
            proSubjectChart.options.scales.y.title.color = cText;
            proSubjectChart.options.scales.y.grid.color = cGrid;

            if (tooltipOpts.backgroundColor) {
                proSubjectChart.options.plugins.tooltip = Object.assign({}, proSubjectChart.options.plugins.tooltip, tooltipOpts);
            }
            proSubjectChart.update('none');
        } catch(e) { console.error(e); }
    }
}

let draggedCourseId = null;

function openMoodleSetupModal() {
    const pastList = document.getElementById('pastSemesterList');
    const currentList = document.getElementById('currentSemesterList');
    pastList.innerHTML = '';
    currentList.innerHTML = '';

    if (!moodleStats) return;

    moodleStats.forEach(course => {
        const isCurrent = isCourseInCurrentSchedule(course.name, course.id);
        const li = document.createElement('li');
        li.className = 'list-group-item py-2 d-flex justify-content-between align-items-center';
        li.style.cursor = 'grab';
        li.draggable = true;
        li.dataset.id = course.id;
        li.dataset.name = course.name;
        li.innerHTML = `<span class="text-truncate fw-bold small" style="max-width: 100%;" title="${escapeHtml(course.name)}">${escapeHtml(course.name)}</span>`;
        
        li.addEventListener('dragstart', (e) => {
            draggedCourseId = course.id;
            e.dataTransfer.effectAllowed = 'move';
        });

        if (isCurrent) currentList.appendChild(li);
        else pastList.appendChild(li);
    });

    const modalEl = document.getElementById('moodleSetupModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
}

function persistSemesterConfigFromDom() {
    const currentList = document.getElementById('currentSemesterList');
    const pastList = document.getElementById('pastSemesterList');
    const newConfig = {};

    if (currentList) {
        currentList.querySelectorAll('li').forEach(li => {
            if (li.dataset.id) newConfig[li.dataset.id] = 'current';
        });
    }
    if (pastList) {
        pastList.querySelectorAll('li').forEach(li => {
            if (li.dataset.id) newConfig[li.dataset.id] = 'past';
        });
    }

    moodleSemesterConfig = newConfig;
    try {
        localStorage.setItem('moodleSemesterConfig', JSON.stringify(newConfig));
    } catch (e) {
        console.error('[moodle-pro] failed to save semester config', e);
    }
}

function refreshProViewsAfterSemesterChange() {
    renderMoodleStats();
    renderProWidgets();
}

function handleSemesterDrop(ev, targetColumn) {
    ev.preventDefault();
    if (!draggedCourseId) return;
    
    const targetList = targetColumn === 'current' ? document.getElementById('currentSemesterList') : document.getElementById('pastSemesterList');
    const draggedEl = document.querySelector(`[data-id="${draggedCourseId}"]`);
    if (draggedEl) {
        targetList.appendChild(draggedEl);
        // Сохраняем сразу: иначе перенос можно потерять, закрыв окно крестиком.
        persistSemesterConfigFromDom();
        refreshProViewsAfterSemesterChange();
    }
    draggedCourseId = null;
}

function saveMoodleSetup() {
    persistSemesterConfigFromDom();
    
    bootstrap.Modal.getInstance(document.getElementById('moodleSetupModal')).hide();
    renderMoodleStats();
    renderProWidgets();
    if (typeof showUpdateNotification === 'function') showUpdateNotification('✅ Семестры обновлены');
}