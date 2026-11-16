# -*- coding: utf-8 -*-
"""РЈСЃС‚Р°РЅРѕРІС‰РёРє EZHednevnik.

РЎРѕР±РёСЂР°РµС‚СЃСЏ PyInstaller РІ РѕРґРёРЅ EzhSetup.exe. Р’РЅСѓС‚СЂРё вЂ” РіРѕС‚РѕРІРѕРµ РїСЂРёР»РѕР¶РµРЅРёРµ
(payload/Ezh). РЈСЃС‚Р°РЅРѕРІРєР° per-user, Р±РµР· РїСЂР°РІ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°. РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ
РїСЂРёР»РѕР¶РµРЅРёРµ СЃС‚Р°РІРёС‚СЃСЏ РІ РїРѕРґРїР°РїРєСѓ Ezh СЂСЏРґРѕРј СЃ СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРј; РІСЃРµ РёР·РјРµРЅСЏРµРјС‹Рµ
РґР°РЅРЅС‹Рµ РїСЂРёР»РѕР¶РµРЅРёСЏ С…СЂР°РЅСЏС‚СЃСЏ РІ РїРѕРґРїР°РїРєРµ data.

РўРёС…РёР№ СЂРµР¶РёРј РґР»СЏ РїСЂРѕРІРµСЂРєРё:
    EzhSetup.exe --silent --dir C:\\path --no-shortcut --no-launch
"""
import argparse
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import traceback
import winreg

APP_NAME = "Ezh"
APP_TITLE = "EZHednevnik"
APP_VERSION_FALLBACK = "3.7.0"
SHORTCUT_NAME = "EZHednevnik.lnk"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Ezh"
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

FROZEN = getattr(sys, "frozen", False)
if FROZEN:
    RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    SETUP_DIR = os.path.dirname(sys.executable)
else:
    RES_DIR = os.path.dirname(os.path.abspath(__file__))
    RES_DIR = os.path.dirname(RES_DIR)  # РєРѕСЂРµРЅСЊ РїСЂРѕРµРєС‚Р°
    SETUP_DIR = RES_DIR

PAYLOAD_DIR = os.path.join(RES_DIR, "payload", "Ezh")
if not os.path.isdir(PAYLOAD_DIR):
    PAYLOAD_DIR = os.path.join(RES_DIR, "dist", "Ezh")

LAST_SHORTCUT_ERROR = ""


def _log_shortcut(message):
    """Р”РёР°РіРЅРѕСЃС‚РёРєР° СЏСЂР»С‹РєР° СЂСЏРґРѕРј СЃ СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРј Рё РІ TEMP."""
    global LAST_SHORTCUT_ERROR
    LAST_SHORTCUT_ERROR = message
    stamp = time.strftime("%Y-%m-%d %H:%M:%S ")
    for path in (
        os.path.join(os.environ.get("TEMP", SETUP_DIR), "EzhSetup_shortcut.log"),
        os.path.join(SETUP_DIR, "EzhSetup_shortcut.log"),
    ):
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(stamp + message + "\n")
            break
        except OSError:
            continue


def payload_version():
    for base in (PAYLOAD_DIR, RES_DIR):
        try:
            with open(os.path.join(base, "VERSION"), "r", encoding="utf-8") as f:
                v = f.read().strip()
                if v:
                    return v
        except OSError:
            pass
    return APP_VERSION_FALLBACK


def _local_appdata_dir():
    local = os.environ.get("LOCALAPPDATA") or os.path.join(
        os.path.expanduser("~"), "AppData", "Local"
    )
    return os.path.join(local, "Programs", "Ezh")


def _dir_writable(path):
    probe = os.path.join(path, ".ezh_write_test")
    try:
        with open(probe, "w", encoding="utf-8") as f:
            f.write("x")
        os.remove(probe)
        return True
    except OSError:
        return False


def default_install_dir():
    """РџР°РїРєР° Ezh СЂСЏРґРѕРј СЃ СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРј, РµСЃР»Рё С‚СѓРґР° РјРѕР¶РЅРѕ РїРёСЃР°С‚СЊ."""
    if FROZEN and os.path.isdir(SETUP_DIR) and _dir_writable(SETUP_DIR):
        return os.path.join(SETUP_DIR, "Ezh")
    return _local_appdata_dir()


def desktop_dir():
    """Р Р°Р±РѕС‡РёР№ СЃС‚РѕР» СЃ СѓС‡С‘С‚РѕРј OneDrive-СЂРµРґРёСЂРµРєС‚Р°."""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        )
        with key:
            value, _ = winreg.QueryValueEx(key, "Desktop")
            value = os.path.expandvars(value)
            if os.path.isdir(value):
                return value
    except OSError:
        pass
    d = os.path.join(os.path.expanduser("~"), "Desktop")
    return d if os.path.isdir(d) else os.path.expanduser("~")


