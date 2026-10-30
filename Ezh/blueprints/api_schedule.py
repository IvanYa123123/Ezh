"""Расписание: schedule_all, schedule_sync, .ics, custom_schedule, subjects."""
import os
import json
import time
import hashlib
import threading
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

from flask import Blueprint, jsonify, request, Response

from . import runtime
from .common import (
    validate_group, validate_subgroup, make_safe_filename,
    needs_sync, mark_synced, MtimeJsonCache,
    validate_date, validate_time_range, validate_recurrence, validate_exceptions,
)
from .db import get_db
from .extensions import limiter


bp = Blueprint('schedule', __name__)


def _safe_print(*args, **kwargs):
    try:
        import sys
        if sys.stdout is not None:
            print(*args, **kwargs)
    except Exception:
        pass


# ============================================================
#  КЭШ JSON-ФАЙЛОВ РАСПИСАНИЙ
# ------------------------------------------------------------
#  Каждый друг в «Друзьях» — это отдельный /api/schedule_all.
#  Раньше на каждый запрос файл читался и парсился заново
#  (json.load — самая дорогая часть ответа). Теперь разбор
#  кэшируется по mtime: файл меняется только при синхронизации,
#  поэтому повторные чтения бесплатны.
# ============================================================

_schedule_caches = {}
_schedule_caches_lock = threading.Lock()


def _schedule_cache(path):
    with _schedule_caches_lock:
        cache = _schedule_caches.get(path)
        if cache is None:
            cache = MtimeJsonCache(path)
            _schedule_caches[path] = cache
        return cache


def _read_schedule_file(path):
    if not os.path.exists(path):
        return []
    data = _schedule_cache(path).read(default_factory=list)
    return data if isinstance(data, list) else []


# ============================================================
#  ОСНОВНОЕ РАСПИСАНИЕ
# ------------------------------------------------------------
#  Лимиты. Одна загрузка страницы = 1 (своё) + N (друзья)
#  запросов schedule_all и столько же schedule_sync.
#  N = количество друзей, обычно 5–15.
#
#  Было: 30/min и 10/min — пользователь упирался после
#  2–5 перезагрузок страницы. Поднято с запасом.
# ============================================================

@bp.route("/api/schedule_all")
@limiter.limit("240 per minute")
def get_schedule_all():
    raw_group = request.args.get('group')
    try:
        group = validate_group(raw_group)
    except ValueError:
        return jsonify([])
    subgroup = validate_subgroup(request.args.get('subgroup', '0'))

    safe_group = make_safe_filename(group)
    cache_file = os.path.join(runtime.SCHEDULES_DIR, f"{safe_group}_{subgroup}.json")

    cached = _read_schedule_file(cache_file)
    if cached:
        return jsonify(cached)

    schedule = runtime.planner.get_semester_schedule(group, subgroup)
    if schedule:
        _schedule_cache(cache_file).write(schedule, ensure_ascii=False)
    return jsonify(schedule)


@bp.route("/api/schedule_sync")
@limiter.limit("120 per minute")
def sync_schedule():
    raw_group = request.args.get('group')
    try:
        group = validate_group(raw_group)
    except ValueError:
        return jsonify([])
    subgroup = validate_subgroup(request.args.get('subgroup', '0'))

    force = request.args.get('force') == '1'
    sync_key = f"{group}_{subgroup}"

    # Проверка кэша стоит ДО реальной синхронизации, но после
    # декоратора лимитера — счётчик rate-limit её не обходит.
    # Поэтому лимит на этот эндпоинт поднят с большим запасом.
    if not force and not needs_sync(sync_key):
        return jsonify([])

    schedule = runtime.planner.get_semester_schedule(group, subgroup)
    safe_group = make_safe_filename(group)
    cache_file = os.path.join(runtime.SCHEDULES_DIR, f"{safe_group}_{subgroup}.json")

    if schedule:
        old_schedule = _read_schedule_file(cache_file)
        if old_schedule and len(schedule) < len(old_schedule) * 0.9:
            _safe_print(
                f"[Защита] Отмена записи: получено {len(schedule)} пар, "
                f"в кэше {len(old_schedule)}",
                flush=True,
            )
            return jsonify(old_schedule)

        _schedule_cache(cache_file).write(schedule, ensure_ascii=False)
        mark_synced(sync_key)
    else:
        if not os.path.exists(cache_file):
            mark_synced(sync_key)

    return jsonify(schedule)


# ============================================================
#  ЭКСПОРТ В .ICS
# ============================================================

def _ics_escape(s):
    if s is None:
        return ''
    return (str(s)
            .replace('\\', '\\\\')
            .replace(';', '\\;')
            .replace(',', '\\,')
            .replace('\r', '')
            .replace('\n', '\\n'))


