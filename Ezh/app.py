import os
import sys
import json
import time
import gzip
import re
import sqlite3
import secrets
import threading
import hashlib
import subprocess
import tempfile
import socket
import base64
from datetime import datetime, timezone
from urllib.parse import quote
from flask import Flask, render_template, request, jsonify, g, Response
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from planner import SevSUPlanner
from teacher_planner import SevSUTeacherPlanner

# ============================================================
#  ОПРЕДЕЛЕНИЕ ПУТЕЙ
# ============================================================

IS_EXE = getattr(sys, 'frozen', False)

if IS_EXE and hasattr(sys, '_MEIPASS'):
    BASE_DIR   = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS
else:
    BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = BASE_DIR

DB_FILE            = os.path.join(BASE_DIR, "planner.db")
SCHEDULES_DIR      = os.path.join(BASE_DIR, "schedules")
CUSTOM_GROUPS_FILE = os.path.join(BASE_DIR, "custom_groups.json")
SYNC_TIMES_FILE    = os.path.join(BASE_DIR, ".sync_times.json")

GROUPS_FILE        = os.path.join(BUNDLE_DIR, "Group.txt")
TEMPLATES_DIR      = os.path.join(BUNDLE_DIR, "templates")
STATIC_DIR         = os.path.join(BUNDLE_DIR, "static")

_CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

def _safe_print(*args, **kwargs):
    try:
        if sys.stdout is not None:
            print(*args, **kwargs)
    except Exception:
        pass

# ============================================================
#  ВЕРСИЯ ПРИЛОЖЕНИЯ
# ============================================================

APP_VERSION = "dev"

def _read_app_version():
    try:
        with open(os.path.join(BASE_DIR, "VERSION"), "r", encoding="utf-8") as f:
            v = f.read().strip()
            if v:
                return v
    except OSError:
        pass
    return "dev"

APP_VERSION = _read_app_version()
_safe_print(f"[version] {APP_VERSION} (BASE_DIR = {BASE_DIR})", flush=True)

# ============================================================
#  FLASK
# ============================================================

app = Flask(
    __name__,
    template_folder=TEMPLATES_DIR,
    static_folder=STATIC_DIR,
    static_url_path='/static',
)
planner = SevSUPlanner()
teacher_planner = SevSUTeacherPlanner(BASE_DIR)

try:
    teacher_planner.start_background_refresh(interval_hours=6)
except Exception as _e:
    _safe_print(f"[teacher_bg] не удалось запустить: {_e}", flush=True)

MIN_SYNC_INTERVAL = 6 * 3600

os.makedirs(SCHEDULES_DIR, exist_ok=True)

# ============================================================
#  АУТЕНТИФИКАЦИЯ
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
#  CSP NONCE + VERSION
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

@app.context_processor
def _inject_app_version():
    return {"app_version": APP_VERSION}

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
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

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
                conn.execute('''CREATE TABLE IF NOT EXISTS tracked_teachers
                                (id INTEGER PRIMARY KEY AUTOINCREMENT,
                                 name TEXT NOT NULL,
                                 slug TEXT NOT NULL UNIQUE)''')
                conn.execute('''CREATE TABLE IF NOT EXISTS _meta
                                (key TEXT PRIMARY KEY,
                                 value TEXT)''')

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
                conn.execute("CREATE INDEX IF NOT EXISTS idx_tracked_slug ON tracked_teachers(slug)")
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
    # ============================================================
#  МИГРАЦИЯ ПЗ ↔ ЛЗ
# ============================================================

_MIGRATION_PS_LZ_KEY = 'ps_lz_swap_v1'

def _swap_ps_lz_suffix(subject):
    if not subject or '(' not in subject or not subject.endswith(')'):
        return subject
    i = subject.rfind('(')
    base = subject[:i].rstrip()
    suffix = subject[i + 1:-1].strip()
    if suffix == 'ЛЗ':
        return f"{base} (ПЗ)"
    if suffix == 'ПЗ':
        return f"{base} (ЛЗ)"
    return subject