def _ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def _create_shortcut_com(exe_path, work_dir, link_path):
    try:
        import pythoncom
        from win32com.shell import shell
    except Exception as e:
        _log_shortcut(f"COM РЅРµРґРѕСЃС‚СѓРїРµРЅ: {e}")
        return False
    pythoncom.CoInitialize()
    try:
        link = pythoncom.CoCreateInstance(
            shell.CLSID_ShellLink, None,
            pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink,
        )
        link.SetPath(exe_path)
        link.SetWorkingDirectory(work_dir)
        link.SetDescription("EZHednevnik вЂ” РґРЅРµРІРЅРёРє СЃС‚СѓРґРµРЅС‚Р° РЎРµРІР“РЈ")
        link.SetIconLocation(exe_path, 0)
        link.QueryInterface(pythoncom.IID_IPersistFile).Save(link_path, 0)
        ok = os.path.exists(link_path) and os.path.getsize(link_path) > 0
        _log_shortcut(f"COM: {'OK' if ok else 'С„Р°Р№Р» РЅРµ СЃРѕР·РґР°РЅ'} -> {link_path}")
        return ok
    except Exception as e:
        _log_shortcut(f"COM РѕС€РёР±РєР°: {e}")
        return False
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def create_shortcut(exe_path, work_dir, link_path=None):
    global LAST_SHORTCUT_ERROR
    LAST_SHORTCUT_ERROR = ""
    if not link_path:
        link_path = os.path.join(desktop_dir(), SHORTCUT_NAME)
    os.makedirs(os.path.dirname(link_path), exist_ok=True)

    if _create_shortcut_com(exe_path, work_dir, link_path):
        return True

    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    powershell = os.path.join(
        system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if not os.path.exists(powershell):
        powershell = "powershell"

    ps = (
        '$ErrorActionPreference = "Stop"; '
        '$ws = New-Object -ComObject WScript.Shell; '
        f'$s = $ws.CreateShortcut({_ps_quote(link_path)}); '
        f'$s.TargetPath = {_ps_quote(exe_path)}; '
        f'$s.WorkingDirectory = {_ps_quote(work_dir)}; '
        f'$s.IconLocation = {_ps_quote(exe_path + ",0")}; '
        f'$s.Description = {_ps_quote("EZHednevnik вЂ” РґРЅРµРІРЅРёРє СЃС‚СѓРґРµРЅС‚Р° РЎРµРІР“РЈ")}; '
        '$s.Save(); '
    )
    try:
        r = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
             "-Command", ps],
            capture_output=True, timeout=40, creationflags=CREATE_NO_WINDOW,
        )
        if r.returncode == 0 and os.path.exists(link_path):
            _log_shortcut("PowerShell: OK")
            return True
        err = (r.stderr or b"").decode("cp866", "replace")[:400]
        _log_shortcut(f"PowerShell rc={r.returncode}: {err}")
    except Exception as e:
        _log_shortcut(f"PowerShell РѕС€РёР±РєР°: {e}")

    vbs_path = os.path.join(os.environ.get("TEMP", SETUP_DIR), "ezh_shortcut.vbs")
    vbs = (
        'Set oWS = WScript.CreateObject("WScript.Shell")\r\n'
        f'Set oLink = oWS.CreateShortcut("{link_path}")\r\n'
        f'oLink.TargetPath = "{exe_path}"\r\n'
        f'oLink.WorkingDirectory = "{work_dir}"\r\n'
        f'oLink.IconLocation = "{exe_path},0"\r\n'
        'oLink.Save\r\n'
    )
    try:
        with open(vbs_path, "w", encoding="utf-8") as f:
            f.write(vbs)
        wscript = os.path.join(system_root, "System32", "cscript.exe")
        if not os.path.exists(wscript):
            wscript = "cscript"
        r = subprocess.run(
            [wscript, "//nologo", vbs_path],
            capture_output=True, timeout=40, creationflags=CREATE_NO_WINDOW,
        )
        ok = r.returncode == 0 and os.path.exists(link_path)
        _log_shortcut(f"VBScript: {'OK' if ok else 'rc=' + str(r.returncode)}")
        return ok
    except Exception as e:
        _log_shortcut(f"VBScript РѕС€РёР±РєР°: {e}")
        return False
    finally:
        try:
            os.remove(vbs_path)
        except OSError:
            pass