def _stable_uid(*parts):
    s = '|'.join(str(p) for p in parts)
    return hashlib.md5(s.encode('utf-8')).hexdigest()[:16]


def _fold_ics_line(line: str, limit: int = 75) -> str:
    """RFC 5545 line folding: строки не длиннее 75 октетов.

    Продолжение начинается с одного пробела, поэтому первая строка
    может занимать limit байт, а каждая следующая — limit-1
    (один байт уходит под пробел-маркер). Режем посимвольно, а не
    побайтно — иначе разрубим многобайтовый UTF-8 символ пополам.

    Раньше здесь была мёртвая ветка `current = b' ' if not first or True else b''`
    — `not first or True` всегда True, и условие читалось как баг.
    Переписано без неоднозначности: явные first_limit/cont_limit.
    """
    if not line:
        return line
    if len(line.encode('utf-8')) <= limit:
        return line

    parts = []
    current = bytearray()
    current_limit = limit  # первая строка — до limit байт

    for char in line:
        char_bytes = char.encode('utf-8')
        if len(current) + len(char_bytes) > current_limit:
            parts.append(current.decode('utf-8'))
            current = bytearray(b' ')
            current_limit = limit - 1  # продолжения: ' ' + до limit-1 байт
        current += char_bytes

    if current:
        parts.append(current.decode('utf-8'))
    return '\r\n'.join(parts)


def _generate_ics(schedule, group_name):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Ezh Dnevnik//Schedule//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ics_escape(group_name)}",
    ]

    dtstamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')

    sorted_sched = sorted(
        schedule,
        key=lambda x: (x.get('date', ''), x.get('n', 0) or 0)
    )

    for item in sorted_sched:
        date = item.get('date', '')
        tr = item.get('time_range', '')
        if not date or not tr or ' - ' not in tr:
            continue

        date_clean = date.replace('-', '')
        try:
            start_s, end_s = tr.split(' - ')
            start_h, start_m = start_s.strip().split(':')
            end_h, end_m = end_s.strip().split(':')
        except ValueError:
            continue

        dtstart = f"{date_clean}T{start_h}{start_m}00"
        dtend = f"{date_clean}T{end_h}{end_m}00"

        lesson = item.get('lesson', '')
        type_name = item.get('type_name', '')
        teacher = item.get('teacher', '') or ''
        location = item.get('location', '') or ''
        n = item.get('n', '')

        uid = _stable_uid(group_name, date, n, lesson, type_name) + "@ezh-dnevnik"
        summary = f"{type_name} {lesson}".strip() if type_name else lesson

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTAMP:{dtstamp}")
        lines.append(f"DTSTART:{dtstart}")
        lines.append(f"DTEND:{dtend}")
        lines.append(f"SUMMARY:{_ics_escape(summary)}")
        if location:
            lines.append(f"LOCATION:{_ics_escape(location)}")
        if teacher:
            lines.append(f"DESCRIPTION:{_ics_escape(teacher)}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")

    # Складываем длинные строки — Outlook и другие строгие
    # ICS-клиенты ругаются на строки > 75 октетов.
    folded = [_fold_ics_line(line) for line in lines]
    return "\r\n".join(folded) + "\r\n"


@bp.route("/api/schedule.ics")
@limiter.limit("30 per minute")
def export_ics():
    t0 = time.time()
    raw_group = request.args.get('group')
    try:
        group = validate_group(raw_group)
    except ValueError:
        return Response("Invalid group", status=400, mimetype='text/plain; charset=utf-8')
    subgroup = validate_subgroup(request.args.get('subgroup', '0'))

    safe_group = make_safe_filename(group)
    cache_file = os.path.join(runtime.SCHEDULES_DIR, f"{safe_group}_{subgroup}.json")
    cache_exists = os.path.exists(cache_file)
    _safe_print(f"[ics] START group={group!r} subgroup={subgroup} cache_exists={cache_exists}", flush=True)

    schedule = []
    if cache_exists:
        schedule = _read_schedule_file(cache_file)
        _safe_print(f"[ics] loaded from cache: {len(schedule)} items", flush=True)

    if not schedule:
        _safe_print(f"[ics] no cache — returning 409", flush=True)
        return Response(
            "Расписание ещё не загружено. Откройте группу в календаре — данные подтянутся из СевГУ, затем скачивайте .ics.",
            status=409,
            mimetype='text/plain; charset=utf-8'
        )

    ics_text = _generate_ics(schedule, group)
    filename = f"schedule_{safe_group}_{subgroup}.ics"
    elapsed = time.time() - t0
    _safe_print(f"[ics] DONE in {elapsed:.2f}s, size={len(ics_text)} bytes", flush=True)

    ascii_filename = filename.encode('ascii', 'replace').decode('ascii').replace('?', '_')
    utf8_filename = quote(filename, safe='')

    return Response(
        ics_text,
        # content_type, а не mimetype: иначе Flask добавляет charset повторно
        # и получается «text/calendar; charset=utf-8; charset=utf-8».
        content_type='text/calendar; charset=utf-8',
        headers={
            'Content-Disposition': (
                f"attachment; filename=\"{ascii_filename}\"; "
                f"filename*=UTF-8''{utf8_filename}"
            ),
            'Cache-Control': 'no-store',
        }
    )


