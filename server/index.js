require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadsDir = process.env.UPLOADS_DIR || './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../public')));

const db = require('./database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const ttkRoutes = require('./routes/ttk');
const ingredientRoutes = require('./routes/ingredients');
const feedRoutes = require('./routes/feed');
const exportRoutes = require('./routes/export');
const settingsRoutes = require('./routes/settings');
const statsRoutes = require('./routes/stats');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ttk', ttkRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stats', statsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), version: '1.0.0' });
});

app.get('/api/qrcode', (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const url = `${protocol}://${host}`;
  
  qrcode.generate(url, { small: true }, (qr) => {
    res.type('text/plain').send(qr);
  });
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('join-room', (room) => {
    socket.join(room);
    console.log(`Client ${socket.id} joined room: ${room}`);
  });

  socket.on('card-update', (data) => {
    io.emit('card-updated', data);
  });

  socket.on('ingredient-update', (data) => {
    io.emit('ingredient-updated', data);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const logActivity = (userId, action, entityType, entityId, details, ipAddress) => {
  try {
    const stmt = db.prepare(`
      INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run('log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9), 
      userId, action, entityType, entityId, JSON.stringify(details), ipAddress);
  } catch (e) {
    console.error('Log error:', e.message);
  }
};

global.logActivity = logActivity;
global.io = io;

cron.schedule('0 0 * * *', () => {
  console.log('Running daily backup...');
  try {
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const dbPath = process.env.DB_PATH || './database/ttk.db';
    const backupPath = path.join(backupDir, `backup_${new Date().toISOString().split('T')[0]}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`Backup created: ${backupPath}`);
  } catch (e) {
    console.error('Backup error:', e.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         TTK SERVER - Профессиональная система             ║');
  console.log('║         управления технологическими картами               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Сервер запущен: http://${HOST}:${PORT}`);
  console.log(`║  Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`║  База данных: ${process.env.DB_PATH || './database/ttk.db'}`);
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║  Функции:                                                 ║');
  console.log('║  ✓ Создание и хранение ТТК/КК                             ║');
  console.log('║  ✓ Управление ингредиентами                               ║');
  console.log('║  ✓ HACCP контроль                                         ║');
  console.log('║  ✓ Экспорт PDF/Excel/JSON                                 ║');
  console.log('║  ✓ Ролевая модель (Гость/Оператор/Админ)                  ║');
  console.log('║  ✓ PWA поддержка                                          ║');
  console.log('║  ✓ QR подключение                                         ║');
  console.log('║  ✓ Real-time обновления                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  
  const qrUrl = `http://127.0.0.1:${PORT}`;
  console.log('\nQR Code для подключения:');
  qrcode.generate(qrUrl, { small: true }, (qr) => {
    console.log(qr);
  });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

module.exports = { app, server, io };