def _write_uninstaller(target, exe_path, size_kb):
    bat = os.path.join(target, "uninstall.bat")
    content = r"""@echo off
setlocal
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Ezh" /f >nul 2>&1
del "%USERPROFILE%\Desktop\EZHednevnik.lnk" >nul 2>&1
del "%USERPROFILE%\OneDrive\Desktop\EZHednevnik.lnk" >nul 2>&1
del "%OneDrive%\Desktop\EZHednevnik.lnk" >nul 2>&1
del "%PUBLIC%\Desktop\EZHednevnik.lnk" >nul 2>&1
set "SELF=%TEMP%\Ezh_uninstall_%RANDOM%%RANDOM%.bat"
> "%SELF%" echo @echo off
>> "%SELF%" echo timeout /t 2 /nobreak ^>nul
>> "%SELF%" echo taskkill /im Ezh.exe /f ^>nul 2^>^&1
>> "%SELF%" echo timeout /t 1 /nobreak ^>nul
>> "%SELF%" echo rmdir /s /q "%APP_DIR%"
>> "%SELF%" echo del "%%~f0"
start "" /min "%SELF%"
exit /b 0
"""
    with open(bat, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(content)

    registry_ok = True
    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY)
        with key:
            values = {
                "DisplayName": APP_TITLE,
                "DisplayVersion": payload_version(),
                "Publisher": "EZHednevnik",
                "InstallLocation": target,
                "DisplayIcon": exe_path + ",0",
                "UninstallString": f'"{bat}"',
                "NoModify": 1,
                "NoRepair": 1,
                "EstimatedSize": max(1, int(size_kb)),
            }
            for name, value in values.items():
                if isinstance(value, int):
                    winreg.SetValueEx(key, name, 0, winreg.REG_DWORD, value)
                else:
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
    except OSError:
        registry_ok = False
    return registry_ok


def _payload_stats(src):
    total_files = 0
    total_bytes = 0
    for root, _dirs, files in os.walk(src):
        for name in files:
            try:
                total_bytes += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
            total_files += 1
    return total_files, total_bytes


DATA_README = """РџР°РїРєР° РґР°РЅРЅС‹С… EZHednevnik.

Р—РґРµСЃСЊ С…СЂР°РЅСЏС‚СЃСЏ:
  planner.db              вЂ” Р±Р°Р·Р° РґР°РЅРЅС‹С… РїСЂРёР»РѕР¶РµРЅРёСЏ (Р·Р°РјРµС‚РєРё, Р›Р , РґСЂСѓР·СЊСЏ)
  custom_groups.json      вЂ” РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ РіСЂСѓРїРїС‹
  teachers.json           вЂ” РєСЌС€ СЃРїРёСЃРєР° РїСЂРµРїРѕРґР°РІР°С‚РµР»РµР№
  schedules\\              вЂ” РєСЌС€ СЂР°СЃРїРёСЃР°РЅРёСЏ РіСЂСѓРїРї
  teacher_schedules\\      вЂ” РєСЌС€ СЂР°СЃРїРёСЃР°РЅРёСЏ РїСЂРµРїРѕРґР°РІР°С‚РµР»РµР№
  moodle_cookies.json     вЂ” СЃРѕС…СЂР°РЅС‘РЅРЅР°СЏ СЃРµСЃСЃРёСЏ Moodle
  moodle_stats_cache.json вЂ” РєСЌС€ РѕС†РµРЅРѕРє Moodle
  moodle_errors.log       вЂ” Р¶СѓСЂРЅР°Р» РѕС€РёР±РѕРє Moodle
  .sync_times.json        вЂ” РІСЂРµРјСЏ РїРѕСЃР»РµРґРЅРµР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё

РџСЂРё РѕР±РЅРѕРІР»РµРЅРёРё РїСЂРёР»РѕР¶РµРЅРёСЏ СЌС‚Р° РїР°РїРєР° СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ.
"""


