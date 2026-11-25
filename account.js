// Área do cliente: somente endpoints /me, autenticados pela chave do cliente.
// Nunca lê chave administrativa, não chama endpoints administrativos e não grava a chave fora da aba.
import { redactKey, readClientSession, storeClientSession, revokeClientSession } from '/chat-sse.js';

const $ = id => document.getElementById(id);
const apiBase = (globalThis.ANUBIS_API_URL || '').replace(/\/+$/, '');
const apiPath = path => `${apiBase}${path}`;
const KEY_STORAGE = 'anubis-chat-key';
let apiKey = '';
let sessionToken = readClientSession();
let sessionLabel = '';
let period = { from: '', to: '' };

const number = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
const limitText = value => value === null || value === undefined ? 'sem limite' : number(value);
const spendText = list => list?.length ? list.map(item => `${item.amount} ${item.currency}`).join(' · ') : '—';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function setStatus(id, text, tone = '') {
  const node = $(id);
  node.textContent = text;
  node.className = `client-area-status${tone ? ` ${tone}` : ''}`;
}
function storedKey() {
  try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
function currentKey() {
  return $('client-area-key').value.trim() || apiKey || storedKey() || sessionToken;
}
function persistKey(key) {
  if (key === sessionToken) return; // sessão do admin já é persistida separadamente
  apiKey = key;
  try {
    if ($('client-area-remember').checked) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch { /* sessão sem storage: a chave fica apenas em memória */ }
}
function clearKey() {
  const token = sessionToken;
  apiKey = ''; sessionToken = ''; sessionLabel = '';
  $('client-area-key').value = '';
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignorar */ }
  storeClientSession('');
  void revokeClientSession(token);
  $('client-area-content').hidden = true;
  $('client-area-key-created').hidden = true;
  setStatus('client-area-status', 'Chave removida desta aba.');
}
async function api(path, options = {}) {
  const key = currentKey();
  if (!key) throw new Error('Informe a chave Anubis do cliente.');
  const response = await fetch(apiPath(path), {
    ...options,
    headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* corpo não JSON */ }
  if (!response.ok) {
    const message = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : null) || `Falha na solicitação (HTTP ${response.status}).`;
    throw new Error(redactKey(message, key));
  }
  return payload;
}
function table(headers, rows) {
  const wrap = el('div', 'table-scroll');
  const node = el('table', 'data-table');
  const head = el('thead'); const headRow = el('tr');
  for (const label of headers) headRow.append(el('th', '', label));
  head.append(headRow); node.append(head);
  const body = el('tbody');
  for (const values of rows) {
    const row = el('tr');
    for (const value of values) row.append(el('td', '', value ?? '—'));
    body.append(row);
  }
  node.append(body); wrap.append(node);
  return wrap;
}
function planOptions(plans, selectedId) {
  const fragment = document.createDocumentFragment();
  for (const plan of plans) {
    const option = el('option', '', plan.name);
    option.value = plan.id;
    if (plan.id === selectedId) option.selected = true;
    fragment.append(option);
  }
  return fragment;
}
function renderPlans(report) {
  const list = $('client-area-plans'); list.replaceChildren();
  if (!report.availablePlans.length) {
    list.append(el('p', 'muted', 'Nenhum plano foi liberado pelo administrador para troca nesta área. A chave permanece no plano atual.'));
    return;
  }
  for (const plan of report.availablePlans) {
    const row = el('div', 'plan-option');
    const info = el('div');
    info.append(el('strong', '', plan.name));
    const detail = `${limitText(plan.monthlyRequests)} requisições/mês · ${limitText(plan.monthlyTokens)} tokens/mês · ${limitText(plan.dailyTokens)} tokens/dia · ${plan.models.length ? `${plan.models.length} modelo(s)` : 'nenhum modelo'}`;
    info.append(el('small', '', detail));
    const button = el('button', 'secondary', plan.id === report.account.planId ? 'Plano atual' : 'Selecionar');
    button.disabled = plan.id === report.account.planId;
    button.addEventListener('click', () => changePlan(report.account.id, plan.id));
    row.append(info, button); list.append(row);
  }
}
function renderKeys(report) {
  const list = $('client-area-key-list'); list.replaceChildren();
  if (!report.keys.length) { list.append(el('p', 'muted', 'Nenhuma chave no seu grupo.')); return; }
  for (const key of report.keys) {
    const row = el('div', 'account-row');
    const info = el('div');
    info.append(el('strong', '', `${key.name} · ${key.role}`));
    info.append(el('small', '', `${key.label} · ${key.planName}${key.active ? '' : ' · revogada'}`));
    const actions = el('div', 'row-actions');
    if (key.active && report.availablePlans.length) {
      const select = el('select');
      select.append(planOptions(report.availablePlans, key.planId));
      select.setAttribute('aria-label', `Plano de ${key.name}`);
      select.addEventListener('change', () => changePlan(key.id, select.value));
      actions.append(select);
    }
    if (key.role === 'derivada' && key.active) {
      const revoke = el('button', 'secondary', 'Revogar');
      revoke.addEventListener('click', () => revokeKey(key.id));
      actions.append(revoke);
    }
    row.append(info, actions); list.append(row);
  }
}
function renderSummary(report) {
  $('client-area-name').textContent = report.account.name || 'Chave Anubis';
  $('client-area-label').textContent = report.account.label || '—';
  $('client-area-plan').textContent = report.plan?.name ? `${report.plan.name}${report.plan.active ? '' : ' (inativo)'}` : 'Sem plano';
  const plan = report.plan;
  const dailyLimited = !!plan && (plan.dailyTokensLimit != null || plan.dailyRequestsLimit != null);
  $('client-area-quota').textContent = plan
    ? dailyLimited
      ? `${number(plan.dailyTokensUsed)} / ${limitText(plan.dailyTokensLimit)} tokens hoje · ${number(plan.dailyRequestsUsed)} / ${limitText(plan.dailyRequestsLimit)} requisições hoje`
      : `${number(plan.requestsUsed)} / ${limitText(plan.requestsLimit)} requisições · ${number(plan.tokensUsed)} / ${limitText(plan.tokensLimit)} tokens`
    : 'Sem limite local (chave sem plano)';
  $('client-area-reset').textContent = plan?.resetAt
    ? `${plan.resetAt} (${dailyLimited ? `${number(plan.hoursToReset)} h` : `${number(plan.daysToReset)} dia(s)`})`
    : '—';
  $('client-area-wallet').textContent = report.wallet ? `${report.wallet.currency}: saldo ${report.wallet.balance}, consumo ${report.wallet.consumed}` : 'Não se aplica';
  $('client-area-key-plan').replaceChildren(planOptions(report.availablePlans, report.account.planId));
  renderPlans(report);
  renderKeys(report);
}
function renderStats(report) {
  $('client-area-stats-completed').textContent = number(report.totals?.completed);
  $('client-area-stats-failed').textContent = number(report.totals?.failed);
  $('client-area-stats-cancelled').textContent = number(report.totals?.cancelled);
  $('client-area-stats-tokens').textContent = number(report.totals?.tokens);
  $('client-area-stats-spend').textContent = spendText(report.totals?.spend);
  $('client-area-stats-period').textContent = `${report.period?.from} → ${report.period?.to}${report.period?.clamped ? ' (ajustado)' : ''}`;
  const series = [...(report.series || [])].reverse().slice(0, 30).map(day => [day.date, number(day.requests), number(day.tokens), number(day.completed), spendText(day.spend)]);
  $('client-area-stats-series').replaceChildren(table(['Data', 'Concluídas', 'Tokens', 'Sucesso', 'Gasto'], series));
  const models = (report.byModel || []).slice(0, 10).map(item => [item.model, number(item.requests), number(item.tokens), spendText(item.spend)]);
  $('client-area-stats-models').replaceChildren(models.length ? table(['Modelo', 'Requisições', 'Tokens', 'Gasto'], models) : el('p', 'muted', 'Nenhuma requisição concluída no período.'));
  $('client-area-stats-status').textContent = `${number(report.totals?.requests)} requisição(ões) concluída(s) deduplicada(s).`;
  $('client-area-stats-status').className = 'client-area-status';
}
async function loadSummary() {
  const report = await api('/me/summary');
  renderSummary(report);
  return report;
}
async function loadStats() {
  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);
  const suffix = query.toString() ? `?${query}` : '';
  try { renderStats(await api(`/me/stats${suffix}`)); }
  catch (error) { setStatus('client-area-stats-status', error.message, 'error'); }
}
async function enter() {
  const key = currentKey();
  if (!key) { setStatus('client-area-status', 'Informe a chave Anubis do cliente.', 'error'); return; }
  setStatus('client-area-status', 'Validando chave...');
  try {
    await api('/me/summary');
    persistKey(key);
    $('client-area-content').hidden = false;
    setStatus('client-area-status', 'Chave aceita. Você está vendo apenas os dados do seu grupo de chaves.', 'ok');
    await loadSummary();
    await loadStats();
  } catch (error) {
    $('client-area-content').hidden = true;
    setStatus('client-area-status', error.message, 'error');
  }
}
async function changePlan(id, planId) {
  if (!planId) return;
  setStatus('client-area-key-message', 'Alterando plano...');
  try {
    await api('/me/keys/plan', { method: 'POST', body: JSON.stringify({ id, planId }) });
    await loadSummary();
    setStatus('client-area-key-message', 'Plano alterado para as próximas chamadas.', 'ok');
  } catch (error) { setStatus('client-area-key-message', error.message, 'error'); }
}
async function revokeKey(id) {
  if (!window.confirm('Revogar esta chave derivada? Ela deixará de autenticar chamadas imediatamente.')) return;
  setStatus('client-area-key-message', 'Revogando chave...');
  try {
    await api('/me/keys/revoke', { method: 'POST', body: JSON.stringify({ id }) });
    await loadSummary();
    setStatus('client-area-key-message', 'Chave derivada revogada.', 'ok');
  } catch (error) { setStatus('client-area-key-message', error.message, 'error'); }
}
async function createKey() {
  setStatus('client-area-key-message', 'Criando chave...');
  try {
    const result = await api('/me/keys', { method: 'POST', body: JSON.stringify({ name: $('client-area-key-name').value, planId: $('client-area-key-plan').value || null }) });
    $('client-area-key-name').value = '';
    $('client-area-key-created').hidden = false;
    $('client-area-key-created').textContent = `Copie agora; a chave não será exibida novamente:\n${result.key}`;
    await loadSummary();
    setStatus('client-area-key-message', 'Chave derivada criada.', 'ok');
  } catch (error) { setStatus('client-area-key-message', error.message, 'error'); }
}

