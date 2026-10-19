import re
import getpass
import requests
from urllib.parse import urlparse, parse_qs

MOODLE_URL = "https://do.sevsu.ru"
LOGIN_URL  = f"{MOODLE_URL}/login/index.php"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def main():
    print("=== Умный вход в Moodle через Keycloak ===")
    username = input("Логин: ").strip()
    password = getpass.getpass("Пароль: ")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    # 1. Заходим на главную страницу Moodle
    print("\n[1] Загружаем страницу входа Moodle...")
    r = session.get(LOGIN_URL, timeout=20)
    print(f"    HTTP {r.status_code}")

    # 2. Ищем ссылку на SSO (кнопка "СевГУ.Аккаунт")
    print("[2] Ищем ссылку на СевГУ.Аккаунт...")
    match = re.search(r'href="([^"]*auth/oauth2/login\.php[^"]*)"', r.text)
    if not match:
        print("    ❌ Не нашли ссылку на SSO. Возможно, изменилась верстка.")
        return
    
    sso_url = match.group(1).replace("&amp;", "&")
    print(f"    Нашли: {sso_url}")

    # 3. Переходим по ссылке (должен быть редирект на auth.sevsu.ru)
    print("[3] Переходим на страницу Keycloak...")
    r = session.get(sso_url, timeout=20)
    print(f"    HTTP {r.status_code}, URL: {r.url[:80]}...")

    # 4. Парсим форму Keycloak
    print("[4] Извлекаем форму логина Keycloak...")
    action_match = re.search(r'<form[^>]+action="([^"]+)"', r.text)
    if not action_match:
        print("    ❌ Не нашли форму на странице Keycloak.")
        return
    
    form_action = action_match.group(1).replace("&amp;", "&")
    if form_action.startswith("/"):
        form_action = "https://auth.sevsu.ru" + form_action
        
    # Собираем все скрытые поля (execution, client_id, tab_id и т.д.)
    inputs = re.findall(r'<input[^>]+name="([^"]+)"[^>]*value="([^"]*)"', r.text)
    form_data = {name: value for name, value in inputs}
    
    # Добавляем логин и пароль
    form_data["username"] = username
    form_data["password"] = password
    form_data.setdefault("credentialId", "")
    
    print(f"    Action: {form_action[:80]}...")
    print(f"    Поля: {list(form_data.keys())}")

    # 5. Отправляем логин и пароль в Keycloak
    print("[5] Отправляем логин и пароль...")
    r = session.post(form_action, data=form_data, allow_redirects=True, timeout=20)
    print(f"    HTTP {r.status_code}, финальный URL: {r.url}")

    if "auth.sevsu.ru" in r.url:
        print("    ❌ Остались на странице Keycloak. Проверьте логин/пароль или CAPTCHA.")
        return

    # 6. Проверяем, что мы в личном кабинете Moodle
    print("[6] Проверяем личный кабинет...")
    if "/my/" in r.url or "course" in r.url:
        print("    ✅ УСПЕХ! Мы вошли в Moodle.")
        print(f"    Cookies: {list(session.cookies.keys())}")
        
        # Сохраняем cookies для дальнейшего использования
        with open("moodle_cookies.json", "w", encoding="utf-8") as f:
            import json
            json.dump({c.name: c.value for c in session.cookies}, f)
        print("    💾 Cookies сохранены в moodle_cookies.json")
    else:
        print("    ⚠️ Не удалось однозначно определить успешный вход.")
        print(f"    Первые 300 символов ответа: {r.text[:300]!r}")

if __name__ == "__main__":
    main()