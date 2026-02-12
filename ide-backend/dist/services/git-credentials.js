import { URL } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { deleteGitCredential, findGitCredential, upsertGitCredential, } from '../db.js';
import { decryptString, encryptString } from '../utils/crypto.js';
export function saveGitCredential(input) {
    const now = new Date().toISOString();
    const encrypted = encryptString(input.token);
    const record = {
        id: uuidv4(),
        workspaceId: input.workspaceId,
        host: input.host,
        username: input.username,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        createdAt: now,
        updatedAt: now,
    };
    upsertGitCredential(record);
}
export function removeGitCredential(workspaceId, host) {
    deleteGitCredential(workspaceId, host);
}
export function credentialForRemote(workspaceId, remoteUrl) {
    try {
        const parsed = new URL(remoteUrl);
        const host = parsed.host;
        const record = findGitCredential(workspaceId, host);
        if (!record) {
            return undefined;
        }
        const token = decryptString({
            ciphertext: record.ciphertext,
            iv: record.iv,
            authTag: record.authTag,
        });
        return {
            username: record.username,
            token,
            host,
        };
    }
    catch {
        return undefined;
    }
}
export function injectCredentialIntoUrl(remoteUrl, credential) {
    const parsed = new URL(remoteUrl);
    parsed.username = encodeURIComponent(credential.username);
    parsed.password = encodeURIComponent(credential.token);
    return parsed.toString();
}
