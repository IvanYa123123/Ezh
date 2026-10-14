// Уведомления о событиях и парах.
// Работают, пока вкладка с приложением открыта.
//
// Логика: раз в минуту проверяем все предстоящие пары и события.
// Для каждого вычисляем момент «пора уведомить» = start − advance.
// Если сейчас >= этот момент и ещё не наступило start — уведомляем.
//
// Такой подход (проверка по таймеру вместо setTimeout на N дней)
// устойчив к длинным интервалам (день/неделя) — setTimeout в браузерах
// плохо переносит задержки больше ~24 дней, а также сбрасывается при
// перезагрузке страницы.

let _notificationCheckInterval = null;

// key → timestamp (когда уведомили). Нужно, чтобы не дублировать.
let _notifiedMap = new Map();

// Как часто опрашивать (в миллисекундах). Минута даёт точность «до минуты»
// и почти не нагружает систему.
const NOTIFICATION_CHECK_MS = 60 * 1000;

// Максимальный горизонт, вперёд которого сканируем события.
// 8 недель — с запасом для юнита 'week'.
const NOTIFICATION_MAX_LOOKAHEAD_DAYS = 56;

function initNotifications() {
    if (_notificationCheckInterval) clearInterval(_notificationCheckInterval);
    _notificationCheckInterval = setInterval(refreshNotifications, NOTIFICATION_CHECK_MS);
    refreshNotifications();

    // При возвращении на вкладку — перепроверяем сразу же:
    // браузер мог заморозить setInterval, пока вкладка была в фоне.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshNotifications();
    });
}

function requestNotificationPermission() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied')  return Promise.resolve('denied');
    return Notification.requestPermission();
}

function refreshNotifications() {
    if (!notificationsEnabled) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const nowMs = Date.now();
    const advanceMs = advanceToMs(notificationAdvance, notificationUnit);
    const lookaheadMs = Math.max(advanceMs, NOTIFICATION_MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    // Чистим старые записи (старше 30 дней), чтобы Map не разрастался.
    const CUTOFF = 30 * 24 * 60 * 60 * 1000;
    for (const [k, ts] of _notifiedMap) {
        if (nowMs - ts > CUTOFF) _notifiedMap.delete(k);
    }

    // --- 1) Пары из основного расписания ---
    if (typeof cachedSchedule !== 'undefined' && Array.isArray(cachedSchedule)) {
        cachedSchedule.forEach(pair => {
            const startMs = _itemStartMs(pair.date, pair.time_range);
            if (!startMs) return;
            const notifyMs = startMs - advanceMs;
            if (nowMs < notifyMs) return;   // ещё рано
            if (nowMs >= startMs) return;   // уже началось — не уведомляем

            const key = `pair|${pair.date}|${pair.n}|${pair.lesson}|${pair.time_range}`;
            if (_notifiedMap.has(key)) return;
            _notifiedMap.set(key, nowMs);
            _showPairNotification(pair);
        });
    }

    // --- 2) Кастомные события (is_event === 1) ---
    if (typeof getCustomItemsForDate === 'function' && typeof customScheduleItems !== 'undefined') {
        const daysAhead = Math.min(
            NOTIFICATION_MAX_LOOKAHEAD_DAYS,
            Math.ceil(lookaheadMs / (24 * 60 * 60 * 1000)) + 1
        );
        const today = new Date();
        for (let i = 0; i <= daysAhead; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            const dateStr = getLocalDateStr(d);

            let items = [];
            try { items = getCustomItemsForDate(dateStr) || []; } catch (e) { continue; }

            items.forEach(ev => {
                if (ev.is_event !== 1) return;

                const startMs = _itemStartMs(dateStr, ev.time_range);
                if (!startMs) return;
                const notifyMs = startMs - advanceMs;
                if (nowMs < notifyMs) return;
                if (nowMs >= startMs) return;

                const key = `event|${dateStr}|${ev.lesson}|${ev.time_range}`;
                if (_notifiedMap.has(key)) return;
                _notifiedMap.set(key, nowMs);
                _showEventNotification(ev, dateStr);
            });
        }
    }
}

// Дата (YYYY-MM-DD) + время начала («HH:MM») → timestamp (ms).
function _itemStartMs(dateStr, timeRange) {
    if (!dateStr || !timeRange) return null;
    const parts = String(timeRange).split(' - ');
    if (parts.length < 2) return null;
    const [h, m] = parts[0].trim().split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const [y, mo, d] = dateStr.split('-').map(Number);
    if (isNaN(y) || isNaN(mo) || isNaN(d)) return null;
    return new Date(y, mo - 1, d, h, m, 0, 0).getTime();
}

function _showPairNotification(pair) {
    const advanceText = formatAdvanceText(notificationAdvance, notificationUnit);
    const title = `Пара через ${advanceText}`;
    let body = pair.lesson || 'Пара';
    if (pair.location) body += ` — ${pair.location}`;
    if (pair.teacher)  body += `\n${pair.teacher}`;

    _fireNotification(title, body, `pair-${pair.date}-${pair.n}-${pair.lesson}`);
}

function _showEventNotification(ev, dateStr) {
    const advanceText = formatAdvanceText(notificationAdvance, notificationUnit);
    const title = `Событие через ${advanceText}`;
    let body = ev.lesson || 'Событие';
    if (ev.location) body += ` — ${ev.location}`;
    if (ev.teacher)  body += `\n${ev.teacher}`;

    const dateRu = formatDateRu(dateStr);
    body += `\n📅 ${dateRu}, ${ev.time_range}`;

    _fireNotification(title, body, `event-${dateStr}-${ev.lesson}`);
}

function _fireNotification(title, body, tag) {
    try {
        new Notification(title, {
            body: body,
            tag: tag,
            requireInteraction: false,
        });
    } catch (e) {
        console.error('Notification failed:', e);
    }
}
