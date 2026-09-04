const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const db = require('../database');
const { authenticateToken } = require('./auth');
const path = require('path');
const fs = require('fs');

router.get('/ttk/:id/pdf', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const card = db.prepare('SELECT * FROM ttk_cards WHERE id = ?').get(id);
    
    if (!card) {
      return res.status(404).json({ error: 'Карта не найдена' });
    }

    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${card.title}.pdf"`);
    
    doc.pipe(res);

    doc.fontSize(18).text(card.title, { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(12).text(`ТУ: ${card.tu || 'Не указано'}`);
    doc.text(`Выход: ${card.yield} г`);
    doc.text(`Дата: ${card.date || ''}`);
    doc.moveDown();

    doc.fontSize(14).text('Ингредиенты:', { underline: true });
    doc.moveDown();
    
    const ingredients = JSON.parse(card.ing);
    ingredients.forEach(([name, amount]) => {
      doc.fontSize(11).text(`${name}: ${amount} г`);
    });
    
    doc.moveDown();
    doc.fontSize(14).text('Технологический процесс:', { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(card.steps || '', { width: 500 });
    
    doc.moveDown();
    doc.fontSize(14).text('Органолептика:', { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(card.org || '', { width: 500 });
    
    if (card.haccp) {
      doc.moveDown();
      doc.fontSize(14).text('HACCP контроль:', { underline: true });
      doc.moveDown();
      doc.fontSize(11).text(card.haccp, { width: 500 });
    }

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Ошибка генерации PDF' });
  }
});

router.get('/ttk/:id/excel', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const card = db.prepare('SELECT * FROM ttk_cards WHERE id = ?').get(id);
    
    if (!card) {
      return res.status(404).json({ error: 'Карта не найдена' });
    }

    const ingredients = JSON.parse(card.ing);
    
    const wb = XLSX.utils.book_new();
    
    const data = [
      ['ТЕХНОЛОГИЧЕСКАЯ КАРТА'],
      ['Название', card.title],
      ['ТУ', card.tu || ''],
      ['Выход', card.yield],
      ['Дата', card.date || ''],
      [],
      ['ИНГРЕДИЕНТЫ'],
      ['Наименование', 'Количество (г)'],
      ...ingredients.map(([name, amount]) => [name, amount]),
      [],
      ['ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС'],
      [card.steps || ''],
      [],
      ['ОРГАНОЛЕПТИКА'],
      [card.org || ''],
      [],
      ['HACCP'],
      [card.haccp || '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'ТТК');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${card.title}.xlsx"`);
    
    XLSX.write(wb, res, { type: 'nodebuffer', bookType: 'xlsx' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка генерации Excel' });
  }
});

router.get('/all/excel', authenticateToken, (req, res) => {
  try {
    const cards = db.prepare('SELECT * FROM ttk_cards ORDER BY created_at DESC').all();
    
    const wb = XLSX.utils.book_new();
    
    const data = [
      ['ID', 'Название', 'Выход', 'Тип', 'ТУ', 'Дата', 'Статус']
    ];
    
    cards.forEach(card => {
      data.push([
        card.id,
        card.title,
        card.yield,
        card.type,
        card.tu,
        card.date,
        card.status
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Все ТТК');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ttk_all.xlsx"');
    
    XLSX.write(wb, res, { type: 'nodebuffer', bookType: 'xlsx' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

router.get('/ttk/:id/json', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const card = db.prepare('SELECT * FROM ttk_cards WHERE id = ?').get(id);
    
    if (!card) {
      return res.status(404).json({ error: 'Карта не найдена' });
    }

    card.ing = JSON.parse(card.ing);
    card.sub_pfs = card.sub_pfs ? JSON.parse(card.sub_pfs) : [];
    card.scores = card.scores ? JSON.parse(card.scores) : null;
    card.photos = card.photos ? JSON.parse(card.photos) : [];

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${card.title}.json"`);
    
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

module.exports = router;
