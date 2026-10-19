let moodleStats = [];

async function openMoodleModal() {
    const modalEl = document.getElementById('moodleModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();

    const status = await apiGet('/api/moodle/status');
    if (status.logged_in) {
        showMoodleStatsView();
        loadMoodleStats();
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
            loadMoodleStats();
        }
    } catch (e) {
        err.textContent = 'Неверный логин или пароль, либо ошибка сети.';
        err.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
    }
}

async function loadMoodleStats() {
    const container = document.getElementById('moodleStatsContent');
    container.innerHTML = '<div class="text-center py-4"><span class="spinner-border text-primary"></span><div class="mt-2 text-muted small">Загружаем данные из Moodle (это может занять 10-15 секунд)...</div></div>';
    
    try {
        moodleStats = await apiGet('/api/moodle/stats');
        renderMoodleStats();
    } catch (e) {
        container.innerHTML = `<div class="alert alert-danger">Ошибка: сессия устарела или сервер недоступен. <button class="btn btn-sm btn-outline-danger ms-2" onclick="openMoodleModal()">Перезайти</button></div>`;
    }
}

function renderMoodleStats() {
    const container = document.getElementById('moodleStatsContent');
    if (!moodleStats || moodleStats.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">Нет данных о курсах.</div>';
        return;
    }

    let html = '<div class="moodle-courses-list">';
    moodleStats.forEach(course => {
        if (course.assignments.length === 0) return;

        let doneCount = course.assignments.filter(a => a.status === 'Сдано' || a.status === 'На проверке').length;
        let total = course.assignments.length;

        html += `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                    <span class="fw-bold small text-truncate" style="max-width: 80%;" title="${escapeHtml(course.name)}">📚 ${escapeHtml(course.name)}</span>
                    <span class="badge bg-primary">${doneCount} / ${total}</span>
                </div>
                <ul class="list-group list-group-flush small">
        `;

        course.assignments.forEach(act => {
            let badgeClass = 'bg-secondary';
            if (act.status === 'Сдано') badgeClass = 'bg-success';
            else if (act.status === 'На проверке') badgeClass = 'bg-warning text-dark';
            else if (act.status === 'Не сдано') badgeClass = 'bg-danger';
            else if (act.status === 'Тест') badgeClass = 'bg-info text-dark';

            html += `
                <li class="list-group-item py-2 d-flex justify-content-between align-items-center">
                    <span class="text-truncate pe-2" style="max-width: 65%;" title="${escapeHtml(act.name)}">${escapeHtml(act.name)}</span>
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
    container.innerHTML = html;
}

async function doMoodleLogout() {
    if (!confirm('Выйти из аккаунта Moodle?')) return;
    await apiPost('/api/moodle/logout', {});
    showMoodleLoginView();
}