// ============================================================
//  СВОЯ ТЕМА + СОХРАНЁННЫЕ ПРЕСЕТЫ + INDEXEDDB ДЛЯ ФОТО
// ============================================================

const CUSTOM_THEME_STORAGE_KEY  = 'customTheme';
const CUSTOM_THEME_PRESETS_KEY  = 'customThemePresets';
const CUSTOM_THEME_ADVANCED_KEY = 'customThemeAdvancedShown';
const CUSTOM_THEME_SECTIONS_KEY = 'customThemeSections_v2';

const IDB_NAME    = 'ezh-theme';
const IDB_VERSION = 1;
const IDB_STORE   = 'photos';

const PHOTO_MAX_DIM = 800;
const PHOTO_QUALITY = 0.72;
const PHOTO_MAX_INPUT_BYTES = 10 * 1024 * 1024;

let _customThemeApplyToken = 0;
let _idbAvailable = null;
let _customThemeAdvancedShown = localStorage.getItem(CUSTOM_THEME_ADVANCED_KEY) === 'true';
let _lastPromptedPhotoId = null;

const CUSTOM_THEME_FIELDS = [
    { group: 'Основное', basic: true, fields: [
        { key: '--bg-body',        label: 'Фон страницы' },
        { key: '--bg-surface',     label: 'Карточки' },
        { key: '--text-primary',   label: 'Основной текст' },
        { key: '--text-secondary', label: 'Вторичный текст' },
        { key: '--accent',         label: 'Акцент' },
        { key: '--accent-hover',   label: 'Акцент (hover)' },
    ]},
    { group: 'Диаграммы', basic: true, fields: [
        { key: '--chart-passed',    label: 'Прошло' },
        { key: '--chart-remaining', label: 'Осталось' },
        { key: '--chart-lab-done',  label: 'Лабы: сдано' },
        { key: '--chart-lab-left',  label: 'Лабы: осталось' },
    ]},
    { group: 'Общие пары у друзей', basic: true, fields: [
        { key: '--friend-common-bg',    label: 'Общая пара: фон' },
        { key: '--friend-common-text',  label: 'Общая пара: текст' },
        { key: '--friend-warning-bg',   label: 'Разные корпуса: фон' },
        { key: '--friend-warning-text', label: 'Разные корпуса: текст' },
        { key: '--friend-same-bg',      label: 'Один корпус: фон' },
        { key: '--friend-same-text',    label: 'Один корпус: текст' },
        { key: '--friend-info-bg',      label: 'Справка: фон' },
        { key: '--friend-info-text',    label: 'Справка: текст' },
    ]},
    { group: 'Фоны и границы', fields: [
        { key: '--bg-surface-alt',  label: 'Вспом. фон' },
        { key: '--bg-surface-soft', label: 'Мягкий фон' },
        { key: '--bg-hover',        label: 'Hover' },
        { key: '--border-color',    label: 'Границы' },
        { key: '--border-soft',     label: 'Границы (мягко)' },
    ]},
    { group: 'Текст', fields: [
        { key: '--text-muted',  label: 'Тусклый' },
        { key: '--text-invert', label: 'Инверсный' },
    ]},
    { group: 'Акцент', fields: [
        { key: '--accent-soft',   label: 'Акцент (мягкий)' },
        { key: '--accent-border', label: 'Акцент (гран.)' },
    ]},
];

function defaultCustomTheme() {
    return {
        colors: {
            '--bg-body':         '#f8fafc',
            '--bg-surface':      '#ffffff',
            '--bg-surface-alt':  '#f1f5f9',
            '--bg-surface-soft': '#f8fafc',
            '--bg-hover':        '#e2e8f0',
            '--border-color':    '#e2e8f0',
            '--border-soft':     '#f1f5f9',
            '--text-primary':    '#334155',
            '--text-secondary':  '#64748b',
            '--text-muted':      '#94a3b8',
            '--text-invert':     '#ffffff',
            '--accent':          '#6366f1',
            '--accent-hover':    '#4f46e5',
            '--accent-soft':     '#eef2ff',
            '--accent-border':   '#c7d2fe',
            '--status-green':     '#10b981',
            '--status-orange':    '#f59e0b',
            '--status-red':       '#ef4444',
            '--status-completed': '#94a3b8',
            '--chart-passed':     '#6366f1',
            '--chart-remaining':  '#cbd5e1',
            '--chart-lab-done':   '#14b8a6',
            '--chart-lab-left':   '#f59e0b',
            '--friend-common-bg':     '#10b981',
            '--friend-common-text':   '#ffffff',
            '--friend-warning-bg':    '#f59e0b',
            '--friend-warning-text':  '#ffffff',
            '--friend-same-bg':       '#d1fae5',
            '--friend-same-text':     '#065f46',
            '--friend-info-bg':       '#e0e7ff',
            '--friend-info-text':     '#3730a3',
        },
        stickers:        '',
        stickersOpacity: 0.15,
        photoId:         null,
        photoOpacity:    0.15,
    };
}