$('client-area-enter').addEventListener('click', enter);
$('client-area-access').addEventListener('submit', event => { event.preventDefault(); void enter(); });
$('client-area-clear').addEventListener('click', clearKey);
$('client-area-key-create').addEventListener('click', createKey);
$('client-area-stats-apply').addEventListener('click', async () => {
  period = { from: $('client-area-stats-from').value.trim(), to: $('client-area-stats-to').value.trim() };
  await loadStats();
});
$('client-area-stats-clear').addEventListener('click', async () => {
  $('client-area-stats-from').value = ''; $('client-area-stats-to').value = ''; period = { from: '', to: '' };
  await loadStats();
});
window.addEventListener('anubis-client-session', event => {
  const info = event.detail;
  sessionToken = info?.token || '';
  sessionLabel = info?.label || info?.prefix || '';
  apiKey = '';
  $('client-area-key').value = '';
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignorar */ }
  if (!sessionToken) { setStatus('client-area-status', 'Acesso temporário removido desta aba.'); return; }
  setStatus('client-area-status', `Chave ${sessionLabel} selecionada no painel. Carregando dados...`);
  if (!document.querySelector('[data-page="client-area"]')?.hidden) void enter();
});
const saved = storedKey();
if (saved && !sessionToken) { $('client-area-key').value = saved; $('client-area-remember').checked = true; }
if (sessionToken && !document.querySelector('[data-page="client-area"]')?.hidden) void enter();
