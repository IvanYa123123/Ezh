"""Слой работы с БД: подключение, схема, миграции."""
import os
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


def ensure_db_initialized():
    """Единственная точка инициализации БД.

    Раньше в app.py был собственный _db_init_lock/_db_ready,
    а здесь — свой. Оба создавали потокобезопасную инициализацию,
    но правки приходилось вносить в двух местах. Теперь всё
    здесь, а app.py просто вызывает эту функцию из before_request.
    """
    global _db_ready
    if _db_ready:
        return
    with _db_init_lock:
        if not _db_ready:
            init_db()
            _db_ready = True


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
    """Одноразовая миграция ПЗ↔ЛЗ.

    Порядок важен: сначала в ОДНОЙ транзакции обновляются БД и пишется маркер,
    и только потом переписываются файлы кэша. Если процесс упадёт на файлах,
    маркер уже стоит и миграция не выполнится повторно (иначе типы пар
    бесконечно «переворачивались» бы при каждом запуске). Файлы кэша при
    необходимости просто перезапишутся следующей синхронизацией.
    """
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

        lab_items_changed = 0
        lab_progress_changed = 0

        try:
            with conn:
                # --- lab_items: двухфазный своп через временные subject'ы,
                # чтобы не нарушать UNIQUE(group_name, subject, idx).
                rows = conn.execute("SELECT id, subject FROM lab_items").fetchall()
                changes = [
                    (rid, old, _swap_ps_lz_suffix(old))
                    for rid, old in rows
                    if _swap_ps_lz_suffix(old) != old
                ]
                for rid, _old, _new in changes:
                    conn.execute(
                        "UPDATE lab_items SET subject=? WHERE id=?",
                        (f"__pslz_tmp_{rid}", rid),
                    )
                for rid, _old, new in changes:
                    src = conn.execute(
                        "SELECT group_name, idx, completed FROM lab_items WHERE id=?", (rid,)
                    ).fetchone()
                    if src is None:
                        continue
                    target = conn.execute(
                        "SELECT id FROM lab_items WHERE group_name=? AND subject=? AND idx=?",
                        (src[0], new, src[1]),
                    ).fetchone()
                    if target is not None and target[0] != rid:
                        # После свопа две записи претендуют на один слот —
                        # сливаем их, сохраняя максимальный прогресс.
                        conn.execute(
                            "UPDATE lab_items SET completed=MAX(completed, ?) WHERE id=?",
                            (src[2], target[0]),
                        )
                        conn.execute("DELETE FROM lab_items WHERE id=?", (rid,))
                    else:
                        conn.execute(
                            "UPDATE lab_items SET subject=? WHERE id=?", (new, rid)
                        )
                    lab_items_changed += 1

                # --- lab_progress: удаляем только меняющиеся строки и
                # вставляем результат слияния (max прогресса), не затирая
                # существующую запись второго типа.
                rows = conn.execute(
                    "SELECT rowid, group_name, subject, completed, total FROM lab_progress"
                ).fetchall()
                changed = [
                    r for r in rows if _swap_ps_lz_suffix(r[2]) != r[2]
                ]
                if changed:
                    merged = {}
                    for _rid, g, s, completed, total in changed:
                        key = (g, _swap_ps_lz_suffix(s))
                        if key in merged:
                            merged[key] = (
                                max(merged[key][0], completed),
                                max(merged[key][1], total),
                            )
                        else:
                            merged[key] = (completed, total)

                    # В целевой строке (subject, который уже существует,
                    # но сам не меняется) прогресс может быть больше —
                    # раньше INSERT OR REPLACE его затирал.
                    for key in list(merged):
                        existing = conn.execute(
                            "SELECT completed, total FROM lab_progress "
                            "WHERE group_name=? AND subject=?",
                            (key[0], key[1]),
                        ).fetchone()
                        if existing is not None:
                            merged[key] = (
                                max(merged[key][0], existing[0]),
                                max(merged[key][1], existing[1]),
                            )

                    for _rid, g, s, _c, _t in changed:
                        conn.execute(
                            "DELETE FROM lab_progress WHERE group_name=? AND subject=?",
                            (g, s),
                        )
                    for (g, new_subj), (completed, total) in merged.items():
                        conn.execute(
                            "INSERT OR REPLACE INTO lab_progress "
                            "(group_name, subject, completed, total) VALUES (?, ?, ?, ?)",
                            (g, new_subj, completed, total),
                        )
                    lab_progress_changed = len(merged)

                conn.execute(
                    "INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)",
                    (_MIGRATION_PS_LZ_KEY, str(int(time.time()))),
                )
        except sqlite3.Error as e:
            _safe_print(f"[migration] БД не изменена: {e}", flush=True)
            return

        # БД и маркер зафиксированы — теперь можно безопасно обновить кэш.
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
                if not isinstance(item, dict):
                    continue
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

        _safe_print(
            f"[migration] готово: schedules={swapped_files}, "
            f"lab_items={lab_items_changed}, lab_progress={lab_progress_changed}",
            flush=True,
        )
    except (sqlite3.Error, OSError) as e:
        _safe_print(f"[migration] ошибка: {e}", flush=True)
    finally:
        conn.close()