/* Виджет погоды: Севастополь, rp5.ru. Вертикально — 1 день, горизонтально — 3 дня. */

let weatherData = null;
let weatherStale = false;
let weatherLoading = false;
let weatherError = '';
let weatherDayOffset = 0;
let weatherRequestSeq = 0;
let _weatherObserver = null;

const _WEATHER_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const WEATHER_CITY_KEY = 'weatherCity';
const WEATHER_CITY_PRESETS = [
    { name: 'Севастополь', url: '' }
];
// Города, которые раньше были в списке пресетов. Если у пользователя
// сохранился такой пресет, возвращаем Севастополь: произвольный город
// теперь задаётся только ссылкой rp5.ru.
const _LEGACY_PRESET_CITIES = new Set([
    'Симферополь', 'Ялта', 'Керчь', 'Евпатория', 'Москва',
    'Санкт-Петербург', 'Краснодар', 'Сочи', 'Ростов-на-Дону'
]);

function getWeatherCity() {
    try {
        const raw = JSON.parse(localStorage.getItem(WEATHER_CITY_KEY) || '{}');
        if (raw && typeof raw.name === 'string' && raw.name.trim()) {
            const name = raw.name.trim().slice(0, 80);
            const url = typeof raw.url === 'string' ? raw.url : '';
            if (url && _LEGACY_PRESET_CITIES.has(name)) {
                // Старый пресет из списка, которого больше нет в UI.
                return { name: 'Севастополь', url: '' };
            }
            return { name, url };
        }
    } catch (e) { /* ignore */ }
    return { name: 'Севастополь', url: '' };
}

function saveWeatherCity(name, url) {
    const city = { name: String(name || 'Севастополь').trim().slice(0, 80), url: String(url || '') };
    try { localStorage.setItem(WEATHER_CITY_KEY, JSON.stringify(city)); } catch (e) { /* ignore */ }
    _setWeatherCityLabel(city.name);
    return city;
}

function _setWeatherCityLabel(name) {
    const value = name || 'Севастополь';
    const el = document.getElementById('weatherCityLabel');
    if (el) el.textContent = value;
    const settingsEl = document.getElementById('settingsWeatherCityValue');
    if (settingsEl) settingsEl.textContent = value;
}

function _cityNameFromRp5Url(url) {
    try {
        const parts = String(url).split('?')[0].split('/').filter(Boolean);
        let tail = decodeURIComponent(parts[parts.length - 1] || '');
        if (tail.includes(',')) tail = tail.split(',').pop();
        tail = tail.replace(/^Погода_в_/, '').replace(/_/g, ' ').trim();
        return tail.slice(0, 80) || 'Город';
    } catch (e) {
        return 'Город';
    }
}

function _weatherCityQuery(force) {
    const city = getWeatherCity();
    const params = new URLSearchParams();
    if (city.url) params.set('city_url', city.url);
    params.set('city_name', city.name);
    if (force) params.set('force', '1');
    return '/api/weather?' + params.toString();
}

function _renderWeatherCityPresets() {
    const box = document.getElementById('weatherCityPresets');
    if (!box) return;
    const current = getWeatherCity();
    box.textContent = '';
    WEATHER_CITY_PRESETS.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'weather-city-option' + (item.name === current.name ? ' active' : '');
        btn.textContent = item.name;
        btn.addEventListener('click', () => selectWeatherCity(item.name, item.url));
        box.appendChild(btn);
    });
}

function openWeatherCityPicker() {
    _renderWeatherCityPresets();
    const input = document.getElementById('weatherCityUrl');
    if (input) input.value = getWeatherCity().url || '';
    const modalEl = document.getElementById('weatherCityModal');
    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function openWeatherCitySettings() {
    const modalEl = document.getElementById('settingsModal');
    if (!modalEl) return;

    const reveal = () => {
        const row = document.getElementById('weatherCitySettingsRow');
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('settings-highlight');
            setTimeout(() => row.classList.remove('settings-highlight'), 1600);
        }
        const value = document.getElementById('settingsWeatherCityValue');
        if (value) {
            const btn = value.closest('button');
            if (btn) btn.focus();
        }
    };

    if (modalEl.classList.contains('show')) {
        reveal();
        return;
    }
    if (typeof bootstrap !== 'undefined') {
        modalEl.addEventListener('shown.bs.modal', reveal, { once: true });
    }
    if (typeof openSettingsModal === 'function') {
        openSettingsModal();
    } else if (typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

function openWeatherCityPickerFromSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal || typeof bootstrap === 'undefined') {
        openWeatherCityPicker();
        return;
    }
    settingsModal.addEventListener('hidden.bs.modal', openWeatherCityPicker, { once: true });
    bootstrap.Modal.getOrCreateInstance(settingsModal).hide();
}

