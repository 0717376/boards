"""Live timestamp prepended to every turn — a long-lived session's system
prompt carries the date of its first turn only, so the clock would drift."""

from datetime import datetime

_DAYS_RU = ("понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье")
_MONTHS_RU = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля",
              "августа", "сентября", "октября", "ноября", "декабря")
_DAYS_EN = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS_EN = ("January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December")


def stamp(lang: str = "ru", now: datetime | None = None) -> str:
    now = now or datetime.now()
    if lang == "en":
        return f"[Now: {_DAYS_EN[now.weekday()]}, {_MONTHS_EN[now.month - 1]} {now.day}, {now.year}, {now:%H:%M}]"
    return f"[Сейчас: {_DAYS_RU[now.weekday()]}, {now.day} {_MONTHS_RU[now.month - 1]} {now.year}, {now:%H:%M}]"
