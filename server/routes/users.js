const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, checkRole } = require('./auth');

router.get('/kiosk', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, full_name, kiosk_mode, department
      FROM users
      WHERE is_active = 1 AND kiosk_mode = 1
      ORDER BY full_name
    `).all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