function _closeWeatherCityModal() {
    const modalEl = document.getElementById('weatherCityModal');
    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
}

function selectWeatherCity(name, url) {
    saveWeatherCity(name, url);
    _closeWeatherCityModal();
    weatherData = null;
    weatherStale = false;
    weatherError = '';
    weatherDayOffset = 0;
    loadWeather(true);
}

function applyCustomWeatherCity() {
    const input = document.getElementById('weatherCityUrl');
    const raw = (input && input.value || '').trim();
    if (!raw) {
        alert('Вставьте ссылку на страницу города с rp5.ru');
        return;
    }
    let parsed;
    try { parsed = new URL(raw); } catch (e) { parsed = null; }
    if (!parsed || !/^https?:$/.test(parsed.protocol) || !/^(www\.)?rp5\.ru$/i.test(parsed.hostname)) {
        alert('Нужна ссылка вида https://rp5.ru/Погода_в_…');
        return;
    }
    selectWeatherCity(_cityNameFromRp5Url(raw), parsed.href);
}

function _weatherIsWide() {
    const card = document.getElementById('widgetWeatherCard');
    if (!card) return false;
    return !!card.closest('#underCalendarWidgetsZone, #mainColumnSections');
}

function _weatherDayLabel(iso, index) {
    if (index === 0) return 'Сегодня';
    if (index === 1) return 'Завтра';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
}

function _weatherDateLabel(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.getDate() + ' ' + _WEATHER_MONTHS[d.getMonth()];
}

function _weatherUpdatedLabel() {
    if (!weatherData || !weatherData.updated) return '';
    const d = new Date(weatherData.updated * 1000);
    const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return 'обновлено ' + hm + (weatherStale ? ' · сохранённые данные' : '');
}

function _weatherTempBand(temp) {
    if (temp <= -25) return 'arctic';
    if (temp <= -15) return 'frost';
    if (temp <= -5) return 'cold';
    if (temp <= 4) return 'chilly';
    if (temp <= 12) return 'mild';
    if (temp <= 17) return 'warm';
    if (temp <= 21) return 'summer';
    if (temp <= 25) return 'hot';
    if (temp <= 29) return 'veryhot';
    return 'hell';
}

function _weatherWindLabel(day, band) {
    const w = Number(day && day.wind_max);
    const speed = Number.isFinite(w) ? w : 0;
    if (band === 'cold' && speed >= 8) return 'Пронизывающий';
    if (band === 'warm' && speed >= 2 && speed <= 4) return 'Сквозняк';
    if (band === 'hell' && speed >= 5 && speed <= 7) return 'Суховей';
    if (speed <= 1) return 'Штиль';
    if (speed <= 4) return (band === 'summer' || band === 'hot' || band === 'veryhot') ? 'Легкий бриз' : 'Слабый';
    if (speed <= 7) return 'Умеренный';
    if (speed <= 10) return 'Порывистый';
    return 'Шквальный';
}

function _weatherPrecipKind(condition) {
    const c = String(condition || '').toLowerCase();
    if (c.includes('тропическ')) return 'tropical';
    if (c.includes('духот') || c.includes('пекло') || c.includes('гроза')) return 'heat';
    if (c.includes('ливень')) return 'shower';
    if (c.includes('морос')) return 'drizzle';
    if (c.includes('грибн')) return 'mushroom';
    if (c.includes('ледян')) return 'ice_rain';
    if (c.includes('дождь') && c.includes('снег')) return 'rain_snow';
    if (c.includes('мокрый снег')) return 'wet_snow';
    if (c.includes('сухой снег')) return 'dry_snow';
    if (c.includes('метель')) return 'blizzard';
    if (c.includes('снегопад')) return 'snowfall';
    if (c.includes('изморозь')) return 'frost_clear';
    if (c.includes('снег')) return 'snowfall';
    if (c.includes('дождь')) return 'rain';
    if (c.includes('ясно') || c.includes('солнеч') || c.includes('без осадков') || c.includes('проясн')) return 'clear';
    if (c.includes('облач') || c.includes('пасмур')) return 'cloudy';
    return 'other';
}

