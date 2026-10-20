"""Слой работы с БД: подключение, схема, миграции."""
import os
import re
import json
import time
import sqlite3
import threading

from flask import g

from . import runtime


_db_init_lock = threading.Lock()
_db_ready = False

_MIGRATION_PS_LZ_KEY = 'ps_lz_swap_v1'


def _safe_print(*args, **kwargs):
    try:
        import sys
        if sys.stdout is not None:
            print(*args, **kwargs)
    except Exception:
        pass


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(runtime.DB_FILE, timeout=30)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout = 5000")
        g.db.execute("PRAGMA cache_size = -64000")
        g.db.execute("PRAGMA mmap_size = 268435456")
        g.db.execute("PRAGMA temp_store = MEMORY")
        g.db.execute("PRAGMA synchronous = NORMAL")
    return g.db


def close_db(exc=None):
    """Закрывает соединение в конце запроса. Регистрируется в app.py
    через app.teardown_appcontext(close_db). Без этого SQLite-
    соединения жили до сборки мусора — латентная утечка fd
    и WAL-локов."""
    db = g.pop('db', None)
    if db is not None:
        try:
            db.close()
        except Exception:
            pass


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
    """Создаёт таблицы и индексы.

    ВАЖНО: `with sqlite3.connect(...) as conn:` НЕ закрывает соединение
    — контекст-менеджер делает только commit/rollback. Раньше здесь
    использовался `with`, из-за чего соединение жило до сборки мусора.
    Теперь явный try/finally с close().
    """
    last_err = None
    for attempt in range(retries):
        conn = None
        try:
            conn = sqlite3.connect(runtime.DB_FILE, timeout=30)
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
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    if last_err:
        raise last_err


# ============================================================
#  МИГРАЦИЯ ПЗ ↔ ЛЗ
# ============================================================

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
    """Одноразовая миграция. Запускается в фоне из app.py, чтобы не
    блокировать первый запрос пользователя."""
    conn = sqlite3.connect(runtime.DB_FILE, timeout=30)
    try:
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)")

        row = conn.execute(
            "SELECT value FROM _meta WHERE key=?", (_MIGRATION_PS_LZ_KEY,)
        ).fetchone()
        if row:
            return

        _safe_print("[migration] инвертирую ПЗ/ЛЗ в кэшах и таблицах лаб...", flush=True)

        swapped_files = 0
        try:
            filenames = [f for f in os.listdir(runtime.SCHEDULES_DIR) if f.endswith('.json')]
        except OSError:
            filenames = []

        for fname in filenames:
            path = os.path.join(runtime.SCHEDULES_DIR, fname)
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