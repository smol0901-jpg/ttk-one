const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const QRCode = require('qrcode');
const cron = require('node-cron');
const winston = require('winston');

const db = require('./database');
const authMiddleware = require('./middleware/auth');
const apiRoutes = require('./api/routes');

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join(__dirname, '../logs/error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, '../logs/combined.log') })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Ensure directories exist
['logs', 'uploads', 'exports', 'backups', 'data'].forEach(dir => {
  const dirPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Express app setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  },
  maxHttpBufferSize: 1e8 // 100MB for file uploads
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/exports', express.static(path.join(__dirname, '../exports')));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadType = req.params.type || 'documents';
    const destPath = path.join(__dirname, `../uploads/${uploadType}`);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|json|mp4|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// API Routes
app.use('/api', apiRoutes(db, io, logger, upload));

// Generate QR Code endpoint
app.get('/api/qr/:data', async (req, res) => {
  try {
    const data = decodeURIComponent(req.params.data);
    const qrCode = await QRCode.toBuffer(data, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(qrCode);
  } catch (error) {
    logger.error('QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// WebSocket real-time events
io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);

  socket.on('join_room', (room) => {
    socket.join(room);
    logger.info(`Client ${socket.id} joined room: ${room}`);
  });

  socket.on('card_update', (data) => {
    io.emit('card_updated', data);
    logger.info('Card updated broadcast:', data.cardId);
  });

  socket.on('new_ingredient', (data) => {
    io.emit('ingredient_added', data);
  });

  socket.on('production_request', (data) => {
    io.to('kitchen').emit('new_production_request', data);
  });

  socket.on('chat_message', (data) => {
    io.emit('new_message', data);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });
});

// Auto-backup cron job (daily at 3 AM)
cron.schedule('0 3 * * *', () => {
  logger.info('Starting daily backup...');
  const backupPath = path.join(__dirname, '../backups');
  const dbPath = path.join(__dirname, '../data/ttk.db');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupPath, `ttk-backup-${timestamp}.db`);
  
  try {
    fs.copyFileSync(dbPath, backupFile);
    
    // Keep only last 30 backups
    const backups = fs.readdirSync(backupPath)
      .filter(f => f.startsWith('ttk-backup-'))
      .sort()
      .reverse();
    
    backups.slice(30).forEach(oldBackup => {
      fs.unlinkSync(path.join(backupPath, oldBackup));
    });
    
    logger.info('Backup completed successfully:', backupFile);
    io.emit('system_notification', {
      type: 'backup',
      message: 'Ежедневная резервная копия создана успешно',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Backup failed:', error);
  }
});

// Cleanup old sessions cron job (every hour)
cron.schedule('0 * * * *', () => {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    db.prepare(`
      DELETE FROM activity_logs 
      WHERE created_at < datetime('now', '-30 days')
    `).run();
    logger.info('Cleaned up old activity logs');
  } catch (error) {
    logger.error('Cleanup error:', error);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
    version: '2.0.0'
  });
});

// Serve PWA manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'TTK Professional Server',
    short_name: 'TTK Server',
    description: 'Система управления технологическими картами',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#007AFF',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
});

// Service Worker
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, '../public/sw.js'));
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      status: err.status || 500
    }
  });
});

// Start server
server.listen(PORT, HOST, () => {
  logger.info(`🚀 TTK Professional Server v2.0.0`);
  logger.info(`📡 Listening on http://${HOST}:${PORT}`);
  logger.info(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`💾 Database: ${db.name}`);
  
  // Get network interfaces for WiFi access
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(`${iface.address}:${PORT}`);
      }
    }
  }
  logger.info(`📶 Available on WiFi: ${addresses.join(', ')}`);
  
  console.log('\n✅ Server is running!');
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Network: ${addresses.map(a => `http://${a}`).join(', ')}`);
  console.log('\n👤 Default credentials:');
  console.log('   Admin: admin / 0000');
  console.log('   Guest: guest / (no password)');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Closing server...');
  server.close(() => {
    db.close();
    logger.info('Server closed gracefully');
    process.exit(0);
  });
});

module.exports = { app, server, io, logger };
