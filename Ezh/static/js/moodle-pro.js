let moodleStats = [];
let moodleStatsTimestamp = 0;
let moodleSemesterConfig = JSON.parse(localStorage.getItem('moodleSemesterConfig') || '{}');
let proSubjectChart = null;
let isMoodleRefreshing = false;
let moodleAbortController = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const status = await apiGet('/api/moodle/status');
        setProMode(status.logged_in);
        if (status.logged_in) {
            await loadMoodleStats(false);
            if (!sessionStorage.getItem('moodle_bg_refreshed')) {
                sessionStorage.setItem('moodle_bg_refreshed', '1');
                loadMoodleStats(true, true);
            }
        }
    } catch (e) {}
});

async function openMoodleModal() {
    const modalEl = document.getElementById('moodleModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();

    const status = await apiGet('/api/moodle/status');
    if (status.logged_in) {
        showMoodleStatsView();
        loadMoodleStats(false);
    } else {
        showMoodleLoginView();
    }
}

function showMoodleLoginView() {
    document.getElementById('moodleLoginForm').style.display = 'block';
    document.getElementById('moodleStatsArea').style.display = 'none';
}

function showMoodleStatsView() {
    document.getElementById('moodleLoginForm').style.display = 'none';
    document.getElementById('moodleStatsArea').style.display = 'block';
}

function setProMode(isActive) {
    const badge = document.getElementById('app-mode-badge');
    window.isProActive = isActive;
    
    if (isActive) {
        badge.className = 'badge bg-primary ms-2 rounded-pill';
        badge.textContent = 'Pro';
        badge.title = 'Режим Pro активен (Нажмите для настроек)';
    } else {
        badge.className = 'badge bg-secondary ms-2 rounded-pill';
        badge.textContent = 'Basic';
        badge.title = 'Базовая версия (Нажмите для входа)';
    }

    // Переключение тумблеров в настройках
    const proToggles = document.querySelectorAll('.pro-widget-toggle');
    const basicLabsLabel = document.getElementById('label-settingsToggleWidgetLabs');
    
    proToggles.forEach(el => el.style.display = isActive ? '' : 'none');
    if (basicLabsLabel) basicLabsLabel.style.display = isActive ? 'none' : '';

    // Принудительно перерисовываем видимость виджетов
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

async function doMoodleLogout() {
    if (!confirm('Выйти из аккаунта Moodle?')) return;
    await apiPost('/api/moodle/logout', {});
    showMoodleLoginView();
    setProMode(false);
    sessionStorage.removeItem('moodle_bg_refreshed');
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
    
    if (!isBackground && container && document.getElementById('moodleStatsArea').style.display === 'block') {
        container.innerHTML = '<div class="text-center py-4"><span class="spinner-border text-primary"></span><div class="mt-2 text-muted small">Собираем данные из Moodle (это может занять до 5 минут)...</div></div>';
    }
    
    if (document.getElementById('app-mode-badge').textContent === 'Pro') {
        if (!isBackground) document.getElementById('proAvgGradeText').innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }

    try {
        const url = `/api/moodle/stats?force=${force ? '1' : '0'}`;
        const fetchOpts = {};
        if (moodleAbortController) fetchOpts.signal = moodleAbortController.signal;
        
        const rawResp = await fetch(url, fetchOpts);
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
        
        renderMoodleStats();
        renderProWidgets();

        const ageSpan = document.getElementById('moodleDataAge');
        if (ageSpan) ageSpan.textContent = formatAge(moodleStatsTimestamp);

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

function renderMoodleStats() {
    const container = document.getElementById('moodleStatsContent');
    if (!moodleStats || moodleStats.length === 0) {
        if (container) container.innerHTML = '<div class="text-muted text-center py-3">Нет данных о курсах.</div>';
        return;
    }

    let currentCourses = moodleStats.filter(c => isCourseInCurrentSchedule(c.name, c.id));

    let html = `
        <div class="d-flex justify-content-between align-items-center mb-3 p-2 bg-light rounded shadow-sm flex-wrap gap-2">
            <div class="small fw-bold text-muted">Показаны предметы текущего семестра (${currentCourses.length})</div>
            <button class="btn btn-sm btn-success fw-bold" onclick="syncMoodleToWidgets()">📥 Синхронизировать с виджетами</button>
        </div>
        <div class="moodle-courses-list">
    `;

    currentCourses.forEach(course => {
        if (course.assignments.length === 0) return;

        let doneCount = course.assignments.filter(a => a.status === 'Сдано' || a.status === 'На проверке').length;
        let total = course.assignments.length;

        html += `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                    <span class="fw-bold small text-truncate" style="max-width: 80%;" title="${escapeHtml(course.name)}">📚 ${escapeHtml(course.name)}</span>
                    <span class="badge ${doneCount === total ? 'bg-success' : 'bg-primary'}">${doneCount} / ${total}</span>
                </div>
                <ul class="list-group list-group-flush small">
        `;

        course.assignments.forEach(act => {
            let badgeClass = 'bg-secondary';
            if (act.status === 'Сдано') badgeClass = 'bg-success';
            else if (act.status === 'На проверке') badgeClass = 'bg-warning text-dark';
            else if (act.status === 'Не сдано') badgeClass = 'bg-danger';
            else if (act.status === 'Тест') badgeClass = 'bg-info text-dark';

            let dueHtml = act.due ? `<span class="text-muted ms-2" style="font-size:0.85em;">📅 ${escapeHtml(act.due)}</span>` : '';

            html += `
                <li class="list-group-item py-2 d-flex justify-content-between align-items-center">
                    <div class="text-truncate pe-2" style="max-width: 60%;" title="${escapeHtml(act.name)}">
                        ${escapeHtml(act.name)} ${dueHtml}
                    </div>
                    <div class="text-end">
                        <span class="badge ${badgeClass}">${escapeHtml(act.status)}</span>
                        ${act.grade !== '—' ? `<span class="ms-1 badge bg-success">${escapeHtml(act.grade)}</span>` : ''}
                    </div>
                </li>
            `;
        });

        html += `</ul></div>`;
    });
    html += '</div>';
    if (container) container.innerHTML = html;
}

function extractLabNum(name) {
    const match = name.match(/(?:ЛР|ЛЗ|ПЗ|Лабораторная работа|Практическое задание|Практическая работа|Лабораторное занятие|Лабораторная)\s*№?\s*(\d+(?:\.\d+)?)/i);
    return match ? match[1] : null;
}

async function syncMoodleToWidgets() {
    if (!cachedSchedule || cachedSchedule.length === 0) {
        alert("Сначала загрузите расписание, чтобы мы знали, к каким предметам привязывать лабы.");
        return;
    }

    if (!confirm("Синхронизировать сданные работы из Moodle с вашими виджетами «Лабораторные»?\n\nДубликаты (например, ЛР №1 и ЛР №1. архив) будут объединены.")) return;

    let updatedCount = 0;
    let payload = [];
    let labItemsPayload = [];

    for (const course of moodleStats) {
        if (!isCourseInCurrentSchedule(course.name, course.id)) continue;

        let uniqueLabs = {};
        course.assignments.forEach(a => {
            if (a.type !== 'assign') return;
            let num = extractLabNum(a.name);
            if (!num) return;

            if (!uniqueLabs[num]) {
                uniqueLabs[num] = a;
            } else {
                if (a.status === 'Сдано' && uniqueLabs[num].status !== 'Сдано') uniqueLabs[num] = a;
                else if (a.status === 'На проверке' && uniqueLabs[num].status === 'Ожидает') uniqueLabs[num] = a;
            }
        });

        let totalLabs = Object.keys(uniqueLabs).length;
        let doneLabs = Object.values(uniqueLabs).filter(a => a.status === 'Сдано' || a.status === 'На проверке').length;

        if (totalLabs === 0) continue;

        let cleanCourse = course.name.replace(/\([^)]*\)/g, '').trim().toLowerCase();
        let matchingSubjects = new Set();

        cachedSchedule.forEach(item => {
            if (item.type_name !== 'ЛЗ' && item.type_name !== 'ПЗ') return;
            let lessonName = item.lesson.toLowerCase();
            
            if (cleanCourse.includes(lessonName) || lessonName.includes(cleanCourse)) {
                matchingSubjects.add(`${item.lesson} (${item.type_name})`);
            }
        });

        for (const subj of matchingSubjects) {
            payload.push({
                group: document.getElementById('groupSelect').value.trim(),
                subject: subj,
                completed: doneLabs,
                total: totalLabs
            });
            updatedCount++;
        }
    }

    if (payload.length === 0) {
        alert("Не удалось найти совпадений.");
        return;
    }

    try {
        await apiSaveLabs(payload);
        
        const group = document.getElementById('groupSelect').value.trim();
        let currentLabItems = await apiLoadLabItems(group);
        
        let itemsToUpdate = [];
        for (const course of moodleStats) {
            if (!isCourseInCurrentSchedule(course.name, course.id)) continue;
            let cleanCourse = course.name.replace(/\([^)]*\)/g, '').trim().toLowerCase();
            
            cachedSchedule.forEach(item => {
                if (item.type_name !== 'ЛЗ' && item.type_name !== 'ПЗ') return;
                let lessonName = item.lesson.toLowerCase();
                if (!cleanCourse.includes(lessonName) && !lessonName.includes(cleanCourse)) return;
                
                let subjKey = `${item.lesson} (${item.type_name})`;
                let labList = currentLabItems[subjKey] || [];
                
                course.assignments.forEach(a => {
                    if (a.type !== 'assign') return;
                    let num = extractLabNum(a.name);
                    if (!num) return;
                    
                    let isDone = (a.status === 'Сдано' || a.status === 'На проверке' || a.status === 'Черновик');
                    if (!isDone) return;
                    
                    let matchingItem = labList.find(l => {
                        let itemNum = extractLabNum(l.title);
                        return itemNum === num;
                    });
                    
                    if (matchingItem && !matchingItem.completed) {
                        itemsToUpdate.push({ id: matchingItem.id, completed: 1 });
                    }
                });
            });
        }

        if (itemsToUpdate.length > 0) {
            for (const item of itemsToUpdate) {
                await apiUpdateLabItem(item.id, { completed: item.completed });
            }
        }

        await updateLabsCache();
        renderCharts();
        alert(`Успешно синхронизировано предметов: ${updatedCount}. Отмечено сданных лаб: ${itemsToUpdate.length}.`);
    } catch (e) {
        console.error(e);
        alert("Ошибка при сохранении данных.");
    }
}

// ==========================================
//  РЕНДЕР ПРО-ВИДЖЕТОВ
// ==========================================

function renderProWidgets() {
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

    // Рендер Pro-виджета Лабораторные
    if (window.isProActive) {
        let done = 0, attached = 0, remaining = 0;
        currentCourses.forEach(c => {
            c.assignments.forEach(a => {
                if (a.type !== 'assign') return;
                if (a.status === 'Сдано') done++;
                else if (a.status === 'На проверке' || a.status === 'Черновик') attached++;
                else remaining++;
            });
        });
        
        if (typeof globalLabChartPro !== 'undefined' && globalLabChartPro) {
            globalLabChartPro.data.labels = ['Сдано', 'Прикреплено', 'Осталось'];
            globalLabChartPro.data.datasets[0].data = [done, attached, remaining];
            globalLabChartPro.data.datasets[0].backgroundColor = ['#10b981', '#f59e0b', '#94a3b8'];
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
                            backgroundColor: ['#10b981', '#f59e0b', '#94a3b8'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom' } }
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
            if (proSubjectChart) proSubjectChart.destroy();
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
                if (a.status === 'Сдано') subjectStats[subj].done++;
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
                    <span style="color:var(--status-green);">${st.done}</span> / 
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
        let html = '';
        sortedLabs.forEach(lab => {
            let gradeText = lab.grade_num ? lab.grade_num : '—';
            html += `
                <div class="widget-details-row" title="${escapeHtml(lab.name)}">
                    <span class="widget-details-title">${escapeHtml(lab.name)}</span>
                    <span class="widget-details-nums">${gradeText}</span>
                </div>
            `;
        });
        if (html === '') html = '<div class="text-muted small">Нет данных</div>';
        detailsEl.innerHTML = html;
    }

    if (proSubjectChart) proSubjectChart.destroy();
    const ctx = document.getElementById('proSubjectChart');
    if (ctx && ctx.offsetParent !== null) {
        proSubjectChart = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Балл',
                        data: data,
                        backgroundColor: '#6366f1',
                        borderRadius: 4,
                        barPercentage: 0.6
                    },
                    {
                        type: 'line',
                        label: 'Соединение',
                        data: data,
                        borderColor: '#10b981',
                        borderWidth: 2,
                        tension: 0.3,
                        spanGaps: true,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: '#10b981',
                        pointBorderWidth: 2,
                        pointRadius: 4
                    },
                    {
                        type: 'line',
                        label: 'Среднее',
                        data: Array(labels.length).fill(avgGrade),
                        borderColor: '#f59e0b',
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
                    y: {
                        min: 50,
                        max: Math.max(100, Math.ceil(maxGrade / 10) * 10), 
                        title: { display: true, text: 'Баллы' }
                    }
                },
                plugins: { 
                    legend: { display: false },
                    tooltip: {
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

function allowDrop(ev) {
    ev.preventDefault();
}

function handleSemesterDrop(ev, targetColumn) {
    ev.preventDefault();
    if (!draggedCourseId) return;
    
    const targetList = targetColumn === 'current' ? document.getElementById('currentSemesterList') : document.getElementById('pastSemesterList');
    const draggedEl = document.querySelector(`[data-id="${draggedCourseId}"]`);
    if (draggedEl) {
        targetList.appendChild(draggedEl);
    }
    draggedCourseId = null;
}

function saveMoodleSetup() {
    const currentList = document.getElementById('currentSemesterList');
    const pastList = document.getElementById('pastSemesterList');
    
    let newConfig = {};
    
    currentList.querySelectorAll('li').forEach(li => {
        newConfig[li.dataset.id] = 'current';
    });
    pastList.querySelectorAll('li').forEach(li => {
        newConfig[li.dataset.id] = 'past';
    });

    moodleSemesterConfig = newConfig;
    localStorage.setItem('moodleSemesterConfig', JSON.stringify(newConfig));
    
    bootstrap.Modal.getInstance(document.getElementById('moodleSetupModal')).hide();
    renderMoodleStats();
    renderProWidgets();
    if (typeof showUpdateNotification === 'function') showUpdateNotification('✅ Семестры обновлены');
}