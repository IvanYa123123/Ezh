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
from flask import Blueprint, request, jsonify

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

_scrape_lock = threading.Lock()
_cancel_scrape = False

_MONTHS_RU = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
    'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
}

def _log_error(context: str, extra: str = '', exc: BaseException = None):
    try:
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

def _parse_due_iso(due_text: str) -> str:
    if not due_text: return ''
    text = due_text.strip().lower()
    m = re.search(r'(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?', text)
    if not m: return ''
    d, mon_name, y = m.groups()
    month = _MONTHS_RU.get(mon_name)
    if not month: return ''
    if y:
        year = int(y)
    else:
        now = datetime.now()
        year = now.year
        if month < now.month: year += 1
    try:
        return f"{year:04d}-{month:02d}-{int(d):02d}"
    except ValueError:
        return ''

def _clear_cookies_file():
    try:
        if os.path.exists(COOKIES_FILE):
            os.remove(COOKIES_FILE)
    except OSError as e:
        _log_error("failed to remove cookies file", exc=e)

def _get_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
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

def _random_sleep():
    """Случайная задержка от 1.0 до 2.0 секунд для имитации человека."""
    time.sleep(random.uniform(1.0, 2.0))

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

@moodle_bp.route('/api/moodle/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({"error": "Введите логин и пароль"}), 400

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    try:
        r = session.get(f"{MOODLE_URL}/login/index.php", timeout=15)
        match = _safe_re_search(r'href="([^"]*auth/oauth2/login\.php[^"]*)"', r.text, context='login: SSO button link')
        if not match: return jsonify({"error": "Не нашли кнопку входа через СевГУ"}), 500

        sso_url = match.group(1).replace("&amp;", "&")
        r = session.get(sso_url, timeout=15)

        action_match = _safe_re_search(r'<form[^>]+action="([^"]+)"', r.text, context='login: Keycloak form action')
        if not action_match: return jsonify({"error": "Не нашли форму Keycloak"}), 500

        form_action = action_match.group(1).replace("&amp;", "&")
        if form_action.startswith("/"): form_action = "https://auth.sevsu.ru" + form_action

        inputs = re.findall(r'<input[^>]+name="([^"]+)"[^>]*value="([^"]*)"', r.text)
        form_data = {name: value for name, value in inputs}
        form_data["username"] = username
        form_data["password"] = password
        form_data.setdefault("credentialId", "")

        r = session.post(form_action, data=form_data, allow_redirects=True, timeout=15)

        if "auth.sevsu.ru" in r.url:
            return jsonify({"error": "Неверный логин или пароль"}), 401

        cookies = {c.name: c.value for c in session.cookies}
        with open(COOKIES_FILE, "w", encoding="utf-8") as f:
            json.dump(cookies, f)

        if os.path.exists(CACHE_FILE): os.remove(CACHE_FILE)

        return jsonify({"success": True})
    except Exception as e:
        _log_error("login failed", exc=e)
        return jsonify({"error": str(e)}), 500

@moodle_bp.route('/api/moodle/logout', methods=['POST'])
def logout():
    for file in [COOKIES_FILE, CACHE_FILE]:
        if os.path.exists(file):
            try: os.remove(file)
            except OSError: pass
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

    if not force and cached_data:
        return jsonify({"data": cached_data.get("data", []), "timestamp": cached_data.get("timestamp", 0)})

    if not _scrape_lock.acquire(blocking=False):
        if cached_data:
            return jsonify({"data": cached_data.get("data", []), "timestamp": cached_data.get("timestamp", 0)})
        return jsonify({"error": "Обновление уже выполняется, подождите"}), 429

    _cancel_scrape = False

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
            course_pattern = re.compile(r'<a[^>]+href="[^"]*?/course/view\.php\?id=(\d+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
            seen_courses = set()
            for match in course_pattern.finditer(r_my.text):
                cid = match.group(1)
                name = _clean_html(match.group(2))
                if name and len(name) > 3 and cid not in seen_courses:
                    seen_courses.add(cid)
                    courses.append({"id": cid, "name": name})

        if not courses:
            return jsonify({"data": [], "timestamp": time.time()})

        # --- 2. Получаем дедлайны из Календаря (Один запрос) ---
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
                        if ev.get('modulename') == 'assign':
                            aid = str(ev.get('instance'))
                            due_ts = ev.get('timesort')
                            if due_ts:
                                dt = datetime.fromtimestamp(due_ts)
                                calendar_deadlines[aid] = {
                                    "due": dt.strftime('%d.%m.%Y'),
                                    "due_iso": dt.strftime('%Y-%m-%d')
                                }
            except Exception as e:
                _log_error("stats: Calendar API failed", exc=e)

        # --- 3. Пытаемся получить оценки из общей ведомости (Быстрый путь) ---
        gradebook_data = {}
        r_grade = session.get(f"{MOODLE_URL}/grade/report/overview/index.php", timeout=20)
        if "auth.sevsu.ru" not in r_grade.url:
            tr_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.IGNORECASE | re.DOTALL)
            for tr_match in tr_pattern.finditer(r_grade.text):
                tr_html = tr_match.group(1)
                assign_link = re.search(r'href="[^"]*?/mod/assign/view\.php\?id=(\d+)"[^>]*>(.*?)</a>', tr_html, re.IGNORECASE | re.DOTALL)
                if assign_link:
                    aid = assign_link.group(1)
                    aname = _clean_html(assign_link.group(2))
                    tds = re.findall(r'<td[^>]*>(.*?)</td>', tr_html, re.IGNORECASE | re.DOTALL)
                    
                    grade_text = "—"
                    grade_num = None
                    for td in reversed(tds):
                        clean_td = _clean_html(td)
                        if re.search(r'\d', clean_td) or clean_td == '-':
                            if re.search(r'[а-яА-Я]', clean_td): continue
                            if clean_td != '-':
                                grade_text = clean_td.replace(',', '.')
                                num_match = re.search(r'(\d+(?:\.\d+)?)', grade_text)
                                if num_match: grade_num = float(num_match.group(1))
                            break
                    
                    status = "Сдано" if grade_num is not None else "Не сдано"
                    gradebook_data[aid] = {
                        "name": aname,
                        "status": status,
                        "grade": grade_text,
                        "grade_num": grade_num
                    }

        # --- 4. Гибридный сбор: идем по курсам, ищем пропущенные лабы ---
        result = []
        for c in courses:
            if _cancel_scrape: return jsonify({"error": "Cancelled"}), 499
            
            c_res = {"id": c["id"], "name": c["name"], "assignments": []}
            
            # Загружаем страницу курса, чтобы найти ВСЕ задания
            cr = session.get(f"{MOODLE_URL}/course/view.php?id={c['id']}", timeout=15)
            _random_sleep() # Задержка, чтобы не спамить
            if _cancel_scrape: return jsonify({"error": "Cancelled"}), 499
            if "auth.sevsu.ru" in cr.url: continue
            
            act_pattern = re.compile(r'<a[^>]+href="[^"]*?/mod/(assign|quiz)/view\.php\?id=(\d+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
            seen_acts = set()
            
            for amatch in act_pattern.finditer(cr.text):
                mod_type = amatch.group(1).lower()
                mod_id = amatch.group(2)
                act_name = _clean_html(amatch.group(3))
                act_name = re.sub(r'\s+(Задание|Тест)$', '', act_name, flags=re.IGNORECASE)
                
                if not act_name or mod_id in seen_acts: continue
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
                
                # Привязываем дедлайн из календаря
                if mod_id in calendar_deadlines:
                    act_res["due"] = calendar_deadlines[mod_id]["due"]
                    act_res["due_iso"] = calendar_deadlines[mod_id]["due_iso"]

                if mod_type == "assign":
                    # Если данные есть в ведомости — берем их (это быстро)
                    if mod_id in gradebook_data:
                        gb = gradebook_data[mod_id]
                        act_res["status"] = gb["status"]
                        act_res["grade"] = gb["grade"]
                        act_res["grade_num"] = gb["grade_num"]
                    else:
                        # Если нет — идем на страницу задания (медленный путь с задержкой)
                        if _cancel_scrape: return jsonify({"error": "Cancelled"}), 499
                        _random_sleep()
                        ar = session.get(f"{MOODLE_URL}/mod/assign/view.php?id={mod_id}", timeout=15)
                        if _cancel_scrape: return jsonify({"error": "Cancelled"}), 499
                        
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
                            
                        # Пытаемся вытащить оценку, если ведомость не помогла
                        grade_match = re.search(r'Оценка</th>\s*<td[^>]*>(.*?)</td>', ar.text, re.DOTALL | re.IGNORECASE)
                        if grade_match:
                            grade_text = _clean_html(grade_match.group(1))
                            grade_text = grade_text.replace('&nbsp;', ' ').replace(' ', '')
                            if re.search(r'\d', grade_text):
                                if '/' in grade_text:
                                    parts = grade_text.split('/')
                                    num1 = parts[0].split(',')[0].replace('.', '')
                                    num2 = parts[1].split(',')[0]
                                    act_res["grade"] = f"{num1}/{num2}"
                                    try: act_res["grade_num"] = float(num1)
                                    except ValueError: pass
                                else:
                                    act_res["grade"] = grade_text
                                    num_match = re.search(r'(\d+)', grade_text)
                                    if num_match: act_res["grade_num"] = float(num_match.group(1))
                else:
                    act_res["status"] = "Тест"
                    
                c_res["assignments"].append(act_res)
                
            if c_res["assignments"]:
                result.append(c_res)

        # --- 5. Кэш ---
        ts = time.time()
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({"timestamp": ts, "data": result}, f, ensure_ascii=False)
        except Exception as e:
            _log_error("stats: failed to write cache", exc=e)

        return jsonify({"data": result, "timestamp": ts})

    except Exception as e:
        _log_error("stats: unhandled exception", exc=e)
        return jsonify({"error": str(e)}), 500
    finally:
        _scrape_lock.release()