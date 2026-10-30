"""Корневые эндпоинты: /, /api/health, /api/groups, /api/groups/custom,
резервная копия и восстановление базы."""
import time

from flask import Blueprint, jsonify, render_template, request

from . import runtime
from .common import validate_group, load_local_groups, load_custom_groups, save_custom_groups
from .db import get_db
from .extensions import limiter


bp = Blueprint('core', __name__)


def _safe_print(*args, **kwargs):
    try:
        import sys
        if sys.stdout is not None:
            print(*args, **kwargs)
    except Exception:
        pass


@bp.route("/")
def index():
    return render_template("index.html")


@bp.route("/api/health")
def health():
    return jsonify({"ok": True, "version": runtime.APP_VERSION})


@bp.route("/api/groups")
@limiter.limit("60 per minute")
def get_groups():
    local_groups = load_local_groups()
    if local_groups:
        resp = jsonify(local_groups)
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp

    # Локального справочника нет — пробуем API СевГУ.
    # Любая ошибка сети здесь НЕ должна ронять весь /api/groups:
    # группа автокомплита просто останется пустой.
    try:
        params = {"v": "6.2", "section": "0"}
        r = runtime.planner.session.get(runtime.planner.groups_api, params=params, timeout=5)
        if r.status_code == 200:
            try:
                resp = jsonify(r.json())
                resp.headers['Cache-Control'] = 'public, max-age=3600'
                return resp
            except ValueError:
                _safe_print("[groups] API вернул не JSON", flush=True)
    except Exception as e:
        _safe_print(f"[groups] ошибка запроса к СевГУ: {e}", flush=True)
    return jsonify([])


@bp.route("/api/groups/custom", methods=["POST"])
@limiter.limit("30 per minute")
def add_custom_group():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"success": False, "error": "empty name"}), 400
    try:
        name = validate_group(name)
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    existing = load_local_groups()
    if any(g.lower() == name.lower() for g in existing):
        return jsonify({"success": True, "already": True})

    custom = load_custom_groups()
    if not any(g.lower() == name.lower() for g in custom):
        custom.append(name)
        save_custom_groups(custom)

    return jsonify({"success": True})


# ============================================================
#  РЕЗЕРВНАЯ КОПИЯ / ВОССТАНОВЛЕНИЕ
# ------------------------------------------------------------
#  Один JSON-файл со всеми пользовательскими данными. Кэши СевГУ
#  (schedules/, teacher_schedules/) сюда не входят: они восстанавливаются
#  с сервера. Внутри — только то, что нельзя скачать заново.
# ============================================================

_BACKUP_APP_ID = "EZHednevnik"

_BACKUP_TABLES = {
    'tasks': ('id', 'date', 'text', 'status'),
    'friends': ('id', 'name', 'group_name', 'subgroup', 'category'),
    'lab_progress': ('group_name', 'subject', 'completed', 'total'),
    'lab_items': ('id', 'group_name', 'subject', 'idx', 'title', 'completed'),
    'subject_settings': ('subject', 'custom_name', 'link', 'teacher', 'location'),
    'custom_schedule': (
        'id', 'group_name', 'base_date', 'time_range', 'lesson', 'type_name',
        'teacher', 'location', 'is_event', 'recurrence', 'exceptions',
    ),
    'tracked_teachers': ('id', 'name', 'slug'),
}

_BACKUP_INT_COLUMNS = frozenset(('id', 'idx', 'completed', 'total', 'is_event'))

# Лимиты, чтобы битый файл не разнёс БД и не подвесил SQLite.
_BACKUP_MAX_ROWS_PER_TABLE = 20000
_BACKUP_MAX_TEXT = 4000


def _coerce_backup_value(column, value):
    if column in _BACKUP_INT_COLUMNS:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0
    if value is None:
        return ''
    return str(value)[:_BACKUP_MAX_TEXT]


@bp.route("/api/backup", methods=["GET", "POST"])
@limiter.limit("15 per minute")
def backup():
    conn = get_db()

    if request.method == "POST":
        return _restore_backup(conn)

    tables = {}
    for table, columns in _BACKUP_TABLES.items():
        cursor = conn.execute(f"SELECT {', '.join(columns)} FROM {table}")
        tables[table] = [dict(row) for row in cursor.fetchall()]

    return jsonify({
        "app": _BACKUP_APP_ID,
        "version": runtime.APP_VERSION,
        "format": 1,
        "exported_at": int(time.time()),
        "custom_groups": load_custom_groups(),
        "tables": tables,
    })


def _restore_backup(conn):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "invalid json"}), 400

    # Принимаем и обёрнутый {"tables": {...}}, и «плоский» вариант.
    tables = data.get('tables') if isinstance(data.get('tables'), dict) else data
    if not isinstance(tables, dict):
        return jsonify({"success": False, "error": "no tables in backup"}), 400

    restored = {}
    try:
        for table, columns in _BACKUP_TABLES.items():
            rows = tables.get(table)
            if rows is None:
                continue  # таблицы нет в файле — не трогаем
            if not isinstance(rows, list):
                return jsonify({"success": False, "error": f"{table}: expected list"}), 400

            conn.execute(f"DELETE FROM {table}")
            placeholders = ', '.join('?' * len(columns))
            sql = f"INSERT OR REPLACE INTO {table} ({', '.join(columns)}) VALUES ({placeholders})"

            inserted = 0
            for row in rows[:_BACKUP_MAX_ROWS_PER_TABLE]:
                if not isinstance(row, dict):
                    continue
                values = [_coerce_backup_value(col, row.get(col)) for col in columns]
                conn.execute(sql, values)
                inserted += 1
            restored[table] = inserted

        groups = data.get('custom_groups')
        if isinstance(groups, list):
            cleaned = []
            for name in groups[:500]:
                try:
                    cleaned.append(validate_group(str(name)))
                except ValueError:
                    continue
            save_custom_groups(cleaned)
            restored['custom_groups'] = len(cleaned)

        conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        _safe_print(f"[backup] restore failed: {e}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

    _safe_print(f"[backup] restore ok: {restored}", flush=True)
    return jsonify({"success": True, "restored": restored})
