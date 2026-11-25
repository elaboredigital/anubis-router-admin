// Chat web local: usa somente a chave do cliente e os endpoints /v1 do proprio gateway.
// Nunca le a chave do painel, nunca chama endpoints de gerenciamento e nunca envia segredos para fora desta origem.
import { createSseDecoder, parseSseData, describeGatewayError, redactKey, parseModels, readClientSession, storeClientSession, revokeClientSession } from '/chat-sse.js';

const $ = id => document.getElementById(id);
const apiBase = (globalThis.ANUBIS_API_URL || '').replace(/\/+$/, '');
const apiPath = path => `${apiBase}${path}`;
const KEY_STORAGE = 'anubis-chat-key';
const STREAM_TIMEOUT_MS = 60000;
let apiKey = '';
let sessionToken = readClientSession();
let sessionLabel = '';
let models = [];
let history = [];
let busy = false;
let controller = null;
let timeoutId = null;
let stopReason = null;

function setMessage(text, tone = '') {
  const el = $('chat-status');
  el.textContent = text;
  el.className = `chat-status${tone ? ` ${tone}` : ''}`;
}
function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  $('chat-transcript').append(bubble);
  $('chat-transcript').scrollTop = $('chat-transcript').scrollHeight;
  return bubble;
}
function renderHistory() {
  const transcript = $('chat-transcript');
  transcript.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = 'Nenhuma mensagem nesta conversa. O histórico vive apenas nesta aba do navegador.';
    transcript.append(empty);
    return;
  }
  for (const item of history) addBubble(item.role, item.content);
}
function setBusy(value) {
  busy = value;
  $('chat-send').disabled = value;
  $('chat-input').disabled = value;
  $('chat-cancel').disabled = !value;
  $('chat-load-models').disabled = value;
}
function readStoredKey() {
  try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
function currentKey() {
  const typed = $('chat-key').value.trim();
  if (typed) return typed;
  if (apiKey) return apiKey;
  return readStoredKey() || sessionToken;
}
function persistKey(key) {
  if (key === sessionToken) return; // sessão do admin já é persistida separadamente
  apiKey = key;
  try {
    if ($('chat-remember').checked) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch { /* sessao sem storage: a chave fica apenas em memoria */ }
}
async function errorText(response, key) {
  let payload = null;
  try { payload = JSON.parse(await response.text()); } catch { /* corpo nao JSON */ }
  return redactKey(describeGatewayError(response.status, payload), key);
}
async function loadModels() {
  const key = currentKey();
  if (!key) { setMessage('Informe a chave Anubis do cliente antes de testar.', 'error'); return; }
  setMessage('Consultando modelos disponíveis...');
  try {
    const response = await fetch(apiPath('/v1/models'), { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
    if (!response.ok) { setMessage(await errorText(response, key), 'error'); return; }
    persistKey(key);
    models = parseModels(await response.json());
    const select = $('chat-model');
    const previous = select.value;
    select.replaceChildren();
    if (!models.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Nenhum modelo disponível'; select.append(option);
      setMessage('A chave foi aceita, mas nenhum modelo está habilitado para ela.', 'error');
      return;
    }
    for (const id of models) {
      const option = document.createElement('option'); option.value = id; option.textContent = id; select.append(option);
    }
    if (models.includes(previous)) select.value = previous;
    setMessage(`${models.length} modelo(s) disponível(is) para esta chave.`, 'ok');
  } catch (error) {
    setMessage(redactKey(error?.message || 'Falha de rede ao consultar o gateway.', key), 'error');
  }
}
function stop(reason) {
  stopReason = reason;
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = null;
  if (controller) { try { controller.abort(); } catch { /* ja abortado */ } }
}
function finishTurn() {
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = null;
  controller = null;
  stopReason = null;
  setBusy(false);
  $('chat-input').focus();
}
async function send() {
  if (busy) return;
  const key = currentKey();
  const model = $('chat-model').value;
  const text = $('chat-input').value.trim();
  if (!key) { setMessage('Informe a chave Anubis do cliente.', 'error'); return; }
  if (!model) { setMessage('Carregue e selecione um modelo antes de enviar.', 'error'); return; }
  if (!text) { setMessage('Escreva uma mensagem para enviar.', 'error'); return; }

  persistKey(key);
  history.push({ role: 'user', content: text });
  renderHistory();
  $('chat-input').value = '';
  const bubble = addBubble('assistant', '');
  const outbound = history.map(item => ({ role: item.role, content: item.content }));
  setBusy(true);
  stopReason = null;
  controller = new AbortController();
  timeoutId = setTimeout(() => stop('timeout'), STREAM_TIMEOUT_MS);
  setMessage('Aguardando resposta...');
  $('chat-model-effective').textContent = model;
  $('chat-request-id').textContent = '—';
  $('chat-fallback').textContent = '—';

  let answer = '';
  let completed = false;
  let failure = null;
  const handleEvent = event => {
    const parsed = parseSseData(event.data, event.event);
    if (parsed.type === 'delta') {
      answer += parsed.text;
      bubble.textContent = answer;
      $('chat-transcript').scrollTop = $('chat-transcript').scrollHeight;
    } else if (parsed.type === 'error') {
      failure = redactKey(parsed.message, key);
    } else if (parsed.type === 'done') {
      completed = true;
    }
  };

  try {
    const response = await fetch(apiPath('/v1/chat/completions'), {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ model, messages: outbound, stream: true }),
      signal: controller.signal,
    });
    $('chat-model-effective').textContent = response.headers.get('x-anubis-model') || model;
    $('chat-request-id').textContent = response.headers.get('x-request-id') || '—';
    const fallback = response.headers.get('x-anubis-fallback');
    $('chat-fallback').textContent = fallback ? `Fallback: ${fallback}` : 'Sem fallback';
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter && !response.ok) setMessage(`Tente novamente em ${retryAfter} segundo(s).`);

    if (!response.ok) {
      bubble.textContent = await errorText(response, key);
      bubble.classList.add('error');
      setMessage('O gateway recusou a requisição.', 'error');
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/event-stream/i.test(contentType)) {
      const payload = await response.json().catch(() => null);
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('O gateway não retornou um stream SSE válido.');
      answer = content;
      bubble.textContent = answer;
      completed = true;
      setMessage('Resposta recebida.', 'ok');
      return;
    }

    const decoder = new TextDecoder();
    const sse = createSseDecoder();
    const reader = response.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const event of sse.push(decoder.decode(value, { stream: true }))) handleEvent(event);
    }
    for (const event of [...sse.flush(), ...(decoder.decode() ? sse.push(decoder.decode()) : [])]) handleEvent(event);
    if (!completed && !failure) failure = 'A conexão terminou antes do marcador [DONE]. O texto parcial foi mantido.';
  } catch (error) {
    if (error?.name === 'AbortError') {
      failure = stopReason === 'user' ? 'Envio cancelado.' : 'Tempo limite atingido antes da conclusão da resposta.';
    } else {
      failure = redactKey(error?.message || 'Falha de rede ao consultar o gateway.', key);
    }
  } finally {
    if (failure) {
      bubble.classList.add('incomplete');
      const note = document.createElement('p');
      note.className = 'chat-note';
      note.textContent = failure;
      bubble.append(note);
      setMessage(failure, 'error');
    } else if (!completed) {
      setMessage('Resposta concluída sem marcação explícita de fim.', 'error');
    } else {
      setMessage('Resposta concluída.', 'ok');
    }
    if (answer) history.push({ role: 'assistant', content: answer });
    finishTurn();
  }
}

