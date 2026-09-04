const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { authenticateToken, checkRole } = require('./auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/ttk');
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
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    const { search, type, status, page = 1, limit = 50, sort = 'created_at', order = 'DESC' } = req.query;
    
    let query = 'SELECT * FROM ttk_cards WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (title LIKE ? OR tu LIKE ? OR tags LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    const validSortFields = ['created_at', 'updated_at', 'title', 'yield', 'date'];
    const sortField = validSortFields.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${sortOrder}`;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const cards = db.prepare(query).all(...params);
    
    const totalQuery = 'SELECT COUNT(*) as count FROM ttk_cards WHERE 1=1' + 
      (search ? ' AND (title LIKE ? OR tu LIKE ? OR tags LIKE ?)' : '') +
      (type ? ' AND type = ?' : '') +
      (status ? ' AND status = ?' : '');
    
    const totalParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    if (type) totalParams.push(type);
    if (status) totalParams.push(status);
    
    const total = db.prepare(totalQuery).get(...totalParams).count;

    cards.forEach(card => {
      card.ing = JSON.parse(card.ing);
      card.sub_pfs = card.sub_pfs ? JSON.parse(card.sub_pfs) : [];
      card.scores = card.scores ? JSON.parse(card.scores) : null;
      card.photos = card.photos ? JSON.parse(card.photos) : [];
    });

    res.json({ cards, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    console.error('Get TTK error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    
    db.prepare('UPDATE ttk_cards SET views_count = views_count + 1 WHERE id = ?').run(id);
    
    const card = db.prepare('SELECT * FROM ttk_cards WHERE id = ?').get(id);
    
    if (!card) {
      return res.status(404).json({ error: 'Карта не найдена' });
    }

    card.ing = JSON.parse(card.ing);
    card.sub_pfs = card.sub_pfs ? JSON.parse(card.sub_pfs) : [];
    card.scores = card.scores ? JSON.parse(card.scores) : null;
    card.photos = card.photos ? JSON.parse(card.photos) : [];

    res.json(card);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', authenticateToken, checkRole('operator', 'admin'), upload.array('photos', 10), (req, res) => {
  try {
    const { title, yield: cardYield, target_yield, type, tu, ing, steps, org, haccp, sub_pfs, scores, date, tags } = req.body;
    
    if (!title || !cardYield || !ing) {
      return res.status(400).json({ error: 'Требуется название, выход и ингредиенты' });
    }

    const cardId = 'ttk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const photos = req.files ? req.files.map(f => '/uploads/ttk/' + f.filename) : [];

    db.prepare(`
      INSERT INTO ttk_cards (id, title, yield, target_yield, type, tu, ing, steps, org, haccp, sub_pfs, scores, date, created_by, tags, photos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cardId, title, parseFloat(cardYield), target_yield ? parseFloat(target_yield) : null,
      type || '', tu || '', JSON.stringify(ing), steps || '', org || '', haccp || '',
      sub_pfs ? JSON.stringify(sub_pfs) : null, scores ? JSON.stringify(scores) : null,
      date || new Date().toISOString().split('T')[0], req.user.id,
      tags ? JSON.stringify(tags) : null, JSON.stringify(photos)
    );

    global.logActivity(req.user.id, 'create_ttk', 'ttk_card', cardId, { title }, req.ip);
    global.io.emit('card-updated', { action: 'create', cardId });

    res.json({ id: cardId, title });
  } catch (error) {
    console.error('Create TTK error:', error);
    res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
  }
});

