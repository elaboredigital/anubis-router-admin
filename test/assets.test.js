import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(root + file, 'utf8');

// Em 2026-11 o Dockerfile listava arquivo por arquivo e deixou de fora scripts novos:
// Preços por modelo, Recargas, Disponibilidade e Alterar senha davam 404 em produção.
test('todo arquivo local citado no index.html existe e entra na imagem Docker', () => {
  const html = read('index.html');
  const assets = [...html.matchAll(/(?:src|href)="\/([^"/][^"]*\.(?:js|css|png|json|svg))"/g)].map(m => m[1]).filter(asset => asset !== 'config.js'); // gerado pelo server.mjs
  assert.ok(assets.length > 5, 'esperava encontrar os scripts e estilos do painel');
  const ignored = read('.dockerignore').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
  for (const asset of assets) {
    assert.ok(existsSync(root + asset), `${asset} citado no index.html não existe`);
    assert.ok(!ignored.includes(asset), `${asset} está no .dockerignore`);
  }
  assert.match(read('Dockerfile'), /^COPY \. \.$/m, 'o Dockerfile deve copiar a pasta inteira');
});

test('cada página do painel tem um item no menu e vice-versa', () => {
  const html = read('index.html');
  const pages = new Set([...html.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]));
  const navs = new Set([...html.matchAll(/data-nav="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual([...pages].sort(), [...navs].sort());
});
