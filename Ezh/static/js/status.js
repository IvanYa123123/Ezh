// Строка статуса под шапкой: «до пар / во время пары / после пар».
// Формат и точность задаются в настройках (см. state.js).
//
// v3.7.0:
//   • _timeToMs больше не падает на кривом/пустом time_range
//     (раньше split(':') на undefined бросал TypeError и ронял
//     весь таймер статуса — строка «замирала» до перезагрузки).
//   • Пары без корректного времени просто не участвуют в расчёте.
//   • За 5 минут до начала/окончания строку подсвечивает
//     .status-imminent (мягкая пульсация, см. animations.css).

const STATUS_IMMINENT_MS = 5 * 60 * 1000;

function _timeToMs(timeStr) {
    if (typeof timeStr !== 'string') return NaN;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return NaN;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!isFinite(h) || !isFinite(m)) return NaN;
    return (h * 3600 + m * 60) * 1000;
}

function _nowMs() {
    let now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds();
}

function _formatStatus(prefix, diffMs, absoluteTime) {
    let intervalStr = null;
    if (diffMs !== null && diffMs >= 0) {
        intervalStr = `через ${formatDurationMs(diffMs, statusPrecision)}`;
    }
    let timeStr = absoluteTime ? `в ${absoluteTime}` : null;

    if (statusFormat === 'time') {
        if (timeStr) return `${prefix} ${timeStr}`;
        if (intervalStr) return `${prefix} ${intervalStr}`;
        return prefix;
    }
    if (statusFormat === 'both') {
        if (intervalStr && timeStr) return `${prefix} ${intervalStr} (${timeStr})`;
        if (intervalStr) return `${prefix} ${intervalStr}`;
        if (timeStr) return `${prefix} ${timeStr}`;
        return prefix;
    }
    if (intervalStr) return `${prefix} ${intervalStr}`;
    if (timeStr) return `${prefix} ${timeStr}`;
    return prefix;
}

function _setStatusText(el, text, imminent) {
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('status-imminent', !!imminent);
}

function _pairStart(item) {
    if (!item || typeof item.time_range !== 'string') return NaN;
    const parts = item.time_range.split(' - ');
    return _timeToMs(parts[0]);
}

function _pairEnd(item) {
    if (!item || typeof item.time_range !== 'string') return NaN;
    const parts = item.time_range.split(' - ');
    return _timeToMs(parts[1]);
}

function _safePairTime(item, edge) {
    if (!item || typeof item.time_range !== 'string') return '';
    const parts = item.time_range.split(' - ');
    const raw = edge === 'end' ? parts[1] : parts[0];
    return raw ? fixTime(raw.trim()) : '';
}

function updateScheduleStatus() {
    let el = document.getElementById('scheduleStatus');
    if (!el) return;

    if (typeof showStatus !== 'undefined' && !showStatus) {
        _setStatusText(el, '', false);
        return;
    }

    if (!cachedSchedule || cachedSchedule.length === 0) {
        _setStatusText(el, '', false);
        return;
    }

    let now = new Date();
    let nowMs = _nowMs();
    let todayStr = getLocalDateStr(now);

    let todayPairs = cachedSchedule
        .filter(item => item.date === todayStr)
        .map(item => {
            return {
                ...item,
                startMs: _pairStart(item),
                endMs: _pairEnd(item)
            };
        })
        .filter(p => isFinite(p.startMs) && isFinite(p.endMs))
        .sort((a, b) => a.startMs - b.startMs);

    if (todayPairs.length > 0) {
        let current = todayPairs.find(p => p.startMs <= nowMs && nowMs < p.endMs);
        if (current) {
            let remaining = current.endMs - nowMs;
            let pairNum = current.n || '?';
            let endTime = fixTime(_safePairTime(current, 'end'));
            _setStatusText(
                el,
                _formatStatus(`Окончание ${pairNum} пары`, remaining, endTime),
                remaining <= STATUS_IMMINENT_MS
            );
            return;
        }

        let first = todayPairs[0];
        if (nowMs < first.startMs) {
            let until = first.startMs - nowMs;
            let startTime = fixTime(_safePairTime(first, 'start'));
            _setStatusText(
                el,
                _formatStatus('Начало пар', until, startTime),
                until <= STATUS_IMMINENT_MS
            );
            return;
        }

        let next = todayPairs.find(p => p.startMs > nowMs);
        if (next) {
            let until = next.startMs - nowMs;
            let startTime = fixTime(_safePairTime(next, 'start'));
            let pairNum = next.n || '?';
            _setStatusText(
                el,
                _formatStatus(`Начало ${pairNum} пары`, until, startTime),
                until <= STATUS_IMMINENT_MS
            );
            return;
        }

        setStatusForNextDay(now, el);
        return;
    }

    setStatusForNextDay(now, el);
}

function setStatusForNextDay(now, el) {
    let datesWithPairs = new Map();

    cachedSchedule.forEach(item => {
        if (!item || !item.date) return;
        if (!isFinite(_pairStart(item))) return;
        const bucket = datesWithPairs.get(item.date);
        if (bucket) bucket.push(item);
        else datesWithPairs.set(item.date, [item]);
    });

    for (let i = 1; i <= 365; i++) {
        let d = new Date(now);
        d.setDate(d.getDate() + i);
        let dateStr = getLocalDateStr(d);

        const dayItems = datesWithPairs.get(dateStr);
        if (!dayItems || dayItems.length === 0) continue;

        let first = dayItems
            .slice()
            .sort((a, b) => (a.n || 0) - (b.n || 0))[0];
        if (!first) continue;

        let firstTime = fixTime(_safePairTime(first, 'start'));
        if (!firstTime) continue;

        if (i === 1) {
            _setStatusText(el, _formatStatus('Начало пар завтра', null, firstTime), false);
        } else {
            _setStatusText(el, _formatStatus(`Начало пар ${formatDateRu(dateStr)}`, null, firstTime), false);
        }
        return;
    }

    _setStatusText(el, '', false);
}
