@echo off
chcp 65001 >nul
cd /d "%~dp0"

title Every-SevGU [DEBUG]

where python >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не найден в PATH.
    echo Установи Python или добавь его в переменную PATH.
    pause
    exit /b 1
)

echo === Every-SevGU (DEBUG) ===
echo Режим отладки: подробные логи + автоперезагрузка при изменении файлов.
echo Сервер: http://127.0.0.1:5000
echo Браузер откроется автоматически через 3 секунды.
echo.
echo Чтобы остановить - нажми Ctrl+C в этом окне.
echo.

REM Включаем debug-режим Flask (читается в app.py)
set FLASK_DEBUG=1

REM Браузер открывает сам Python (см. app.py, _run_console_mode).
REM Второй запуск из .bat приводил к двум вкладкам - убран.

python app.py

echo.
echo === Сервер остановлен ===
pause