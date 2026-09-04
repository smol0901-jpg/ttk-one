const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, checkRole } = require('./auth');

router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const totalCards = db.prepare('SELECT COUNT(*) as count FROM ttk_cards').get().count;
    const activeCards = db.prepare('SELECT COUNT(*) as count FROM ttk_cards WHERE status = ?').get('active').count;
    const totalIngredients = db.prepare('SELECT COUNT(*) as count FROM ingredients').get().count;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count;
    
    const cardsByType = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM ttk_cards 
      WHERE type IS NOT NULL AND type != ''
      GROUP BY type
    `).all();
    
    const recentCards = db.prepare(`
      SELECT id, title, type, created_at 
      FROM ttk_cards 
      ORDER BY created_at DESC 
      LIMIT 10
    `).all();

    const viewsLastWeek = db.prepare(`
      SELECT COUNT(*) as count 
      FROM activity_logs 
      WHERE action = 'view_card' 
      AND created_at > (strftime('%s', 'now') - 604800) * 1000
    `).get().count;

    res.json({
      totalCards,
      activeCards,
      totalIngredients,
      totalUsers,
      cardsByType,
      recentCards,
      viewsLastWeek
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/activity', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const logs = db.prepare(`
      SELECT l.*, u.username
      FROM activity_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(parseInt(limit));

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
