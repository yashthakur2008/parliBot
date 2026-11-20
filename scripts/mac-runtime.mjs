// Finder entrypoint support. No downloads, permission requests, or process killing.
import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isParliBotStatus(value) {
  return value !== null && typeof value === 'object' && typeof value.ok === 'boolean' &&
    Array.isArray(value.models) && value.speech !== null && typeof value.speech === 'object' &&
    typeof value.speech.available === 'boolean' && ['local', 'unavailable'].includes(value.speech.mode);
}
export function isOllamaStatus(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value.models);
}
export async function probe(url, validate, timeout = 20000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'error' });
    return response.ok && validate(await response.json());
  } catch { return false; }
}
export function listening(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(true)); // An ambiguous listener is never replaced.
  });
}
function detached(executable, args, log, cwd, env = process.env) {
  const fd = openSync(log, 'a', 0o600);
  try {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', error => console.error(`Cannot start ${executable}: ${error.message}`));
    child.unref();
  } finally { closeSync(fd); }
}
export async function ensureService({ port, url, validate, start, name, timeout = 45000 }) {
  if (await listening(port)) {
    if (await probe(url, validate)) return;
    throw Error(`${name}: port ${port} is occupied but its response is not recognized. Close or reconfigure that service yourself. No process was stopped.`);
  }
  start();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await probe(url, validate, Math.min(20000, deadline - Date.now()))) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`${name} did not become ready. See its log file. No process was stopped.`);
}
async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const logs = path.join(homedir(), 'Library/Logs/ParliBot');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  await ensureService({ port: 11434, url: 'http://127.0.0.1:11434/api/tags', validate: isOllamaStatus, name: 'Ollama',
    start: () => detached(process.argv[2], ['serve'], path.join(logs, 'ollama.log'), root, { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' }) });
  await ensureService({ port: 3210, url: 'http://127.0.0.1:3210/api/status', validate: isParliBotStatus, name: 'ParliBot',
    start: () => detached(process.execPath, [path.join(root, 'server/index.js')], path.join(logs, 'server.log'), root, { ...process.env, PORT: '3210' }) });
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', ['http://127.0.0.1:3210'], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Could not open the default browser. Visit http://127.0.0.1:3210 manually.')));
  });
  console.log(`${new Date().toISOString()} ParliBot ready at http://127.0.0.1:3210. Install a local Ollama model yourself if none is listed.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
