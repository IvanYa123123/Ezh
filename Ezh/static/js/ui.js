// Лоадер, уведомления, сворачивание виджетов, undo-полоса.

const loadingPhrases = [
    "Грызем гранит науки...",
    "Связываемся с деканатом...",
    "Ищем расписание...",
    "Раскладываем пары по полочкам...",
    "Будим преподавателей...",
    "Проверяем наличие окон...",
    "Пинаем сервер...",
    "Сканируем мудл...",
    "Переписываем программу...",
    "Пьем чай...",
    "Слушаем лекцию...",
    "Взламываем калькулятор..."
];

function _ensureLoaderEl() {
    let loader = document.getElementById('globalLoader');
    if (loader) return loader;
    loader = document.createElement('div');
    loader.id = 'globalLoader';
    loader.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:rgba(255,255,255,0.85)', 'z-index:9999',
        'display:none', 'flex-direction:column',
        'justify-content:center', 'align-items:center',
        'backdrop-filter:blur(4px)'
    ].join(';');
    document.body.appendChild(loader);
    return loader;
}

function _ensureLoaderText(loader) {
    let textEl = document.getElementById('loaderText');
    if (!textEl) {
        textEl = document.createElement('div');
        textEl.id = 'loaderText';
        textEl.className = 'mt-3 fw-bold text-secondary fs-5';
        textEl.textContent = 'Загрузка...';
        loader.appendChild(textEl);
    }
    return textEl;
}

function showGlobalLoader(message) {
    const loader = _ensureLoaderEl();
    const textEl = _ensureLoaderText(loader);
    if (loaderInterval) { clearInterval(loaderInterval); loaderInterval = null; }

    if (message) {
        textEl.textContent = message;
    } else {
        let idx = 0;
        textEl.textContent = loadingPhrases[idx];
        loaderInterval = setInterval(() => {
            idx = (idx + 1) % loadingPhrases.length;
            textEl.textContent = loadingPhrases[idx];
        }, 3000);
    }

    loader.style.display = 'flex';
    void loader.offsetHeight;
}

function hideGlobalLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.style.display = 'none';
    if (loaderInterval) { clearInterval(loaderInterval); loaderInterval = null; }
}

function setLoaderText(message) {
    if (!message) return;
    const textEl = document.getElementById('loaderText');
    if (textEl) textEl.textContent = message;
}

function showUpdateNotification(message) {
    let notif = document.getElementById('updateNotification');
    if (!notif) return;
    document.getElementById('updateNotificationText').textContent = message;
    notif.style.display = 'block';
    notif.animate([
        {opacity: 0, transform: 'translateY(20px)'},
        {opacity: 1, transform: 'translateY(0)'}
    ], {duration: 300, fill: 'forwards'});
    setTimeout(() => {
        let anim = notif.animate([
            {opacity: 1, transform: 'translateY(0)'},
            {opacity: 0, transform: 'translateY(20px)'}
        ], {duration: 300, fill: 'forwards'});
        anim.onfinish = () => notif.style.display = 'none';
    }, 3000);
}

// ============================================================
//  FIX 2: СВОРАЧИВАНИЕ ВИДЖЕТОВ — БЕЗ ЗАЛИПАНИЯ И ПРОПАДАНИЯ ЧАРТОВ
// ------------------------------------------------------------
//  Проблема была в том, что при быстром toggle Chart.js ловил
//  resize в момент, когда контейнер только начал меняться,
//  и «залипал» в промежуточной геометрии. Уничтожение чартов
//  при сворачивании тоже плохо — canvas остаётся с нулевой
//  высотой, и при следующем renderCharts() он не восстанавливается.
//
//  Правильный подход:
//    1) На время CSS-перехода отключаем у чартов авто-ресайз
//       (options.responsive = false) — Chart.js не дёргается.
//    2) После завершения перехода (330 мс) возвращаем responsive = true
//       и зовём chart.resize(). Это даёт чистую геометрию.
//    3) Чарты НЕ уничтожаем — они переживают сворачивание.
// ============================================================

const _widgetResizeTimers = {};

