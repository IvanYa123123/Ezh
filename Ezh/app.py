import os
import json
import time
import gzip
import re
import sqlite3
import secrets
import threading
import hashlib
from datetime import datetime, timezone
from urllib.parse import quote
from flask import Flask, render_template, request, jsonify, g, Response
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from planner import SevSUPlanner

app = Flask(__name__)
planner = SevSUPlanner()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "planner.db")
GROUPS_FILE = os.path.join(BASE_DIR, "Group.txt")
CUSTOM_GROUPS_FILE = os.path.join(BASE_DIR, "custom_groups.json")
SCHEDULES_DIR = os.path.join(BASE_DIR, "schedules")
SYNC_TIMES_FILE = os.path.join(BASE_DIR, ".sync_times.json")

MIN_SYNC_INTERVAL = 6 * 3600

os.makedirs(SCHEDULES_DIR, exist_ok=True)

# ============================================================
#  АУТЕНТИФИКАЦИЯ (опционально, через APP_TOKEN в env)
# ============================================================

APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
_AUTH_EXEMPT_PATHS = {"/", "/api/health"}


def _check_auth():
    if not APP_TOKEN:
        return True
    token = request.headers.get("X-Auth-Token") or request.args.get("token", "")
    return secrets.compare_digest(token, APP_TOKEN)


@app.before_request
def _enforce_auth():
    if not APP_TOKEN:
        return
    path = request.path or ""
    if path in _AUTH_EXEMPT_PATHS:
        return
    if path.startswith("/static/"):
        return
    if not _check_auth():
        return jsonify({"error": "unauthorized"}), 401


# ============================================================
#  RATE LIMITING
# ============================================================

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["300 per minute"],
    storage_uri="memory://",
    strategy="fixed-window",
)


# ============================================================
#  CSP NONCE
# ============================================================

@app.before_request
def _generate_csp_nonce():
    if request.path.startswith('/static/'):
        g.csp_nonce = ''
        return
    g.csp_nonce = secrets.token_urlsafe(16)


@app.context_processor
def _inject_csp_nonce():
    return {"csp_nonce": getattr(g, "csp_nonce", "")}


# ============================================================
#  GZIP + SECURITY HEADERS
# ============================================================

_GZIP_MIN_SIZE = 1024
_GZIP_TYPES = ('application/json', 'text/html', 'text/plain', 'text/css',
               'application/javascript', 'text/javascript', 'image/svg+xml')


@app.after_request
def _gzip_response(response):
    if (response.status_code < 200 or response.status_code >= 300
            or response.direct_passthrough
            or response.headers.get('Content-Encoding')):
        return response

    if 'gzip' not in request.headers.get('Accept-Encoding', ''):
        return response

    ctype = (response.content_type or '').split(';', 1)[0].strip().lower()
    if ctype not in _GZIP_TYPES:
        return response

    data = response.get_data()
    if len(data) < _GZIP_MIN_SIZE:
        return response

    compressed = gzip.compress(data, compresslevel=5)
    if len(compressed) >= len(data):
        return response

    response.set_data(compressed)
    response.headers['Content-Encoding'] = 'gzip'
    response.headers['Content-Length'] = str(len(compressed))
    response.headers.add('Vary', 'Accept-Encoding')
    return response


@app.after_request
def _security_headers(response):
    nonce = getattr(g, "csp_nonce", "")

    script_src = "script-src 'self' https://cdn.jsdelivr.net"
    if nonce:
        script_src = f"script-src 'self' 'nonce-{nonce}' https://cdn.jsdelivr.net"

    csp_parts = [
        "default-src 'self'",
        script_src,
        "script-src-attr 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
    response.headers['Content-Security-Policy'] = "; ".join(csp_parts)
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    response.headers.pop('Server', None)

    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-cache'

    return response


# ============================================================
#  БАЗА ДАННЫХ
# ============================================================

_db_init_lock = threading.Lock()
_db_ready = False


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_FILE, timeout=30)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout = 5000")
        g.db.execute("PRAGMA cache_size = -64000")
        g.db.execute("PRAGMA mmap_size = 268435456")
        g.db.execute("PRAGMA temp_store = MEMORY")
        g.db.execute("PRAGMA synchronous = NORMAL")
    return g.db


