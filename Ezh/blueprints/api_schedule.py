"""Расписание: schedule_all, schedule_sync, .ics, custom_schedule, subjects."""
import os
import json
import time
import hashlib
from datetime import datetime, timezone
from urllib.parse import quote

from flask import Blueprint, jsonify, request, Response

from . import runtime
from .common import (
    validate_group, validate_subgroup, make_safe_filename,
    needs_sync, mark_synced,
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

    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                return jsonify(json.load(f))
        except (json.JSONDecodeError, OSError):
            pass

    schedule = runtime.planner.get_semester_schedule(group, subgroup)
    if schedule:
        try:
            tmp = cache_file + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(schedule, f, ensure_ascii=False)
            os.replace(tmp, cache_file)
        except OSError:
            pass
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
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    old_schedule = json.load(f)
                if len(schedule) < len(old_schedule) * 0.9:
                    _safe_print(
                        f"[Защита] Отмена записи: получено {len(schedule)} пар, "
                        f"в кэше {len(old_schedule)}",
                        flush=True,
                    )
                    return jsonify(old_schedule)
            except (json.JSONDecodeError, OSError):
                pass

        try:
            tmp = cache_file + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(schedule, f, ensure_ascii=False)
            os.replace(tmp, cache_file)
        except OSError:
            pass

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
    Продолжение начинается с пробела. Учитываем, что кириллица
    в UTF-8 весит 2 байта, поэтому режем посимвольно, а не
    побайтно — иначе разрубим многобайтовый символ пополам.
    """
    if not line:
        return line
    encoded = line.encode('utf-8')
    if len(encoded) <= limit:
        return line

    parts = []
    current = b''
    first = True
    for char in line:
        char_bytes = char.encode('utf-8')
        # Первая строка — до limit байт, продолжения — ' ' + 74 байт
        effective_limit = limit if first else limit - 1
        if len(current) + len(char_bytes) > effective_limit:
            parts.append(current.decode('utf-8'))
            current = b' ' if not first or True else b''
            # На первой итерации при флаше first станет False
            if first:
                first = False
                current = b' '
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
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                schedule = json.load(f)
            _safe_print(f"[ics] loaded from cache: {len(schedule)} items", flush=True)
        except (json.JSONDecodeError, OSError) as e:
            _safe_print(f"[ics] cache read failed: {e}", flush=True)
            schedule = []

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
        mimetype='text/calendar; charset=utf-8',
        headers={
            'Content-Disposition': (
                f"attachment; filename=\"{ascii_filename}\"; "
                f"filename*=UTF-8''{utf8_filename}"
            ),
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
             data.get('custom_name', '') or '',
             link,
             data.get('teacher', '') or '',
             data.get('location', '') or '')
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

@bp.route("/api/custom_schedule", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def manage_custom_schedule():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        group = (data.get('group') or '').strip()
        lesson = (data.get('lesson') or '').strip()
        if not group or not lesson:
            return jsonify({"error": "group and lesson required"}), 400
        if len(lesson) > 200:
            return jsonify({"error": "lesson too long"}), 400
        try:
            group = validate_group(group)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        cursor = conn.execute(
            "INSERT INTO custom_schedule "
            "(group_name, base_date, time_range, lesson, type_name, teacher, location, is_event, recurrence, exceptions) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (group,
             data.get('base_date', '') or '',
             data.get('time_range', '') or '',
             lesson,
             data.get('type_name', '') or '',
             data.get('teacher', '') or '',
             data.get('location', '') or '',
             int(data.get('is_event', 0) or 0),
             data.get('recurrence', 'none') or 'none',
             data.get('exceptions', '[]') or '[]')
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
        lesson = (data.get('lesson') or '').strip()
        if not lesson:
            return jsonify({"error": "lesson required"}), 400
        if len(lesson) > 200:
            return jsonify({"error": "lesson too long"}), 400

        conn.execute(
            "UPDATE custom_schedule SET base_date=?, time_range=?, lesson=?, "
            "type_name=?, teacher=?, location=?, is_event=?, recurrence=?, exceptions=? "
            "WHERE id=?",
            (data.get('base_date', '') or '',
             data.get('time_range', '') or '',
             lesson,
             data.get('type_name', '') or '',
             data.get('teacher', '') or '',
             data.get('location', '') or '',
             int(data.get('is_event', 0) or 0),
             data.get('recurrence', 'none') or 'none',
             data.get('exceptions', '[]') or '[]',
             item_id)
        )
        conn.commit()
        return jsonify({"success": True})

    conn.execute("DELETE FROM custom_schedule WHERE id=?", (item_id,))
    conn.commit()
    return jsonify({"success": True})