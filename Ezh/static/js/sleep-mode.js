// sleep-mode.js
// Через 30 секунд бездействия ёжики выползают со всех сторон экрана.
// Блуждают по всему документу, периодически прыгают по календарю,
// грызут виджеты, катаются по диаграммам, висят на виджетах или шалят.

(function () {
    'use strict';

    const IDLE_MS = 30000;

    const WAKE_EVENTS = [
        'pointermove', 'pointerdown', 'pointerup', 'keydown', 'wheel',
        'scroll', 'touchstart', 'touchmove', 'focusin', 'click'
    ];

    const PALETTES = {
        classic: { body: '#f5d9a8', bodyShade: '#dcb87c', quills: '#6b3f1a', dark: '#1f2937', stroke: '#2a1505', blush: '#f0a8a0' },
        moon:    { body: '#c8c3dc', bodyShade: '#a09ab8', quills: '#3a3a6a', dark: '#0a0e1a', stroke: '#8b9bd4', blush: '#c97a8a' },
        forest:  { body: '#d4b88a', bodyShade: '#b89b6a', quills: '#3f5a2a', dark: '#1a2a0a', stroke: '#24380f', blush: '#e8a08a' },
        sunset:  { body: '#f6c89a', bodyShade: '#d99d6e', quills: '#c14a1a', dark: '#4a1a08', stroke: '#8a2e08', blush: '#f08888' },
        ocean:   { body: '#e0dcd0', bodyShade: '#b9c0c4', quills: '#4a5e6e', dark: '#2a3a48', stroke: '#2f3e4b', blush: '#e8b0a8' },
        mono:    { body: '#e8e8e8', bodyShade: '#b8b8b8', quills: '#4a4a4a', dark: '#1a1a1a', stroke: '#2a2a2a', blush: '#d0a0a0' }
    };

    const PROPS = {
        mushroom: `<path d="M-7 0 Q0 -11 7 0 Z" fill="#c0392b" stroke="#2a1505" stroke-width="1.4" stroke-linejoin="round"/><path d="M-3.5 -3 L-1.5 -5.5 M2.5 -2 L4.5 -4.5" stroke="#fff" stroke-width="1.2" opacity=".9" stroke-linecap="round"/><rect x="-2.2" y="0" width="4.4" height="7" rx="1.2" fill="#f5e6c8" stroke="#2a1505" stroke-width="1.2"/>`,
        apple: `<circle r="5.5" fill="#e74c3c" stroke="#2a1505" stroke-width="1.3"/><path d="M0 -5 Q1.5 -9 4.5 -10" fill="none" stroke="#3f5a2a" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="-2" cy="-1.5" rx="1.5" ry="2.2" fill="#fff" opacity=".35"/>`,
        leaf: `<path d="M-5 3 Q-7 -7 5 -8 Q6 2 -5 3 Z" fill="#7bab46" stroke="#2a1505" stroke-width="1.3" stroke-linejoin="round"/><path d="M-5 3 L3 -6" stroke="#2a1505" stroke-width="1" opacity=".45"/>`,
        acorn: `<path d="M-4 -1 Q0 -6 4 -1 Z" fill="#6b3f1a" stroke="#2a1505" stroke-width="1.2"/><ellipse cx="0" cy="3" rx="3.5" ry="4.5" fill="#d4a373" stroke="#2a1505" stroke-width="1.2"/><path d="M0 -5 L0 -7" stroke="#3f5a2a" stroke-width="1.4" stroke-linecap="round"/>`,
        snowflake: `<g stroke="#4d6bfe" stroke-width="1.4" stroke-linecap="round" fill="none"><path d="M0 -6 L0 6 M-5 -3 L5 3 M-5 3 L5 -3"/><circle r="1.5" fill="#4d6bfe" stroke="none"/></g>`,
        leaf2: `<path d="M-4 3 Q-6 -6 4 -7 Q5 2 -4 3 Z" fill="#c0743e" stroke="#2a1505" stroke-width="1.3" stroke-linejoin="round"/><path d="M-4 3 L2 -5" stroke="#2a1505" stroke-width="1" opacity=".45"/>`
    };

    function hedgehogNormalSVG(p, prop) {
        return `<svg viewBox="0 0 100 82" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="50" cy="78" rx="22" ry="2.6" fill="${p.stroke}" opacity=".13"/>
            <g class="whole">
                <g class="legs">
                  <g class="leg leg-back1"><ellipse cx="39" cy="73.5" rx="3.2" ry="5" fill="${p.bodyShade}" stroke="${p.stroke}" stroke-width="2"/></g>
                  <g class="leg leg-back2"><ellipse cx="59" cy="73.5" rx="3.2" ry="5" fill="${p.bodyShade}" stroke="${p.stroke}" stroke-width="2"/></g>
                  <g class="leg leg-front1"><ellipse cx="33" cy="74" rx="3.4" ry="5.2" fill="${p.body}" stroke="${p.stroke}" stroke-width="2.2"/></g>
                  <g class="leg leg-front2"><ellipse cx="53" cy="74" rx="3.4" ry="5.2" fill="${p.body}" stroke="${p.stroke}" stroke-width="2.2"/></g>
                </g>
                <g class="bob">
                  <path d="M 59,39 C 51,32 41,32 34,35 L 38,39 C 30,38 22,42 17,47 L 24,50 C 18,52 14,56 12,61 L 21,62 C 17,65 16,68 15,71 C 22,72 28,70 34,68 Z" fill="${p.quills}" stroke="${p.stroke}" stroke-width="2.4" stroke-linejoin="round"/>
                  <path d="M 25,66 C 31,73 54,73 66,68 C 73,65 80,60 84,55 C 80,49 70,43 58,39 C 44,39 30,52 25,66 Z" fill="${p.body}"/>
                  <path d="M 26,65 C 34,69 55,69 67,63 C 73,60 78,57 82,54 C 78,60 72,65 65,68 C 53,73 32,72 26,65 Z" fill="${p.bodyShade}"/>
                  <path d="M 24,67 C 31,73 54,73 66,68 C 73,65 80,60 84,55 C 80,49 70,43 58,39" fill="none" stroke="${p.stroke}" stroke-width="2.4"/>
                  <path d="M 59,39 L 52,45 L 55,49 L 45,53 L 49,58 L 38,61 L 42,66 L 24,67 C 24,52 40,38 59,39 Z" fill="${p.quills}"/>
                  <path d="M 59,39 L 52,45 L 55,49 L 45,53 L 49,58 L 38,61 L 42,66 L 24,67 M 44,43 C 37,44 31,47 27,51 M 39,52 C 33,53 28,56 24,60" fill="none" stroke="${p.stroke}" stroke-width="2.2" stroke-linejoin="round"/>
                  <g class="ear"><ellipse cx="52" cy="46" rx="5" ry="6" transform="rotate(-15 52 46)" fill="${p.body}" stroke="${p.stroke}" stroke-width="2.2"/><ellipse cx="52" cy="46.5" rx="2.5" ry="3.2" transform="rotate(-15 52 46.5)" fill="${p.bodyShade}"/></g>
                  <circle cx="67.5" cy="52" r="3.5" fill="${p.dark}"/>
                  <circle cx="68.7" cy="50.8" r="1.3" fill="${p.body}"/>
                  <ellipse cx="66" cy="58" rx="3.2" ry="1.7" fill="${p.blush}" opacity=".65"/>
                  <path d="M 70.5,58.5 Q 73.5,61 76,58" fill="none" stroke="${p.stroke}" stroke-width="1.8"/>
                  <ellipse cx="84.5" cy="54.5" rx="3.4" ry="2.6" transform="rotate(-10 84.5 54.5)" fill="${p.dark}" stroke="${p.stroke}" stroke-width="1.5"/>
                  ${prop ? `<g transform="translate(42,26)"><g class="prop">${prop}</g></g>` : ''}
                </g>
            </g>
        </svg>`;
    }

    const PACK = [
        { palette: 'classic', prop: 'mushroom',  size: 96,  speed: 1.0 },
        { palette: 'moon',    prop: 'apple',     size: 82,  speed: 1.3 },
        { palette: 'forest',  prop: 'leaf',      size: 88,  speed: 0.9 },
        { palette: 'sunset',  prop: 'acorn',     size: 76,  speed: 1.4 },
        { palette: 'ocean',   prop: 'snowflake', size: 90,  speed: 1.1 },
        { palette: 'mono',    prop: 'leaf2',     size: 78,  speed: 1.2 }
    ];

    let stage = null;
    let sparksContainer = null;
    let hhs = [];
    let running = false;
    let idleTimer = null;
    let collisionTimer = null;
    let fakeCursorEl = null;
    
    const busyWidgets = new Map();
    const busyElements = new Set();
    
    let realMouseX = window.innerWidth / 2;
    let realMouseY = window.innerHeight / 2;
    document.addEventListener('mousemove', e => {
        realMouseX = e.clientX;
        realMouseY = e.clientY;
    }, { passive: true });

    const originalValues = {
        groupSelect: null,
        notesWidgetText: null,
        friendState: null,
        teacherState: null
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function rafTween(dur, fn, h) {
        return new Promise(resolve => {
            const t0 = performance.now();
            function step(t) {
                if (h && h.cancelled) { resolve(); return; }
                const p = Math.min(1, (t - t0) / dur);
                fn(p);
                if (p < 1) requestAnimationFrame(step);
                else resolve();
            }
            requestAnimationFrame(step);
        });
    }

    function ensureStage() {
        if (stage) return stage;
        stage = document.createElement('div');
        stage.id = 'sleep-stage';
        stage.className = 'sleep-stage';

        sparksContainer = document.createElement('div');
        sparksContainer.className = 'sleep-sparks';
        stage.appendChild(sparksContainer);

        document.body.appendChild(stage);
        return stage;
    }

    function destroyStage() {
        if (stage && stage.parentElement) stage.parentElement.removeChild(stage);
        stage = null;
        sparksContainer = null;
    }

    function spawnHedgehog(cfg, startX, startY) {
        const el = document.createElement('div');
        el.className = 'hh hh-sleep';
        el.style.width = cfg.size + 'px';
        el.style.height = Math.round(cfg.size * 0.82) + 'px';

        const inner = document.createElement('div');
        inner.className = 'hh-inner';

        const body = document.createElement('div');
        body.className = 'hh-body';
        
        body.innerHTML = `
            <div class="hh-normal-wrap">${hedgehogNormalSVG(PALETTES[cfg.palette], PROPS[cfg.prop])}</div>
        `;

        inner.appendChild(body);
        el.appendChild(inner);
        stage.appendChild(el);

        const h = {
            el, inner, body, cfg,
            x: startX,
            y: startY,
            cancelled: false,
            heldWidget: null,
            isRolling: false
        };
        setPos(h, h.x, h.y);
        return h;
    }

    function setPos(h, x, y) {
        h.x = x;
        h.y = y;
        h.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    function faceDir(h, dir) {
        h.inner.classList.toggle('flip', dir < 0);
    }

    function setResting(h, resting) {
        h.el.classList.toggle('resting', !!resting);
    }

    // ============================================================
    //  КОЛЛИЗИИ
    // ============================================================

    function startCollisionLoop() {
        if (collisionTimer) clearInterval(collisionTimer);
        collisionTimer = setInterval(() => {
            if (!running) return;
            for (let i = 0; i < hhs.length; i++) {
                for (let j = i + 1; j < hhs.length; j++) {
                    const h1 = hhs[i], h2 = hhs[j];
                    if (h1.cancelled || h2.cancelled) continue;
                    
                    const dx = h2.x - h1.x;
                    const dy = h2.y - h1.y;
                    const dist = Math.hypot(dx, dy);
                    const minDist = (h1.cfg.size + h2.cfg.size) * 0.1; 
                    
                    if (dist > 0.1 && dist < minDist) {
                        const push = (minDist - dist) / 2;
                        const angle = Math.atan2(dy, dx);
                        
                        h1.x -= Math.cos(angle) * push;
                        h1.y -= Math.sin(angle) * push;
                        h2.x += Math.cos(angle) * push;
                        h2.y += Math.sin(angle) * push;
                        
                        h1.el.style.transform = `translate3d(${h1.x}px, ${h1.y}px, 0)`;
                        h2.el.style.transform = `translate3d(${h2.x}px, ${h2.y}px, 0)`;
                    }
                }
            }
        }, 50);
    }

    function getSafeTarget(h, tx, ty) {
        let safeX = tx;
        let safeY = ty;
        const minDist = h.cfg.size * 0.3; 

        for (const other of hhs) {
            if (other === h || other.cancelled) continue;
            const dist = Math.hypot(other.x - safeX, other.y - safeY);
            if (dist < minDist) {
                const angle = Math.atan2(safeY - other.y, safeX - other.x);
                safeX = other.x + Math.cos(angle) * minDist;
                safeY = other.y + Math.sin(angle) * minDist;
            }
        }

        const margin = 30;
        safeX = Math.max(margin, Math.min(document.body.scrollWidth - h.cfg.size - margin, safeX));
        safeY = Math.max(margin, Math.min(document.body.scrollHeight - h.cfg.size - margin, safeY));
        
        return { x: safeX, y: safeY };
    }

    // ============================================================
    //  ВИДЖЕТЫ
    // ============================================================

    const GNAWABLE_WIDGETS = [
        'widgetGlobalCard',
        'widgetLabsCard',
        'widgetNotesCard',
        'widgetPacingCard'
    ];

    function findGnawableWidget(includeBusy = false) {
        for (const id of GNAWABLE_WIDGETS) {
            const el = document.getElementById(id);
            if (!el || el.style.display === 'none') continue;
            if (!includeBusy && busyWidgets.has(id)) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {
                return el;
            }
        }
        return null;
    }

    function findCanvas() {
        const canvases = Array.from(document.querySelectorAll('.widget-canvas-wrap canvas'));
        for (const c of canvases) {
            if (c.offsetParent === null || busyWidgets.has(c.id)) continue;
            const r = c.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return c;
        }
        return null;
    }

    function findFriendsButton() {
        return Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('onclick') === 'rotateFriendsRight()');
    }

    function findTeachersButton() {
        return Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('onclick') === 'rotateTeachersRight()');
    }

    function grabWidget(w) {
        w.style.transition = 'none';
        w.classList.add('is-gnawed');
    }

    function releaseWidget(w) {
        if (!w) return;
        w.style.transition = 'transform .45s cubic-bezier(.2,.9,.3,1), opacity .45s, box-shadow .45s';
        w.style.transform = '';
        w.style.opacity = '';
        w.style.boxShadow = '';
        w.classList.remove('is-gnawed');
    }

    function gnawWidget(w, durMs, h) {
        w.style.transition = 'none';
        return rafTween(durMs, p => {
            const ramp = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
            const wv = Math.sin(p * durMs / 1000 * Math.PI * 2 * 3.4);
            const pull = 8 + 6 * Math.abs(wv);
            w.style.transform = `translateX(${-pull * ramp + wv * 3 * ramp}px) rotate(${wv * 2 * ramp}deg)`;
            w.style.opacity = String(1 - 0.5 * ramp);
            if (Math.random() < 0.15) spawnSparkNear(w);
        }, h);
    }

    // ============================================================
    //  ИСКРЫ И СТИКЕРЫ
    // ============================================================

    function spawnSparkNear(w) {
        if (!sparksContainer) return;
        const r = w.getBoundingClientRect();
        const s = document.createElement('div');
        s.className = 'sleep-spark';
        s.textContent = Math.random() < 0.5 ? '✦' : '✧';
        s.style.left = (r.left + window.scrollX + 10 + Math.random() * 20) + 'px';
        s.style.top = (r.top + window.scrollY + 10 + Math.random() * 16) + 'px';
        s.style.setProperty('--dx', (Math.random() * 30 - 15) + 'px');
        s.style.setProperty('--dy', (-20 - Math.random() * 15) + 'px');
        sparksContainer.appendChild(s);
        setTimeout(() => { if (s.parentElement) s.parentElement.removeChild(s); }, 700);
    }

    function showAngrySticker(h) {
        if (!sparksContainer) return;
        const s = document.createElement('div');
        s.className = 'angry-sticker';
        s.textContent = '💢';
        s.style.left = (h.x + h.cfg.size / 2 - 14) + 'px';
        s.style.top = (h.y - 20) + 'px';
        sparksContainer.appendChild(s);
        setTimeout(() => { if (s.parentElement) s.parentElement.removeChild(s); }, 1500);
    }

    // ============================================================
    //  ДВИЖЕНИЕ
    // ============================================================

    function calcDuration(dist) {
        return Math.max(600, dist / 0.15 + 200);
    }

    async function moveTo(h, tx, ty, dur) {
        const target = getSafeTarget(h, tx, ty);
        const x0 = h.x, y0 = h.y;
        faceDir(h, target.x < x0 ? -1 : 1);
        setResting(h, false);
        await rafTween(dur, p => {
            setPos(h, x0 + (target.x - x0) * p, y0 + (target.y - y0) * p);
        }, h);
    }

    async function hopTo(h, tx, ty, dur, height) {
        const target = getSafeTarget(h, tx, ty);
        const x0 = h.x, y0 = h.y;
        faceDir(h, target.x < x0 ? -1 : 1);
        setResting(h, true);
        await rafTween(dur, p => {
            setPos(h, x0 + (target.x - x0) * p, y0 + (target.y - y0) * p - Math.sin(p * Math.PI) * height);
        }, h);
    }

    // ============================================================
    //  ВОССТАНОВЛЕНИЕ СОСТОЯНИЙ
    // ============================================================

    function restoreGlobalState() {
        if (originalValues.groupSelect !== null) {
            const input = document.getElementById('groupSelect');
            if (input) input.value = originalValues.groupSelect;
            originalValues.groupSelect = null;
        }
        if (originalValues.notesWidgetText !== null) {
            const ta = document.getElementById('notesWidgetText');
            if (ta) {
                ta.value = originalValues.notesWidgetText;
                if (typeof onNotesWidgetInput === 'function') onNotesWidgetInput(ta);
            }
            originalValues.notesWidgetText = null;
        }
        if (originalValues.friendState !== null && typeof friendsList !== 'undefined') {
            friendsList.length = 0;
            originalValues.friendState.forEach(f => friendsList.push(f));
            originalValues.friendState = null;
            if (typeof saveFriendsOrder === 'function') saveFriendsOrder();
            if (typeof renderFriendDropdown === 'function') renderFriendDropdown();
            if (typeof renderFriendsCalendar === 'function') renderFriendsCalendar();
        }
        if (originalValues.teacherState !== null && typeof trackedTeachers !== 'undefined') {
            trackedTeachers.length = 0;
            originalValues.teacherState.forEach(t => trackedTeachers.push(t));
            originalValues.teacherState = null;
            if (typeof saveTeachersOrder === 'function') saveTeachersOrder();
            if (typeof renderTeacherDropdown === 'function') renderTeacherDropdown();
            if (typeof renderTeachersCalendars === 'function') renderTeachersCalendars();
        }
    }

    // ============================================================
    //  ДЕЙСТВИЯ
    // ============================================================

    async function enterFromEdge(h, edge) {
        let tx, ty;
        const margin = 50;

        if (edge === 'left') {
            tx = margin + Math.random() * 100;
            ty = window.scrollY + margin + Math.random() * (window.innerHeight - margin * 2);
        } else if (edge === 'right') {
            tx = window.innerWidth - h.cfg.size - margin - Math.random() * 100;
            ty = window.scrollY + margin + Math.random() * (window.innerHeight - margin * 2);
        } else if (edge === 'top') {
            tx = margin + Math.random() * (window.innerWidth - margin * 2);
            ty = window.scrollY + margin + Math.random() * 100;
        } else { 
            tx = margin + Math.random() * (window.innerWidth - margin * 2);
            ty = window.scrollY + window.innerHeight - h.cfg.size - margin - Math.random() * 100;
        }

        const dist = Math.hypot(tx - h.x, ty - h.y);
        await moveTo(h, tx, ty, calcDuration(dist));
        setResting(h, true);
    }

    async function doCalendarJump(h) {
        let cells = Array.from(document.querySelectorAll('.calendar-grid .day-col')).filter(c => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && c.offsetParent !== null;
        });
        if (cells.length < 2) return;

        cells.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

        const isForward = Math.random() < 0.5;
        if (!isForward) cells.reverse();

        const firstRect = cells[0].getBoundingClientRect();
        const startX = firstRect.left + window.scrollX + (isForward ? -20 : firstRect.width + 20);
        const startY = firstRect.bottom + window.scrollY + 10;

        const dist = Math.hypot(startX - h.x, startY - h.y);
        await moveTo(h, startX, startY, calcDuration(dist));
        if (h.cancelled) return;
        setResting(h, true);

        for (let i = 0; i < cells.length; i++) {
            if (h.cancelled) return;
            const r = cells[i].getBoundingClientRect();
            if (r.width === 0) continue;

            cells[i].classList.add('sleep-active');

            const tx = r.left + window.scrollX + r.width / 2 - h.cfg.size / 2;
            const ty = r.top + window.scrollY + r.height / 2 - h.cfg.size * 0.35;

            await hopTo(h, tx, ty, 650, 90);
            if (h.cancelled) {
                cells[i].classList.remove('sleep-active');
                return;
            }

            await sleep(400);
            cells[i].classList.remove('sleep-active');
        }

        const lastRect = cells[cells.length - 1].getBoundingClientRect();
        const endX = lastRect.right + window.scrollX + 20;
        const endY = lastRect.bottom + window.scrollY + 10;
        await hopTo(h, endX, endY, 500, 40);
        setResting(h, true);
    }

    async function doGnawWidget(h) {
        const widget = findGnawableWidget(true); 
        if (!widget) return;

        const isBusy = busyWidgets.has(widget.id);

        if (isBusy) {
            const otherHedgehog = busyWidgets.get(widget.id);
            const r = widget.getBoundingClientRect();
            const targetX = r.left + window.scrollX - h.cfg.size + 15;
            const targetY = r.top + window.scrollY + r.height / 2 - h.cfg.size / 2 + 10;

            const dist = Math.hypot(targetX - h.x, targetY - h.y);
            await moveTo(h, targetX, targetY, calcDuration(dist));
            if (h.cancelled) return;

            faceDir(h, 1);
            setResting(h, true);
            
            if (otherHedgehog && !otherHedgehog.cancelled) {
                otherHedgehog.cancelled = true;
                showAngrySticker(otherHedgehog);
            }

            grabWidget(widget);
            h.heldWidget = widget;
            h.el.classList.add('gnawing');

            await gnawWidget(widget, 2000, h);
            if (h.cancelled) return;

            h.el.classList.remove('gnawing');
            releaseWidget(h.heldWidget);
            h.heldWidget = null;
            setResting(h, true);
            return;
        }

        busyWidgets.set(widget.id, h);
        h.heldWidget = null;

        try {
            const r = widget.getBoundingClientRect();
            const targetX = r.left + window.scrollX - h.cfg.size + 15;
            const targetY = r.top + window.scrollY + r.height / 2 - h.cfg.size / 2 + 10;

            const dist = Math.hypot(targetX - h.x, targetY - h.y);
            await moveTo(h, targetX, targetY, calcDuration(dist));
            if (h.cancelled) return;

            faceDir(h, 1);
            setResting(h, true);
            grabWidget(widget);
            h.heldWidget = widget;
            h.el.classList.add('gnawing');

            await gnawWidget(widget, 2000, h);
            if (h.cancelled) return;

            h.el.classList.remove('gnawing');
            await sleep(300);
        } finally {
            h.el.classList.remove('gnawing');
            if (h.heldWidget) {
                releaseWidget(h.heldWidget);
                h.heldWidget = null;
            }
            setResting(h, true);
            busyWidgets.delete(widget.id);
        }
    }

    async function doHangOnWidget(h) {
        const widget = findGnawableWidget();
        if (!widget) return;

        busyWidgets.set(widget.id, h);
        try {
            const r = widget.getBoundingClientRect();
            const isLeft = Math.random() < 0.5;
            let targetX, targetY;
            const noseX_ratio = 84.5 / 100;
            const noseY_ratio = 54.5 / 82;

            if (isLeft) {
                targetX = r.left + window.scrollX - h.cfg.size * noseX_ratio;
                targetY = r.bottom + window.scrollY - (h.cfg.size * 0.82) * noseY_ratio;
            } else {
                targetX = r.right + window.scrollX - h.cfg.size * (1 - noseX_ratio);
                targetY = r.bottom + window.scrollY - (h.cfg.size * 0.82) * noseY_ratio;
            }
            
            const dist = Math.hypot(targetX - h.x, targetY - h.y);
            await moveTo(h, targetX, targetY, calcDuration(dist));
            if (h.cancelled) return;
            
            faceDir(h, isLeft ? 1 : -1);
            h.el.classList.add('hanging');
            setResting(h, true);

            await sleep(4000 + Math.random() * 2000); 
            
            h.el.classList.remove('hanging');
            await sleep(500);
        } finally {
            h.el.classList.remove('hanging');
            setResting(h, true);
            busyWidgets.delete(widget.id);
        }
    }

    async function doSlideDiagram(h) {
        const canvas = findCanvas();
        if (!canvas) return;

        busyWidgets.set(canvas.id, h);
        try {
            const r = canvas.getBoundingClientRect();
            const R = Math.min(r.width, r.height) * 0.35;
            const cx = r.left + window.scrollX + r.width / 2;
            const cy = r.top + window.scrollY + r.height / 2;

            const isLeft = Math.random() < 0.5;
            const startAngle = -Math.PI / 2;
            const endAngle = isLeft ? -Math.PI * 1.5 : Math.PI / 2;

            const startX = cx - h.cfg.size / 2;
            const startY = cy - R - h.cfg.size / 2;

            const dist = Math.hypot(startX - h.x, startY - h.y);
            await moveTo(h, startX, startY, calcDuration(dist));
            if (h.cancelled) return;
            setResting(h, true);
            faceDir(h, isLeft ? -1 : 1);

            h.el.classList.add('rolling'); 
            setResting(h, false);
            
            await rafTween(1500, p => {
                const angle = startAngle + (endAngle - startAngle) * p;
                const hx = cx + R * Math.cos(angle) - h.cfg.size / 2;
                const hy = cy + R * Math.sin(angle) - h.cfg.size / 2;
                setPos(h, hx, hy);
            }, h);
            if (h.cancelled) return;
            
            setResting(h, true);
            h.el.classList.remove('rolling');
            
            const dropX = cx + R * Math.cos(endAngle) - h.cfg.size / 2;
            const dropY = cy + R + 50;
            await hopTo(h, dropX, dropY, 500, 30);

        } finally {
            h.el.classList.remove('rolling');
            setResting(h, true);
            busyWidgets.delete(canvas.id);
        }
    }

    // ХОМЯК В КОЛЕСЕ (СВЕРХУ, ВРАЩЕНИЕ ВНУТРИ ДИАГРАММЫ)
    async function doRunOnChart(h) {
        const canvas = findCanvas();
        if (!canvas) return;

        busyWidgets.set(canvas.id, h);
        
        let chartInst = null;
        if (canvas.id === 'globalStatsChart') chartInst = globalChart;
        else if (canvas.id === 'labStatsChart') chartInst = globalLabChart;
        else if (canvas.id === 'labStatsProChart') chartInst = globalLabChartPro;

        try {
            const r = canvas.getBoundingClientRect();
            const cx = r.left + window.scrollX + r.width / 2;
            const cy = r.top + window.scrollY + r.height / 2;
            const R = Math.min(r.width, r.height) * 0.35;

            // Ежик встает на САМУЮ ВЕРХНЮЮ точку диаграммы
            const targetX = cx - h.cfg.size / 2;
            const targetY = cy - R - (h.cfg.size * 0.82);

            const dist = Math.hypot(targetX - h.x, targetY - h.y);
            await moveTo(h, targetX, targetY, calcDuration(dist));
            if (h.cancelled) return;

            faceDir(h, 1);
            setResting(h, false); // Анимация бега

            const startRotation = chartInst ? (chartInst.options.rotation || -Math.PI / 2) : 0;
            const duration = 2000; // УСКОРЕНО (было 4000)
            const loops = 4; // 4 полных оборота

            await rafTween(duration, p => {
                if (chartInst) {
                    chartInst.options.rotation = startRotation - (Math.PI * 2 * loops) * p;
                    chartInst.update('none');
                }
            }, h);

            if (!h.cancelled) {
                if (chartInst) {
                    chartInst.options.rotation = -Math.PI / 2; // Возвращаем на место
                    chartInst.update('none');
                }
            }

            setResting(h, true);

        } finally {
            if (chartInst) {
                chartInst.options.rotation = -Math.PI / 2;
                chartInst.update('none');
            }
            setResting(h, true);
            busyWidgets.delete(canvas.id);
        }
    }

    function getOrCreateFakeCursor() {
        if (!fakeCursorEl) {
            fakeCursorEl = document.createElement('div');
            fakeCursorEl.className = 'fake-cursor';
            fakeCursorEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5L19 14L12.5 15.5L9 22L5.5 3.5Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
            stage.appendChild(fakeCursorEl);
            document.body.classList.add('cursor-hidden');
        }
        return fakeCursorEl;
    }

    async function doStealCursor(h) {
        const cursor = getOrCreateFakeCursor();
        
        let targetX, targetY;
        if (cursor.style.transform) {
            // Курсор уже валяется на экране - берем его координаты
            const match = cursor.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)/);
            if (match) {
                targetX = parseFloat(match[1]) + window.scrollX - h.cfg.size / 2;
                targetY = parseFloat(match[2]) + window.scrollY - h.cfg.size / 2;
            }
        }
        
        if (targetX === undefined) {
            // Курсор еще у пользователя
            targetX = realMouseX + window.scrollX - h.cfg.size / 2;
            targetY = realMouseY + window.scrollY - h.cfg.size / 2;
            cursor.style.transform = `translate(${realMouseX}px, ${realMouseY}px)`;
        }
        
        const dist = Math.hypot(targetX - h.x, targetY - h.y);
        await moveTo(h, targetX, targetY, calcDuration(dist));
        if (h.cancelled) return;
        
        setResting(h, true);
        faceDir(h, 1);
        await sleep(300);

        // Привязываем курсор к морде
        const noseX = h.x + (84.5 / 100) * h.cfg.size;
        const noseY = h.y + (54.5 / 82) * (h.cfg.size * 0.82);
        
        // Сдвигаем курсор чуть влево и вверх, чтобы он был "в зубах"
        cursor.style.transform = `translate(${noseX - 8}px, ${noseY - 4}px)`;
        
        // Убегаем с курсором
        const escapeX = Math.random() * (window.innerWidth - h.cfg.size);
        const escapeY = Math.random() * (window.innerHeight - h.cfg.size);
        
        const x0 = h.x, y0 = h.y;
        faceDir(h, escapeX < x0 ? -1 : 1);
        setResting(h, false); // Бежим
        
        await rafTween(calcDuration(Math.hypot(escapeX - x0, escapeY - y0)), p => {
            const curX = x0 + (escapeX - x0) * p;
            const curY = y0 + (escapeY - y0) * p;
            setPos(h, curX, curY);
            
            const curNoseX = curX + (84.5 / 100) * h.cfg.size;
            const curNoseY = curY + (54.5 / 82) * (h.cfg.size * 0.82);
            cursor.style.transform = `translate(${curNoseX - 8}px, ${curNoseY - 4}px)`;
        }, h);
        
        setResting(h, true);
        await sleep(500);
    }

    async function doMischiefFriends(h) {
        const btn = findFriendsButton();
        if (!btn) return;

        if (!originalValues.friendState && typeof friendsList !== 'undefined') {
            originalValues.friendState = JSON.parse(JSON.stringify(friendsList));
        }

        const r = btn.getBoundingClientRect();
        const targetX = r.left + window.scrollX + r.width / 2 - h.cfg.size / 2;
        const targetY = r.top + window.scrollY + r.height / 2 - h.cfg.size / 2;

        const dist = Math.hypot(targetX - h.x, targetY - h.y);
        await moveTo(h, targetX, targetY, calcDuration(dist));
        if (h.cancelled) return;
        
        setResting(h, true);
        faceDir(h, 1);

        const presses = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < presses; i++) {
            if (h.cancelled) break;
            await hopTo(h, targetX, targetY, 300, 30);
            
            if (typeof rotateFriendsRight === 'function') {
                rotateFriendsRight();
            } else {
                btn.click();
            }
            await sleep(2000); 
        }
        
        restoreGlobalState();
    }

    async function doMischiefTeachers(h) {
        const btn = findTeachersButton();
        if (!btn) return;

        if (!originalValues.teacherState && typeof trackedTeachers !== 'undefined') {
            originalValues.teacherState = JSON.parse(JSON.stringify(trackedTeachers));
        }

        const r = btn.getBoundingClientRect();
        const targetX = r.left + window.scrollX + r.width / 2 - h.cfg.size / 2;
        const targetY = r.top + window.scrollY + r.height / 2 - h.cfg.size / 2;

        const dist = Math.hypot(targetX - h.x, targetY - h.y);
        await moveTo(h, targetX, targetY, calcDuration(dist));
        if (h.cancelled) return;
        
        setResting(h, true);
        faceDir(h, 1);

        const presses = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < presses; i++) {
            if (h.cancelled) break;
            await hopTo(h, targetX, targetY, 300, 30);
            
            if (typeof rotateTeachersRight === 'function') {
                rotateTeachersRight();
            } else {
                btn.click();
            }
            await sleep(2000); 
        }
        
        restoreGlobalState();
    }

    async function doMischiefGroup(h) {
        if (busyElements.has('groupSelect')) return;
        busyElements.add('groupSelect');
        
        const input = document.getElementById('groupSelect');
        if (!input) { busyElements.delete('groupSelect'); return; }

        const oldText = input.value;

        try {
            const r = input.getBoundingClientRect();
            const isLeft = Math.random() < 0.5;
            const targetX = isLeft ? r.left + window.scrollX - h.cfg.size + 10 : r.right + window.scrollX - 10;
            const targetY = r.top + window.scrollY + r.height / 2 - h.cfg.size / 2;

            const dist = Math.hypot(targetX - h.x, targetY - h.y);
            await moveTo(h, targetX, targetY, calcDuration(dist));
            if (h.cancelled) return;

            setResting(h, true);
            faceDir(h, isLeft ? 1 : -1);

            let str = "";
            if (typeof allGroups !== 'undefined' && allGroups.length > 0) {
                str = allGroups[Math.floor(Math.random() * allGroups.length)];
            } else {
                str = "ПИН/б-24-1-о"; // fallback
            }

            input.value = '';
            for (let i = 0; i < str.length; i++) {
                if (h.cancelled) break;
                input.value = str.slice(0, i + 1); 
                await sleep(100 + Math.random() * 100);
            }
            await sleep(1500);
            
        } finally {
            input.value = oldText; 
            busyElements.delete('groupSelect');
            setResting(h, true);
        }
    }

    async function doMischiefNotes(h) {
        if (busyElements.has('notesWidgetText')) return;
        busyElements.add('notesWidgetText');

        const ta = document.getElementById('notesWidgetText');
        if (!ta) { busyElements.delete('notesWidgetText'); return; }

        const oldText = ta.value; 

        try {
            const r = ta.getBoundingClientRect();
            const targetX = r.right + window.scrollX - h.cfg.size - 10;
            const targetY = r.bottom + window.scrollY - h.cfg.size - 10;

            const dist = Math.hypot(targetX - h.x, targetY - h.y);
            await moveTo(h, targetX, targetY, calcDuration(dist));
            if (h.cancelled) return;
            setResting(h, true);
            faceDir(h, -1);

            const poems = [
                "Ёжик по лесу бежал,\nГриб на спинке он держал.\nВдруг споткнулся, кувырком,\nПокатился колобком!",
                "Под сосной сидит ежик,\nОн на солнышке лежит.\nНожки греет, уши греет,\nПотихонечку сопит.",
                "Я колючий серый ёж,\nНа клубок я похож.\nЯблоко несу домой,\nДеткам, милым и родным.",
                "Ёжик, ёжик, ты куда?\nУ меня в лесу беда:\nЗайцы съели весь овёс,\nНе осталось и волос!",
                "Фыр-фыр-фыр, — пыхтит ежонок,\nОн совсем ещё спросонок.\nМама-еж ему сказала:\n— Ты поспи ещё сначала.",
                "На колючей на спине\nЁж несёт грибок к норе.\nОн трудяга, он герой,\nВозвращается домой."
            ];
            const poem = poems[Math.floor(Math.random() * poems.length)];

            ta.value = '';
            for (let i = 0; i < poem.length; i++) {
                if (h.cancelled) break;
                ta.value = poem.slice(0, i + 1);
                ta.scrollTop = ta.scrollHeight;
                await sleep(50 + Math.random() * 50);
            }
            await sleep(2000);

        } finally {
            ta.value = oldText; 
            if (typeof onNotesWidgetInput === 'function') onNotesWidgetInput(ta);
            busyElements.delete('notesWidgetText');
            setResting(h, true);
        }
    }

    async function doIdle(h) {
        const sit = Math.random() < 0.5;

        if (sit) {
            setResting(h, true);
            h.el.classList.add('sitting');
            await sleep(800);

            const sitTime = 4000 + Math.random() * 3000;
            const scratchChance = Math.random() < 0.6;

            if (scratchChance) {
                await sleep(1000); 
                h.el.classList.add('scratching');
                await sleep(1500); 
                h.el.classList.remove('scratching');
                await sleep(sitTime - 2500);
            } else {
                await sleep(sitTime);
            }

            h.el.classList.remove('sitting');
            await sleep(800);
            setResting(h, false);
        } else {
            const actions = ['sniff', 'look_around'];
            const action = actions[Math.floor(Math.random() * actions.length)];
            h.el.classList.add('idle-' + action);
            setResting(h, true);

            await sleep(2000 + Math.random() * 2000);

            h.el.classList.remove('idle-' + action);
            setResting(h, false);
        }
    }

    async function wander(h) {
        const points = [];
        let curX = h.x;
        let curY = h.y;
        
        for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 80 + Math.random() * 200;
            let nextX = curX + Math.cos(angle) * dist;
            let nextY = curY + Math.sin(angle) * dist;
            
            const margin = 30;
            nextX = Math.max(margin, Math.min(document.body.scrollWidth - h.cfg.size - margin, nextX));
            nextY = Math.max(margin, Math.min(document.body.scrollHeight - h.cfg.size - margin, nextY));
            
            points.push({x: nextX, y: nextY});
            curX = nextX;
            curY = nextY;
        }
        
        for (const pt of points) {
            if (h.cancelled) return;
            const dist = Math.hypot(pt.x - h.x, pt.y - h.y);
            await moveTo(h, pt.x, pt.y, calcDuration(dist));
            
            if (Math.random() < 0.3) {
                setResting(h, true);
                await sleep(300 + Math.random() * 700);
            }
        }
        setResting(h, true);
        await sleep(200 + Math.random() * 500);
    }

    // ============================================================
    //  ЦИКЛ ЖИЗНИ
    // ============================================================

    async function liveLoop(h, edge) {
        setResting(h, false);
        await enterFromEdge(h, edge);
        if (h.cancelled) return;

        while (!h.cancelled && running) {
            const rnd = Math.random();

            if (rnd < 0.06) {
                await doCalendarJump(h);
            } else if (rnd < 0.12) {
                await doGnawWidget(h);
            } else if (rnd < 0.18) {
                await doHangOnWidget(h);
            } else if (rnd < 0.24) {
                await doSlideDiagram(h);
            } else if (rnd < 0.30) {
                await doStealCursor(h);
            } else if (rnd < 0.36) {
                await doMischiefFriends(h);
            } else if (rnd < 0.42) {
                await doMischiefTeachers(h);
            } else if (rnd < 0.46) {
                await doMischiefGroup(h);
            } else if (rnd < 0.50) {
                await doMischiefNotes(h);
            } else if (rnd < 0.56) {
                await doRunOnChart(h);
            } else if (rnd < 0.70) {
                await doIdle(h);
            } else {
                await wander(h);
            }

            if (h.cancelled || !running) return;
            await sleep(300 + Math.random() * 800);
        }
    }

    // ============================================================
    //  СТАРТ / СТОП
    // ============================================================

    function startSleepMode() {
        if (running) return;
        running = true;
        busyWidgets.clear();
        busyElements.clear();
        originalValues.groupSelect = null;
        originalValues.notesWidgetText = null;
        originalValues.friendState = null;
        originalValues.teacherState = null;
        fakeCursorEl = null;

        try {
            ensureStage();
            hhs = [];
            startCollisionLoop();

            const activePack = window.innerWidth < 700 ? PACK.slice(0, 3) : PACK;
            const edges = ['left', 'right', 'top', 'bottom'];

            activePack.forEach((cfg, i) => {
                const edge = edges[Math.floor(Math.random() * edges.length)];
                let startX, startY;

                if (edge === 'left') {
                    startX = -cfg.size;
                    startY = window.scrollY + Math.random() * window.innerHeight;
                } else if (edge === 'right') {
                    startX = window.innerWidth;
                    startY = window.scrollY + Math.random() * window.innerHeight;
                } else if (edge === 'top') {
                    startX = Math.random() * window.innerWidth;
                    startY = window.scrollY - cfg.size;
                } else { 
                    startX = Math.random() * window.innerWidth;
                    startY = window.scrollY + window.innerHeight;
                }

                const hh = spawnHedgehog(cfg, startX, startY);
                hhs.push(hh);

                setTimeout(() => {
                    if (!running) return;
                    liveLoop(hh, edge);
                }, i * 400);
            });

            document.addEventListener('visibilitychange', onVisibilityChange);
        } catch (e) {
            console.error('[sleep] start failed', e);
            running = false;
            try { stopSleepMode(); } catch (e2) {}
        }
    }

    function stopSleepMode() {
        if (!running) return;
        running = false;
        busyWidgets.clear();
        busyElements.clear();
        
        if (collisionTimer) { clearInterval(collisionTimer); collisionTimer = null; }
        
        document.body.classList.remove('cursor-hidden');
        if (fakeCursorEl && fakeCursorEl.parentElement) fakeCursorEl.remove();
        fakeCursorEl = null;

        restoreGlobalState();

        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

        hhs.forEach(h => {
            h.cancelled = true;
            if (h.heldWidget) { releaseWidget(h.heldWidget); h.heldWidget = null; }
            h.el.style.transition = 'opacity .4s ease';
            h.el.style.opacity = '0';
        });

        setTimeout(() => {
            hhs.forEach(h => {
                if (h.el.parentElement) h.el.parentElement.removeChild(h.el);
            });
            hhs = [];
        }, 420);

        document.removeEventListener('visibilitychange', onVisibilityChange);
        setTimeout(() => { if (!running) destroyStage(); }, 500);
    }

    function onVisibilityChange() {
        if (document.hidden) {
            hhs.forEach(h => h.cancelled = true);
            restoreGlobalState();
            document.body.classList.remove('cursor-hidden');
            if (fakeCursorEl && fakeCursorEl.parentElement) fakeCursorEl.remove();
            fakeCursorEl = null;
        } else if (running) {
            hhs.forEach((h, i) => {
                if (h.cancelled) {
                    h.cancelled = false;
                    const edge = ['left', 'right', 'top', 'bottom'][i % 4];
                    liveLoop(h, edge);
                }
            });
        }
    }

    // ============================================================
    //  ДЕТЕКТОР БЕЗДЕЙСТВИЯ
    // ============================================================

    function isSleepModeEnabled() {
        return localStorage.getItem('showSleepMode') !== 'false';
    }

    function shouldIgnoreWake() {
        if (document.hidden) return true;
        if (document.querySelector('.modal.show')) return true;
        const loader = document.getElementById('globalLoader');
        if (loader && loader.style.display === 'flex') return true;
        if (document.body.classList.contains('widget-dragging')) return true;
        return false;
    }

    function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        if (!isSleepModeEnabled()) return;
        idleTimer = setTimeout(() => {
            if (shouldIgnoreWake()) { resetIdleTimer(); return; }
            startSleepMode();
        }, IDLE_MS);
    }

    function onUserActivity() {
        if (running) stopSleepMode();
        resetIdleTimer();
    }

    // ============================================================
    //  API
    // ============================================================

    window.startSleepMode = function () { resetIdleTimer(); };
    window.stopSleepMode = function () {
        stopSleepMode();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };
    window.isSleepModeEnabled = isSleepModeEnabled;

    document.addEventListener('DOMContentLoaded', function () {
        WAKE_EVENTS.forEach(ev => document.addEventListener(ev, onUserActivity, { passive: true }));
        resetIdleTimer();
    });

})();