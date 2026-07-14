const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

// Verifica se existe uma pasta /data (Padrão para volumes persistentes no Railway/Docker)
// Se não, usa a raiz do projeto (desenvolvimento local)
const dataDir = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(dataDir, 'filapro.db');

let db;

async function initDB() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Criação das tabelas
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS call_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT,
      sector TEXT,
      ticket_number INTEGER,
      guiche TEXT,
      called_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT
    );

    CREATE TABLE IF NOT EXISTS tv_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT,
      media_url TEXT,
      media_type TEXT,
      duration INTEGER
    );

    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT
    );
  `);

  // Seed default stores if table is empty
  const storeCount = await db.get(`SELECT COUNT(*) as count FROM stores`);
  if (storeCount.count === 0) {
    const initialStores = [
      { id: '01', name: 'Machado Primaveras' },
      { id: '02', name: 'Machado Tarumãs' },
      { id: '03', name: 'Machado Itaúbas' },
      { id: '04', name: 'Machado Jardim Primaveras' },
      { id: '10', name: 'Machado Aeroporto' },
      { id: '11', name: 'Machado Tancredo Neves' },
      { id: '56', name: 'Machado Supercenter' },
      { id: '59', name: 'Machado Vitoria Regia' },
      { id: '54', name: 'Machado 163' }
    ];
    for (const s of initialStores) {
      await db.run(`INSERT INTO stores (id, name) VALUES (?, ?)`, [s.id, s.name]);
    }
  }

  // Create default admin if not exists
  const adminExists = await db.get(`SELECT id FROM users WHERE username = 'admin'`);
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    await db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['admin', hash, 'superadmin']);
  }

  console.log(`[DB] Banco de dados inicializado em: ${dbPath}`);
  return db;
}

// Persistência de Estado (Key-Value)
async function saveState(key, value) {
  if (!db) return;
  const jsonValue = JSON.stringify(value);
  await db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?) 
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, jsonValue]
  );
}

async function loadState(key) {
  if (!db) return null;
  const row = await db.get(`SELECT value FROM app_state WHERE key = ?`, [key]);
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch (e) {
      console.error(`[DB] Erro ao fazer parse do estado ${key}:`, e);
      return null;
    }
  }
  return null;
}

// Histórico de Chamadas (Para Relatórios)
async function registerCall(store, sector, ticket_number, guiche, called_at) {
  if (!db) return;
  await db.run(
    `INSERT INTO call_history (store, sector, ticket_number, guiche, called_at) VALUES (?, ?, ?, ?, ?)`,
    [store, sector, ticket_number, guiche, called_at]
  );
}

// Funções de Consulta para o Dashboard
async function getStats(store) {
  if (!db) return null;
  
  // Define o início de hoje (Meia noite)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartTimestamp = todayStart.getTime();

  // Quantidade de chamadas por setor hoje
  const callsBySector = await db.all(
    `SELECT sector, COUNT(*) as count 
     FROM call_history 
     WHERE store = ? AND called_at >= ? 
     GROUP BY sector`,
    [store, todayStartTimestamp]
  );

  // Evolução das chamadas por hora hoje
  const callsByHour = await db.all(
    `SELECT 
       cast(strftime('%H', datetime(called_at / 1000, 'unixepoch', 'localtime')) as integer) as hour,
       COUNT(*) as count
     FROM call_history
     WHERE store = ? AND called_at >= ?
     GROUP BY hour
     ORDER BY hour`,
    [store, todayStartTimestamp]
  );

  return {
    callsBySector,
    callsByHour
  };
}

// TV Media Management
async function getAllMedia(store) {
  if (!db) return [];
  return await db.all(`SELECT * FROM tv_media WHERE store = ?`, [store]);
}

async function addMedia(store, media_url, media_type, duration) {
  if (!db) return;
  await db.run(
    `INSERT INTO tv_media (store, media_url, media_type, duration) VALUES (?, ?, ?, ?)`,
    [store, media_url, media_type, duration || 7000]
  );
}

async function removeMedia(id) {
  if (!db) return;
  await db.run(`DELETE FROM tv_media WHERE id = ?`, [id]);
}

// User Authentication
async function getUser(username) {
  if (!db) return null;
  return await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
}

// --- GESTÃO DE FILIAIS (STORES) ---
async function getAllStores() {
  if (!db) return [];
  return await db.all(`SELECT id, name FROM stores ORDER BY id ASC`);
}

async function addStore(id, name) {
  if (!db) return;
  await db.run(`INSERT INTO stores (id, name) VALUES (?, ?)`, [id, name]);
}

async function removeStore(id) {
  if (!db) return;
  await db.run(`DELETE FROM stores WHERE id = ?`, [id]);
}

module.exports = {
  initDB,
  saveState,
  loadState,
  registerCall,
  getStats,
  getUser,
  getAllMedia,
  addMedia,
  removeMedia,
  getAllStores,
  addStore,
  removeStore
};