// ============================================================
//  INDEXEDDB
// ============================================================

function idbOpen() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('IndexedDB not supported')); return; }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

async function idbPutPhoto(key, dataUrl) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ key, dataUrl, bytes: dataUrl.length, createdAt: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
    });
}

async function idbGetPhoto(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result ? req.result.dataUrl : null); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

async function idbGetPhotoInfo(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

async function idbDeletePhoto(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
    });
}

async function idbIsAvailable() {
    if (_idbAvailable !== null) return _idbAvailable;
    try { await idbOpen(); _idbAvailable = true; } catch (e) { _idbAvailable = false; }
    return _idbAvailable;
}

function genPhotoKey() {
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ============================================================
//  ХРАНЕНИЕ
// ============================================================

function loadCustomTheme() {
    try {
        const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
        if (!raw) return defaultCustomTheme();
        const parsed = JSON.parse(raw);
        const def = defaultCustomTheme();
        return {
            colors:          Object.assign({}, def.colors, parsed.colors || {}),
            stickers:        parsed.stickers || '',
            stickersOpacity: typeof parsed.stickersOpacity === 'number' ? parsed.stickersOpacity : def.stickersOpacity,
            photoId:         parsed.photoId || null,
            photoOpacity:    typeof parsed.photoOpacity === 'number' ? parsed.photoOpacity : def.photoOpacity,
        };
    } catch (e) {
        return defaultCustomTheme();
    }
}

function saveCustomTheme(data) {
    try {
        const serialized = {
            colors:          data.colors || {},
            stickers:        data.stickers || '',
            stickersOpacity: typeof data.stickersOpacity === 'number' ? data.stickersOpacity : 0.15,
            photoId:         data.photoId || null,
            photoOpacity:    typeof data.photoOpacity === 'number' ? data.photoOpacity : 0.15,
        };
        localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(serialized));
        return { ok: true };
    } catch (e) {
        console.error('[custom-theme] save failed', e);
        if (e && e.name === 'QuotaExceededError') {
            alert('Не удалось сохранить: превышен лимит localStorage. Удалите старые пресеты.');
        }
        return { ok: false, error: e };
    }
}

function loadCustomThemePresets() {
    try {
        const raw = localStorage.getItem(CUSTOM_THEME_PRESETS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

function saveCustomThemePresets(list) {
    const originalLength = list.length;
    let working = list.slice();
    while (true) {
        try {
            localStorage.setItem(CUSTOM_THEME_PRESETS_KEY, JSON.stringify(working));
            return { ok: true, dropped: originalLength - working.length };
        } catch (e) {
            const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
            if (isQuota && working.length > 0) { working.shift(); continue; }
            return { ok: false, error: e, dropped: originalLength - working.length };
        }
    }
}

// ============================================================
//  МИГРАЦИЯ СО СТАРОГО ФОРМАТА
// ============================================================

async function migrateLegacyStorageIfNeeded() {
    if (!(await idbIsAvailable())) return;

    try {
        const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.photoUrl && typeof parsed.photoUrl === 'string') {
                const url = parsed.photoUrl;
                if (url.startsWith('data:image/')) {
                    const key = genPhotoKey();
                    await idbPutPhoto(key, url);
                    parsed.photoId = 'idb:' + key;
                } else if (url.startsWith('http')) {
                    parsed.photoId = 'url:' + url;
                } else {
                    parsed.photoId = null;
                }
                delete parsed.photoUrl;
                localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(parsed));
                console.log('[custom-theme] migrated active theme photo to IDB');
            }
        }
    } catch (e) { console.warn('[custom-theme] migration of active theme failed', e); }

    try {
        const raw = localStorage.getItem(CUSTOM_THEME_PRESETS_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                let changed = false;
                for (const preset of list) {
                    const d = preset && preset.data;
                    if (!d || !d.photoUrl || typeof d.photoUrl !== 'string') continue;
                    const url = d.photoUrl;
                    if (url.startsWith('data:image/')) {
                        const key = genPhotoKey();
                        await idbPutPhoto(key, url);
                        d.photoId = 'idb:' + key;
                    } else if (url.startsWith('http')) {
                        d.photoId = 'url:' + url;
                    } else {
                        d.photoId = null;
                    }
                    delete d.photoUrl;
                    changed = true;
                }
                if (changed) {
                    localStorage.setItem(CUSTOM_THEME_PRESETS_KEY, JSON.stringify(list));
                    console.log('[custom-theme] migrated presets photos to IDB');
                }
            }
        }
    } catch (e) { console.warn('[custom-theme] migration of presets failed', e); }
}

// ============================================================
//  ХЕЛПЕРЫ ЦВЕТА
// ============================================================

