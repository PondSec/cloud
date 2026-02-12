import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createWorkspace, deleteWorkspace, findWorkspace, getWorkspaceSettings, listWorkspaces, setWorkspaceSettings, updateWorkspaceTimestamp, } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../utils/http-error.js';
import { scaffoldTemplate, templateDefaults } from './templates.js';
export function workspaceRootPath(workspaceId) {
    return path.join(config.workspacesRoot, workspaceId);
}
export async function createWorkspaceForUser(args) {
    const now = new Date().toISOString();
    const workspaceId = uuidv4();
    const record = {
        id: workspaceId,
        userId: args.userId,
        name: args.name,
        template: args.template,
        createdAt: now,
        updatedAt: now,
    };
    const settings = templateDefaults(args.template);
    createWorkspace(record, settings);
    const rootDir = workspaceRootPath(workspaceId);
    await fs.mkdir(rootDir, { recursive: true });
    await scaffoldTemplate(rootDir, args.template);
    return record;
}
export function listUserWorkspaces(userId) {
    return listWorkspaces(userId);
}
export function requireWorkspace(workspaceId, userId) {
    const workspace = findWorkspace(workspaceId, userId);
    if (!workspace) {
        throw new HttpError(404, 'Workspace not found');
    }
    return workspace;
}
export async function removeWorkspace(workspaceId, userId) {
    requireWorkspace(workspaceId, userId);
    deleteWorkspace(workspaceId, userId);
    await fs.rm(workspaceRootPath(workspaceId), { recursive: true, force: true });
}
export function readWorkspaceSettings(workspaceId) {
    return getWorkspaceSettings(workspaceId);
}
export function writeWorkspaceSettings(workspaceId, settings) {
    setWorkspaceSettings(workspaceId, settings);
    updateWorkspaceTimestamp(workspaceId);
}
