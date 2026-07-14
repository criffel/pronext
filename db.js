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
  `);

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

module.exports = {
  initDB,
  saveState,
  loadState,
  registerCall,
  getStats
};
