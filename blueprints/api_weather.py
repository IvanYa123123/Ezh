"""Погода с rp5.ru (HTML-таблица прогноза на 7 суток).

По умолчанию — Севастополь. Пользователь может выбрать другой город:
готовый список в интерфейсе или ссылка на страницу города с rp5.ru.
"""
import hashlib
import json
import os
import re
import time
from datetime import date, timedelta
from urllib.parse import unquote, urlsplit, urlunsplit

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from flask import Blueprint, jsonify, request
from lxml import html as lxml_html

from . import runtime
from .extensions import limiter

bp = Blueprint('weather', __name__)

DEFAULT_CITY = "Севастополь"
WEATHER_URL = "https://rp5.ru/Погода_в_Севастополе,_Севастополь"
CACHE_DIR = os.path.join(runtime.DATA_DIR, "weather")
CACHE_FILE = os.path.join(runtime.DATA_DIR, "weather_cache.json")  # старый кэш Севастополя
CACHE_TTL = 30 * 60  # 30 минут
MAX_CITY_NAME = 80

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ezh/3.7",
    "Accept-Language": "ru-RU,ru;q=0.9",
}

_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

_PRECIP_CLASSES = ("rain-snow", "snow", "hf-rain", "rain", "drizzle")


def _city_url(raw):
    """Разрешает только страницы rp5.ru — без SSRF на произвольные хосты."""
    raw = (raw or "").strip()
    if not raw:
        return WEATHER_URL
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        raise ValueError("city_url must be http(s)")
    if (parts.hostname or "").lower() not in ("rp5.ru", "www.rp5.ru"):
        raise ValueError("city_url must point to rp5.ru")
    if not parts.path or parts.path == "/":
        raise ValueError("city_url has no city path")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _city_name_from_url(url):
    path = unquote(urlsplit(url).path)
    tail = path.rsplit("/", 1)[-1]
    if "," in tail:
        tail = tail.rsplit(",", 1)[-1]
    tail = tail.replace("Погода_в_", "").replace("_", " ").strip()
    return tail[:MAX_CITY_NAME] or DEFAULT_CITY


def _cache_path(url):
    if url == WEATHER_URL:
        return CACHE_FILE
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return os.path.join(CACHE_DIR, f"weather_{digest}.json")


def _text(el):
    return " ".join("".join(el.itertext()).split())


def _int(value):
    if value is None:
        return None
    s = str(value).replace("\u2212", "-").replace("+", "").strip()
    m = re.search(r"-?\d+", s)
    return int(m.group(0)) if m else None


def _tooltip(el):
    for node in [el] + el.xpath(".//*[@onmouseover]"):
        raw = node.get("onmouseover") or ""
        m = re.search(r"tooltip\(this,\s*'([^']*)'", raw)
        if m:
            return m.group(1)
        title = node.get("title")
        if title:
            return title
    return el.get("title") or ""


def _clean_condition(text):
    text = re.sub(r"<[^>]+>", "", text or "")
    text = text.replace("Cлаб", "Слаб").strip()
    text = re.split(r"\s*\(", text, maxsplit=1)[0].strip()
    return text


def _icon_for(condition, cloud_text):
    c = (condition or "").lower()
    if "гроза" in c:
        return "⛈️"
    if "снег" in c and "дожд" in c:
        return "🌨️"
    if "снег" in c:
        return "❄️"
    if "дожд" in c or "морос" in c:
        return "🌧️" if "слаб" not in c else "🌦️"
    t = (cloud_text or "").lower()
    if "ясно" in t:
        return "☀️"
    if "малооблач" in t or "небольшая" in t:
        return "🌤️"
    if "проясн" in t or "переменн" in t:
        return "⛅"
    if "пасмур" in t or "значительн" in t or "облач" in t:
        return "☁️"
    return "🌡️"


def _cloud_rank(text):
    t = (text or "").lower()
    if "пасмур" in t:
        return 5
    if "значительн" in t:
        return 4
    if "облачно с проясн" in t:
        return 3
    if "переменн" in t:
        return 3
    if "небольш" in t or "малооблач" in t:
        return 2
    if "ясно" in t:
        return 1
    return 0


def _fetch_html(url):
    # rp5.ru отдаёт цепочку сертификатов, которой нет в certifi: с проверкой
    # TLS запрос висит до таймаута. Данные публичные и read-only, поэтому
    # проверку отключаем, иначе прогноз не обновляется.
    resp = requests.get(url, headers=_HEADERS, timeout=20, verify=False)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text


