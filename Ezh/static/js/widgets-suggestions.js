// Виджет «Предложения» — ищет долги по лабам и предлагает,
// на какую будущую пару их можно сдать.

let _suggestionsCache = null;
let _suggestionsCacheTime = 0;
let _suggestionVerticalIndex = 0;

function _formatLabNums(labs) {
    if (labs.length === 0) return '';
    if (labs.length === 1) return `${labs[0]}`;
    if (labs.length === 2) return `${labs[0]} и ${labs[1]}`;
    return labs.slice(0, -1).join(', ') + ' и ' + labs[labs.length - 1];
}

function _getSuggestionSubjectName(subjKey) {
    if (cachedSubjectSettings && cachedSubjectSettings[subjKey] && cachedSubjectSettings[subjKey].custom_name) {
        return cachedSubjectSettings[subjKey].custom_name;
    }
    return subjKey.split(' (')[0];
}

async function renderSuggestions(force = false) {
    const container = document.getElementById('suggestionsContent');
    if (!container) return;

    const group = (document.getElementById('groupSelect').value || '').trim();
    if (!group || !cachedSchedule || cachedSchedule.length === 0) {
        container.innerHTML = '<div class="text-muted small text-center py-3">Нет данных о расписании.</div>';
        return;
    }

    const now = Date.now();
    if (!force && _suggestionsCache && (now - _suggestionsCacheTime < 5 * 60 * 1000)) {
        renderSuggestionsHtml(_suggestionsCache);
        return;
    }

    container.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm text-primary"></span></div>';
    const navRow = document.getElementById('suggestionsNavRow');
    if (navRow) navRow.style.display = 'none';

    let labItems = {};
    try {
        labItems = await apiLoadLabItems(group);
    } catch (e) {
        container.innerHTML = '<div class="text-danger small text-center py-2">Ошибка загрузки лаб.</div>';
        return;
    }

    const todayStr = getLocalDateStr(new Date());
    const allowOtherGroups = !document.getElementById('suggestOnlyOwnGroups')?.checked;
    const futureLimit = new Date(); 
    futureLimit.setDate(futureLimit.getDate() + 14);
    const futureLimitStr = getLocalDateStr(futureLimit);

    const suggestions = [];

    for (const subjKey in cachedLabs) {
        if (!labItems[subjKey]) continue;

        const totalLabs = cachedLabs[subjKey].total;
        const items = labItems[subjKey];
        const dates = _datesForSubject(subjKey);
        const subjShort = subjKey.split(' (')[0];
        const subjType = subjKey.match(/\(([^)]+)\)/)?.[1];

        let myNextClass = cachedSchedule.find(s => s.lesson === subjShort && s.date >= todayStr);
        let teacher = myNextClass ? myNextClass.teacher : '';
        if (!teacher && cachedSubjectSettings[subjKey]) {
            teacher = cachedSubjectSettings[subjKey].teacher;
        }

        const overdueLabs = [];
        items.forEach(lab => {
            if (lab.completed) return;
            const dueDate = _computeDueDate(dates, lab.idx, totalLabs);
            if (dueDate && dueDate < todayStr) {
                overdueLabs.push(lab.idx);
            }
        });

        if (overdueLabs.length === 0) continue;

        let suggested = false;

        if (allowOtherGroups && teacher && typeof trackedTeachers !== 'undefined') {
            const tracked = trackedTeachers.find(t => t.name === teacher);
            if (tracked && teacherSchedulesCache[tracked.slug]) {
                const ts = teacherSchedulesCache[tracked.slug];
                const teacherClass = ts.find(s => 
                    s.lesson === subjShort && 
                    s.date >= todayStr && s.date <= futureLimitStr
                );
                
                if (teacherClass) {
                    const isMyGroup = teacherClass.groups && teacherClass.groups.some(g => g.toUpperCase() === group.toUpperCase());
                    suggestions.push({
                        date: teacherClass.date,
                        time: teacherClass.time_range,
                        n: teacherClass.n,
                        subj: subjKey,
                        labs: overdueLabs,
                        teacher: teacher,
                        location: teacherClass.location,
                        isOwn: isMyGroup
                    });
                    suggested = true;
                }
            }
        }

        if (!suggested) {
            const nextOwnClass = cachedSchedule.find(s => 
                s.lesson === subjShort && 
                s.type_name === subjType && 
                s.date >= todayStr
            );

            if (nextOwnClass) {
                suggestions.push({
                    date: nextOwnClass.date,
                    time: nextOwnClass.time_range,
                    n: nextOwnClass.n,
                    subj: subjKey,
                    labs: overdueLabs,
                    teacher: nextOwnClass.teacher || teacher,
                    location: nextOwnClass.location,
                    isOwn: true
                });
            }
        }
    }

    suggestions.sort((a, b) => a.date.localeCompare(b.date));
    const limited = suggestions.slice(0, 8);

    _suggestionsCache = limited;
    _suggestionsCacheTime = now;
    
    // Сбрасываем индекс, если он вышел за пределы
    if (_suggestionVerticalIndex >= limited.length) _suggestionVerticalIndex = 0;

    renderSuggestionsHtml(limited);
}

