import fs from 'node:fs/promises';
import path from 'node:path';

import { v4 as uuidv4 } from 'uuid';

import {
  createWorkspace,
  deleteWorkspace,
  findWorkspace,
  getWorkspaceSettings,
  listWorkspaces,
  renameWorkspace,
  setWorkspaceSettings,
  updateWorkspaceTimestamp,
} from '../db.js';
import { config } from '../config.js';
import type { WorkspaceRecord, WorkspaceSettings } from '../types.js';
import { HttpError } from '../utils/http-error.js';
import { scaffoldTemplate, templateDefaults } from './templates.js';

export function workspaceRootPath(workspaceId: string): string {
  return path.join(config.workspacesRoot, workspaceId);
}

export async function createWorkspaceForUser(args: {
  userId: string;
  name: string;
  template: string;
}): Promise<WorkspaceRecord> {
  const now = new Date().toISOString();
  const workspaceId = uuidv4();
  const record: WorkspaceRecord = {
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

export function listUserWorkspaces(userId: string): WorkspaceRecord[] {
  return listWorkspaces(userId);
}

export function requireWorkspace(workspaceId: string, userId: string): WorkspaceRecord {
  const workspace = findWorkspace(workspaceId, userId);
  if (!workspace) {
    throw new HttpError(404, 'Workspace not found');
  }
  return workspace;
}

export async function removeWorkspace(workspaceId: string, userId: string): Promise<void> {
  requireWorkspace(workspaceId, userId);
  deleteWorkspace(workspaceId, userId);
  await fs.rm(workspaceRootPath(workspaceId), { recursive: true, force: true });
}

export function renameWorkspaceForUser(workspaceId: string, userId: string, name: string): WorkspaceRecord {
  requireWorkspace(workspaceId, userId);
  renameWorkspace(workspaceId, userId, name);
  return requireWorkspace(workspaceId, userId);
}

export function readWorkspaceSettings(workspaceId: string): WorkspaceSettings {
  return getWorkspaceSettings(workspaceId);
}

export function writeWorkspaceSettings(workspaceId: string, settings: WorkspaceSettings): void {
  setWorkspaceSettings(workspaceId, settings);
  updateWorkspaceTimestamp(workspaceId);
}