def _parse_page(text):
    doc = lxml_html.fromstring(text)
    table = doc.get_element_by_id("forecastTable")
    rows = table.xpath("./tr|./tbody/tr")
    if len(rows) < 8:
        raise ValueError("rp5: неожиданная структура таблицы")

    # Строка дат: каждый td — день, colspan — число слотов этого дня.
    labels = []
    for td in rows[0].xpath("./td"):
        label = _text(td)
        span = int(td.get("colspan") or 1)
        labels.extend([label] * span)

    today = date.today()
    label_date = {}
    day_index = 0
    for label in labels:
        if not label or label in label_date:
            continue
        label_date[label] = today + timedelta(days=day_index)
        day_index += 1

    times = [_text(td) for td in rows[1].xpath("./td")[1:]]
    days = {}
    for offset, tm in enumerate(times, start=1):
        if not re.fullmatch(r"\d{1,2}:\d{2}|\d{1,2}", tm):
            continue
        label = labels[offset] if offset < len(labels) else ""
        slot_date = label_date.get(label, today)

        def cell(row_index):
            cells = rows[row_index].xpath("./td")
            return cells[offset] if offset < len(cells) else None

        temp_cell = cell(4)
        if temp_cell is None:
            continue
        temp_el = temp_cell.xpath('.//div[contains(@class,"t_0")]')
        temp = _int(_text(temp_el[0])) if temp_el else None
        if temp is None:
            continue

        feels_cell = cell(5)
        feels_el = feels_cell.xpath('.//div[contains(@class,"t_0")]') if feels_cell is not None else []
        feels = _int(_text(feels_el[0])) if feels_el else temp

        cloud_cell = cell(2)
        cloud_text = ""
        cloud_rank = 0
        if cloud_cell is not None:
            cloud_text = _clean_condition(_tooltip(cloud_cell))
            cloud_rank = _cloud_rank(cloud_text)
            if cloud_rank == 0:
                # fallback: класс cn7/cd7 — чем больше цифра, тем пасмурнее
                for d in cloud_cell.xpath(".//div"):
                    cls = d.get("class") or ""
                    m = re.fullmatch(r"c[dn](\d+)", cls)
                    if m:
                        cloud_rank = int(m.group(1))
                        break

        prec_cell = cell(3)
        prec_text = ""
        prec_rank = 0
        if prec_cell is not None:
            prec_text = _clean_condition(_tooltip(prec_cell))
            classes = " ".join(
                d.get("class") or "" for d in prec_cell.xpath(".//div")
            ).lower()
            for idx, token in enumerate(_PRECIP_CLASSES):
                if token in classes:
                    prec_rank = len(_PRECIP_CLASSES) - idx
                    break

        wind = None
        wind_cell = cell(7)
        if wind_cell is not None:
            wind_el = wind_cell.xpath('.//div[contains(@class,"wv_0")]')
            wind = _int(_text(wind_el[0])) if wind_el else None

        press = None
        press_cell = cell(6)
        if press_cell is not None:
            press = _int(_text(press_cell))

        day = days.setdefault(slot_date.isoformat(), {
            "date": slot_date.isoformat(),
            "weekday": _WEEKDAYS[slot_date.weekday()],
            "temps": [],
            "feels": [],
            "conds": [],
            "winds": [],
            "press": [],
        })
        day["temps"].append(temp)
        day["feels"].append(feels if feels is not None else temp)
        if wind is not None:
            day["winds"].append(wind)
        if press is not None:
            day["press"].append(press)
        if prec_rank or cloud_rank:
            day["conds"].append((prec_rank, cloud_rank, prec_text, cloud_text))

    if not days:
        raise ValueError("rp5: прогноз не найден")

    result = []
    for iso, day in days.items():
        best = max(day["conds"], key=lambda c: (c[0], c[1])) if day["conds"] else (0, 0, "", "")
        prec_rank, cloud_rank, prec_text, cloud_text = best
        condition = prec_text or cloud_text or "Без осадков"
        temps = [t for t in day["temps"] if t is not None]
        feels = [t for t in day["feels"] if t is not None]
        result.append({
            "date": iso,
            "weekday": day["weekday"],
            "temp_min": min(temps),
            "temp_max": max(temps),
            "feels_min": min(feels),
            "feels_max": max(feels),
            "condition": condition,
            "icon": _icon_for(condition, cloud_text),
            "wind_max": max(day["winds"]) if day["winds"] else None,
            "pressure": round(sum(day["press"]) / len(day["press"])) if day["press"] else None,
        })

    result.sort(key=lambda d: d["date"])
    return result[:7]


def _read_cache(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        if isinstance(payload, dict) and isinstance(payload.get("days"), list):
            return payload
    except (OSError, ValueError):
        pass
    return None


def _write_cache(path, payload):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


@bp.route("/api/weather")
@limiter.limit("60 per minute")
def get_weather():
    try:
        url = _city_url(request.args.get("city_url"))
    except ValueError as exc:
        return jsonify({"error": "bad city", "details": str(exc)}), 400
    city = (request.args.get("city_name") or "").strip()[:MAX_CITY_NAME] or _city_name_from_url(url)
    path = _cache_path(url)

    force = request.args.get("force") == "1"
    cached = _read_cache(path)
    age = time.time() - float((cached or {}).get("updated") or 0)

    if not force and cached:
        return jsonify({**cached, "stale": age >= CACHE_TTL})
    if not force:
        # Кэша нет: не держим первый экран на сетевом запросе.
        # Виджет сразу попросит force=1 и покажет загрузку.
        return jsonify({"city": city, "url": url, "updated": 0,
                        "days": [], "stale": True, "empty": True})

    try:
        days = _parse_page(_fetch_html(url))
        payload = {
            "city": city,
            "source": "rp5.ru",
            "url": url,
            "updated": int(time.time()),
            "days": days,
        }
        _write_cache(path, payload)
        return jsonify({**payload, "stale": False})
    except Exception as exc:  # noqa: BLE001 - сеть/парсинг, отдаём кэш
        if cached:
            return jsonify({**cached, "stale": True})
        return jsonify({"error": "weather unavailable", "details": str(exc)[:200]}), 502