def install(target, want_shortcut, want_launch, progress=None, log=None,
            shortcut_dir=None):
    """РљРѕРїРёСЂСѓРµС‚ РїСЂРёР»РѕР¶РµРЅРёРµ. progress(percent, text), log(text)."""
    def emit(pct, text):
        if progress:
            progress(pct, text)

    def say(text):
        if log:
            log(text)

    target = os.path.abspath(target)
    if not os.path.isdir(PAYLOAD_DIR):
        raise RuntimeError("РќРµ РЅР°Р№РґРµРЅС‹ С„Р°Р№Р»С‹ РїСЂРёР»РѕР¶РµРЅРёСЏ РґР»СЏ СѓСЃС‚Р°РЅРѕРІРєРё.")
    payload_exe = os.path.join(PAYLOAD_DIR, "Ezh.exe")
    if not os.path.exists(payload_exe):
        raise RuntimeError("Р’ СѓСЃС‚Р°РЅРѕРІС‰РёРєРµ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ Ezh.exe.")

    if os.path.exists(target):
        if not os.path.isdir(target):
            raise RuntimeError("Р’С‹Р±СЂР°РЅРЅС‹Р№ РїСѓС‚СЊ СѓРєР°Р·С‹РІР°РµС‚ РЅР° С„Р°Р№Р», Р° РЅРµ РЅР° РїР°РїРєСѓ.")
        if not os.access(target, os.W_OK):
            raise RuntimeError(
                "РќРµС‚ РїСЂР°РІ РЅР° Р·Р°РїРёСЃСЊ РІ РІС‹Р±СЂР°РЅРЅСѓСЋ РїР°РїРєСѓ.\n"
                "Р’С‹Р±РµСЂРёС‚Рµ РїР°РїРєСѓ РІ РїСЂРѕС„РёР»Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ, РЅР°РїСЂРёРјРµСЂ "
                + _local_appdata_dir()
            )

    os.makedirs(target, exist_ok=True)

    total_files, total_bytes = _payload_stats(PAYLOAD_DIR)
    say(f"РЈСЃС‚Р°РЅРѕРІРєР° РІ {target}")
    say(f"Р¤Р°Р№Р»РѕРІ: {total_files}, РѕР±СЉС‘Рј: {total_bytes / 1048576:.1f} РњР‘")

    internal = os.path.join(target, "_internal")
    if os.path.isdir(internal):
        emit(2, "РЈРґР°Р»РµРЅРёРµ РїСЂРµРґС‹РґСѓС‰РµР№ РІРµСЂСЃРёРёвЂ¦")
        shutil.rmtree(internal, ignore_errors=True)

    done_bytes = 0
    copied = 0
    for root, _dirs, files in os.walk(PAYLOAD_DIR):
        rel = os.path.relpath(root, PAYLOAD_DIR)
        dst_root = target if rel == "." else os.path.join(target, rel)
        os.makedirs(dst_root, exist_ok=True)
        for name in files:
            src = os.path.join(root, name)
            dst = os.path.join(dst_root, name)
            try:
                shutil.copy2(src, dst)
                done_bytes += os.path.getsize(src)
            except OSError as e:
                raise RuntimeError(f"РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєРѕРїРёСЂРѕРІР°С‚СЊ {name}: {e}")
            copied += 1
            if copied % 25 == 0 or copied == total_files:
                pct = 3 + int(72 * done_bytes / max(1, total_bytes))
                emit(pct, f"РљРѕРїРёСЂРѕРІР°РЅРёРµ С„Р°Р№Р»РѕРІвЂ¦ {copied}/{total_files}")

    data_dir = os.path.join(target, "data")
    os.makedirs(data_dir, exist_ok=True)
    readme = os.path.join(data_dir, "README.txt")
    if not os.path.exists(readme):
        try:
            with open(readme, "w", encoding="utf-8") as f:
                f.write(DATA_README)
        except OSError:
            pass

    exe_path = os.path.join(target, "Ezh.exe")
    emit(80, "РЎРѕР·РґР°РЅРёРµ Р·Р°РїРёСЃРё РѕР± СѓРґР°Р»РµРЅРёРёвЂ¦")
    registry_ok = _write_uninstaller(target, exe_path, total_bytes / 1024)
    if not registry_ok:
        say("Р—Р°РїРёСЃСЊ РІ В«РЈСЃС‚Р°РЅРѕРІРєР° Рё СѓРґР°Р»РµРЅРёРµ РїСЂРѕРіСЂР°РјРјВ» СЃРѕР·РґР°С‚СЊ РЅРµ СѓРґР°Р»РѕСЃСЊ; "
            "СѓРґР°Р»РёС‚СЊ РїСЂРёР»РѕР¶РµРЅРёРµ РјРѕР¶РЅРѕ С„Р°Р№Р»РѕРј uninstall.bat РІ РїР°РїРєРµ СѓСЃС‚Р°РЅРѕРІРєРё.")

    shortcut_ok = None
    if want_shortcut:
        emit(88, "РЎРѕР·РґР°РЅРёРµ СЏСЂР»С‹РєР° РЅР° СЂР°Р±РѕС‡РµРј СЃС‚РѕР»РµвЂ¦")
        link_path = None
        if shortcut_dir:
            link_path = os.path.join(shortcut_dir, SHORTCUT_NAME)
        shortcut_ok = create_shortcut(exe_path, target, link_path)
        say("РЇСЂР»С‹Рє СЃРѕР·РґР°РЅ." if shortcut_ok else
            "РЇСЂР»С‹Рє СЃРѕР·РґР°С‚СЊ РЅРµ СѓРґР°Р»РѕСЃСЊ: " + (LAST_SHORTCUT_ERROR or "РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°"))

    emit(96, "Р—Р°РІРµСЂС€РµРЅРёРµвЂ¦")
    time.sleep(0.2)

    if want_launch:
        emit(99, "Р—Р°РїСѓСЃРє РїСЂРёР»РѕР¶РµРЅРёСЏвЂ¦")
        try:
            subprocess.Popen([exe_path], cwd=target, close_fds=True)
        except Exception as e:
            say(f"РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ РїСЂРёР»РѕР¶РµРЅРёРµ: {e}")

    emit(100, "Р“РѕС‚РѕРІРѕ")
    return shortcut_ok


