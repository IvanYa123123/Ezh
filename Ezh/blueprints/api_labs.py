"""Лабораторные и ПЗ: сводка и поштучный список."""
from flask import Blueprint, jsonify, request

from .db import get_db
from .extensions import limiter


bp = Blueprint('labs', __name__)


# ============================================================
#  СВОДКА (completed / total по предметам)
# ============================================================

@bp.route("/api/labs", methods=["GET", "POST"])
@limiter.limit("60 per minute")
def manage_labs():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "invalid json"}), 400

        items = data if isinstance(data, list) else [data]
        for item in items:
            group = (item.get('group') or '').strip()
            subject = (item.get('subject') or '').strip()
            if not group or not subject:
                continue
            try:
                completed = max(0, int(item.get('completed', 0)))
                total = max(0, int(item.get('total', 0)))
            except (TypeError, ValueError):
                continue
            if completed > total:
                completed = total
            conn.execute(
                "INSERT OR REPLACE INTO lab_progress (group_name, subject, completed, total) "
                "VALUES (?, ?, ?, ?)",
                (group, subject, completed, total)
            )
        conn.commit()
        return jsonify({"success": True})

    group = request.args.get('group')
    if not group:
        return jsonify({})

    cursor = conn.execute(
        "SELECT subject, completed, total FROM lab_progress WHERE group_name=?",
        (group,)
    )
    labs = {row["subject"]: {"completed": row["completed"], "total": row["total"]}
            for row in cursor.fetchall()}
    return jsonify(labs)


def _recalc_lab_progress(conn, group, subject):
    row = conn.execute(
        "SELECT COUNT(*) AS total, COALESCE(SUM(completed), 0) AS done "
        "FROM lab_items WHERE group_name=? AND subject=?",
        (group, subject)
    ).fetchone()
    total = row["total"] or 0
    done = row["done"] or 0
    if total == 0:
        conn.execute(
            "DELETE FROM lab_progress WHERE group_name=? AND subject=?",
            (group, subject)
        )
    else:
        conn.execute(
            "INSERT OR REPLACE INTO lab_progress (group_name, subject, completed, total) "
            "VALUES (?, ?, ?, ?)",
            (group, subject, done, total)
        )


# ============================================================
#  ПОШТУЧНЫЙ СПИСОК
# ============================================================

@bp.route("/api/lab_items", methods=["GET"])
@limiter.limit("120 per minute")
def get_lab_items():
    group = (request.args.get('group') or '').strip()
    if not group:
        return jsonify({})

    conn = get_db()
    rows = conn.execute(
        "SELECT id, subject, idx, title, completed FROM lab_items "
        "WHERE group_name=? ORDER BY subject, idx",
        (group,)
    ).fetchall()

    grouped = {}
    for r in rows:
        subj = r["subject"]
        if subj not in grouped:
            grouped[subj] = []
        grouped[subj].append({
            "id": r["id"],
            "idx": r["idx"],
            "title": r["title"],
            "completed": int(r["completed"]),
        })
    return jsonify(grouped)


@bp.route("/api/lab_items/sync", methods=["POST"])
@limiter.limit("60 per minute")
def sync_lab_items():
    data = request.get_json(silent=True) or {}
    group = (data.get('group') or '').strip()
    items = data.get('items') or []
    if not group or not isinstance(items, list):
        return jsonify({"error": "group and items required"}), 400

    conn = get_db()
    touched_subjects = set()

    for spec in items:
        subject = (spec.get('subject') or '').strip()
        try:
            count = int(spec.get('count') or 0)
        except (TypeError, ValueError):
            continue
        if not subject or count <= 0 or count > 200:
            continue

        touched_subjects.add(subject)

        existing = conn.execute(
            "SELECT idx FROM lab_items WHERE group_name=? AND subject=?",
            (group, subject)
        ).fetchall()
        existing_idx = {r["idx"] for r in existing}

        short = subject
        if '(' in subject and ')' in subject:
            short = subject[subject.rfind('(') + 1:subject.rfind(')')].strip() or subject

        for i in range(1, count + 1):
            if i in existing_idx:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO lab_items (group_name, subject, idx, title, completed) "
                "VALUES (?, ?, ?, ?, 0)",
                (group, subject, i, f"{short}{i}")
            )

    for subj in touched_subjects:
        _recalc_lab_progress(conn, group, subj)

    conn.commit()
    return jsonify({"success": True})


