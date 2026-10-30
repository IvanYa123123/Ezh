"""Задачи и глобальный поиск."""
from flask import Blueprint, jsonify, request

from .common import validate_date
from .db import get_db
from .extensions import limiter


bp = Blueprint('tasks', __name__)

_VALID_TASK_STATUS = ('green', 'orange', 'red', 'completed')


def _parse_task_payload(data, current=None):
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
    # Дата приходит из календаря в ISO. Если пришло что-то иное —
    # оставляем как есть (не ломаем уже существующие записи),
    # но не даём пустой строке пройти дальше.
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
        data = request.get_json(silent=True) or {}
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
        data = request.get_json(silent=True) or {}
        row = conn.execute(
            "SELECT date, text, status FROM tasks WHERE id=?", (task_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        payload, error = _parse_task_payload(data, current=dict(row))
        if error:
            return jsonify({"error": error}), 400

        conn.execute(
            "UPDATE tasks SET date=?, status=?, text=? WHERE id=?",
            (payload['date'], payload['status'], payload['text'], task_id)
        )
        conn.commit()
        return jsonify({"success": True})

    conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()
    return jsonify({"success": True})


@bp.route("/api/task_dates")
@limiter.limit("120 per minute")
def task_dates():
    conn = get_db()
    cursor = conn.execute("SELECT DISTINCT date FROM tasks ORDER BY date")
    return jsonify([row["date"] for row in cursor.fetchall()])


# ============================================================
#  ГЛОБАЛЬНЫЙ ПОИСК
# ============================================================

_SEARCH_FETCH_LIMIT  = 5000
_SEARCH_RESULT_LIMIT = 100


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

    cursor = conn.execute(
        "SELECT id, date, text, status FROM tasks "
        "ORDER BY date DESC, id DESC LIMIT ?",
        (_SEARCH_FETCH_LIMIT,)
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
        "FROM custom_schedule "
        "ORDER BY base_date DESC, id DESC LIMIT ?",
        (_SEARCH_FETCH_LIMIT,)
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

    return jsonify({
        "tasks": tasks,
        "events": events,
        "query": q,
        "count": len(tasks) + len(events),
    })