def _migrate_ps_lz_swap():
    conn = sqlite3.connect(DB_FILE, timeout=30)
    try:
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)")

        row = conn.execute("SELECT value FROM _meta WHERE key=?", (_MIGRATION_PS_LZ_KEY,)).fetchone()
        if row:
            return

        _safe_print("[migration] инвертирую ПЗ/ЛЗ в кэшах и таблицах лаб...", flush=True)

        swapped_files = 0
        try:
            filenames = [f for f in os.listdir(SCHEDULES_DIR) if f.endswith('.json')]
        except OSError:
            filenames = []

        for fname in filenames:
            path = os.path.join(SCHEDULES_DIR, fname)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, list):
                continue

            changed = False
            for item in data:
                tn = item.get('type_name')
                if tn == 'ЛЗ':
                    item['type_name'] = 'ПЗ'
                    changed = True
                elif tn == 'ПЗ':
                    item['type_name'] = 'ЛЗ'
                    changed = True

            if not changed:
                continue

            try:
                tmp = path + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False)
                os.replace(tmp, path)
                swapped_files += 1
            except OSError as e:
                _safe_print(f"[migration] не удалось перезаписать {fname}: {e}", flush=True)

        lab_items_changed = 0
        rows = conn.execute("SELECT id, subject FROM lab_items").fetchall()
        for r in rows:
            new_subj = _swap_ps_lz_suffix(r[1])
            if new_subj != r[1]:
                conn.execute("UPDATE lab_items SET subject=? WHERE id=?", (new_subj, r[0]))
                lab_items_changed += 1

        lab_progress_changed = 0
        rows = conn.execute("SELECT group_name, subject, completed, total FROM lab_progress").fetchall()
        for r in rows:
            new_subj = _swap_ps_lz_suffix(r[1])
            if new_subj != r[1]:
                conn.execute(
                    "DELETE FROM lab_progress WHERE group_name=? AND subject=?",
                    (r[0], r[1])
                )
                conn.execute(
                    "INSERT OR REPLACE INTO lab_progress (group_name, subject, completed, total) "
                    "VALUES (?, ?, ?, ?)",
                    (r[0], new_subj, r[2], r[3])
                )
                lab_progress_changed += 1

        conn.execute(
            "INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)",
            (_MIGRATION_PS_LZ_KEY, str(int(time.time())))
        )
        conn.commit()
        _safe_print(
            f"[migration] готово: schedules={swapped_files}, "
            f"lab_items={lab_items_changed}, lab_progress={lab_progress_changed}",
            flush=True,
        )
    except sqlite3.Error as e:
        _safe_print(f"[migration] ошибка: {e}", flush=True)
    finally:
        conn.close()

@app.before_request
def _ensure_db_initialized():
    global _db_ready
    if _db_ready:
        return
    with _db_init_lock:
        if not _db_ready:
            init_db()
            _migrate_ps_lz_swap()
            _db_ready = True

# ============================================================
#  КЭШИРОВАНИЕ ФАЙЛОВ
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
_SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9\-]{0,80}[a-z0-9]$')

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
    return jsonify({"ok": True, "version": APP_VERSION})

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

# ============================================================
#  РАСПИСАНИЕ ПРЕПОДАВАТЕЛЕЙ
# ============================================================

@app.route("/api/teachers")
@limiter.limit("60 per minute")
def get_teachers():
    force = request.args.get('force') == '1'
    try:
        items = teacher_planner.get_teachers(force=force)
    except Exception as e:
        _safe_print(f"[teachers] error: {e}", flush=True)
        items = []
    resp = jsonify(items)
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp

@app.route("/api/teacher_schedule")
@limiter.limit("60 per minute")
def get_teacher_schedule():
    slug = (request.args.get('slug') or '').strip()
    if not slug:
        return jsonify([])
    force = request.args.get('force') == '1'
    try:
        schedule = teacher_planner.get_teacher_schedule(slug, force=force)
    except Exception as e:
        _safe_print(f"[teacher_schedule] error: {e}", flush=True)
        schedule = []
    return jsonify(schedule)

# ============================================================
#  ОТСЛЕЖИВАЕМЫЕ ПРЕПОДАВАТЕЛИ
# ============================================================

