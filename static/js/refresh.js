// Принудительное обновление расписания с сервера СевГУ.
//
// Порядок работы (важно!):
//   1. showGlobalLoader() вызывается ПЕРВЫМ, до любых await.
//   2. Каждый шаг пишет в лоадер свой текст через setLoaderText().
//   3. Любая ошибка — console.error + понятный тост.
//   4. В finally лоадер скрывается, кнопка разблокируется.
//
// Защита от нажатий. Флаг _refreshInFlight предотвращает
// параллельный запуск: если предыдущий refresh ещё в работе,
// повторное нажатие игнорируется. Без этого бэкенд на лимите
// 10/min возвращал HTTP 429.

let _refreshInFlight = false;

// Пока шёл сетевой запрос, пользователь мог сменить группу. В этом
// случае ответ по старой группе применять нельзя — иначе он перезапишет
// cachedSchedule и перерисует календарь новой группы старыми парами.
function _stillSameSelection(group, subgroup) {
    const g = (document.getElementById('groupSelect')?.value || '').trim();
    const s = document.getElementById('subgroupSelect')?.value;
    return g === group && (subgroup === undefined || s === subgroup);
}

async function manualRefreshTeacher() {
    const teacher = (typeof getEzhTeacher === 'function')
        ? getEzhTeacher()
        : { slug: localStorage.getItem('ezhTeacherSlug') || '', name: '' };

    if (!teacher.slug) {
        if (typeof openTeacherRolePicker === 'function') openTeacherRolePicker();
        return;
    }

    const btn  = document.getElementById('refreshBtn');
    const icon = document.getElementById('refreshIcon');

    _refreshInFlight = true;
    showGlobalLoader('🔄 Обновляем расписание преподавателя...');
    if (btn)  btn.disabled = true;
    if (icon) icon.classList.add('refresh-spinning');

    // Погода обновляется параллельно с расписанием.
    if (typeof refreshWeather === 'function') refreshWeather();

    try {
        setLoaderText('🌐 Проверяем сайт расписания...');
        let health = null;
        try { health = await apiScheduleHealth(); } catch (e) { health = null; }
        if (!health || !health.ok) {
            // Health-проверка может ошибаться (DDoS-Guard отдаёт 502
            // браузеру иначе, чем API). Не блокируем обновление —
            // настоящую ошибку покажет сама синхронизация.
            showUpdateNotification('⚠️ Сайт расписания не ответил на проверку — пробуем синхронизацию напрямую…');
        }

        const raw = await apiGet('/api/teacher_schedule?slug='
            + encodeURIComponent(teacher.slug) + '&force=1');
        cachedSchedule = applyTimeFix(
            typeof teacherScheduleItems === 'function' ? teacherScheduleItems(raw) : (Array.isArray(raw) ? raw : [])
        );
        customScheduleItems = [];
        renderCalendar();
        updateScheduleStatus();
        refreshNotifications();
        const count = Array.isArray(cachedSchedule) ? cachedSchedule.length : 0;
        showUpdateNotification(`✅ Расписание преподавателя обновлено (${count} пар)`);
    } catch (e) {
        console.error('[refresh] teacher ERROR:', e);
        showUpdateNotification(`❌ ${apiErrorText(e, {
            subject: 'расписание преподавателя',
            fallback: 'Не удалось обновить расписание'
        })}`);
    } finally {
        hideGlobalLoader();
        if (btn)  btn.disabled = false;
        if (icon) icon.classList.remove('refresh-spinning');
        _refreshInFlight = false;
    }
}

