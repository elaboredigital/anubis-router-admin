import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('painel admin serve o SPA e aponta para a API configurada', async t => {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ANUBIS_API_URL: 'https://api.example.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('exit', code => reject(new Error(`servidor encerrou com ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;

  const config = await (await fetch(`${base}/config.js`)).text();
  assert.match(config, /window\.ANUBIS_API_URL = "https:\/\/api\.example\.test"/);

  const users = await fetch(`${base}/users`);
  assert.equal(users.status, 200);
  const html = await users.text();
  assert.match(html, /data-nav="users"/);
  assert.match(html, /id="admin-key"/);
  assert.match(html, /\/config\.js/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(users.headers.get('x-robots-tag'), 'noindex, nofollow');

  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \//);

  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});