function renderSuggestionsHtml(suggestions) {
    const container = document.getElementById('suggestionsContent');
    const navRow = document.getElementById('suggestionsNavRow');
    const counter = document.getElementById('suggestionsCounter');
    if (!container) return;

    if (suggestions.length === 0) {
        container.innerHTML = '<div class="text-success small text-center py-3">✅ Все долги сданы. Так держать!</div>';
        if (navRow) navRow.style.display = 'none';
        return;
    }

    const isHorizontal = document.getElementById('widgetSuggestionsCard').classList.contains('is-horizontal');

    if (isHorizontal) {
        if (navRow) navRow.style.display = 'none';
        let html = '';
        suggestions.forEach((s, idx) => {
            html += _renderSuggestionCard(s, idx);
        });
        container.innerHTML = html;
        container.classList.add('is-grid');
    } else {
        if (navRow) navRow.style.display = 'flex';
        if (_suggestionVerticalIndex >= suggestions.length) _suggestionVerticalIndex = 0;
        if (_suggestionVerticalIndex < 0) _suggestionVerticalIndex = suggestions.length - 1;

        const s = suggestions[_suggestionVerticalIndex];
        container.innerHTML = _renderSuggestionCard(s, _suggestionVerticalIndex);
        container.classList.remove('is-grid');
        
        if (counter) counter.textContent = `${_suggestionVerticalIndex + 1} / ${suggestions.length}`;
    }
}

function _renderSuggestionCard(s, idx) {
    const dateRu = formatDateRu(s.date);
    const timeShort = s.time.split(' - ')[0];
    const subjName = _getSuggestionSubjectName(s.subj);
    const labsStr = _formatLabNums(s.labs);
    const classNumStr = s.n ? ` (${s.n} пара)` : '';
    
    const whereLabel = s.isOwn 
        ? '<span class="badge bg-secondary">Своя пара</span>' 
        : '<span class="badge bg-primary">У преподавателя</span>';

    return `
        <div class="suggestion-card">
            <div class="suggestion-info">
                <div class="suggestion-title">${escapeHtml(subjName)}</div>
                <div class="suggestion-meta">
                    <span class="badge bg-secondary text-light">Сдать: ЛР ${labsStr}</span>
                    ${whereLabel}
                </div>
                <div class="suggestion-details">
                    <span>📅 ${dateRu} в ${timeShort}${classNumStr}</span>
                    <span>${escapeHtml(s.teacher || 'Неизвестен')}</span>
                    <span>${escapeHtml(s.location || '—')}</span>
                </div>
            </div>
            <div class="suggestion-actions">
                <button type="button" class="btn btn-sm btn-outline-primary py-1 px-2 fw-bold" 
                        onclick="addSuggestionToCalendar(${idx})" title="Добавить в календарь">
                    + Календарь
                </button>
            </div>
        </div>
    `;
}

function suggestionsPrev() {
    if (!_suggestionsCache || _suggestionsCache.length === 0) return;
    _suggestionVerticalIndex--;
    if (_suggestionVerticalIndex < 0) _suggestionVerticalIndex = _suggestionsCache.length - 1;
    renderSuggestionsHtml(_suggestionsCache);
}

function suggestionsNext() {
    if (!_suggestionsCache || _suggestionsCache.length === 0) return;
    _suggestionVerticalIndex++;
    if (_suggestionVerticalIndex >= _suggestionsCache.length) _suggestionVerticalIndex = 0;
    renderSuggestionsHtml(_suggestionsCache);
}

async function addSuggestionToCalendar(idx) {
    const s = _suggestionsCache[idx];
    if (!s) return;

    const group = (document.getElementById('groupSelect').value || '').trim();
    const subjName = _getSuggestionSubjectName(s.subj);
    const labsStr = _formatLabNums(s.labs);

    const payload = {
        group: group,
        base_date: s.date,
        time_range: s.time,
        lesson: `Сдать ЛР ${labsStr} по ${subjName}`,
        type_name: 'Долг',
        teacher: s.teacher,
        location: s.location,
        is_event: 1, 
        recurrence: 'none',
        exceptions: '[]'
    };

    try {
        await apiCreateCustomSchedule(payload);
        showUpdateNotification('✅ Добавлено в календарь');
        if (typeof refreshCustomSchedule === 'function') await refreshCustomSchedule();
    } catch (e) {
        console.error(e);
        alert('Не удалось добавить в календарь');
    }
}