@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def _column_exists(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def _add_column_if_missing(conn, table, column, ddl):
    if not _column_exists(conn, table, column):
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e).lower():
                raise


def init_db(retries: int = 5):
    last_err = None
    for attempt in range(retries):
        try:
            with sqlite3.connect(DB_FILE, timeout=30) as conn:
                conn.execute("PRAGMA journal_mode = WAL")
                conn.execute("PRAGMA synchronous = NORMAL")
                conn.execute("PRAGMA mmap_size = 268435456")
                conn.execute("PRAGMA temp_store = MEMORY")
                conn.execute("PRAGMA cache_size = -64000")

                conn.execute('''CREATE TABLE IF NOT EXISTS tasks
                                (id INTEGER PRIMARY KEY AUTOINCREMENT,
                                 date TEXT NOT NULL,
                                 text TEXT NOT NULL,
                                 status TEXT NOT NULL DEFAULT 'green')''')

                conn.execute('''CREATE TABLE IF NOT EXISTS lab_progress
                                (group_name TEXT NOT NULL,
                                 subject TEXT NOT NULL,
                                 completed INTEGER NOT NULL DEFAULT 0,
                                 total INTEGER NOT NULL DEFAULT 0,
                                 PRIMARY KEY(group_name, subject))''')

                conn.execute('''CREATE TABLE IF NOT EXISTS lab_items
                                (id INTEGER PRIMARY KEY AUTOINCREMENT,
                                 group_name TEXT NOT NULL,
                                 subject TEXT NOT NULL,
                                 idx INTEGER NOT NULL,
                                 title TEXT NOT NULL,
                                 completed INTEGER NOT NULL DEFAULT 0,
                                 UNIQUE(group_name, subject, idx))''')

                conn.execute('''CREATE TABLE IF NOT EXISTS friends
                                (id INTEGER PRIMARY KEY AUTOINCREMENT,
                                 name TEXT NOT NULL,
                                 group_name TEXT NOT NULL,
                                 subgroup TEXT NOT NULL DEFAULT '0',
                                 category TEXT DEFAULT 'Мои друзья')''')

                conn.execute('''CREATE TABLE IF NOT EXISTS subject_settings
                                (subject TEXT PRIMARY KEY,
                                 custom_name TEXT,
                                 link TEXT)''')

                conn.execute('''CREATE TABLE IF NOT EXISTS custom_schedule
                                (id INTEGER PRIMARY KEY AUTOINCREMENT,
                                 group_name TEXT,
                                 base_date TEXT,
                                 time_range TEXT,
                                 lesson TEXT,
                                 type_name TEXT,
                                 teacher TEXT,
                                 location TEXT,
                                 is_event INTEGER,
                                 recurrence TEXT,
                                 exceptions TEXT DEFAULT '[]')''')

                _add_column_if_missing(conn, "subject_settings", "teacher", "TEXT")
                _add_column_if_missing(conn, "subject_settings", "location", "TEXT")
                _add_column_if_missing(conn, "friends", "category", "TEXT DEFAULT 'Мои друзья'")
                _add_column_if_missing(conn, "custom_schedule", "exceptions", "TEXT DEFAULT '[]'")

                conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_date_status ON tasks(date, status)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_friends_category ON friends(category)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_lab_group ON lab_progress(group_name)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_lab_items_group ON lab_items(group_name, subject)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_custom_group ON custom_schedule(group_name)")
                conn.commit()
                return
        except sqlite3.OperationalError as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(0.2 * (attempt + 1))
            else:
                raise
    if last_err:
        raise last_err


@app.before_request
def _ensure_db_initialized():
    global _db_ready
    if _db_ready:
        return
    with _db_init_lock:
        if not _db_ready:
            init_db()
            _db_ready = True


