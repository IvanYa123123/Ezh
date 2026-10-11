// Точка входа: инициализация, загрузка расписания, синхронизация, настройки видимости.

document.addEventListener("DOMContentLoaded", async () => {
    try {
        showGlobalLoader();

        ['globalStatsBody', 'labStatsBody', 'labPacingBody'].forEach(bodyId => {
            let state = localStorage.getItem('widget_' + bodyId);
            if (state === 'collapsed') {
                let body = document.getElementById(bodyId);
                if (body) {
                    let btn = body.previousElementSibling.querySelector('button');
                    if (!body.dataset.originalHeight) {
                        body.dataset.originalHeight = body.style.height || (bodyId === 'labPacingBody' ? 'auto' : '160px');
                    }
                    body.style.overflow = 'hidden';
                    body.style.height = '0px';
                    if (btn) btn.textContent = '+';
                }
            }
        });

        initSettings();
        initSearch();

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

function updateDisplayPrefs() {
    showTeacher  = localStorage.getItem('showTeacher')  !== 'false';
    showLocation = localStorage.getItem('showLocation') !== 'false';
    showFriends  = localStorage.getItem('showFriends')  !== 'false';
    renderCalendar();
}

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
        // updateLabsCache и fetchSubjectSettings друг от друга не зависят
        // и трогают разные поля состояния — грузим параллельно.
        await Promise.all([
            updateLabsCache(),
            fetchSubjectSettings()
        ]);
        renderCalendar();
        scheduleLoaded = true;
    } catch (e) {
        console.error("fetchSemesterData failed:", e);
        document.getElementById("calendar").innerHTML = `<h6 class='text-center text-danger w-100 mt-5'>Ошибка загрузки</h6>`;
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

// ============================================================
//  ФОНОВАЯ СИНХРОНИЗАЦИЯ РАСПИСАНИЯ
// ------------------------------------------------------------
//  Сервер отдаёт [] если троттлинг (6 часов) ещё не истёк или
//  если расписание не изменилось.
//
//  saveSyncTime вызывается ВСЕГДА, когда сервер вернул непустой
//  массив — то есть «мы успешно поговорили с СевГУ и получили
//  расписание». Раньше таймер обновлялся только если данные
//  изменились, из-за чего индикатор свежести «залипал» на
//  «📦 давно», даже если синхронизация шла нормально.
// ============================================================
async function syncSemesterData(group, subgroup) {
    try {
        let newData = applyTimeFix(await apiSyncSchedule(group, subgroup));

        // Пустой ответ может значить две вещи:
        //   • троттлинг на сервере (мы синхронизировались <6ч назад)
        //   • у группы реально нет пар
        // В обоих случаях таймер НЕ трогаем — фактической синхронизации не было.
        if (!Array.isArray(newData) || newData.length === 0) return;

        // Защита от «обнуления»: если сервер вернул заметно меньше пар —
        // это сбой, а не реальное расписание. Ничего не делаем.
        if (cachedSchedule && cachedSchedule.length > 0
            && newData.length < cachedSchedule.length * 0.9) {
            console.error("Критический сбой СевГУ: попытка затереть расписание.");
            return;
        }

        // Обновляем таймер свежести в любом случае: синхронизация прошла.
        if (typeof saveSyncTime === 'function') {
            saveSyncTime(group, subgroup);
        }

        // Перерисовываем только если содержимое реально изменилось.
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
        console.error("Ошибка синхронизации расписания", e);
    }
}