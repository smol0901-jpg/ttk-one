const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, checkRole } = require('./auth');

router.get('/', authenticateToken, (req, res) => {
  try {
    const { search, category, page = 1, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM ingredients WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY name ASC';
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const ingredients = db.prepare(query).all(...params);
    
    const total = db.prepare(
      'SELECT COUNT(*) as count FROM ingredients WHERE 1=1' + 
      (search ? ' AND name LIKE ?' : '') +
      (category ? ' AND category = ?' : '')
    ).get(search ? `%${search}%` : null, category || null).count;

    res.json({ ingredients, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/categories', authenticateToken, (req, res) => {
  try {
    const categories = db.prepare('SELECT DISTINCT category FROM ingredients WHERE category IS NOT NULL ORDER BY category').all();
    res.json(categories.map(c => c.category));
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', authenticateToken, checkRole('operator', 'admin'), (req, res) => {
  try {
    const { name, category, unit, price_per_unit, supplier, allergens, storage_conditions, shelf_life_days, barcode } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Требуется название' });
    }

    const existing = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ error: 'Ингредиент уже существует' });
    }

    const ingredientId = 'ing_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    db.prepare(`
      INSERT INTO ingredients (id, name, category, unit, price_per_unit, supplier, allergens, storage_conditions, shelf_life_days, barcode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ingredientId, name, category || null, unit || 'кг', price_per_unit || 0, 
           supplier || '', allergens || '', storage_conditions || '', shelf_life_days || null, barcode || '');

    global.logActivity(req.user.id, 'create_ingredient', 'ingredient', ingredientId, { name }, req.ip);
    global.io.emit('ingredient-updated', { action: 'create', ingredientId });

    res.json({ id: ingredientId, name });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/:id', authenticateToken, checkRole('operator', 'admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, unit, price_per_unit, supplier, allergens, storage_conditions, shelf_life_days, barcode } = req.body;

    let updateFields = [];
    let params = [];

    if (name !== undefined) { updateFields.push('name = ?'); params.push(name); }
    if (category !== undefined) { updateFields.push('category = ?'); params.push(category); }
    if (unit !== undefined) { updateFields.push('unit = ?'); params.push(unit); }
    if (price_per_unit !== undefined) { updateFields.push('price_per_unit = ?'); params.push(price_per_unit); }
    if (supplier !== undefined) { updateFields.push('supplier = ?'); params.push(supplier); }
    if (allergens !== undefined) { updateFields.push('allergens = ?'); params.push(allergens); }
    if (storage_conditions !== undefined) { updateFields.push('storage_conditions = ?'); params.push(storage_conditions); }
    if (shelf_life_days !== undefined) { updateFields.push('shelf_life_days = ?'); params.push(shelf_life_days); }
    if (barcode !== undefined) { updateFields.push('barcode = ?'); params.push(barcode); }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    updateFields.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    db.prepare(`UPDATE ingredients SET ${updateFields.join(', ')} WHERE id = ?`).run(...params);

    global.logActivity(req.user.id, 'update_ingredient', 'ingredient', id, { name }, req.ip);
    global.io.emit('ingredient-updated', { action: 'update', ingredientId: id });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', authenticateToken, checkRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
    global.io.emit('ingredient-updated', { action: 'delete', ingredientId: id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/search/live', authenticateToken, (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json([]);
    }

    const ingredients = db.prepare(`
      SELECT id, name, category, unit, price_per_unit
      FROM ingredients
      WHERE name LIKE ?
      LIMIT 20
    `).all(`%${q}%`);

    res.json(ingredients);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
