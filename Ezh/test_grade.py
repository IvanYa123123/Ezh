import json
import requests

MOODLE_URL = "https://do.sevsu.ru"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def load_session():
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    with open("moodle_cookies.json", "r", encoding="utf-8") as f:
        cookies = json.load(f)
        for name, value in cookies.items():
            session.cookies.set(name, value, domain="do.sevsu.ru")
    return session

session = load_session()

# Просим тебя ввести ID задания, за которое уже стоит оценка
print("Зайди в Moodle, открой любую лабораторную, за которую тебе уже поставили оценку (например, 5 или 'Зачтено').")
assign_id = input("Посмотри на ссылку в браузере (в конце будет id=123456) и введи это число: ").strip()

url = f"{MOODLE_URL}/mod/assign/view.php?id={assign_id}"
print(f"\nСкачиваем страницу {url} ...")

r = session.get(url)

with open("debug_assign.html", "w", encoding="utf-8") as f:
    f.write(r.text)

print(f"✅ Готово! Страница сохранена в файл debug_assign.html (размер: {len(r.text)} символов).")
print("Открой этот файл блокнотом (или VS Code), найди там свою оценку (например, цифру 5 или слово 'Оценено') и пришли мне кусочек кода вокруг нее.")