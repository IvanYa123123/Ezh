// Модальное окно настроек.
//
// v3.18.0:
//   • Блок «Моя группа» с кнопкой «Изменить» (открывает #groupSetupModal).
//   • updateSettingsGroupValue() обновляет текст в этом блоке.

const SETTINGS_SECTIONS_KEY = 'settingsSections_v1';
const SETTINGS_SECTIONS_NAMES = ['display', 'widgets', 'status', 'notif'];

const THEME_NAMES = {
    light: 'Светлая', dark: 'Тёмная', forest: 'Лесная', sunset: 'Закат', ocean: 'Океан',
    hedgehog: 'Ежики', southpark: 'Южный парк', anime: 'Аниме',
    oled: 'OLED Deep', 'oled-warm': 'OLED Warm', custom: 'Своя тема'
};

function initSettings() {
    if (typeof migrateLegacyStorageIfNeeded === 'function') {
        migrateLegacyStorageIfNeeded()
            .then(() => {
                if (theme === 'custom' && typeof applyCustomTheme === 'function') {
                    applyCustomTheme();
                }
            })
            .catch(e => console.warn('[settings] migrate failed', e));
    }

    applyTheme();
    applyWidgetVisibility();
    if (typeof applyFriendsTeachersVisibility === 'function') applyFriendsTeachersVisibility();
    if (typeof initNotesWidget === 'function') initNotesWidget();
    if (typeof restoreNotesWidgetZone === 'function') restoreNotesWidgetZone();
    if (typeof initWidgetDragAndDrop === 'function') initWidgetDragAndDrop();
}

function updateCurrentThemeLabel() {
    const el = document.getElementById('currentThemeNameDisplay');
    if (el) {
        let displayName = THEME_NAMES[theme] || theme;
        if (theme === 'custom') {
            const activePresetName = localStorage.getItem('activeCustomPresetName');
            if (activePresetName) {
                displayName = activePresetName;
            }
        }
        el.textContent = displayName;
    }

    document.querySelectorAll('.theme-btn').forEach(btn => {
        const tid = btn.dataset.themeId;
        if (tid === theme) {
            if (theme === 'custom') {
                const activeName = localStorage.getItem('activeCustomPresetName');
                if (activeName) {
                    btn.classList.toggle('active', btn.dataset.presetName === activeName);
                } else {
                    btn.classList.toggle('active', btn.dataset.presetName === undefined);
                }
            } else {
                btn.classList.add('active');
            }
        } else {
            btn.classList.remove('active');
        }
    });
}

function setThemeFromSettings(id) {
    theme = id;
    localStorage.setItem('theme', id);

    if (id === 'custom') {
        const activeBtn = document.querySelector('.theme-btn.active');
        if (activeBtn && activeBtn.dataset.presetName === undefined) {
             localStorage.removeItem('activeCustomPresetName');
        }
    }

    applyTheme();
    updateCurrentThemeLabel();

    if (typeof updateCustomThemePanelVisibility === 'function') updateCustomThemePanelVisibility();

    renderCalendar();
    updateScheduleStatus();
    if (typeof refreshChartsTheme === 'function') refreshChartsTheme();
}

function renderQuickPresets() {
    const grid = document.getElementById('customThemesGrid');
    if (!grid) return;

    const presets = typeof loadCustomThemePresets === 'function' ? loadCustomThemePresets() : [];

    grid.innerHTML = `<button type="button" class="theme-btn" data-theme-id="custom" onclick="setThemeFromSettings('custom')">🎨 Активировать свою</button>`;

    presets.forEach((p, i) => {
        grid.innerHTML += `<button type="button" class="theme-btn" data-theme-id="custom" data-preset-index="${i}" data-preset-name="${escapeHtml(p.name)}" onclick="loadPresetFromSettings(${i})">🖌️ ${escapeHtml(p.name)}</button>`;
    });
}

function loadPresetFromSettings(index) {
    const presets = loadCustomThemePresets();
    if (presets[index]) {
        localStorage.setItem('activeCustomPresetName', presets[index].name);
    }
    if (typeof loadPreset === 'function') loadPreset(index);
    updateCurrentThemeLabel();
}

