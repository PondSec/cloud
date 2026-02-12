import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
const dbDir = path.dirname(config.dbPath);
fs.mkdirSync(dbDir, { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
function migrate() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS git_credentials (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      host TEXT NOT NULL,
      username TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, host),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
}
migrate();
export function createUser(record) {
    db.prepare(`INSERT INTO users (id, email, password_hash, created_at) VALUES (@id, @email, @passwordHash, @createdAt)`).run(record);
}
export function findUserByEmail(email) {
    const row = db.prepare(`SELECT id, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?`).get(email);
    return row;
}
export function findUserById(id) {
    const row = db.prepare(`SELECT id, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ?`).get(id);
    return row;
}
export function createWorkspace(record, settings) {
    const insertWorkspace = db.prepare(`INSERT INTO workspaces (id, user_id, name, template, created_at, updated_at) VALUES (@id, @userId, @name, @template, @createdAt, @updatedAt)`);
    const insertSettings = db.prepare(`INSERT INTO workspace_settings (workspace_id, settings_json) VALUES (?, ?)`);
    const tx = db.transaction(() => {
        insertWorkspace.run(record);
        insertSettings.run(record.id, JSON.stringify(settings));
    });
    tx();
}
export function listWorkspaces(userId) {
    const rows = db
        .prepare(`SELECT id, user_id AS userId, name, template, created_at AS createdAt, updated_at AS updatedAt
       FROM workspaces WHERE user_id = ? ORDER BY updated_at DESC`)
        .all(userId);
    return rows;
}
export function findWorkspace(workspaceId, userId) {
    const row = db
        .prepare(`SELECT id, user_id AS userId, name, template, created_at AS createdAt, updated_at AS updatedAt
       FROM workspaces WHERE id = ? AND user_id = ?`)
        .get(workspaceId, userId);
    return row;
}
export function deleteWorkspace(workspaceId, userId) {
    db.prepare(`DELETE FROM workspaces WHERE id = ? AND user_id = ?`).run(workspaceId, userId);
}
export function updateWorkspaceTimestamp(workspaceId) {
    db.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), workspaceId);
}
export function getWorkspaceSettings(workspaceId) {
    const row = db.prepare(`SELECT settings_json FROM workspace_settings WHERE workspace_id = ?`).get(workspaceId);
    if (!row) {
        throw new Error('Workspace settings not found');
    }
    return JSON.parse(row.settings_json);
}
export function setWorkspaceSettings(workspaceId, settings) {
    db.prepare(`UPDATE workspace_settings SET settings_json = ? WHERE workspace_id = ?`).run(JSON.stringify(settings), workspaceId);
}
export function upsertGitCredential(record) {
    db.prepare(`INSERT INTO git_credentials (id, workspace_id, host, username, ciphertext, iv, auth_tag, created_at, updated_at)
     VALUES (@id, @workspaceId, @host, @username, @ciphertext, @iv, @authTag, @createdAt, @updatedAt)
     ON CONFLICT(workspace_id, host)
     DO UPDATE SET
       username = excluded.username,
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       updated_at = excluded.updated_at`).run(record);
}
export function findGitCredential(workspaceId, host) {
    const row = db
        .prepare(`SELECT id, workspace_id AS workspaceId, host, username, ciphertext, iv, auth_tag AS authTag,
              created_at AS createdAt, updated_at AS updatedAt
       FROM git_credentials WHERE workspace_id = ? AND host = ?`)
        .get(workspaceId, host);
    return row;
}
export function deleteGitCredential(workspaceId, host) {
    db.prepare(`DELETE FROM git_credentials WHERE workspace_id = ? AND host = ?`).run(workspaceId, host);
}
