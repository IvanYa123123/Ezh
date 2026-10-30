// Обёртки над fetch. Все запросы автоматически проверяют на ошибки HTTP
// и прокидывают err.status, чтобы вызывающий код мог обрабатывать 401/429
// без парсинга строки сообщения.
//
// v3.7.0:
//   • Единая точка apiFetch(). Через неё идут ВСЕ запросы, поэтому
//     поддержка APP_TOKEN появилась во всём приложении сразу, а не
//     только в тех модулях, где вспомнили добавить заголовок.
//   • Токен можно передать как ?token=... — он запоминается в
//     localStorage и убирается из адресной строки.

const AUTH_TOKEN_KEY = 'ezhAuthToken';

function _readAuthToken() {
    try {
        const url = new URL(window.location.href);
        const fromUrl = url.searchParams.get('token');
        if (fromUrl) {
            localStorage.setItem(AUTH_TOKEN_KEY, fromUrl);
            url.searchParams.delete('token');
            const qs = url.searchParams.toString();
            window.history.replaceState({}, '', url.pathname + (qs ? '?' + qs : '') + url.hash);
            return fromUrl;
        }
        return localStorage.getItem(AUTH_TOKEN_KEY) || '';
    } catch (e) {
        return '';
    }
}

let _authToken = _readAuthToken();

function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (_authToken) headers['X-Auth-Token'] = _authToken;
    return headers;
}

// Базовый fetch: заголовки авторизации + единый формат ошибки.
async function apiFetch(url, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = authHeaders(opts.headers);
    const r = await fetch(url, opts);
    if (!r.ok) {
        const err = new Error(`HTTP ${r.status} for ${url}`);
        err.status = r.status;
        err.response = r;
        throw err;
    }
    return r;
}

async function apiGet(url) {
    return (await apiFetch(url)).json();
}

async function apiPost(url, body) {
    const r = await apiFetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    return r.json();
}

async function apiPut(url, body) {
    const r = await apiFetch(url, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    return r.json();
}

async function apiDelete(url) {
    const r = await apiFetch(url, { method: 'DELETE' });
    return r.json();
}

async function apiLoadGroups()            { return apiGet('/api/groups'); }
async function apiAddCustomGroup(name)    { return apiPost('/api/groups/custom', {name}); }
async function apiLoadSchedule(group, sg) { return apiGet(`/api/schedule_all?group=${encodeURIComponent(group)}&subgroup=${sg}`); }
async function apiSyncSchedule(group, sg) { return apiGet(`/api/schedule_sync?group=${encodeURIComponent(group)}&subgroup=${sg}`); }
async function apiLoadLabs(group)         { return apiGet(`/api/labs?group=${encodeURIComponent(group)}`); }
async function apiSaveLabs(items)         { return apiPost('/api/labs', items); }
async function apiLoadTasks(start, end)   { return apiGet(`/api/tasks?start=${start}&end=${end}`); }
async function apiCreateTask(t)           { return apiPost('/api/tasks', t); }
async function apiUpdateTask(id, t)       { return apiPut(`/api/tasks/${id}`, t); }
async function apiDeleteTask(id)          { return apiDelete(`/api/tasks/${id}`); }
async function apiLoadTaskDates()         { return apiGet('/api/task_dates'); }
async function apiLoadFriends()           { return apiGet('/api/friends'); }
async function apiCreateFriend(f)         { return apiPost('/api/friends', f); }
async function apiUpdateFriend(id, f)     { return apiPut(`/api/friends/${id}`, f); }
async function apiDeleteFriend(id)        { return apiDelete(`/api/friends/${id}`); }
async function apiLoadSubjects()          { return apiGet('/api/subjects'); }
async function apiSaveSubject(s)          { return apiPost('/api/subjects', s); }
async function apiLoadCustomSchedule(g)   { return apiGet(`/api/custom_schedule?group=${encodeURIComponent(g)}`); }
async function apiCreateCustomSchedule(x) { return apiPost('/api/custom_schedule', x); }
async function apiUpdateCustomSchedule(id, x) { return apiPut(`/api/custom_schedule/${id}`, x); }
async function apiDeleteCustomSchedule(id)    { return apiDelete(`/api/custom_schedule/${id}`); }
async function apiSearch(q)                   { return apiGet(`/api/search?q=${encodeURIComponent(q)}`); }
async function apiSyncScheduleForce(group, sg){ return apiGet(`/api/schedule_sync?group=${encodeURIComponent(group)}&subgroup=${sg}&force=1`); }

// ============================================================
//  ЛАБЫ ПОШТУЧНО (lab_items)
// ============================================================
async function apiLoadLabItems(group)               { return apiGet(`/api/lab_items?group=${encodeURIComponent(group)}`); }
async function apiSyncLabItems(group, items)        { return apiPost('/api/lab_items/sync', {group, items}); }
async function apiUpdateLabItem(id, patch)          { return apiPut(`/api/lab_items/${id}`, patch); }
async function apiAddLabItem(group, subject)        { return apiPost('/api/lab_items/add', {group, subject}); }
async function apiRemoveLastLabItem(group, subject) { return apiPost('/api/lab_items/remove_last', {group, subject}); }

// ============================================================
//  РЕЗЕРВНАЯ КОПИЯ
// ============================================================
async function apiLoadBackup()           { return apiGet('/api/backup'); }
async function apiRestoreBackup(payload) { return apiPost('/api/backup', payload); }

// ============================================================
//  ЕДИНЫЙ МАППИНГ ОШИБОК → ЧЕЛОВЕЧЕСКИЙ ТЕКСТ
// ------------------------------------------------------------
//  Раньше было три копии одного и того же маппинга:
//    • main.js   — _errorText(err)
//    • refresh.js — inline-парсер /HTTP (\d+)/ по err.message
//    • search.js  — inline-парсинг e.status
//  Это неизбежно расходилось при правках. Теперь одна функция,
//  а специфика конкретного экрана (например, «сервер СевГУ
//  недоступен» для 502/503/504) передаётся через overrides.
//
//  opts.subject   — «расписание», «поиск», «заметки»… попадает
//                    в текст для 404, чтобы было понятнее.
//  opts.fallback  — текст, если вообще нет ни status, ни message.
//  opts.overrides — { [status]: 'свой текст' }. Если статус
//                    совпал — возвращается это, а не базовый.
// ============================================================

function apiErrorText(err, opts = {}) {
    const status = (err && err.status) || _statusFromMessage(err);

    if (status !== null && status !== undefined) {
        const overrides = opts.overrides || {};
        if (overrides[status]) return overrides[status];
    }

    if (status === 401) return 'Требуется авторизация.';
    if (status === 403) return 'Доступ запрещён.';
    if (status === 404) {
        return opts.subject
            ? `Не найдено (${opts.subject}).`
            : 'Не найдено.';
    }
    if (status === 409) return 'Данные ещё не готовы. Попробуйте позже.';
    if (status === 429) return 'Слишком много запросов. Подождите минуту и попробуйте снова.';
    if (status === 499) return 'Запрос отменён.';
    if (status >= 500)  return 'Ошибка на сервере. Загляните в окно консоли приложения.';
    if (status)         return `Ошибка HTTP ${status}.`;

    if (err && err.message === 'Cancelled') return 'Запрос отменён.';
    if (err && err.message) return err.message;

    return opts.fallback || 'Не удалось выполнить запрос.';
}

function _statusFromMessage(err) {
    if (!err || !err.message) return null;
    const m = /HTTP (\d+)/.exec(err.message);
    return m ? parseInt(m[1], 10) : null;
}
