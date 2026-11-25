// Indicações do cliente: somente /me/referrals, autenticado pela chave do cliente.
// Nunca lê chave administrativa, não chama endpoints administrativos e não grava a chave fora da aba.
import { redactKey, readClientSession, storeClientSession, revokeClientSession } from '/chat-sse.js';

const $ = id => document.getElementById(id);
const apiBase = (globalThis.ANUBIS_API_URL || '').replace(/\/+$/, '');
const apiPath = path => `${apiBase}${path}`;
const KEY_STORAGE = 'anubis-chat-key';
let apiKey = '';
let sessionToken = readClientSession();
let sessionLabel = '';
let report = null;

const storedKey = () => { try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
const currentKey = () => $('referral-access-key').value.trim() || apiKey || storedKey() || sessionToken;
function persistKey(key) {
  if (key === sessionToken) return; // sessão do admin já é persistida separadamente
  apiKey = key;
  try {
    if ($('referral-client-remember').checked) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch { /* sessão sem storage: a chave fica apenas em memória */ }
}
function clearKey() {
  const token = sessionToken;
  apiKey = ''; sessionToken = ''; sessionLabel = ''; report = null;
  $('referral-access-key').value = '';
  $('referral-client-remember').checked = false;
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignorar */ }
  storeClientSession('');
  void revokeClientSession(token);
  $('referral-client-content').hidden = true;
  $('referral-client-link').replaceChildren();
  $('referral-client-stats').replaceChildren();
  $('referral-client-ladder').textContent = '';
  $('referral-client-list').replaceChildren();
  setStatus('Chave removida desta aba.');
}
function setStatus(text, tone = '') {
  const node = $('referral-client-status');
  node.textContent = text;
  node.className = `form-message${tone ? ` ${tone}` : ''}`;
}
async function api(path) {
  const key = currentKey();
  if (!key) throw new Error('Informe a chave Anubis do cliente.');
  const response = await fetch(apiPath(path), { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok) throw new Error(redactKey(typeof payload?.error === 'string' ? payload.error : 'Não foi possível carregar as indicações.', key));
  return payload;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function money(value) { return value?.amount === undefined ? '—' : `${value.amount} ${value.currency}`; }
function statusText(value) {
  return { cadastro: 'Cadastro', em_analise: 'Em análise', qualificada: 'Qualificada', rejeitada: 'Rejeitada', creditado: 'Crédito simulado' }[value] || value || '—';
}
function facts(pairs) {
  const node = $('referral-client-stats'); node.replaceChildren();
  for (const [label, value] of pairs) {
    const wrap = el('div');
    wrap.append(el('dt', '', label), el('dd', '', value ?? '—'));
    node.append(wrap);
  }
}
function render(data) {
  report = data;
  const program = data.program || {};
  const stats = data.stats || {};
  $('referral-client-note').textContent = program.note || '';
  const link = $('referral-client-link'); link.replaceChildren(el('span', '', data.link || '—'));
  facts([
    ['Conta', data.account?.label], ['Cadastros', stats.signups ?? 0], ['Qualificadas', stats.qualified ?? 0],
    ['Em análise', stats.inAnalysis ?? 0], ['Rejeitadas', stats.rejected ?? 0], ['Em espera', money(stats.pending)],
    ['Bloqueado', money(stats.blocked)], ['Disponível', money(stats.available)], ['Ganho até agora', money(stats.earned)],
    ['Próxima indicação', stats.nextPosition ? `#${stats.nextPosition} · ${stats.nextReward} ${program.currency || ''}` : '—'],
    ['Faltam para a faixa', stats.tierFrom && stats.remainingForTier ? `${stats.remainingForTier} (faixa ${stats.tierFrom})` : '—'],
  ]);
  $('referral-client-ladder').textContent = (program.ladder || []).map(item => `${item.from}-${item.to ?? '+'}: ${item.amount} ${program.currency}`).join(' · ');
  const list = $('referral-client-list'); list.replaceChildren();
  if (!data.referrals.length) list.append(el('p', 'muted', 'Nenhuma indicação registrada para esta chave.'));
  for (const item of data.referrals) {
    const row = el('div', 'referral-row');
    const info = el('div');
    info.append(el('strong', '', `${item.contact || 'Contato'} · ${statusText(item.status)}`));
    info.append(el('small', '', `Entrada ${item.createdAt || '—'} · recompensa ${item.rewardAmount ? `${item.rewardAmount} ${item.rewardCurrency}` : '—'} · liberável ${item.holdUntil || '—'}`));
    row.append(info); list.append(row);
  }
  $('referral-client-content').hidden = false;
}
async function load() {
  setStatus('Carregando indicações...');
  try {
    const key = currentKey();
    if (!key) throw new Error('Informe a chave Anubis do cliente.');
    persistKey(key);
    render(await api('/me/referrals'));
    setStatus('Indicações carregadas. Valores são simulados; nenhum pagamento existe nesta área.', 'ok');
  } catch (error) {
    $('referral-client-content').hidden = true;
    setStatus(error.message, 'error');
  }
}
$('referral-client-access').addEventListener('submit', event => { event.preventDefault(); void load(); });
$('referral-client-enter').addEventListener('click', () => void load());
$('referral-client-clear').addEventListener('click', clearKey);
$('referral-client-copy').addEventListener('click', async () => {
  const link = report?.link || $('referral-client-link').textContent;
  if (!link || link === '—') { setStatus('Carregue o link antes de copiar.', 'error'); return; }
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
    else {
      const range = document.createRange(); range.selectNodeContents($('referral-client-link'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      throw new Error('Selecione o link e copie com o teclado.');
    }
    setStatus('Link copiado.', 'ok');
  } catch (error) { setStatus(error.message, 'error'); }
});
window.addEventListener('anubis-client-session', event => {
  const info = event.detail;
  sessionToken = info?.token || '';
  sessionLabel = info?.label || info?.prefix || '';
  apiKey = ''; report = null;
  $('referral-access-key').value = '';
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignorar */ }
  if (!sessionToken) { setStatus('Acesso temporário removido desta aba.'); return; }
  setStatus(`Chave ${sessionLabel} selecionada no painel. Carregando indicações...`);
  if (!document.querySelector('[data-page="referrals-client"]')?.hidden) void load();
});
const saved = storedKey();
if (saved && !sessionToken) { $('referral-access-key').value = saved; $('referral-client-remember').checked = true; }
if (sessionToken && !document.querySelector('[data-page="referrals-client"]')?.hidden) void load();
else setStatus('Informe a chave do cliente para ver suas indicações.');
