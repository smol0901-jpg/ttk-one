const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, checkRole } = require('./auth');

router.get('/', authenticateToken, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings').all();
    const config = {};
    settings.forEach(s => { config[s.key] = s.value; });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/:key', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by)
      VALUES (?, ?, strftime('%s', 'now') * 1000, ?)
    `).run(key, value, req.user.id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