# ============================================================
#  GUI
# ============================================================

BG = "#f4f6fb"
CARD = "#ffffff"
ACCENT = "#4f46e5"
ACCENT_HOVER = "#4338ca"
ACCENT_SOFT = "#eef2ff"
TEXT = "#111827"
MUTED = "#6b7280"
BORDER = "#e5e7eb"
SUCCESS = "#059669"


def _rounded(canvas, x1, y1, x2, y2, r, **kw):
    points = [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]
    return canvas.create_polygon(points, smooth=True, splinesteps=24, **kw)


class RoundButton:
    def __init__(self, parent, text, command, bg=ACCENT, fg="#ffffff",
                 hover=ACCENT_HOVER, width=180, height=44, font=("Segoe UI", 10, "bold")):
        import tkinter as tk
        self.parent = parent
        self.command = command
        self.bg = bg
        self.fg = fg
        self.hover = hover
        self.enabled = True
        self.text = text
        self.canvas = tk.Canvas(parent, width=width, height=height,
                                bg=parent["bg"], highlightthickness=0, cursor="hand2")
        self.w, self.h = width, height
        self.font = font
        self._draw()
        self.canvas.bind("<Enter>", lambda _e: self._draw(self.hover))
        self.canvas.bind("<Leave>", lambda _e: self._draw())
        self.canvas.bind("<Button-1>", self._click)

    def _draw(self, fill=None):
        self.canvas.delete("all")
        fill = fill or self.bg
        if not self.enabled:
            fill = "#c7cbd6"
        _rounded(self.canvas, 1, 1, self.w - 1, self.h - 1, 12,
                 fill=fill, outline="")
        self.canvas.create_text(self.w / 2, self.h / 2, text=self.text,
                                fill=self.fg, font=self.font)

    def _click(self, _e):
        if self.enabled and self.command:
            self.command()

    def set_state(self, enabled):
        self.enabled = enabled
        self.canvas.configure(cursor="hand2" if enabled else "arrow")
        self._draw()

    def set_text(self, text):
        self.text = text
        self._draw()

    def place(self, **kw):
        self.canvas.place(**kw)


def _gradient(canvas, width, height, top, bottom):
    """Р’РµСЂС‚РёРєР°Р»СЊРЅС‹Р№ РіСЂР°РґРёРµРЅС‚ РІ С€Р°РїРєРµ."""
    def hex_rgb(c):
        return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
    r1, g1, b1 = hex_rgb(top)
    r2, g2, b2 = hex_rgb(bottom)
    for y in range(height):
        t = y / max(1, height - 1)
        color = "#%02x%02x%02x" % (
            int(r1 + (r2 - r1) * t),
            int(g1 + (g2 - g1) * t),
            int(b1 + (b2 - b1) * t),
        )
        canvas.create_line(0, y, width, y, fill=color)