# ============================================================
#  КЭШИРОВАНИЕ ФАЙЛОВ (mtime-based)
# ============================================================

class _MtimeJsonCache:
    __slots__ = ('path', 'lock', '_mtime', '_value', '_loaded')

    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self._mtime = None
        self._value = None
        self._loaded = False

    def _mtime_now(self):
        try:
            return os.path.getmtime(self.path)
        except OSError:
            return None

    def read(self, default_factory=list):
        mt = self._mtime_now()
        with self.lock:
            if not self._loaded or mt != self._mtime:
                if mt is None:
                    self._value = default_factory()
                else:
                    try:
                        with open(self.path, 'r', encoding='utf-8') as f:
                            self._value = json.load(f)
                    except (json.JSONDecodeError, OSError):
                        self._value = default_factory()
                self._mtime = mt
                self._loaded = True
            return self._value

    def write(self, value, ensure_ascii=False, indent=None):
        with self.lock:
            try:
                tmp = self.path + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(value, f, ensure_ascii=ensure_ascii, indent=indent)
                os.replace(tmp, self.path)
                self._value = value
                self._mtime = self._mtime_now()
                self._loaded = True
            except OSError:
                pass


_custom_groups_cache = _MtimeJsonCache(CUSTOM_GROUPS_FILE)

_groups_txt_lock = threading.RLock()
_groups_txt_mtime = None
_groups_txt_data = None
_groups_txt_loaded = False


def _read_groups_txt():
    global _groups_txt_mtime, _groups_txt_data, _groups_txt_loaded
    try:
        mt = os.path.getmtime(GROUPS_FILE)
    except OSError:
        mt = None
    with _groups_txt_lock:
        if not _groups_txt_loaded or mt != _groups_txt_mtime:
            if mt is None:
                _groups_txt_data = []
            else:
                names = []
                seen = set()
                try:
                    with open(GROUPS_FILE, 'r', encoding='utf-8') as f:
                        for line in f:
                            name = line.strip()
                            if name and name not in seen:
                                seen.add(name)
                                names.append(name)
                except OSError:
                    pass
                _groups_txt_data = names
            _groups_txt_mtime = mt
            _groups_txt_loaded = True
        return _groups_txt_data


# ============================================================
#  ВАЛИДАЦИЯ
# ============================================================

_VALID_SUBGROUPS = frozenset(("0", "1", "2"))

_GROUP_RE = re.compile(r'^[A-Za-zА-Яа-яЁё0-9/._\-]{1,64}$')

_FORBIDDEN_CHARS = str.maketrans({
    '/': '_', '\\': '_', ':': '_', '*': '_', '?': '_',
    '"': '_', '<': '_', '>': '_', '|': '_'
})


def validate_subgroup(raw) -> str:
    s = str(raw if raw is not None else "0").strip()
    return s if s in _VALID_SUBGROUPS else "0"


def validate_group(raw) -> str:
    s = str(raw or "").strip()
    if not s:
        raise ValueError("group required")
    if len(s) > 64:
        raise ValueError("group too long")
    if not _GROUP_RE.match(s):
        raise ValueError("invalid group format")
    return s


def make_safe_filename(name):
    result = str(name).translate(_FORBIDDEN_CHARS)
    result = result.replace('..', '__').strip('. ')
    return (result or '_')[:120]


def load_custom_groups():
    data = _custom_groups_cache.read(default_factory=list)
    if isinstance(data, list):
        return [str(x).strip() for x in data if str(x).strip()]
    return []


def save_custom_groups(groups):
    _custom_groups_cache.write(groups, ensure_ascii=False, indent=2)


def load_local_groups():
    groups = list(_read_groups_txt())
    seen = set(groups)
    for name in load_custom_groups():
        if name and name not in seen:
            seen.add(name)
            groups.append(name)
    return groups


# ============================================================
#  ТРОТТЛИНГ СИНХРОНИЗАЦИИ
# ============================================================

