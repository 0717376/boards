"""Live timestamp prepended to every turn — a long-lived session's system
prompt carries the date of its first turn only, so the clock would drift."""

from datetime import datetime

_DAYS = ("понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье")
_MONTHS = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля",
           "августа", "сентября", "октября", "ноября", "декабря")


def stamp(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return f"[Сейчас: {_DAYS[now.weekday()]}, {now.day} {_MONTHS[now.month - 1]} {now.year}, {now:%H:%M}]"
