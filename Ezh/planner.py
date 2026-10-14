import requests
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

class SevSUPlanner:
    def __init__(self):
        self.api_url = "https://schedule.sevsu.ru/api/schedule"
        self.groups_api = "https://schedule.sevsu.ru/api/groups"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)

        # Retry-политика: 3 попытки с экспоненциальным backoff.
        # pool_block=False — при исчерпании пула создаём временные соединения,
        # чтобы 8 параллельных запросов не сериализовались.
        try:
            from requests.adapters import HTTPAdapter
            from urllib3.util.retry import Retry
            retry = Retry(
                total=3,
                backoff_factor=0.5,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=frozenset(["GET"]),
            )
            adapter = HTTPAdapter(
                max_retries=retry,
                pool_connections=16,
                pool_maxsize=16,
                pool_block=False,
            )
            self.session.mount("https://", adapter)
            self.session.mount("http://", adapter)
        except ImportError:
            pass

        self.time_map = {
            1: "08:30 - 10:00",
            2: "10:10 - 11:40",
            3: "11:50 - 13:20",
            4: "14:00 - 15:30",
            5: "15:40 - 17:10",
            6: "17:20 - 18:50",
            7: "19:00 - 20:30",
            8: "20:40 - 22:10"
        }

        # КОДИРОВКА ТИПОВ ЗАНЯТИЙ В API СевГУ
        # ------------------------------------
        # Раньше здесь были перепутаны 1 и 2, из-за чего ПЗ отображался как ЛЗ
        # и наоборот. Проверено сопоставлением с визуальной сеткой сайта
        # schedule.sevsu.ru: 1 = ЛЗ, 2 = ПЗ.
        #   0 — Лекция
        #   1 — ЛЗ (лабораторное занятие)
        #   2 — ПЗ (практическое занятие)
        #   3 — Экзамен/Зачёт
        self.type_map = {0: "Лекция", 1: "ЛЗ", 2: "ПЗ", 3: "Экзамен/Зачет"}

        self.holidays = {
            (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8),
            (2, 23),
            (3, 8),
            (5, 1),
            (5, 9),
            (6, 12),
            (11, 4)
        }

    def get_semester_season(self, date_obj: datetime) -> int:
        if 9 <= date_obj.month <= 12:
            return 1
        elif 2 <= date_obj.month <= 6:
            return 2
        return 0

    def is_valid_study_day(self, date_obj: datetime) -> bool:
        if date_obj.month in (1, 7, 8):
            return False
        if (date_obj.month, date_obj.day) in self.holidays:
            return False
        return True

    def get_schedule_for_week(self, group_name: str, week: int) -> list:
        params = {"v": "6.2", "section": "0", "group": group_name, "week": week}
        try:
            response = self.session.get(self.api_url, params=params, timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    return data.get("schedule") or []
        except (requests.RequestException, ValueError):
            pass
        return []

    def _fetch_weeks_parallel(self, group_name: str, weeks) -> dict:
        """Параллельно тянет расписание для списка недель.

        Раньше это был последовательный цикл из 25 запросов — холодный старт
        занимал до 125 секунд. Теперь — обычно 3-6 секунд.
        """
        results = {}
        with ThreadPoolExecutor(max_workers=8) as ex:
            future_to_week = {
                ex.submit(self.get_schedule_for_week, group_name, w): w
                for w in weeks
            }
            for fut in as_completed(future_to_week):
                w = future_to_week[fut]
                try:
                    results[w] = fut.result()
                except Exception:
                    results[w] = []
        return results

    def get_semester_schedule(self, group_name: str, target_subgroup: str = "0",
                              max_weeks: int = 25) -> list:
        full_schedule = []

        # Шаблон — самая полная неделя своей чётности, а не последняя.
        # Иначе короткая экзаменационная неделя становится шаблоном.
        odd_template = None
        odd_template_week = None
        odd_template_len = 0
        even_template = None
        even_template_week = None
        even_template_len = 0

        all_weeks = list(range(1, max_weeks + 1))
        weeks_data = self._fetch_weeks_parallel(group_name, all_weeks)

        target_is_all = (target_subgroup == "0")

        for week in all_weeks:
            week_data = weeks_data.get(week, [])

            if week_data:
                processed_week = []
                for item in week_data:
                    if target_is_all:
                        take = True
                    else:
                        item_subgroup = str(item.get("subgroup", "0"))
                        take = (item_subgroup == "0" or item_subgroup == target_subgroup)
                    if take:
                        new_item = item.copy()
                        new_item["time_range"] = self.time_map.get(new_item.get("n"), "")
                        new_item["type_name"] = self.type_map.get(new_item.get("type"), "Занятие")
                        processed_week.append(new_item)

                full_schedule.extend(processed_week)

                if week % 2 != 0:
                    if len(processed_week) > odd_template_len:
                        odd_template = processed_week
                        odd_template_week = week
                        odd_template_len = len(processed_week)
                else:
                    if len(processed_week) > even_template_len:
                        even_template = processed_week
                        even_template_week = week
                        even_template_len = len(processed_week)

            else:
                template_to_use = None
                template_week = None

                if week % 2 != 0 and odd_template:
                    template_to_use = odd_template
                    template_week = odd_template_week
                elif week % 2 == 0 and even_template:
                    template_to_use = even_template
                    template_week = even_template_week

                if template_to_use:
                    diff_weeks = week - template_week

                    for item in template_to_use:
                        extrapolated_item = item.copy()
                        if "date" in extrapolated_item:
                            try:
                                date_str = extrapolated_item["date"].split("T")[0]
                                orig_date = datetime.strptime(date_str, "%Y-%m-%d")
                                new_date = orig_date + timedelta(days=diff_weeks * 7)

                                orig_season = self.get_semester_season(orig_date)
                                new_season = self.get_semester_season(new_date)

                                if orig_season == 0 or orig_season != new_season:
                                    continue

                                if not self.is_valid_study_day(new_date):
                                    continue

                                extrapolated_item["date"] = new_date.strftime("%Y-%m-%d")
                            except ValueError:
                                pass

                        full_schedule.append(extrapolated_item)

        return full_schedule
