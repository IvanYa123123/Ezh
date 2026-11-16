"""Задачи и глобальный поиск."""
import json
import os

from flask import Blueprint, jsonify, request

from . import runtime
from .common import validate_date
from .db import get_db
from .extensions import limiter


bp = Blueprint('tasks', __name__)

_VALID_TASK_STATUS = ('green', 'orange', 'red', 'completed')


def _parse_task_payload(data, current=None, strict_date=True):
    """Общая валидация для POST и PUT.

    current — уже сохранённая строка (для PUT). Если передана, поля,
    которых нет в запросе, берутся из неё: частичное обновление
    (например, только status) больше не падает с "date and text required"
    и не перезаписывает заметку пустыми значениями.
    """
    base = dict(current or {})
    date = str(data.get('date', base.get('date')) or '').strip()
    text = str(data.get('text', base.get('text')) or '').strip()
    status = str(data.get('status', base.get('status') or 'green')).strip()

    if not date or not text:
        return None, "date and text required"
    if len(text) > 2000:
        return None, "text too long"

    if strict_date:
        try:
            date = validate_date(date, strict=True)
        except ValueError:
            return None, "invalid date (ожидается YYYY-MM-DD)"
    else:
        # Для PUT оставляем мягкую проверку, чтобы не ломать уже
        # существующие записи с нестандартной датой.
        date = validate_date(date, strict=False) or date

    if status not in _VALID_TASK_STATUS:
        # Раньше молча подставлялся green и правка терялась незаметно.
        return None, "invalid status"
    return {"date": date, "text": text, "status": status}, None


# ============================================================
#  ЗАДАЧИ
# ============================================================

@bp.route("/api/tasks", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def manage_tasks():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "invalid json"}), 400
        payload, error = _parse_task_payload(data)
        if error:
            return jsonify({"error": error}), 400

        cursor = conn.execute(
            "INSERT INTO tasks (date, text, status) VALUES (?, ?, ?)",
            (payload['date'], payload['text'], payload['status'])
        )
        conn.commit()
        return jsonify({"id": cursor.lastrowid})

    start_date = request.args.get('start')
    end_date = request.args.get('end')
    if not start_date or not end_date:
        return jsonify([])
    try:
        start_date = validate_date(start_date)
        end_date = validate_date(end_date)
    except ValueError:
        return jsonify({"error": "invalid date range"}), 400

    cursor = conn.execute(
        "SELECT id, date, text, status FROM tasks WHERE date BETWEEN ? AND ?",
        (start_date, end_date)
    )
    tasks = [{"id": row["id"], "date": row["date"],
              "text": row["text"], "status": row["status"]}
             for row in cursor.fetchall()]
    return jsonify(tasks)