@app.route("/api/tracked_teachers", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def manage_tracked_teachers():
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        slug = (data.get('slug') or '').strip().lower()
        if not name or not slug:
            return jsonify({"error": "name and slug required"}), 400
        if not _SLUG_RE.match(slug):
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

@app.route("/api/tracked_teachers/<int:item_id>", methods=["DELETE"])
@limiter.limit("120 per minute")
def delete_tracked_teacher(item_id):
    conn = get_db()
    conn.execute("DELETE FROM tracked_teachers WHERE id=?", (item_id,))
    conn.commit()
    return jsonify({"success": True})

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
                    _safe_print(f"[Защита] Отмена записи: получено {len(schedule)} пар, в кэше {len(old_schedule)}", flush=True)
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
#  ЛАБЫ
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
    _safe_print(f"[ics] DONE in {elapsed:.2f}s, size={len(ics_text)} bytes, filename={filename}", flush=True)

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
#  ОБЩИЕ УТИЛИТЫ ЗАПУСКА
# ============================================================

def _find_free_port(preferred: int = 5000) -> int:
    for p in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return preferred

def _get_desktop_dir() -> str:
    home = os.path.expanduser('~')
    desktop = os.path.join(home, 'Desktop')
    onedrive_desktop = os.path.join(home, 'OneDrive', 'Desktop')
    if os.path.isdir(onedrive_desktop):
        return onedrive_desktop
    return desktop

def _create_desktop_shortcut() -> bool:
    if sys.platform != 'win32':
        return False
    if not IS_EXE:
        return False

    exe_path = sys.executable
    exe_dir = os.path.dirname(exe_path)
    desktop = _get_desktop_dir()
    shortcut_path = os.path.join(desktop, 'EZHednevnik.lnk')

    ps_script = (
        '$ErrorActionPreference = "Stop"; '
        '$ws = New-Object -ComObject WScript.Shell; '
        f'$s = $ws.CreateShortcut("{shortcut_path}"); '
        f'$s.TargetPath = "{exe_path}"; '
        f'$s.WorkingDirectory = "{exe_dir}"; '
        f'$s.IconLocation = "{exe_path},0"; '
        '$s.Description = "EZHednevnik - дневник студента СевГУ"; '
        '$s.Save(); '
        'exit 0'
    )

    try:
        encoded = base64.b64encode(ps_script.encode('utf-16-le')).decode('ascii')
        result = subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
             '-EncodedCommand', encoded],
            capture_output=True, timeout=25, text=True,
            creationflags=_CREATE_NO_WINDOW,
        )
        if result.returncode == 0 and os.path.exists(shortcut_path):
            _safe_print("[shortcut] OK (powershell)", flush=True)
            return True
        _safe_print(f"[shortcut] powershell код {result.returncode}", flush=True)
        if result.stderr:
            _safe_print(f"[shortcut] stderr: {result.stderr.strip()[:300]}", flush=True)
    except Exception as e:
        _safe_print(f"[shortcut] powershell ошибка: {e}", flush=True)

    exe_path_esc = exe_path.replace('"', '""')
    exe_dir_esc = exe_dir.replace('"', '""')
    lnk_path_esc = shortcut_path.replace('"', '""')

    vbs = (
        'Set oWS = WScript.CreateObject("WScript.Shell")\n'
        f'Set oLink = oWS.CreateShortcut("{lnk_path_esc}")\n'
        f'oLink.TargetPath = "{exe_path_esc}"\n'
        f'oLink.WorkingDirectory = "{exe_dir_esc}"\n'
        f'oLink.IconLocation = "{exe_path_esc},0"\n'
        'oLink.Description = "EZHednevnik"\n'
        'oLink.Save\n'
    )

    vbs_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.vbs', delete=False, encoding='utf-8'
        ) as f:
            f.write(vbs)
            vbs_path = f.name

        result = subprocess.run(
            ['cscript', '//Nologo', vbs_path],
            capture_output=True, timeout=15, text=True,
            creationflags=_CREATE_NO_WINDOW,
        )
        if result.returncode == 0 and os.path.exists(shortcut_path):
            _safe_print("[shortcut] OK (vbscript)", flush=True)
            return True
        _safe_print(f"[shortcut] vbs код {result.returncode}", flush=True)
        if result.stderr:
            _safe_print(f"[shortcut] vbs stderr: {result.stderr.strip()[:200]}", flush=True)
    except Exception as e:
        _safe_print(f"[shortcut] vbs ошибка: {e}", flush=True)
    finally:
        if vbs_path:
            try:
                os.unlink(vbs_path)
            except OSError:
                pass

    return False

