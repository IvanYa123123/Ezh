"""Друзья, преподаватели, отслеживаемые преподаватели."""
import sqlite3

from flask import Blueprint, jsonify, request

from . import runtime
from .common import validate_group, validate_slug
from .db import get_db
from .extensions import limiter


bp = Blueprint('people', __name__)


def _safe_print(*args, **kwargs):
    try:
        import sys
        if sys.stdout is not None:
            print(*args, **kwargs)
    except Exception:
        pass


# ============================================================
#  ДРУЗЬЯ
# ============================================================

@bp.route("/api/friends", methods=["GET", "POST"])
@limiter.limit("60 per minute")
def manage_friends():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        group = (data.get('group') or '').strip()
        subgroup = str(data.get('subgroup', '0'))
        category = (data.get('category') or '').strip()

        if not name or not group:
            return jsonify({"error": "name and group required"}), 400
        if len(name) > 100 or len(category) > 100:
            return jsonify({"error": "field too long"}), 400
        try:
            group = validate_group(group)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        cursor = conn.execute(
            "INSERT INTO friends (name, group_name, subgroup, category) VALUES (?, ?, ?, ?)",
            (name, group, subgroup, category)
        )
        conn.commit()
        return jsonify({"id": cursor.lastrowid})

    cursor = conn.execute("SELECT id, name, group_name, subgroup, category FROM friends")
    friends = [{"id": row["id"], "name": row["name"], "group": row["group_name"],
                "subgroup": row["subgroup"], "category": row["category"] or ""}
               for row in cursor.fetchall()]
    return jsonify(friends)


@bp.route("/api/friends/<int:friend_id>", methods=["PUT", "DELETE"])
@limiter.limit("60 per minute")
def update_or_delete_friend(friend_id):
    conn = get_db()

    if request.method == "PUT":
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        group = (data.get('group') or '').strip()
        subgroup = str(data.get('subgroup', '0'))
        category = (data.get('category') or '').strip()

        if not name or not group:
            return jsonify({"error": "name and group required"}), 400
        try:
            group = validate_group(group)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        conn.execute(
            "UPDATE friends SET name=?, group_name=?, subgroup=?, category=? WHERE id=?",
            (name, group, subgroup, category, friend_id)
        )
        conn.commit()
        return jsonify({"success": True})

    conn.execute("DELETE FROM friends WHERE id=?", (friend_id,))
    conn.commit()
    return jsonify({"success": True})


# ============================================================
#  ПРЕПОДАВАТЕЛИ
# ============================================================

@bp.route("/api/teachers")
@limiter.limit("30 per minute")
def get_teachers():
    force = request.args.get('force') == '1'
    try:
        items = runtime.teacher_planner.get_teachers(force=force)
    except Exception as e:
        _safe_print(f"[teachers] error: {e}", flush=True)
        items = []
    resp = jsonify(items)
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@bp.route("/api/teacher_schedule")
@limiter.limit("30 per minute")
def get_teacher_schedule():
    slug = (request.args.get('slug') or '').strip()
    if not slug:
        return jsonify([])
    try:
        slug = validate_slug(slug)
    except ValueError:
        return jsonify([])
    force = request.args.get('force') == '1'
    try:
        schedule = runtime.teacher_planner.get_teacher_schedule(slug, force=force)
    except Exception as e:
        _safe_print(f"[teacher_schedule] error: {e}", flush=True)
        schedule = []
    return jsonify(schedule)


# ============================================================
#  ОТСЛЕЖИВАЕМЫЕ ПРЕПОДАВАТЕЛИ
# ============================================================

@bp.route("/api/tracked_teachers", methods=["GET", "POST"])
@limiter.limit("60 per minute")
def manage_tracked_teachers():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        slug = (data.get('slug') or '').strip().lower()
        if not name or not slug:
            return jsonify({"error": "name and slug required"}), 400
        try:
            slug = validate_slug(slug)
        except ValueError:
            return jsonify({"error": "invalid slug"}), 400
        if len(name) > 200:
            return jsonify({"error": "name too long"}), 400

        try:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO tracked_teachers (name, slug) VALUES (?, ?)",
                (name, slug)
            )
            conn.commit()
            if cursor.lastrowid:
                return jsonify({"id": cursor.lastrowid, "name": name, "slug": slug})
            row = conn.execute(
                "SELECT id FROM tracked_teachers WHERE slug=?", (slug,)
            ).fetchone()
            return jsonify({"id": row["id"], "name": name, "slug": slug, "already": True})
        except sqlite3.Error as e:
            return jsonify({"error": str(e)}), 500

    cursor = conn.execute("SELECT id, name, slug FROM tracked_teachers ORDER BY id")
    items = [{"id": r["id"], "name": r["name"], "slug": r["slug"]} for r in cursor.fetchall()]
    return jsonify(items)


@bp.route("/api/tracked_teachers/<int:item_id>", methods=["DELETE"])
@limiter.limit("60 per minute")
def delete_tracked_teacher(item_id):
    conn = get_db()
    conn.execute("DELETE FROM tracked_teachers WHERE id=?", (item_id,))
    conn.commit()
    return jsonify({"success": True})