# ============================================================
#  ЭКСПОРТ ЗАМЕТОК В .ICS
# ------------------------------------------------------------
#  Заметки живут в SQLite, а не в кэше расписания, поэтому
#  отдельный генератор. Дедлайн — событие на весь день,
#  статус переносится в CATEGORIES и X-EZHEDNEVNIK-STATUS.
# ============================================================

_TASK_STATUS_LABEL = {
    'green': 'Обычная',
    'orange': 'Важная',
    'red': 'Срочная',
    'completed': 'Выполнено',
}


def _generate_tasks_ics(tasks, calendar_name="Заметки EZHednevnik"):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Ezh Dnevnik//Tasks//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ics_escape(calendar_name)}",
    ]
    dtstamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')

    for task in tasks:
        date = str(task.get('date') or '')
        text = str(task.get('text') or '').strip()
        if not date or not text:
            continue
        try:
            day = datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            continue

        # Событие на весь день: DTEND — следующий день (RFC 5545).
        dtstart = day.strftime('%Y%m%d')
        dtend = (day + timedelta(days=1)).strftime('%Y%m%d')
        status = str(task.get('status') or 'green')
        completed = status == 'completed'
        uid = _stable_uid("task", date, text) + "@ezh-dnevnik"

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTAMP:{dtstamp}")
        lines.append(f"DTSTART;VALUE=DATE:{dtstart}")
        lines.append(f"DTEND;VALUE=DATE:{dtend}")
        lines.append(f"SUMMARY:{_ics_escape(text)}")
        lines.append(f"CATEGORIES:{_ics_escape(_TASK_STATUS_LABEL.get(status, status))}")
        lines.append(f"X-EZHEDNEVNIK-STATUS:{_ics_escape(status)}")
        lines.append("STATUS:COMPLETED" if completed else "STATUS:NEEDS-ACTION")
        lines.append("TRANSP:TRANSPARENT")
        if completed:
            lines.append("PERCENT-COMPLETE:100")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")

    folded = [_fold_ics_line(line) for line in lines]
    return "\r\n".join(folded) + "\r\n"


@bp.route("/api/tasks.ics")
@limiter.limit("30 per minute")
def export_tasks_ics():
    conn = get_db()
    rows = conn.execute(
        "SELECT date, text, status FROM tasks ORDER BY date, id"
    ).fetchall()

    tasks = [{"date": r["date"], "text": r["text"], "status": r["status"]} for r in rows]
    if not tasks:
        return Response(
            "Заметок пока нет — сначала добавьте хотя бы одну.",
            status=409,
            mimetype='text/plain; charset=utf-8'
        )

    ics_text = _generate_tasks_ics(tasks)
    filename = "ezh_notes.ics"
    _safe_print(f"[ics] tasks export: {len(tasks)} notes, {len(ics_text)} bytes", flush=True)

    return Response(
        ics_text,
        content_type='text/calendar; charset=utf-8',
        headers={
            'Content-Disposition': f"attachment; filename=\"{filename}\"",
            'Cache-Control': 'no-store',
        }
    )


# ============================================================
#  НАСТРОЙКИ ПРЕДМЕТОВ
# ============================================================