_sync_times_cache = _MtimeJsonCache(SYNC_TIMES_FILE)


def _needs_sync(key):
    data = _sync_times_cache.read(default_factory=dict)
    last = data.get(key, 0) if isinstance(data, dict) else 0
    return (time.time() - last) > MIN_SYNC_INTERVAL


def _mark_synced(key):
    cache = _sync_times_cache
    with cache.lock:
        data = cache.read(default_factory=dict)
        if not isinstance(data, dict):
            data = {}
        data[key] = time.time()
        cache.write(data)


# ============================================================
#  HEALTHCHECK
# ============================================================

@app.route("/api/health")
def health():
    return jsonify({"ok": True})


# ============================================================
#  РОУТЫ
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/groups")
def get_groups():
    local_groups = load_local_groups()
    if local_groups:
        resp = jsonify(local_groups)
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp

    try:
        params = {"v": "6.2", "section": "0"}
        r = planner.session.get(planner.groups_api, params=params, timeout=5)
        if r.status_code == 200:
            try:
                resp = jsonify(r.json())
                resp.headers['Cache-Control'] = 'public, max-age=3600'
                return resp
            except ValueError:
                pass
    except Exception:
        pass
    return jsonify([])


@app.route("/api/groups/custom", methods=["POST"])
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


@app.route("/api/schedule_all")
@limiter.limit("60 per minute")
def get_schedule_all():
    raw_group = request.args.get('group')
    try:
        group = validate_group(raw_group)
    except ValueError:
        return jsonify([])
    subgroup = validate_subgroup(request.args.get('subgroup', '0'))

    safe_group = make_safe_filename(group)
    cache_file = os.path.join(SCHEDULES_DIR, f"{safe_group}_{subgroup}.json")

    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                return jsonify(json.load(f))
        except (json.JSONDecodeError, OSError):
            pass

    schedule = planner.get_semester_schedule(group, subgroup)
    if schedule:
        try:
            tmp = cache_file + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(schedule, f, ensure_ascii=False)
            os.replace(tmp, cache_file)
        except OSError:
            pass
    return jsonify(schedule)


@app.route("/api/schedule_sync")
@limiter.limit("10 per minute")
def sync_schedule():
    raw_group = request.args.get('group')
    try:
        group = validate_group(raw_group)
    except ValueError:
        return jsonify([])
    subgroup = validate_subgroup(request.args.get('subgroup', '0'))

    force = request.args.get('force') == '1'
    sync_key = f"{group}_{subgroup}"

    if not force and not _needs_sync(sync_key):
        return jsonify([])

    schedule = planner.get_semester_schedule(group, subgroup)
    safe_group = make_safe_filename(group)
    cache_file = os.path.join(SCHEDULES_DIR, f"{safe_group}_{subgroup}.json")

    if schedule:
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    old_schedule = json.load(f)
                if len(schedule) < len(old_schedule) * 0.9:
                    print(f"[Защита] Отмена записи: получено {len(schedule)} пар, в кэше {len(old_schedule)}")
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

        _mark_synced(sync_key)
    else:
        if not os.path.exists(cache_file):
            _mark_synced(sync_key)

    return jsonify(schedule)


# ============================================================
#  ЛАБЫ — АГРЕГАТЫ (lab_progress)
# ============================================================

@app.route("/api/labs", methods=["GET", "POST"])
@limiter.limit("120 per minute")
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


# ============================================================
#  ЛАБЫ ПОШТУЧНО (lab_items)
# ============================================================

def _recalc_lab_progress(conn, group, subject):
    """Пересчитывает lab_progress из lab_items для одной пары (group, subject)."""
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


@app.route("/api/lab_items", methods=["GET"])
@limiter.limit("240 per minute")
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


@app.route("/api/lab_items/sync", methods=["POST"])
@limiter.limit("120 per minute")
def sync_lab_items():
    """Создаёт недостающие lab_items. Работает только «в плюс» —
    записи с idx > count НЕ удаляются (могут быть ручные добавления)."""
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


