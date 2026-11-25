// Contrato compartilhado pelo chat web: parser SSE incremental e mensagens de erro do gateway.
// Esta funcao nao guarda chave, prompt nem resposta; apenas interpreta o que ja veio da rede.
const apiBase = (globalThis.ANUBIS_API_URL || '').replace(/\/+$/, '');
const apiPath = path => `${apiBase}${path}`;
function emitBlock(block) {
  const data = [];
  let event;
  for (const rawLine of block) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('event:')) event = line.slice(6).trim();
  }
  if (!data.length) return null;
  return event ? { data: data.join('\n'), event } : { data: data.join('\n') };
}

/** Parser incremental: aceita eventos divididos em qualquer posicao do chunk. */
export function createSseDecoder() {
  let pending = '';
  let block = [];
  const take = () => {
    const event = emitBlock(block);
    block = [];
    return event;
  };
  return {
    push(chunk) {
      pending += chunk;
      const events = [];
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line === '' || line === '\r') {
          const event = take();
          if (event) events.push(event);
        } else block.push(line);
      }
      return events;
    },
    flush() {
      if (pending) block.push(pending);
      pending = '';
      const event = take();
      return event ? [event] : [];
    },
  };
}

function textFrom(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseSseData(data, event) {
  const trimmed = String(data || '').trim();
  if (!trimmed) return { type: 'ignore' };
  if (trimmed === '[DONE]') return { type: 'done' };
  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return event === 'error' ? { type: 'error', message: trimmed } : { type: 'ignore' };
  }
  if (!payload || typeof payload !== 'object') return { type: 'ignore' };
  const errorMessage = typeof payload.error === 'string' ? payload.error : textFrom(payload.error?.message);
  if (errorMessage) return { type: 'error', message: errorMessage };
  if (event === 'error') return { type: 'error', message: textFrom(payload.message) || trimmed };
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  const delta = choice?.delta?.content;
  const message = choice?.message?.content;
  // Espacos fazem parte da resposta em streaming: nao aparar o conteudo.
  const content = typeof delta === 'string' && delta.length ? delta : typeof message === 'string' && message.length ? message : undefined;
  return content === undefined ? { type: 'ignore' } : { type: 'delta', text: content };
}

export function fallbackGatewayMessage(status) {
  if (status === 401 || status === 403) return 'Chave Anubis invalida ou sem acesso ao gateway.';
  if (status === 402) return 'Plano ou creditos insuficientes no gateway.';
  if (status === 404) return 'Modelo nao configurado ou desabilitado no gateway.';
  if (status === 429) return 'Limite de requisicoes atingido no gateway.';
  if (status >= 500) return 'Nenhum destino do fornecedor esta disponivel no momento.';
  return `Erro HTTP ${status} ao consultar o gateway.`;
}

function extractMessage(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  const nested = payload.error && typeof payload.error === 'object' ? textFrom(payload.error.message) : undefined;
  return textFrom(typeof payload.error === 'string' ? payload.error : nested) || textFrom(payload.message);
}

export function describeGatewayError(status, payload) {
  return extractMessage(payload) || fallbackGatewayMessage(status);
}

export function redactKey(message, apiKey) {
  const text = String(message || '');
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}

export function parseModels(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new Error('O gateway retornou um catalogo inesperado.');
  }
  return [...new Set(payload.data
    .filter(item => item && typeof item === 'object' && typeof item.id === 'string' && item.id.length)
    .map(item => item.id))];
}

// Sessão volátil emitida pelo administrador: guarda só o token da chave selecionada, nunca a chave em si.
export const CLIENT_SESSION_STORAGE = 'anubis-client-token';
export function readClientSession() {
  try { return sessionStorage.getItem(CLIENT_SESSION_STORAGE) || ''; } catch { return ''; }
}
export function storeClientSession(token) {
  try {
    if (token) sessionStorage.setItem(CLIENT_SESSION_STORAGE, token);
    else sessionStorage.removeItem(CLIENT_SESSION_STORAGE);
  } catch { /* sessão sem storage: o token fica apenas em memória */ }
}
export async function revokeClientSession(token) {
  if (!token) return;
  try { await fetch(apiPath('/client-session'), { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }); }
  catch { /* sem rede: o token expira no servidor */ }
}