async function manualRefresh() {
    if (_refreshInFlight) return;

    if (typeof isTeacherRole === 'function' && isTeacherRole()) {
        return manualRefreshTeacher();
    }

    const group    = (document.getElementById('groupSelect').value || '').trim();
    const subgroup = document.getElementById('subgroupSelect').value;

    if (!group) {
        alert('Сначала выберите группу');
        return;
    }

    const btn  = document.getElementById('refreshBtn');
    const icon = document.getElementById('refreshIcon');

    console.log('[refresh] START group=%s subgroup=%s', group, subgroup);

    _refreshInFlight = true;
    showGlobalLoader(`🔄 Обновляем «${group}» с СевГУ...`);
    if (btn)  btn.disabled = true;
    if (icon) icon.classList.add('refresh-spinning');

    // Погода обновляется параллельно с расписанием.
    if (typeof refreshWeather === 'function') refreshWeather();

    try {
        // --- 0. Проверяем, жив ли сайт расписания ---
        setLoaderText('🌐 Проверяем сайт расписания...');
        let health = null;
        try { health = await apiScheduleHealth(group); } catch (e) { health = null; }
        if (!health || !health.ok) {
            // Не блокируем: проверка может дать ложный минус, а реальный
            // sync ниже всё равно вернёт понятную ошибку при недоступности.
            showUpdateNotification('⚠️ Сайт расписания не ответил на проверку — пробуем синхронизацию напрямую…');
        }

        // --- 1. Форсим sync с сервера ---
        setLoaderText('📡 Запрашиваем расписание (может занять 5–15 сек)...');
        const fresh = await apiSyncScheduleForce(group, subgroup);
        console.log('[refresh] sync response:',
                    Array.isArray(fresh) ? `${fresh.length} items` : typeof fresh);

        if (!_stillSameSelection(group, subgroup)) {
            console.log('[refresh] selection changed during sync — result discarded');
            return;
        }

        if (Array.isArray(fresh) && fresh.length > 0) {
            cachedSchedule = applyTimeFix(fresh);
            if (typeof saveSyncTime === 'function') {
                saveSyncTime(group, subgroup);
            }
        } else {
            // Пустой ответ может значить: сработала защита от затирания
            // (сервер вернул старый кэш), либо у группы реально нет пар.
            setLoaderText('📦 Загружаем из локального кэша...');
            const fallback = await apiLoadSchedule(group, subgroup);
            if (!_stillSameSelection(group, subgroup)) return;
            cachedSchedule = applyTimeFix(fallback);
        }

        // --- 2. Кастомное расписание + настройки предметов ---
        setLoaderText('📚 Подтягиваем события и настройки предметов...');
        const [cs, subjects] = await Promise.all([
            apiLoadCustomSchedule(group).catch(() => []),
            apiLoadSubjects().catch(() => ({}))
        ]);
        if (!_stillSameSelection(group, subgroup)) {
            console.log('[refresh] selection changed before render — result discarded');
            return;
        }
        customScheduleItems   = cs;
        cachedSubjectSettings = subjects;

        // --- 3. Лабы + даты заметок ---
        setLoaderText('📊 Пересчитываем статистику...');
        await updateLabsCache();
        await refreshTaskDates();

        if (!_stillSameSelection(group, subgroup)) {
            console.log('[refresh] selection changed during labs load — render skipped');
            return;
        }

        // --- 4. Друзья в фоне (не блокируем UI) ---
        if (typeof syncFriendsSchedules === 'function') {
            syncFriendsSchedules(true).catch(e => console.error('[refresh] friends sync failed', e));
        }

        // --- 5. Перерисовка ---
        setLoaderText('🎨 Рисуем календарь...');
        renderCalendar();
        try { renderCharts(); } catch (e) { console.error('[refresh] renderCharts failed', e); }
        updateScheduleStatus();
        refreshNotifications();
        if (typeof renderSyncFreshness === 'function') renderSyncFreshness();

        const count = Array.isArray(cachedSchedule) ? cachedSchedule.length : 0;
        showUpdateNotification(`✅ Расписание обновлено (${count} пар)`);
        console.log('[refresh] OK, %d pairs', count);

    } catch (e) {
        console.error('[refresh] ERROR:', e);

        // Общий маппинг ошибок — в api.js (apiErrorText).
        // Специфика СевГУ уходит через overrides, чтобы не держать
        // здесь ещё один inline-парсер /HTTP (\d+)/ по err.message.
        const msg = apiErrorText(e, {
            subject: 'расписание',
            fallback: 'Не удалось обновить расписание',
            overrides: {
                429: '⏳ Слишком часто. Расписание можно обновлять не чаще 10 раз в минуту — подождите немного и попробуйте снова',
                502: '🌐 Сервер СевГУ недоступен. Попробуйте позже',
                503: '🌐 Сервер СевГУ недоступен. Попробуйте позже',
                504: '🌐 Сервер СевГУ недоступен. Попробуйте позже',
            }
        });
        showUpdateNotification(`❌ ${msg}`);

    } finally {
        hideGlobalLoader();
        if (btn)  btn.disabled = false;
        if (icon) icon.classList.remove('refresh-spinning');
        _refreshInFlight = false;
        console.log('[refresh] DONE');
    }
}