function updateSettingsGroupValue() {
    const el = document.getElementById('settingsGroupValue');
    if (!el) return;

    const group = (document.getElementById('groupSelect').value || '').trim();
    const sub = document.getElementById('subgroupSelect').value || '0';

    if (!group) {
        el.textContent = 'Не выбрана';
        return;
    }
    let text = group;
    if (sub === '1') text += ' · 1 подгр.';
    else if (sub === '2') text += ' · 2 подгр.';
    else text += ' · все';
    el.textContent = text;
}

function openSettingsModal() {
    document.getElementById('settingsToggleTeacher').checked  = showTeacher;
    document.getElementById('settingsToggleLocation').checked = showLocation;
    document.getElementById('settingsToggleFriends').checked  = showFriends;
    document.getElementById('settingsToggleStatus').checked   = showStatus;
    document.getElementById('settingsToggleSleepMode').checked = showSleepMode;

    // Моя группа
    updateSettingsGroupValue();

    // Формат общих пар
    const sharedPairSelect = document.getElementById('settingsSharedPairFormat');
    if (sharedPairSelect) {
        sharedPairSelect.value = (['time', 'pair_num'].includes(sharedPairFormat))
            ? sharedPairFormat
            : 'time';
    }

    // Базовые виджеты
    document.getElementById('settingsToggleWidgetMiniCal').checked = showWidgetMiniCal;
    document.getElementById('settingsToggleWidgetGlobal').checked  = showWidgetGlobal;
    document.getElementById('settingsToggleWidgetLabs').checked    = showWidgetLabs;
    document.getElementById('settingsToggleWidgetSuggestions').checked = showWidgetSuggestions;
    document.getElementById('settingsToggleWidgetPacing').checked  = showWidgetPacing;

    // Заметки 1/2/3
    document.getElementById('settingsToggleWidgetNotes1').checked = showWidgetNotes1;
    document.getElementById('settingsToggleWidgetNotes2').checked = showWidgetNotes2;
    document.getElementById('settingsToggleWidgetNotes3').checked = showWidgetNotes3;

    // Pro виджеты
    document.getElementById('settingsToggleWidgetLabsPro').checked = showWidgetLabsPro;
    document.getElementById('settingsToggleWidgetMoodleAvg').checked = showWidgetMoodleAvg;
    document.getElementById('settingsToggleWidgetMoodleSubj').checked = showWidgetMoodleSubj;

    document.getElementById('settingsToggleSeparateFriendsTeachers').checked = separateFriendsTeachers;
    document.getElementById('settingsToggleFriendsSection').checked  = showFriendsSection;
    document.getElementById('settingsToggleTeachersSection').checked = showTeachersSection;

    document.getElementById('settingsStatusFormat').value    = statusFormat;
    document.getElementById('settingsStatusPrecision').value = statusPrecision;

    document.getElementById('settingsNotifEnabled').checked = notificationsEnabled;
    document.getElementById('settingsNotifAdvance').value   = notificationAdvance;
    document.getElementById('settingsNotifUnit').value      = notificationUnit;

    updateNotificationsHint();
    restoreSettingsSections();

    if (typeof renderCustomThemePanel === 'function') renderCustomThemePanel();
    if (typeof updateCustomThemePanelVisibility === 'function') updateCustomThemePanelVisibility();

    renderQuickPresets();
    updateCurrentThemeLabel();

    let modalEl = document.getElementById('settingsModal');
    let modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

    const firstTab = document.getElementById('tab-general-tab');
    if (firstTab && typeof bootstrap !== 'undefined') {
        const tab = new bootstrap.Tab(firstTab);
        tab.show();
    }

    if (theme === 'custom') {
        modalEl.addEventListener('shown.bs.modal', () => {
            const appearanceTab = document.getElementById('tab-appearance-tab');
            if (appearanceTab) {
                const tab = new bootstrap.Tab(appearanceTab);
                tab.show();
            }
        }, { once: true });
    }

    modal.show();
}

