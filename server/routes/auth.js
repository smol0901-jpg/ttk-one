const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 86400;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Неверный токен' });
    }
    req.user = user;
    next();
  });
};

const checkRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
};

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Требуется имя пользователя' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Учетная запись заблокирована' });
    }

    if (user.role === 'guest') {
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: SESSION_TIMEOUT }
      );

      db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);

      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          full_name: user.full_name,
          kiosk_mode: user.kiosk_mode
        }
      });
    }

    if (!password) {
      return res.status(400).json({ error: 'Требуется пароль' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: SESSION_TIMEOUT }
    );

    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);

    global.logActivity(user.id, 'login', 'user', user.id, { username }, req.ip);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        kiosk_mode: user.kiosk_mode,
        department: user.department
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/kiosk-login', (req, res) => {
  try {
    const { userId } = req.body;
    
    const user = db.prepare('SELECT id, username, role, full_name, kiosk_mode FROM users WHERE id = ? AND is_active = 1').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: 3600 }
    );

    res.json({
      token,
      user
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/users', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, role, full_name, created_at, last_login, is_active, kiosk_mode, department
      FROM users
      ORDER BY created_at DESC
    `).all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/users', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { username, password, role, full_name, kiosk_mode, department } = req.body;
    
    if (!username || !role) {
      return res.status(400).json({ error: 'Требуется username и role' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Пользователь уже существует' });
    }

    const userId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name, kiosk_mode, department)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, username, passwordHash, role, full_name || username, kiosk_mode ? 1 : 0, department);

    global.logActivity(req.user.id, 'create_user', 'user', userId, { username, role }, req.ip);

    res.json({ id: userId, username, role });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/users/:id', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { password, role, full_name, is_active, kiosk_mode, department } = req.body;

    let updateFields = [];
    let params = [];

    if (password) {
      updateFields.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }
    if (role) {
      updateFields.push('role = ?');
      params.push(role);
    }
    if (full_name !== undefined) {
      updateFields.push('full_name = ?');
      params.push(full_name);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }
    if (kiosk_mode !== undefined) {
      updateFields.push('kiosk_mode = ?');
      params.push(kiosk_mode ? 1 : 0);
    }
    if (department !== undefined) {
      updateFields.push('department = ?');
      params.push(department);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    params.push(id);
    db.prepare(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`).run(...params);

    global.logActivity(req.user.id, 'update_user', 'user', id, { fields: Object.keys(req.body) }, req.ip);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/users/:id', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить свою учетную запись' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    global.logActivity(req.user.id, 'delete_user', 'user', id, {}, req.ip);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/change-password', authenticateToken, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user.password_hash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(newPassword, 10), userId);
      return res.json({ success: true });
    }

    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 10), userId);

    global.logActivity(userId, 'change_password', 'user', userId, {}, req.ip);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, username, role, full_name, kiosk_mode, department, created_at, last_login
      FROM users WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.checkRole = checkRole;
