# -*- mode: python ; coding: utf-8 -*-
# Ezh.spec — сборка Ezh.exe

from PyInstaller.utils.hooks import collect_all

limits_datas, limits_binaries, limits_hidden = collect_all('limits')

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=limits_binaries,
    datas=[
        ('Group.txt', '.'),
        ('VERSION', '.'),
        ('templates', 'templates'),
        ('static', 'static'),
        ('vendor', 'vendor'),
    ] + limits_datas,
    hiddenimports=[
        'flask_limiter',
        'flask_limiter.util',
        'tkinter',
        'tkinter.ttk',
        'tkinter.messagebox',
        'bs4',
        'lxml',
        'lxml.etree',
        'pythoncom',
        'pywintypes',
        'win32com',
        'win32com.shell',
        'win32com.shell.shell',
    ] + limits_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Ezh',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Ezh',
)