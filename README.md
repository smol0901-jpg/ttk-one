# 🍽️ TTK Server - Профессиональная система управления технологическими картами

## Описание

Мощный сервер для создания, хранения, просмотра и печати ТТК (Технологико-Технических Карт), Калькуляционных карт, рецептов для цехов, презентации, внутреннего и внешнего использования.

## ✨ Основные возможности (30+ фич)

### 🔐 Аутентификация и роли
1. **3 уровня доступа**: Гость (без пароля, только просмотр), Оператор (пароль 0000, может добавлять/редактировать/печатать), Админ (полный контроль)
2. **Kiosk режим** - вход без клавиатуры, только нажатия на экране
3. **JWT токены** с настраиваемым временем жизни
4. **Смена паролей** для всех пользователей

### 📊 Управление ТТК
5. **CRUD операции** - создание, чтение, обновление, удаление карт
6. **Массовый импорт** JSON и Excel
7. **Экспорт** в PDF, Excel, JSON
8. **Живой поиск** по ингредиентам
9. **Версионирование** карт
10. **Статусы карт**: черновик, активная, архив, на проверке
11. **Подкарты (sub_pfs)** - полуфабрикаты с собственными рецептами
12. **Оценки качества** (appearance, taste, aroma и др.)

### 🥘 Ингредиенты
13. **База ингредиентов** с категориями
14. **Аллергены** и условия хранения
15. **Поставщики** и цены
16. **Штрихкоды**
17. **Живой поиск** ингредиентов

### 📱 Интерфейс и подключение
18. **PWA поддержка** - установка на устройства
19. **QR код** для быстрого подключения в WiFi сети
20. **WebSocket** real-time обновления
21. **Адаптивный дизайн** для мобильных и десктопов

### 📈 Аналитика и дашборды
22. **Живые графики** статистики
23. **Лог активности** всех действий
24. **Просмотры и печати** карт
25. **AI-ready структура** для будущей аналитики

### 🌐 Социальные функции
26. **Лента новостей** как в соцсетях
27. **Комментарии** к постам
28. **Медиа** (фото/видео) в ленте

### 🔧 HACCP и стандарты
29. **HACCP контроль** в каждой карте
30. **ТУ (Технические Условия)** привязка
31. **ККТ точки контроля**

### 🤖 Интеграции
32. **Открытые API** endpoints
33. **Telegram бот** готовность к подключению
34. **1С группы** готовность к интеграции

### 💾 Хранение и надежность
35. **SQLite база** с WAL режимом
36. **Автоматические бэкапы** ежедневно
37. **Real-time синхронизация** между клиентами

## 🚀 Быстрый старт

### Установка
```bash
cd /workspace
npm install
```

### Запуск
```bash
npm start
# или для разработки
npm run dev
```

### Доступ
- **URL**: http://localhost:3000
- **Admin**: login: `admin`, password: `0000`
- **Guest**: login: `guest`, password: не требуется

## 📡 API Endpoints

### Аутентификация
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/auth/login` | Вход в систему |
| GET | `/api/auth/me` | Текущий профиль |
| POST | `/api/auth/change-password` | Сменить пароль |
| GET | `/api/auth/users` | Список пользователей (admin) |
| POST | `/api/auth/users` | Создать пользователя (admin) |
| PUT | `/api/auth/users/:id` | Обновить пользователя (admin) |
| DELETE | `/api/auth/users/:id` | Удалить пользователя (admin) |

### Технологические карты
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/ttk` | Список карт (пагинация, поиск, фильтры) |
| GET | `/api/ttk/:id` | Получить карту по ID |
| POST | `/api/ttk` | Создать карту |
| PUT | `/api/ttk/:id` | Обновить карту |
| DELETE | `/api/ttk/:id` | Удалить карту (admin) |
| POST | `/api/ttk/import/json` | Массовый импорт JSON |
| GET | `/api/ttk/search/ingredients` | Поиск по ингредиентам |

