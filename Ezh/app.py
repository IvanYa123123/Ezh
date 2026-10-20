import os
import sys
import base64
import socket
import subprocess
import tempfile
import threading
import time
from moodle_pro import moodle_bp

from flask import Flask, g, request, jsonify

from planner import SevSUPlanner
from teacher_planner import SevSUTeacherPlanner

from blueprints import runtime
from blueprints.extensions import limiter


# ============================================================
#  ПУТИ И РЕЖИМ ЗАПУСКА
# ============================================================

IS_EXE = getattr(sys, 'frozen', False)

if IS_EXE and hasattr(sys, '_MEIPASS'):
    BASE_DIR   = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS
else:
    BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = BASE_DIR

_CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0


def _safe_print(*args, **kwargs):
    try:
        if sys.stdout is not None:
            print(*args, **kwargs)
    except Exception:
        pass


# ============================================================
#  RUNTIME
# ============================================================

def _read_app_version():
    try:
        with open(os.path.join(BASE_DIR, "VERSION"), "r", encoding="utf-8") as f:
            v = f.read().strip()
            if v:
                return v
    except OSError:
        pass
    return "dev"


runtime.IS_EXE         = IS_EXE
runtime.BASE_DIR       = BASE_DIR
runtime.BUNDLE_DIR     = BUNDLE_DIR
runtime.DB_FILE        = os.path.join(BASE_DIR, "planner.db")
runtime.SCHEDULES_DIR  = os.path.join(BASE_DIR, "schedules")
runtime.CUSTOM_GROUPS_FILE = os.path.join(BASE_DIR, "custom_groups.json")
runtime.SYNC_TIMES_FILE    = os.path.join(BASE_DIR, ".sync_times.json")
runtime.GROUPS_FILE    = os.path.join(BUNDLE_DIR, "Group.txt")
runtime.TEMPLATES_DIR  = os.path.join(BUNDLE_DIR, "templates")
runtime.STATIC_DIR     = os.path.join(BUNDLE_DIR, "static")
runtime.APP_VERSION    = _read_app_version()
runtime.MIN_SYNC_INTERVAL = 6 * 3600

os.makedirs(runtime.SCHEDULES_DIR, exist_ok=True)

_safe_print(f"[version] {runtime.APP_VERSION} (BASE_DIR = {BASE_DIR})", flush=True)

runtime.planner = SevSUPlanner()
runtime.teacher_planner = SevSUTeacherPlanner(BASE_DIR)

try:
    runtime.teacher_planner.start_background_refresh(interval_hours=6)
except Exception as _e:
    _safe_print(f"[teacher_bg] не удалось запустить: {_e}", flush=True)


# ============================================================
#  FLASK APP
# ============================================================

app = Flask(
    __name__,
    template_folder=runtime.TEMPLATES_DIR,
    static_folder=runtime.STATIC_DIR,
    static_url_path='/static',
)

limiter.init_app(app)


# ============================================================
#  АУТЕНТИФИКАЦИЯ
# ------------------------------------------------------------
#  APP_TOKEN — опциональный общий токен (для шаринга по сети).
#  /api/moodle/* намеренно исключён: у него своя аутентификация
#  через cookies Moodle (login/status должны работать до логина,
#  logout — после). Если закрыть их токеном, Pro-режим ломается.
# ============================================================

import secrets
APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
_AUTH_EXEMPT_PATHS = {"/", "/api/health"}
_AUTH_EXEMPT_PREFIXES = ("/api/moodle/", "/static/")


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
    for prefix in _AUTH_EXEMPT_PREFIXES:
        if path.startswith(prefix):
            return
    if not _check_auth():
        return jsonify({"error": "unauthorized"}), 401


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
    return {"app_version": runtime.APP_VERSION}


# ============================================================
#  GZIP + SECURITY HEADERS
# ============================================================

import gzip

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
#  ИНИЦИАЛИЗАЦИЯ БД + ФОНОВАЯ МИГРАЦИЯ
# ============================================================

from blueprints.db import init_db, close_db, _migrate_ps_lz_swap

_db_init_lock = threading.Lock()
_db_ready = False
_migration_started = False

# Закрываем SQLite-соединение в конце каждого запроса. Без этого
# соединения жили до сборки мусора — латентная утечка fd и WAL-локов.
app.teardown_appcontext(close_db)


def _start_background_migration():
    global _migration_started
    if _migration_started:
        return
    _migration_started = True

    def _run():
        try:
            _migrate_ps_lz_swap()
        except Exception as e:
            _safe_print(f"[migration] failed: {e}", flush=True)

    t = threading.Thread(target=_run, daemon=True, name="ps_lz_migration")
    t.start()


@app.before_request
def _ensure_db_initialized():
    global _db_ready
    if _db_ready:
        return
    with _db_init_lock:
        if not _db_ready:
            init_db()
            _db_ready = True
    _start_background_migration()


# ============================================================
#  BLUEPRINTS
# ============================================================

from blueprints.api_core     import bp as bp_core
from blueprints.api_people   import bp as bp_people
from blueprints.api_schedule import bp as bp_schedule
from blueprints.api_tasks    import bp as bp_tasks
from blueprints.api_labs     import bp as bp_labs

app.register_blueprint(bp_core)
app.register_blueprint(bp_people)
app.register_blueprint(bp_schedule)
app.register_blueprint(bp_tasks)
app.register_blueprint(bp_labs)

# РЕГИСТРАЦИЯ ЕЖ ПРО (MOODLE)
app.register_blueprint(moodle_bp)


# ============================================================
#  ЗАПУСК
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


def _server_is_up(host: str, port: int, timeout: float = 0.2) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((host, port))
        return True
    except OSError:
        return False


_GUI = {
    'bg':         '#f8fafc',
    'surface':    '#ffffff',
    'border':     '#e2e8f0',
    'accent':     '#6366f1',
    'accent_h':   '#4f46e5',
    'accent_soft':'#eef2ff',
    'success':    '#10b981',
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
    _safe_print(row(f'Версия: {runtime.APP_VERSION}'), flush=True)
    _safe_print(row(f'Сервер:  http://127.0.0.1:{port}'), flush=True)
    _safe_print(row('Стоп:    Ctrl+C или закрыть это окно'), flush=True)
    _safe_print('+' + line + '+', flush=True)
    _safe_print(flush=True)

    if open_browser:
        def _open_later():
            for _ in range(30):
                if _server_is_up("127.0.0.1", port):
                    if _open_url_in_browser(f"http://127.0.0.1:{port}"):
                        _safe_print("[browser] открыт", flush=True)
                        return
                    break
                time.sleep(0.3)
            _safe_print(f"[browser] открой вручную: http://127.0.0.1:{port}", flush=True)

        t = threading.Timer(0.3, _open_later)
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

        threading.Thread(target=_run, daemon=True).start()
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
    tk.Label(header_text, text="дневник студента СевГУ",
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
    tk.Label(footer, text="Every-SevGU",
             font=("Segoe UI", 8),
             bg=_GUI['bg'], fg=_GUI['text_light']).pack()

    root.protocol("WM_DELETE_WINDOW", _close)

    def _try_open_when_ready(attempt: int = 0):
        if attempt > 40:
            _safe_print("[gui] сервер не поднялся — браузер не открываю", flush=True)
            return
        if _server_is_up("127.0.0.1", port):
            on_open_browser()
            return
        root.after(300, lambda: _try_open_when_ready(attempt + 1))

    root.after(400, _try_open_when_ready)

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