def run_gui(default_dir, want_shortcut=True, want_launch=True, preselect_shortcut=None,
            preselect_launch=None, shortcut_dir=None):
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    if preselect_shortcut is not None:
        want_shortcut = preselect_shortcut
    if preselect_launch is not None:
        want_launch = preselect_launch

    root = tk.Tk()
    root.title(f"РЈСЃС‚Р°РЅРѕРІРєР° {APP_TITLE}")
    root.geometry("660x640")
    root.resizable(False, False)
    root.configure(bg=BG)

    try:
        root.iconbitmap(os.path.join(RES_DIR, "icon.ico"))
    except Exception:
        pass

    header = tk.Canvas(root, width=660, height=118, highlightthickness=0, bg=BG)
    header.pack(fill="x")
    _gradient(header, 660, 118, "#4f46e5", "#7c3aed")
    _rounded(header, 30, 34, 78, 82, 14, fill="#ffffff", outline="")
    header.create_text(54, 58, text="E", font=("Segoe UI", 24, "bold"),
                       fill="#4f46e5", anchor="c")
    header.create_text(98, 40, text="EZHednevnik", font=("Segoe UI", 21, "bold"),
                       fill="white", anchor="w")
    header.create_text(99, 72, text="РґРЅРµРІРЅРёРє СЃС‚СѓРґРµРЅС‚Р° РЎРµРІР“РЈ", font=("Segoe UI", 10),
                       fill="#e0e7ff", anchor="w")
    header.create_text(99, 94, text="РЈСЃС‚Р°РЅРѕРІРєР° РїСЂРёР»РѕР¶РµРЅРёСЏ", font=("Segoe UI", 9),
                       fill="#c7d2fe", anchor="w")
    header.create_text(
        620, 30, text="РІРµСЂСЃРёСЏ " + payload_version(),
        font=("Segoe UI", 9), fill="#e0e7ff", anchor="e")

    footer = tk.Frame(root, bg=BG)
    footer.pack(side="bottom", fill="x", padx=28, pady=(0, 16))

    body = tk.Frame(root, bg=BG)
    body.pack(fill="both", expand=True, padx=28, pady=(16, 0))

    tk.Label(body, text="РљСѓРґР° СѓСЃС‚Р°РЅРѕРІРёС‚СЊ", font=("Segoe UI", 10, "bold"),
             bg=BG, fg=TEXT).pack(anchor="w")

    path_row = tk.Frame(body, bg=BG)
    path_row.pack(fill="x", pady=(6, 4))
    entry_wrap = tk.Frame(path_row, bg=CARD, highlightbackground=BORDER,
                          highlightthickness=1)
    entry_wrap.pack(side="left", fill="x", expand=True)
    path_var = tk.StringVar(value=default_dir)
    path_entry = tk.Entry(entry_wrap, textvariable=path_var, bd=0,
                          font=("Segoe UI", 10), bg=CARD, fg=TEXT,
                          insertbackground=TEXT)
    path_entry.pack(fill="x", padx=10, pady=9)

    def browse():
        chosen = filedialog.askdirectory(
            title="РљСѓРґР° СѓСЃС‚Р°РЅРѕРІРёС‚СЊ Ezh",
            initialdir=os.path.dirname(path_var.get()) or SETUP_DIR,
        )
        if chosen:
            path_var.set(
                chosen if os.path.basename(chosen).lower() == "ezh"
                else os.path.join(chosen, "Ezh"))

    browse_btn = tk.Button(path_row, text="РћР±Р·РѕСЂвЂ¦", command=browse,
                           font=("Segoe UI", 9), bg=CARD, fg=TEXT,
                           activebackground="#f3f4f6", relief="flat",
                           bd=0, padx=14, pady=9, cursor="hand2",
                           highlightthickness=1, highlightbackground=BORDER)
    browse_btn.pack(side="left", padx=(8, 0))

    tk.Label(body, text="РЈСЃС‚Р°РЅРѕРІС‰РёРє СЃРѕР·РґР°СЃС‚ РїР°РїРєСѓ Ezh Рё РїРѕРґРїР°РїРєСѓ data "
                        "РґР»СЏ СЂР°СЃРїРёСЃР°РЅРёР№, Р·Р°РјРµС‚РѕРє Рё РєСЌС€Р°.",
             font=("Segoe UI", 8), bg=BG, fg=MUTED,
             justify="left").pack(anchor="w", pady=(0, 14))

    card = tk.Frame(body, bg=ACCENT_SOFT, highlightbackground="#dbe3ff",
                    highlightthickness=1)
    card.pack(fill="x")
    tk.Label(card, text="Р§С‚Рѕ Р±СѓРґРµС‚ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ", font=("Segoe UI", 9, "bold"),
             bg=ACCENT_SOFT, fg=ACCENT).pack(anchor="w", padx=14, pady=(10, 2))
    files_count, total_bytes = _payload_stats(PAYLOAD_DIR)
    tk.Label(card,
             text=f"РџСЂРёР»РѕР¶РµРЅРёРµ Ezh.exe  вЂў  {total_bytes / 1048576:.0f} РњР‘  вЂў  "
                  f"{files_count} С„Р°Р№Р»РѕРІ\n"
                  "РЇСЂР»С‹Рє Р·Р°РїСѓСЃРєР° вЂ” РїРѕ Р¶РµР»Р°РЅРёСЋ. РџСЂР°РІР° Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР° РЅРµ РЅСѓР¶РЅС‹.",
             font=("Segoe UI", 8), bg=ACCENT_SOFT, fg="#374151",
             justify="left").pack(anchor="w", padx=14, pady=(0, 10))

    opts = tk.Frame(body, bg=BG)
    opts.pack(fill="x", pady=(16, 0))
    sc_var = tk.BooleanVar(value=want_shortcut)
    ln_var = tk.BooleanVar(value=want_launch)
    for text, var in (
        ("РЎРѕР·РґР°С‚СЊ СЏСЂР»С‹Рє РЅР° СЂР°Р±РѕС‡РµРј СЃС‚РѕР»Рµ", sc_var),
        ("Р—Р°РїСѓСЃС‚РёС‚СЊ РїСЂРёР»РѕР¶РµРЅРёРµ РїРѕСЃР»Рµ СѓСЃС‚Р°РЅРѕРІРєРё", ln_var),
    ):
        cb = tk.Checkbutton(opts, text=text, variable=var, bg=BG,
                            activebackground=BG, fg=TEXT, font=("Segoe UI", 9),
                            anchor="w", bd=0, highlightthickness=0,
                            selectcolor=CARD, cursor="hand2")
        cb.pack(anchor="w", pady=1)

    progress_canvas = tk.Canvas(body, width=604, height=10, bg=BG,
                                highlightthickness=0)
    progress_canvas.pack(fill="x", pady=(18, 6))
    status_var = tk.StringVar(value="Р“РѕС‚РѕРІРѕ Рє СѓСЃС‚Р°РЅРѕРІРєРµ")
    status_lbl = tk.Label(body, textvariable=status_var, font=("Segoe UI", 8),
                          bg=BG, fg=MUTED, anchor="w")
    status_lbl.pack(fill="x")

    def draw_progress(pct):
        progress_canvas.delete("all")
        w = max(progress_canvas.winfo_width(), 604)
        _rounded(progress_canvas, 0, 0, w, 9, 5, fill="#e5e7eb", outline="")
        if pct > 0:
            _rounded(progress_canvas, 0, 0, max(10, w * pct / 100), 9, 5,
                     fill=ACCENT, outline="")

    draw_progress(0)

    buttons = tk.Frame(footer, bg=BG)
    buttons.pack(fill="x")

    state = {"busy": False, "ok": False}
    q = queue.Queue()

    install_btn = RoundButton(buttons, "РЈСЃС‚Р°РЅРѕРІРёС‚СЊ", None, width=190, height=46,
                              font=("Segoe UI", 11, "bold"))
    install_btn.canvas.pack(side="right")

    cancel_btn = RoundButton(buttons, "РћС‚РјРµРЅР°", root.destroy, bg="#e5e7eb",
                             fg=TEXT, hover="#d1d5db", width=120, height=46,
                             font=("Segoe UI", 10))
    cancel_btn.canvas.pack(side="right", padx=(0, 10))

    def worker(target, shortcut, launch):
        try:
            def prog(pct, text):
                q.put(("progress", pct, text))

            def log(text):
                q.put(("log", 0, text))

            ok = install(target, shortcut, launch, progress=prog, log=log,
                         shortcut_dir=shortcut_dir)
            q.put(("done", 0, ok))
        except Exception as e:
            q.put(("error", 0, str(e)))

    def poll():
        try:
            while True:
                kind, pct, text = q.get_nowait()
                if kind == "progress":
                    draw_progress(pct)
                    status_var.set(text)
                elif kind == "log":
                    status_var.set(text)
                elif kind == "done":
                    state["busy"] = False
                    state["ok"] = True
                    draw_progress(100)
                    status_var.set("РЈСЃС‚Р°РЅРѕРІРєР° Р·Р°РІРµСЂС€РµРЅР°.")
                    status_lbl.configure(fg=SUCCESS)
                    install_btn.set_text("Р—Р°РєСЂС‹С‚СЊ")
                    install_btn.command = root.destroy
                    install_btn.set_state(True)
                    cancel_btn.set_state(False)
                    msg = f"{APP_TITLE} СѓСЃС‚Р°РЅРѕРІР»РµРЅ РІ:\n{path_var.get()}"
                    msg += "\n\nР”Р°РЅРЅС‹Рµ РїСЂРёР»РѕР¶РµРЅРёСЏ: РїРѕРґРїР°РїРєР° data."
                    if text is False:
                        msg += ("\n\nРЇСЂР»С‹Рє РЅР° СЂР°Р±РѕС‡РµРј СЃС‚РѕР»Рµ СЃРѕР·РґР°С‚СЊ РЅРµ СѓРґР°Р»РѕСЃСЊ."
                                "\nРџРѕРґСЂРѕР±РЅРѕСЃС‚Рё: EzhSetup_shortcut.log")
                    if ln_var.get():
                        msg += "\n\nРџСЂРёР»РѕР¶РµРЅРёРµ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏвЂ¦"
                    messagebox.showinfo("РЈСЃС‚Р°РЅРѕРІРєР° Р·Р°РІРµСЂС€РµРЅР°", msg, parent=root)
                    return
                elif kind == "error":
                    state["busy"] = False
                    install_btn.set_state(True)
                    cancel_btn.set_state(True)
                    status_var.set("РЈСЃС‚Р°РЅРѕРІРєР° РЅРµ РІС‹РїРѕР»РЅРµРЅР°.")
                    status_lbl.configure(fg="#dc2626")
                    messagebox.showerror("РћС€РёР±РєР° СѓСЃС‚Р°РЅРѕРІРєРё", text, parent=root)
                    return
        except queue.Empty:
            pass
        if state["busy"]:
            root.after(120, poll)

    def start():
        if state["busy"]:
            return
        target = path_var.get().strip().strip('"')
        if not target:
            messagebox.showwarning("РџР°РїРєР° СѓСЃС‚Р°РЅРѕРІРєРё", "РЈРєР°Р¶РёС‚Рµ РїР°РїРєСѓ СѓСЃС‚Р°РЅРѕРІРєРё.",
                                   parent=root)
            return
        if os.path.exists(os.path.join(target, "Ezh.exe")) and not messagebox.askyesno(
            "РћР±РЅРѕРІР»РµРЅРёРµ",
            "Р’ СЌС‚РѕР№ РїР°РїРєРµ СѓР¶Рµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ EZHednevnik.\n\n"
            "РћР±РЅРѕРІРёС‚СЊ РїСЂРѕРіСЂР°РјРјСѓ? Р›РёС‡РЅС‹Рµ РґР°РЅРЅС‹Рµ РІ РїР°РїРєРµ data СЃРѕС…СЂР°РЅСЏС‚СЃСЏ.",
            parent=root,
        ):
            return
        state["busy"] = True
        install_btn.set_state(False)
        cancel_btn.set_state(False)
        draw_progress(0)
        status_lbl.configure(fg=MUTED)
        status_var.set("РџРѕРґРіРѕС‚РѕРІРєР°вЂ¦")
        threading.Thread(
            target=worker, args=(target, sc_var.get(), ln_var.get()), daemon=True
        ).start()
        root.after(120, poll)

    install_btn.command = start
    root.bind("<Return>", lambda _e: start() if not state["busy"] else None)
    if os.environ.get("EZH_DEBUG_GEOM"):
        root.update_idletasks()
        print("GEOM", root.winfo_height(), body.winfo_height(),
              footer.winfo_height(), buttons.winfo_height(),
              install_btn.canvas.winfo_ismapped(),
              "rooty", root.winfo_rooty(), "footer_y", footer.winfo_rooty(),
              "btn_y", install_btn.canvas.winfo_rooty(),
              "btn_w", install_btn.canvas.winfo_width(),
              "items", len(install_btn.canvas.find_all()),
              "at", root.winfo_containing(root.winfo_rootx() + 500,
                                          root.winfo_rooty() + 620), flush=True)
    root.mainloop()


