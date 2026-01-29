const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

let db = null

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.')
  }
  return db
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'messenger-tool.db')
  db = new Database(dbPath)

  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      profile_photo_url TEXT
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS list_friends (
      list_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      PRIMARY KEY (list_id, friend_id),
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (list_id) REFERENCES lists(id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS send_records (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_at TEXT,
      sent_at TEXT,
      error TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES friends(id)
    );

    CREATE INDEX IF NOT EXISTS idx_send_records_campaign ON send_records(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_send_records_status ON send_records(status);
  `)

  return db
}

module.exports = {
  initDatabase,
  getDb,
  get db() {
    return db
  }
}
