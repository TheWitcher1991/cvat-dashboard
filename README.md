# НЦМУ Мониторинг разметки

Мониторинг разметчиков CVAT для Научного центра мирового уровня «Агроинженерия будущего» (СтГАУ). Веб-интерфейс на FastAPI + CVAT SDK.

## Запуск

```powershell
.venv\Scripts\Activate.ps1
$env:CVAT_USERNAME="admin"
$env:CVAT_PASSWORD="password"
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Открыть `http://127.0.0.1:8000`

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `CVAT_HOST` | `http://localhost:8080` | URL CVAT сервера |
| `CVAT_USERNAME` | `admin` | Логин |
| `CVAT_PASSWORD` | — | Пароль |
| `ORG_ID` | `6` | ID организации |

## Эндпоинты

- `GET /` — веб-интерфейс
- `GET /api/annotators` — список участников организации
- `GET /api/annotators/batch-stats` — статистика по всем разметчикам
- `GET /api/annotators/{id}/stats` — статистика по одному пользователю
- `GET /api/overview` — общая сводка (проекты, задачи, jobs)