$('chat-load-models').addEventListener('click', loadModels);
$('chat-key').addEventListener('change', () => { if (!readStoredKey()) apiKey = ''; });
$('chat-clear-key').addEventListener('click', () => {
  const token = sessionToken;
  apiKey = ''; sessionToken = ''; sessionLabel = '';
  models = [];
  $('chat-key').value = '';
  $('chat-remember').checked = false;
  $('chat-model').replaceChildren();
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* sem storage */ }
  storeClientSession('');
  void revokeClientSession(token);
  setMessage('Chave removida desta aba.');
});
window.addEventListener('anubis-client-session', event => {
  const info = event.detail;
  sessionToken = info?.token || '';
  sessionLabel = info?.label || info?.prefix || '';
  apiKey = '';
  $('chat-key').value = '';
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* sem storage */ }
  if (!sessionToken) { setMessage('Acesso temporário removido desta aba.'); return; }
  setMessage(`Chave ${sessionLabel} selecionada no painel. A chave completa não foi exibida.`);
  if (!document.querySelector('[data-page="chat"]')?.hidden) void loadModels();
});
$('chat-send').addEventListener('click', send);
$('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
});
$('chat-cancel').addEventListener('click', () => { setMessage('Cancelando...'); stop('user'); });
$('chat-clear').addEventListener('click', () => { if (busy) return; history = []; renderHistory(); setMessage('Conversa limpa desta aba.'); });

const stored = readStoredKey();
if (stored && !sessionToken) { $('chat-key').value = stored; $('chat-remember').checked = true; apiKey = stored; }
renderHistory();
if (sessionToken && !document.querySelector('[data-page="chat"]')?.hidden) {
  setMessage('Chave selecionada no painel. Carregando modelos...');
  void loadModels();
} else setMessage('Informe a chave do cliente e carregue os modelos para começar.');