router.put('/:id', authenticateToken, checkRole('operator', 'admin'), upload.array('photos', 10), (req, res) => {
  try {
    const { id } = req.params;
    const { title, yield: cardYield, target_yield, type, tu, ing, steps, org, haccp, sub_pfs, scores, date, status, tags } = req.body;

    const existing = db.prepare('SELECT * FROM ttk_cards WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Карта не найдена' });
    }

    let updateFields = [];
    let params = [];

    if (title !== undefined) { updateFields.push('title = ?'); params.push(title); }
    if (cardYield !== undefined) { updateFields.push('yield = ?'); params.push(parseFloat(cardYield)); }
    if (target_yield !== undefined) { updateFields.push('target_yield = ?'); params.push(target_yield ? parseFloat(target_yield) : null); }
    if (type !== undefined) { updateFields.push('type = ?'); params.push(type); }
    if (tu !== undefined) { updateFields.push('tu = ?'); params.push(tu); }
    if (ing !== undefined) { updateFields.push('ing = ?'); params.push(JSON.stringify(ing)); }
    if (steps !== undefined) { updateFields.push('steps = ?'); params.push(steps); }
    if (org !== undefined) { updateFields.push('org = ?'); params.push(org); }
    if (haccp !== undefined) { updateFields.push('haccp = ?'); params.push(haccp); }
    if (sub_pfs !== undefined) { updateFields.push('sub_pfs = ?'); params.push(sub_pfs ? JSON.stringify(sub_pfs) : null); }
    if (scores !== undefined) { updateFields.push('scores = ?'); params.push(scores ? JSON.stringify(scores) : null); }
    if (date !== undefined) { updateFields.push('date = ?'); params.push(date); }
    if (status !== undefined) { updateFields.push('status = ?'); params.push(status); }
    if (tags !== undefined) { updateFields.push('tags = ?'); params.push(tags ? JSON.stringify(tags) : null); }

    if (req.files && req.files.length > 0) {
      const newPhotos = req.files.map(f => '/uploads/ttk/' + f.filename);
      const existingPhotos = existing.photos ? JSON.parse(existing.photos) : [];
      updateFields.push('photos = ?');
      params.push(JSON.stringify([...existingPhotos, ...newPhotos]));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    updateFields.push('updated_at = ?');
    params.push(Date.now());
    updateFields.push('version = version + 1');

    params.push(id);
    db.prepare(`UPDATE ttk_cards SET ${updateFields.join(', ')} WHERE id = ?`).run(...params);

    global.logActivity(req.user.id, 'update_ttk', 'ttk_card', id, { title }, req.ip);
    global.io.emit('card-updated', { action: 'update', cardId: id });

    res.json({ success: true });
  } catch (error) {
    console.error('Update TTK error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    
    db.prepare('DELETE FROM ttk_cards WHERE id = ?').run(id);
    
    global.logActivity(req.user.id, 'delete_ttk', 'ttk_card', id, {}, req.ip);
    global.io.emit('card-updated', { action: 'delete', cardId: id });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:id/archive', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE ttk_cards SET status = ? WHERE id = ?').run('archived', id);
    global.io.emit('card-updated', { action: 'archive', cardId: id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/import/json', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { cards } = req.body;
    
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'Ожидается массив карт' });
    }

    let imported = 0;
    let errors = [];

    cards.forEach((card, index) => {
      try {
        if (!card.title || !card.yield || !card.ing) {
          errors.push(`Карта ${index}:缺少 обязательных полей`);
          return;
        }

        const cardId = card.id || 'ttk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        db.prepare(`
          INSERT OR REPLACE INTO ttk_cards (id, title, yield, target_yield, type, tu, ing, steps, org, haccp, sub_pfs, scores, date, created_by, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          cardId, card.title, card.yield, card.target_yield || null,
          card.type || '', card.tu || '', JSON.stringify(card.ing),
          card.steps || '', card.org || '', card.haccp || '',
          card.sub_pfs ? JSON.stringify(card.sub_pfs) : null,
          card.scores ? JSON.stringify(card.scores) : null,
          card.date || new Date().toISOString().split('T')[0],
          req.user.id, card.status || 'active'
        );
        imported++;
      } catch (e) {
        errors.push(`Карта ${index}: ${e.message}`);
      }
    });

    global.io.emit('card-updated', { action: 'bulk_import', count: imported });

    res.json({ imported, errors });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка импорта: ' + error.message });
  }
});

router.get('/search/ingredients', authenticateToken, (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const cards = db.prepare(`
      SELECT id, title, type, yield
      FROM ttk_cards
      WHERE ing LIKE ?
      LIMIT 20
    `).all(`%${query}%`);

    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