def _open_url_in_browser(url: str) -> bool:
    if sys.platform == 'win32':
        try:
            os.startfile(url)
            return True
        except Exception:
            pass
        try:
            subprocess.Popen(['cmd', '/c', 'start', '', url],
                             shell=False, close_fds=True,
                             creationflags=_CREATE_NO_WINDOW)
            return True
        except Exception:
            pass
    try:
        import webbrowser
        webbrowser.open(url, new=2)
        return True
    except Exception:
        return False

_GUI = {
    'bg':         '#f8fafc',
    'surface':    '#ffffff',
    'border':     '#e2e8f0',
    'accent':     '#6366f1',
    'accent_h':   '#4f46e5',
    'accent_soft':'#eef2ff',
    'success':    '#10b981',
    'success_bg': '#d1fae5',
    'danger':     '#ef4444',
    'danger_bg':  '#fee2e2',
    'danger_h':   '#fecaca',
    'text':       '#1e293b',
    'text_muted': '#64748b',
    'text_light': '#94a3b8',
    'neutral_bg': '#f1f5f9',
    'neutral_h':  '#e2e8f0',
}

def _run_console_mode(port: int, debug: bool, open_browser: bool, offer_shortcut: bool):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    INNER = 56
    line = '-' * INNER
    def row(text):
        content = ' ' + text
        pad = max(0, INNER - len(content) - 1)
        return '|' + content + ' ' * pad + '|'

    _safe_print(flush=True)
    _safe_print('+' + line + '+', flush=True)
    _safe_print(row('EZHednevnik'), flush=True)
    _safe_print('+' + line + '+', flush=True)
    _safe_print(row(f'Версия: {APP_VERSION}'), flush=True)
    _safe_print(row(f'Сервер:  http://127.0.0.1:{port}'), flush=True)
    _safe_print(row('Стоп:    Ctrl+C или закрыть это окно'), flush=True)
    _safe_print('+' + line + '+', flush=True)
    _safe_print(flush=True)

    if open_browser:
        def _open_later():
            time.sleep(2.5)
            _safe_print(f"[browser] открываю http://127.0.0.1:{port}", flush=True)
            if _open_url_in_browser(f"http://127.0.0.1:{port}"):
                _safe_print("[browser] OK", flush=True)
            else:
                _safe_print(f"[browser] не удалось. Открой вручную: http://127.0.0.1:{port}", flush=True)
        t = threading.Timer(2.5, _open_later)
        t.daemon = True
        t.start()

    if offer_shortcut and IS_EXE and sys.platform == 'win32' and sys.stdin is not None:
        try:
            desktop = _get_desktop_dir()
            shortcut_path = os.path.join(desktop, 'EZHednevnik.lnk')
            if not os.path.exists(shortcut_path):
                flag_file = os.path.join(BASE_DIR, '.shortcut_asked')
                if not os.path.exists(flag_file):
                    try:
                        with open(flag_file, 'w', encoding='utf-8') as f:
                            f.write('asked\n')
                    except OSError:
                        pass
                    _safe_print(flush=True)
                    _safe_print('  Это первый запуск EZHednevnik.', flush=True)
                    try:
                        answer = input('  Создать ярлык на рабочем столе? [Y/n]: ').strip().lower()
                    except (EOFError, KeyboardInterrupt):
                        answer = 'n'
                    if answer in ('', 'y', 'yes', 'д', 'да'):
                        if _create_desktop_shortcut():
                            _safe_print('  [OK] Ярлык создан.', flush=True)
                        else:
                            _safe_print('  [FAIL] Не удалось создать ярлык.', flush=True)
                    _safe_print(flush=True)
        except Exception as e:
            _safe_print(f"[shortcut] пропущено: {e}", flush=True)

    _safe_print(f"[server] запускаю waitress на порту {port} ...", flush=True)
    try:
        from waitress import serve
        serve(app, host="127.0.0.1", port=port, threads=8)
    except ImportError:
        _safe_print("[warn] waitress не найден — использую Flask dev-сервер.", flush=True)
        app.run(debug=debug, host="127.0.0.1", port=port)