# ============================================================
#  ENTRY POINT
# ============================================================

def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--silent", action="store_true", help="Р±РµР· РёРЅС‚РµСЂС„РµР№СЃР°")
    ap.add_argument("--dir", default=None, help="РїР°РїРєР° СѓСЃС‚Р°РЅРѕРІРєРё")
    ap.add_argument("--shortcut", dest="shortcut", action="store_true", default=None)
    ap.add_argument("--no-shortcut", dest="shortcut", action="store_false")
    ap.add_argument("--launch", dest="launch", action="store_true", default=None)
    ap.add_argument("--no-launch", dest="launch", action="store_false")
    ap.add_argument("--shortcut-dir", default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()

    target = args.dir or default_install_dir()
    shortcut = True if args.shortcut is None else args.shortcut
    launch = True if args.launch is None else args.launch

    if args.silent:
        try:
            ok = install(
                target, shortcut, launch,
                progress=lambda p, t: print(f"[{p:3d}%] {t}", flush=True),
                log=lambda t: print(t, flush=True),
                shortcut_dir=args.shortcut_dir,
            )
            print("OK" if ok is not False else "OK (Р±РµР· СЏСЂР»С‹РєР°)", flush=True)
            return 0
        except Exception as e:
            traceback.print_exc()
            print(f"ERROR: {e}", file=sys.stderr, flush=True)
            return 1

    run_gui(
        target,
        preselect_shortcut=args.shortcut,
        preselect_launch=args.launch,
        shortcut_dir=args.shortcut_dir,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())


