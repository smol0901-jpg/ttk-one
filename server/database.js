const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const dbPath = process.env.DB_PATH || './database/ttk.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const createTables = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      role TEXT DEFAULT 'guest' CHECK(role IN ('guest', 'operator', 'admin')),
      full_name TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      last_login INTEGER,
      is_active INTEGER DEFAULT 1,
      kiosk_mode INTEGER DEFAULT 0,
      telegram_id TEXT,
      department TEXT
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      category TEXT,
      unit TEXT DEFAULT 'кг',
      price_per_unit REAL DEFAULT 0,
      supplier TEXT,
      allergens TEXT,
      storage_conditions TEXT,
      shelf_life_days INTEGER,
      barcode TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS ttk_cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      yield REAL NOT NULL,
      target_yield REAL,
      type TEXT,
      tu TEXT,
      ing TEXT NOT NULL,
      steps TEXT,
      org TEXT,
      haccp TEXT,
      sub_pfs TEXT,
      scores TEXT,
      date TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      created_by TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'archived', 'pending_review')),
      views_count INTEGER DEFAULT 0,
      print_count INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      parent_id TEXT,
      tags TEXT,
      photos TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS edit_requests (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      error_location TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'completed')),
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      resolved_at INTEGER,
      resolved_by TEXT,
      response TEXT,
      FOREIGN KEY (card_id) REFERENCES ttk_cards(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feed_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT,
      media_type TEXT,
      media_url TEXT,
      card_id TEXT,
      likes INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (card_id) REFERENCES ttk_cards(id)
    );

    CREATE TABLE IF NOT EXISTS feed_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (post_id) REFERENCES feed_posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS tu_standards (
      id TEXT PRIMARY KEY,
      tu_number TEXT UNIQUE NOT NULL,
      title TEXT,
      content TEXT,
      parsed_data TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_ttk_title ON ttk_cards(title);
    CREATE INDEX IF NOT EXISTS idx_ttk_type ON ttk_cards(type);
    CREATE INDEX IF NOT EXISTS idx_ttk_status ON ttk_cards(status);
    CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);
    CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at);
  `);

  const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  if (adminCount.count === 0) {
    const adminId = 'admin_' + Date.now();
    const defaultAdminPassword = process.env.ADMIN_PASSWORD || '0000';
    const passwordHash = bcrypt.hashSync(defaultAdminPassword, 10);
    
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(adminId, 'admin', passwordHash, 'admin', 'Администратор системы');

    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
    `).run('initialized', 'true');
  }

  const guestExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('guest');
  if (guestExists.count === 0) {
    const guestId = 'guest_default';
    db.prepare(`
      INSERT INTO users (id, username, role, full_name)
      VALUES (?, ?, ?, ?)
    `).run(guestId, 'guest', 'guest', 'Гость');
  }
};

createTables();

module.exports = db;
