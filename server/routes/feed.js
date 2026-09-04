const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { authenticateToken } = require('./auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/feed');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '_' + Math.random().toString(36).substr(2, 9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const posts = db.prepare(`
      SELECT p.*, u.username, u.full_name, c.title as card_title
      FROM feed_posts p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN ttk_cards c ON p.card_id = c.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const total = db.prepare('SELECT COUNT(*) as count FROM feed_posts').get().count;

    res.json({ posts, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', authenticateToken, upload.single('media'), (req, res) => {
  try {
    const { content, card_id } = req.body;
    
    const postId = 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const mediaType = req.file ? req.file.mimetype.split('/')[0] : null;
    const mediaUrl = req.file ? '/uploads/feed/' + req.file.filename : null;

    db.prepare(`
      INSERT INTO feed_posts (id, user_id, content, media_type, media_url, card_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(postId, req.user.id, content || '', mediaType, mediaUrl, card_id || null);

    res.json({ id: postId });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:id/comment', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Требуется текст комментария' });
    }

    const commentId = 'comment_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    db.prepare(`
      INSERT INTO feed_comments (id, post_id, user_id, content)
      VALUES (?, ?, ?, ?)
    `).run(commentId, id, req.user.id, content);

    db.prepare('UPDATE feed_posts SET comments_count = comments_count + 1 WHERE id = ?').run(id);

    res.json({ id: commentId });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id/comments', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    
    const comments = db.prepare(`
      SELECT c.*, u.username, u.full_name
      FROM feed_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).all(id);

    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
