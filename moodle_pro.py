import os
import re
import sys
import json
import time
import random
import threading
import traceback
from datetime import datetime
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from flask import Blueprint, request, jsonify

try:
    from bs4 import BeautifulSoup
    _HAS_BS4 = True
except ImportError:
    _HAS_BS4 = False

moodle_bp = Blueprint('moodle_pro', __name__)

MOODLE_URL = "https://do.sevsu.ru"

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

COOKIES_FILE = os.path.join(BASE_DIR, "moodle_cookies.json")
CACHE_FILE = os.path.join(BASE_DIR, "moodle_stats_cache.json")
ERROR_LOG_FILE = os.path.join(BASE_DIR, "moodle_errors.log")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Кэш статистики живёт 30 минут: без TTL он отдавался вечно.
STATS_CACHE_TTL = 30 * 60
ERROR_LOG_MAX_BYTES = 1024 * 1024

_scrape_lock = threading.Lock()
_cancel_scrape = False


def _atomic_write_json(path: str, payload) -> None:
    """Пишет JSON атомарно (tmp + os.replace), чтобы обрыв не оставлял
    битый файл. 0600 — там лежат cookies авторизации."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def _build_session() -> requests.Session:
    """Сессия с повторами на временные сбои сети/сервера (только GET)."""
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    retry = Retry(
        total=2,
        connect=2,
        read=1,
        status=2,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

_MONTHS_RU = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
    'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
}

def _log_error(context: str, extra: str = '', exc: BaseException = None):
    try:
        # Ротация, чтобы лог не рос бесконечно (был 157 КБ и рос дальше).
        try:
            if os.path.getsize(ERROR_LOG_FILE) > ERROR_LOG_MAX_BYTES:
                os.replace(ERROR_LOG_FILE, ERROR_LOG_FILE + '.1')
        except OSError:
            pass
        ts = time.strftime('%Y-%m-%d %H:%M:%S')
        with open(ERROR_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"\n[{ts}] {context}\n")
            if extra: f.write(f"  extra: {extra}\n")
            if exc is not None:
                f.write(f"  {type(exc).__name__}: {exc}\n")
                f.write(traceback.format_exc())
    except OSError:
        pass

def _safe_re_search(pattern, text, flags=0, context=''):
    m = re.search(pattern, text, flags)
    if m is None and context:
        _log_error(f"regex miss: {context}", extra=f"pattern={pattern[:100]!r}")
    return m

def _clear_cookies_file():
    try:
        if os.path.exists(COOKIES_FILE):
            os.remove(COOKIES_FILE)
    except OSError as e:
        _log_error("failed to remove cookies file", exc=e)

def _get_session() -> requests.Session:
    session = _build_session()
    if os.path.exists(COOKIES_FILE):
        try:
            with open(COOKIES_FILE, "r", encoding="utf-8") as f:
                cookies = json.load(f)
            for name, value in cookies.items():
                session.cookies.set(name, value, domain="do.sevsu.ru")
        except Exception as e:
            _log_error("failed to load cookies", exc=e)
    return session

def _clean_html(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def _parse_grade_value(raw_html: str):
    """Возвращает (grade_text, grade_num) из ячейки «Оценка».

    Раньше `4.5` превращалось в `45` (replace('.', '')), а формат
    «4,5/5» давал мусор. Теперь берём первое число как есть.
    """
    text = _clean_html(raw_html or '').replace('&nbsp;', ' ')
    text = re.sub(r'\s+', '', text)
    if not re.search(r'\d', text):
        return "—", None

    parts = text.split('/', 1)
    num_match = re.search(r'\d+(?:[.,]\d+)?', parts[0])
    if not num_match:
        return text, None
    num_text = num_match.group(0)
    try:
        grade_num = float(num_text.replace(',', '.'))
    except ValueError:
        grade_num = None

    if len(parts) == 2:
        total = re.search(r'\d+(?:[.,]\d+)?', parts[1])
        if total:
            return f"{num_text.replace(',', '.')}/{total.group(0).replace(',', '.')}", grade_num
        return text, grade_num
    return text, grade_num

def _random_sleep():
    """Короткая пауза 0.4–0.8с — антибот, но не вечность.

    Было 1.0–2.0с. При 20 заданиях пользователь ждал до 40 секунд
    на спиннере. 0.4–0.8с снижает до ~12с и всё ещё не выглядит
    как долбёжка сервера.
    """
    time.sleep(random.uniform(0.4, 0.8))

# ============================================================
#  BS4-ПАРСИНГ ТАБЛИЦЫ ОЦЕНОК
# ============================================================

_STATUS_RULES = (
    (re.compile(r'не\s+сдано|not\s+submitted', re.IGNORECASE), 'Не сдано'),
    (re.compile(r'на\s+проверк|отправлен|submitted\s+for\s+grading', re.IGNORECASE), 'На проверке'),
    (re.compile(r'черновик|draft', re.IGNORECASE), 'Черновик'),
    (re.compile(r'\bсдано\b|оценено|graded|complete', re.IGNORECASE), 'Сдано'),
)


def _status_from_text(text: str) -> str:
    """Возвращает статус по тексту ячейки ('' если не распознан)."""
    for pattern, status in _STATUS_RULES:
        if pattern.search(text or ''):
            return status
    return ''


def _cell_grade(cell: str):
    """Извлекает (grade_text, grade_num) из ячейки оценки.

    Ячейки с процентами и весами игнорируются — раньше именно они
    часто попадали в «оценку» (последняя числовая колонка справа).
    """
    if not cell:
        return "—", None
    clean = cell.strip()
    if not clean or clean in ('-', '—', '–'):
        return "—", None
    if '%' in clean or re.search(r'вес|weight', clean, re.IGNORECASE):
        return "—", None
    m = re.fullmatch(r'\s*(\d+(?:[.,]\d+)?)\s*(?:/\s*(\d+(?:[.,]\d+)?))?\s*', clean)
    if not m:
        return "—", None
    num = m.group(1).replace(',', '.')
    grade_text = clean.replace(',', '.')
    try:
        return grade_text, float(num)
    except ValueError:
        return grade_text, None


def _parse_gradebook_bs4(html: str) -> dict:
    """Парсит таблицу оценок на /grade/report/overview/index.php.

    Возвращает {assign_id: {name, status, grade, grade_num}}.
    Колонка оценки определяется по заголовку таблицы, а не «первое
    число справа»: иначе вес работы или процент становились оценкой.
    """
    if not _HAS_BS4:
        return {}
    try:
        soup = BeautifulSoup(html, 'lxml')
    except Exception as e:
        _log_error("bs4: failed to parse gradebook", exc=e)
        return {}

    result = {}
    for table in soup.find_all('table'):
        headers = []
        for tr in table.find_all('tr'):
            ths = tr.find_all('th')
            if ths and not tr.find('a', href=re.compile(r'/mod/assign/view\.php\?id=\d+')):
                headers = [_clean_html(th.get_text(' ', strip=True)).lower() for th in ths]
                continue

            link = tr.find('a', href=re.compile(r'/mod/assign/view\.php\?id=\d+'))
            if not link:
                continue
            m = re.search(r'id=(\d+)', link.get('href', ''))
            if not m:
                continue
            aid = m.group(1)
            aname = _clean_html(link.get_text(' ', strip=True))
            cells = [_clean_html(td.get_text(' ', strip=True)) for td in tr.find_all('td')]
            if not cells:
                continue

            grade_idx = None
            status_idx = None
            for i, h in enumerate(headers):
                if grade_idx is None and re.search(r'оценк|итог|балл|\bgrade\b', h):
                    grade_idx = i
                if status_idx is None and re.search(r'статус|\bstatus\b', h):
                    status_idx = i

            grade_text, grade_num = "—", None
            if grade_idx is not None and grade_idx < len(cells):
                grade_text, grade_num = _cell_grade(cells[grade_idx])
            if grade_num is None and grade_text == "—":
                # Fallback без заголовков: справа налево, пропуская
                # проценты, веса и текстовые статусы.
                for c in reversed(cells):
                    g_text, g_num = _cell_grade(c)
                    if g_num is not None:
                        grade_text, grade_num = g_text, g_num
                        break

            status = ''
            if status_idx is not None and status_idx < len(cells):
                status = _status_from_text(cells[status_idx])
            if not status:
                for c in cells:
                    status = _status_from_text(c)
                    if status:
                        break
            if not status:
                status = 'Сдано' if grade_num is not None else 'Не сдано'

            result[aid] = {
                "name": aname,
                "status": status,
                "grade": grade_text,
                "grade_num": grade_num,
            }
    return result


def _parse_gradebook_regex(html: str) -> dict:
    """Fallback, если bs4/lxml не установлены."""
    result = {}
    tr_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.IGNORECASE | re.DOTALL)
    for tr_match in tr_pattern.finditer(html):
        tr_html = tr_match.group(1)
        assign_link = re.search(
            r'href="[^"]*?/mod/assign/view\.php\?id=(\d+)"[^>]*>(.*?)</a>',
            tr_html, re.IGNORECASE | re.DOTALL,
        )
        if not assign_link:
            continue
        aid = assign_link.group(1)
        aname = _clean_html(assign_link.group(2))
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr_html, re.IGNORECASE | re.DOTALL)
        cells = [_clean_html(td) for td in tds]

        grade_text, grade_num = "—", None
        for c in reversed(cells):
            g_text, g_num = _cell_grade(c)
            if g_num is not None:
                grade_text, grade_num = g_text, g_num
                break

        status = ''
        for c in cells:
            status = _status_from_text(c)
            if status:
                break
        if not status:
            status = 'Сдано' if grade_num is not None else 'Не сдано'

        result[aid] = {
            "name": aname,
            "status": status,
            "grade": grade_text,
            "grade_num": grade_num,
        }
    return result


def _parse_gradebook(html: str) -> dict:
    """Пытается BS4, падает на регэксп."""
    if _HAS_BS4:
        parsed = _parse_gradebook_bs4(html)
        # Если BS4 вернул пусто, а регэксп что-то находит — вероятно,
        # вёрстка нестандартная. Не смешиваем результаты: если BS4
        # нашёл хоть что-то, доверяем ему.
        if parsed:
            return parsed
    return _parse_gradebook_regex(html)


# ============================================================
#  ЭНДПОИНТЫ
# ============================================================

@moodle_bp.route('/api/moodle/status', methods=['GET'])
def get_status():
    if not os.path.exists(COOKIES_FILE):
        return jsonify({"logged_in": False})
    session = _get_session()
    try:
        r = session.get(f"{MOODLE_URL}/my/", timeout=10)
        if "auth.sevsu.ru" in r.url or "login/index.php" in r.url:
            _clear_cookies_file()
            return jsonify({"logged_in": False})
        return jsonify({"logged_in": True})
    except Exception as e:
        _log_error("status check failed", exc=e)
        return jsonify({"logged_in": False})
    finally:
        session.close()

@moodle_bp.route('/api/moodle/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Некорректный запрос"}), 400
    username = data.get('username')
    password = data.get('password')
    if not isinstance(username, str) or not isinstance(password, str) or not username.strip() or not password:
        return jsonify({"error": "Введите логин и пароль"}), 400
    username = username.strip()

    session = _build_session()

    try:
        r = session.get(f"{MOODLE_URL}/login/index.php", timeout=15)
        match = _safe_re_search(r'href="([^"]*auth/oauth2/login\.php[^"]*)"', r.text, context='login: SSO button link')
        if not match:
            return jsonify({"error": "Не нашли кнопку входа через СевГУ"}), 500

        sso_url = match.group(1).replace("&amp;", "&")
        r = session.get(sso_url, timeout=15)

        action_match = _safe_re_search(r'<form[^>]+action="([^"]+)"', r.text, context='login: Keycloak form action')
        if not action_match:
            return jsonify({"error": "Не нашли форму Keycloak"}), 500

        form_action = action_match.group(1).replace("&amp;", "&")
        if form_action.startswith("/"):
            form_action = "https://auth.sevsu.ru" + form_action

        inputs = re.findall(r'<input[^>]+name="([^"]+)"[^>]*value="([^"]*)"', r.text)
        form_data = {name: value for name, value in inputs}
        form_data["username"] = username
        form_data["password"] = password
        form_data.setdefault("credentialId", "")

        r = session.post(form_action, data=form_data, allow_redirects=True, timeout=15)

        # Успех — это не «любой URL без auth.sevsu.ru», а рабочая сессия Moodle.
        final_url = (r.url or '').lower()
        if "auth.sevsu.ru" in final_url or "login/index.php" in final_url:
            return jsonify({"error": "Неверный логин или пароль"}), 401

        probe = session.get(f"{MOODLE_URL}/my/", timeout=15)
        probe_url = (probe.url or '').lower()
        if "auth.sevsu.ru" in probe_url or "login/index.php" in probe_url:
            return jsonify({"error": "Не удалось войти в Moodle"}), 401

        cookies = {c.name: c.value for c in session.cookies}
        _atomic_write_json(COOKIES_FILE, cookies)

        if os.path.exists(CACHE_FILE):
            os.remove(CACHE_FILE)

        return jsonify({"success": True})
    except Exception as e:
        _log_error("login failed", exc=e)
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

@moodle_bp.route('/api/moodle/logout', methods=['POST'])
def logout():
    for file in [COOKIES_FILE, CACHE_FILE]:
        if os.path.exists(file):
            try:
                os.remove(file)
            except OSError:
                pass
    return jsonify({"success": True})

@moodle_bp.route('/api/moodle/cancel', methods=['POST'])
def cancel_moodle_scrape():
    global _cancel_scrape
    _cancel_scrape = True
    return jsonify({"success": True})

@moodle_bp.route('/api/moodle/stats', methods=['GET'])
def get_stats():
    global _cancel_scrape
    force = request.args.get('force') == '1'

    cached_data = None
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
        except Exception as e:
            _log_error("failed to read stats cache", exc=e)

    def _cached_response(stale=False):
        return jsonify({
            "data": cached_data.get("data", []) if isinstance(cached_data, dict) else [],
            "timestamp": cached_data.get("timestamp", 0) if isinstance(cached_data, dict) else 0,
            "stale": stale,
        })

    cache_age = None
    if isinstance(cached_data, dict):
        try:
            cache_age = time.time() - float(cached_data.get("timestamp", 0) or 0)
        except (TypeError, ValueError):
            cache_age = None
    cache_fresh = cache_age is not None and 0 <= cache_age < STATS_CACHE_TTL

    if not force and cache_fresh:
        return _cached_response()

    if not _scrape_lock.acquire(blocking=False):
        if cached_data:
            return _cached_response(stale=True)
        return jsonify({"error": "Обновление уже выполняется, подождите"}), 429

    _cancel_scrape = False
    session = None
    had_errors = False

    try:
        session = _get_session()
        r_my = session.get(f"{MOODLE_URL}/my/", timeout=15)
        if "auth.sevsu.ru" in r_my.url:
            _clear_cookies_file()
            return jsonify({"error": "Сессия устарела"}), 401

        # --- 1. Получаем список курсов ---
        courses = []
        sesskey_match = re.search(r'"sesskey":"([^"]+)"', r_my.text)
        sesskey = sesskey_match.group(1) if sesskey_match else ""

        if sesskey:
            api_url = f"{MOODLE_URL}/lib/ajax/service.php?sesskey={sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification"
            payload = [{"index": 0, "methodname": "core_course_get_enrolled_courses_by_timeline_classification", "args": {"offset": 0, "limit": 0, "classification": "all", "sort": "fullname"}}]
            try:
                r_api = session.post(api_url, json=payload, timeout=15)
                api_data = r_api.json()
                if api_data and not api_data[0].get('error'):
                    raw_courses = api_data[0].get('data', {}).get('courses', [])
                    for c in raw_courses:
                        courses.append({"id": str(c['id']), "name": c['fullname']})
            except Exception as e:
                _log_error("stats: AJAX course list failed", exc=e)

        if not courses:
            course_pattern = re.compile(
                r'<a[^>]+href="[^"]*?/course/view\.php\?id=(\d+)"[^>]*>(.*?)</a>',
                re.IGNORECASE | re.DOTALL,
            )
            seen_courses = set()
            for match in course_pattern.finditer(r_my.text):
                cid = match.group(1)
                name = _clean_html(match.group(2))
                if name and len(name) > 3 and cid not in seen_courses:
                    seen_courses.add(cid)
                    courses.append({"id": cid, "name": name})

        if not courses:
            return jsonify({"data": [], "timestamp": time.time()})

        # --- 2. Дедлайны из Календаря ---
        calendar_deadlines = {}
        if sesskey:
            course_ids = [int(c['id']) for c in courses]
            api_url = f"{MOODLE_URL}/lib/ajax/service.php?sesskey={sesskey}&info=core_calendar_get_action_events_by_courses"
            payload = [{"index": 0, "methodname": "core_calendar_get_action_events_by_courses", "args": {"courseids": course_ids, "limitnum": 100}}]
            try:
                r_cal = session.post(api_url, json=payload, timeout=15)
                cal_data = r_cal.json()
                if cal_data and not cal_data[0].get('error'):
                    for ev in cal_data[0].get('data', {}).get('events', []):
                        if ev.get('modulename') != 'assign':
                            continue
                        # В событиях календаря instance — это id назначения
                        # (assign), а задания в курсе адресуются по cmid.
                        # Берём cmid из URL события, иначе дедлайны не
                        # находились вообще.
                        ev_url = str(ev.get('url') or '')
                        if not ev_url and isinstance(ev.get('action'), dict):
                            ev_url = str(ev['action'].get('url') or '')
                        id_match = re.search(r'/mod/(?:assign|quiz)/view\.php\?id=(\d+)', ev_url)
                        aid = id_match.group(1) if id_match else str(ev.get('instance') or '')
                        due_ts = ev.get('timesort') or ev.get('due')
                        if aid and due_ts:
                            try:
                                dt = datetime.fromtimestamp(float(due_ts))
                            except (TypeError, ValueError, OSError):
                                continue
                            calendar_deadlines[aid] = {
                                "due": dt.strftime('%d.%m.%Y'),
                                "due_iso": dt.strftime('%Y-%m-%d'),
                            }
            except Exception as e:
                _log_error("stats: Calendar API failed", exc=e)

        # --- 3. Общая ведомость оценок (BS4 + fallback) ---
        gradebook_data = {}
        try:
            r_grade = session.get(f"{MOODLE_URL}/grade/report/overview/index.php", timeout=20)
            if "auth.sevsu.ru" not in r_grade.url:
                gradebook_data = _parse_gradebook(r_grade.text)
        except Exception as e:
            _log_error("stats: gradebook request failed", exc=e)
            had_errors = True

        # --- 4. Гибридный сбор: идём по курсам, ищем пропущенные лабы ---
        result = []
        for c in courses:
            if _cancel_scrape:
                return jsonify({"error": "Cancelled"}), 499

            c_res = {"id": c["id"], "name": c["name"], "assignments": []}

            try:
                cr = session.get(f"{MOODLE_URL}/course/view.php?id={c['id']}", timeout=15)
            except Exception as e:
                _log_error(f"stats: course {c['id']} request failed", exc=e)
                had_errors = True
                continue
            _random_sleep()
            if _cancel_scrape:
                return jsonify({"error": "Cancelled"}), 499
            if "auth.sevsu.ru" in cr.url:
                continue

            act_pattern = re.compile(
                r'<a[^>]+href="[^"]*?/mod/(assign|quiz)/view\.php\?id=(\d+)"[^>]*>(.*?)</a>',
                re.IGNORECASE | re.DOTALL,
            )
            seen_acts = set()

            for amatch in act_pattern.finditer(cr.text):
                mod_type = amatch.group(1).lower()
                mod_id = amatch.group(2)
                act_name = _clean_html(amatch.group(3))
                act_name = re.sub(r'\s+(Задание|Тест)$', '', act_name, flags=re.IGNORECASE)

                if not act_name or mod_id in seen_acts:
                    continue
                seen_acts.add(mod_id)

                act_res = {
                    "id": mod_id,
                    "type": mod_type,
                    "name": act_name,
                    "status": "—",
                    "grade": "—",
                    "due": "",
                    "due_iso": "",
                    "grade_num": None,
                }

                if mod_id in calendar_deadlines:
                    act_res["due"] = calendar_deadlines[mod_id]["due"]
                    act_res["due_iso"] = calendar_deadlines[mod_id]["due_iso"]

                if mod_type == "assign":
                    if mod_id in gradebook_data:
                        gb = gradebook_data[mod_id]
                        act_res["status"] = gb["status"]
                        act_res["grade"] = gb["grade"]
                        act_res["grade_num"] = gb["grade_num"]
                    else:
                        if _cancel_scrape:
                            return jsonify({"error": "Cancelled"}), 499
                        _random_sleep()
                        try:
                            ar = session.get(f"{MOODLE_URL}/mod/assign/view.php?id={mod_id}", timeout=15)
                        except Exception as e:
                            _log_error(f"stats: assign {mod_id} request failed", exc=e)
                            had_errors = True
                            c_res["assignments"].append(act_res)
                            continue
                        if _cancel_scrape:
                            return jsonify({"error": "Cancelled"}), 499

                        if "submissiongraded" in ar.text or "Оценено" in ar.text:
                            act_res["status"] = "Сдано"
                        elif "submissionstatussubmitted" in ar.text or "Отправлено для оценивания" in ar.text:
                            act_res["status"] = "На проверке"
                        elif "submissionstatusnotsubmitted" in ar.text or "Не сдано" in ar.text:
                            act_res["status"] = "Не сдано"
                        elif "Черновик" in ar.text:
                            act_res["status"] = "Черновик"
                        else:
                            act_res["status"] = "Ожидает"

                        grade_match = re.search(
                            r'Оценка\s*</(?:th|td)>\s*<td[^>]*>(.*?)</td>',
                            ar.text, re.DOTALL | re.IGNORECASE,
                        )
                        if not grade_match:
                            grade_match = re.search(
                                r'class="[^"]*\bgrade\b[^"]*"[^>]*>(.*?)</td>',
                                ar.text, re.DOTALL | re.IGNORECASE,
                            )
                        if grade_match:
                            act_res["grade"], act_res["grade_num"] = _parse_grade_value(
                                grade_match.group(1)
                            )
                else:
                    act_res["status"] = "Тест"

                c_res["assignments"].append(act_res)

            if c_res["assignments"]:
                result.append(c_res)

        # --- 5. Кэш ---
        ts = time.time()
        if result:
            try:
                _atomic_write_json(
                    CACHE_FILE,
                    {"timestamp": ts, "data": result, "partial": had_errors},
                )
            except Exception as e:
                _log_error("stats: failed to write cache", exc=e)

        return jsonify({"data": result, "timestamp": ts, "partial": had_errors})

    except Exception as e:
        _log_error("stats: unhandled exception", exc=e)
        # Временный сбой сети не должен отбирать у пользователя уже
        # загруженную статистику.
        if cached_data:
            return _cached_response(stale=True)
        return jsonify({"error": str(e)}), 500
    finally:
        _cancel_scrape = False
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
        _scrape_lock.release()