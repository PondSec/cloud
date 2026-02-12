import { spawn } from 'node:child_process';
import { config } from '../config.js';
export async function runCommand(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(config.dockerBin, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({
                stdout,
                stderr,
                exitCode: code ?? 1,
            });
        });
    });
}
export function shellEscape(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