@bp.route("/api/subjects", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def manage_subjects():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        subject = (data.get('subject') or '').strip()
        if not subject:
            return jsonify({"error": "subject required"}), 400
        if len(subject) > 200:
            return jsonify({"error": "subject too long"}), 400

        link = (data.get('link', '') or '').strip()
        if link and not (link.startswith('http://') or link.startswith('https://') or link.startswith('mailto:')):
            link = ''

        conn.execute(
            "INSERT OR REPLACE INTO subject_settings "
            "(subject, custom_name, link, teacher, location) VALUES (?, ?, ?, ?, ?)",
            (subject,
             _clean_field(data.get('custom_name')),
             link[:2000],
             _clean_field(data.get('teacher')),
             _clean_field(data.get('location')))
        )
        conn.commit()
        return jsonify({"success": True})

    cursor = conn.execute(
        "SELECT subject, custom_name, link, teacher, location FROM subject_settings"
    )
    settings = {row["subject"]: {
        "custom_name": row["custom_name"],
        "link": row["link"],
        "teacher": row["teacher"],
        "location": row["location"],
    } for row in cursor.fetchall()}
    resp = jsonify(settings)
    resp.headers['Cache-Control'] = 'private, max-age=300'
    return resp


# ============================================================
#  КАСТОМНОЕ РАСПИСАНИЕ
# ============================================================

_MAX_TEXT_FIELD = 200


def _clean_field(value, limit=_MAX_TEXT_FIELD) -> str:
    return str(value or '').strip()[:limit]


def _parse_custom_payload(data, need_group, current=None):
    """Проверяет и нормализует тело запроса custom_schedule.

    Возвращает (payload, None) либо (None, текст_ошибки).
    Без этого в БД могли попасть base_date="", time_range="когда-нибудь"
    и recurrence="иногда": запись сохранялась, но в календарь не попадала
    никогда и молча терялась.
    """
    base = dict(current or {})
    payload = {}

    if need_group:
        try:
            payload['group'] = validate_group((data.get('group') or '').strip())
        except ValueError as e:
            return None, str(e)

    lesson = _clean_field(data.get('lesson', base.get('lesson')))
    if not lesson:
        return None, "lesson required"
    payload['lesson'] = lesson

    try:
        payload['base_date'] = validate_date(data.get('base_date', base.get('base_date')))
    except ValueError:
        return None, "invalid base_date (ожидается YYYY-MM-DD)"

    try:
        payload['time_range'] = validate_time_range(data.get('time_range', base.get('time_range')))
    except ValueError:
        return None, "invalid time_range (ожидается HH:MM - HH:MM)"

    payload['type_name'] = _clean_field(data.get('type_name', base.get('type_name')), 50)
    payload['teacher'] = _clean_field(data.get('teacher', base.get('teacher')))
    payload['location'] = _clean_field(data.get('location', base.get('location')))
    raw_event = data.get('is_event', base.get('is_event', 0))
    payload['is_event'] = 1 if str(raw_event).strip() in ('1', 'true', 'True') else 0
    payload['recurrence'] = validate_recurrence(data.get('recurrence', base.get('recurrence')))
    payload['exceptions'] = validate_exceptions(data.get('exceptions', base.get('exceptions')))
    return payload, None


@bp.route("/api/custom_schedule", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def manage_custom_schedule():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        payload, error = _parse_custom_payload(data, need_group=True)
        if error:
            return jsonify({"error": error}), 400

        cursor = conn.execute(
            "INSERT INTO custom_schedule "
            "(group_name, base_date, time_range, lesson, type_name, teacher, location, is_event, recurrence, exceptions) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (payload['group'],
             payload['base_date'],
             payload['time_range'],
             payload['lesson'],
             payload['type_name'],
             payload['teacher'],
             payload['location'],
             payload['is_event'],
             payload['recurrence'],
             payload['exceptions'])
        )
        conn.commit()
        return jsonify({"id": cursor.lastrowid})

    group = request.args.get('group')
    if not group:
        return jsonify([])

    cursor = conn.execute(
        "SELECT id, base_date, time_range, lesson, type_name, teacher, location, is_event, recurrence, exceptions "
        "FROM custom_schedule WHERE group_name=?",
        (group,)
    )
    items = [{
        "id": row["id"],
        "base_date": row["base_date"],
        "time_range": row["time_range"],
        "lesson": row["lesson"],
        "type_name": row["type_name"],
        "teacher": row["teacher"],
        "location": row["location"],
        "is_event": row["is_event"],
        "recurrence": row["recurrence"],
        "exceptions": row["exceptions"] or "[]",
    } for row in cursor.fetchall()]
    return jsonify(items)


@bp.route("/api/custom_schedule/<int:item_id>", methods=["PUT", "DELETE"])
@limiter.limit("120 per minute")
def update_custom_schedule(item_id):
    conn = get_db()

    if request.method == "PUT":
        data = request.get_json(silent=True) or {}
        payload, error = _parse_custom_payload(data, need_group=False)
        if error:
            return jsonify({"error": error}), 400

        conn.execute(
            "UPDATE custom_schedule SET base_date=?, time_range=?, lesson=?, "
            "type_name=?, teacher=?, location=?, is_event=?, recurrence=?, exceptions=? "
            "WHERE id=?",
            (payload['base_date'],
             payload['time_range'],
             payload['lesson'],
             payload['type_name'],
             payload['teacher'],
             payload['location'],
             payload['is_event'],
             payload['recurrence'],
             payload['exceptions'],
             item_id)
        )
        conn.commit()
        return jsonify({"success": True})

    conn.execute("DELETE FROM custom_schedule WHERE id=?", (item_id,))
    conn.commit()
    return jsonify({"success": True})