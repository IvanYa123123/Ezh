// Точка входа.

document.addEventListener("DOMContentLoaded", async () => {
    try {
        showGlobalLoader();

        initSettings();
        initSearch();
        if (typeof initNotesWidget === 'function') initNotesWidget();

        await ensureGroupsLoaded();
        initGroupAutocomplete(document.getElementById('groupSelect'));
        initGroupAutocomplete(document.getElementById('friendGroup'));

        await refreshTaskDates();

        initNotifications();

        updateScheduleStatus();
        restartStatusTimer();

        if (localStorage.getItem('savedGroup')) {
            document.getElementById('groupSelect').value = localStorage.getItem('savedGroup');
            if (localStorage.getItem('savedSubgroup')) {
                document.getElementById('subgroupSelect').value = localStorage.getItem('savedSubgroup');
            }
            await fetchSemesterData();
        } else {
            updateWeekDropdown();
            renderCalendar();
            renderCharts();
            renderMiniCalendar();
            hideGlobalLoader();
            fetchFriends();
        }
    } catch (e) {
        console.error(e);
        hideGlobalLoader();
    }
});

async function ensureGroupsLoaded() {
    if (groupsLoaded) return;
    try {
        let groups = await apiLoadGroups();
        if (groups && Array.isArray(groups)) {
            groups.forEach(g => {
                let name = typeof g === 'string' ? g : (g.name || g.title || JSON.stringify(g));
                name = String(name).trim();
                if (name && !validGroups.has(name.toUpperCase())) {
                    validGroups.add(name.toUpperCase());
                    allGroups.push(name);
                }
            });
        }
        groupsLoaded = true;
    } catch (e) { console.log("Справочник групп недоступен."); }
}

// ------------------------------------------------------------
//  Разбор ошибок от api.js.
//  Благодаря правкам в api.js, err.status теперь всегда есть.
// ------------------------------------------------------------
function _errorText(err) {
    if (err && err.status === 429) {
        return 'Слишком много запросов. Подожди минуту и обнови страницу.';
    }
    if (err && err.status === 401) {
        return 'Требуется авторизация.';
    }
    if (err && err.status >= 500) {
        return 'Ошибка на сервере. Загляни в окно консоли приложения.';
    }
    return 'Не удалось загрузить расписание.';
}

async function fetchSemesterData() {
    const group = document.getElementById("groupSelect").value.trim();
    const subgroup = document.getElementById("subgroupSelect").value;
    if (!group) return;

    showGlobalLoader();
    await ensureGroupsLoaded();

    if (validGroups.size > 0 && !validGroups.has(group.toUpperCase())) {
        hideGlobalLoader();
        let add = confirm(`Группа «${group}» не найдена в справочнике.\n\nДобавить её в вашу базу и попробовать загрузить расписание?`);
        if (!add) return;
        try {
            await apiAddCustomGroup(group);
            validGroups.add(group.toUpperCase());
            allGroups.push(group);
        } catch (e) { console.error(e); }
        showGlobalLoader();
    }

    localStorage.setItem('savedGroup', group);
    localStorage.setItem('savedSubgroup', subgroup);

    document.getElementById("calendar").innerHTML = "<h6 class='text-center w-100 mt-5'>Загрузка семестра...</h6>";

    let scheduleLoaded = false;
    try {
        let [data, customData] = await Promise.all([
            apiLoadSchedule(group, subgroup),
            apiLoadCustomSchedule(group)
        ]);
        customScheduleItems = customData;
        cachedSchedule = applyTimeFix(data);
        await Promise.all([
            updateLabsCache(),
            fetchSubjectSettings()
        ]);
        renderCalendar();
        scheduleLoaded = true;
    } catch (e) {
        console.error("fetchSemesterData failed:", e);
        const msg = _errorText(e);
        const extra = e.status ? `<div class="text-muted small mt-2">HTTP ${e.status}</div>` : '';
        document.getElementById("calendar").innerHTML = `
            <div class="empty-state empty-state-wide">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-title">Не удалось загрузить расписание</div>
                <div class="empty-state-text">${msg}</div>
                ${extra}
            </div>`;
        hideGlobalLoader();
        return;
    }

    if (scheduleLoaded) {
        try { renderCharts(); } catch (e) { console.error("renderCharts failed:", e); }
    }

    hideGlobalLoader();
    fetchFriends();
    updateScheduleStatus();
    refreshNotifications();
    syncSemesterData(group, subgroup);
}

async function syncSemesterData(group, subgroup) {
    try {
        let newData = applyTimeFix(await apiSyncSchedule(group, subgroup));

        if (!Array.isArray(newData) || newData.length === 0) return;

        if (cachedSchedule && cachedSchedule.length > 0
            && newData.length < cachedSchedule.length * 0.9) {
            console.error("Критический сбой СевГУ: попытка затереть расписание.");
            return;
        }

        if (typeof saveSyncTime === 'function') {
            saveSyncTime(group, subgroup);
        }

        if (isScheduleDifferent(newData, cachedSchedule)) {
            cachedSchedule = newData;
            renderCalendar();
            try { renderCharts(); } catch (e) { console.error(e); }
            updateScheduleStatus();
            refreshNotifications();
            showUpdateNotification("Ваше расписание обновлено в фоне");
        }

        if (typeof renderSyncFreshness === 'function') renderSyncFreshness();

    } catch (e) {
        if (e.status === 429) {
            console.warn("[sync] rate-limited, попробуем позже");
            return;
        }
        console.error("Ошибка синхронизации расписания", e);
    }
}