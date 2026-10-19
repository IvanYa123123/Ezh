import os
import re
import json
import time
import requests
from flask import Blueprint, request, jsonify

moodle_bp = Blueprint('moodle_pro', __name__)

MOODLE_URL = "https://do.sevsu.ru"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIES_FILE = os.path.join(BASE_DIR, "moodle_cookies.json")
CACHE_FILE = os.path.join(BASE_DIR, "moodle_stats_cache.json")
CACHE_TTL = 15 * 60  # Кэш на 15 минут

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def _get_session():
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    if os.path.exists(COOKIES_FILE):
        try:
            with open(COOKIES_FILE, "r", encoding="utf-8") as f:
                cookies = json.load(f)
                for name, value in cookies.items():
                    session.cookies.set(name, value, domain="do.sevsu.ru")
        except Exception:
            pass
    return session

def _clean_html(text):
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()

@moodle_bp.route('/api/moodle/status', methods=['GET'])
def get_status():
    session = _get_session()
    try:
        r = session.get(f"{MOODLE_URL}/my/", timeout=10)
        if "auth.sevsu.ru" in r.url or "login/index.php" in r.url:
            return jsonify({"logged_in": False})
        return jsonify({"logged_in": True})
    except:
        return jsonify({"logged_in": False})

@moodle_bp.route('/api/moodle/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({"error": "Введите логин и пароль"}), 400

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    try:
        r = session.get(f"{MOODLE_URL}/login/index.php", timeout=15)
        match = re.search(r'href="([^"]*auth/oauth2/login\.php[^"]*)"', r.text)
        if not match:
            return jsonify({"error": "Не нашли кнопку входа через СевГУ"}), 500
        
        sso_url = match.group(1).replace("&amp;", "&")
        r = session.get(sso_url, timeout=15)
        
        action_match = re.search(r'<form[^>]+action="([^"]+)"', r.text)
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
        
        if "auth.sevsu.ru" in r.url:
            return jsonify({"error": "Неверный логин или пароль"}), 401
            
        cookies = {c.name: c.value for c in session.cookies}
        with open(COOKIES_FILE, "w", encoding="utf-8") as f:
            json.dump(cookies, f)
            
        # При успешном входе удаляем старый кэш
        if os.path.exists(CACHE_FILE):
            os.remove(CACHE_FILE)
            
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@moodle_bp.route('/api/moodle/logout', methods=['POST'])
def logout():
    for file in [COOKIES_FILE, CACHE_FILE]:
        if os.path.exists(file):
            try: os.remove(file)
            except OSError: pass
    return jsonify({"success": True})

@moodle_bp.route('/api/moodle/stats', methods=['GET'])
def get_stats():
    force = request.args.get('force') == '1'

    # Проверяем кэш (если не просят принудительно обновить)
    if not force and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                if time.time() - cached_data.get("timestamp", 0) < CACHE_TTL:
                    return jsonify(cached_data.get("data", []))
        except Exception:
            pass

    session = _get_session()
    try:
        r = session.get(f"{MOODLE_URL}/my/", timeout=15)
        if "auth.sevsu.ru" in r.url:
            return jsonify({"error": "Сессия устарела"}), 401

        courses = []
        course_pattern = re.compile(r'<a[^>]+href="[^"]*?/course/view\.php\?id=(\d+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
        seen_courses = set()
        for match in course_pattern.finditer(r.text):
            cid = match.group(1)
            name = _clean_html(match.group(2))
            if name and len(name) > 3 and cid not in seen_courses:
                seen_courses.add(cid)
                courses.append({"id": cid, "name": name})

        result = []
        for c in courses:
            c_res = {"id": c["id"], "name": c["name"], "assignments": []}
            cr = session.get(f"{MOODLE_URL}/course/view.php?id={c['id']}", timeout=15)
            
            # Задержка между запросами к курсам (защита от бана)
            time.sleep(1.2)
            
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
                
                act_res = {"id": mod_id, "type": mod_type, "name": act_name, "status": "—", "grade": "—"}
                
                if mod_type == "assign":
                    # Задержка перед каждым заданием (защита от бана)
                    time.sleep(1.0) 
                    ar = session.get(f"{MOODLE_URL}/mod/assign/view.php?id={mod_id}", timeout=15)
                    status_match = re.search(r'<[^>]+class="[^"]*submissionstatus[^"]*"[^>]*>(.*?)</[^>]+>', ar.text, re.IGNORECASE | re.DOTALL)
                    if status_match:
                        status_text = _clean_html(status_match.group(1))
                        if "Отправлено" in status_text: act_res["status"] = "На проверке"
                        elif "Не сдано" in status_text: act_res["status"] = "Не сдано"
                        elif "Сдано" in status_text: act_res["status"] = "Сдано"
                        else: act_res["status"] = status_text
                    
                    grade_match = re.search(r'<td[^>]*class="[^"]*grade[^"]*"[^>]*>(.*?)</td>', ar.text, re.DOTALL | re.IGNORECASE)
                    if grade_match:
                        grade_text = _clean_html(grade_match.group(1))
                        if re.search(r'\d', grade_text): act_res["grade"] = grade_text
                else:
                    act_res["status"] = "Тест"

                c_res["assignments"].append(act_res)
            
            result.append(c_res)

        # Сохраняем в кэш
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({"timestamp": time.time(), "data": result}, f, ensure_ascii=False)
        except Exception:
            pass

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500