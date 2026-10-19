import json
import re
import requests

MOODLE_URL = "https://do.sevsu.ru"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def load_session():
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    try:
        with open("moodle_cookies.json", "r", encoding="utf-8") as f:
            cookies = json.load(f)
            for name, value in cookies.items():
                session.cookies.set(name, value, domain="do.sevsu.ru")
        return session
    except FileNotFoundError:
        print("❌ Файл moodle_cookies.json не найден. Сначала запустите test_moodle_auth.py")
        return None

def clean_html(text):
    """Убирает HTML-теги и лишние пробелы"""
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()

def get_courses(session):
    """Возвращает список кортежей (id, name)"""
    print("⏳ Загружаем список курсов...")
    r = session.get(f"{MOODLE_URL}/my/", timeout=20)
    if "auth.sevsu.ru" in r.url:
        print("❌ Сессия устарела. Запустите test_moodle_auth.py")
        return []
    
    # Ищем ссылки на курсы
    course_pattern = re.compile(r'<a[^>]+href="[^"]*?/course/view\.php\?id=(\d+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
    courses = []
    seen = set()
    for match in course_pattern.finditer(r.text):
        cid = match.group(1)
        name = clean_html(match.group(2))
        # Фильтруем мусор и короткие названия
        if name and len(name) > 3 and cid not in seen:
            seen.add(cid)
            courses.append((cid, name))
    return courses

def parse_course_activities(session, course_id):
    """Возвращает список заданий (assign/quiz) в курсе"""
    r = session.get(f"{MOODLE_URL}/course/view.php?id={course_id}", timeout=20)
    if "auth.sevsu.ru" in r.url: return []
    
    # Ищем только assign и quiz
    act_pattern = re.compile(r'<a[^>]+href="[^"]*?/mod/(assign|quiz)/view\.php\?id=(\d+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
    activities = []
    seen = set()
    for match in act_pattern.finditer(r.text):
        mod_type = match.group(1).lower()
        mod_id = match.group(2)
        name = clean_html(match.group(3))
        
        # Убираем лишние слова вроде "Задание" или "Тест" в конце названия
        name = re.sub(r'\s+(Задание|Тест)$', '', name, flags=re.IGNORECASE)
        
        if name and mod_id not in seen:
            seen.add(mod_id)
            activities.append({
                "id": mod_id,
                "type": mod_type,
                "name": name
            })
    return activities

def get_assign_status(session, assign_id):
    """Возвращает (status, grade) для конкретного задания"""
    r = session.get(f"{MOODLE_URL}/mod/assign/view.php?id={assign_id}", timeout=20)
    html = r.text
    
    status = "Неизвестно"
    grade = "Без оценки"
    
    # 1. Ищем статус сдачи (Сдано / Не сдано / Отправлено для оценивания)
    # Обычно это текст внутри ячейки таблицы с классом submissionstatus...
    status_match = re.search(r'<td[^>]*class="[^"]*submissionstatus[^"]*"[^>]*>(.*?)</td>', html, re.DOTALL | re.IGNORECASE)
    if status_match:
        status = clean_html(status_match.group(1))
    else:
        # Если таблицы нет, ищем по ключевым словам
        if "Сдано" in html or "Отправлено для оценивания" in html:
            status = "Отправлено для оценивания"
        elif "Не сдано" in html or "Черновик" in html:
            status = "Не сдано"
        elif "Оценено" in html:
            status = "Оценено"

    # 2. Ищем оценку
    # Она может быть в таблице с классом "grade" или в блоке "Оценка"
    grade_match = re.search(r'<td[^>]*class="[^"]*grade[^"]*"[^>]*>(.*?)</td>', html, re.DOTALL | re.IGNORECASE)
    if grade_match:
        grade_raw = clean_html(grade_match.group(1))
        # Если оценка содержит цифры (например, "5,00 / 5,00"), берем её
        if re.search(r'\d', grade_raw):
            grade = grade_raw
    else:
        # Иногда оценка в отдельном блоке
        grade_match_alt = re.search(r'Оценка:\s*<[^>]+>(.*?)<', html, re.IGNORECASE)
        if grade_match_alt:
            grade = clean_html(grade_match_alt.group(1))

    # Приводим статусы к единому виду
    if "Отправлено" in status:
        status = "На проверке"
    elif "Не оценено" in status or "Без оценки" in status:
        status = "Ожидает оценки"
        
    return status, grade

def main():
    session = load_session()
    if not session: return

    courses = get_courses(session)
    print(f"\n📚 Найдено курсов: {len(courses)}\n")
    
    for course_id, course_name in courses:
        # Пропускаем пустые/скрытые курсы
        if not course_name: continue
        
        print(f"📖 {course_name}")
        activities = parse_course_activities(session, course_id)
        
        if not activities:
            print("   (Нет заданий или тестов)\n")
            continue
            
        for act in activities:
            if act['type'] == 'assign':
                status, grade = get_assign_status(session, act['id'])
                print(f"   📝 {act['name']}")
                print(f"      Статус: {status} | Оценка: {grade}")
            else:
                # Для тестов (quiz) логика немного другая, но для начала выведем просто название
                print(f"   🧪 {act['name']} (Тест)")
        print("-" * 50)

if __name__ == "__main__":
    main()