@bp.route("/api/lab_items/add", methods=["POST"])
@limiter.limit("60 per minute")
def add_lab_item():
    data = request.get_json(silent=True) or {}
    group = (data.get('group') or '').strip()
    subject = (data.get('subject') or '').strip()
    if not group or not subject:
        return jsonify({"error": "group and subject required"}), 400

    conn = get_db()
    row = conn.execute(
        "SELECT COALESCE(MAX(idx), 0) AS max_idx FROM lab_items "
        "WHERE group_name=? AND subject=?",
        (group, subject)
    ).fetchone()
    next_idx = (row["max_idx"] or 0) + 1

    short = subject
    if '(' in subject and ')' in subject:
        short = subject[subject.rfind('(') + 1:subject.rfind(')')].strip() or subject

    conn.execute(
        "INSERT INTO lab_items (group_name, subject, idx, title, completed) "
        "VALUES (?, ?, ?, ?, 0)",
        (group, subject, next_idx, f"{short}{next_idx}")
    )
    _recalc_lab_progress(conn, group, subject)
    conn.commit()

    new_row = conn.execute(
        "SELECT id, idx, title, completed FROM lab_items "
        "WHERE group_name=? AND subject=? AND idx=?",
        (group, subject, next_idx)
    ).fetchone()

    return jsonify({
        "success": True,
        "item": {
            "id": new_row["id"],
            "idx": new_row["idx"],
            "title": new_row["title"],
            "completed": int(new_row["completed"]),
        }
    })


@bp.route("/api/lab_items/remove_last", methods=["POST"])
@limiter.limit("60 per minute")
def remove_last_lab_item():
    data = request.get_json(silent=True) or {}
    group = (data.get('group') or '').strip()
    subject = (data.get('subject') or '').strip()
    if not group or not subject:
        return jsonify({"error": "group and subject required"}), 400

    conn = get_db()
    row = conn.execute(
        "SELECT id FROM lab_items WHERE group_name=? AND subject=? "
        "ORDER BY idx DESC LIMIT 1",
        (group, subject)
    ).fetchone()
    if not row:
        return jsonify({"success": False, "error": "no items"}), 404

    conn.execute("DELETE FROM lab_items WHERE id=?", (row["id"],))
    _recalc_lab_progress(conn, group, subject)
    conn.commit()

    return jsonify({"success": True, "removed_id": row["id"]})


@bp.route("/api/lab_items/<int:item_id>", methods=["PUT", "DELETE"])
@limiter.limit("120 per minute")
def update_lab_item(item_id):
    conn = get_db()

    if request.method == "DELETE":
        row = conn.execute(
            "SELECT group_name, subject FROM lab_items WHERE id=?",
            (item_id,)
        ).fetchone()
        if not row:
            return jsonify({"success": True})
        conn.execute("DELETE FROM lab_items WHERE id=?", (item_id,))
        _recalc_lab_progress(conn, row["group_name"], row["subject"])
        conn.commit()
        return jsonify({"success": True})

    data = request.get_json(silent=True) or {}
    row = conn.execute(
        "SELECT group_name, subject, title, completed FROM lab_items WHERE id=?",
        (item_id,)
    ).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404

    new_title = data.get('title', row["title"])
    new_title = str(new_title).strip()[:200] if new_title is not None else row["title"]
    if not new_title:
        new_title = row["title"]

    new_completed = data.get('completed', row["completed"])
    try:
        new_completed = 1 if int(new_completed) else 0
    except (TypeError, ValueError):
        new_completed = int(row["completed"])

    conn.execute(
        "UPDATE lab_items SET title=?, completed=? WHERE id=?",
        (new_title, new_completed, item_id)
    )
    _recalc_lab_progress(conn, row["group_name"], row["subject"])
    conn.commit()
    return jsonify({"success": True, "title": new_title, "completed": new_completed})