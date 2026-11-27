// Admin: disponibilidade por modelo. Mesma lista, ordem e preços do /models público (model-format.js é cópia
// do site), mais o estado de cada fornecedor: conexão validada e tentativas das últimas 24 horas.
// Módulo carregado depois de app.js: usa api() e a sessão administrativa abertas por ele.
import { family, money, sortModels } from './model-format.js';

const section = document.querySelector('[data-page="availability"]');
const byId = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const VALID = new Set(['valid', 'endpoint_accepted']);
const CONNECTION = { valid: 'validada', endpoint_accepted: 'endpoint aceito', invalid: 'inválida', error: 'com erro', pending: 'pendente' };
const STATES = {
  ok: { label: 'Disponível', hint: 'Há fornecedor com conexão validada e sem falhas recorrentes nas últimas 24h.' },
  warn: { label: 'Instável', hint: 'Todos os fornecedores com tráfego falharam em 20% ou mais das tentativas.' },
  down: { label: 'Sem fornecedor válido', hint: 'Nenhuma conexão deste modelo está validada.' },
};
let data = null; let loading = false; let updatedAt = null;

/** Estado do modelo a partir dos fornecedores: a conexão precisa estar validada; o tráfego real decide se está instável. */
export function modelState(model) {
  const usable = (model.suppliers || []).filter(s => VALID.has(s.connectionStatus));
  if (!usable.length) return 'down';
  if (usable.some(s => s.successRate === null || s.successRate >= 80)) return 'ok';
  return 'warn';
}

function priceText(model) {
  const p = model.price;
  if (!p) return ['—', '—'];
  if (p.billingType === 'request') return [`${money(p.request) ?? '—'} /req`, '—'];
  return [money(p.input) ?? '—', money(p.output) ?? '—'];
}

function bars(model) {
  const box = make('div', 'av-bars');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', model.uptime === null ? 'Sem tráfego nas últimas 24 horas' : `Disponibilidade de ${model.uptime}% nas últimas 24 horas`);
  (model.timeline || []).forEach((value, index) => {
    const hoursAgo = model.timeline.length - 1 - index;
    const bar = make('span', value === null ? 'av-bar' : value === 100 ? 'av-bar ok' : value >= 80 ? 'av-bar warn' : 'av-bar fail');
    bar.title = value === null ? `${hoursAgo}h atrás: sem tráfego` : `${hoursAgo}h atrás: ${value}% de sucesso`;
    box.append(bar);
  });
  return box;
}

const when = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
function suppliers(model) {
  const list = make('ul', 'av-suppliers');
  for (const s of model.suppliers || []) {
    const li = make('li');
    const ok = VALID.has(s.connectionStatus);
    const head = make('div', 'av-supplier-head');
    head.append(make('span', `av-dot ${ok ? 'ok' : 'down'}`), make('strong', '', s.connectionName || s.provider), make('small', '', `${CONNECTION[s.connectionStatus] || s.connectionStatus || 'sem validação'} · prioridade ${s.priority}`));
    const traffic = s.attempts
      ? `${s.successRate}% de ${s.attempts.toLocaleString('pt-BR')} tentativa${s.attempts === 1 ? '' : 's'}`
      : 'sem tentativas em 24h';
    const detail = [traffic, s.lastOkAt ? `último sucesso ${when(s.lastOkAt)}` : null,
      s.lastFailure ? `última falha ${when(s.lastFailure.at)} (${s.lastFailure.httpStatus ? `HTTP ${s.lastFailure.httpStatus}` : s.lastFailure.reason || s.lastFailure.status})` : null].filter(Boolean).join(' · ');
    li.append(head, make('p', 'av-supplier-detail', detail), make('code', 'av-upstream', s.upstreamModel));
    list.append(li);
  }
  return list;
}

