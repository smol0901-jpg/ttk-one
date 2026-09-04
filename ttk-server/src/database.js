const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/ttk.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  -- Users table with roles
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'guest' CHECK(role IN ('guest', 'operator', 'admin')),
    full_name TEXT,
    avatar TEXT,
    department TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active INTEGER DEFAULT 1,
    settings JSON DEFAULT '{}'
  );

  -- Ingredients database
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    unit TEXT DEFAULT 'kg',
    density REAL DEFAULT 1.0,
    allergens TEXT,
    supplier TEXT,
    cost_per_kg REAL,
    storage_conditions TEXT,
    shelf_life_days INTEGER,
    gost_standard TEXT,
    barcode TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- TTK Cards (Technological Technological Cards)
  CREATE TABLE IF NOT EXISTS ttk_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('dish', 'sauce', 'semi_finished', 'salad', 'soup', 'dessert', 'beverage', 'other')),
    yield REAL NOT NULL,
    target_yield REAL,
    tu_number TEXT,
    gost_standard TEXT,
    category TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'approved', 'archived')),
    created_by INTEGER,
    approved_by INTEGER,
    version INTEGER DEFAULT 1,
    parent_card_id TEXT,
    photo_path TEXT,
    video_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
  );

  -- Card Ingredients (junction table)
  CREATE TABLE IF NOT EXISTS card_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    ingredient_id INTEGER,
    ingredient_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT DEFAULT 'kg',
    loss_percentage REAL DEFAULT 0,
    net_weight REAL,
    brutto_weight REAL,
    sort_order INTEGER DEFAULT 0,
    is_main INTEGER DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
  );

  -- Process Steps
  CREATE TABLE IF NOT EXISTS process_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    description TEXT NOT NULL,
    temperature REAL,
    time_minutes INTEGER,
    equipment TEXT,
    kkt_control TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id) ON DELETE CASCADE
  );

  -- HACCP/KKT Controls
  CREATE TABLE IF NOT EXISTS haccp_controls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    kkt_number TEXT NOT NULL,
    kkt_type TEXT CHECK(kkt_type IN ('CCP', 'CP', 'OPRP')),
    hazard_type TEXT,
    control_measure TEXT NOT NULL,
    critical_limit TEXT,
    monitoring_procedure TEXT,
    frequency TEXT,
    responsible_person TEXT,
    corrective_actions TEXT,
    records TEXT,
    verification TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id) ON DELETE CASCADE
  );

  -- Quality Parameters (Organoleptic)
  CREATE TABLE IF NOT EXISTS quality_params (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    appearance TEXT,
    color TEXT,
    texture TEXT,
    taste TEXT,
    smell TEXT,
    consistency TEXT,
    temperature_serving REAL,
    presentation_notes TEXT,
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id) ON DELETE CASCADE
  );

  -- Sub-recipes (Semi-finished products)
  CREATE TABLE IF NOT EXISTS sub_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_card_id TEXT NOT NULL,
    title TEXT NOT NULL,
    yield_kg REAL NOT NULL,
    process_steps TEXT,
    haccp TEXT,
    storage_conditions TEXT,
    shelf_life TEXT,
    allergens TEXT,
    notes TEXT,
    FOREIGN KEY (parent_card_id) REFERENCES ttk_cards(card_id) ON DELETE CASCADE
  );

  -- Sub-recipe Ingredients
  CREATE TABLE IF NOT EXISTS sub_recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_recipe_id INTEGER NOT NULL,
    ingredient_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT DEFAULT 'kg',
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (sub_recipe_id) REFERENCES sub_recipes(id) ON DELETE CASCADE
  );

  -- Evaluation Scores
  CREATE TABLE IF NOT EXISTS evaluation_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    appearance REAL,
    browning REAL,
    aroma REAL,
    taste REAL,
    juicy REAL,
    texture REAL,
    natural REAL,
    umami REAL,
    sweet REAL,
    acid REAL,
    salt REAL,
    spice REAL,
    overall REAL,
    evaluated_by INTEGER,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    comments TEXT,
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id) ON DELETE CASCADE,
    FOREIGN KEY (evaluated_by) REFERENCES users(id)
  );

  -- News Feed
  CREATE TABLE IF NOT EXISTS news_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER,
    content TEXT NOT NULL,
    media_type TEXT CHECK(media_type IN ('text', 'image', 'video', 'document', 'mixed')),
    media_paths TEXT,
    card_id TEXT,
    likes INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id),
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id)
  );

  -- Comments on News/Cards
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_type TEXT CHECK(parent_type IN ('news', 'card')),
    parent_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    media_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    edited_at DATETIME,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  -- Checklists
  CREATE TABLE IF NOT EXISTS checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('production', 'quality', 'haccp', 'inventory', 'cleaning')),
    card_id TEXT,
    created_by INTEGER,
    items JSON NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
    due_date DATETIME,
    completed_at DATETIME,
    completed_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (completed_by) REFERENCES users(id)
  );

  -- Production Requests
  CREATE TABLE IF NOT EXISTS production_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    requested_by INTEGER NOT NULL,
    target_yield REAL NOT NULL,
    batches INTEGER DEFAULT 1,
    units INTEGER DEFAULT 1,
    calculated_ingredients JSON NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'in_progress', 'completed', 'cancelled')),
    notes TEXT,
    approved_by INTEGER,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES ttk_cards(card_id),
    FOREIGN KEY (requested_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
  );

  -- Activity Logs
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details JSON,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- System Settings
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL,
    updated_by INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES users(id)
  );

  -- API Keys for external integrations
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    permissions JSON NOT NULL,
    rate_limit INTEGER DEFAULT 1000,
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
  );

  -- Templates
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('ttk', 'kk', 'haccp', 'report', 'checklist')),
    content JSON NOT NULL,
    category TEXT,
    is_public INTEGER DEFAULT 0,
    created_by INTEGER,
    usage_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);
  CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category);
  CREATE INDEX IF NOT EXISTS idx_ttk_cards_title ON ttk_cards(title);
  CREATE INDEX IF NOT EXISTS idx_ttk_cards_type ON ttk_cards(type);
  CREATE INDEX IF NOT EXISTS idx_ttk_cards_status ON ttk_cards(status);
  CREATE INDEX IF NOT EXISTS idx_card_ingredients_card ON card_ingredients(card_id);
  CREATE INDEX IF NOT EXISTS idx_card_ingredients_ingredient ON card_ingredients(ingredient_id);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_news_feed_created ON news_feed(created_at);
`);

// Insert default admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const bcrypt = require('bcryptjs');
  const adminHash = bcrypt.hashSync('0000', 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name) 
    VALUES (?, ?, ?, ?)
  `).run('admin', adminHash, 'admin', 'Администратор Системы');
}

// Insert default guest user
const guestExists = db.prepare('SELECT id FROM users WHERE username = ?').get('guest');
if (!guestExists) {
  db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name) 
    VALUES (?, ?, ?, ?)
  `).run('guest', '', 'guest', 'Гость');
}

// Insert default system settings
const settingsExist = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('app_config');
if (!settingsExist) {
  db.prepare(`
    INSERT INTO system_settings (key, value) 
    VALUES (?, ?)
  `).run('app_config', JSON.stringify({
    appName: 'TTK Professional Server',
    version: '2.0.0',
    allowGuestAccess: true,
    requireApprovalForNewCards: false,
    defaultLanguage: 'ru',
    dateFormat: 'DD.MM.YYYY',
    maxUploadSize: 104857600, // 100MB
    sessionTimeout: 3600,
    qrCodeEnabled: true,
    pwaEnabled: true
  }));
}

console.log('✅ Database initialized successfully');

module.exports = db;