function _getCharts() {
    const list = [];
    if (typeof globalChart    !== 'undefined' && globalChart)    list.push(globalChart);
    if (typeof globalLabChart !== 'undefined' && globalLabChart) list.push(globalLabChart);
    return list;
}

function toggleWidget(bodyId, btn) {
    let body = document.getElementById(bodyId);
    if (!body) return;

    // Отменяем предыдущий отложенный resize (если юзер быстро кликает)
    if (_widgetResizeTimers[bodyId]) {
        clearTimeout(_widgetResizeTimers[bodyId]);
        delete _widgetResizeTimers[bodyId];
    }

    // Замораживаем Chart.js на время анимации
    _getCharts().forEach(ch => {
        if (ch.options) ch.options.responsive = false;
    });

    if (body.style.height === '0px') {
        // --- РАЗВОРАЧИВАНИЕ ---
        body.style.height = body.dataset.originalHeight || (bodyId === 'labPacingBody' ? 'auto' : '160px');
        setTimeout(() => { body.style.overflow = 'visible'; }, 300);
        btn.textContent = '−';
        localStorage.setItem('widget_' + bodyId, 'expanded');
    } else {
        // --- СВОРАЧИВАНИЕ ---
        if (!body.dataset.originalHeight) {
            let h = body.style.height;
            if (!h || h === 'auto') h = window.getComputedStyle(body).height;
            body.dataset.originalHeight = h;
        }
        body.style.overflow = 'hidden';
        body.style.height = '0px';
        btn.textContent = '+';
        localStorage.setItem('widget_' + bodyId, 'collapsed');
    }

    // После завершения CSS-перехода (0.3s) — размораживаем и ресайзим.
    _widgetResizeTimers[bodyId] = setTimeout(() => {
        delete _widgetResizeTimers[bodyId];
        _getCharts().forEach(ch => {
            if (ch.options) ch.options.responsive = true;
            try { ch.resize(); } catch (e) {}
        });
    }, 330);
}

// ============================================================
//  UNDO-ПОЛОСА
// ============================================================

function showUndoBar(message, onUndo) {
    let bar = document.getElementById('undoBar');
    if (!bar) return;

    const textEl = document.getElementById('undoBarText');
    const btnEl  = document.getElementById('undoBarBtn');
    if (textEl) textEl.textContent = message;

    if (btnEl) {
        const newBtn = btnEl.cloneNode(true);
        btnEl.parentNode.replaceChild(newBtn, btnEl);
        newBtn.onclick = () => { if (typeof onUndo === 'function') onUndo(); };
    }

    bar.style.display = 'block';
    bar.animate([
        {opacity: 0, transform: 'translate(-50%, 20px)'},
        {opacity: 1, transform: 'translate(-50%, 0)'}
    ], {duration: 250, fill: 'forwards'});
}

function hideUndoBar() {
    const bar = document.getElementById('undoBar');
    if (!bar || bar.style.display === 'none') return;
    const anim = bar.animate([
        {opacity: 1, transform: 'translate(-50%, 0)'},
        {opacity: 0, transform: 'translate(-50%, 20px)'}
    ], {duration: 200, fill: 'forwards'});
    anim.onfinish = () => { bar.style.display = 'none'; };
}

// ============================================================
//  Вращение ёжика при скролле
// ============================================================
let ezhScrollTimer = null;
let currentEzhRotation = 0;
let lastScrollY = window.scrollY;

window.addEventListener('scroll', () => {
    const ezh = document.getElementById('ezh-logo');
    if (ezh) {
        let delta = window.scrollY - lastScrollY;
        lastScrollY = window.scrollY;
        currentEzhRotation += delta;

        ezh.style.transition = 'transform 0.1s linear';
        ezh.style.transform = `rotate(${currentEzhRotation}deg) scale(0.7)`;

        clearTimeout(ezhScrollTimer);
        ezhScrollTimer = setTimeout(() => {
            currentEzhRotation = Math.round(currentEzhRotation / 360) * 360;
            ezh.style.transition = 'transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            ezh.style.transform = `rotate(${currentEzhRotation}deg) scale(1)`;
        }, 150);
    }
}, { passive: true });