function _weatherVerdict(day) {
    if (!day) return '';
    const temp = Number(day.temp_max) || 0;
    const band = _weatherTempBand(temp);
    const wind = _weatherWindLabel(day, band);
    const precip = _weatherPrecipKind(day.condition);
    const cold = temp <= 4;
    const hot = temp >= 26;
    const windy = wind === 'Пронизывающий' || wind === 'Порывистый' || wind === 'Шквальный';
    const rainy = ['rain', 'shower', 'drizzle', 'mushroom', 'tropical', 'ice_rain', 'rain_snow', 'wet_snow'].includes(precip);
    const snowy = ['snowfall', 'blizzard', 'dry_snow'].includes(precip);
    const cloudy = precip === 'cloudy' || precip === 'other';

    let reason;
    if (cold) reason = 'Слишком холодно';
    else if (hot) reason = 'Слишком жарко';
    else if (rainy) reason = 'Слишком дождливо';
    else if (snowy) reason = 'Слишком снежно';
    else if (windy) reason = 'Слишком ветрено';
    else if (cloudy) reason = 'Слишком пасмурно';
    else if (band === 'mild') reason = 'Слишком прохладно';
    else reason = 'Слишком хорошая погода';

    return reason + ', чтоб идти на пары';
}

function renderWeatherWidget() {
    const body = document.getElementById('weatherBody');
    const card = document.getElementById('widgetWeatherCard');
    if (!body || !card) return;

    if (weatherLoading && !weatherData) {
        body.innerHTML = '<div class="weather-loading">Загрузка прогноза…</div>';
        return;
    }
    if (weatherError && (!weatherData || !Array.isArray(weatherData.days) || !weatherData.days.length)) {
        body.innerHTML =
            '<div class="weather-error">' +
            '<div>Не удалось загрузить погоду</div>' +
            '<button class="weather-retry" onclick="refreshWeather()">Повторить</button>' +
            '</div>';
        return;
    }
    if (!weatherData || !Array.isArray(weatherData.days) || !weatherData.days.length) {
        body.innerHTML = '<div class="weather-loading">Нет данных о погоде</div>';
        return;
    }

    const wide = _weatherIsWide();
    const allDays = weatherData.days;
    const maxStart = Math.max(0, wide ? allDays.length - 3 : allDays.length - 1);
    if (weatherDayOffset > maxStart) weatherDayOffset = maxStart;
    if (weatherDayOffset < 0) weatherDayOffset = 0;

    const days = wide
        ? allDays.slice(weatherDayOffset, weatherDayOffset + 3)
        : [allDays[weatherDayOffset]];
    const startIndex = weatherDayOffset;
    const navLabel = wide
        ? _weatherDateLabel(days[0].date) + ' — ' + _weatherDateLabel(days[days.length - 1].date)
        : _weatherDayLabel(days[0].date, startIndex) + ', ' + _weatherDateLabel(days[0].date);

    let html = '<div class="weather-nav">' +
        '<button class="weather-nav-btn" onclick="weatherShiftDay(-1)" title="Предыдущий день"' +
        (weatherDayOffset <= 0 ? ' disabled' : '') + '>‹</button>' +
        '<button class="weather-nav-label" onclick="weatherToday()" title="Вернуться к сегодняшнему дню">' +
        escapeHtml(navLabel) + '</button>' +
        '<button class="weather-nav-btn" onclick="weatherShiftDay(1)" title="Следующий день"' +
        (weatherDayOffset >= maxStart ? ' disabled' : '') + '>›</button>' +
        (weatherStale ? '<span class="weather-offline" title="Нет связи с rp5.ru — показан сохранённый прогноз">офлайн</span>' : '') +
        '</div>';

    if (wide) {
        html += '<div class="weather-forecast">';
        days.forEach((day, i) => {
            const dayIndex = startIndex + i;
            html +=
                '<div class="weather-day' + (dayIndex === 0 ? ' weather-day-today' : '') + '">' +
                '<div class="weather-day-name">' + escapeHtml(_weatherDayLabel(day.date, dayIndex)) + '</div>' +
                '<div class="weather-day-date">' + escapeHtml(_weatherDateLabel(day.date)) + '</div>' +
                '<div class="weather-day-icon">' + escapeHtml(day.icon || '🌡️') + '</div>' +
                '<div class="weather-day-temp">' + (day.temp_max >= 0 ? '+' : '') + day.temp_max + '°' +
                '<span class="weather-day-min">' + (day.temp_min >= 0 ? '+' : '') + day.temp_min + '°</span></div>' +
                '<div class="weather-day-cond">' + escapeHtml(day.condition || '') + '</div>' +
                '<div class="weather-day-verdict">' + escapeHtml(_weatherVerdict(day)) + '</div>' +
                '</div>';
        });
        html += '</div>';
    } else {
        const day = days[0];
        const tmax = (day.temp_max >= 0 ? '+' : '') + day.temp_max;
        const tmin = (day.temp_min >= 0 ? '+' : '') + day.temp_min;
        html +=
            '<div class="weather-now">' +
            '<div class="weather-now-icon">' + escapeHtml(day.icon || '🌡️') + '</div>' +
            '<div class="weather-now-main">' +
            '<div class="weather-now-temp">' + tmax + '°</div>' +
            '<div class="weather-now-cond">' + escapeHtml(day.condition || '') + '</div>' +
            '<div class="weather-now-date">' + escapeHtml(_weatherDayLabel(day.date, startIndex)) + ', ' + escapeHtml(_weatherDateLabel(day.date)) + '</div>' +
            '<div class="weather-verdict">' + escapeHtml(_weatherVerdict(day)) + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="weather-meta">' +
            '<span title="Минимум за день">мин ' + tmin + '°</span>' +
            (day.wind_max != null ? '<span title="Ветер">💨 ' + day.wind_max + ' м/с</span>' : '') +
            (day.pressure != null ? '<span title="Давление">' + day.pressure + ' мм</span>' : '') +
            '</div>';
    }

    html += '<div class="weather-foot">' + escapeHtml(_weatherUpdatedLabel()) + '</div>';
    body.innerHTML = html;
}

