// Обёртки над fetch. Все запросы автоматически проверяют на ошибки HTTP.

async function apiGet(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
}

async function apiPost(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
}

async function apiPut(url, body) {
    const r = await fetch(url, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
}

async function apiDelete(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
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
// ------------------------------------------------------------
//  • apiLoadLabItems(group)              — { subject: [ {id, idx, title, completed}, ... ] }
//  • apiSyncLabItems(group, items)       — создать недостающие записи
//    (items: [{subject, count}]). Работает ТОЛЬКО в плюс:
//    не удаляет лишние, чтобы ручное добавление не затиралось.
//  • apiUpdateLabItem(id, {title, completed}) — обновить одну запись
//  • apiAddLabItem(group, subject)       — добавить одну в конец списка
//  • apiRemoveLastLabItem(group, subject)— удалить последнюю запись
// ============================================================
async function apiLoadLabItems(group)               { return apiGet(`/api/lab_items?group=${encodeURIComponent(group)}`); }
async function apiSyncLabItems(group, items)        { return apiPost('/api/lab_items/sync', {group, items}); }
async function apiUpdateLabItem(id, patch)          { return apiPut(`/api/lab_items/${id}`, patch); }
async function apiAddLabItem(group, subject)        { return apiPost('/api/lab_items/add', {group, subject}); }
async function apiRemoveLastLabItem(group, subject) { return apiPost('/api/lab_items/remove_last', {group, subject}); }