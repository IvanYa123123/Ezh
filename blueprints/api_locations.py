"""Расписание аудиторий СевГУ: список комнат и занятия на неделю."""

import json
import os
import re
import tempfile
import time
from datetime import date, timedelta

import requests
from flask import Blueprint, jsonify, request
from lxml import html as lxml_html

from . import runtime
from .extensions import limiter

bp = Blueprint('locations', __name__)

LOCATIONS_URL = "https://schedule.sevsu.ru/locations"
API_URL = "https://schedule.sevsu.ru/api/location-schedule"

DATA_DIR = runtime.DATA_DIR
LOCATIONS_CACHE_FILE = os.path.join(DATA_DIR, "locations_cache.json")
ROOM_CACHE_DIR = os.path.join(DATA_DIR, "room_schedules")

LOCATIONS_TTL = 24 * 60 * 60
ROOM_TTL = 30 * 60

CLASS_TIMES = {
    1: ("08:30", "10:00"),
    2: ("10:10", "11:40"),
    3: ("11:50", "13:20"),
    4: ("14:00", "15:30"),
    5: ("15:40", "17:10"),
    6: ("17:20", "18:50"),
    7: ("19:00", "20:30"),
    8: ("20:40", "22:10"),
}

TYPE_MAP = {0: "Лекция", 1: "ЛЗ", 2: "ПЗ", 3: "Экзамен/Зачет"}

WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ezh/3.7",
    "Accept-Language": "ru-RU,ru;q=0.9",
}

_SLUG_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def _session():
    s = requests.Session()
    s.headers.update(_HEADERS)
    try:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        retry = Retry(total=2, connect=2, read=1, backoff_factor=0.4,
                      status_forcelist=(429, 500, 502, 503, 504),
                      allowed_methods=("GET",))
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.mount("http://", HTTPAdapter(max_retries=retry))
    except Exception:
        pass
    return s


def _atomic_write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def academic_week(today=None):
    today = today or date.today()
    start_year = today.year if today.month >= 9 else today.year - 1
    start = date(start_year, 9, 1)
    week = (today - start).days // 7 + 1
    return max(1, min(52, week))


def _week_bounds(week):
    today = date.today()
    start_year = today.year if today.month >= 9 else today.year - 1
    start = date(start_year, 9, 1) + timedelta(days=(week - 1) * 7)
    return start.isoformat(), (start + timedelta(days=6)).isoformat()


def _load_locations_from_site():
    s = _session()
    try:
        r = s.get(LOCATIONS_URL, timeout=(10, 25))
        r.raise_for_status()
        doc = lxml_html.fromstring(r.content)
    finally:
        s.close()

    seen = set()
    items = []
    for a in doc.xpath("//a[contains(@href,'/locations/')]"):
        href = (a.get("href") or "").strip()
        if not href:
            continue
        slug = href.rstrip("/").rsplit("/", 1)[-1]
        if not _SLUG_RE.match(slug) or slug in seen:
            continue
        name = " ".join(a.text_content().split())
        if not name:
            continue
        seen.add(slug)
        items.append({"slug": slug, "name": name})
    items.sort(key=lambda x: x["name"].lower())
    return items


def _get_locations(force=False):
    cached = _read_json(LOCATIONS_CACHE_FILE)
    if not force and isinstance(cached, dict):
        items = cached.get("items")
        ts = cached.get("ts") or 0
        if isinstance(items, list) and items and time.time() - ts < LOCATIONS_TTL:
            return items, False
    try:
        items = _load_locations_from_site()
        if items:
            _atomic_write_json(LOCATIONS_CACHE_FILE, {"ts": time.time(), "items": items})
            return items, False
    except Exception:
        pass
    if isinstance(cached, dict) and isinstance(cached.get("items"), list):
        return cached["items"], True
    return [], False


def _room_cache_path(slug, week):
    return os.path.join(ROOM_CACHE_DIR, f"{slug}_{week}.json")


def _parse_room_payload(payload, week):
    raw = payload.get("schedule") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        raw = []

    by_date = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        day = str(item.get("date") or "")
        if not day:
            continue
        n = item.get("n")
        try:
            n = int(n)
        except (TypeError, ValueError):
            n = 0
        groups = []
        for g in item.get("groups") or []:
            if not isinstance(g, dict):
                continue
            name = str(g.get("name") or "").strip()
            if not name:
                continue
            sub = str(g.get("subgroup") or "").strip()
            if sub and sub not in ("0", "None"):
                name += f" (п/г {sub})"
            groups.append(name)
        start, end = CLASS_TIMES.get(n, ("", ""))
        type_raw = item.get("type")
        try:
            type_raw = int(type_raw)
        except (TypeError, ValueError):
            pass
        pair = {
            "n": n,
            "time": f"{start}–{end}" if start else "",
            "start": start,
            "end": end,
            "lesson": str(item.get("lesson") or "").strip(),
            "type": TYPE_MAP.get(type_raw, "Занятие"),
            "teacher": str(item.get("teacher") or "").strip(),
            "groups": groups,
        }
        by_date.setdefault(day, []).append(pair)

    days = []
    for day in sorted(by_date):
        pairs = sorted(by_date[day], key=lambda p: (p["n"], p["lesson"]))
        try:
            wd = WEEKDAYS[date.fromisoformat(day).weekday()]
        except ValueError:
            wd = ""
        days.append({"date": day, "weekday": wd, "pairs": pairs})
    start, end = _week_bounds(week)
    return {
        "week": week,
        "week_start": start,
        "week_end": end,
        "days": days,
        "lessons": sum(len(d["pairs"]) for d in days),
    }


def _fetch_room(slug, week):
    s = _session()
    try:
        r = s.get(API_URL, params={"v": "6.2", "location": slug, "week": week},
                  timeout=(10, 30))
        r.raise_for_status()
        payload = r.json()
    finally:
        s.close()
    if not isinstance(payload, dict) or not payload.get("ok", True):
        raise ValueError("bad room schedule response")
    return payload


@bp.route("/api/locations")
@limiter.limit("30 per minute")
def api_locations():
    force = request.args.get("force") in ("1", "true")
    items, stale = _get_locations(force=force)
    if not items:
        return jsonify({"error": "locations unavailable", "items": []}), 502
    return jsonify({"items": items, "stale": stale})


@bp.route("/api/room_schedule")
@limiter.limit("120 per minute")
def api_room_schedule():
    slug = (request.args.get("slug") or "").strip()
    if not slug or not _SLUG_RE.match(slug) or ".." in slug:
        return jsonify({"error": "invalid room"}), 400

    raw_week = request.args.get("week")
    try:
        week = int(raw_week) if raw_week not in (None, "") else academic_week()
    except (TypeError, ValueError):
        return jsonify({"error": "invalid week"}), 400
    if week < 1 or week > 52:
        return jsonify({"error": "invalid week"}), 400

    force = request.args.get("force") in ("1", "true")
    cache_path = _room_cache_path(slug, week)
    cached = _read_json(cache_path)
    if not force and isinstance(cached, dict):
        data = cached.get("data")
        ts = cached.get("ts") or 0
        if isinstance(data, dict) and time.time() - ts < ROOM_TTL:
            return jsonify({**data, "stale": False})

    try:
        payload = _fetch_room(slug, week)
        data = _parse_room_payload(payload, week)
        _atomic_write_json(cache_path, {"ts": time.time(), "data": data})
        return jsonify({**data, "stale": False})
    except Exception:
        if isinstance(cached, dict) and isinstance(cached.get("data"), dict):
            return jsonify({**cached["data"], "stale": True})
        return jsonify({"error": "room schedule unavailable"}), 502