@bp.route("/api/tasks/<int:task_id>", methods=["PUT", "DELETE"])
@limiter.limit("120 per minute")
def update_task(task_id):
    conn = get_db()

    if request.method == "PUT":
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "invalid json"}), 400
        row = conn.execute(
            "SELECT date, text, status FROM tasks WHERE id=?", (task_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        # strict_date=True: PUT раньше принимал любую строку датой,
        # и такая заметка молча выпадала из ICS-экспорта.
        payload, error = _parse_task_payload(data, current=dict(row), strict_date=True)
        if error:
            return jsonify({"error": error}), 400

        conn.execute(
            "UPDATE tasks SET date=?, status=?, text=? WHERE id=?",
            (payload['date'], payload['status'], payload['text'], task_id)
        )
        conn.commit()
        return jsonify({"success": True})

    cursor = conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()
    if cursor.rowcount == 0:
        return jsonify({"error": "not found"}), 404
    return jsonify({"success": True})


@bp.route("/api/task_dates")
@limiter.limit("120 per minute")
def task_dates():
    conn = get_db()
    cursor = conn.execute("SELECT DISTINCT date FROM tasks ORDER BY date")
    return jsonify([row["date"] for row in cursor.fetchall()])


@bp.route("/api/task_date_counts")
@limiter.limit("120 per minute")
def task_date_counts():
    conn = get_db()
    cursor = conn.execute(
        "SELECT date, COUNT(*) AS cnt, "
        "       MAX(CASE status WHEN 'red' THEN 3 WHEN 'orange' THEN 2 ELSE 1 END) AS sev "
        "FROM tasks GROUP BY date ORDER BY date"
    )
    counts = {}
    severity = {}
    names = {3: 'red', 2: 'orange', 1: 'green'}
    for row in cursor.fetchall():
        counts[row["date"]] = row["cnt"]
        severity[row["date"]] = names.get(row["sev"], 'green')
    return jsonify({"counts": counts, "severity": severity})


# ============================================================
#  ГЛОБАЛЬНЫЙ ПОИСК
# ============================================================

_SEARCH_RESULT_LIMIT = 100


_SCHEDULE_ITEMS_CACHE = {"signature": None, "items": []}


def _load_schedule_items():
    """Читает все кэши расписаний для глобального поиска (с кэшем по mtime)."""
    schedules_dir = runtime.SCHEDULES_DIR
    if not schedules_dir or not os.path.isdir(schedules_dir):
        return []

    try:
        names = sorted(n for n in os.listdir(schedules_dir) if n.endswith('.json'))
    except OSError:
        return []

    signature = []
    for name in names:
        try:
            signature.append((name, os.path.getmtime(os.path.join(schedules_dir, name))))
        except OSError:
            pass
    signature = tuple(signature)

    if _SCHEDULE_ITEMS_CACHE["signature"] == signature:
        return _SCHEDULE_ITEMS_CACHE["items"]

    items = []
    for name in names:
        try:
            with open(os.path.join(schedules_dir, name), encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(data, list):
            items.extend(x for x in data if isinstance(x, dict))

    _SCHEDULE_ITEMS_CACHE["signature"] = signature
    _SCHEDULE_ITEMS_CACHE["items"] = items
    return items


@bp.route("/api/search")
@limiter.limit("30 per minute")
def search_all():
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify({"tasks": [], "events": [], "query": q, "count": 0})
    if len(q) > 100:
        q = q[:100]

    q_lower = q.lower()
    conn = get_db()

    # Фильтруем в Python (SQLite lower() не умеет кириллицу), но без
    # прежнего LIMIT 5000: иначе старые заметки вообще не находились.
    cursor = conn.execute(
        "SELECT id, date, text, status FROM tasks ORDER BY date DESC, id DESC"
    )
    tasks = []
    for r in cursor.fetchall():
        text = r["text"] or ""
        if q_lower in text.lower():
            tasks.append({
                "id": r["id"],
                "date": r["date"],
                "text": text,
                "status": r["status"],
            })
            if len(tasks) >= _SEARCH_RESULT_LIMIT:
                break

    cursor = conn.execute(
        "SELECT id, group_name, base_date, time_range, lesson, type_name, "
        "       teacher, location, is_event, recurrence "
        "FROM custom_schedule ORDER BY base_date DESC, id DESC"
    )
    events = []
    for r in cursor.fetchall():
        haystack = " ".join([
            r["lesson"] or "",
            r["type_name"] or "",
            r["teacher"] or "",
            r["location"] or "",
        ]).lower()
        if q_lower in haystack:
            events.append({
                "id": r["id"],
                "group_name": r["group_name"],
                "base_date": r["base_date"],
                "time_range": r["time_range"],
                "lesson": r["lesson"],
                "type_name": r["type_name"],
                "teacher": r["teacher"],
                "location": r["location"],
                "is_event": r["is_event"],
                "recurrence": r["recurrence"],
            })
            if len(events) >= _SEARCH_RESULT_LIMIT:
                break

    # Пары, преподаватели и аудитории из локальных кэшей расписаний.
    lessons = []
    teachers = []
    rooms = []
    seen_lessons = set()
    seen_teachers = set()
    seen_rooms = set()

    for item in _load_schedule_items():
        lesson = str(item.get('lesson') or '')
        teacher = str(item.get('teacher') or '')
        location = str(item.get('location') or '')
        type_name = str(item.get('type_name') or '')
        date = str(item.get('date') or '')

        if q_lower in ' '.join([lesson, type_name, teacher, location]).lower():
            key = (date, lesson, item.get('time_range'), location, item.get('subgroup'))
            if key not in seen_lessons and len(lessons) < 12:
                seen_lessons.add(key)
                lessons.append({
                    "date": date,
                    "lesson": lesson,
                    "type_name": type_name,
                    "teacher": teacher,
                    "location": location,
                    "time_range": str(item.get('time_range') or ''),
                    "subgroup": str(item.get('subgroup') or ''),
                })

        if teacher and q_lower in teacher.lower():
            slug = str(item.get('teacher_slug') or '')
            if teacher not in seen_teachers and len(teachers) < 8:
                seen_teachers.add(teacher)
                teachers.append({"name": teacher, "slug": slug})

        if location and q_lower in location.lower():
            if location not in seen_rooms and len(rooms) < 8:
                seen_rooms.add(location)
                rooms.append(location)

    # Дополнительно — полный список преподавателей, если он уже загружен.
    if len(teachers) < 8:
        try:
            with open(os.path.join(runtime.DATA_DIR, 'teachers.json'), encoding='utf-8') as f:
                cached = json.load(f)
        except (OSError, ValueError):
            cached = []
        if isinstance(cached, dict):
            cached = cached.get('items') or cached.get('teachers') or []
        if isinstance(cached, list):
            for t in cached:
                if not isinstance(t, dict):
                    continue
                name = str(t.get('name') or '')
                slug = str(t.get('slug') or '')
                if name and slug and q_lower in name.lower() and slug not in seen_teachers:
                    seen_teachers.add(slug)
                    teachers.append({"name": name, "slug": slug})
                    if len(teachers) >= 8:
                        break

    lessons.sort(key=lambda x: x["date"], reverse=True)

    return jsonify({
        "tasks": tasks,
        "events": events,
        "lessons": lessons,
        "teachers": teachers,
        "rooms": rooms,
        "query": q,
        "count": len(tasks) + len(events) + len(lessons) + len(teachers) + len(rooms),
    })