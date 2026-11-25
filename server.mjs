// Servidor estático do painel administrativo. Sem dependências: a API é um domínio separado.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(baseDir, process.env.ANUBIS_STATIC_DIR || '.');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const apiUrl = (process.env.ANUBIS_API_URL || '').replace(/\/+$/, '');
const apiOrigin = apiUrl ? new URL(apiUrl).origin : '';
const csp = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}; base-uri 'none'; frame-ancestors 'none'`;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const denied = new Set(['package.json', 'package-lock.json', 'server.mjs', 'Dockerfile', 'README.md', '.env', '.env.example']);

function send(res, status, body, type, head = false) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end(head ? undefined : body);
}

http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Método não permitido', 'text/plain; charset=utf-8');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch { return send(res, 400, 'URL inválida', 'text/plain; charset=utf-8'); }

  // O painel administrativo não deve ser indexado por buscadores.
  if (pathname === '/robots.txt') {
    return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8', req.method === 'HEAD');
  }

  if (pathname === '/config.js') {
    return send(res, 200, `window.ANUBIS_API_URL = ${JSON.stringify(apiUrl)};\n`, mime['.js'], req.method === 'HEAD');
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part.startsWith('.') || part.includes('\\')) || parts.some(part => denied.has(part))) {
    return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
  }

  const ext = path.extname(pathname).toLowerCase();
  if (ext && !mime[ext]) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
  const candidate = path.resolve(staticDir, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (candidate !== staticDir && !candidate.startsWith(staticDir + path.sep)) {
    return send(res, 403, 'Acesso negado', 'text/plain; charset=utf-8');
  }

  try {
    const body = await readFile(candidate);
    return send(res, 200, body, mime[ext || '.html'], req.method === 'HEAD');
  } catch (error) {
    if (error.code !== 'ENOENT' || ext) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
    // Rotas de página do painel (/users, /models, ...) são o mesmo SPA.
    try {
      const body = await readFile(path.join(staticDir, 'index.html'));
      return send(res, 200, body, mime['.html'], req.method === 'HEAD');
    } catch {
      return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
    }
  }
}).listen(port, host, () => {
  console.log(`Admin do Anubis Router: http://${host}:${port} (API: ${apiUrl || 'mesma origem'})`);
});
