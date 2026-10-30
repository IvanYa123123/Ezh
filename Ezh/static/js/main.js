// Точка входа.
//
// v3.18.0:
//   • Первый заход: если savedGroup нет — показываем #groupSetupModal
//     (закрыть нельзя). После выбора группа хранится в localStorage.
//   • Изменить группу — только в настройках (там кнопка «Изменить»).
//   • В шапке — #groupDisplay (текст). Скрытые #groupSelect/#subgroupSelect
//     остаются для состояния, их value пишет confirmGroupSetup().
//   • initInlineSearch() — поиск теперь поле в шапке, не кнопка.
//   • startWeekLabelRotation() — кнопка недели чередует дату и номер.
//   • _errorText заменён на apiErrorText из api.js.

document.addEventListener("DOMContentLoaded", async () => {
    try {
        showGlobalLoader();

        initSettings();
        initSearch();
        initInlineSearch();
        initRipple();
        if (typeof initNotesWidget === 'function') initNotesWidget();

        await ensureGroupsLoaded();
        initGroupAutocomplete(document.getElementById('setupGroupInput'));
        // Поле «Группа» в модалке друга тоже должно подсказывать группы,
        // иначе приходилось вводить номер по памяти.
        initGroupAutocomplete(document.getElementById('friendGroup'));

        await refreshTaskDates();

        initNotifications();
        startWeekLabelRotation();

        updateScheduleStatus();
        restartStatusTimer();

        const savedGroup = localStorage.getItem('savedGroup');

        if (savedGroup) {
            document.getElementById('groupSelect').value = savedGroup;
            const savedSubgroup = localStorage.getItem('savedSubgroup');
            if (savedSubgroup) {
                document.getElementById('subgroupSelect').value = savedSubgroup;
            }
            updateGroupDisplay();
            await fetchSemesterData();
        } else {
            // Первый заход — показываем модалку выбора группы.
            // Календарь и виджеты рисуем сразу, чтобы фон не был пустым.
            updateWeekDropdown();
            renderCalendar();
            renderCharts();
            renderMiniCalendar();
            hideGlobalLoader();
            fetchFriends();

            setTimeout(() => openGroupSetup(true), 400);
        }
    } catch (e) {
        console.error(e);
        hideGlobalLoader();
    }
});

// ============================================================
//  ФОНОВАЯ СИНХРОНИЗАЦИЯ ПРИ ВОЗВРАТЕ НА ВКЛАДКУ
// ------------------------------------------------------------
//  Пока вкладка была в фоне, расписание могло устареть. Проверки
//  дешёвые: сервер сам решает по своему троттлингу (6 ч для группы)
//  и 30-минутному окну для друзей, поэтому «вхолостую» это почти
//  ничего не стоит, а пользователь сразу видит свежие пары.
// ============================================================

document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;

    const groupEl = document.getElementById('groupSelect');
    if (!groupEl) return;
    const group = (groupEl.value || '').trim();
    if (!group) return;

    const subgroup = document.getElementById('subgroupSelect')?.value || '0';

    if (typeof syncSemesterData === 'function') {
        try { syncSemesterData(group, subgroup); } catch (e) { console.error('[sync] tick failed', e); }
    }
    if (typeof syncFriendsSchedules === 'function') {
        try { syncFriendsSchedules().catch(() => {}); } catch (e) { /* ignore */ }
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
        const msg = apiErrorText(e, { subject: 'расписание' });
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

// ============================================================
//  ВЫБОР ГРУППЫ
// ============================================================

function openGroupSetup(force = false) {
    const modalEl = document.getElementById('groupSetupModal');
    if (!modalEl) return;

    const input    = document.getElementById('setupGroupInput');
    const select   = document.getElementById('setupSubgroupInput');
    const closeBtn = document.getElementById('groupSetupCloseBtn');

    const currentGroup = (document.getElementById('groupSelect').value || '').trim();
    const currentSub   = document.getElementById('subgroupSelect').value || '0';

    if (currentGroup) {
        input.value = currentGroup;
        select.value = currentSub;
    } else {
        input.value = '';
        select.value = '0';
    }

    // Закрыть крестиком можно только если группа уже выбрана.
    // Первый заход (force && нет группы) — модалка без крестика.
    if (force && !currentGroup) {
        closeBtn.style.display = 'none';
        modalEl.dataset.locked = '1';
    } else {
        closeBtn.style.display = '';
        delete modalEl.dataset.locked;
    }

    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl, {
        backdrop: 'static',
        keyboard: false,
    });
    modal.show();

    setTimeout(() => { if (input) input.focus(); }, 300);
}

function openGroupSetupFromSettings() {
    const settingsModalEl = document.getElementById('settingsModal');
    const settingsModal = bootstrap.Modal.getInstance(settingsModalEl);
    if (settingsModal) settingsModal.hide();

    // После скрытия настроек открываем модалку группы.
    setTimeout(() => openGroupSetup(false), 250);
}

async function confirmGroupSetup() {
    const groupInput    = document.getElementById('setupGroupInput');
    const subgroupInput = document.getElementById('setupSubgroupInput');
    const group = (groupInput.value || '').trim();
    const subgroup = subgroupInput.value || '0';

    if (!group) {
        alert('Введите группу');
        return;
    }

    await ensureGroupsLoaded();
    if (validGroups.size > 0 && !validGroups.has(group.toUpperCase())) {
        let add = confirm(`Группа «${group}» не найдена в справочнике.\n\nДобавить её?`);
        if (!add) return;
        try {
            await apiAddCustomGroup(group);
            validGroups.add(group.toUpperCase());
            allGroups.push(group);
        } catch (e) { console.error(e); }
    }

    document.getElementById('groupSelect').value = group;
    document.getElementById('subgroupSelect').value = subgroup;
    updateGroupDisplay();

    localStorage.setItem('savedGroup', group);
    localStorage.setItem('savedSubgroup', subgroup);

    const modalEl = document.getElementById('groupSetupModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    await fetchSemesterData();
}