@app.route("/api/lab_items/add", methods=["POST"])
@limiter.limit("120 per minute")
def add_lab_item():
    """Добавляет одну запись в конец списка лаб/ПЗ предмета."""
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


@app.route("/api/lab_items/remove_last", methods=["POST"])
@limiter.limit("120 per minute")
def remove_last_lab_item():
    """Удаляет последнюю (по idx) запись лаб/ПЗ предмета."""
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


@app.route("/api/lab_items/<int:item_id>", methods=["PUT", "DELETE"])
@limiter.limit("240 per minute")
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


# ============================================================
#  ЗАДАЧИ
# ============================================================

@app.route("/api/tasks", methods=["GET", "POST"])
@limiter.limit("300 per minute")
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


@app.route("/api/tasks/<int:task_id>", methods=["PUT", "DELETE"])
@limiter.limit("300 per minute")
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


@app.route("/api/task_dates")
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


@app.route("/api/search")
@limiter.limit("240 per minute")
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
    return "\r\n".join(lines) + "\r\n"


# ============================================================
#  ЭКСПОРТ .ICS — c корректным кириллическим именем файла
# ------------------------------------------------------------
#  HTTP-заголовки кодируются latin-1. Кириллица в filename="..."
#  валит send_header с UnicodeEncodeError. Отдаём имя двумя
#  параметрами по RFC 6266:
#    • filename  — ASCII-фолбэк (кириллица → '_')
#    • filename* — UTF-8 percent-encoded (%D0%9F%D0%98%D0%9D...)
#  Современные браузеры читают filename*, старые — filename.
# ============================================================

@app.route("/api/schedule.ics")
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
    cache_file = os.path.join(SCHEDULES_DIR, f"{safe_group}_{subgroup}.json")
    cache_exists = os.path.exists(cache_file)
    print(f"[ics] START group={group!r} subgroup={subgroup} cache_exists={cache_exists}")

    schedule = []
    if cache_exists:
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                schedule = json.load(f)
            print(f"[ics] loaded from cache: {len(schedule)} items")
        except (json.JSONDecodeError, OSError) as e:
            print(f"[ics] cache read failed: {e}")
            schedule = []

    # Если кэша нет — не идём в СевГУ (иначе 5–15 сек ожидания).
    if not schedule:
        print(f"[ics] no cache — returning 409")
        return Response(
            "Расписание ещё не загружено. Откройте группу в календаре — данные подтянутся из СевГУ, затем скачивайте .ics.",
            status=409,
            mimetype='text/plain; charset=utf-8'
        )

    ics_text = _generate_ics(schedule, group)
    filename = f"schedule_{safe_group}_{subgroup}.ics"
    elapsed = time.time() - t0
    print(f"[ics] DONE in {elapsed:.2f}s, size={len(ics_text)} bytes, filename={filename}")

    # ASCII-фолбэк: кириллица и прочие не-ASCII → '_'. Это гарантирует,
    # что заголовок закодируется в latin-1 без ошибок.
    ascii_filename = filename.encode('ascii', 'replace').decode('ascii').replace('?', '_')

    # UTF-8 percent-encoded — настоящая кириллица. Браузер прочитает
    # её из filename* и покажет в диалоге сохранения.
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
#  ДРУЗЬЯ
# ============================================================

@app.route("/api/friends", methods=["GET", "POST"])
@limiter.limit("120 per minute")
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


@app.route("/api/friends/<int:friend_id>", methods=["PUT", "DELETE"])
@limiter.limit("120 per minute")
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
#  НАСТРОЙКИ ПРЕДМЕТОВ
# ============================================================

@app.route("/api/subjects", methods=["GET", "POST"])
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

@app.route("/api/custom_schedule", methods=["GET", "POST"])
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


@app.route("/api/custom_schedule/<int:item_id>", methods=["PUT", "DELETE"])
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


# ============================================================
#  ЗАПУСК
# ============================================================

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="127.0.0.1", port=5000)