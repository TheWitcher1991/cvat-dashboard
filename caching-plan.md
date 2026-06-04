# План по кешированию

## Проблема
Запросы к CVAT API медленные (особенно `/api/annotators`, `/api/events`, `/api/groups/stats`). При каждом переключении на Пользователи или Ленту событий данные запрашиваются заново.

## Варианты

### 1. In-memory кеш (простейший)
- Хранить данные в глобальном объекте `window.__cache`
- Время жизни (TTL) — 5-10 минут
- При каждом fetch сначала проверять кеш
- Плюсы: минимум кода, не требует серверной части
- Минусы: сбрасывается при F5, не работает между вкладками

### 2. SessionStorage (простой)
- `sessionStorage.setItem(key, JSON.stringify({ data, ts }))`
- Живёт до закрытия вкладки
- Плюсы: переживает F5 (в пределах сессии), не требует серверной части
- Минусы: не работает между вкладками, лимит ~5MB

### 3. LocalStorage (средний)
- То же самое, но через `localStorage`
- Живёт после перезапуска браузера
- Плюсы: сохраняется между сессиями
- Минусы: ручная инвалидация при изменении данных в CVAT

### 4. IndexedDB (надёжный)
- Асинхронное хранилище, большой лимит
- Можно хранить структурированные данные с индексами
- Плюсы: подходит для больших объёмов (список всех аннотаторов)
- Минусы: сложнее реализовать, асинхронный API

### 5. Service Worker (продвинутый)
- Перехватывает fetch-запросы на уровне браузера
- Можно кешировать по стратегии stale-while-revalidate
- Плюсы: работает для всех API-запросов прозрачно, работает офлайн
- Минусы: сложность реализации, отладка, HTTPS обязателен

## Рекомендация
### Фаза 1: In-memory + SessionStorage
- Обёртка `cachedFetch(url, ttl)` над `fetchJSON()`
- Проверка: сначала in-memory, потом sessionStorage, потом fetch
- TTL по умолчанию:
  - Аннотаторы: 5 мин
  - События: 2 мин
  - Группы: 10 мин
  - Статистика (групповая/пользовательская): 5 мин
  - Обзор: 5 мин
- Инвалидация:
  - Ручная кнопка «Обновить» (refresh icon в топ-баре)
  - Автоматическая по TTL

### Фаза 2 (опционально): stale-while-revalidate через Service Worker
- Если данных станет больше и потребуется офлайн-доступ

## Реализация (Фаза 1)

```js
const __cache = {};

function cachedFetch(url, ttlMs = 300000) {
  const now = Date.now();
  // in-memory
  if (__cache[url] && now - __cache[url].ts < ttlMs) {
    return Promise.resolve(__cache[url].data);
  }
  // sessionStorage
  try {
    const stored = sessionStorage.getItem('cache:' + url);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (now - parsed.ts < ttlMs) {
        __cache[url] = parsed;
        return Promise.resolve(parsed.data);
      }
    }
  } catch (_) {}

  return fetchJSON(url).then(data => {
    const entry = { data, ts: now };
    __cache[url] = entry;
    try {
      sessionStorage.setItem('cache:' + url, JSON.stringify(entry));
    } catch (_) {}
    return data;
  });
}
```

### Интеграция
- Заменить `fetchJSON` на `cachedFetch` во всех вызовах в `app.js`
- Добавить кнопку «Обновить» в топ-бар (сброс кеша + перезагрузка активной вьюхи)
