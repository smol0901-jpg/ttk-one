const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const apiRoutes = (db, io, logger, upload) => {
  const express = require('express');
  const router = express.Router();
  const auth = require('../middleware/auth')(db);

  // ==================== AUTH ROUTES ====================
  router.post('/auth/login', auth.login);
  router.post('/auth/register', auth.authenticate, auth.requireRole('admin'), auth.register);
  router.post('/auth/change-password', auth.authenticate, auth.changePassword);
  router.post('/auth/reset-password', auth.authenticate, auth.requireRole('admin'), auth.resetPassword);
  router.get('/auth/profile', auth.authenticate, auth.getProfile);
  router.put('/auth/profile', auth.authenticate, auth.updateProfile);

  // ==================== DASHBOARD ROUTES ====================
  router.get('/dashboard/stats', auth.authenticate, (req, res) => {
    try {
      const stats = {
        totalCards: db.prepare('SELECT COUNT(*) as count FROM ttk_cards').get().count,
        totalIngredients: db.prepare('SELECT COUNT(*) as count FROM ingredients').get().count,
        pendingRequests: db.prepare("SELECT COUNT(*) as count FROM production_requests WHERE status = 'pending'").get().count,
        activeUsers: db.prepare("SELECT COUNT(*) as count FROM users WHERE is_active = 1").get().count,
        cardsByType: db.prepare(`
          SELECT type, COUNT(*) as count 
          FROM ttk_cards 
          GROUP BY type
        `).all(),
        recentActivity: db.prepare(`
          SELECT al.*, u.username, u.full_name
          FROM activity_logs al
          LEFT JOIN users u ON al.user_id = u.id
          ORDER BY al.created_at DESC
          LIMIT 20
        `).all(),
        topCards: db.prepare(`
          SELECT tc.title, tc.type, COUNT(pr.id) as production_count
          FROM ttk_cards tc
          LEFT JOIN production_requests pr ON tc.card_id = pr.card_id
          GROUP BY tc.card_id
          ORDER BY production_count DESC
          LIMIT 10
        `).all(),
        monthlyProduction: db.prepare(`
          SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
          FROM production_requests
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `).all()
      };

      res.json(stats);
    } catch (error) {
      logger.error('Dashboard stats error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TTK CARDS ROUTES ====================
  
  // Get all cards with filters
  router.get('/cards', auth.authenticate, (req, res) => {
    try {
      const { type, status, search, limit = 100, offset = 0 } = req.query;
      
      let query = `
        SELECT tc.*, u.full_name as creator_name, u2.full_name as approver_name
        FROM ttk_cards tc
        LEFT JOIN users u ON tc.created_by = u.id
        LEFT JOIN users u2 ON tc.approved_by = u2.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (type) {
        query += ' AND tc.type = ?';
        params.push(type);
      }
      
      if (status) {
        query += ` AND tc.status = ?`;
        params.push(status);
      }
      
      if (search) {
        query += ' AND (tc.title LIKE ? OR tc.tu_number LIKE ? OR tc.category LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      query += ' ORDER BY tc.updated_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));
      
      const cards = db.prepare(query).all(...params);
      
      const total = db.prepare(`
        SELECT COUNT(*) as count FROM ttk_cards WHERE 1=1
        ${type ? 'AND type = ?' : ''}
        ${status ? 'AND status = ?' : ''}
        ${search ? 'AND (title LIKE ? OR tu_number LIKE ?)' : ''}
      `).get(...(type ? [type] : []), ...(status ? [status] : []), ...(search ? [`%${search}%`, `%${search}%`] : [])).count;
      
      res.json({ cards, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
      logger.error('Get cards error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get single card by ID
  router.get('/cards/:id', auth.authenticate, (req, res) => {
    try {
      const card = db.prepare(`
        SELECT tc.*, u.full_name as creator_name, u2.full_name as approver_name
        FROM ttk_cards tc
        LEFT JOIN users u ON tc.created_by = u.id
        LEFT JOIN users u2 ON tc.approved_by = u2.id
        WHERE tc.card_id = ?
      `).get(req.params.id);
      
      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }
      
      const ingredients = db.prepare(`
        SELECT * FROM card_ingredients WHERE card_id = ? ORDER BY sort_order
      `).all(req.params.id);
      
      const steps = db.prepare(`
        SELECT * FROM process_steps WHERE card_id = ? ORDER BY sort_order
      `).all(req.params.id);
      
      const haccpControls = db.prepare(`
        SELECT * FROM haccp_controls WHERE card_id = ? ORDER BY sort_order
      `).all(req.params.id);
      
      const qualityParams = db.prepare(`
        SELECT * FROM quality_params WHERE card_id = ?
      `).get(req.params.id);
      
      const subRecipes = db.prepare(`
        SELECT * FROM sub_recipes WHERE parent_card_id = ?
      `).all(req.params.id);
      
      const subRecipeIngredients = {};
      subRecipes.forEach(sr => {
        subRecipeIngredients[sr.id] = db.prepare(`
          SELECT * FROM sub_recipe_ingredients WHERE sub_recipe_id = ? ORDER BY sort_order
        `).all(sr.id);
      });
      
      const scores = db.prepare(`
        SELECT es.*, u.full_name as evaluator_name
        FROM evaluation_scores es
        LEFT JOIN users u ON es.evaluated_by = u.id
        WHERE es.card_id = ?
        ORDER BY es.evaluated_at DESC
      `).all(req.params.id);
      
      res.json({
        card,
        ingredients,
        steps,
        haccpControls,
        qualityParams,
        subRecipes,
        subRecipeIngredients,
        scores
      });
    } catch (error) {
      logger.error('Get card error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create new card
  router.post('/cards', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { title, type, yield: cardYield, targetYield, tuNumber, gostStandard, category } = req.body;
      
      if (!title || !cardYield) {
        return res.status(400).json({ error: 'Title and yield are required' });
      }
      
      const cardId = `ttk_${Date.now()}_${uuidv4().substring(0, 8)}`;
      
      db.prepare(`
        INSERT INTO ttk_cards (card_id, title, type, yield, target_yield, tu_number, gost_standard, category, created_by, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cardId, title, type || 'dish', cardYield, targetYield, tuNumber, gostStandard, category, req.user.id, 'draft');
      
      logger.info(`Card created: ${cardId} by ${req.user.username}`);
      io.emit('card_update', { action: 'created', cardId, title });
      
      res.status(201).json({ message: 'Card created', cardId });
    } catch (error) {
      logger.error('Create card error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update card
  router.put('/cards/:id', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { title, type, yield: cardYield, targetYield, tuNumber, gostStandard, category, status, version } = req.body;
      
      db.prepare(`
        UPDATE ttk_cards 
        SET title = COALESCE(?, title),
            type = COALESCE(?, type),
            yield = COALESCE(?, yield),
            target_yield = COALESCE(?, target_yield),
            tu_number = COALESCE(?, tu_number),
            gost_standard = COALESCE(?, gost_standard),
            category = COALESCE(?, category),
            status = COALESCE(?, status),
            version = COALESCE(?, version),
            updated_at = CURRENT_TIMESTAMP
        WHERE card_id = ?
      `).run(title, type, cardYield, targetYield, tuNumber, gostStandard, category, status, version, req.params.id);
      
      logger.info(`Card updated: ${req.params.id} by ${req.user.username}`);
      io.emit('card_update', { action: 'updated', cardId: req.params.id });
      
      res.json({ message: 'Card updated' });
    } catch (error) {
      logger.error('Update card error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete card
  router.delete('/cards/:id', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      db.prepare('DELETE FROM ttk_cards WHERE card_id = ?').run(req.params.id);
      
      logger.info(`Card deleted: ${req.params.id} by ${req.user.username}`);
      io.emit('card_update', { action: 'deleted', cardId: req.params.id });
      
      res.json({ message: 'Card deleted' });
    } catch (error) {
      logger.error('Delete card error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add ingredient to card
  router.post('/cards/:id/ingredients', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { ingredientName, quantity, unit, lossPercentage, sortOrder, notes, ingredientId } = req.body;
      
      if (!ingredientName || quantity === undefined) {
        return res.status(400).json({ error: 'Ingredient name and quantity required' });
      }
      
      const netWeight = quantity * (1 - (lossPercentage || 0) / 100);
      const bruttoWeight = quantity;
      
      db.prepare(`
        INSERT INTO card_ingredients (card_id, ingredient_id, ingredient_name, quantity, unit, loss_percentage, net_weight, brutto_weight, sort_order, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, ingredientId || null, ingredientName, quantity, unit || 'kg', lossPercentage || 0, netWeight, bruttoWeight, sortOrder || 0, notes);
      
      io.emit('card_update', { action: 'ingredient_added', cardId: req.params.id });
      
      res.status(201).json({ message: 'Ingredient added' });
    } catch (error) {
      logger.error('Add ingredient error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update ingredient in card
  router.put('/cards/:id/ingredients/:ingId', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { quantity, lossPercentage, sortOrder, notes } = req.body;
      
      const netWeight = quantity * (1 - (lossPercentage || 0) / 100);
      
      db.prepare(`
        UPDATE card_ingredients 
        SET quantity = COALESCE(?, quantity),
            loss_percentage = COALESCE(?, loss_percentage),
            net_weight = ?,
            brutto_weight = COALESCE(?, brutto_weight),
            sort_order = COALESCE(?, sort_order),
            notes = COALESCE(?, notes)
        WHERE id = ? AND card_id = ?
      `).run(quantity, lossPercentage, netWeight, quantity, sortOrder, notes, req.params.ingId, req.params.id);
      
      io.emit('card_update', { action: 'ingredient_updated', cardId: req.params.id });
      
      res.json({ message: 'Ingredient updated' });
    } catch (error) {
      logger.error('Update ingredient error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete ingredient from card
  router.delete('/cards/:id/ingredients/:ingId', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      db.prepare('DELETE FROM card_ingredients WHERE id = ? AND card_id = ?').run(req.params.ingId, req.params.id);
      
      io.emit('card_update', { action: 'ingredient_deleted', cardId: req.params.id });
      
      res.json({ message: 'Ingredient deleted' });
    } catch (error) {
      logger.error('Delete ingredient error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add process step
  router.post('/cards/:id/steps', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { stepNumber, description, temperature, timeMinutes, equipment, kktControl, sortOrder } = req.body;
      
      if (!description) {
        return res.status(400).json({ error: 'Step description required' });
      }
      
      db.prepare(`
        INSERT INTO process_steps (card_id, step_number, description, temperature, time_minutes, equipment, kkt_control, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, stepNumber || 0, description, temperature, timeMinutes, equipment, kktControl, sortOrder || 0);
      
      io.emit('card_update', { action: 'step_added', cardId: req.params.id });
      
      res.status(201).json({ message: 'Step added' });
    } catch (error) {
      logger.error('Add step error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add HACCP control
  router.post('/cards/:id/haccp', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { kktNumber, kktType, hazardType, controlMeasure, criticalLimit, monitoringProcedure, frequency, responsiblePerson, correctiveActions, records, verification, sortOrder } = req.body;
      
      if (!kktNumber || !controlMeasure) {
        return res.status(400).json({ error: 'KKT number and control measure required' });
      }
      
      db.prepare(`
        INSERT INTO haccp_controls (card_id, kkt_number, kkt_type, hazard_type, control_measure, critical_limit, monitoring_procedure, frequency, responsible_person, corrective_actions, records, verification, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, kktNumber, kktType || 'CCP', hazardType, controlMeasure, criticalLimit, monitoringProcedure, frequency, responsiblePerson, correctiveActions, records, verification, sortOrder || 0);
      
      io.emit('card_update', { action: 'haccp_added', cardId: req.params.id });
      
      res.status(201).json({ message: 'HACCP control added' });
    } catch (error) {
      logger.error('Add HACCP error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add quality parameters
  router.post('/cards/:id/quality', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { appearance, color, texture, taste, smell, consistency, temperatureServing, presentationNotes } = req.body;
      
      db.prepare(`
        INSERT OR REPLACE INTO quality_params (card_id, appearance, color, texture, taste, smell, consistency, temperature_serving, presentation_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, appearance, color, texture, taste, smell, consistency, temperatureServing, presentationNotes);
      
      io.emit('card_update', { action: 'quality_updated', cardId: req.params.id });
      
      res.json({ message: 'Quality parameters saved' });
    } catch (error) {
      logger.error('Save quality error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add evaluation score
  router.post('/cards/:id/scores', auth.authenticate, (req, res) => {
    try {
      const { appearance, browning, aroma, taste, juicy, texture, natural, umami, sweet, acid, salt, spice, overall, comments } = req.body;
      
      db.prepare(`
        INSERT INTO evaluation_scores (card_id, appearance, browning, aroma, taste, juicy, texture, natural, umami, sweet, acid, salt, spice, overall, evaluated_by, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, appearance, browning, aroma, taste, juicy, texture, natural, umami, sweet, acid, salt, spice, overall, req.user.id, comments);
      
      res.status(201).json({ message: 'Evaluation saved' });
    } catch (error) {
      logger.error('Save score error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== INGREDIENTS ROUTES ====================
  
  // Get all ingredients with search
  router.get('/ingredients', auth.authenticate, (req, res) => {
    try {
      const { search, category, limit = 100 } = req.query;
      
      let query = 'SELECT * FROM ingredients WHERE 1=1';
      const params = [];
      
      if (search) {
        query += ' AND (name LIKE ? OR barcode LIKE ? OR category LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }
      
      query += ' ORDER BY name LIMIT ?';
      params.push(parseInt(limit));
      
      const ingredients = db.prepare(query).all(...params);
      
      res.json(ingredients);
    } catch (error) {
      logger.error('Get ingredients error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create ingredient
  router.post('/ingredients', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { name, category, unit, density, allergens, supplier, costPerKg, storageConditions, shelfLifeDays, gostStandard, barcode, notes } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Ingredient name required' });
      }
      
      const result = db.prepare(`
        INSERT INTO ingredients (name, category, unit, density, allergens, supplier, cost_per_kg, storage_conditions, shelf_life_days, gost_standard, barcode, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, category, unit || 'kg', density || 1.0, allergens, supplier, costPerKg, storageConditions, shelfLifeDays, gostStandard, barcode, notes);
      
      io.emit('new_ingredient', { id: result.lastInsertRowid, name });
      
      res.status(201).json({ message: 'Ingredient created', ingredientId: result.lastInsertRowid });
    } catch (error) {
      logger.error('Create ingredient error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update ingredient
  router.put('/ingredients/:id', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { name, category, unit, density, allergens, supplier, costPerKg, storageConditions, shelfLifeDays, gostStandard, barcode, notes } = req.body;
      
      db.prepare(`
        UPDATE ingredients 
        SET name = COALESCE(?, name),
            category = COALESCE(?, category),
            unit = COALESCE(?, unit),
            density = COALESCE(?, density),
            allergens = COALESCE(?, allergens),
            supplier = COALESCE(?, supplier),
            cost_per_kg = COALESCE(?, cost_per_kg),
            storage_conditions = COALESCE(?, storage_conditions),
            shelf_life_days = COALESCE(?, shelf_life_days),
            gost_standard = COALESCE(?, gost_standard),
            barcode = COALESCE(?, barcode),
            notes = COALESCE(?, notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, category, unit, density, allergens, supplier, costPerKg, storageConditions, shelfLifeDays, gostStandard, barcode, notes, req.params.id);
      
      res.json({ message: 'Ingredient updated' });
    } catch (error) {
      logger.error('Update ingredient error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete ingredient
  router.delete('/ingredients/:id', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      db.prepare('DELETE FROM ingredients WHERE id = ?').run(req.params.id);
      res.json({ message: 'Ingredient deleted' });
    } catch (error) {
      logger.error('Delete ingredient error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PRODUCTION REQUESTS ====================
  
  // Create production request with calculations
  router.post('/production-requests', auth.authenticate, (req, res) => {
    try {
      const { cardId, targetYield, batches, units, notes } = req.body;
      
      const card = db.prepare('SELECT * FROM ttk_cards WHERE card_id = ?').get(cardId);
      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }
      
      const ingredients = db.prepare('SELECT * FROM card_ingredients WHERE card_id = ?').all(cardId);
      
      const scaleFactor = targetYield / card.yield;
      
      const calculatedIngredients = ingredients.map(ing => ({
        id: ing.id,
        name: ing.ingredient_name,
        baseQuantity: ing.quantity,
        calculatedQuantity: ing.quantity * scaleFactor * (batches || 1) * (units || 1),
        unit: ing.unit,
        notes: ing.notes
      }));
      
      const result = db.prepare(`
        INSERT INTO production_requests (card_id, requested_by, target_yield, batches, units, calculated_ingredients, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cardId, req.user.id, targetYield, batches || 1, units || 1, JSON.stringify(calculatedIngredients), notes, 'pending');
      
      io.to('kitchen').emit('new_production_request', {
        requestId: result.lastInsertRowid,
        cardId,
        cardTitle: card.title,
        targetYield,
        requestedBy: req.user.full_name
      });
      
      res.status(201).json({ 
        message: 'Production request created', 
        requestId: result.lastInsertRowid,
        calculatedIngredients 
      });
    } catch (error) {
      logger.error('Create production request error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get production requests
  router.get('/production-requests', auth.authenticate, (req, res) => {
    try {
      const { status, cardId } = req.query;
      
      let query = `
        SELECT pr.*, tc.title as card_title, u.full_name as requester_name, u2.full_name as approver_name
        FROM production_requests pr
        JOIN ttk_cards tc ON pr.card_id = tc.card_id
        LEFT JOIN users u ON pr.requested_by = u.id
        LEFT JOIN users u2 ON pr.approved_by = u2.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (status) {
        query += ' AND pr.status = ?';
        params.push(status);
      }
      
      if (cardId) {
        query += ' AND pr.card_id = ?';
        params.push(cardId);
      }
      
      query += ' ORDER BY pr.created_at DESC';
      
      const requests = db.prepare(query).all(...params);
      
      res.json(requests);
    } catch (error) {
      logger.error('Get production requests error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update production request status
  router.put('/production-requests/:id/status', auth.authenticate, auth.requireRole('operator', 'admin'), (req, res) => {
    try {
      const { status, notes } = req.body;
      
      const updates = ['status = ?'];
      const updateParams = [status];
      
      if (status === 'approved') {
        updates.push('approved_by = ?');
        updateParams.push(req.user.id);
        updates.push('started_at = CURRENT_TIMESTAMP');
      }
      
      if (status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }
      
      if (notes) {
        updates.push('notes = ?');
        updateParams.push(notes);
      }
      
      db.prepare(`UPDATE production_requests SET ${updates.join(', ')} WHERE id = ?`).run(...updateParams, req.params.id);
      
      res.json({ message: 'Request status updated' });
    } catch (error) {
      logger.error('Update request status error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== EXPORT ROUTES ====================
  
  // Export card to PDF
  router.get('/export/pdf/:cardId', auth.authenticate, async (req, res) => {
    try {
      const card = db.prepare('SELECT * FROM ttk_cards WHERE card_id = ?').get(req.params.cardId);
      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }
      
      const ingredients = db.prepare('SELECT * FROM card_ingredients WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const steps = db.prepare('SELECT * FROM process_steps WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const haccpControls = db.prepare('SELECT * FROM haccp_controls WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const qualityParams = db.prepare('SELECT * FROM quality_params WHERE card_id = ?').get(req.params.cardId);
      
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const filename = `TTK-${card.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      doc.pipe(res);
      
      // Header
      doc.fontSize(16).text(card.title, { align: 'center' });
      doc.fontSize(10).text(`ТУ: ${card.tu_number || 'Не указано'}`, { align: 'center' });
      doc.text(`Выход: ${card.yield} г`, { align: 'center' });
      doc.moveDown();
      
      // Ingredients table
      doc.fontSize(12).text('Ингредиенты:', { underline: true });
      doc.moveDown(0.5);
      
      let yPos = doc.y;
      doc.fontSize(10);
      ingredients.forEach((ing, idx) => {
        doc.text(`${idx + 1}. ${ing.ingredient_name}`, 50, yPos);
        doc.text(`${ing.quantity} ${ing.unit}`, 400, yPos);
        yPos += 15;
      });
      
      doc.moveDown();
      
      // Process steps
      doc.fontSize(12).text('Технологический процесс:', { underline: true });
      doc.moveDown(0.5);
      
      steps.forEach(step => {
        doc.fontSize(10).text(`${step.step_number}. ${step.description}`);
        if (step.temperature) doc.text(`   Температура: ${step.temperature}°C`);
        if (step.time_minutes) doc.text(`   Время: ${step.time_minutes} мин`);
        doc.moveDown(0.3);
      });
      
      // HACCP controls
      if (haccpControls.length > 0) {
        doc.moveDown();
        doc.fontSize(12).text('Контроль критических точек (HACCP):', { underline: true });
        doc.moveDown(0.5);
        
        haccpControls.forEach(kkt => {
          doc.fontSize(10).text(`ККТ-${kkt.kkt_number} (${kkt.kkt_type}): ${kkt.control_measure}`);
          doc.text(`   Критический предел: ${kkt.critical_limit}`);
          doc.text(`   Мониторинг: ${kkt.monitoring_procedure}`);
          doc.moveDown(0.3);
        });
      }
      
      // Quality parameters
      if (qualityParams) {
        doc.moveDown();
        doc.fontSize(12).text('Органолептические показатели:', { underline: true });
        doc.moveDown(0.5);
        
        doc.fontSize(10);
        if (qualityParams.appearance) doc.text(`Внешний вид: ${qualityParams.appearance}`);
        if (qualityParams.color) doc.text(`Цвет: ${qualityParams.color}`);
        if (qualityParams.taste) doc.text(`Вкус: ${qualityParams.taste}`);
        if (qualityParams.smell) doc.text(`Запах: ${qualityParams.smell}`);
        if (qualityParams.consistency) doc.text(`Консистенция: ${qualityParams.consistency}`);
      }
      
      doc.end();
      
      logger.info(`PDF exported: ${filename}`);
    } catch (error) {
      logger.error('Export PDF error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export card to Excel
  router.get('/export/excel/:cardId', auth.authenticate, async (req, res) => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('ТТК');
      
      const card = db.prepare('SELECT * FROM ttk_cards WHERE card_id = ?').get(req.params.cardId);
      const ingredients = db.prepare('SELECT * FROM card_ingredients WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const steps = db.prepare('SELECT * FROM process_steps WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      
      // Title
      worksheet.mergeCells('A1:F1');
      worksheet.getCell('A1').value = card.title;
      worksheet.getCell('A1').font = { bold: true, size: 16 };
      
      // Info
      worksheet.getCell('A3').value = 'ТУ:';
      worksheet.getCell('B3').value = card.tu_number;
      worksheet.getCell('A4').value = 'Выход:';
      worksheet.getCell('B4').value = `${card.yield} г`;
      
      // Ingredients header
      worksheet.getCell('A6').value = '№';
      worksheet.getCell('B6').value = 'Ингредиент';
      worksheet.getCell('C6').value = 'Количество';
      worksheet.getCell('D6').value = 'Ед. изм.';
      worksheet.getCell('E6').value = 'Брутто';
      worksheet.getCell('F6').value = 'Нетто';
      
      // Ingredients data
      ingredients.forEach((ing, idx) => {
        const row = idx + 7;
        worksheet.getCell(`A${row}`).value = idx + 1;
        worksheet.getCell(`B${row}`).value = ing.ingredient_name;
        worksheet.getCell(`C${row}`).value = ing.quantity;
        worksheet.getCell(`D${row}`).value = ing.unit;
        worksheet.getCell(`E${row}`).value = ing.brutto_weight;
        worksheet.getCell(`F${row}`).value = ing.net_weight;
      });
      
      // Steps
      const stepsRow = ingredients.length + 10;
      worksheet.getCell(`A${stepsRow}`).value = 'Технологический процесс:';
      worksheet.getCell(`A${stepsRow}`).font = { bold: true };
      
      steps.forEach((step, idx) => {
        const row = stepsRow + idx + 1;
        worksheet.getCell(`A${row}`).value = `${step.step_number}. ${step.description}`;
      });
      
      // Auto-fit columns
      worksheet.columns.forEach(col => {
        col.width = 20;
      });
      
      const filename = `TTK-${card.title.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      await workbook.xlsx.write(res);
      res.end();
      
      logger.info(`Excel exported: ${filename}`);
    } catch (error) {
      logger.error('Export Excel error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export to JSON
  router.get('/export/json/:cardId', auth.authenticate, (req, res) => {
    try {
      const card = db.prepare('SELECT * FROM ttk_cards WHERE card_id = ?').get(req.params.cardId);
      const ingredients = db.prepare('SELECT * FROM card_ingredients WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const steps = db.prepare('SELECT * FROM process_steps WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const haccpControls = db.prepare('SELECT * FROM haccp_controls WHERE card_id = ? ORDER BY sort_order').all(req.params.cardId);
      const qualityParams = db.prepare('SELECT * FROM quality_params WHERE card_id = ?').get(req.params.cardId);
      const subRecipes = db.prepare('SELECT * FROM sub_recipes WHERE parent_card_id = ?').all(req.params.cardId);
      
      const exportData = {
        id: card.card_id,
        title: card.title,
        yield: card.yield,
        type: card.type,
        tu: card.tu_number,
        ing: ingredients.map(i => [i.ingredient_name, i.quantity]),
        steps: steps.map(s => s.description).join('. '),
        org: qualityParams ? Object.values(qualityParams).filter(v => v).join('; ') : '',
        haccp: haccpControls.map(h => `ККТ-${h.kkt_number}: ${h.control_measure}`).join('. '),
        date: new Date().toISOString().split('T')[0],
        created_at: Date.now(),
        target_yield: card.target_yield,
        sub_pfs: subRecipes.map(sr => ({
          title: sr.title,
          yield_kg: sr.yield_kg,
          ingredients: db.prepare('SELECT ingredient_name, quantity FROM sub_recipe_ingredients WHERE sub_recipe_id = ?').all(sr.id).map(i => [i.ingredient_name, i.quantity]),
          process_steps: sr.process_steps,
          haccp: sr.haccp,
          storage_conditions: sr.storage_conditions,
          shelf_life: sr.shelf_life,
          allergens: sr.allergens
        }))
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="TTK-${card.card_id}.json"`);
      res.json(exportData);
    } catch (error) {
      logger.error('Export JSON error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import from JSON
  router.post('/import/json', auth.authenticate, auth.requireRole('operator', 'admin'), upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'File required' });
      }
      
      const importData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
      
      // Process import (similar structure to user's example)
      const cardId = `ttk_${Date.now()}_${uuidv4().substring(0, 8)}`;
      
      db.prepare(`
        INSERT INTO ttk_cards (card_id, title, type, yield, tu_number, created_by, status)
        VALUES (?, ?, ?, ?, ?, ?, 'approved')
      `).run(cardId, importData.title, importData.type || 'dish', importData.yield, importData.tu, req.user.id);
      
      // Insert ingredients
      if (importData.ing) {
        importData.ing.forEach((item, idx) => {
          db.prepare(`
            INSERT INTO card_ingredients (card_id, ingredient_name, quantity, sort_order)
            VALUES (?, ?, ?, ?)
          `).run(cardId, item[0], item[1], idx);
        });
      }
      
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      io.emit('card_update', { action: 'imported', cardId, title: importData.title });
      
      res.json({ message: 'Import successful', cardId });
    } catch (error) {
      logger.error('Import JSON error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import from Excel
  router.post('/import/excel', auth.authenticate, auth.requireRole('operator', 'admin'), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'File required' });
      }
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      
      const worksheet = workbook.getWorksheet(1);
      const cards = [];
      
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        
        const cardData = {
          title: row.getCell(1).value,
          type: row.getCell(2).value,
          yield: row.getCell(3).value,
          tu: row.getCell(4).value,
          ingredients: []
        };
        
        cards.push(cardData);
      });
      
      // Process imported cards
      for (const cardData of cards) {
        const cardId = `ttk_${Date.now()}_${uuidv4().substring(0, 8)}`;
        
        db.prepare(`
          INSERT INTO ttk_cards (card_id, title, type, yield, tu_number, created_by, status)
          VALUES (?, ?, ?, ?, ?, ?, 'draft')
        `).run(cardId, cardData.title, cardData.type, cardData.yield, cardData.tu, req.user.id);
      }
      
      fs.unlinkSync(req.file.path);
      
      res.json({ message: `Imported ${cards.length} cards`, count: cards.length });
    } catch (error) {
      logger.error('Import Excel error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== NEWS FEED ROUTES ====================
  
  router.get('/news', auth.authenticate, (req, res) => {
    try {
      const news = db.prepare(`
        SELECT nf.*, u.full_name as author_name, u.avatar as author_avatar,
               tc.title as card_title
        FROM news_feed nf
        LEFT JOIN users u ON nf.author_id = u.id
        LEFT JOIN ttk_cards tc ON nf.card_id = tc.card_id
        ORDER BY nf.is_pinned DESC, nf.created_at DESC
        LIMIT 50
      `).all();
      
      res.json(news);
    } catch (error) {
      logger.error('Get news error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/news', auth.authenticate, upload.array('media', 10), (req, res) => {
    try {
      const { content, cardId, isPinned } = req.body;
      
      if (!content) {
        return res.status(400).json({ error: 'Content required' });
      }
      
      const mediaPaths = req.files ? req.files.map(f => `/uploads/${f.path.split('/').pop()}`) : [];
      const mediaType = mediaPaths.length === 0 ? 'text' : 
                        mediaPaths.some(f => f.match(/\.(mp4|webm)$/)) ? 'video' :
                        mediaPaths.some(f => f.match(/\.(jpg|jpeg|png|gif)$/)) ? 'image' : 'mixed';
      
      db.prepare(`
        INSERT INTO news_feed (author_id, content, media_type, media_paths, card_id, is_pinned)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.user.id, content, mediaType, JSON.stringify(mediaPaths), cardId || null, isPinned ? 1 : 0);
      
      io.emit('news_update', { action: 'created' });
      
      res.status(201).json({ message: 'News posted' });
    } catch (error) {
      logger.error('Post news error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== USERS MANAGEMENT (Admin) ====================
  
  router.get('/users', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      const users = db.prepare(`
        SELECT id, username, role, full_name, department, created_at, last_login, is_active
        FROM users
        ORDER BY created_at DESC
      `).all();
      
      res.json(users);
    } catch (error) {
      logger.error('Get users error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/users/:id/role', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      const { role } = req.body;
      
      if (!['guest', 'operator', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
      
      res.json({ message: 'Role updated' });
    } catch (error) {
      logger.error('Update role error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/users/:id/active', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      const { isActive } = req.body;
      db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, req.params.id);
      res.json({ message: 'User status updated' });
    } catch (error) {
      logger.error('Update user status error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SYSTEM SETTINGS ====================
  
  router.get('/settings', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      const settings = db.prepare('SELECT * FROM system_settings').all();
      res.json(settings.reduce((acc, s) => ({ ...acc, [s.key]: JSON.parse(s.value) }), {}));
    } catch (error) {
      logger.error('Get settings error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/settings/:key', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      db.prepare(`
        INSERT OR REPLACE INTO system_settings (key, value, updated_by, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run(req.params.key, JSON.stringify(req.body.value), req.user.id);
      
      res.json({ message: 'Settings updated' });
    } catch (error) {
      logger.error('Update settings error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ACTIVITY LOGS ====================
  
  router.get('/activity-logs', auth.authenticate, auth.requireRole('admin'), (req, res) => {
    try {
      const { limit = 100, userId, action } = req.query;
      
      let query = `
        SELECT al.*, u.username, u.full_name
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (userId) {
        query += ' AND al.user_id = ?';
        params.push(userId);
      }
      
      if (action) {
        query += ' AND al.action = ?';
        params.push(action);
      }
      
      query += ' ORDER BY al.created_at DESC LIMIT ?';
      params.push(parseInt(limit));
      
      const logs = db.prepare(query).all(...params);
      
      res.json(logs);
    } catch (error) {
      logger.error('Get activity logs error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Log activity helper
  const logActivity = (userId, action, entityType, entityId, details, ip, userAgent) => {
    try {
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, action, entityType, entityId, JSON.stringify(details), ip, userAgent);
    } catch (error) {
      logger.error('Log activity error:', error);
    }
  };

  // Attach logging to router
  router.use((req, res, next) => {
    if (req.user && req.method !== 'GET') {
      logActivity(
        req.user.id,
        `${req.method} ${req.path}`,
        req.params.cardId ? 'card' : req.params.id ? 'entity' : 'other',
        req.params.cardId || req.params.id || null,
        req.body,
        req.ip,
        req.headers['user-agent']
      );
    }
    next();
  });

  return router;
};

module.exports = apiRoutes;
