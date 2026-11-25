# Anubis Router — Admin

Painel administrativo do Anubis Router. Destino: **admin.anubisrouter.com**.
Este diretório tem seu próprio repositório Git; o repositório da raiz o ignora.

## O que vive aqui

- `index.html`, `app.js`, `style.css`, `panel-extras.css`, `brand.png`, `connect-tools.json`: SPA administrativa.
- `chat-web.js`, `chat-sse.js`, `account.js`, `referrals-client.js`: visões de cliente usadas pelo administrador na transição.
- `server.mjs`: servidor estático sem dependências. Serve o SPA em qualquer rota de página e injeta `/config.js` com a URL da API.
- `Dockerfile`: imagem isolada do painel.

O painel não contém segredos de fornecedores nem chaves administrativas. A chave fica no `sessionStorage` do navegador e é enviada somente à API configurada em `ANUBIS_API_URL`, nos endpoints `/admin/*`.

## Executar

```bash
cp .env.example .env       # apontar para a API (local ou api.anubisrouter.com)
npm run dev
```

Sem `.env`, o painel usa `ANUBIS_API_URL=http://127.0.0.1:3210` e escuta na porta `3000`. Em produção:

```bash
ANUBIS_API_URL=https://api.anubisrouter.com npm start
```

O CORS da API precisa aceitar a origem `https://admin.anubisrouter.com` em `ANUBIS_PUBLIC_URL`.

## Contrato consumido

`/admin/status`, `/admin/routes`, `/admin/connections`, `/admin/plans`, `/admin/keys`, `/admin/users`, `/admin/ledger`, `/admin/topup`, `/admin/referrals`, `/admin/system`, `/admin/global-stats`, `/admin/model-analytics`, `/admin/dashboard`, `/admin/extension` e as demais rotas documentadas em [`api/README.md`](../api/README.md).

O Chat, a área do cliente e as indicações do cliente ainda aparecem aqui durante a transição; o destino final dessas telas é `anubisrouter.com`.