function weatherShiftDay(delta) {
    if (!weatherData || !Array.isArray(weatherData.days)) return;
    weatherDayOffset += delta;
    renderWeatherWidget();
}

function weatherToday() {
    weatherDayOffset = 0;
    renderWeatherWidget();
}

async function loadWeather(force) {
    const seq = ++weatherRequestSeq;
    weatherLoading = true;
    weatherError = '';
    renderWeatherWidget();
    try {
        const resp = await apiGet(_weatherCityQuery(force));
        if (seq !== weatherRequestSeq) return;
        if (!resp || !Array.isArray(resp.days)) throw new Error('bad weather payload');
        weatherData = (resp.days && resp.days.length) ? resp : null;
        weatherStale = !!resp.stale;
        if (resp.city) _setWeatherCityLabel(resp.city);
    } catch (e) {
        if (seq !== weatherRequestSeq) return;
        weatherError = String(e && e.message ? e.message : e);
        if (weatherData) weatherStale = true;
        console.warn('[weather]', e);
    } finally {
        if (seq === weatherRequestSeq) {
            weatherLoading = false;
            renderWeatherWidget();
        }
    }
}

function refreshWeather() {
    loadWeather(true);
}

function initWeatherWidget() {
    const card = document.getElementById('widgetWeatherCard');
    if (!card) return;

    _setWeatherCityLabel(getWeatherCity().name);

    if (typeof ResizeObserver !== 'undefined' && !_weatherObserver) {
        _weatherObserver = new ResizeObserver(() => renderWeatherWidget());
        _weatherObserver.observe(card);
    }

    // Сначала мгновенно показываем сохранённый прогноз, затем в фоне
    // обновляем его с rp5.ru — при каждом входе в приложение.
    loadWeather(false).then(() => {
        if (!weatherError) loadWeather(true);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('widgetWeatherCard')) initWeatherWidget();
});