function hexToRgba(hex, alpha) {
    if (!hex || hex[0] !== '#') return `rgba(255,255,255,${alpha})`;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function rgbToHex(c) {
    const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + toHex(c.r) + toHex(c.g) + toHex(c.b);
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function hslAdjust(rgb, dh, ds, dl) {
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const h = hsl.h + dh;
    const s = Math.max(0, Math.min(1, hsl.s + ds));
    const l = Math.max(0, Math.min(1, hsl.l + dl));
    return hslToRgb(h, s, l);
}

function stickersToSvgDataUri(emojiString, opacity) {
    const emojis = String(emojiString || '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
    if (emojis.length === 0) return null;
    const size = 180;
    const cell = size / 2;
    let texts = '';
    for (let i = 0; i < emojis.length; i++) {
        const x = (i % 2) * cell + cell / 2;
        const y = Math.floor(i / 2) * cell + cell / 2;
        texts += `<text x="${x}" y="${y}" font-size="${Math.round(cell * 0.7)}" text-anchor="middle" dominant-baseline="central" opacity="${opacity}">${emojis[i]}</text>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${texts}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            reject(new Error('Не картинка'));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            try {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const scale = maxDim / Math.max(width, height);
                    width  = Math.max(1, Math.round(width  * scale));
                    height = Math.max(1, Math.round(height * scale));
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            } catch (err) { reject(err); }
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Не удалось прочитать изображение'));
        };
        img.src = objectUrl;
    });
}

function dataUrlByteSize(dataUrl) {
    if (!dataUrl) return 0;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return dataUrl.length;
    return Math.round((dataUrl.length - comma - 1) * 0.75);
}

// ============================================================
//  ИЗВЛЕЧЕНИЕ ПАЛИТРЫ ИЗ ФОТО
// ============================================================

function extractPaletteFromImage(dataUrl, sampleSize = 120, keep = 24) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (!dataUrl.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
        }
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = sampleSize;
                canvas.height = sampleSize;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

                let pixels;
                try {
                    pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
                } catch (secErr) {
                    reject(new Error('CORS: сервер не разрешает анализ этого изображения.'));
                    return;
                }

                const buckets = new Map();
                for (let i = 0; i < pixels.length; i += 4) {
                    const a = pixels[i + 3];
                    if (a < 128) continue;
                    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
                    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
                    if (!buckets.has(key)) buckets.set(key, { r: 0, g: 0, b: 0, count: 0 });
                    const bk = buckets.get(key);
                    bk.r += r; bk.g += g; bk.b += b; bk.count++;
                }

                const colors = [];
                for (const b of buckets.values()) {
                    colors.push({
                        r: b.r / b.count,
                        g: b.g / b.count,
                        b: b.b / b.count,
                        count: b.count,
                    });
                }
                colors.sort((a, b) => b.count - a.count);
                const top = colors.slice(0, keep);
                top.forEach(c => {
                    const hsl = rgbToHsl(c.r, c.g, c.b);
                    c.h = hsl.h; c.s = hsl.s; c.l = hsl.l;
                });

                resolve(top);
            } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
        img.src = dataUrl;
    });
}

function buildThemeFromPalette(palette) {
    if (!palette || palette.length === 0) return null;

    let lumSum = 0, cnt = 0;
    palette.forEach(c => { lumSum += c.l * c.count; cnt += c.count; });
    const avgLum = cnt > 0 ? lumSum / cnt : 0.5;
    const isDark = avgLum < 0.4;

    const bySat = [...palette].sort((a, b) => b.s - a.s);
    const byLum = [...palette].sort((a, b) => a.l - b.l);

    let accentC = bySat.find(c => c.s > 0.25 && c.l > 0.2 && c.l < 0.8);
    if (!accentC) accentC = bySat[0];

    let bgC = isDark ? byLum[0] : byLum[byLum.length - 1];
    if (isDark && bgC.l > 0.35) bgC = { r: 15,  g: 23,  b: 42 };
    if (!isDark && bgC.l < 0.85) bgC = { r: 248, g: 250, b: 252 };

    let textC = isDark ? byLum[byLum.length - 1] : byLum[0];
    if (isDark && textC.l < 0.7)  textC = { r: 226, g: 232, b: 240 };
    if (!isDark && textC.l > 0.4) textC = { r: 51,  g: 65,  b: 85 };

    const accent      = accentC;
    const accentHover = hslAdjust(accent,  0,  0,    isDark ?  0.10 : -0.12);
    const accentSoft  = hslAdjust(accent,  0, isDark ? -0.20 : -0.10, isDark ? -0.35 :  0.40);
    const accentBorder= hslAdjust(accent,  0, -0.10, isDark ? -0.15 :  0.20);

    const bgBody       = bgC;
    const bgSurface    = isDark ? hslAdjust(bgBody, 0,  0,     0.06) : hslAdjust(bgBody, 0,  0,     0.03);
    const bgSurfaceAlt = isDark ? hslAdjust(bgBody, 0,  0,     0.12) : hslAdjust(bgBody, 0, -0.05, -0.06);
    const bgSurfaceSoft= bgBody;
    const bgHover      = isDark ? hslAdjust(bgBody, 0,  0,     0.18) : hslAdjust(bgBody, 0, -0.05, -0.12);
    const borderColor  = isDark ? hslAdjust(bgBody, 0,  0.05,  0.20) : hslAdjust(bgBody, 0,  0.05, -0.15);
    const borderSoft   = isDark ? hslAdjust(bgBody, 0,  0.05,  0.12) : hslAdjust(bgBody, 0,  0.05, -0.08);

    const textPrimary   = textC;
    const textSecondary = isDark ? hslAdjust(textC, 0, -0.10, -0.12) : hslAdjust(textC, 0, -0.05,  0.18);
    const textMuted     = isDark ? hslAdjust(textC, 0, -0.20, -0.25) : hslAdjust(textC, 0, -0.15,  0.35);
    const textInvert    = isDark ? bgBody : { r: 255, g: 255, b: 255 };

    const chartPassed    = accent;
    const chartRemaining = bgSurfaceAlt;
    const chartLabDone   = bySat[1] || accent;
    const chartLabLeft   = bySat[2] || accentBorder;

    const friendCommonBg   = bySat[1] || accent;
    const friendCommonText = { r: 255, g: 255, b: 255 };
    const friendWarningBg  = bySat[2] || accentHover;
    const friendWarningText= { r: 255, g: 255, b: 255 };
    const friendSameBg     = accentSoft;
    const friendSameText   = isDark ? textPrimary : accentBorder;
    const friendInfoBg     = accentSoft;
    const friendInfoText   = isDark ? textSecondary : accentHover;

    const statusGreen     = { r: 16,  g: 185, b: 129 };
    const statusOrange    = { r: 245, g: 158, b: 11  };
    const statusRed       = { r: 239, g: 68,  b: 68  };
    const statusCompleted = isDark ? { r: 100, g: 116, b: 139 } : { r: 148, g: 163, b: 184 };

    return {
        '--bg-body':           rgbToHex(bgBody),
        '--bg-surface':        rgbToHex(bgSurface),
        '--bg-surface-alt':    rgbToHex(bgSurfaceAlt),
        '--bg-surface-soft':   rgbToHex(bgSurfaceSoft),
        '--bg-hover':          rgbToHex(bgHover),
        '--border-color':      rgbToHex(borderColor),
        '--border-soft':       rgbToHex(borderSoft),
        '--text-primary':      rgbToHex(textPrimary),
        '--text-secondary':    rgbToHex(textSecondary),
        '--text-muted':        rgbToHex(textMuted),
        '--text-invert':       rgbToHex(textInvert),
        '--accent':            rgbToHex(accent),
        '--accent-hover':      rgbToHex(accentHover),
        '--accent-soft':       rgbToHex(accentSoft),
        '--accent-border':     rgbToHex(accentBorder),
        '--status-green':      rgbToHex(statusGreen),
        '--status-orange':     rgbToHex(statusOrange),
        '--status-red':        rgbToHex(statusRed),
        '--status-completed':  rgbToHex(statusCompleted),
        '--chart-passed':      rgbToHex(chartPassed),
        '--chart-remaining':   rgbToHex(chartRemaining),
        '--chart-lab-done':    rgbToHex(chartLabDone),
        '--chart-lab-left':    rgbToHex(chartLabLeft),
        '--friend-common-bg':  rgbToHex(friendCommonBg),
        '--friend-common-text':rgbToHex(friendCommonText),
        '--friend-warning-bg': rgbToHex(friendWarningBg),
        '--friend-warning-text':rgbToHex(friendWarningText),
        '--friend-same-bg':    rgbToHex(friendSameBg),
        '--friend-same-text':  rgbToHex(friendSameText),
        '--friend-info-bg':    rgbToHex(friendInfoBg),
        '--friend-info-text':  rgbToHex(friendInfoText),
    };
}

// ============================================================
//  ПРИМЕНЕНИЕ / СБРОС
// ============================================================

async function applyCustomTheme() {
    const token = ++_customThemeApplyToken;
    const data = loadCustomTheme();

    for (const key in data.colors) {
        document.documentElement.style.setProperty(key, data.colors[key]);
    }

    let resolvedPhotoUrl = '';
    if (data.photoId) {
        if (data.photoId.startsWith('url:')) {
            resolvedPhotoUrl = data.photoId.slice(4);
        } else if (data.photoId.startsWith('idb:')) {
            try {
                resolvedPhotoUrl = await idbGetPhoto(data.photoId.slice(4)) || '';
            } catch (e) { console.warn('[custom-theme] idb get failed', e); }
        }
    }

    if (token !== _customThemeApplyToken) return;

    _applyCustomBackground(data, resolvedPhotoUrl);

    if (typeof refreshChartsTheme === 'function') refreshChartsTheme();
}

function _applyCustomBackground(data, resolvedPhotoUrl) {
    const bgBody = data.colors['--bg-body'] || '#f8fafc';
    const layers = [], sizes = [], repeats = [], attaches = [];

    if (resolvedPhotoUrl) {
        const overlayAlpha = Math.max(0, Math.min(1, 1 - data.photoOpacity));
        layers.push(`linear-gradient(${hexToRgba(bgBody, overlayAlpha)}, ${hexToRgba(bgBody, overlayAlpha)})`);
        sizes.push('cover'); repeats.push('no-repeat'); attaches.push('fixed');
        layers.push(`url("${resolvedPhotoUrl}")`);
        sizes.push('cover'); repeats.push('no-repeat'); attaches.push('fixed');
    }

    const stickerUrl = data.stickers
        ? stickersToSvgDataUri(data.stickers, data.stickersOpacity)
        : null;
    if (stickerUrl) {
        layers.push(`url("${stickerUrl}")`);
        sizes.push('180px 180px'); repeats.push('repeat'); attaches.push('fixed');
    }

    document.body.style.backgroundImage = layers.length ? layers.join(', ') : '';
    document.body.style.backgroundSize = sizes.join(', ');
    document.body.style.backgroundRepeat = repeats.join(', ');
    document.body.style.backgroundAttachment = attaches.join(', ');
}

function clearCustomThemeInline() {
    _customThemeApplyToken++;
    const data = loadCustomTheme();
    for (const key in data.colors) {
        document.documentElement.style.removeProperty(key);
    }
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundRepeat = '';
    document.body.style.backgroundAttachment = '';
}

async function cleanupPhotoIfUnused(key) {
    if (!key) return;
    const usedKeys = new Set();
    const current = loadCustomTheme();
    if (current.photoId && current.photoId.startsWith('idb:')) {
        usedKeys.add(current.photoId.slice(4));
    }
    const presets = loadCustomThemePresets();
    presets.forEach(p => {
        if (p && p.data && p.data.photoId && p.data.photoId.startsWith('idb:')) {
            usedKeys.add(p.data.photoId.slice(4));
        }
    });
    if (usedKeys.has(key)) return;
    try { await idbDeletePhoto(key); console.log('[custom-theme] removed orphan photo', key); }
    catch (e) { console.warn('[custom-theme] orphan cleanup failed', e); }
}

function applyBaseThemeAsCustom(baseThemeId, baseThemeLabel) {
    if (!baseThemeId || baseThemeId === 'custom') return;

    const root = document.documentElement;
    const prevDataTheme = root.getAttribute('data-theme');
    const prevBsTheme   = root.getAttribute('data-bs-theme');

    const trackedVars = Object.keys(defaultCustomTheme().colors);
    const extraVars = [
        '--font-display',
        '--chart-tooltip-bg',
        '--chart-tooltip-text',
        '--friend-same-border',
        '--friend-info-border',
        '--event-color',
        '--custom-pair-color',
    ];
    const allVars = trackedVars.concat(extraVars);

    const savedInline = {};
    allVars.forEach(v => {
        const val = root.style.getPropertyValue(v);
        if (val) {
            savedInline[v] = val;
            root.style.removeProperty(v);
        }
    });

    root.setAttribute('data-theme', baseThemeId);
    root.setAttribute('data-bs-theme', baseThemeId === 'dark' ? 'dark' : 'light');

    const computed = getComputedStyle(root);
    const newColors = {};
    allVars.forEach(v => {
        const val = computed.getPropertyValue(v).trim();
        if (val) newColors[v] = val;
    });

    root.setAttribute('data-theme', prevDataTheme);
    root.setAttribute('data-bs-theme', prevBsTheme);
    for (const k in savedInline) {
        root.style.setProperty(k, savedInline[k]);
    }

    const data = loadCustomTheme();
    data.colors = Object.assign({}, data.colors, newColors);
    saveCustomTheme(data);

    if (typeof theme !== 'undefined' && theme !== 'custom') {
        theme = 'custom';
        localStorage.setItem('theme', 'custom');
        localStorage.removeItem('activeCustomPresetName');
        const select = document.getElementById('settingsTheme');
        if (select) select.value = 'custom';
        if (typeof applyTheme === 'function') applyTheme();
    } else {
        applyCustomTheme();
    }

    if (typeof renderCustomThemePanel === 'function') renderCustomThemePanel();
    if (typeof updateCurrentThemeLabel === 'function') updateCurrentThemeLabel();

    if (typeof showUpdateNotification === 'function') {
        showUpdateNotification(`🎨 Основа: ${baseThemeLabel || baseThemeId}`);
    }
}

function applyBaseThemeFromSelect() {
    const select = document.getElementById('customThemeBaseSelect');
    if (!select) return;

    const val = select.value;
    if (!val) {
        alert('Сначала выберите тему из списка');
        return;
    }

    const label = select.options[select.selectedIndex].text;

    if (!confirm(`Взять тему «${label}» за основу?\n\nТекущие цвета своей темы будут заменены. Фото, стикеры и сохранённые пресеты не пострадают.`)) {
        return;
    }

    applyBaseThemeAsCustom(val, label);
    select.value = '';
}

// ============================================================
//  СЕКЦИИ — СВОРАЧИВАНИЕ / РАЗВОРАЧИВАНИЕ
// ============================================================

function loadCustomSections() {
    try {
        const raw = localStorage.getItem(CUSTOM_THEME_SECTIONS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
}

function saveCustomSections(state) {
    try { localStorage.setItem(CUSTOM_THEME_SECTIONS_KEY, JSON.stringify(state)); } catch (e) {}
}

function toggleCustomSection(name) {
    const body  = document.getElementById('custom-section-' + name);
    const arrow = document.getElementById('arrow-' + name);
    if (!body) return;

    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.textContent = isHidden ? '▾' : '▸';

    const state = loadCustomSections();
    state[name] = isHidden ? 'open' : 'closed';
    saveCustomSections(state);
}

function restoreCustomSections() {
    const state = loadCustomSections();
    ['colors', 'bg', 'stickers'].forEach(name => {
        const body  = document.getElementById('custom-section-' + name);
        const arrow = document.getElementById('arrow-' + name);
        if (!body) return;
        const isOpen = state[name] === 'open';
        body.style.display = isOpen ? 'block' : 'none';
        if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
    });
}

// ============================================================
//  UI — ПАНЕЛЬ ЦВЕТОВ
// ============================================================

function renderCustomThemePanel() {
    const container = document.getElementById('customThemePickers');
    if (container) {
        const data = loadCustomTheme();
        let html = '';

        CUSTOM_THEME_FIELDS.forEach(group => {
            const isBasic = !!group.basic;
            if (!isBasic && !_customThemeAdvancedShown) return;

            html += `<div class="custom-picker-group">${group.group}</div>`;
            group.fields.forEach(f => {
                const val = data.colors[f.key] || '#000000';
                html += `
                    <div class="custom-picker-row">
                        <input type="color" value="${val}" data-key="${f.key}" oninput="onCustomColorChange(this)">
                        <label>${f.label}</label>
                    </div>`;
            });
        });

        container.innerHTML = html;
    }

    const toggleBtn = document.getElementById('customThemeAdvancedToggle');
    if (toggleBtn) {
        toggleBtn.textContent = _customThemeAdvancedShown
            ? '▲ Скрыть дополнительные цвета'
            : '▼ Показать все цвета';
    }

    const data = loadCustomTheme();

    const stickersInput = document.getElementById('customThemeStickers');
    if (stickersInput) stickersInput.value = data.stickers || '';

    const stOp = document.getElementById('customThemeStickersOpacity');
    const stOpVal = document.getElementById('customThemeStickersOpacityVal');
    if (stOp) {
        stOp.value = Math.round(data.stickersOpacity * 100);
        if (stOpVal) stOpVal.textContent = stOp.value;
    }

    const phOp = document.getElementById('customThemePhotoOpacity');
    const phOpVal = document.getElementById('customThemePhotoOpacityVal');
    if (phOp) {
        phOp.value = Math.round(data.photoOpacity * 100);
        if (phOpVal) phOpVal.textContent = phOp.value;
    }

    updatePhotoMetaText().catch(() => {});
    renderCustomThemePresets();
    restoreCustomSections();
}

function toggleCustomThemeAdvanced() {
    _customThemeAdvancedShown = !_customThemeAdvancedShown;
    localStorage.setItem(CUSTOM_THEME_ADVANCED_KEY, String(_customThemeAdvancedShown));
    renderCustomThemePanel();
}

function updateCustomThemePanelVisibility() {
    const panel = document.getElementById('customThemePanel');
    if (!panel) return;
    panel.style.display = (typeof theme !== 'undefined' && theme === 'custom') ? 'block' : 'none';
}

async function updatePhotoMetaText(precomputedBytes) {
    const el = document.getElementById('customThemePhotoMeta');
    if (!el) return;
    const data = loadCustomTheme();
    if (!data.photoId) { el.textContent = ''; return; }

    if (data.photoId.startsWith('url:')) {
        el.textContent = '🌐 Фото из старого пресета (по URL). Загрузите новое, чтобы заменить.';
        return;
    }
    if (data.photoId.startsWith('idb:')) {
        if (typeof precomputedBytes === 'number') {
            el.textContent = `💾 Загружено, ~${Math.round(precomputedBytes / 1024)} КБ`;
            return;
        }
        try {
            const info = await idbGetPhotoInfo(data.photoId.slice(4));
            if (info && typeof info.bytes === 'number') {
                el.textContent = `💾 Загружено, ~${Math.round(info.bytes * 0.75 / 1024)} КБ`;
            } else { el.textContent = '💾 Загружено'; }
        } catch (e) { el.textContent = '💾 Загружено'; }
    }
}

// ============================================================
//  UI — ВЗЯТЬ ЦВЕТА С ФОТО
// ============================================================

function promptExtractColorsFromPhoto() {
    const data = loadCustomTheme();
    if (!data.photoId) return;
    if (_lastPromptedPhotoId === data.photoId) return;
    _lastPromptedPhotoId = data.photoId;

    setTimeout(() => {
        const ok = confirm(
            '🎨 Подобрать цвета темы из этой фотографии?\n\n' +
            'Текущие цвета будут заменены автоматически подобранной палитрой. ' +
            'Фото, стикеры и их прозрачности сохранятся.'
        );
        if (ok) {
            applyThemeFromPhoto(true);
        }
    }, 350);
}

async function applyThemeFromPhoto(skipConfirm = false) {
    const data = loadCustomTheme();

    if (!data.photoId) {
        alert('Сначала загрузите фотографию в разделе «Фон».\n\nПосле загрузки вернитесь сюда и нажмите «Взять цвета с фото».');
        return;
    }

    let photoUrl = '';
    try {
        if (data.photoId.startsWith('url:')) {
            photoUrl = data.photoId.slice(4);
        } else if (data.photoId.startsWith('idb:')) {
            photoUrl = await idbGetPhoto(data.photoId.slice(4)) || '';
        }
    } catch (e) {
        console.error('[custom-theme] get photo for extraction failed', e);
    }

    if (!photoUrl) {
        alert('Не удалось прочитать фотографию.');
        return;
    }

    try {
        const palette = await extractPaletteFromImage(photoUrl);
        if (!palette || palette.length === 0) {
            alert('Не удалось извлечь цвета из фотографии.');
            return;
        }

        const newColors = buildThemeFromPalette(palette);
        if (!newColors) {
            alert('Не удалось построить палитру.');
            return;
        }

        if (!skipConfirm) {
            if (!confirm('Применить цвета с фотографии?\n\nТекущие цвета будут заменены. Фото, стикеры и их прозрачности сохранятся.')) {
                return;
            }
        }

        data.colors = Object.assign({}, data.colors, newColors);
        saveCustomTheme(data);
        await applyCustomTheme();
        renderCustomThemePanel();

        if (typeof showUpdateNotification === 'function') {
            showUpdateNotification('🎨 Цвета взяты с фотографии');
        }
    } catch (e) {
        console.error('[custom-theme] palette extraction failed', e);
        alert('Ошибка при извлечении цветов:\n\n' + (e && e.message ? e.message : 'неизвестная ошибка'));
    }
}

// ============================================================
//  UI — ПРЕСЕТЫ
// ============================================================

function renderCustomThemePresets() {
    const container = document.getElementById('customThemePresets');
    if (!container) return;
    const presets = loadCustomThemePresets();

    if (presets.length === 0) {
        container.innerHTML = '<div class="small text-muted py-1">Сохранённых тем пока нет</div>';
        return;
    }

    let html = '';
    presets.forEach((p, i) => {
        const safeName = String(p.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const hasPhoto = !!(p.data && p.data.photoId);
        const badge = hasPhoto ? ' 📷' : '';
        html += `
            <div class="custom-preset-row">
                <span class="custom-preset-name" title="${safeName}">${safeName}${badge}</span>
                <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" onclick="loadPreset(${i})" title="Загрузить">↺</button>
                <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="deletePreset(${i})" title="Удалить">✕</button>
            </div>`;
    });
    container.innerHTML = html;

    if (typeof renderQuickPresets === 'function') renderQuickPresets();
}

function saveCurrentAsPreset() {
    const nameInput = document.getElementById('customThemePresetName');
    const name = (nameInput.value || '').trim();
    if (!name) { alert('Введите название темы'); nameInput.focus(); return; }
    if (name.length > 40) { alert('Слишком длинное название (макс. 40 символов)'); return; }

    const presets = loadCustomThemePresets();
    const current = loadCustomTheme();

    const idx = presets.findIndex(p => p.name === name);
    if (idx >= 0) {
        if (!confirm(`Тема «${name}» уже существует. Перезаписать?`)) return;
        presets[idx].data = JSON.parse(JSON.stringify(current));
    } else {
        presets.push({ name, data: JSON.parse(JSON.stringify(current)) });
    }

    const result = saveCustomThemePresets(presets);
    if (!result.ok) {
        alert('Не удалось сохранить: ' + (result.error && result.error.message ? result.error.message : 'неизвестная ошибка'));
        return;
    }
    if (result.dropped > 0) {
        alert(`Чтобы уместить новую тему, автоматически удалено старых: ${result.dropped}.`);
    }

    nameInput.value = '';
    localStorage.setItem('activeCustomPresetName', name);
    renderCustomThemePresets();
    if (typeof updateCurrentThemeLabel === 'function') updateCurrentThemeLabel();
}

function loadPreset(index) {
    const presets = loadCustomThemePresets();
    const preset = presets[index];
    if (!preset) return;

    // Запоминаем имя активного пресета
    localStorage.setItem('activeCustomPresetName', preset.name);

    const data = JSON.parse(JSON.stringify(preset.data || {}));
    saveCustomTheme(data);

    if (typeof theme !== 'undefined' && theme !== 'custom') {
        theme = 'custom';
        localStorage.setItem('theme', 'custom');
        const select = document.getElementById('settingsTheme');
        if (select) select.value = 'custom';
        if (typeof applyTheme === 'function') applyTheme();
    } else {
        applyCustomTheme();
    }

    renderCustomThemePanel();
    if (typeof updateCurrentThemeLabel === 'function') updateCurrentThemeLabel();
}

function deletePreset(index) {
    const presets = loadCustomThemePresets();
    const preset = presets[index];
    if (!preset) return;
    if (!confirm(`Удалить сохранённую тему «${preset.name}»?`)) return;

    const photoId = preset.data && preset.data.photoId;
    
    // Если удаляем активный пресет, сбрасываем его имя
    if (localStorage.getItem('activeCustomPresetName') === preset.name) {
        localStorage.removeItem('activeCustomPresetName');
    }

    presets.splice(index, 1);
    saveCustomThemePresets(presets);

    if (photoId && photoId.startsWith('idb:')) {
        cleanupPhotoIfUnused(photoId.slice(4)).catch(() => {});
    }
    renderCustomThemePresets();
    if (typeof updateCurrentThemeLabel === 'function') updateCurrentThemeLabel();
}

// ============================================================
//  UI — ОБРАБОТЧИКИ
// ============================================================

function onCustomColorChange(input) {
    const data = loadCustomTheme();
    data.colors[input.dataset.key] = input.value;
    saveCustomTheme(data);
    applyCustomTheme();
}

function onCustomStickersChange(input) {
    const data = loadCustomTheme();
    data.stickers = input.value;
    saveCustomTheme(data);
    applyCustomTheme();
}

async function onCustomPhotoUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    if (file.size > PHOTO_MAX_INPUT_BYTES) {
        alert(`Файл слишком большой (${Math.round(file.size / 1024 / 1024)} МБ). Максимум — 10 МБ.`);
        input.value = '';
        return;
    }

    if (!(await idbIsAvailable())) {
        alert('Хранилище IndexedDB недоступно в этом браузере (возможно, режим инкогнито).\n\nСвоя тема с фото не сможет сохраниться.');
        input.value = '';
        return;
    }

    try {
        const dataUrl = await compressImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY);
        const bytes = dataUrlByteSize(dataUrl);

        const key = genPhotoKey();
        await idbPutPhoto(key, dataUrl);

        const data = loadCustomTheme();
        const oldId = data.photoId;
        data.photoId = 'idb:' + key;
        saveCustomTheme(data);

        if (oldId && oldId.startsWith('idb:')) cleanupPhotoIfUnused(oldId.slice(4)).catch(() => {});

        await applyCustomTheme();
        updatePhotoMetaText(bytes).catch(() => {});

        promptExtractColorsFromPhoto();

    } catch (e) {
        console.error('[custom-theme] photo upload failed', e);
        alert('Не удалось обработать фото: ' + (e && e.message ? e.message : 'неизвестная ошибка'));
    } finally {
        input.value = '';
    }
}

function clearCustomPhoto() {
    const data = loadCustomTheme();
    const oldId = data.photoId;
    data.photoId = null;
    saveCustomTheme(data);

    const fileInput = document.getElementById('customThemePhotoFile');
    if (fileInput) fileInput.value = '';

    _lastPromptedPhotoId = null;

    applyCustomTheme();

    if (oldId && oldId.startsWith('idb:')) cleanupPhotoIfUnused(oldId.slice(4)).catch(() => {});
    updatePhotoMetaText().catch(() => {});
}

function onCustomOpacityChange(input, which) {
    const v = Math.max(0, Math.min(100, parseInt(input.value, 10) || 0)) / 100;
    const data = loadCustomTheme();
    if (which === 'stickers') {
        data.stickersOpacity = v;
        const label = document.getElementById('customThemeStickersOpacityVal');
        if (label) label.textContent = input.value;
    } else {
        data.photoOpacity = v;
        const label = document.getElementById('customThemePhotoOpacityVal');
        if (label) label.textContent = input.value;
    }
    saveCustomTheme(data);
    applyCustomTheme();
}

function resetCustomTheme() {
    if (!confirm('Сбросить текущую свою тему к светлым цветам?\n\nСохранённые пресеты не пострадают.')) return;
    const oldId = loadCustomTheme().photoId;
    saveCustomTheme(defaultCustomTheme());
    _lastPromptedPhotoId = null;
    renderCustomThemePanel();
    applyCustomTheme();
    if (oldId && oldId.startsWith('idb:')) cleanupPhotoIfUnused(oldId.slice(4)).catch(() => {});
}