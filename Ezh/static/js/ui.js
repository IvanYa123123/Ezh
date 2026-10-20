// Лоадер, уведомления, undo-полоса.
// v3.16.4: плавный переход ежика (squash & stretch + пыль).

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

// ============================================================
//  ГЕНЕРАТОР SVG ЁЖИКА (V2.1)
// ============================================================
function getHedgehogSvgHtml(size = 100) {
    return `
    <svg class="hh-preloader" viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-label="Загрузка...">
      
      <!-- Тень и линии скорости на земле -->
      <ellipse class="hh-shadow" cx="50" cy="80" rx="26" ry="4.5" fill="var(--hh-dark, #1f2937)" />
      <path class="hh-dust-1" d="M 44,83 L 58,83" fill="none" stroke="var(--hh-stroke, #2a1505)" stroke-width="2" />
      <path class="hh-dust-2" d="M 38,87 L 48,87" fill="none" stroke="var(--hh-stroke, #2a1505)" stroke-width="1.6" />

      <!-- Пыль от удара -->
      <circle class="hh-puff" cx="20" cy="76" r="2.5" fill="var(--hh-stroke, #2a1505)" opacity="0" />
      <circle class="hh-puff-2" cx="30" cy="80" r="1.5" fill="var(--hh-stroke, #2a1505)" opacity="0" />

      <!-- СОСТОЯНИЕ 1: КОЛЮЧИЙ КЛУБОК (0 - 5 сек) -->
      <g class="hh-state-ball">
        <g class="hh-ball-spinner">
          <path
            d="M 69.3,52.8 L 75.9,56.2 L 69.3,63.2 L 73.4,69.4 L 64.1,72.1 L 64.5,79.6 L 55.2,77.3 L 51.8,83.9 L 44.8,77.3 L 38.6,81.4 L 35.9,72.1 L 28.4,72.5 L 30.7,63.2 L 24.1,59.8 L 30.7,52.8 L 26.6,46.6 L 35.9,43.9 L 35.5,36.4 L 44.8,38.7 L 48.2,32.1 L 55.2,38.7 L 61.4,34.6 L 64.1,43.9 L 71.6,43.5 Z"
            fill="var(--hh-quills, #6b3f1a)"
            stroke="var(--hh-stroke, #2a1505)"
            stroke-width="2.4"
          />
          <path
            d="M 43,43 Q 50,39 57,44 M 61,51 Q 65,58 60,65 M 55,71 Q 48,75 41,70 M 36,63 Q 33,55 38,48"
            fill="none"
            stroke="var(--hh-stroke, #2a1505)"
            stroke-width="2"
          />
          <circle cx="50" cy="58" r="9" fill="var(--hh-body-shade, #dcb87c)" stroke="var(--hh-stroke, #2a1505)" stroke-width="2" />
          <path d="M 45.5,55 C 48.5,51.5 54.5,53.5 53.5,59 C 52.5,62.5 47,62.5 46,59" fill="none" stroke="var(--hh-stroke, #2a1505)" stroke-width="2" />
        </g>
      </g>

      <!-- СОСТОЯНИЕ 2: БЕГУЩИЙ ЁЖИК -->
      <g class="hh-state-run">
        <g class="hh-runner-bounce">
          <!-- Дальние лапки -->
          <g class="hh-leg-2" style="transform-origin: 39px 68px;">
            <ellipse cx="39" cy="73.5" rx="3.2" ry="5" fill="var(--hh-body-shade, #dcb87c)" stroke="var(--hh-stroke, #2a1505)" stroke-width="2" />
          </g>
          <g class="hh-leg-4" style="transform-origin: 59px 68px;">
            <ellipse cx="59" cy="73.5" rx="3.2" ry="5" fill="var(--hh-body-shade, #dcb87c)" stroke="var(--hh-stroke, #2a1505)" stroke-width="2" />
          </g>

          <!-- Игольчатая шапочка -->
          <path
            d="M 59,39 C 51,32 41,32 34,35 L 38,39 C 30,38 22,42 17,47 L 24,50 C 18,52 14,56 12,61 L 21,62 C 17,65 16,68 15,71 C 22,72 28,70 34,68 Z"
            fill="var(--hh-quills, #6b3f1a)"
            stroke="var(--hh-stroke, #2a1505)"
            stroke-width="2.4"
          />

          <!-- Тело и мордочка -->
          <path
            d="M 25,66 C 31,73 54,73 66,68 C 73,65 80,60 84,55 C 80,49 70,43 58,39 C 44,39 30,52 25,66 Z"
            fill="var(--hh-body, #f5d9a8)"
          />
          <path
            d="M 26,65 C 34,69 55,69 67,63 C 73,60 78,57 82,54 C 78,60 72,65 65,68 C 53,73 32,72 26,65 Z"
            fill="var(--hh-body-shade, #dcb87c)"
          />
          <path
            d="M 24,67 C 31,73 54,73 66,68 C 73,65 80,60 84,55 C 80,49 70,43 58,39"
            fill="none"
            stroke="var(--hh-stroke, #2a1505)"
            stroke-width="2.4"
          />

          <!-- Меховой зигзаг на спинке -->
          <path
            d="M 59,39 L 52,45 L 55,49 L 45,53 L 49,58 L 38,61 L 42,66 L 24,67 C 24,52 40,38 59,39 Z"
            fill="var(--hh-quills, #6b3f1a)"
          />
          <path
            d="M 59,39 L 52,45 L 55,49 L 45,53 L 49,58 L 38,61 L 42,66 L 24,67 M 44,43 C 37,44 31,47 27,51 M 39,52 C 33,53 28,56 24,60"
            fill="none"
            stroke="var(--hh-stroke, #2a1505)"
            stroke-width="2.2"
          />

          <!-- Ушко -->
          <g class="hh-ear">
            <ellipse cx="52" cy="46" rx="5" ry="6" transform="rotate(-15 52 46)" fill="var(--hh-body, #f5d9a8)" stroke="var(--hh-stroke, #2a1505)" stroke-width="2.2" />
            <ellipse cx="52" cy="46.5" rx="2.5" ry="3.2" transform="rotate(-15 52 46.5)" fill="var(--hh-body-shade, #dcb87c)" />
          </g>

          <!-- Глазик и носик -->
          <circle cx="67.5" cy="52" r="3.5" fill="var(--hh-dark, #1f2937)" />
          <circle cx="68.7" cy="50.8" r="1.3" fill="var(--hh-body, #f5d9a8)" />
          <ellipse cx="66" cy="58" rx="3.2" ry="1.7" fill="var(--hh-body-shade, #dcb87c)" />
          <path d="M 70.5,58.5 Q 73.5,61 76,58" fill="none" stroke="var(--hh-stroke, #2a1505)" stroke-width="1.8" />
          <ellipse cx="84.5" cy="54.5" rx="3.4" ry="2.6" transform="rotate(-10 84.5 54.5)" fill="var(--hh-dark, #1f2937)" stroke="var(--hh-stroke, #2a1505)" stroke-width="1.5" />

          <!-- Ближние лапки -->
          <g class="hh-leg-1" style="transform-origin: 33px 68px;">
            <ellipse cx="33" cy="74" rx="3.4" ry="5.2" fill="var(--hh-body, #f5d9a8)" stroke="var(--hh-stroke, #2a1505)" stroke-width="2.2" />
          </g>
          <g class="hh-leg-3" style="transform-origin: 53px 68px;">
            <ellipse cx="53" cy="74" rx="3.4" ry="5.2" fill="var(--hh-body, #f5d9a8)" stroke="var(--hh-stroke, #2a1505)" stroke-width="2.2" />
          </g>

        </g>
      </g>
    </svg>`;
}

// ============================================================
//  ГЛОБАЛЬНЫЙ ЛОАДЕР
// ============================================================
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

    loader.innerHTML = `${getHedgehogSvgHtml(100)}<div id="loaderText" class="mt-3 fw-bold text-secondary fs-5">Загрузка...</div>`;
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

// ============================================================
//  УВЕДОМЛЕНИЯ И UNDO
// ============================================================

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