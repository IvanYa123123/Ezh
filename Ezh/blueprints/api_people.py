"""Друзья, преподаватели, отслеживаемые преподаватели."""
import sqlite3

from flask import Blueprint, jsonify, request

from . import runtime
from .common import validate_group, validate_slug, validate_subgroup
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

def _parse_friend_payload(data, current=None):
    """Общая валидация создания и редактирования друга.

    Раньше PUT не проверял длину полей и подгруппу, поэтому через
    правку можно было записать имя длиной в мегабайт или subgroup="abc"
    (POST такое уже отсекал) — и карточка друга ломала рендер.

    current — сохранённая строка для PUT: поля, которых нет в запросе,
    берутся из неё, иначе частичное обновление (например, только
    категория) падало с "name and group required". group_name — алиас
    group: GET отдаёт именно group_name, и клиент вправе прислать его
    обратно.
    """
    base = dict(current or {})
    name = str(data.get('name', base.get('name')) or '').strip()
    group = str(
        data.get('group', data.get('group_name', base.get('group_name')))
        or ''
    ).strip()
    subgroup = validate_subgroup(data.get('subgroup', base.get('subgroup') or '0'))
    category = str(data.get('category', base.get('category')) or '').strip()

    if not name or not group:
        return None, "name and group required"
    if len(name) > 100 or len(category) > 100:
        return None, "field too long"
    try:
        group = validate_group(group)
    except ValueError as e:
        return None, str(e)
    return {"name": name, "group": group, "subgroup": subgroup, "category": category}, None


@bp.route("/api/friends", methods=["GET", "POST"])
@limiter.limit("60 per minute")
def manage_friends():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        payload, error = _parse_friend_payload(data)
        if error:
            return jsonify({"error": error}), 400

        cursor = conn.execute(
            "INSERT INTO friends (name, group_name, subgroup, category) VALUES (?, ?, ?, ?)",
            (payload['name'], payload['group'], payload['subgroup'], payload['category'])
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
        row = conn.execute(
            "SELECT name, group_name, subgroup, category FROM friends WHERE id=?",
            (friend_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        payload, error = _parse_friend_payload(data, current=dict(row))
        if error:
            return jsonify({"error": error}), 400

        conn.execute(
            "UPDATE friends SET name=?, group_name=?, subgroup=?, category=? WHERE id=?",
            (payload['name'], payload['group'], payload['subgroup'], payload['category'], friend_id)
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
            # cursor.lastrowid после INSERT OR IGNORE ненадёжен: при
            # конфликте он возвращает rowid предыдущей вставки (или 0),
            # поэтому «уже добавлен» определяем явным SELECT.
            existing = conn.execute(
                "SELECT id FROM tracked_teachers WHERE slug=?", (slug,)
            ).fetchone()
            if existing is not None:
                return jsonify({"id": existing["id"], "name": name, "slug": slug, "already": True})

            cursor = conn.execute(
                "INSERT INTO tracked_teachers (name, slug) VALUES (?, ?)",
                (name, slug)
            )
            conn.commit()
            return jsonify({"id": cursor.lastrowid, "name": name, "slug": slug})
        except sqlite3.IntegrityError:
            row = conn.execute(
                "SELECT id FROM tracked_teachers WHERE slug=?", (slug,)
            ).fetchone()
            if row is not None:
                return jsonify({"id": row["id"], "name": name, "slug": slug, "already": True})
            return jsonify({"error": "cannot add teacher"}), 500
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