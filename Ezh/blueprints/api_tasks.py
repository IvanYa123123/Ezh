"""Задачи и глобальный поиск."""
from flask import Blueprint, jsonify, request

from .db import get_db
from .extensions import limiter


bp = Blueprint('tasks', __name__)


# ============================================================
#  ЗАДАЧИ
# ============================================================

@bp.route("/api/tasks", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def manage_tasks():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        date = (data.get('date') or '').strip()
        text = (data.get('text') or '').strip()
        status = (data.get('status') or 'green').strip()

        if not date or not text:
            return jsonify({"error": "date and text required"}), 400
        if len(text) > 2000:
            return jsonify({"error": "text too long"}), 400
        if status not in ('green', 'orange', 'red', 'completed'):
            status = 'green'

        cursor = conn.execute(
            "INSERT INTO tasks (date, text, status) VALUES (?, ?, ?)",
            (date, text, status)
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
        date = (data.get('date') or '').strip()
        text = (data.get('text') or '').strip()
        status = (data.get('status') or 'green').strip()

        if not date or not text:
            return jsonify({"error": "date and text required"}), 400
        if len(text) > 2000:
            return jsonify({"error": "text too long"}), 400

        conn.execute(
            "UPDATE tasks SET date=?, status=?, text=? WHERE id=?",
            (date, status, text, task_id)
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