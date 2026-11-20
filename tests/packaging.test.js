import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isParliBotStatus, isOllamaStatus, probe, ensureService, listening } from '../scripts/mac-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const status = { ok: false, models: [], speech: { available: false, mode: 'local' } };
const run = (exe, args) => execFileSync(exe, args, { cwd: root, encoding: 'utf8' });
async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = server.address().port;
  return { port, url: `http://127.0.0.1:${port}/api/status` };
}
test('identity rejects unrelated status shapes and accepts app with no installed model', () => {
  assert.equal(isParliBotStatus(status), true);
  for (const value of [null, {}, { ok: true }, { models: [] }, { ...status, speech: {} }, { ...status, ok: 'true' }]) {
    assert.equal(isParliBotStatus(value), false);
  }
  assert.equal(isOllamaStatus({ models: [] }), true);
  assert.equal(isOllamaStatus({ ok: true }), false);
});
test('recognized running ParliBot is reused without starting or killing anything', async t => {
  const endpoint = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(status)); });
  assert.equal(await listening(endpoint.port), true);
  await ensureService({ ...endpoint, validate: isParliBotStatus, name: 'test', start: () => assert.fail('must reuse existing service') });
});
test('unrelated port occupant fails closed and remains running', async t => {
  const endpoint = await fixture(t, (_req, res) => res.end('{"ok":true}'));
  await assert.rejects(ensureService({ ...endpoint, validate: isParliBotStatus, name: 'test', start: () => assert.fail('must not start') }), /occupied.*not recognized/);
  assert.equal(await listening(endpoint.port), true);
});
test('HTTP errors, redirects, invalid JSON, and stalled responses are not readiness', async t => {
  const endpoint = await fixture(t, (req, res) => {
    if (req.url === '/bad') res.end('not json');
    if (req.url === '/redirect') { res.writeHead(302, { location: '/good' }); res.end(); }
    if (req.url === '/error') { res.writeHead(503); res.end(JSON.stringify(status)); }
    if (req.url === '/good') res.end(JSON.stringify(status));
  });
  for (const route of ['bad', 'redirect', 'error', 'stall']) {
    assert.equal(await probe(`http://127.0.0.1:${endpoint.port}/${route}`, isParliBotStatus, 100), false);
  }
});
test('service startup is called only for absent listener, and readiness is awaited', async t => {
  const placeholder = http.createServer();
  placeholder.listen(0, '127.0.0.1');
  await once(placeholder, 'listening');
  const port = placeholder.address().port;
  await new Promise(resolve => placeholder.close(resolve));
  const server = http.createServer((_req, res) => res.end(JSON.stringify(status)));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let starts = 0;
  await ensureService({ port, url: `http://127.0.0.1:${port}/api/status`, validate: isParliBotStatus, name: 'test', start: () => { starts++; server.listen(port, '127.0.0.1'); }, timeout: 3000 });
  assert.equal(starts, 1);
});
test('shell scripts parse and installer does not launch or bypass security', () => {
  for (const file of ['package-macos.sh', 'mac-launch.sh', 'install-macos.sh']) run('/bin/bash', ['-n', `scripts/${file}`]);
  const installer = readFileSync(path.join(root, 'scripts/install-macos.sh'), 'utf8');
  assert.match(installer, /ParliBot-backup-/);
  assert.match(installer, /lsof -t \+D/);
  assert.match(installer, /\$HOME\/Applications/);
  assert.doesNotMatch(installer, /(?:^|\n)\s*(?:sudo|open|xattr|spctl|kill|pkill)\s/);
  const launcher = readFileSync(path.join(root, 'scripts/mac-launch.sh'), 'utf8');
  assert.match(launcher, /\/opt\/homebrew\/bin/);
  assert.match(launcher, /\/usr\/local\/bin/);
  assert.match(launcher, />= 22/);
});
test('installer refuses an in-use bundle even when macOS lsof returns partial failure', { skip: process.platform !== 'darwin' }, async t => {
  const scratch = path.join(root, 'dist');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(path.join(scratch, 'installer-guard-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const app = path.join(home, 'Applications/ParliBot.app');
  const cwd = path.join(app, 'Contents/Resources/app');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(app, 'old-marker'), 'must remain in place');
  const download = path.join(dir, 'download');
  mkdirSync(path.join(download, 'ParliBot.app/Contents/MacOS'), { recursive: true });
  writeFileSync(path.join(download, 'ParliBot.app/Contents/Info.plist'), 'test fixture only');
  copyFileSync(path.join(root, 'scripts/install-macos.sh'), path.join(download, 'Install ParliBot.command'));
  // A synthetic sleep holds only a fixture directory, never the actual app.
  const child = spawn('/bin/sleep', ['30'], { cwd, stdio: 'ignore' });
  await once(child, 'spawn');
  try {
    const result = spawnSync('/bin/bash', [path.join(download, 'Install ParliBot.command')], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /still in use/);
    assert.equal(readFileSync(path.join(app, 'old-marker'), 'utf8'), 'must remain in place');
    assert.deepEqual(readdirSync(path.join(home, 'Applications')), ['ParliBot.app']);
  } finally {
    child.kill('SIGTERM'); // Only the synthetic child created by this test.
    await once(child, 'exit');
  }
});
test('built archive is relocatable, signed, includes compiled helper, and has verified checksums', { skip: process.platform !== 'darwin' || (!existsSync(path.join(root, 'dist/ParliBot-macOS.zip')) && process.env.PARLIBOT_PACKAGE_TESTS !== '1') }, async t => {
  assert.ok(existsSync(path.join(root, 'dist/ParliBot-macOS.zip')), 'Run bash scripts/package-macos.sh before packaging tests');
  const scratch = path.join(root, 'dist');
  mkdirSync(scratch, { recursive: true });
  const extracted = mkdtempSync(path.join(scratch, 'packaging-test-'));
  t.after(() => rmSync(extracted, { recursive: true, force: true }));
  run('/usr/bin/unzip', ['-q', 'dist/ParliBot-macOS.zip', '-d', extracted]);
  const app = path.join(extracted, 'ParliBot.app');
  const resources = path.join(app, 'Contents/Resources/app');
  for (const file of ['public/index.html', 'server/index.js', 'package.json', 'scripts/mac-launch.sh', 'scripts/mac-runtime.mjs', 'native/build/ParliBotVoice.app/Contents/MacOS/ParliBotVoice']) {
    assert.ok(existsSync(path.join(resources, file)), file);
  }
  for (const executable of [path.join(app, 'Contents/MacOS/ParliBot'), path.join(resources, 'native/build/ParliBotVoice.app/Contents/MacOS/ParliBotVoice')]) {
    assert.ok(statSync(executable).mode & 0o111);
    assert.match(run('/usr/bin/file', [executable]), /Mach-O 64-bit executable arm64/);
  }
  assert.ok(statSync(path.join(extracted, 'Install ParliBot.command')).mode & 0o111);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  run('/usr/bin/plutil', ['-lint', path.join(app, 'Contents/Info.plist')]);
  // Import extracted server, not repo sources. No app launch, browser, microphone,
  // real Ollama, user-local install, or native helper execution occurs in this test.
  const { createServer } = await import(pathToFileURL(path.join(resources, 'server/index.js')));
  const server = createServer({ model: { status: async () => [] }, speech: { status: async () => status.speech } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await probe(`${url}/api/status`, isParliBotStatus), true);
  assert.match(await (await fetch(url)).text(), /ParliBot/);
  const sums = execFileSync('/usr/bin/shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: path.join(root, 'dist'), encoding: 'utf8' });
  assert.match(sums, /ParliBot-macOS.zip: OK/);
  assert.match(sums, /ParliBot-source.zip: OK/);
  const sourceEntries = run('/usr/bin/unzip', ['-Z1', 'dist/ParliBot-source.zip']).trim().split('\n');
  for (const file of sourceEntries) {
    assert.match(file, /^ParliBot-source\/(?:README.md|PACKAGING.txt|package.json|(?:public|server|scripts|tests|native)\/[^/]+)$/);
    assert.doesNotMatch(file, /(?:\.env|\.DS_Store|node_modules|\.git\/|\.pdf|\.docx|\.log$)/i);
  }
  const appEntries = run('/usr/bin/unzip', ['-Z1', 'dist/ParliBot-macOS.zip']);
  assert.doesNotMatch(appEntries, /(?:node_modules\/|\/node$|\/ollama$|\.gguf$|__MACOSX|\.DS_Store)/m);
});
