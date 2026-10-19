"""Общие утилиты: валидаторы, mtime-кэш JSON-файлов, троттлинг синхронизации."""
import os
import re
import json
import time
import threading

from . import runtime


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


def validate_slug(raw) -> str:
    s = str(raw or "").strip().lower()
    if not _SLUG_RE.match(s):
        raise ValueError("invalid slug")
    return s


def make_safe_filename(name):
    result = str(name).translate(_FORBIDDEN_CHARS)
    result = result.replace('..', '__').strip('. ')
    return (result or '_')[:120]


# ============================================================
#  MTIME-КЭШ JSON
# ============================================================

class MtimeJsonCache:
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


# Ленивая инициализация кэшей — пути известны только после app.py
_custom_groups_cache = None
_sync_times_cache = None
_groups_txt_lock = threading.RLock()
_groups_txt_mtime = None
_groups_txt_data = None
_groups_txt_loaded = False


def _ensure_caches():
    global _custom_groups_cache, _sync_times_cache
    if _custom_groups_cache is None:
        _custom_groups_cache = MtimeJsonCache(runtime.CUSTOM_GROUPS_FILE)
    if _sync_times_cache is None:
        _sync_times_cache = MtimeJsonCache(runtime.SYNC_TIMES_FILE)


def _read_groups_txt():
    global _groups_txt_mtime, _groups_txt_data, _groups_txt_loaded
    try:
        mt = os.path.getmtime(runtime.GROUPS_FILE)
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
                    with open(runtime.GROUPS_FILE, 'r', encoding='utf-8') as f:
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


def load_custom_groups():
    _ensure_caches()
    data = _custom_groups_cache.read(default_factory=list)
    if isinstance(data, list):
        return [str(x).strip() for x in data if str(x).strip()]
    return []


def save_custom_groups(groups):
    _ensure_caches()
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

def needs_sync(key):
    _ensure_caches()
    data = _sync_times_cache.read(default_factory=dict)
    last = data.get(key, 0) if isinstance(data, dict) else 0
    return (time.time() - last) > runtime.MIN_SYNC_INTERVAL


def mark_synced(key):
    _ensure_caches()
    cache = _sync_times_cache
    with cache.lock:
        data = cache.read(default_factory=dict)
        if not isinstance(data, dict):
            data = {}
        data[key] = time.time()
        cache.write(data)