function row(model) {
  const tr = make('tr');
  const info = family(model.family);
  const name = make('td');
  const wrap = make('div', 'av-model');
  const mark = make('span', 'av-mark', info.mark); mark.style.background = info.color; mark.setAttribute('aria-hidden', 'true');
  const text = make('div');
  text.append(make('strong', '', model.name), make('code', 'av-id', model.id));
  wrap.append(mark, text); name.append(wrap);
  const [input, output] = priceText(model);
  const state = modelState(model);
  const badge = make('span', `av-state ${state}`, STATES[state].label); badge.title = STATES[state].hint;
  const uptime = make('td');
  uptime.append(make('span', 'av-uptime', model.uptime === null ? 'Sem tráfego' : `${model.uptime}%`), bars(model));
  if (model.requests) uptime.append(make('small', 'av-muted', `${model.requests.toLocaleString('pt-BR')} requisições`));
  const supplierCell = make('td'); supplierCell.append(suppliers(model));
  tr.append(name, make('td', 'av-num', input), make('td', 'av-num', output), uptime, supplierCell);
  const stateCell = make('td'); stateCell.append(badge); tr.append(stateCell);
  return tr;
}

const extraSorts = {
  uptime: (a, b) => (a.uptime ?? 101) - (b.uptime ?? 101) || b.requests - a.requests,
  state: (a, b) => ['down', 'warn', 'ok'].indexOf(modelState(a)) - ['down', 'warn', 'ok'].indexOf(modelState(b)),
};

function render() {
  if (!data) return;
  const query = byId('av-search').value.trim().toLowerCase();
  const familyFilter = byId('av-family').value;
  const stateFilter = byId('av-state').value;
  const visible = data.filter(m => (!query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query) || (m.suppliers || []).some(s => (s.connectionName || '').toLowerCase().includes(query)))
    && (familyFilter === 'all' || m.family === familyFilter) && (stateFilter === 'all' || modelState(m) === stateFilter));
  const sorted = sortModels(visible, byId('av-sort').value, extraSorts);
  const body = byId('av-rows');
  body.replaceChildren(...sorted.map(row));
  if (!sorted.length) { const tr = make('tr'); const td = make('td', 'av-empty', 'Nenhum modelo com esses filtros.'); td.colSpan = 6; tr.append(td); body.append(tr); }
  const counts = { ok: 0, warn: 0, down: 0 };
  for (const m of data) counts[modelState(m)]++;
  byId('av-total').textContent = data.length.toLocaleString('pt-BR');
  byId('av-ok').textContent = counts.ok.toLocaleString('pt-BR');
  byId('av-warn').textContent = counts.warn.toLocaleString('pt-BR');
  byId('av-down').textContent = counts.down.toLocaleString('pt-BR');
  byId('av-traffic').textContent = data.reduce((sum, m) => sum + (m.requests || 0), 0).toLocaleString('pt-BR');
  byId('av-showing').textContent = `Mostrando ${sorted.length.toLocaleString('pt-BR')} de ${data.length.toLocaleString('pt-BR')} modelos${updatedAt ? ` · atualizado ${when(updatedAt)}` : ''}`;
}

function fillFamilies() {
  const select = byId('av-family');
  const current = select.value;
  const ids = [...new Set(data.map(m => m.family))];
  select.replaceChildren(new Option('Todos os fabricantes', 'all'), ...sortModels(ids.map(id => ({ family: id, name: family(id).label })), 'family').map(m => new Option(family(m.family).label, m.family)));
  select.value = ids.includes(current) ? current : 'all';
}

async function load(force = false) {
  if (loading || (data && !force)) return;
  loading = true;
  byId('av-message').textContent = data ? 'Atualizando.' : 'Carregando disponibilidade.';
  try {
    // eslint-disable-next-line no-undef -- api() vem de app.js (script clássico)
    const result = await api('/admin/model-availability');
    data = Array.isArray(result.data) ? result.data : []; updatedAt = result.updatedAt || null;
    byId('av-message').textContent = '';
    fillFamilies(); render();
  } catch (error) { byId('av-message').textContent = `Não foi possível carregar: ${error.message}`; }
  finally { loading = false; }
}

if (section) {
  for (const id of ['av-search']) byId(id).addEventListener('input', render);
  for (const id of ['av-family', 'av-state', 'av-sort']) byId(id).addEventListener('change', render);
  byId('av-refresh').addEventListener('click', () => load(true));
  // Carrega quando a página fica visível (showPage alterna o atributo hidden), ou seja, depois de entrar no admin.
  new MutationObserver(() => { if (!section.hidden) load(); }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  if (!section.hidden) load();
}
