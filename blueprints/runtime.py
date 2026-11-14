"""Общий runtime-контейнер: пути, экземпляры планировщиков, версия.

Заполняется в app.py на старте, читается из blueprints.
Без этого пришлось бы тащить всё через current_app.config и терять
производительность на каждом обращении.
"""

# Заполняется в app.py
IS_EXE              = False
BASE_DIR            = ''
BUNDLE_DIR          = ''
DB_FILE             = ''
SCHEDULES_DIR       = ''
CUSTOM_GROUPS_FILE  = ''
SYNC_TIMES_FILE     = ''
GROUPS_FILE         = ''
TEMPLATES_DIR       = ''
STATIC_DIR          = ''
APP_VERSION         = 'dev'
MIN_SYNC_INTERVAL   = 6 * 3600

planner             = None
teacher_planner     = None