### Экспорт
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/export/ttk/:id/pdf` | Скачать PDF |
| GET | `/api/export/ttk/:id/excel` | Скачать Excel |
| GET | `/api/export/ttk/:id/json` | Скачать JSON |
| GET | `/api/export/all/excel` | Все карты в Excel |

### Ингредиенты
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/ingredients` | Список ингредиентов |
| GET | `/api/ingredients/categories` | Категории |
| GET | `/api/ingredients/search/live?q=` | Живой поиск |
| POST | `/api/ingredients` | Добавить ингредиент |
| PUT | `/api/ingredients/:id` | Обновить ингредиент |
| DELETE | `/api/ingredients/:id` | Удалить ингредиент (admin) |

### Лента
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/feed` | Лента новостей |
| POST | `/api/feed` | Создать пост |
| POST | `/api/feed/:id/comment` | Добавить комментарий |
| GET | `/api/feed/:id/comments` | Комментарии к посту |

### Статистика
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/stats/dashboard` | Дашборд статистики |
| GET | `/api/stats/activity` | Лог активности (admin) |

### Прочее
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/qrcode` | QR код для подключения |
| GET | `/api/health` | Проверка здоровья сервера |
| GET | `/api/settings` | Настройки системы |
| PUT | `/api/settings/:key` | Обновить настройку (admin) |

## 📋 Пример запроса API

```javascript
// 1. Войти
const login = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '0000' })
});
const { token } = await login.json();

// 2. Получить ТТК
const cards = await fetch('/api/ttk?limit=50', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// 3. Создать ТТК
const newCard = {
  title: 'СОУС НОВЫЙ',
  yield: 100,
  type: 'sauce',
  tu: 'ТУ 10.84.12-001-2024',
  ing: [['Ингредиент 1', 50], ['Ингредиент 2', 30]],
  steps: 'Смешать...',
  org: 'Однородная...',
  haccp: 'ККТ-1...'
};

await fetch('/api/ttk', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(newCard)
});
```

## 🗂️ Структура проекта

```
/workspace
├── server/
│   ├── index.js          # Главный сервер
│   ├── database.js       # База данных SQLite
│   └── routes/
│       ├── auth.js       # Аутентификация
│       ├── ttk.js        # ТТК карты
│       ├── ingredients.js# Ингредиенты
│       ├── feed.js       # Лента новостей
│       ├── export.js     # Экспорт PDF/Excel
│       ├── users.js      # Пользователи
│       ├── settings.js   # Настройки
│       └── stats.js      # Статистика
├── public/
│   ├── index.html        # Веб интерфейс
│   └── manifest.json     # PWA манифест
├── database/             # SQLite база
├── uploads/              # Загруженные файлы
├── backups/              # Автоматические бэкапы
├── .env                  # Переменные окружения
├── package.json
└── README.md
```

## 🔧 Конфигурация (.env)

```
PORT=3000
HOST=0.0.0.0
JWT_SECRET=your_secret_key
ADMIN_PASSWORD=0000
DB_PATH=./database/ttk.db
UPLOADS_DIR=./uploads
NODE_ENV=production
MAX_FILE_SIZE=10485760
SESSION_TIMEOUT=86400
```

## 📱 PWA Установка

1. Откройте http://your-server-ip:3000 на устройстве
2. Нажмите "Добавить на главный экран"
3. Приложение установится как нативное

## 🔌 WebSocket события

```javascript
const socket = io();

socket.on('card-updated', (data) => {
  // Карта создана/обновлена/удалена
  console.log(data); // { action: 'create'|'update'|'delete', cardId }
});

socket.on('ingredient-updated', (data) => {
  // Ингредиент изменен
  console.log(data);
});
```

## 📞 Поддержка

Для вопросов и предложений обращайтесь к разработчику.

## 📄 Лицензия

MIT License