function loadSettingsSections() {
    try {
        const raw = localStorage.getItem(SETTINGS_SECTIONS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
}

function saveSettingsSections(state) {
    try { localStorage.setItem(SETTINGS_SECTIONS_KEY, JSON.stringify(state)); } catch (e) {}
}

function toggleSettingsSection(name) {
    const body  = document.getElementById('settings-section-' + name);
    const arrow = document.getElementById('settings-arrow-' + name);
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.textContent = isHidden ? '▾' : '▸';
    const state = loadSettingsSections();
    state[name] = isHidden ? 'open' : 'closed';
    saveSettingsSections(state);
}

function restoreSettingsSections() {
    const state = loadSettingsSections();
    SETTINGS_SECTIONS_NAMES.forEach(name => {
        const body  = document.getElementById('settings-section-' + name);
        const arrow = document.getElementById('settings-arrow-' + name);
        if (!body) return;
        const isOpen = state[name] === 'open';
        body.style.display = isOpen ? 'block' : 'none';
        if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
    });
}

function saveSettingsFromUI() {
    showTeacher  = document.getElementById('settingsToggleTeacher').checked;
    showLocation = document.getElementById('settingsToggleLocation').checked;
    showFriends  = document.getElementById('settingsToggleFriends').checked;
    showStatus   = document.getElementById('settingsToggleStatus').checked;

    localStorage.setItem('showTeacher',  showTeacher);
    localStorage.setItem('showLocation', showLocation);
    localStorage.setItem('showFriends',  showFriends);
    localStorage.setItem('showStatus',   showStatus);

    const sharedPairSelect = document.getElementById('settingsSharedPairFormat');
    if (sharedPairSelect) {
        let sp = sharedPairSelect.value;
        if (!['time', 'pair_num'].includes(sp)) sp = 'time';
        sharedPairFormat = sp;
        localStorage.setItem('sharedPairFormat', sharedPairFormat);
    }

    showSleepMode = document.getElementById('settingsToggleSleepMode').checked;
    localStorage.setItem('showSleepMode', showSleepMode ? 'true' : 'false');

    if (showSleepMode) {
        if (typeof window.startSleepMode === 'function') {
            try { window.startSleepMode(); } catch (e) { console.error('[sleep] start failed', e); }
        }
    } else {
        if (typeof window.stopSleepMode === 'function') {
            try { window.stopSleepMode(); } catch (e) { console.error('[sleep] stop failed', e); }
        }
    }

    showWidgetMiniCal = document.getElementById('settingsToggleWidgetMiniCal').checked;
    showWidgetGlobal  = document.getElementById('settingsToggleWidgetGlobal').checked;
    showWidgetLabs    = document.getElementById('settingsToggleWidgetLabs').checked;
    showWidgetSuggestions = document.getElementById('settingsToggleWidgetSuggestions').checked;
    showWidgetPacing  = document.getElementById('settingsToggleWidgetPacing').checked;

    localStorage.setItem('showWidgetMiniCal', showWidgetMiniCal);
    localStorage.setItem('showWidgetGlobal',  showWidgetGlobal);
    localStorage.setItem('showWidgetLabs',    showWidgetLabs);
    localStorage.setItem('showWidgetSuggestions', showWidgetSuggestions);
    localStorage.setItem('showWidgetPacing',  showWidgetPacing);

    showWidgetNotes1 = document.getElementById('settingsToggleWidgetNotes1').checked;
    showWidgetNotes2 = document.getElementById('settingsToggleWidgetNotes2').checked;
    showWidgetNotes3 = document.getElementById('settingsToggleWidgetNotes3').checked;

    localStorage.setItem('showWidgetNotes1', showWidgetNotes1);
    localStorage.setItem('showWidgetNotes2', showWidgetNotes2);
    localStorage.setItem('showWidgetNotes3', showWidgetNotes3);

    showWidgetLabsPro    = document.getElementById('settingsToggleWidgetLabsPro').checked;
    showWidgetMoodleAvg  = document.getElementById('settingsToggleWidgetMoodleAvg').checked;
    showWidgetMoodleSubj = document.getElementById('settingsToggleWidgetMoodleSubj').checked;

    localStorage.setItem('showWidgetLabsPro', showWidgetLabsPro);
    localStorage.setItem('showWidgetMoodleAvg', showWidgetMoodleAvg);
    localStorage.setItem('showWidgetMoodleSubj', showWidgetMoodleSubj);

    separateFriendsTeachers = document.getElementById('settingsToggleSeparateFriendsTeachers').checked;
    showFriendsSection  = document.getElementById('settingsToggleFriendsSection').checked;
    showTeachersSection = document.getElementById('settingsToggleTeachersSection').checked;

    localStorage.setItem('separateFriendsTeachers', separateFriendsTeachers);
    localStorage.setItem('showFriendsSection',  showFriendsSection);
    localStorage.setItem('showTeachersSection', showTeachersSection);

    applyWidgetVisibility();
    if (typeof applyFriendsTeachersVisibility === 'function') applyFriendsTeachersVisibility();

    if (typeof _syncFriendsTeachersZone === 'function') {
        try { _syncFriendsTeachersZone(); } catch (e) {}
    }

    statusFormat = document.getElementById('settingsStatusFormat').value;
    if (!['interval', 'both', 'time'].includes(statusFormat)) statusFormat = 'interval';
    localStorage.setItem('statusFormat', statusFormat);

    let p = document.getElementById('settingsStatusPrecision').value;
    if (!['min', 'sec', 'cs'].includes(p)) p = 'min';
    statusPrecision = p;
    localStorage.setItem('statusPrecision', statusPrecision);

    notificationsEnabled = document.getElementById('settingsNotifEnabled').checked;

    let adv = parseInt(document.getElementById('settingsNotifAdvance').value, 10);
    if (isNaN(adv) || adv < 1) adv = 1;
    if (adv > 60) adv = 60;
    notificationAdvance = adv;
    document.getElementById('settingsNotifAdvance').value = adv;

    let unit = document.getElementById('settingsNotifUnit').value;
    if (!['min', 'hour', 'day', 'week'].includes(unit)) unit = 'min';
    notificationUnit = unit;

    localStorage.setItem('notificationsEnabled', notificationsEnabled ? 'true' : 'false');
    localStorage.setItem('notificationAdvance', String(notificationAdvance));
    localStorage.setItem('notificationUnit', notificationUnit);

    renderCalendar();
    updateScheduleStatus();
    restartStatusTimer();
    refreshNotifications();
    updateNotificationsHint();
}

function scrollToCustomThemePanel() {
    const panel = document.getElementById('customThemePanel');
    if (!panel) return;
    requestAnimationFrame(() => {
        setTimeout(() => {
            try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            catch (e) { panel.scrollIntoView(true); }
        }, 80);
    });
}

function restartStatusTimer() {
    if (_statusIntervalId) { clearInterval(_statusIntervalId); _statusIntervalId = null; }
    _statusIntervalId = setInterval(updateScheduleStatus, getStatusTickMs());
}

async function handleNotificationsToggle(checkbox) {
    if (checkbox.checked) {
        let result = await requestNotificationPermission();
        if (result !== 'granted') {
            checkbox.checked = false;
            notificationsEnabled = false;
            localStorage.setItem('notificationsEnabled', 'false');
            updateNotificationsHint();
            return;
        }
    }
    saveSettingsFromUI();
}

function updateNotificationsHint() {
    let hint = document.getElementById('settingsNotifHint');
    if (!hint) return;
    if (!('Notification' in window)) {
        hint.style.display = 'block';
        hint.textContent = 'Ваш браузер не поддерживает уведомления.';
        return;
    }
    let perm = Notification.permission;
    const advanceText = formatAdvanceText(notificationAdvance, notificationUnit);

    if (perm === 'denied') {
        hint.style.display = 'block';
        hint.textContent = 'Уведомления запрещены в настройках браузера. Разрешите их для этого сайта вручную.';
    } else if (perm === 'default' && notificationsEnabled) {
        hint.style.display = 'block';
        hint.textContent = 'Нужно разрешить уведомления — нажмите на переключатель ещё раз.';
    } else if (perm === 'granted' && notificationsEnabled) {
        hint.style.display = 'block';
        hint.textContent = `Готово. Напомним за ${advanceText} до начала события, пока вкладка открыта.`;
    } else {
        hint.style.display = 'none';
    }
}

function applyTheme() {
    const prevTheme = document.documentElement.getAttribute('data-theme');
    if (prevTheme === 'custom' && theme !== 'custom') {
        if (typeof clearCustomThemeInline === 'function') clearCustomThemeInline();
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-bs-theme', theme === 'dark' ? 'dark' : 'light');
    // Переменные темы могли измениться — кэш getThemeColor устарел.
    if (typeof resetThemeColorCache === 'function') resetThemeColorCache();
    if (theme === 'custom') {
        if (typeof applyCustomTheme === 'function') applyCustomTheme();
    }

    if (prevTheme !== theme && typeof refreshChartsTheme === 'function') {
        setTimeout(() => {
            refreshChartsTheme();
        }, 300);
    }
}

// ============================================================
//  СКАЧИВАНИЕ ФАЙЛОВ (расписание, заметки, резервная копия)
// ============================================================

// Сохраняет ответ как файл. Имя берём из Content-Disposition
// (filename*=UTF-8''…), иначе — fallbackName.
async function _saveResponseAsFile(resp, fallbackName) {
    const blob = await resp.blob();
    let filename = fallbackName;
    const cd = resp.headers.get('Content-Disposition') || '';

    let m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m && m[1]) {
        try { filename = decodeURIComponent(m[1]); }
        catch (e) {}
    } else {
        m = /filename="?([^";]+)"?/i.exec(cd);
        if (m && m[1]) filename = m[1];
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Не отзываем URL сразу: в некоторых браузерах скачивание
    // не успевает начаться и файл приходит пустым.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return filename;
}

function _downloadErrorText(status, text) {
    if (status === 409) return text || 'Данные ещё не готовы.';
    if (status === 429) return 'Слишком часто. Подождите минуту и попробуйте снова.';
    if (status === 401) return 'Требуется авторизация.';
    return `HTTP ${status}`;
}

async function downloadICS() {
    const group    = (document.getElementById('groupSelect').value || '').trim();
    const subgroup = document.getElementById('subgroupSelect').value || '0';

    if (!group) {
        alert('Сначала выберите группу!');
        return;
    }

    showGlobalLoader('📅 Готовим .ics-файл...');

    try {
        const url = `/api/schedule.ics?group=${encodeURIComponent(group)}&subgroup=${encodeURIComponent(subgroup)}`;
        // fetch, а не apiFetch: для 409 нужен текст ответа, а apiFetch
        // превращает любой не-2xx в исключение без тела.
        const resp = await fetch(url, { headers: authHeaders() });

        if (!resp.ok) {
            let text = '';
            try { text = await resp.text(); } catch (e) {}
            throw new Error(_downloadErrorText(resp.status, text));
        }

        const safeGroup = group.replace(/[\/\\:*?"<>|]/g, '_');
        await _saveResponseAsFile(resp, `schedule_${safeGroup}_${subgroup}.ics`);
        showUpdateNotification('✅ Файл .ics скачан');

    } catch (e) {
        console.error('[ics] download failed', e);
        const msg = (e && e.message) ? e.message : 'Не удалось собрать .ics';
        showUpdateNotification(`❌ ${msg}`);
    } finally {
        hideGlobalLoader();
    }
}

async function downloadTasksICS() {
    showGlobalLoader('📝 Готовим .ics с заметками...');
    try {
        const resp = await fetch('/api/tasks.ics', { headers: authHeaders() });
        if (!resp.ok) {
            let text = '';
            try { text = await resp.text(); } catch (e) {}
            throw new Error(_downloadErrorText(resp.status, text));
        }
        await _saveResponseAsFile(resp, 'ezh_notes.ics');
        showUpdateNotification('✅ Заметки сохранены в .ics');
    } catch (e) {
        console.error('[ics] tasks download failed', e);
        showUpdateNotification(`❌ ${(e && e.message) || 'Не удалось собрать .ics'}`);
    } finally {
        hideGlobalLoader();
    }
}

// ============================================================
//  РЕЗЕРВНАЯ КОПИЯ
// ============================================================

async function downloadBackup() {
    showGlobalLoader('💾 Собираем резервную копию...');
    try {
        const data = await apiLoadBackup();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
                    + `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ezh_backup_${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showUpdateNotification('✅ Копия сохранена');
    } catch (e) {
        console.error('[backup] export failed', e);
        alert('Не удалось собрать копию: ' + apiErrorText(e, { subject: 'копия' }));
    } finally {
        hideGlobalLoader();
    }
}

function pickBackupFile() {
    const input = document.getElementById('backupFileInput');
    if (!input) return;
    input.value = '';
    input.click();
}

async function onBackupFilePicked(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;

    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch (e) {
        alert('Не удалось прочитать файл: это не JSON.');
        input.value = '';
        return;
    }
    if (!payload || typeof payload !== 'object') {
        alert('Файл копии пустой или повреждён.');
        input.value = '';
        return;
    }

    const tables = payload.tables || payload;
    const counts = Object.keys(tables)
        .filter(k => Array.isArray(tables[k]))
        .map(k => `• ${k}: ${tables[k].length}`)
        .join('\n');

    if (!confirm(
        'Восстановить данные из копии?\n\n' +
        'Текущие заметки, друзья, лабы, настройки предметов, кастомное расписание ' +
        'и преподаватели будут ЗАМЕНЕНЫ.\n\n' +
        (counts || 'В файле нет таблиц с данными.')
    )) {
        input.value = '';
        return;
    }

    showGlobalLoader('⏳ Восстанавливаем данные...');
    try {
        const res = await apiRestoreBackup(payload);
        if (!res || !res.success) throw new Error((res && res.error) || 'неизвестная ошибка');
        showUpdateNotification('✅ Данные восстановлены, перезагружаем…');
        setTimeout(() => window.location.reload(), 900);
    } catch (e) {
        console.error('[backup] restore failed', e);
        alert('Не удалось восстановить: ' + apiErrorText(e, { subject: 'копия' }));
    } finally {
        hideGlobalLoader();
        input.value = '';
    }
}

function applyWidgetVisibility() {
    const wm = document.getElementById('widgetMiniCalCard');
    const wg = document.getElementById('widgetGlobalCard');
    const wl = document.getElementById('widgetLabsCard');
    const ws = document.getElementById('widgetSuggestionsCard');
    const wp = document.getElementById('widgetPacingCard');

    if (wm) wm.style.display = showWidgetMiniCal ? '' : 'none';
    if (wg) wg.style.display = showWidgetGlobal  ? '' : 'none';
    if (wl) wl.style.display = (!window.isProActive && showWidgetLabs) ? '' : 'none';
    if (ws) ws.style.display = showWidgetSuggestions ? '' : 'none';
    if (wp) wp.style.display = showWidgetPacing  ? '' : 'none';

    // Заметки 1/2/3
    const wn1 = document.getElementById('widgetNotesCard1');
    const wn2 = document.getElementById('widgetNotesCard2');
    const wn3 = document.getElementById('widgetNotesCard3');

    if (wn1) wn1.style.display = showWidgetNotes1 ? '' : 'none';
    if (wn2) wn2.style.display = showWidgetNotes2 ? '' : 'none';
    if (wn3) wn3.style.display = showWidgetNotes3 ? '' : 'none';

    const wlp = document.getElementById('widgetLabsProCard');
    const wma = document.getElementById('widgetMoodleAvgGradeCard');
    const wms = document.getElementById('widgetMoodleSubjectGradesCard');

    const proReady = window.isProActive && window.hasLoadedMoodleStats;

    if (wlp) wlp.style.display = (proReady && showWidgetLabsPro) ? '' : 'none';
    if (wma) wma.style.display = (proReady && showWidgetMoodleAvg) ? '' : 'none';
    if (wms) wms.style.display = (proReady && showWidgetMoodleSubj) ? '' : 'none';

    const proLockMsg = document.getElementById('proWidgetsLockedMsg');
    const proGrid = document.getElementById('proWidgetsGrid');
    if (proLockMsg && proGrid) {
        if (window.isProActive) {
            proLockMsg.style.display = 'none';
            proGrid.style.display = '';
        } else {
            proLockMsg.style.display = 'flex';
            proGrid.style.display = 'none';
        }
    }
}