def _run_gui_mode(port: int):
    try:
        import tkinter as tk
        from tkinter import messagebox
    except ImportError:
        _safe_print("[gui] tkinter недоступен — откат в консоль", flush=True)
        _run_console_mode(port, debug=False, open_browser=True, offer_shortcut=True)
        return

    srv_holder = {'srv': None, 'failed': False}

    def _start_server():
        try:
            from waitress.server import create_server
        except ImportError:
            srv_holder['failed'] = True
            return
        try:
            srv = create_server(app, host="127.0.0.1", port=port, threads=8)
        except Exception as e:
            _safe_print(f"[gui] ошибка создания сервера: {e}", flush=True)
            srv_holder['failed'] = True
            return

        def _run():
            try:
                srv.run()
            except Exception as e:
                _safe_print(f"[gui] сервер упал: {e}", flush=True)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        srv_holder['srv'] = srv

    _start_server()

    if srv_holder['failed'] or srv_holder['srv'] is None:
        root = tk.Tk()
        root.title("EZHednevnik")
        root.geometry("380x160")
        root.resizable(False, False)
        root.configure(bg=_GUI['bg'])
        tk.Label(root, text="❌  Не удалось запустить сервер",
                 font=("Segoe UI", 12, "bold"),
                 bg=_GUI['bg'], fg=_GUI['danger']).pack(pady=(30, 6))
        tk.Label(root, text="Попробуйте перезапустить приложение",
                 font=("Segoe UI", 9),
                 bg=_GUI['bg'], fg=_GUI['text_muted']).pack()
        tk.Button(root, text="Закрыть", command=root.destroy,
                  font=("Segoe UI", 10), bg=_GUI['neutral_bg'], fg=_GUI['text'],
                  relief="flat", borderwidth=0, padx=20, pady=6,
                  cursor="hand2").pack(pady=20)
        root.mainloop()
        return

    root = tk.Tk()
    root.title("EZHednevnik")
    root.geometry("440x395")
    root.resizable(False, False)
    root.configure(bg=_GUI['bg'])

    try:
        if sys.platform == 'win32' and IS_EXE:
            root.iconbitmap(sys.executable)
    except Exception:
        pass

    def _flat_button(parent, text, bg, fg, hover_bg, command, font_size=10, height_pady=10):
        frame = tk.Frame(parent, bg=bg, cursor="hand2")
        label = tk.Label(frame, text=text, bg=bg, fg=fg,
                         font=("Segoe UI", font_size, "bold"),
                         padx=14, pady=height_pady, cursor="hand2")
        label.pack(fill="both", expand=True)

        def _click(_e): command()
        def _enter(_e):
            frame.configure(bg=hover_bg); label.configure(bg=hover_bg)
        def _leave(_e):
            frame.configure(bg=bg); label.configure(bg=bg)

        for w in (frame, label):
            w.bind("<Button-1>", _click)
            w.bind("<Enter>", _enter)
            w.bind("<Leave>", _leave)
        return frame

    header = tk.Frame(root, bg=_GUI['accent'], height=72)
    header.pack(fill="x")
    header.pack_propagate(False)

    tk.Label(header, text="🦔", font=("Segoe UI Emoji", 24),
             bg=_GUI['accent'], fg="white").pack(side="left", padx=(18, 10))

    header_text = tk.Frame(header, bg=_GUI['accent'])
    header_text.pack(side="left", fill="y", pady=(14, 0))
    tk.Label(header_text, text="EZHednevnik",
             font=("Segoe UI", 15, "bold"),
             bg=_GUI['accent'], fg="white").pack(anchor="w")
    tk.Label(header_text, text=f"дневник студента СевГУ · {APP_VERSION}",
             font=("Segoe UI", 9),
             bg=_GUI['accent'], fg="#c7d2fe").pack(anchor="w")

    status_wrap = tk.Frame(root, bg=_GUI['bg'])
    status_wrap.pack(fill="x", padx=20, pady=(16, 12))

    status_card = tk.Frame(status_wrap, bg=_GUI['surface'],
                            highlightbackground=_GUI['border'], highlightthickness=1)
    status_card.pack(fill="x")

    status_inner = tk.Frame(status_card, bg=_GUI['surface'])
    status_inner.pack(fill="x", padx=16, pady=12)

    status_row = tk.Frame(status_inner, bg=_GUI['surface'])
    status_row.pack(fill="x", anchor="w")
    tk.Label(status_row, text="●", font=("Segoe UI", 14),
             bg=_GUI['surface'], fg=_GUI['success']).pack(side="left")
    tk.Label(status_row, text="  Сервер работает",
             font=("Segoe UI", 11, "bold"),
             bg=_GUI['surface'], fg=_GUI['success']).pack(side="left")

    tk.Label(status_inner, text=f"http://127.0.0.1:{port}",
             font=("Consolas", 10),
             bg=_GUI['surface'], fg=_GUI['text_muted']).pack(anchor="w", pady=(4, 0))

    buttons_wrap = tk.Frame(root, bg=_GUI['bg'])
    buttons_wrap.pack(fill="x", padx=20)

    def on_open_browser():
        if not _open_url_in_browser(f"http://127.0.0.1:{port}"):
            messagebox.showwarning(
                "EZHednevnik",
                f"Не удалось открыть браузер.\n\nОткройте вручную:\nhttp://127.0.0.1:{port}"
            )

    def on_shortcut():
        root.withdraw()
        root.update()
        ok = _create_desktop_shortcut()
        root.deiconify()
        if ok:
            messagebox.showinfo("EZHednevnik",
                                "✓ Ярлык «EZHednevnik» создан на рабочем столе.")
        else:
            messagebox.showwarning(
                "EZHednevnik",
                "Не удалось создать ярлык автоматически.\n\n"
                "Создайте вручную:\n"
                "правый клик на .exe → «Отправить» → «Рабочий стол (создать ярлык)»."
            )

    def on_stop():
        if messagebox.askyesno("EZHednevnik",
                               "Остановить сервер и закрыть приложение?"):
            _close()

    def _close():
        try:
            srv_holder['srv'].close()
        except Exception:
            pass
        try:
            root.destroy()
        except Exception:
            pass

    _flat_button(buttons_wrap, "🌐   Открыть в браузере",
                 bg=_GUI['accent'], fg="white", hover_bg=_GUI['accent_h'],
                 command=on_open_browser, font_size=11, height_pady=11
                 ).pack(fill="x", pady=(0, 8))

    row2 = tk.Frame(buttons_wrap, bg=_GUI['bg'])
    row2.pack(fill="x")

    _flat_button(row2, "📌   Создать ярлык",
                 bg=_GUI['neutral_bg'], fg=_GUI['text'], hover_bg=_GUI['neutral_h'],
                 command=on_shortcut, font_size=10
                 ).pack(side="left", fill="x", expand=True, padx=(0, 4))

    _flat_button(row2, "⏹   Остановить",
                 bg=_GUI['danger_bg'], fg=_GUI['danger'], hover_bg=_GUI['danger_h'],
                 command=on_stop, font_size=10
                 ).pack(side="left", fill="x", expand=True, padx=(4, 0))

    footer = tk.Frame(root, bg=_GUI['bg'])
    footer.pack(side="bottom", fill="x", pady=(0, 10))
    tk.Label(footer, text=f"{APP_VERSION} · Every-SevGU · 2026",
             font=("Segoe UI", 8),
             bg=_GUI['bg'], fg=_GUI['text_light']).pack()

    root.protocol("WM_DELETE_WINDOW", _close)
    root.after(1000, on_open_browser)

    root.mainloop()

    try:
        srv_holder['srv'].close()
    except Exception:
        pass

if __name__ == "__main__":
    use_gui = IS_EXE and "--console" not in sys.argv
    if "--gui" in sys.argv:
        use_gui = True
    if "--console" in sys.argv:
        use_gui = False

    debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    PORT = _find_free_port(5000)
    if PORT != 5000:
        _safe_print(f"[server] порт 5000 занят, использую {PORT}", flush=True)

    if use_gui:
        _run_gui_mode(PORT)
    else:
        _run_console_mode(
            PORT,
            debug=debug,
            open_browser=True,
            offer_shortcut=IS_EXE,
        )