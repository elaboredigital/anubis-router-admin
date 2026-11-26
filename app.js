const $ = id => document.getElementById(id);
let adminKey = sessionStorage.getItem('anubis-admin') || '';
let providers = [], connections = [], currentConnection = null, currentProvider = null, catalog = [], catalogSource = '';
let pricingConfig = { defaultMultiplier: '5', rules: [], manualPrices: [] };
let usageStats = { groups: [], recordCount: 0 };
let dashboardData = { accounts: [] };
let plansData = { plans: [], defaultMultiplier: '5', providerUsage: [] };
let ledgerData = { history: [], entries: [], summary: { totals: [], counts: {} } };
let topupData = { wallets: [], topups: [], scope: 'manual_topups' };
let clientKeysData = [];
let usagePeriod = { from: '', to: '' };
let statsPeriod = { from: '', to: '' };
let globalPeriod = { from: '', to: '' };
let statsKeyId = '';
let clientHomeData = null;
let globalStatsData = null;
let modelAnalyticsData = null;
let selectedAnalyticsModel = '';
let modelDetailRequest = 0;
let readinessData = { providers: [], policy: { enforceResale: false }, audit: [] };
let editingConnectionId = '';
let referralsData = { program: null, totals: null, owners: [], records: [], audit: [] };
let usersData = null;
let selectedUserId = '';
let systemData = null;
let modelOptions = [];
let catalogView = 'cards';
try { if (localStorage.getItem('anubis-catalog-view') === 'list') catalogView = 'list'; } catch { /* armazenamento indisponível */ }
let extensionFile = 'anubis-router-vscode-2.0.0.vsix';
let extensionAvailable = false;
const syncedProviderUsage = new Map();
const apiBase = (window.ANUBIS_API_URL || '').replace(/\/+$/, '');
const apiUrl = url => `${apiBase}${url}`;
$('base-url').textContent = `${apiBase || location.origin}/v1`;
document.querySelector('.url').textContent = `${apiBase || location.origin}/v1`;
async function api(url, options = {}) {
  const response = await fetch(apiUrl(url), { ...options, headers: { authorization: `Bearer ${adminKey}`, ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Não foi possível concluir a operação.');
  return result;
}
const post = (url, data = {}) => api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
// O admin escolhe uma chave cadastrada; o servidor devolve só um token volátil, nunca a chave original.
const clientSessionPickers = [
  { picker: 'chat-key-picker', status: 'chat-key-picker-status' },
  { picker: 'client-area-key-picker', status: 'client-area-key-picker-status' },
  { picker: 'referral-key-picker', status: 'referral-key-picker-status' },
];
function announceClientSession(info) {
  try { if (info?.token) sessionStorage.setItem('anubis-client-token', info.token); else sessionStorage.removeItem('anubis-client-token'); } catch { /* aba sem storage */ }
  window.dispatchEvent(new CustomEvent('anubis-client-session', { detail: info || null }));
}
function clearClientSession(revoke = false) {
  if (revoke) void api('/admin/keys/session', { method: 'DELETE' }).catch(() => {});
  announceClientSession(null);
}
function renderClientKeyPickers() {
  for (const { picker } of clientSessionPickers) {
    const select = $(picker);
    if (!select) continue;
    const selected = select.value;
    select.replaceChildren(new Option('Selecione uma chave ativa...', ''));
    for (const key of clientKeysData.filter(item => item.active !== false)) select.append(new Option(`${key.name} · ${key.prefix}`, key.id));
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }
}
function dateToIso(value, endOfDay = false) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
function usageQuery() {
  const params = new URLSearchParams();
  if (usagePeriod.from) params.set('from', usagePeriod.from);
  if (usagePeriod.to) params.set('to', usagePeriod.to);
  const text = params.toString();
  return text ? `?${text}` : '';
}
function pendingQuery() {
  const params = new URLSearchParams();
  if (usagePeriod.from) params.set('from', usagePeriod.from);
  if (usagePeriod.to) params.set('to', usagePeriod.to);
  if ($('usage-show-resolved')?.checked) params.set('includeResolved', 'true');
  const text = params.toString();
  return text ? `?${text}` : '';
}
function statsQuery() {
  const params = new URLSearchParams();
  if (statsKeyId) params.set('keyId', statsKeyId);
  if (statsPeriod.from) params.set('from', statsPeriod.from);
  if (statsPeriod.to) params.set('to', statsPeriod.to);
  const text = params.toString();
  return text ? `?${text}` : '';
}
function globalQuery() {
  const params = new URLSearchParams();
  if (globalPeriod.from) params.set('from', globalPeriod.from);
  if (globalPeriod.to) params.set('to', globalPeriod.to);
  const text = params.toString();
  return text ? `?${text}` : '';
}
function modelAnalyticsQuery(model) {
  const params = new URLSearchParams();
  if (globalPeriod.from) params.set('from', globalPeriod.from);
  if (globalPeriod.to) params.set('to', globalPeriod.to);
  if (model) params.set('model', model);
  return `?${params.toString()}`;
}
const statusText = status => ({ valid: 'chave validada', unverified: 'chave não comprovada', endpoint_accepted: 'endpoint respondeu; autenticação não comprovada' })[status] || status;
function formatSpend(usage) {
  if (!usage) return '—';
  const parts = (usage.spend || []).map(item => {
    const amount = Number(item.amount);
    const value = !Number.isFinite(amount) ? '—'
      : amount > 0 && amount < 0.000001 ? '< 0,000001'
        : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(amount);
    return `${item.currency} ${value}`;
  });
  if (usage.unpricedRequests) parts.push(`${usage.unpricedRequests} sem preço`);
  return parts.length ? parts.join(' · ') : '—';
}
function formatSale(billing) {
  if (!billing || !Array.isArray(billing.sales) || !billing.sales.length) return 'Venda sugerida: sem custo apurado neste mês';
  return billing.sales.map(item => `Venda sugerida (${item.multiplier}× · ${item.marginPercent}% margem): ${item.currency} ${item.sale}`).join(' · ');
}
const moneyText = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(Number(value) || 0);
function selectOption(value, label) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
}
function fillPlanSelect(select) {
  const selected = select.value; select.replaceChildren();
  select.append(selectOption('', 'Sem plano (sem limite)'));
  for (const plan of plansData.plans) select.append(selectOption(plan.id, `${plan.name}${plan.active ? '' : ' (inativo)'}`));
  if ([...select.options].some(item => item.value === selected)) select.value = selected;
}
function resetPlanForm() {
  $('plan-id').value = ''; $('plan-name').value = ''; $('plan-kind').value = 'free';
  $('plan-requests').value = ''; $('plan-tokens').value = ''; $('plan-daily-requests').value = ''; $('plan-daily-tokens').value = ''; $('plan-multiplier').value = ''; $('plan-currency').value = '';
  $('plan-active').checked = true; $('plan-self-service').checked = false; $('plan-form-title').textContent = 'Novo plano'; $('plan-message').textContent = '';
  for (const item of $('plan-models').options) item.selected = false;
}
function renderPlans() {
  const multiplier = Number(plansData.defaultMultiplier) || 5;
  $('plans-multiplier').textContent = `${plansData.defaultMultiplier}×`;
  $('plans-count').textContent = new Intl.NumberFormat('pt-BR').format(plansData.plans.length);
  $('plans-margin').textContent = `${Math.round((1 - 1 / multiplier) * 100)}%`;
  const models = $('plan-models'); const selected = [...models.selectedOptions].map(item => item.value);
  models.replaceChildren();
  for (const id of modelOptions) models.append(selectOption(id, id));
  for (const item of models.options) item.selected = selected.includes(item.value);
  fillPlanSelect($('key-plan'));
  const list = $('plan-list'); list.replaceChildren();
  if (!plansData.plans.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhum plano cadastrado.'; list.append(empty); }
  const count = value => new Intl.NumberFormat('pt-BR').format(value);
  for (const plan of plansData.plans) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const kindLabel = { free: 'Gratuito', paid: 'Pago', payg: 'PAYG / top up' }[plan.kind] || plan.kind;
    const title = document.createElement('strong'); title.textContent = `${plan.name} · ${kindLabel}${plan.active ? '' : ' · inativo'}`;
    const detail = document.createElement('small');
    const limit = (value, label) => value === null || value === undefined ? `${label}: sem limite` : `${label}: ${count(value)}`;
    detail.textContent = `${limit(plan.monthlyRequests, 'Requisições/mês')} · ${limit(plan.monthlyTokens, 'Tokens/mês')} · ${limit(plan.dailyRequests, 'Requisições/dia')} · ${limit(plan.dailyTokens, 'Tokens/dia')} · ${plan.multiplier ? `Multiplicador ${plan.multiplier}×` : `Multiplicador padrão (${plansData.defaultMultiplier}×)`}${plan.kind === 'payg' ? ` · Carteira ${plan.currency}` : ''} · ${plan.selfService ? 'Disponível ao cliente' : 'Somente admin'} · ${plan.models.length ? `Modelos: ${plan.models.join(', ')}` : 'Nenhum modelo permitido'}`;
    info.append(title, detail);
    const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Editar';
    edit.addEventListener('click', () => {
      $('plan-id').value = plan.id; $('plan-name').value = plan.name; $('plan-kind').value = plan.kind;
      $('plan-requests').value = plan.monthlyRequests ?? ''; $('plan-tokens').value = plan.monthlyTokens ?? '';
      $('plan-daily-requests').value = plan.dailyRequests ?? ''; $('plan-daily-tokens').value = plan.dailyTokens ?? '';
      $('plan-multiplier').value = plan.multiplier ?? ''; $('plan-currency').value = plan.currency ?? ''; $('plan-active').checked = plan.active !== false; $('plan-self-service').checked = plan.selfService === true;
      for (const item of $('plan-models').options) item.selected = plan.models.includes(item.value);
      $('plan-form-title').textContent = `Editar ${plan.name}`; $('plan-message').textContent = '';
      $('plan-name').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('plan-name').focus({ preventScroll: true });
    });
    const toggle = document.createElement('button'); toggle.className = 'secondary'; toggle.textContent = plan.active ? 'Desativar' : 'Ativar';
    toggle.addEventListener('click', async () => { toggle.disabled = true; try { await post('/admin/plans', { ...plan, active: !plan.active }); await show(); } catch (error) { $('plan-message').textContent = error.message; toggle.disabled = false; } });
    row.append(info, edit, toggle); list.append(row);
  }
  const usageList = $('provider-usage'); usageList.replaceChildren();
  if (!plansData.providerUsage.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma conexão ativa para apurar uso compartilhado.'; usageList.append(empty); }
  for (const item of plansData.providerUsage) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${item.name} · ${item.provider}`;
    const detail = document.createElement('small');
    detail.textContent = `${count(item.requests)} requisições · ${count(item.tokens)} tokens no mês · franquia compartilhada entre chaves${item.dailyLimit ? ` · hoje: ${count(item.dayTokens)} / ${count(item.dailyLimit)} tokens${item.backup ? ' (saldo é backup)' : ''}` : ''}`;
    info.append(title, detail); row.append(info); usageList.append(row);
  }
}
function renderLedger() {
  const counts = ledgerData.summary?.counts || {};
  const money = (currency, value) => value === null || value === undefined ? '—' : `${currency} ${value}`;
  $('ledger-counts').textContent = new Intl.NumberFormat('pt-BR').format(counts.entries || 0);
  $('ledger-pending').textContent = new Intl.NumberFormat('pt-BR').format((counts.pendingConversion || 0) + (counts.unpriced || 0));

  const totals = $('ledger-totals'); totals.replaceChildren();
  if (!ledgerData.summary?.totals?.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhum lançamento apurado.'; totals.append(empty); }
  for (const item of ledgerData.summary?.totals || []) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = item.currency;
    const detail = document.createElement('small');
    detail.textContent = `Custo ${item.currency} ${item.cost} · venda ${money(item.currency, item.sale)} · margem ${item.marginPercent === null || item.marginPercent === undefined ? '—' : `${item.marginPercent}%`} · ${item.entries} lançamento(s)${item.pending ? ` · ${item.pending} pendente(s)` : ''}`;
    info.append(title, detail); row.append(info); totals.append(row);
  }

  const history = $('price-history'); history.replaceChildren();
  if (!ledgerData.history?.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma versão registrada.'; history.append(empty); }
  const scopeLabel = item => ({ default: 'Padrão', plan: `Plano ${item.planId}`, model: `Modelo ${item.provider}/${item.model}`, manual: `Preço manual ${item.provider}/${item.model}` })[item.scope] || item.scope;
  for (const item of ledgerData.history || []) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = scopeLabel(item);
    const detail = document.createElement('small');
    const value = item.multiplier ? `${item.multiplier}×` : item.price ? `${item.price.currency} ${item.price.basis}` : 'removido';
    detail.textContent = `${value} · ${item.effectiveAt ? new Date(item.effectiveAt).toLocaleString('pt-BR') : 'desde o início'}`;
    info.append(title, detail); row.append(info); history.append(row);
  }

  const entries = $('ledger-entries'); entries.replaceChildren();
  if (!ledgerData.entries?.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhum lançamento registrado.'; entries.append(empty); }
  for (const item of ledgerData.entries || []) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${item.model || item.publicModel || 'modelo'} · ${item.requestId}`;
    const detail = document.createElement('small');
    const status = item.status === 'settled' ? 'liquidado (simulação)' : `pendente: ${item.reason === 'moeda_divergente' ? 'moeda divergente' : 'preço indisponível'}`;
    detail.textContent = `Chave ${item.keyId || '—'} · plano ${item.planId || 'sem plano'} · custo ${money(item.currency, item.cost)} · venda ${money(item.saleCurrency || item.currency, item.sale)} · margem ${item.marginPercent === null || item.marginPercent === undefined ? '—' : `${item.marginPercent}%`} · ${status} · versões ${(item.versionIds || []).join(', ') || '—'}`;
    info.append(title, detail); row.append(info); entries.append(row);
  }
}
function renderTopup() {
  const wallets = topupData.wallets || [];
  const topups = topupData.topups || [];
  const count = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
  const money = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(Number(value) || 0);
  const sum = (items, field) => {
    const groups = new Map();
    for (const item of items) {
      if (!item?.currency || item[field] === null || item[field] === undefined) continue;
      const amount = Number(item[field]);
      if (!Number.isFinite(amount)) continue;
      groups.set(item.currency, (groups.get(item.currency) || 0) + amount);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => `${currency} ${money(value)}`).join(' · ') || '0';
  };
  $('topup-wallets-count').textContent = count(wallets.length);
  $('topup-credits').textContent = sum(topups, 'amount');
  $('topup-consumed').textContent = sum(wallets, 'consumed');
  $('topup-pending').textContent = count(wallets.reduce((total, item) => total + (item.pending || 0), 0));

  const keys = clientKeysData.filter(item => item.active !== false);
  const walletsByKey = new Map();
  for (const wallet of wallets) {
    if (!walletsByKey.has(wallet.keyId)) walletsByKey.set(wallet.keyId, []);
    walletsByKey.get(wallet.keyId).push(wallet);
  }
  const select = $('topup-key'); const selected = select.value; select.replaceChildren();
  if (!keys.length) select.append(selectOption('', 'Nenhuma chave ativa'));
  for (const key of keys) {
    const owned = walletsByKey.get(key.id) || [];
    const detail = owned.length ? owned.map(item => `${item.currency} · saldo ${item.balance}`).join(' / ') : 'sem carteira';
    select.append(selectOption(key.id, `${key.name} · ${detail}`));
  }
  if (keys.some(item => item.id === selected)) select.value = selected;
  const updateCurrency = () => {
    const key = keys.find(item => item.id === select.value);
    const plan = plansData.plans.find(item => item.id === key?.planId);
    const input = $('topup-currency');
    if (plan?.kind === 'payg' && plan.active !== false && /^[A-Z]{3}$/.test(plan.currency || '')) {
      input.value = plan.currency; input.disabled = true; input.title = 'Moeda definida pelo plano PAYG da chave.';
    } else {
      const owned = walletsByKey.get(select.value) || [];
      input.value = owned[0]?.currency || 'USD'; input.disabled = false; input.title = 'Moeda da recarga, em três letras.';
    }
  };
  select.onchange = updateCurrency; updateCurrency();

  const list = $('topup-wallet-list'); list.replaceChildren();
  if (!wallets.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma carteira ainda. Lance um crédito simulado para qualquer chave ativa.'; list.append(empty); }
  for (const wallet of wallets) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${wallet.keyName} · ${wallet.currency}`;
    const detail = document.createElement('small');
    detail.textContent = `Plano ${wallet.planName} · créditos ${money(wallet.credits)} · consumo ${money(wallet.consumed)} · saldo ${money(wallet.balance)} · ${count(wallet.requests)} chamada(s) · ${count(wallet.pending)} pendência(s)${wallet.negative ? ' · saldo negativo' : ''}`;
    info.append(title, detail); row.append(info); list.append(row);
  }

  const history = $('topup-history'); history.replaceChildren();
  if (!topups.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma recarga registrada.'; history.append(empty); }
  for (const item of [...topups].reverse()) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${item.currency} ${money(item.amount)} · ${new Date(item.createdAt).toLocaleString('pt-BR')}`;
    const detail = document.createElement('small');
    const wallet = wallets.find(entry => entry.keyId === item.keyId);
    detail.textContent = `${wallet?.keyName || item.keyId}${item.note ? ` · ${item.note}` : ''} · idempotência ${item.idempotencyKey || '—'}`;
    info.append(title, detail); row.append(info); history.append(row);
  }
}
function selectProviders() {
  const selected = $('provider-type').value; $('provider-type').replaceChildren();
  for (const p of providers) { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; $('provider-type').append(option); }
  if (providers.some(p => p.id === selected)) $('provider-type').value = selected;
  providerChanged();
}
function providerChanged() {
  const p = providers.find(item => item.id === $('provider-type').value);
  $('generic-base-wrap').hidden = p?.id !== 'generic';
  const ready = readinessData.providers.find(item => item.providerId === p?.id);
  $('provider-note').textContent = `${p?.note || 'A chave será validada por endpoint autenticado antes de salvar.'}${ready?.blockedReason ? ` Bloqueio: ${ready.blockedReason}` : ''}`;
  const links = $('provider-links'); links.replaceChildren();
  for (const [label, url, text] of [['Site', p?.site, 'Abrir site'], ['Documentação', p?.docs, 'Abrir documentação']]) {
    if (!url || !/^https:\/\//.test(url)) continue;
    const anchor = document.createElement('a'); anchor.className = 'provider-link'; anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    anchor.textContent = `${label} · ${text} ↗`; anchor.setAttribute('aria-label', `${text} de ${p.name}`); links.append(anchor);
  }
  if (ready && $('readiness-provider').value !== ready.providerId) { $('readiness-provider').value = ready.providerId; fillReadiness(); }
}
function resetProviderForm() {
  editingConnectionId = '';
  $('provider-form-title').textContent = 'Adicionar credencial';
  $('provider-submit').textContent = 'Validar e salvar';
  $('provider-cancel').hidden = true;
  $('provider-key').required = true;
  $('provider-key-label').textContent = 'Chave do fornecedor';
  $('provider-key').value = '';
  $('provider-name').value = '';
  $('provider-base').value = '';
  $('validation-path').value = '';
  providerChanged();
}
function editConnection(c) {
  editingConnectionId = c.id;
  $('provider-form-title').textContent = 'Editar credencial';
  $('provider-submit').textContent = 'Salvar alterações';
  $('provider-cancel').hidden = false;
  $('provider-key').required = false;
  $('provider-key-label').textContent = 'Nova chave do fornecedor (opcional)';
  $('provider-key').value = '';
  $('provider-name').value = c.name;
  $('provider-base').value = c.base || '';
  $('validation-path').value = c.validationPath || '';
  if (providers.some(p => p.id === c.provider)) $('provider-type').value = c.provider;
  providerChanged();
  $('provider-name').focus();
  $('provider-message').textContent = 'Deixe a chave em branco para manter a credencial atual.';
}
const readinessStatus = { planejado: 'Planejado', em_homologacao: 'Em homologação', homologado: 'Homologado' };
function renderReadinessList() {
  const list = $('readiness-list'); list.replaceChildren();
  if (!readinessData.providers.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhum fornecedor cadastrado.'; list.append(empty); return; }
  for (const item of readinessData.providers) {
    const row = document.createElement('div'); row.className = 'plan-row readiness-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${item.name} · ${readinessStatus[item.status] || item.status}`;
    const detail = document.createElement('small');
    const parts = [`Revenda ${item.resaleConfirmed ? 'confirmada' : 'não confirmada'}`, `Conexão ${item.connectable ? 'permitida' : 'bloqueada'}`, `Uso comercial ${item.commercialReady ? 'homologado' : 'não homologado'}`];
    if (item.billingUnits.length) parts.push(`Unidades: ${item.billingUnits.join(', ')}`);
    if (item.modalities.length) parts.push(`Modalidades: ${item.modalities.join(', ')}`);
    if (item.restriction) parts.push(item.restriction);
    detail.textContent = parts.join(' · ');
    info.append(title, detail);
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Editar';
    button.addEventListener('click', () => { $('readiness-provider').value = item.providerId; fillReadiness(); });
    row.append(info, button); list.append(row);
  }
}
function fillReadiness() {
  const item = readinessData.providers.find(entry => entry.providerId === $('readiness-provider').value);
  if (!item) { $('readiness-summary').textContent = ''; return; }
  $('readiness-status').value = item.status;
  $('readiness-resale').checked = item.resaleConfirmed;
  $('readiness-evidence').value = item.resaleEvidence || '';
  $('readiness-jurisdiction').value = item.jurisdiction || '';
  $('readiness-reviewed').value = item.reviewedAt || '';
  $('readiness-owner').value = item.owner || '';
  $('readiness-sla').value = item.sla || '';
  $('readiness-note').value = item.note || '';
  const lines = [
    item.blockedReason ? `Bloqueio: ${item.blockedReason}` : 'Conexão permitida pela política local.',
    `Protocolos: ${item.protocols.join(', ') || 'não informados'}`,
    `Cotas: ${item.quotaSources.join(', ') || 'não informadas'}`,
    item.variantPolicy ? `Variantes: ${item.variantPolicy}` : '',
    `Evidências: ${item.evidence.join(', ') || 'não informadas'}`,
    item.restriction || '',
  ].filter(Boolean);
  $('readiness-summary').replaceChildren();
  for (const line of lines) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = line; $('readiness-summary').append(p); }
}
function renderReadiness() {
  const select = $('readiness-provider'); const selected = select.value; select.replaceChildren();
  for (const item of readinessData.providers) { const option = document.createElement('option'); option.value = item.providerId; option.textContent = item.name; select.append(option); }
  if (readinessData.providers.some(item => item.providerId === selected)) select.value = selected;
  $('readiness-enforce').checked = readinessData.policy?.enforceResale === true;
  renderReadinessList(); fillReadiness();
}
function factList(node, pairs) {
  node.replaceChildren();
  for (const [label, value] of pairs) {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = value ?? '—';
    item.append(term, detail); node.append(item);
  }
}
function referralMoney(value) { return value?.amount === undefined ? '—' : `${value.amount} ${value.currency}`; }
function referralStatus(value) { return { cadastro: 'Cadastro', em_analise: 'Em análise', qualificada: 'Qualificada', rejeitada: 'Rejeitada', creditado: 'Crédito simulado' }[value] || value || '—'; }
function fillReferralSelect(select, records, filter) {
  const selected = select.value; select.replaceChildren();
  for (const item of records.filter(filter)) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = item.name ? `${item.name} · ${item.code || ''}` : `${item.contact || 'Contato'} · ${item.status} · ${item.ownerName || item.ownerKeyId}`;
    select.append(option);
  }
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}
function renderReferrals(report) {
  referralsData = report;
  const program = report.program || {};
  const totals = report.totals || {};
  const ladder = (program.ladder || []).map(item => `${item.from}-${item.to ?? '+'}: ${item.amount} ${program.currency}`).join(' · ');
  factList($('referral-program'), [
    ['Moeda', program.currency], ['Depósito para qualificar', `${program.qualifyAmount ?? '—'} ${program.currency || ''}`.trim()],
    ['Espera', program.holdDays === undefined ? '—' : `${program.holdDays} dia(s)`], ['Mínimo para mover', `${program.minCredit ?? '—'} ${program.currency || ''}`.trim()],
    ['Escada', ladder], ['Regra', program.note],
  ]);
  factList($('referral-totals'), [
    ['Cadastros', totals.signups ?? 0], ['Qualificadas', totals.qualified ?? 0], ['Em análise', totals.inAnalysis ?? 0], ['Rejeitadas', totals.rejected ?? 0],
    ['Em espera', referralMoney(totals.pending)], ['Bloqueado', referralMoney(totals.blocked)], ['Disponível', referralMoney(totals.available)], ['Crédito simulado', referralMoney(totals.earned)],
  ]);
  const owners = $('referral-owners'); owners.replaceChildren();
  for (const owner of report.owners) {
    const row = document.createElement('div'); row.className = 'referral-row';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${owner.name} · ${owner.code}`;
    const detail = document.createElement('small'); detail.textContent = `${owner.stats.signups} cadastro(s) · ${owner.stats.qualified} qualificada(s) · ${referralMoney(owner.stats.earned)} creditado(s)`;
    info.append(title, detail); row.append(info); owners.append(row);
  }
  fillReferralSelect($('referral-owner'), report.owners, () => true);
  fillReferralSelect($('referral-qualify-id'), report.records, item => ['cadastro', 'em_analise'].includes(item.status));
  fillReferralSelect($('referral-status-id'), report.records, item => item.status !== 'creditado');
  const eligible = new Set(totals.movableIds || []);
  fillReferralSelect($('referral-move-ids'), report.records, item => eligible.has(item.id));
  const records = $('referral-records'); records.replaceChildren();
  if (!report.records.length) records.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nenhuma indicação registrada.' }));
  for (const item of report.records) {
    const row = document.createElement('div'); row.className = 'referral-row';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${item.contact || 'Contato'} · ${referralStatus(item.status)}`;
    const detail = document.createElement('small'); detail.textContent = `${item.ownerName || item.ownerKeyId} · código ${item.code} · reward ${item.rewardAmount ? `${item.rewardAmount} ${item.rewardCurrency}` : '—'} · até ${item.holdUntil || '—'}${item.reference ? ` · ref ${item.reference}` : ''}${item.note ? ` · ${item.note}` : ''}`;
    info.append(title, detail); row.append(info); records.append(row);
  }
  const audit = $('referral-audit'); audit.replaceChildren();
  for (const event of (report.audit || []).slice().reverse()) {
    const row = document.createElement('div'); row.className = 'referral-row';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${event.action} · ${event.at}`;
    const detail = document.createElement('small'); detail.textContent = `Alvo ${event.targetKeyId || '—'} · ${JSON.stringify(event.before || {})} → ${JSON.stringify(event.after || {})}${event.reason ? ` · ${event.reason}` : ''}`;
    info.append(title, detail); row.append(info); audit.append(row);
  }
}
function selectedUserReport() {
  return (usersData?.users || []).find(user => user.id === selectedUserId) || null;
}
function renderUserList() {
  const list = $('user-list'); list.replaceChildren();
  const term = ($('user-search')?.value || '').trim().toLowerCase();
  const users = (usersData?.users || []).filter(user => !term || `${user.name} ${user.label} ${user.id}`.toLowerCase().includes(term));
  $('user-list-empty').hidden = users.length > 0;
  for (const user of users) {
    const row = document.createElement('div'); row.className = `user-row${user.id === selectedUserId ? ' selected' : ''}`;
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${user.name} · ${user.label}`;
    const balance = user.wallets.length ? user.wallets.map(item => `${item.currency} ${moneyText(item.balance)}`).join(' / ') : 'sem carteira';
    const detail = document.createElement('small');
    detail.textContent = `${user.keyCount} chave(s) · ${user.activeKeys} ativa(s) · ${user.blocked ? 'bloqueado' : 'ativo'} · ${balance} · ${user.referrals.stats.signups} indicação(ões)`;
    info.append(title, detail);
    const open = document.createElement('button'); open.className = 'secondary'; open.textContent = 'Ver detalhes';
    open.addEventListener('click', () => selectUser(user.id));
    row.append(info, open); list.append(row);
  }
}
function selectUser(id) {
  selectedUserId = id;
  $('user-key-created').textContent = '';
  $('user-referral-message').textContent = '';
  renderUserList(); renderUserDetail();
}
function renderUserDetail() {
  const user = selectedUserReport();
  $('user-empty').hidden = !!user;
  $('user-detail').hidden = !user;
  $('user-referrals-panel').hidden = !user;
  if (!user) {
    $('user-empty').textContent = (usersData?.users || []).length ? 'Selecione um titular para ver chaves, saldo e indicações.' : 'Nenhum titular cadastrado. Crie uma chave em “Chaves de acesso” para começar.';
    return;
  }
  const count = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
  factList($('user-facts'), [
    ['Titular', user.name], ['Chave principal', user.label], ['Estado', user.blocked ? 'Bloqueado' : 'Ativo'],
    ['Plano', user.planName], ['Chaves', `${user.activeKeys}/${user.keyCount} ativas · limite ${user.maxKeys}`],
    ['Requisições concluídas', count(user.activity?.requests)], ['Código de indicação', user.referrals.code || '—'],
  ]);
  const wallets = $('user-wallets'); wallets.replaceChildren();
  if (!user.wallets.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma carteira PAYG neste titular.'; wallets.append(empty); }
  for (const item of user.wallets) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${item.currency} · saldo ${moneyText(item.balance)}`;
    const detail = document.createElement('small');
    detail.textContent = `${item.keys} chave(s) · créditos ${moneyText(item.credits)} · consumo ${moneyText(item.consumed)} · ${count(item.requests)} chamada(s) · ${count(item.pending)} pendência(s)${item.negative ? ' · saldo negativo' : ''}`;
    info.append(title, detail); row.append(info); wallets.append(row);
  }
  const keys = $('user-keys'); keys.replaceChildren();
  for (const key of user.keys) {
    const row = document.createElement('div'); row.className = 'plan-row';
    const info = document.createElement('div'); info.className = 'plan-info';
    const title = document.createElement('strong'); title.textContent = `${key.name} · ${key.label}`;
    const detail = document.createElement('small');
    detail.textContent = `${key.role} · ${key.active ? 'ativa' : 'revogada'} · ${key.planName}${key.createdAt ? ` · criada em ${new Date(key.createdAt).toLocaleString('pt-BR')}` : ''}`;
    info.append(title, detail); row.append(info); keys.append(row);
  }
  const planSelect = $('user-plan-select'); fillPlanSelect(planSelect); planSelect.value = user.planId || '';
  const keyPlan = $('user-key-plan'); fillPlanSelect(keyPlan); keyPlan.value = user.planId || '';
  const topupSelect = $('user-topup-key'); const previousTopup = topupSelect.value; topupSelect.replaceChildren();
  for (const key of user.keys.filter(item => item.active)) topupSelect.append(selectOption(key.id, `${key.name} · ${key.label}`));
  if ([...topupSelect.options].some(option => option.value === previousTopup)) topupSelect.value = previousTopup;
  const updateCurrency = () => {
    const key = user.keys.find(item => item.id === topupSelect.value);
    const plan = plansData.plans.find(item => item.id === key?.planId);
    const input = $('user-topup-currency');
    if (plan?.kind === 'payg' && plan.active !== false && /^[A-Z]{3}$/.test(plan.currency || '')) {
      input.value = plan.currency; input.disabled = true; input.title = 'Moeda definida pelo plano PAYG da chave.';
    } else {
      input.value = user.wallets[0]?.currency || 'USD'; input.disabled = false; input.title = 'Moeda da recarga, em três letras.';
    }
  };
  topupSelect.onchange = updateCurrency; updateCurrency();
  $('user-block-button').disabled = user.blocked;
  $('user-unblock-button').disabled = !user.blocked;

  const stats = user.referrals.stats || {};
  factList($('user-referral-stats'), [
    ['Cadastros', stats.signups ?? 0], ['Qualificadas', stats.qualified ?? 0], ['Em análise', stats.inAnalysis ?? 0],
    ['Em espera', referralMoney(stats.pending)], ['Disponível', referralMoney(stats.available)], ['Crédito simulado', referralMoney(stats.earned)],
  ]);
  fillReferralSelect($('user-referral-qualify-id'), user.referrals.records, item => ['cadastro', 'em_analise'].includes(item.status));
  fillReferralSelect($('user-referral-status-id'), user.referrals.records, item => item.status !== 'creditado');
  const eligible = new Set(stats.movableIds || []);
  fillReferralSelect($('user-referral-move-ids'), user.referrals.records, item => eligible.has(item.id));
  const list = $('user-referral-list'); list.replaceChildren();
  if (!user.referrals.records.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma indicação registrada para este titular.'; list.append(empty); }
  for (const item of user.referrals.records) {
    const row = document.createElement('div'); row.className = 'referral-row';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${item.contact || 'Contato'} · ${referralStatus(item.status)}`;
    const detail = document.createElement('small');
    detail.textContent = `Código ${item.code || user.referrals.code || '—'} · ${item.rewardAmount ? `${item.rewardAmount} ${item.rewardCurrency}` : 'sem recompensa'} · até ${item.holdUntil || '—'}${item.reference ? ` · ref ${item.reference}` : ''}${item.note ? ` · ${item.note}` : ''}`;
    info.append(title, detail); row.append(info); list.append(row);
  }
}
function renderUsers() {
  const totals = usersData?.totals || {};
  const count = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
  $('user-total').textContent = count(totals.users);
  $('user-active').textContent = `${count(totals.activeUsers)} ativos`;
  $('user-blocked').textContent = count(totals.blockedUsers);
  $('user-keys-total').textContent = count(totals.keys);
  $('user-keys-active').textContent = `${count(totals.activeKeys)} ativas`;
  $('user-referrals-total').textContent = count(totals.referrals?.signups);
  $('user-referrals-earned').textContent = `${referralMoney(totals.referrals?.earned)} em crédito simulado`;
  if (!(usersData?.users || []).some(user => user.id === selectedUserId)) selectedUserId = usersData?.users?.[0]?.id || '';
  renderUserList(); renderUserDetail();
}
const pagePaths = { home: '/', models: '/models', 'model-prices': '/model-prices', providers: '/providers', routes: '/routes', plans: '/plans', ledger: '/ledger', topup: '/topup', keys: '/keys', users: '/users', stats: '/stats', 'global-stats': '/global-stats', 'client-home': '/client-home', chat: '/chat', 'client-area': '/minha-conta', referrals: '/referrals', 'referrals-client': '/indicacoes', system: '/system', connect: '/connect' };
function showPage(name, navigate = true) {
  if (!pagePaths[name]) name = 'home';
  if (navigate && location.pathname !== pagePaths[name]) history.pushState({}, '', pagePaths[name]);
  document.querySelectorAll('[data-page]').forEach(el => { el.hidden = el.dataset.page !== name; });
  document.querySelectorAll('[data-nav]').forEach(el => { el.classList.toggle('active', el.dataset.nav === name); });
  $('page-name').textContent = ({ home: 'Dashboard', models: 'Modelos', 'model-prices': 'Preços por modelo', providers: 'Fornecedores', routes: 'Rotas', plans: 'Planos e limites', ledger: 'Razão financeira', topup: 'Top up PAYG', keys: 'Chaves de acesso', users: 'Usuários', stats: 'Estatísticas', 'global-stats': 'Estatísticas globais', 'client-home': 'Resumo do cliente', chat: 'Chat com IA', 'client-area': 'Área do cliente', referrals: 'Indicações', 'referrals-client': 'Minhas indicações', system: 'Sistema', connect: 'Conectar ferramenta' })[name];
}
function localDateInput(iso) {
  if (!iso) return ''; const date = new Date(iso); if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function fillAccount(id) {
  const account = dashboardData.accounts.find(item => item.connectionId === id)?.account;
  $('account-connection').value = id; $('account-plan').value = account?.plan || '';
  $('account-mode').value = account?.billingMode || 'unknown'; $('account-currency').value = account?.currency || 'USD';
  $('account-balance').value = account?.balance ?? ''; $('account-spent').value = account?.spent ?? '';
  $('account-daily-tokens').value = account?.dailyTokens ?? ''; $('account-backup').checked = account?.backup === true;
  $('account-end').value = localDateInput(account?.freeEndsAt); $('account-reset').checked = false;
}
function remainingTime(end) {
  if (!end) return 'Prazo não informado';
  const difference = new Date(end).getTime() - Date.now();
  if (difference <= 0) return `Encerrado em ${new Date(end).toLocaleString('pt-BR')}`;
  const hours = Math.ceil(difference / 3600000), days = Math.floor(hours / 24);
  return `${days ? `${days} dia${days === 1 ? '' : 's'} e ` : ''}${hours % 24} h restantes`;
}
function renderDashboard() {
  const accounts = dashboardData.accounts; const format = new Intl.NumberFormat('pt-BR');
  $('home-provider-count').textContent = format.format(new Set(accounts.map(a => a.provider)).size);
  $('home-connection-count').textContent = format.format(accounts.length);
  $('home-request-count').textContent = format.format(usageStats.recordCount);
  $('home-request-scope').textContent = usagePeriod.from || usagePeriod.to ? 'Período filtrado (UTC)' : 'Até 10.000 mais recentes';
  const list = $('home-providers'); list.replaceChildren();
  const select = $('account-connection'); const selected = select.value; select.replaceChildren();
  $('account-submit').disabled = accounts.length === 0;
  for (const item of accounts) {
    const option = document.createElement('option'); option.value = item.connectionId; option.textContent = `${item.name} · ${item.provider}`; select.append(option);
    const card = document.createElement('article'); card.className = 'overview-provider';
    const top = document.createElement('div'); top.className = 'overview-provider-head';
    const label = document.createElement('div'); const name = document.createElement('h3'); name.textContent = item.name;
    const sub = document.createElement('p'); sub.textContent = `${item.provider} · ${statusText(item.status)}`; label.append(name, sub);
    const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Atualizar informações';
    edit.addEventListener('click', () => { fillAccount(item.connectionId); $('account-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('account-plan').focus({ preventScroll: true }); });
    const actions = document.createElement('div'); actions.className = 'overview-actions'; actions.append(edit);
    if (item.provider === 'xkiro') { const sync = document.createElement('button'); sync.className = 'secondary'; sync.textContent = 'Consultar xKiro'; sync.addEventListener('click', async () => { sync.disabled = true; try { const result = await post(`/admin/connections/${item.connectionId}/provider-usage`); syncedProviderUsage.set(item.connectionId, result); renderDashboard(); $('account-message').textContent = 'Dados consultados no xKiro, sem alterar o saldo informado.'; } catch (error) { $('account-message').textContent = error.message; } finally { sync.disabled = false; } }); actions.append(sync); }
    top.append(label, actions);
    const data = document.createElement('dl'); data.className = 'overview-metrics';
    const account = item.account; const money = value => value === null || value === undefined ? 'Não informado' : `${account.currency} ${value}`;
    const live = syncedProviderUsage.get(item.connectionId);
    const rows = [
      ['Plano', account?.plan || 'Não informado'],
      ['Prazo do plano', remainingTime(account?.freeEndsAt)],
      ['Saldo informado', money(account?.balance)],
      ['Gasto informado', money(account?.spent)],
      ['Uso observado', `${format.format(item.requestsObserved)} requisições`],
      ['Gasto estimado após saldo', item.estimatedSpend === null ? 'Não disponível' : money(item.estimatedSpend)],
      [item.unpricedRequests || item.coverageLimited ? 'Saldo estimado (parcial)' : 'Saldo estimado', item.estimatedBalance === null ? 'Não disponível' : money(item.estimatedBalance)],
    ];
    if (live) { rows.push(['Saldo consultado no xKiro', live.wallet.balance === null ? 'Não informado' : `${live.wallet.currency} ${live.wallet.balance}`]); rows.push(['Tokens grátis restantes', live.freeTokens.remaining === null ? 'Não informado' : format.format(live.freeTokens.remaining)]); rows.push(['Consulta ao fornecedor', new Date(live.checkedAt).toLocaleString('pt-BR')]); }
    if (item.dailyUsage) rows.push(['Tokens hoje', `${format.format(item.dailyUsage.tokens)} / ${format.format(item.dailyUsage.limit)}`], ['Franquia restante hoje', format.format(item.dailyUsage.remaining)], ['Backup da franquia', item.dailyUsage.backup ? 'Saldo da carteira' : 'Não configurado']);
    for (const [title, value] of rows) { const div = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = title; const dd = document.createElement('dd'); dd.textContent = value; div.append(dt, dd); data.append(div); }
    const note = document.createElement('p'); note.className = 'overview-note';
    if (!account) note.textContent = 'Cadastre informações para acompanhar saldo e plano.';
    else if (account.billingMode !== 'payg') note.textContent = 'Desconto automático indisponível para plano ou tipo de cobrança não informado.';
    else note.textContent = `Estimativa desta conexão desde ${new Date(account.balanceAsOf).toLocaleString('pt-BR')}. ${item.unpricedRequests} chamada(s) sem custo estimável${item.coverageLimited ? '; histórico limitado a 10.000 chamadas' : ''}. Pode não incluir outras chaves da mesma conta; confira o saldo no fornecedor.`;
    card.append(top, data, note); list.append(card);
  }
  if (!accounts.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Nenhuma conexão ativa. Adicione um fornecedor para começar.'; list.append(empty); }
  if (accounts.some(a => a.connectionId === selected)) select.value = selected;
  else if (accounts.length) fillAccount(accounts[0].connectionId);
}
function renderProviderTabs() {
  const tabs = $('provider-tabs'); tabs.replaceChildren();
  for (const p of providers) {
    const button = document.createElement('button'); button.className = `provider-tab${currentProvider === p.id ? ' active' : ''}`;
    const count = connections.filter(c => c.provider === p.id).length;
    button.textContent = `${p.name}${count ? ` · ${count}` : ''}`; button.setAttribute('aria-pressed', String(currentProvider === p.id));
    button.addEventListener('click', () => selectCatalogProvider(p.id)); tabs.append(button);
  }
}
async function selectCatalogProvider(id, connectionId = undefined) {
  currentProvider = id; renderProviderTabs(); const available = connections.filter(c => c.provider === id);
  const select = $('catalog-connection'); select.replaceChildren();
  if (id === 'wusrouter') { const option = document.createElement('option'); option.value = ''; option.textContent = 'Catálogo público'; select.append(option); }
  for (const c of available) { const option = document.createElement('option'); option.value = c.id; option.textContent = c.name; select.append(option); }
  if (connectionId === '' && id === 'wusrouter') select.value = '';
  else if (connectionId && available.some(c => c.id === connectionId)) select.value = connectionId;
  else if (available.length) select.value = available[0].id;
  if (select.value) return openCatalog(select.value);
  currentConnection = null; catalog = [];
  const p = providers.find(item => item.id === id); $('catalog-title').textContent = p?.name || id;
  if (id === 'wusrouter') {
    $('catalog-info').textContent = 'Carregando catálogo público…'; $('catalog-message').textContent = '';
    try { const result = await api('/admin/providers/wusrouter/models'); catalog = result.models.map(m => ({ ...m, enabled: false })); catalogSource = 'public'; $('catalog-info').textContent = `${catalog.length} modelos · catálogo público`; $('catalog-message').textContent = 'Para habilitar modelos, adicione e valide uma credencial do WusRouter.'; }
    catch (error) { $('catalog-info').textContent = 'Catálogo indisponível'; $('catalog-message').textContent = error.message; }
  } else { $('catalog-info').textContent = 'Nenhuma credencial cadastrada para este fornecedor.'; $('catalog-message').textContent = 'Adicione uma credencial em Fornecedores para consultar seus modelos.'; }
  updateFamilies(); renderCatalog();
}
function pricingText(model) {
  const p = model.pricing;
  if (model.planOnly) return ['Disponível em plano específico', 'Confira o preço e as condições no fornecedor'];
  if (!p) return ['Preço não informado', 'Consulte o fornecedor'];
  const currency = p.currency || (currentProvider === 'wusrouter' ? 'USD' : 'moeda não informada');
  if (model.billingType === 'request') return [`${currency} ${p.request ?? '—'} / requisição`, `Cache leitura: ${p.cache_read ?? '—'} · gravação: ${p.cache_write ?? '—'} / 1M`];
  const unit = p.unit === 'per_1m_tokens' || model.billingType === 'token' ? ' / 1M tokens' : '';
  return [`Entrada: ${currency} ${p.input ?? '—'} · Saída: ${currency} ${p.output ?? '—'}${unit}`, `Cache leitura: ${p.cache_read ?? '—'} · gravação: ${p.cache_write ?? '—'}${unit}`];
}
function multiplyDecimal(value, multiplier) {
  function parts(input) {
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(input));
    if (!match) return null;
    const fraction = match[2] || ''; const exp = Number(match[3] || 0); if (Math.abs(exp) > 30) return null;
    return { n: BigInt(match[1] + fraction), scale: fraction.length - exp };
  }
  const a = parts(value), b = parts(multiplier); if (!a || !b) return null;
  let digits = String(a.n * b.n), scale = a.scale + b.scale;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  if (scale) { digits = digits.padStart(scale + 1, '0'); digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, ''); }
  return digits || '0';
}
function saleText(model, multiplier) {
  const p = model.pricing; if (!p || model.planOnly) return 'Preço sugerido indisponível';
  const currency = p.currency || (currentProvider === 'wusrouter' ? 'USD' : null);
  if (!currency) return 'Preço sugerido indisponível: moeda não informada';
  const cacheRead = multiplyDecimal(p.cache_read, multiplier), cacheWrite = multiplyDecimal(p.cache_write, multiplier);
  const cache = cacheRead !== null && cacheWrite !== null ? ` · cache leitura ${currency} ${cacheRead}, gravação ${currency} ${cacheWrite} / 1M` : '';
  if (model.billingType === 'request') { const value = multiplyDecimal(p.request, multiplier); return value === null ? 'Preço sugerido indisponível' : `${currency} ${value} / requisição${cache}`; }
  if (p.unit !== 'per_1m_tokens' && model.billingType !== 'token') return 'Preço sugerido indisponível: unidade não informada';
  const input = multiplyDecimal(p.input, multiplier), output = multiplyDecimal(p.output, multiplier);
  if (input === null || output === null) return 'Preço sugerido indisponível';
  return `Entrada: ${currency} ${input} · saída: ${currency} ${output} / 1M tokens${cache}`;
}
function updateFamilies() {
  const select = $('catalog-family'); select.replaceChildren();
  const all = document.createElement('option'); all.value = 'all'; all.textContent = 'Todos os fabricantes'; select.append(all);
  for (const family of [...new Set(catalog.map(model => model.family).filter(Boolean))].sort()) { const option = document.createElement('option'); option.value = family; option.textContent = family; select.append(option); }
}
function updateViewToggle() {
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === catalogView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function zeroMoney(value) { return value !== undefined && value !== null && value !== '' && Number(value) === 0; }
function offerFlags(model, manual) {
  const catalog = model.pricing; let supplierFree = model.access === 'free';
  if (!supplierFree && catalog) supplierFree = model.billingType === 'request' ? zeroMoney(catalog.request) : (zeroMoney(catalog.input) && zeroMoney(catalog.output));
  const manualFree = !!manual && (manual.basis === 'per_request' ? zeroMoney(manual.request) : (zeroMoney(manual.input) && zeroMoney(manual.output)));
  const offer = manual ? (manualFree ? 'free' : 'priced') : (!catalog || model.planOnly ? 'unknown' : (supplierFree ? 'free' : 'priced'));
  return { supplierFree, offer };
}
function offerMatches(info, value) {
  if (value === 'supplier-free') return info.supplierFree;
  if (value === 'supplier-paid') return !info.supplierFree;
  if (value === 'offered-free') return info.offer === 'free';
  if (value === 'sale-priced') return info.offer === 'priced';
  if (value === 'supplier-free-unpriced') return info.supplierFree && info.offer !== 'priced';
  if (value === 'unpriced') return info.offer === 'unknown';
  return true;
}
function renderOfferSummary(items) {
  const summary = $('catalog-offer-summary'); if (!summary) return;
  const count = predicate => items.filter(predicate).length;
  summary.textContent = `${items.length} modelo(s) · ${count(item => item.info.supplierFree)} grátis no fornecedor · ${count(item => item.info.offer === 'free')} com venda grátis · ${count(item => item.info.offer === 'priced')} com preço de venda · ${count(item => item.info.offer === 'unknown')} sem preço definido`;
}
function modelPricingInfo(model) {
  const providerId = currentProvider;
  const rule = pricingConfig.rules.find(r => r.provider === providerId && r.model === model.id);
  const multiplier = rule?.multiplier || pricingConfig.defaultMultiplier;
  const manual = (pricingConfig.manualPrices || []).find(r => r.provider === providerId && r.model === model.id)?.price || null;
  const matches = usageStats.groups.filter(g => g.provider === providerId && g.model === model.id && (!currentConnection || g.connectionId === currentConnection));
  const totals = matches.reduce((sum, g) => { for (const field of ['requests', 'inputTokens', 'outputTokens', 'inputReported', 'outputReported', 'failed', 'cancelled', 'pending']) sum[field] += g[field] || 0; return sum; }, { requests: 0, inputTokens: 0, outputTokens: 0, inputReported: 0, outputReported: 0, failed: 0, cancelled: 0, pending: 0 });
  return { providerId, rule, multiplier, manual, totals, ...offerFlags(model, manual) };
}
function buildModelHead(model) {
  const head = document.createElement('div'); head.className = 'model-head';
  const symbol = document.createElement('span'); symbol.className = 'model-symbol'; symbol.textContent = (model.family || model.name || 'M').slice(0, 1).toUpperCase(); symbol.setAttribute('aria-hidden', 'true');
  const info = document.createElement('div'); const name = document.createElement('div'); name.className = 'model-name'; name.textContent = model.name;
  const id = document.createElement('div'); id.className = 'model-id'; id.textContent = model.id; info.append(name, id); head.append(symbol, info);
  return head;
}
function buildModelPricing(model) {
  const pricing = document.createElement('div'); pricing.className = 'model-pricing'; const [amount, cache] = pricingText(model); pricing.textContent = `Custo anunciado: ${amount}`;
  const detail = document.createElement('small'); detail.textContent = cache; pricing.append(detail);
  return pricing;
}
function buildModelSale(model, multiplier, manual) {
  const sale = document.createElement('div'); sale.className = 'model-sale';
  const manualCache = manual && manual.basis === 'per_1m_tokens' && (manual.cacheRead || manual.cacheWrite) ? ` · cache leitura ${manual.currency} ${manual.cacheRead ?? '—'}, gravação ${manual.currency} ${manual.cacheWrite ?? '—'} / 1M` : '';
  sale.textContent = manual ? (manual.basis === 'per_request' ? `Venda manual (simulação): ${manual.currency} ${manual.request} / requisição` : `Venda manual (simulação): entrada ${manual.currency} ${manual.input} · saída ${manual.currency} ${manual.output} / 1M tokens${manualCache}`) : `Venda sugerida (${multiplier}×): ${saleText(model, multiplier)}`;
  return sale;
}
function buildModelUsage(totals) {
  const count = value => new Intl.NumberFormat('pt-BR').format(value);
  const usage = document.createElement('div'); usage.className = 'model-usage';
  const inputText = totals.inputReported ? `${count(totals.inputTokens)}${totals.inputReported < totals.requests ? ' (parcial)' : ''}` : '—';
  const outputText = totals.outputReported ? `${count(totals.outputTokens)}${totals.outputReported < totals.requests ? ' (parcial)' : ''}` : '—';
  usage.textContent = `Uso observado: ${count(totals.requests)} req. · entrada: ${inputText} · saída: ${outputText} · falhas: ${count(totals.failed)} · canceladas: ${count(totals.cancelled)} · pendentes: ${count(totals.pending)} · estimativa por chave: veja Chaves de acesso`;
  if (totals.requests && (totals.inputReported < totals.requests || totals.outputReported < totals.requests)) usage.title = 'Tokens parciais: nem todas as requisições informaram entrada e saída.';
  return usage;
}
function buildPriceForm(model, providerId, rule) {
  const priceForm = document.createElement('form'); priceForm.className = 'model-price-form';
  const factor = document.createElement('input'); factor.type = 'number'; factor.min = '0.000001'; factor.max = '9999.999999'; factor.step = '0.000001'; factor.placeholder = `${pricingConfig.defaultMultiplier}× padrão`; factor.value = rule?.multiplier || ''; factor.setAttribute('aria-label', `Multiplicador de ${model.name} neste fornecedor`);
  const save = document.createElement('button'); save.className = 'secondary'; save.textContent = 'Salvar';
  priceForm.append(factor, save); priceForm.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true; try { pricingConfig = await post('/admin/pricing', { scope: 'model', provider: providerId, model: model.id, multiplier: factor.value || null }); $('catalog-message').textContent = 'Multiplicador salvo. Preço manual, se definido, tem prioridade. Cobrança ainda não implementada.'; renderCatalog(); } catch (error) { $('catalog-message').textContent = error.message; save.disabled = false; } });
  return priceForm;
}
function buildManualPricing(model, providerId, manual) {
  const manualDetails = document.createElement('details'); manualDetails.className = 'manual-pricing';
  const summary = document.createElement('summary'); summary.textContent = manual ? 'Editar preço manual' : 'Definir preço manual'; manualDetails.append(summary);
  const manualForm = document.createElement('form');
  const basisLabel = document.createElement('label'); basisLabel.textContent = 'Unidade de venda';
  const basis = document.createElement('select'); basis.setAttribute('aria-label', `Unidade de venda de ${model.name}`);
  for (const [value, labelText] of [['per_1m_tokens', 'Por 1 milhão de tokens'], ['per_request', 'Por requisição']]) { const option = document.createElement('option'); option.value = value; option.textContent = labelText; basis.append(option); }
  basis.value = manual?.basis || (model.billingType === 'request' ? 'per_request' : 'per_1m_tokens'); basisLabel.append(basis);
  const currencyLabel = document.createElement('label'); currencyLabel.textContent = 'Moeda';
  const currency = document.createElement('select'); currency.setAttribute('aria-label', `Moeda de ${model.name}`);
  for (const code of ['USD', 'BRL', 'EUR', 'IDR', 'CNY']) { const option = document.createElement('option'); option.value = code; option.textContent = code; currency.append(option); }
  currency.value = manual?.currency || 'USD'; currencyLabel.append(currency);
  const firstLabel = document.createElement('label'); const firstTitle = document.createElement('span'); firstLabel.append(firstTitle);
  const first = document.createElement('input'); first.type = 'number'; first.min = '0'; first.step = 'any'; first.required = true; first.value = manual?.request ?? manual?.input ?? ''; first.setAttribute('aria-label', `Preço de entrada ou requisição de ${model.name}`); firstLabel.append(first);
  const secondLabel = document.createElement('label'); secondLabel.textContent = 'Preço de saída';
  const second = document.createElement('input'); second.type = 'number'; second.min = '0'; second.step = 'any'; second.value = manual?.output ?? ''; second.setAttribute('aria-label', `Preço de saída de ${model.name}`); secondLabel.append(second);
  const cacheReadLabel = document.createElement('label'); cacheReadLabel.textContent = 'Leitura de cache (opcional, / 1M)';
  const cacheRead = document.createElement('input'); cacheRead.type = 'number'; cacheRead.min = '0'; cacheRead.step = 'any'; cacheRead.value = manual?.cacheRead ?? ''; cacheRead.setAttribute('aria-label', `Preço de leitura de cache de ${model.name}`); cacheReadLabel.append(cacheRead);
  const cacheWriteLabel = document.createElement('label'); cacheWriteLabel.textContent = 'Gravação de cache (opcional, / 1M)';
  const cacheWrite = document.createElement('input'); cacheWrite.type = 'number'; cacheWrite.min = '0'; cacheWrite.step = 'any'; cacheWrite.value = manual?.cacheWrite ?? ''; cacheWrite.setAttribute('aria-label', `Preço de gravação de cache de ${model.name}`); cacheWriteLabel.append(cacheWrite);
  const updateBasis = () => { const perRequest = basis.value === 'per_request'; firstTitle.textContent = perRequest ? 'Preço por requisição' : 'Preço de entrada'; secondLabel.hidden = perRequest; second.required = !perRequest; cacheReadLabel.hidden = perRequest; cacheWriteLabel.hidden = perRequest; };
  basis.addEventListener('change', updateBasis); updateBasis();
  const submit = document.createElement('button'); submit.className = 'secondary'; submit.textContent = 'Salvar preço';
  manualForm.append(basisLabel, currencyLabel, firstLabel, secondLabel, cacheReadLabel, cacheWriteLabel, submit);
  if (manual) { const clear = document.createElement('button'); clear.className = 'secondary'; clear.type = 'button'; clear.textContent = 'Usar multiplicador'; clear.addEventListener('click', async () => { try { pricingConfig = await post('/admin/pricing', { scope: 'manual_model', provider: providerId, model: model.id, price: null }); $('catalog-message').textContent = 'Preço manual removido.'; renderCatalog(); } catch (error) { $('catalog-message').textContent = error.message; } }); manualForm.append(clear); }
  manualForm.addEventListener('submit', async event => { event.preventDefault(); submit.disabled = true; const price = { basis: basis.value, currency: currency.value }; if (basis.value === 'per_request') price.request = first.value; else { price.input = first.value; price.output = second.value; if (cacheRead.value !== '') price.cacheRead = cacheRead.value; if (cacheWrite.value !== '') price.cacheWrite = cacheWrite.value; } try { pricingConfig = await post('/admin/pricing', { scope: 'manual_model', provider: providerId, model: model.id, price }); $('catalog-message').textContent = 'Preço manual salvo e usado na estimativa por chave; cobrança ainda não implementada.'; renderCatalog(); } catch (error) { $('catalog-message').textContent = error.message; submit.disabled = false; } });
  manualDetails.append(manualForm);
  return manualDetails;
}
function buildModelMeta(model) {
  const meta = document.createElement('div'); meta.className = 'model-meta'; const type = document.createElement('span'); type.textContent = [model.modality, model.access, model.family].filter(Boolean).join(' · ');
  const label = document.createElement('label'); label.className = 'checkbox';
  const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = model.enabled; toggle.disabled = model.modality !== 'chat' || !currentConnection; toggle.setAttribute('aria-label', `Habilitar ${model.name}`);
  toggle.addEventListener('change', async () => { toggle.disabled = true; try { await post(`/admin/connections/${currentConnection}/models`, { id: model.id, enabled: toggle.checked }); model.enabled = toggle.checked; $('catalog-message').textContent = 'Modelo atualizado para esta credencial.'; await show(); } catch (error) { toggle.checked = model.enabled; $('catalog-message').textContent = error.message; } finally { toggle.disabled = false; } });
  label.append(toggle, document.createTextNode(' Habilitado')); meta.append(type, label);
  return meta;
}
function buildOfferTag(model, info) {
  const wrap = document.createElement('div'); wrap.className = 'model-offer';
  const add = (text, kind) => { const item = document.createElement('span'); item.className = `model-offer-tag ${kind}`; item.textContent = text; wrap.append(item); };
  if (info.supplierFree) add('Grátis no fornecedor', 'free');
  if (info.offer === 'free') add('Venda grátis', 'free');
  else if (info.offer === 'priced') add('Com preço de venda', 'priced');
  else add('Sem preço definido', 'unpriced');
  return wrap;
}
function buildOfferActions(model, info, manualDetails) {
  if (!info.supplierFree) return null;
  const wrap = document.createElement('div'); wrap.className = 'model-offer-actions';
  const free = document.createElement('button'); free.className = 'secondary'; free.type = 'button'; free.textContent = 'Oferecer grátis'; free.disabled = info.offer === 'free';
  free.addEventListener('click', async () => {
    free.disabled = true;
    try {
      const basis = model.billingType === 'request' ? 'per_request' : 'per_1m_tokens';
      const currency = model.pricing?.currency || 'USD';
      const price = basis === 'per_request' ? { basis, currency, request: '0' } : { basis, currency, input: '0', output: '0' };
      pricingConfig = await post('/admin/pricing', { scope: 'manual_model', provider: info.providerId, model: model.id, price });
      $('catalog-message').textContent = 'Modelo marcado como oferecido grátis; o preço zero passa a valer na estimativa por chave.'; renderCatalog();
    } catch (error) { $('catalog-message').textContent = error.message; free.disabled = false; }
  });
  const charge = document.createElement('button'); charge.className = 'secondary'; charge.type = 'button'; charge.textContent = 'Cobrar por uso';
  charge.addEventListener('click', () => { manualDetails.open = true; manualDetails.scrollIntoView({ block: 'nearest' }); manualDetails.querySelector('select, input')?.focus(); });
  wrap.append(free, charge);
  return wrap;
}
function buildModelParts(model) {
  const info = modelPricingInfo(model);
  const manualDetails = buildManualPricing(model, info.providerId, info.manual);
  return {
    head: buildModelHead(model),
    pricing: buildModelPricing(model),
    offer: buildOfferTag(model, info),
    sale: buildModelSale(model, info.multiplier, info.manual),
    usage: buildModelUsage(info.totals),
    priceForm: buildPriceForm(model, info.providerId, info.rule),
    manualDetails,
    offerActions: buildOfferActions(model, info, manualDetails),
    meta: buildModelMeta(model),
  };
}
function buildModelCard(parts) {
  const row = document.createElement('article'); row.className = 'model-card';
  row.append(parts.head, parts.pricing, parts.offer, parts.sale, parts.usage, parts.priceForm, parts.manualDetails, ...(parts.offerActions ? [parts.offerActions] : []), parts.meta);
  return row;
}
function buildModelRow(parts) {
  const row = document.createElement('article'); row.className = 'model-row';
  const identity = document.createElement('div'); identity.className = 'model-row-identity'; identity.append(parts.head, parts.meta);
  const pricing = document.createElement('div'); pricing.className = 'model-row-pricing'; pricing.append(parts.pricing, parts.offer, parts.sale);
  const usage = document.createElement('div'); usage.className = 'model-row-usage'; usage.append(parts.usage);
  const actions = document.createElement('div'); actions.className = 'model-row-actions'; actions.append(parts.priceForm, parts.manualDetails); if (parts.offerActions) actions.append(parts.offerActions);
  row.append(identity, pricing, usage, actions);
  return row;
}
function renderCatalog() {
  const list = $('catalog-list'); list.className = catalogView === 'list' ? 'model-list' : 'model-grid'; list.replaceChildren(); updateViewToggle();
  const query = $('catalog-search').value.trim().toLowerCase();
  const filter = $('catalog-state').value;
  const family = $('catalog-family').value;
  const offerFilter = $('catalog-offer').value;
  const items = catalog.map(model => ({ model, info: modelPricingInfo(model) }));
  renderOfferSummary(items);
  const visible = items.filter(({ model: m, info }) => `${m.id} ${m.name} ${m.family || ''}`.toLowerCase().includes(query) && (family === 'all' || m.family === family) && (filter === 'all' || (filter === 'enabled') === !!m.enabled) && offerMatches(info, offerFilter)).map(item => item.model);
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = query ? 'Nenhum modelo encontrado para esta busca.' : 'Nenhum modelo disponível nesta seleção.'; list.append(empty); return; }
  for (const model of visible) {
    const parts = buildModelParts(model);
    list.append(catalogView === 'list' ? buildModelRow(parts) : buildModelCard(parts));
  }
}
async function openCatalog(id) {
  currentConnection = id; const connection = connections.find(c => c.id === id);
  const result = await api(`/admin/connections/${id}/models`); catalog = result.models;
  catalogSource = 'connection'; $('catalog-title').textContent = providers.find(p => p.id === connection?.provider)?.name || 'Modelos';
  $('catalog-info').textContent = `${catalog.length} modelos · ${connection?.name} · ${statusText(connection?.status)}.`;
  $('catalog-message').textContent = connection?.status === 'valid' ? 'Catálogo informado pelo fornecedor. Preços e disponibilidade podem mudar.' : 'A autenticação desta chave ainda não foi comprovada; valide antes de habilitar modelos.';
  updateFamilies(); renderCatalog();
}
let connectTools = [];
const toolBaseUrl = () => `${apiBase || location.origin}/v1`;
function renderConnectTools() {
  const list = $('connect-list'); list.replaceChildren();
  const term = $('connect-search').value.trim().toLocaleLowerCase('pt-BR');
  const category = $('connect-category').value;
  const status = $('connect-status').value;
  const os = $('connect-os').value;
  const matches = connectTools.filter(tool =>
    (!term || `${tool.name} ${tool.category} ${tool.summary}`.toLocaleLowerCase('pt-BR').includes(term)) &&
    (category === 'all' || tool.category === category) &&
    (status === 'all' || tool.status === status) &&
    (os === 'all' || tool.os?.includes(os)));
  if (!matches.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma ferramenta corresponde aos filtros.'; list.append(empty); return; }
  for (const tool of matches) {
    const card = document.createElement('article'); card.className = 'tool-card';
    const head = document.createElement('div'); head.className = 'tool-head';
    const title = document.createElement('h2'); title.textContent = tool.name; head.append(title);
    const badge = document.createElement('span'); badge.className = `tool-badge ${tool.status === 'disponível' ? 'ok' : tool.status === 'planejado' ? 'later' : 'warn'}`; badge.textContent = tool.status; head.append(badge);
    const meta = document.createElement('p'); meta.className = 'muted'; meta.textContent = tool.category;
    const summary = document.createElement('p'); summary.textContent = tool.summary;
    const limits = document.createElement('p'); limits.className = 'muted'; limits.textContent = tool.limits;
    const platforms = document.createElement('p'); platforms.className = 'tool-platforms';
    for (const item of tool.os || []) { const chip = document.createElement('span'); chip.textContent = item; platforms.append(chip); }
    const stepsTitle = document.createElement('h3'); stepsTitle.textContent = 'Como conectar';
    const steps = document.createElement('ol'); steps.className = 'tool-steps';
    for (const step of tool.steps) { const li = document.createElement('li'); li.textContent = step; steps.append(li); }
    card.append(head, meta, summary, limits, platforms, stepsTitle, steps);
    for (const [label, snippet] of Object.entries(tool.snippets || {})) {
      const wrap = document.createElement('div'); wrap.className = 'tool-snippet';
      const caption = document.createElement('div'); caption.className = 'tool-snippet-head';
      const name = document.createElement('strong'); name.textContent = label;
      const copy = document.createElement('button'); copy.className = 'secondary'; copy.textContent = 'Copiar';
      const text = String(snippet).replaceAll('<BASE_URL>', toolBaseUrl());
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); $('connect-message').textContent = `${label}: copiado.`; }
        catch { $('connect-message').textContent = 'Não foi possível copiar automaticamente; selecione o texto manualmente.'; }
      });
      caption.append(name, copy);
      const code = document.createElement('pre'); code.textContent = text;
      wrap.append(caption, code); card.append(wrap);
    }
    const docs = document.createElement('a'); docs.className = 'tool-docs'; docs.href = tool.docs; docs.target = '_blank'; docs.rel = 'noopener noreferrer'; docs.textContent = 'Documentação oficial ↗';
    card.append(docs); list.append(card);
  }
}
async function loadConnectTools() {
  $('connect-base-url').textContent = toolBaseUrl();
  try {
    const response = await fetch('/connect-tools.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao carregar o catálogo (${response.status}).`);
    connectTools = await response.json();
    const select = $('connect-category'); const current = select.value; select.replaceChildren();
    const all = document.createElement('option'); all.value = 'all'; all.textContent = 'Todas'; select.append(all);
    for (const category of [...new Set(connectTools.map(tool => tool.category))].sort()) { const option = document.createElement('option'); option.textContent = category; select.append(option); }
    if ([...select.options].some(option => option.value === current)) select.value = current;
    renderConnectTools();
  } catch (error) { $('connect-message').textContent = error.message; }
}
function renderConnectReport(result) {
  const report = $('connect-report'); report.replaceChildren(); report.hidden = false;
  const head = document.createElement('div'); head.className = 'tool-head';
  const title = document.createElement('h2'); title.textContent = result.ok ? 'Gateway pronto para conexão' : 'Gateway com pendências';
  const badge = document.createElement('span'); badge.className = `tool-badge ${result.ok ? 'ok' : 'warn'}`; badge.textContent = result.ok ? 'sem pendências' : 'requer atenção';
  head.append(title, badge); report.append(head);
  const when = new Date(result.checkedAt);
  const note = document.createElement('p'); note.className = 'muted';
  note.textContent = `${result.scope}. Verificado em ${Number.isNaN(when.getTime()) ? 'data indisponível' : when.toLocaleString('pt-BR')}.`;
  report.append(note);
  const list = document.createElement('ul'); list.className = 'connect-checks';
  for (const check of result.checks) {
    const item = document.createElement('li'); item.className = check.ok ? 'ok' : 'fail';
    const mark = document.createElement('strong'); mark.textContent = check.ok ? '✓' : '!';
    const text = document.createElement('span'); text.textContent = `${check.label}: ${check.detail}`;
    item.append(mark, text); list.append(item);
  }
  report.append(list);
  const warning = document.createElement('p'); warning.className = 'muted';
  warning.textContent = 'Este teste não valida a ferramenta externa, a chave usada nela nem a compatibilidade do modelo. Não substitui a homologação documentada em cada cartão.';
  report.append(warning);
}
async function loadExtensionInfo() {
  const list = $('extension-list');
  try {
    const info = await api('/admin/extension/info');
    extensionFile = info.file;
    extensionAvailable = !!info.available;
    $('extension-version').textContent = `v${info.version}`;
    list.replaceChildren();
    for (const target of info.targets || []) {
      const row = document.createElement('div'); row.className = 'extension-row';
      const text = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = target.label;
      const detail = document.createElement('small'); detail.textContent = `${target.note} Instale com `;
      const command = document.createElement('code'); command.textContent = target.install;
      detail.append(command); text.append(name, detail);
      const button = document.createElement('button'); button.className = 'secondary';
      button.textContent = `Baixar ${info.file}`;
      button.disabled = !extensionAvailable;
      button.addEventListener('click', () => downloadExtension(button, target));
      row.append(text, button); list.append(row);
    }
    if (!extensionAvailable) $('extension-message').textContent = 'Pacote VSIX não disponível nesta instalação. Gere com npm --prefix extension run package.';
  } catch (error) {
    $('extension-version').textContent = 'v—';
    $('extension-message').textContent = error.message;
  }
}
async function downloadExtension(button, target) {
  const message = $('extension-message');
  button.disabled = true; message.textContent = `Preparando download para ${target.label}…`;
  try {
    const response = await fetch(apiUrl('/admin/extension'), { headers: { authorization: `Bearer ${adminKey}` } });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(typeof result.error === 'string' ? result.error : 'Não foi possível baixar a extensão.');
    }
    const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || extensionFile;
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    message.textContent = `Download iniciado: ${filename}. Instale com: ${target.install}`;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = !extensionAvailable;
  }
}
async function show() {
  const [routeResult, keyResult, connectionResult, providerResult, readinessResult, priceResult, usageResult, pendingResult, homeResult, planResult, ledgerResult, topupResult, systemResult, globalResult, modelResult, referralResult, userResult] = await Promise.all([api('/admin/routes'), api('/admin/keys'), api('/admin/connections'), api('/admin/connectors'), api('/admin/provider-readiness'), api('/admin/pricing'), api(`/admin/usage${usageQuery()}`), api(`/admin/usage/pending${pendingQuery()}`), api('/admin/dashboard'), api('/admin/plans'), api('/admin/ledger'), api('/admin/topup'), api('/admin/system'), api(`/admin/global-stats${globalQuery()}`), api(`/admin/model-analytics${globalQuery()}`), api('/admin/referrals'), api('/admin/users')]);
  pricingConfig = priceResult; $('default-multiplier').value = pricingConfig.defaultMultiplier;
  usageStats = usageResult;
  dashboardData = homeResult;
  plansData = planResult; ledgerData = ledgerResult; topupData = topupResult; usersData = userResult; clientKeysData = keyResult.keys || []; modelOptions = [...new Set(routeResult.routes.filter(route => route.enabled).map(route => route.id))];
  renderClientKeyPickers();
  if (!clientKeysData.some(key => key.id === statsKeyId)) statsKeyId = clientKeysData.find(key => key.active)?.id || clientKeysData[0]?.id || '';
  connections = connectionResult.connections; providers = providerResult.connectors; readinessData = readinessResult; selectProviders(); renderProviderTabs(); renderReadiness();
  renderDashboard(); renderPlans(); renderLedger(); renderTopup(); renderRouting(routeResult); renderPending(pendingResult); renderSystem(systemResult); renderGlobalStats(globalResult); renderModelAnalytics(modelResult); renderReferrals(referralResult); renderUsers();
  await refreshStats();
  await refreshClientHome();
  document.body.classList.remove('client-mode');
  $('login').hidden = true; $('dashboard').hidden = false;
  void loadExtensionInfo();
  void loadConnectTools();
  showPage(Object.keys(pagePaths).find(name => pagePaths[name] === location.pathname) || 'home', false);
  const connectionList = $('connections'); connectionList.replaceChildren();
  const routeSelect = $('route-connection'); const selected = routeSelect.value; routeSelect.replaceChildren();
  for (const c of connections) {
    const option = document.createElement('option'); option.value = c.id; option.textContent = `${c.name} · ${c.provider}`; routeSelect.append(option);
    const row = document.createElement('div'); row.className = 'connection';
    const label = document.createElement('p'); label.textContent = `${c.name} · ${c.provider} · ${c.active ? 'ativa' : 'desativada'} · ${statusText(c.status)} · ${c.modelCount} modelos`; row.append(label);
    const view = document.createElement('button'); view.className = 'secondary'; view.textContent = 'Ver modelos'; view.addEventListener('click', () => { showPage('models'); selectCatalogProvider(c.provider, c.id).catch(error => { $('catalog-message').textContent = error.message; }); });
    const refresh = document.createElement('button'); refresh.className = 'secondary'; refresh.textContent = 'Validar e atualizar'; refresh.addEventListener('click', async () => { refresh.disabled = true; try { await post(`/admin/connections/${c.id}/refresh`); await show(); showPage('models'); await selectCatalogProvider(c.provider, c.id); $('catalog-message').textContent = 'Conexão e catálogo atualizados.'; } catch (error) { $('provider-message').textContent = error.message; } finally { refresh.disabled = false; } });
    const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Editar'; edit.addEventListener('click', () => { showPage('providers'); editConnection(c); });
    const toggle = document.createElement('button'); toggle.className = 'secondary'; toggle.textContent = c.active ? 'Desativar' : 'Ativar'; toggle.addEventListener('click', async () => { try { await post(`/admin/connections/${c.id}/toggle`, { active: !c.active }); await show(); } catch (error) { $('provider-message').textContent = error.message; } });
    row.append(view, refresh, edit, toggle); connectionList.append(row);
  }
  if (connections.some(c => c.id === selected)) routeSelect.value = selected;
  const keys = $('key-list'); keys.replaceChildren();
  if (!keyResult.keys.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma chave criada.'; keys.append(empty); }
  for (const key of keyResult.keys) {
    const usage = key.usage || { requests: 0, inputTokens: 0, outputTokens: 0, spend: [], unpricedRequests: 0 };
    const row = document.createElement('div'); row.className = 'key-row';
    const limit = key.billing?.limits?.requests === null || key.billing?.limits?.requests === undefined ? '' : ` · cota ${key.billing.usage.requests}/${key.billing.limits.requests} req.`;
    const parent = key.parentId ? keyResult.keys.find(item => item.id === key.parentId)?.name || key.parentId.slice(0, 8) : null;
    const origin = parent ? ` · derivada de ${parent}` : ' · principal';
    const label = document.createElement('span'); label.textContent = `${key.name} · ${key.prefix}… · ${key.active ? 'ativa' : 'revogada'} · ${usage.requests} concluída(s)${limit}${origin}`;
    const planSelect = document.createElement('select'); fillPlanSelect(planSelect); planSelect.value = key.planId || '';
    planSelect.setAttribute('aria-label', `Plano da chave ${key.name}`);
    planSelect.addEventListener('change', async () => { planSelect.disabled = true; try { await post('/admin/keys/plan', { id: key.id, planId: planSelect.value || null }); await show(); } catch (error) { $('new-key').textContent = error.message; planSelect.value = key.planId || ''; planSelect.disabled = false; } });
    const tokens = document.createElement('span'); tokens.textContent = `${new Intl.NumberFormat('pt-BR').format(usage.inputTokens + usage.outputTokens)} (${new Intl.NumberFormat('pt-BR').format(usage.inputTokens)} + ${new Intl.NumberFormat('pt-BR').format(usage.outputTokens)})`;
    const spend = document.createElement('span');
    const cost = document.createElement('span'); cost.textContent = formatSpend(usage);
    const sale = document.createElement('small'); sale.textContent = formatSale(key.billing);
    spend.append(cost, sale);
    row.append(label, planSelect, tokens, spend);
    if (key.active) { const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Revogar'; button.addEventListener('click', async () => { try { await post('/admin/keys/revoke', { id: key.id }); await show(); } catch (error) { $('new-key').textContent = error.message; } }); row.append(button); }
    else row.append(document.createElement('span'));
    keys.append(row);
  }
  const list = $('route-list'); list.replaceChildren();
  const groups = new Map();
  for (const route of routeResult.routes) { if (!groups.has(route.id)) groups.set(route.id, []); groups.get(route.id).push(route); }
  for (const [id, destinations] of groups) {
    const group = document.createElement('div'); group.className = 'route-group';
    const title = document.createElement('strong'); title.textContent = id; group.append(title);
    for (const route of destinations.sort((a, b) => a.priority - b.priority)) {
      const row = document.createElement('div'); row.className = 'route'; const detail = document.createElement('small');
      const cooldown = route.cooldownUntil && Date.parse(route.cooldownUntil) > Date.now() ? ` · resfriado até ${new Date(route.cooldownUntil).toLocaleString('pt-BR')}` : '';
      detail.textContent = `${route.priority} · peso ${route.weight ?? 1} · ${route.provider} / ${route.upstreamModel} · ${connections.find(c => c.id === (route.connectionId || 'legacy-xkiro'))?.name || 'sem credencial'} · ${route.enabled ? 'Ativo' : 'Desativado'}${cooldown}`;
      const actions = document.createElement('div'); actions.className = 'route-actions';
      const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Editar'; edit.addEventListener('click', () => { $('route-destination-id').value = route.destinationId; $('route-id').value = route.id; $('route-id').readOnly = true; $('upstream-model').value = route.upstreamModel; $('route-connection').value = route.connectionId || 'legacy-xkiro'; $('route-priority').value = route.priority; $('route-weight').value = route.weight ?? 1; $('enabled').checked = route.enabled; $('upstream-model').focus(); });
      const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Remover'; remove.addEventListener('click', async () => { try { await api(`/admin/routes/${route.destinationId}`, { method: 'DELETE' }); $('route-message').textContent = 'Destino removido.'; await show(); } catch (error) { $('route-message').textContent = error.message; } });
      actions.append(edit, remove); row.append(detail, actions); group.append(row);
    }
    const actions = document.createElement('div'); actions.className = 'route-actions';
    const add = document.createElement('button'); add.className = 'secondary'; add.textContent = 'Adicionar destino'; add.addEventListener('click', () => { resetRoute(); $('route-id').value = id; $('upstream-model').focus(); });
    const rotate = document.createElement('button'); rotate.className = 'secondary'; rotate.textContent = 'Rotacionar'; rotate.addEventListener('click', async () => { try { await post('/admin/routes/rotate', { id }); $('route-message').textContent = 'Prioridades rotacionadas.'; await show(); } catch (error) { $('route-message').textContent = error.message; } });
    actions.append(add, rotate); group.append(actions); list.append(group);
  }
  renderRouteRelationships(routeResult);
  if (!currentProvider) await selectCatalogProvider(connections[0]?.provider || 'wusrouter');
}
$('login-form').addEventListener('submit', async e => { e.preventDefault(); adminKey = $('admin-key').value; $('login-error').textContent = ''; try { await show(); sessionStorage.setItem('anubis-admin', adminKey); $('admin-key').value = ''; } catch (error) { adminKey = ''; $('login-error').textContent = error.message; } });
$('provider-type').addEventListener('change', providerChanged);
$('catalog-search').addEventListener('input', renderCatalog);
$('catalog-state').addEventListener('change', renderCatalog);
$('catalog-family').addEventListener('change', renderCatalog);
$('catalog-offer').addEventListener('change', renderCatalog);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  catalogView = button.dataset.view === 'list' ? 'list' : 'cards';
  try { localStorage.setItem('anubis-catalog-view', catalogView); } catch { /* preferência não persistida */ }
  renderCatalog();
}));
updateViewToggle();
$('catalog-connection').addEventListener('change', e => selectCatalogProvider(currentProvider, e.target.value));
$('pricing-default-form').addEventListener('submit', async e => { e.preventDefault(); try { pricingConfig = await post('/admin/pricing', { scope: 'default', multiplier: $('default-multiplier').value }); $('pricing-default-message').textContent = 'Padrão salvo.'; renderCatalog(); } catch (error) { $('pricing-default-message').textContent = error.message; } });
$('ledger-reconcile').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try { const result = await post('/admin/ledger/reconcile'); $('ledger-message').textContent = `${result.added} lançamento(s) reconstruído(s) do histórico de uso.`; await show(); }
  catch (error) { $('ledger-message').textContent = error.message; e.currentTarget.disabled = false; }
});
document.querySelectorAll('.topup-presets [data-amount]').forEach(button => button.addEventListener('click', () => { $('topup-amount').value = button.dataset.amount; $('topup-message').textContent = ''; }));
$('topup-currency').addEventListener('input', () => { $('topup-currency').value = $('topup-currency').value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); });
$('topup-form').addEventListener('submit', async e => {
  e.preventDefault(); $('topup-message').textContent = ''; const button = e.submitter || e.target.querySelector('button.primary'); button.disabled = true;
  try {
    const keyId = $('topup-key').value;
    if (!clientKeysData.some(item => item.id === keyId && item.active !== false)) throw new Error('Selecione uma chave de cliente ativa.');
    const currency = $('topup-currency').value.trim().toUpperCase();
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await post('/admin/topup', { keyId, amount: $('topup-amount').value, currency, note: $('topup-note').value, idempotencyKey });
    $('topup-amount').value = ''; $('topup-note').value = '';
    const wallet = result.wallet;
    $('topup-message').textContent = `${result.duplicate ? 'Recarga já registrada' : 'Crédito simulado registrado'}: ${result.topup.currency} ${moneyText(result.topup.amount)}${wallet ? ` · saldo ${moneyText(wallet.balance)}` : ''}.`;
    await show();
  } catch (error) { $('topup-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('topup-create-plan').addEventListener('click', async e => {
  e.currentTarget.disabled = true; $('topup-plan-message').textContent = '';
  try {
    const existing = plansData.plans.find(plan => plan.kind === 'payg');
    if (existing) { $('topup-plan-message').textContent = `Já existe o plano PAYG “${existing.name}”. Use Planos e limites para ajustar modelos e moeda.`; return; }
    if (!modelOptions.length) throw new Error('Habilite ao menos um modelo em Rotas antes de criar o plano PAYG.');
    await post('/admin/plans', { name: 'PAYG · venda padrão', kind: 'payg', monthlyRequests: null, monthlyTokens: null, models: [...modelOptions], multiplier: null, currency: 'USD', active: true });
    await show(); $('topup-plan-message').textContent = 'Plano PAYG criado com os modelos habilitados. Atribua-o a uma chave em Chaves de acesso.';
  } catch (error) { $('topup-plan-message').textContent = error.message; }
  finally { e.currentTarget.disabled = false; }
});
document.querySelectorAll('[data-nav]').forEach(link => link.addEventListener('click', e => { if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; e.preventDefault(); showPage(link.dataset.nav); }));
window.addEventListener('popstate', () => showPage(Object.keys(pagePaths).find(name => pagePaths[name] === location.pathname) || 'home', false));
$('open-providers').addEventListener('click', () => showPage('providers'));
$('home-add-provider').addEventListener('click', () => showPage('providers'));
$('dashboard-refresh').addEventListener('click', async () => { try { await show(); $('account-message').textContent = 'Dados atualizados.'; } catch (error) { $('account-message').textContent = error.message; } });
$('usage-period-form').addEventListener('submit', async e => {
  e.preventDefault();
  const from = dateToIso($('usage-from').value);
  const to = dateToIso($('usage-to').value, true);
  if (from && to && Date.parse(from) >= Date.parse(to)) { $('usage-period-message').textContent = 'A data inicial deve ser anterior à final.'; return; }
  usagePeriod = { from, to }; $('usage-period-message').textContent = '';
  try { await show(); } catch (error) { $('usage-period-message').textContent = error.message; }
});
$('usage-period-clear').addEventListener('click', async () => {
  $('usage-from').value = ''; $('usage-to').value = ''; $('usage-show-resolved').checked = false;
  usagePeriod = { from: '', to: '' }; $('usage-period-message').textContent = '';
  try { await show(); } catch (error) { $('usage-period-message').textContent = error.message; }
});
$('usage-show-resolved').addEventListener('change', async () => { try { await show(); } catch (error) { $('usage-period-message').textContent = error.message; } });
$('stats-filter').addEventListener('submit', async e => {
  e.preventDefault();
  const from = dateToIso($('stats-from').value); const to = dateToIso($('stats-to').value, true);
  if (from && to && Date.parse(from) >= Date.parse(to)) { $('stats-message').textContent = 'A data inicial deve ser anterior à final.'; return; }
  statsPeriod = { from, to }; await refreshStats();
});
$('stats-clear').addEventListener('click', async () => { $('stats-from').value = ''; $('stats-to').value = ''; statsPeriod = { from: '', to: '' }; await refreshStats(); });
function syncGlobalPeriodInputs(from, to) {
  for (const id of ['global-from', 'global-detail-from', 'model-analytics-from']) $(id).value = from;
  for (const id of ['global-to', 'global-detail-to', 'model-analytics-to']) $(id).value = to;
}
async function applyGlobalPeriod(from, to, messageId) {
  const fromIso = dateToIso(from); const toIso = dateToIso(to, true);
  if (fromIso && toIso && Date.parse(fromIso) >= Date.parse(toIso)) { $(messageId).textContent = 'A data inicial deve ser anterior à final.'; return; }
  globalPeriod = { from: fromIso, to: toIso };
  syncGlobalPeriodInputs(from, to);
  $(messageId).textContent = '';
  await Promise.all([refreshGlobalStats(), refreshModelAnalytics()]);
}
async function clearGlobalPeriod() {
  globalPeriod = { from: '', to: '' }; syncGlobalPeriodInputs('', '');
  for (const id of ['global-message', 'global-detail-message', 'model-analytics-message']) $(id).textContent = '';
  await Promise.all([refreshGlobalStats(), refreshModelAnalytics()]);
}
$('global-filter').addEventListener('submit', async e => { e.preventDefault(); await applyGlobalPeriod($('global-from').value, $('global-to').value, 'global-message'); });
$('global-detail-filter').addEventListener('submit', async e => { e.preventDefault(); await applyGlobalPeriod($('global-detail-from').value, $('global-detail-to').value, 'global-detail-message'); });
$('global-clear').addEventListener('click', () => { void clearGlobalPeriod(); });
$('global-detail-clear').addEventListener('click', () => { void clearGlobalPeriod(); });
$('global-refresh').addEventListener('click', () => { void refreshGlobalStats(); });
$('global-detail-refresh').addEventListener('click', () => { void refreshGlobalStats(); });
$('model-analytics-filter').addEventListener('submit', async e => { e.preventDefault(); await applyGlobalPeriod($('model-analytics-from').value, $('model-analytics-to').value, 'model-analytics-message'); });
$('model-analytics-clear').addEventListener('click', () => { void clearGlobalPeriod(); });
$('model-analytics-refresh').addEventListener('click', () => { void refreshModelAnalytics(); });
$('model-analytics-close').addEventListener('click', () => { selectedAnalyticsModel = ''; modelDetailRequest++; $('model-analytics-detail').hidden = true; });
$('stats-key').addEventListener('change', async e => { statsKeyId = e.target.value; await refreshStats(); await refreshClientHome(); });
$('stats-refresh').addEventListener('click', async () => { await refreshStats(); });
$('client-home-key').addEventListener('change', async e => { statsKeyId = e.target.value; await refreshClientHome(); await refreshStats(); });
$('client-home-refresh').addEventListener('click', async () => { await refreshClientHome(); });
$('client-topup').addEventListener('click', () => { if ($('topup-key') && statsKeyId) $('topup-key').value = statsKeyId; showPage('topup'); });
$('client-open-chat').addEventListener('click', () => showPage('chat'));
$('client-open-account').addEventListener('click', () => showPage('client-area'));
$('system-refresh').addEventListener('click', async () => { await refreshSystem(); });
$('retention-form').addEventListener('submit', async e => {
  e.preventDefault(); $('retention-message').textContent = '';
  const button = e.submitter || e.target.querySelector('button'); button.disabled = true;
  try {
    const result = await post('/admin/usage/retention', { retentionHours: $('retention-hours').value.trim() || null });
    $('retention-message').textContent = result.retentionHours === null
      ? `Limpeza automática desativada. ${systemCount(result.deleted)} registro(s) removido(s) nesta operação.`
      : `Retenção de ${result.retentionHours} hora(s) salva. ${systemCount(result.deleted)} registro(s) removido(s) nesta operação.`;
    await refreshSystem();
  } catch (error) { $('retention-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('account-connection').addEventListener('change', e => fillAccount(e.target.value));
$('account-form').addEventListener('submit', async e => {
  e.preventDefault(); $('account-message').textContent = '';
  try {
    const end = $('account-end').value;
    await post('/admin/provider-accounts', { connectionId: $('account-connection').value, plan: $('account-plan').value, billingMode: $('account-mode').value, currency: $('account-currency').value, balance: $('account-balance').value.trim().replace(',', '.'), spent: $('account-spent').value.trim().replace(',', '.'), freeEndsAt: end ? new Date(end).toISOString() : '', dailyTokens: $('account-daily-tokens').value.trim(), backup: $('account-backup').checked, resetAnchor: $('account-reset').checked });
    await show(); fillAccount($('account-connection').value); $('account-message').textContent = 'Informações salvas.';
  } catch (error) { $('account-message').textContent = error.message; }
});
$('refresh-current').addEventListener('click', async () => { try { if (currentConnection) await post(`/admin/connections/${currentConnection}/refresh`); await show(); await selectCatalogProvider(currentProvider, currentConnection || ''); } catch (error) { $('catalog-message').textContent = error.message; } });
$('readiness-provider').addEventListener('change', fillReadiness);
$('readiness-form').addEventListener('submit', async e => {
  e.preventDefault(); $('readiness-message').textContent = '';
  try {
    await post('/admin/provider-readiness', {
      providerId: $('readiness-provider').value,
      status: $('readiness-status').value,
      resaleConfirmed: $('readiness-resale').checked,
      resaleEvidence: $('readiness-evidence').value,
      jurisdiction: $('readiness-jurisdiction').value,
      reviewedAt: $('readiness-reviewed').value,
      owner: $('readiness-owner').value,
      sla: $('readiness-sla').value,
      note: $('readiness-note').value,
    });
    await show(); $('readiness-message').textContent = 'Homologação registrada. Isso não autoriza venda real.';
  } catch (error) { $('readiness-message').textContent = error.message; }
});
$('readiness-policy-form').addEventListener('submit', async e => {
  e.preventDefault(); $('readiness-policy-message').textContent = '';
  try { await post('/admin/provider-readiness', { enforceResale: $('readiness-enforce').checked }); await show(); $('readiness-policy-message').textContent = 'Política atualizada.'; }
  catch (error) { $('readiness-policy-message').textContent = error.message; }
});
$('provider-form').addEventListener('submit', async e => {
  e.preventDefault(); $('provider-message').textContent = editingConnectionId ? 'Validando alterações e consultando catálogo…' : 'Validando conexão e consultando catálogo…'; $('provider-submit').disabled = true;
  const data = { name: $('provider-name').value, key: $('provider-key').value, base: $('provider-base').value, validationPath: $('validation-path').value };
  try {
    let result;
    if (editingConnectionId) { data.provider = $('provider-type').value; result = await api(`/admin/connections/${editingConnectionId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); }
    else { data.provider = $('provider-type').value; result = await post('/admin/connections', data); }
    const wasEditing = !!editingConnectionId;
    $('provider-key').value = ''; $('provider-message').textContent = `${wasEditing ? 'Conexão alterada' : 'Conexão salva'}: ${statusText(result.connection.status)}.`;
    resetProviderForm(); await show();
    if (!wasEditing) { showPage('models'); await selectCatalogProvider(result.connection.provider, result.connection.id); }
  }
  catch (error) { $('provider-message').textContent = error.message; } finally { $('provider-submit').disabled = false; }
});
$('provider-cancel').addEventListener('click', () => { resetProviderForm(); $('provider-message').textContent = 'Edição cancelada.'; });
$('key-form').addEventListener('submit', async e => { e.preventDefault(); $('new-key').textContent = ''; try { const result = await post('/admin/keys', { name: $('key-name').value, planId: $('key-plan').value || null }); $('new-key').textContent = `Copie agora; não será exibida novamente: ${result.key}`; $('key-name').value = ''; await show(); } catch (error) { $('new-key').textContent = error.message; } });
$('plan-new').addEventListener('click', resetPlanForm);
$('plan-form').addEventListener('submit', async e => {
  e.preventDefault(); $('plan-message').textContent = ''; $('plan-submit').disabled = true;
  const id = $('plan-id').value;
  const plan = {
    ...(id ? { id } : {}), name: $('plan-name').value.trim(), kind: $('plan-kind').value,
    monthlyRequests: $('plan-requests').value.trim(), monthlyTokens: $('plan-tokens').value.trim(),
    dailyRequests: $('plan-daily-requests').value.trim(), dailyTokens: $('plan-daily-tokens').value.trim(),
    models: [...$('plan-models').selectedOptions].map(item => item.value),
    multiplier: $('plan-multiplier').value.trim(), currency: $('plan-currency').value.trim().toUpperCase(), active: $('plan-active').checked, selfService: $('plan-self-service').checked,
  };
  try { await post('/admin/plans', plan); await show(); resetPlanForm(); $('plan-message').textContent = 'Plano salvo. Limites e modelos valem para novas chamadas.'; }
  catch (error) { $('plan-message').textContent = error.message; }
  finally { $('plan-submit').disabled = false; }
});
for (const id of ['connect-search', 'connect-category', 'connect-status', 'connect-os']) $(id).addEventListener('input', renderConnectTools);
$('connect-test').addEventListener('click', async () => {
  const button = $('connect-test'); const report = $('connect-report');
  button.disabled = true; report.hidden = false; report.textContent = 'Testando o gateway…';
  try { renderConnectReport(await post('/admin/connect/diagnose')); }
  catch (error) { report.replaceChildren(); report.textContent = error.message; }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', () => { clearClientSession(true); sessionStorage.removeItem('anubis-admin'); adminKey = ''; usagePeriod = { from: '', to: '' }; statsPeriod = { from: '', to: '' }; globalPeriod = { from: '', to: '' }; statsKeyId = ''; clientHomeData = null; globalStatsData = null; modelAnalyticsData = null; selectedAnalyticsModel = ''; modelDetailRequest++; $('usage-from').value = ''; $('usage-to').value = ''; $('stats-from').value = ''; $('stats-to').value = ''; $('global-from').value = ''; $('global-to').value = ''; $('model-analytics-from').value = ''; $('model-analytics-to').value = ''; $('stats-message').textContent = ''; $('global-message').textContent = ''; $('model-analytics-message').textContent = ''; $('model-analytics-detail').hidden = true; $('model-analytics-list').replaceChildren(); $('model-analytics-users').replaceChildren(); $('client-home-message').textContent = ''; $('usage-show-resolved').checked = false; $('new-key').textContent = ''; $('provider-key').value = ''; editingConnectionId = ''; $('provider-form-title').textContent = 'Adicionar credencial'; $('provider-submit').textContent = 'Validar e salvar'; $('provider-cancel').hidden = true; $('extension-version').textContent = 'v—'; $('extension-message').textContent = ''; $('extension-list').replaceChildren(); $('connect-message').textContent = ''; $('connect-report').replaceChildren(); $('connect-report').hidden = true; extensionAvailable = false; document.body.classList.remove('client-mode'); $('dashboard').hidden = true; $('login').hidden = false; currentProvider = null; currentConnection = null; catalog = []; });
function renderPending(report) {
  const summary = report?.summary || {};
  const labels = { sem_desfecho: 'sem desfecho', falha_transporte: 'falha de transporte', erro_sem_status: 'erro sem status' };
  const reasons = Object.entries(summary.byReason || {}).filter(([, count]) => count > 0).map(([reason, count]) => `${labels[reason] || reason}: ${count}`).join(' · ');
  $('usage-pending-summary').textContent = `${summary.unresolved || 0} pendente(s) · ${summary.resolved || 0} conciliada(s) · ${summary.requests || 0} requisição(ões)${reasons ? ` · ${reasons}` : ''}`;
  const list = $('usage-pending-list'); list.replaceChildren();
  for (const item of report?.items || []) {
    const row = document.createElement('div'); row.className = 'pending-row';
    const detail = document.createElement('div');
    const when = item.startedAt ? new Date(item.startedAt).toLocaleString('pt-BR') : 'sem data';
    const cost = item.costSnapshot?.request ? ` · custo capturado ${item.costSnapshot.currency || ''} ${item.costSnapshot.request}`.trim() : '';
    detail.textContent = `${when} · ${item.publicModel || 'modelo?'} → ${item.upstreamModel || 'destino?'} · tentativa ${item.attempt ?? '?'} · ${labels[item.reason] || item.reason} · ${item.status}${item.httpStatus ? ` · HTTP ${item.httpStatus}` : ''}${cost}${item.reconciliation ? ` · conciliado: ${item.reconciliation.outcome}` : ''}`;
    const actions = document.createElement('div'); actions.className = 'route-actions';
    if (!item.reconciliation) {
      const confirm = document.createElement('button'); confirm.className = 'secondary'; confirm.textContent = 'Confirmar sem custo';
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        try { await post('/admin/usage/reconcile', { recordId: item.id, outcome: 'no_cost', note: 'sem custo confirmado no painel' }); $('usage-period-message').textContent = 'Conferência registrada localmente.'; await show(); }
        catch (error) { $('usage-period-message').textContent = error.message; confirm.disabled = false; }
      });
      actions.append(confirm);
    }
    row.append(detail, actions); list.append(row);
  }
  if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma tentativa pendente no período.'; list.append(empty); }
}
const statsLabels = { completed: 'Concluídas', failed: 'Falhas', cancelled: 'Canceladas', pending: 'Pendentes' };
const statsCount = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
function statsAmounts(items) {
  if (!Array.isArray(items) || !items.length) return '—';
  return items.map(item => `${item.currency} ${moneyText(item.amount)}`).join(' · ');
}
function statsMarginPercents(items) {
  if (!Array.isArray(items) || !items.length) return '—';
  return items.map(item => `${item.currency} ${item.marginPercent === null || item.marginPercent === undefined ? '—' : `${moneyText(item.marginPercent)}%`}`).join(' · ');
}
function statsMargins(items) {
  if (!Array.isArray(items) || !items.length) return '—';
  return items.map(item => `${item.currency} ${item.marginPercent === null || item.marginPercent === undefined ? '—' : `${moneyText(item.marginPercent)}%`} (${moneyText(item.amount)})`).join(' · ');
}
function analyticsUtc(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function statsLevel(value, peak) {
  if (!value || !peak) return 0;
  return Math.max(1, Math.min(10, Math.ceil(value / peak * 10)));
}
function renderStatsTable(target, rows, nameKey) {
  target.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 4; td.className = 'muted'; td.textContent = 'Nenhum dado no período.'; tr.append(td); target.append(tr); return;
  }
  for (const item of rows) {
    const tr = document.createElement('tr');
    for (const text of [item[nameKey] || '—', statsCount(item.requests), statsCount(item.tokens), statsAmounts(item.spend)]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    target.append(tr);
  }
}
function renderStatsChart(series) {
  const chart = $('stats-chart'); chart.replaceChildren();
  if (!series.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhum dia no período.'; chart.append(empty); return; }
  const peak = Math.max(1, ...series.map(item => item.completed + item.failed + item.cancelled + item.pending));
  for (const item of series) {
    const column = document.createElement('div'); column.className = 'stats-day';
    const bar = document.createElement('div'); bar.className = 'stats-bar';
    bar.title = `${item.date}: ${statsCount(item.requests)} requisições, ${statsCount(item.tokens)} tokens, ${statsAmounts(item.spend)}`;
    for (const [key, label] of Object.entries(statsLabels)) {
      const segment = document.createElement('span');
      segment.className = `seg-${key} level-${statsLevel(item[key], peak)}`;
      segment.title = `${label}: ${statsCount(item[key])}`;
      bar.append(segment);
    }
    const caption = document.createElement('small'); caption.textContent = item.date.slice(5).replace('-', '/');
    column.append(bar, caption); chart.append(column);
  }
}
function renderStatsStatus(report) {
  const target = $('stats-status'); target.replaceChildren();
  const counts = report.byStatus || {};
  const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  for (const [key, label] of Object.entries(statsLabels)) {
    const value = counts[key] || 0;
    const line = document.createElement('div'); line.className = 'stats-status-line';
    const head = document.createElement('div'); head.className = 'stats-status-head';
    const name = document.createElement('span'); name.textContent = label;
    const amount = document.createElement('span'); amount.textContent = `${statsCount(value)} · ${total ? Math.round(value * 100 / total) : 0}%`;
    head.append(name, amount);
    const bar = document.createElement('div'); bar.className = 'stats-status-bar';
    const fill = document.createElement('span'); fill.className = `level-${statsLevel(value, total || 1)}`;
    bar.append(fill); line.append(head, bar); target.append(line);
  }
}
function requestTokens(item) {
  const tokens = item?.tokens || {};
  return statsCount((Number(tokens.inputTokens) || 0) + (Number(tokens.outputTokens) || 0));
}
function renderRequestDetails(report) {
  const target = $('stats-requests'); target.replaceChildren();
  const requests = report.requests || [];
  if (!requests.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma requisição no período.'; target.append(empty); $('stats-details-note').textContent = ''; return; }
  const utc = value => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  for (const item of requests) {
    const details = document.createElement('details'); details.className = 'request-details';
    const summary = document.createElement('summary'); summary.className = 'request-summary';
    summary.textContent = `${utc(item.startedAt)} · ${statsLabels[item.status] || item.status || '—'} · ${item.model || 'modelo'} · ${requestTokens(item)} tokens · ${item.requestId || 'sem ID'}`;
    const info = document.createElement('div'); info.className = 'request-info';
    const billing = item.billing || {};
    const billingText = `Lançamento: ${billing.status || '—'}${billing.sale !== null && billing.sale !== undefined ? ` · ${billing.currency || ''} ${billing.sale}` : ''}${billing.cost !== null && billing.cost !== undefined ? ` · custo ${billing.cost}` : ''}`;
    info.textContent = `${billingText} · fornecedor: ${item.provider || '—'} · conexão: ${item.connectionId || '—'} · endpoint: ${item.endpoint || '—'} · duração: ${item.durationMs === null || item.durationMs === undefined ? '—' : `${item.durationMs} ms`}`;
    const attempts = document.createElement('div'); attempts.className = 'request-attempts';
    for (const attempt of item.attempts || []) {
      const line = document.createElement('div'); line.className = 'request-attempt';
      line.textContent = `Tentativa ${attempt.attempt ?? '—'} · ${statsLabels[attempt.status] || attempt.status || '—'}${attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ''} · ${utc(attempt.startedAt)} → ${utc(attempt.finishedAt)} · ${attempt.tokens ? `${statsCount((Number(attempt.tokens.inputTokens) || 0) + (Number(attempt.tokens.outputTokens) || 0))} tokens` : 'sem tokens'}${attempt.model ? ` · ${attempt.model}` : ''}`;
      attempts.append(line);
    }
    details.append(summary, info, attempts); target.append(details);
  }
  $('stats-details-note').textContent = report.detailsTruncated ? 'Mostrando apenas as 200 requisições mais recentes do período.' : `${statsCount(requests.length)} requisição(ões) detalhada(s).`;
}
function renderStats(report) {
  const ids = ['stats-total-requests', 'stats-total-completed', 'stats-total-tokens', 'stats-total-spend', 'stats-unpriced', 'stats-period-summary', 'stats-key-mask'];
  if (!report) {
    for (const id of ids) $(id).textContent = '—';
    $('stats-chart').replaceChildren(); $('stats-status').replaceChildren(); $('stats-requests').replaceChildren(); $('stats-details-note').textContent = '';
    renderStatsTable($('stats-models'), [], 'model'); renderStatsTable($('stats-providers'), [], 'provider');
    return;
  }
  const utc = value => new Date(value).toLocaleString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('stats-total-requests').textContent = statsCount(report.totals.requests);
  $('stats-total-completed').textContent = `${statsCount(report.totals.completed)} concluídas`;
  $('stats-total-tokens').textContent = statsCount(report.totals.tokens);
  $('stats-total-spend').textContent = statsAmounts(report.totals.spend);
  $('stats-unpriced').textContent = statsCount(report.totals.unpriced);
  $('stats-period-summary').textContent = `${utc(report.period.from)} → ${utc(report.period.to)} (UTC)${report.period.clamped ? ' · período limitado a 366 dias' : ''}`;
  $('stats-key-mask').textContent = report.account.label;
  renderStatsChart(report.series || []); renderStatsStatus(report); renderRequestDetails(report);
  renderStatsTable($('stats-models'), report.byModel || [], 'model');
  renderStatsTable($('stats-providers'), report.byProvider || [], 'provider');
}
function fillStatsKeySelect() {
  for (const select of [$('stats-key'), $('client-home-key')]) {
    const selected = statsKeyId; select.replaceChildren();
    if (!clientKeysData.length) { select.append(selectOption('', 'Nenhuma chave cadastrada')); continue; }
    for (const key of clientKeysData) select.append(selectOption(key.id, `${key.name} · ${key.prefix}${key.active ? '' : ' · revogada'}`));
    if ([...select.options].some(item => item.value === selected)) select.value = selected;
  }
}
async function refreshStats() {
  fillStatsKeySelect(); $('stats-message').textContent = '';
  if (!statsKeyId) { renderStats(null); $('stats-message').textContent = 'Crie uma chave de cliente para ver estatísticas.'; return; }
  try { renderStats(await api(`/admin/client-stats${statsQuery()}`)); }
  catch (error) { renderStats(null); $('stats-message').textContent = error.message; }
}
function globalRows(target, rows, emptySpan = 5) {
  target.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = emptySpan; td.className = 'muted'; td.textContent = 'Nenhum dado no período.'; tr.append(td); target.append(tr); return;
  }
  for (const cells of rows) {
    const tr = document.createElement('tr');
    for (const [index, value] of cells.entries()) {
      const td = document.createElement('td'); td.textContent = String(value ?? '—');
      if (index > 0) td.className = 'global-number';
      tr.append(td);
    }
    target.append(tr);
  }
}
function analyticsDefinition(term, value) {
  const wrap = document.createElement('div');
  const dt = document.createElement('dt'); dt.textContent = term;
  const dd = document.createElement('dd'); dd.textContent = value ?? '—';
  wrap.append(dt, dd); return wrap;
}
function renderModelAnalyticsDetail(model) {
  if (!model) return;
  $('model-analytics-detail').hidden = false;
  const title = model.label && model.label !== model.model ? `${model.label} · ${model.model}` : model.model || 'Modelo';
  $('model-analytics-detail-title').textContent = title;
  const payers = (model.users || []).filter(user => Array.isArray(user.spend) && user.spend.length);
  $('model-analytics-detail-summary').textContent = `${statsCount(model.requests)} concluída(s) · ${statsCount(payers.length)} chave(s) com gasto liquidado · ${statsCount(model.unpriced)} sem valor liquidado · lucro total ${statsAmounts(model.profit)}`;
  $('model-analytics-detail-message').textContent = '';
  const admin = $('model-analytics-admin'); admin.replaceChildren();
  const period = modelAnalyticsData?.period || {};
  const add = (term, value) => admin.append(analyticsDefinition(term, value));
  add('Aliases', (model.aliases || []).join(', ') || '—');
  add('Fornecedores', (model.providers || []).join(', ') || '—');
  add('Modelos de origem', (model.upstreamModels || []).join(', ') || '—');
  add('Rotas locais', `${statsCount(model.enabledRoutes)} ativa(s) de ${statsCount(model.routes)}`);
  add('Período', period.from && period.to ? `${period.from} → ${period.to}` : '—');
  add('Escopo', modelAnalyticsData?.scope || '—');
  add('Admin', modelAnalyticsData?.admin ? `${modelAnalyticsData.admin.configured ? 'chave configurada' : 'sem chave'} · ${statsCount(modelAnalyticsData.admin.clientSessions)} sessão(ões) · ${statsCount(modelAnalyticsData.admin.keys)} chave(s), ${statsCount(modelAnalyticsData.admin.activeKeys)} ativa(s)` : '—');
  add('Gerado em', modelAnalyticsData?.generatedAt || '—');
  globalRows($('model-analytics-users'), payers.map(user => [
    `${user.name || 'Chave removida'} · ${user.label || '—'}`,
    user.planName || 'Sem plano',
    statsCount(user.requests),
    statsAmounts(user.spend),
    statsAmounts(user.profit),
    statsMargins(user.margin),
  ]), 6);
  if (!payers.length) $('model-analytics-users').querySelector('td').textContent = 'Nenhum usuário com gasto liquidado no período.';
}
async function openModelAnalytics(model) {
  selectedAnalyticsModel = model;
  const request = ++modelDetailRequest;
  $('model-analytics-detail').hidden = false;
  $('model-analytics-detail-title').textContent = model;
  $('model-analytics-detail-message').textContent = 'Carregando detalhe...';
  $('model-analytics-admin').replaceChildren();
  globalRows($('model-analytics-users'), [], 6);
  try {
    const report = await api(`/admin/model-analytics${modelAnalyticsQuery(model)}`);
    if (request !== modelDetailRequest) return;
    if (report?.error) { $('model-analytics-detail-message').textContent = report.error; return; }
    renderModelAnalyticsDetail(report.model);
  } catch (error) {
    if (request !== modelDetailRequest) return;
    $('model-analytics-detail-message').textContent = error.message;
  }
}
function renderModelAnalytics(report) {
  modelAnalyticsData = report;
  const detail = $('model-analytics-detail');
  if (!report) {
    for (const id of ['model-analytics-spend', 'model-analytics-profit', 'model-analytics-margin', 'model-analytics-models-count', 'model-analytics-scope', 'model-analytics-period-summary']) $(id).textContent = '—';
    $('model-analytics-list').replaceChildren(); detail.hidden = true; return;
  }
  $('model-analytics-spend').textContent = statsAmounts(report.totals?.spend);
  $('model-analytics-profit').textContent = statsAmounts(report.totals?.profit);
  $('model-analytics-margin').textContent = statsMarginPercents(report.totals?.margin);
  $('model-analytics-models-count').textContent = `${statsCount(report.models?.length)} modelo(s) observado(s)`;
  $('model-analytics-scope').textContent = report.scope === 'last_10000_requests' ? '10.000' : report.scope || '—';
  $('model-analytics-period-summary').textContent = `Período ${report.period?.from} → ${report.period?.to}${report.period?.clamped ? ' (limitado a 366 dias)' : ''}${report.totals?.unpriced ? ` · ${statsCount(report.totals.unpriced)} conclusão(ões) sem valor liquidado` : ''} · gerado em ${report.generatedAt}`;
  const models = report.models || [];
  const list = $('model-analytics-list'); list.replaceChildren();
  if (!models.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 6; td.className = 'muted'; td.textContent = 'Nenhum modelo com uso concluído no período.'; tr.append(td); list.append(tr);
    selectedAnalyticsModel = ''; modelDetailRequest++; detail.hidden = true; return;
  }
  if (selectedAnalyticsModel && !models.some(item => item.model === selectedAnalyticsModel)) {
    selectedAnalyticsModel = ''; modelDetailRequest++; detail.hidden = true;
  }
  for (const item of models) {
    const tr = document.createElement('tr');
    const modelCell = document.createElement('td');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'model-analytics-model'; button.textContent = item.label || item.model;
    button.setAttribute('aria-label', `Ver detalhes financeiros de ${item.model}`);
    button.addEventListener('click', () => { void openModelAnalytics(item.model); });
    modelCell.append(button);
    if (item.label && item.label !== item.model) { const id = document.createElement('small'); id.className = 'model-analytics-id'; id.textContent = item.model; modelCell.append(id); }
    tr.append(modelCell);
    for (const value of [statsCount(item.requests), statsAmounts(item.spend), statsAmounts(item.profit), statsMargins(item.margin), analyticsUtc(item.lastAt)]) {
      const td = document.createElement('td'); td.className = 'global-number'; td.textContent = value; tr.append(td);
    }
    list.append(tr);
  }
  if (selectedAnalyticsModel) void openModelAnalytics(selectedAnalyticsModel);
}
async function refreshModelAnalytics() {
  $('model-analytics-message').textContent = '';
  try { renderModelAnalytics(await api(`/admin/model-analytics${globalQuery()}`)); }
  catch (error) { renderModelAnalytics(null); $('model-analytics-message').textContent = error.message; }
}
function renderGlobalStats(report) {
  globalStatsData = report;
  const ids = ['global-admins', 'global-admin-sessions', 'global-users-total', 'global-users-active', 'global-keys-active', 'global-keys-total', 'global-requests', 'global-observed', 'global-tokens', 'global-profit', 'global-failure-rate', 'global-failures-count', 'global-spend', 'global-cost', 'global-period-summary', 'global-detail-period-summary'];
  if (!report) {
    for (const id of ids) $(id).textContent = '—';
    $('global-status').replaceChildren();
    for (const id of ['global-keys', 'global-models', 'global-providers', 'global-wallets', 'global-plans']) globalRows($(id), []);
    globalRows($('global-failures'), [], 7);
    return;
  }
  $('global-admins').textContent = report.admin?.configured ? '1' : '0';
  $('global-admin-sessions').textContent = `Chave configurada · ${statsCount(report.admin?.clientSessions)} sessão(ões) de cliente`;
  $('global-users-total').textContent = statsCount(report.users?.total);
  $('global-users-active').textContent = `${statsCount(report.users?.activeInPeriod)} ativo(s) no período`;
  $('global-keys-active').textContent = statsCount(report.keys?.active);
  $('global-keys-total').textContent = `${statsCount(report.keys?.total)} cadastrada(s) · ${statsCount(report.keys?.revoked)} revogada(s)`;
  $('global-requests').textContent = statsCount(report.totals?.requests);
  $('global-observed').textContent = `${statsCount(report.totals?.observed)} requisição(ões) observada(s)`;
  $('global-tokens').textContent = statsCount(report.totals?.tokens);
  $('global-profit').textContent = statsAmounts(report.totals?.profit);
  $('global-failure-rate').textContent = `${statsCount(report.failureRate)}%`;
  $('global-failures-count').textContent = `${statsCount(report.failures?.attempts)} tentativa(s) · ${statsCount(report.failures?.requests)} requisição(ões)`;
  $('global-spend').textContent = statsAmounts(report.totals?.spend);
  $('global-cost').textContent = `Custo: ${statsAmounts(report.totals?.cost)}${report.totals?.unpriced ? ` · ${statsCount(report.totals.unpriced)} sem preço` : ''}`;
  const periodText = `Período ${report.period?.from} → ${report.period?.to}${report.period?.clamped ? ' (limitado a 366 dias)' : ''} · até 10.000 requisições · gerado em ${report.generatedAt}`;
  $('global-period-summary').textContent = periodText;
  $('global-detail-period-summary').textContent = periodText;
  const status = $('global-status'); status.replaceChildren();
  const counts = report.byStatus || {};
  const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  for (const [key, label] of Object.entries(statsLabels)) {
    const value = counts[key] || 0;
    const line = document.createElement('div'); line.className = 'stats-status-line';
    const head = document.createElement('div'); head.className = 'stats-status-head';
    const name = document.createElement('span'); name.textContent = label;
    const amount = document.createElement('span'); amount.textContent = `${statsCount(value)} · ${total ? Math.round(value * 100 / total) : 0}%`;
    const bar = document.createElement('div'); bar.className = 'stats-status-bar';
    const fill = document.createElement('span'); fill.className = `level-${statsLevel(value, total || 1)}`;
    bar.append(fill); head.append(name, amount); line.append(head, bar); status.append(line);
  }
  globalRows($('global-failures'), (report.failures?.recent || []).map(item => [
    item.at ? new Date(item.at).toLocaleString('pt-BR', { timeZone: 'UTC' }) : '—',
    item.requestId || '—',
    item.attempt ?? '—',
    item.model || '—',
    item.provider || '—',
    item.httpStatus ?? '—',
    `${item.reason}${item.retryable ? ' · tentou outra rota' : ''}`,
  ]), 7);
  globalRows($('global-keys'), (report.keys?.top || []).map(item => [item.label, item.active ? 'ativa' : 'revogada', statsCount(item.requests), statsCount(item.tokens), `${statsAmounts(item.spend)} · ${statsAmounts(item.cost)}`]));
  globalRows($('global-models'), (report.models || []).map(item => [item.id, statsCount(item.requests), statsCount(item.tokens), `${statsAmounts(item.spend)} · ${statsAmounts(item.cost)}`]));
  globalRows($('global-providers'), (report.connections?.byProvider || []).map(item => [item.id, statsCount(item.connections), statsCount(item.requests), `${statsAmounts(item.spend)} · ${statsAmounts(item.cost)}`]));
  globalRows($('global-wallets'), (report.wallets?.byCurrency || []).map(item => [item.currency, statsCount(item.keys), item.credits, item.consumed, item.balance]));
  globalRows($('global-plans'), (report.plans || []).map(item => [item.name, item.kind, statsCount(item.keys), item.active ? 'ativo' : 'inativo']));
}
async function refreshGlobalStats() {
  $('global-message').textContent = ''; $('global-detail-message').textContent = '';
  try { renderGlobalStats(await api(`/admin/global-stats${globalQuery()}`)); }
  catch (error) { renderGlobalStats(null); $('global-message').textContent = error.message; $('global-detail-message').textContent = error.message; }
}
const clientInteger = new Intl.NumberFormat('pt-BR');
const clientDecimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
const clientShort = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const clientStatusLabels = { settled: 'Liquidado', pending: 'Pendente', unpriced: 'Sem valor', failed: 'Falha', cancelled: 'Cancelada' };
const clientKindLabels = { free: 'Gratuito', paid: 'Pago', payg: 'PAYG' };
function clientAmounts(items) {
  if (!Array.isArray(items) || !items.length) return '—';
  return items.map(item => `${item.currency} ${clientDecimal.format(Number(item.amount) || 0)}`).join(' · ');
}
function clientCompact(value) {
  if (!Number.isSafeInteger(value)) return '—';
  if (value >= 1e6) return `${clientShort.format(value / 1e6)}M`;
  if (value >= 1e3) return `${clientShort.format(value / 1e3)}K`;
  return clientInteger.format(value);
}
function clientWhen(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function clientAgo(value) {
  if (!value) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)} h`;
  return `há ${Math.floor(minutes / 1440)} d`;
}
function clientCell(row, text, className) {
  const td = document.createElement('td'); td.textContent = text;
  if (className) td.className = className; row.append(td); return td;
}
function renderClientHome(data) {
  clientHomeData = data;
  const ids = ['client-balance', 'client-wallet-meta', 'client-spend-30', 'client-requests-30', 'client-tokens-30', 'client-avg-7', 'client-plan-kind', 'client-plan-name', 'client-quota-detail', 'client-quota-reset', 'client-payg-total', 'client-payg-wallet', 'client-payg-since', 'client-recent-count', 'client-api-mask', 'client-scope'];
  if (!data) {
    for (const id of ids) $(id).textContent = '—';
    $('client-quota-bar').style.width = '0%';
    $('client-recent-rows').replaceChildren(); $('client-top-models').replaceChildren(); return;
  }
  const wallet = data.wallet;
  $('client-api-mask').textContent = data.account?.label || '—';
  $('client-balance').textContent = wallet ? clientAmounts([{ currency: wallet.currency, amount: wallet.balance }]) : '—';
  $('client-wallet-meta').textContent = wallet
    ? `Créditos ${clientDecimal.format(Number(wallet.credits))} · consumo ${clientDecimal.format(Number(wallet.consumed))}${wallet.negative ? ' · saldo negativo' : ''}`
    : 'Sem carteira PAYG nesta chave.';
  $('client-spend-30').textContent = clientAmounts(data.spend?.last30);
  $('client-requests-30').textContent = clientInteger.format(data.activity?.requests30 || 0);
  $('client-tokens-30').textContent = `${clientInteger.format(data.activity?.tokens30 || 0)} tokens`;
  $('client-avg-7').textContent = clientAmounts(data.spend?.avgDaily7);
  const plan = data.plan || {};
  $('client-plan-kind').textContent = clientKindLabels[plan.kind] || 'Sem plano';
  $('client-plan-name').textContent = plan.name || 'Sem plano';
  const dailyLimited = (plan.dailyTokensLimit !== null && plan.dailyTokensLimit !== undefined) || (plan.dailyRequestsLimit !== null && plan.dailyRequestsLimit !== undefined);
  $('client-quota-detail').textContent = plan.dailyTokensLimit !== null && plan.dailyTokensLimit !== undefined
    ? `${clientCompact(plan.dailyTokensUsed)} / ${clientCompact(plan.dailyTokensLimit)} tokens hoje · ${plan.percentDailyTokens ?? 0}%`
    : plan.dailyRequestsLimit !== null && plan.dailyRequestsLimit !== undefined
      ? `${clientCompact(plan.dailyRequestsUsed)} / ${clientCompact(plan.dailyRequestsLimit)} requisições hoje · ${plan.percentDailyRequests ?? 0}%`
      : plan.tokensLimit !== null && plan.tokensLimit !== undefined
        ? `${clientCompact(plan.tokensUsed)} / ${clientCompact(plan.tokensLimit)} tokens · ${plan.percentTokens ?? 0}%`
        : plan.requestsLimit !== null && plan.requestsLimit !== undefined
          ? `${clientCompact(plan.requestsUsed)} / ${clientCompact(plan.requestsLimit)} requisições · ${plan.percentRequests ?? 0}%`
          : 'Sem limite local configurado';
  $('client-quota-bar').style.width = `${plan.percentDailyTokens ?? plan.percentDailyRequests ?? plan.percentTokens ?? plan.percentRequests ?? 0}%`;
  $('client-quota-reset').textContent = dailyLimited
    ? `Renova em ${plan.hoursToReset ?? 0} h · ${clientWhen(plan.resetAt)}`
    : plan.daysToReset === 0
      ? `Renova hoje · ${clientWhen(plan.resetAt)}`
      : `Renova em ${plan.daysToReset ?? 0} dia(s) · ${clientWhen(plan.resetAt)}`;
  $('client-payg-total').textContent = clientAmounts(data.spend?.paygTotal);
  $('client-payg-wallet').textContent = `Carteira: ${wallet ? clientAmounts([{ currency: wallet.currency, amount: wallet.balance }]) : '—'}`;
  $('client-payg-since').textContent = data.spend?.since ? `Desde ${clientWhen(data.spend.since)}` : 'Sem lançamentos apurados.';
  const rows = $('client-recent-rows'); rows.replaceChildren();
  for (const item of data.recent || []) {
    const tr = document.createElement('tr');
    clientCell(tr, item.model || 'modelo');
    clientCell(tr, clientInteger.format(item.tokens || 0));
    clientCell(tr, item.amount === null || item.amount === undefined ? '—' : `${item.currency} ${clientDecimal.format(Number(item.amount))}`);
    clientCell(tr, clientStatusLabels[item.status] || item.status || '—', `status ${item.status || ''}`);
    clientCell(tr, clientAgo(item.at)); rows.append(tr);
  }
  if (!rows.childElementCount) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 5; td.textContent = 'Nenhuma requisição registrada.'; tr.append(td); rows.append(tr);
  }
  $('client-recent-count').textContent = `${(data.recent || []).length} exibidas`;
  const models = $('client-top-models'); models.replaceChildren();
  const topModels = data.topModels || [];
  if (!topModels.length) {
    const empty = document.createElement('p'); empty.className = 'fineprint'; empty.textContent = 'Sem gastos apurados no período.'; models.append(empty);
  }
  const peak = Math.max(1, ...topModels.map(item => Number(item.amount) || 0));
  for (const item of topModels) {
    const line = document.createElement('div'); line.className = 'model-line';
    const head = document.createElement('div'); head.className = 'model-line-head';
    const name = document.createElement('span'); name.textContent = item.model;
    const value = document.createElement('span'); value.textContent = clientAmounts([{ currency: item.currency, amount: item.amount }]);
    head.append(name, value);
    const bar = document.createElement('div'); bar.className = 'model-bar';
    const fill = document.createElement('span'); fill.style.width = `${Math.max(3, (Number(item.amount) || 0) / peak * 100)}%`;
    bar.append(fill); line.append(head, bar); models.append(line);
  }
  $('client-scope').textContent = `Escopo: últimas 10.000 requisições · atualizado em ${clientWhen(data.generatedAt)}`;
}
async function refreshClientHome() {
  fillStatsKeySelect(); $('client-home-message').textContent = '';
  if (!statsKeyId) { renderClientHome(null); $('client-home-message').textContent = 'Crie uma chave de cliente para ver o resumo.'; return; }
  try { renderClientHome(await api(`/admin/client-summary?keyId=${encodeURIComponent(statsKeyId)}`)); }
  catch (error) { renderClientHome(null); $('client-home-message').textContent = error.message; }
}
const systemCount = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
const systemMb = value => value === null || value === undefined ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value / 1048576)} MB`;
function systemUptime(seconds) {
  const value = Number(seconds); if (!Number.isFinite(value)) return '—';
  const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}
function systemRows(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement('div'); row.className = 'system-row';
    const name = document.createElement('span'); name.textContent = label;
    const amount = document.createElement('strong'); amount.textContent = String(value ?? '—');
    row.append(name, amount); target.append(row);
  }
}
function renderSystem(report) {
  systemData = report;
  if (!report) {
    for (const id of ['system-uptime', 'system-rss', 'system-heap', 'system-request-bytes', 'system-request-count', 'system-response-bytes', 'system-response-count']) $(id).textContent = '—';
    for (const id of ['system-runtime', 'system-gateway', 'system-storage', 'system-database']) systemRows($(id), []);
    $('system-files').replaceChildren(); return;
  }
  const processInfo = report.process || {}, memory = processInfo.memory || {}, host = report.host || {};
  const traffic = report.traffic || {}, storage = report.storage || {}, disk = storage.disk || {};
  $('system-uptime').textContent = systemUptime(processInfo.uptimeSeconds);
  $('system-rss').textContent = systemMb(memory.rssBytes);
  $('system-heap').textContent = `Heap ${systemMb(memory.heapUsedBytes)} / ${systemMb(memory.heapTotalBytes)}`;
  $('system-request-bytes').textContent = systemMb(traffic.requestBytesTotal);
  $('system-request-count').textContent = `${systemCount(traffic.requestsWithBodyCount)} corpo(s) recebido(s)`;
  $('system-response-bytes').textContent = systemMb(traffic.responseBytesTotal);
  $('system-response-count').textContent = `${systemCount(traffic.httpMessagesTotal)} mensagem(ns) HTTP`;
  systemRows($('system-runtime'), [
    ['Node', processInfo.nodeVersion || '—'], ['Plataforma', `${processInfo.platform || '—'} · ${processInfo.arch || '—'}`],
    ['CPUs', systemCount(host.cpuCount)], ['Carga média (1 min)', host.loadAvg1m ?? '—'],
    ['Memória total', systemMb(host.totalMemoryBytes)], ['Memória livre', systemMb(host.freeMemoryBytes)],
  ]);
  const gateway = report.gateway || {};
  $('system-cooling').textContent = systemCount(gateway.routesCoolingDown);
  $('system-balance').textContent = `Balanceamento: ${gateway.balanceStrategy || '—'}`;
  systemRows($('system-gateway'), [
    ['Rotas habilitadas', systemCount(gateway.routesEnabled)], ['Conexões ativas', systemCount(gateway.connectionsActive)],
    ['Chaves ativas', systemCount(gateway.keysActive)], ['Planos', systemCount(gateway.plansCount)],
    ['Rotas em resfriamento', systemCount(gateway.routesCoolingDown)], ['Estratégia', gateway.balanceStrategy || '—'],
    ['Respostas em streaming', systemCount(traffic.streamedResponsesCount)], ['Bytes enviados ao fornecedor', systemMb(traffic.upstreamRequestBytesTotal)],
  ]);
  systemRows($('system-storage'), [
    ['Modo', storage.mode || '—'], ['Volume total', systemMb(disk.totalBytes)],
    ['Volume usado', `${systemMb(disk.usedBytes)}${disk.usedPercent === null || disk.usedPercent === undefined ? '' : ` (${disk.usedPercent}%)`}`],
    ['Volume disponível', systemMb(disk.availableBytes)], ['Arquivos em data/', systemMb(storage.dataFilesTotalBytes)],
  ]);
  const tables = storage.database?.tables || [];
  systemRows($('system-database'), tables.length ? tables.map(table => [table.name, systemMb(table.totalBytes)]) : [['Tamanho total em data/', systemMb(storage.dataFilesTotalBytes)]]);
  const files = $('system-files'); files.replaceChildren();
  for (const file of storage.dataFiles || []) {
    const tr = document.createElement('tr');
    for (const value of [file.name, systemMb(file.bytes), file.modifiedAt || '—']) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    files.append(tr);
  }
  if (!files.childElementCount) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 3; td.className = 'muted'; td.textContent = 'Nenhum arquivo de dados criado ainda.'; tr.append(td); files.append(tr); }
  const hours = report.retention?.retentionHours;
  $('retention-hours').value = hours === null || hours === undefined ? '' : String(hours);
}
async function refreshSystem() {
  $('retention-message').textContent = '';
  try { renderSystem(await api('/admin/system')); }
  catch (error) { $('retention-message').textContent = error.message; }
}
function renderRouteRelationships(routeResult) {
  const routes = [...(routeResult.routes || [])].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')) || (a.priority ?? 100) - (b.priority ?? 100) || String(a.destinationId || '').localeCompare(String(b.destinationId || '')));
  const rows = routes.map((route, index) => {
    const connection = connections.find(item => item.id === (route.connectionId || 'legacy-xkiro'));
    const cooling = route.cooldownUntil && Date.parse(route.cooldownUntil) > Date.now();
    const state = !route.enabled ? 'Desativado' : cooling ? `Resfriado até ${new Date(route.cooldownUntil).toLocaleString('pt-BR')}` : connection?.active === false ? 'Credencial desativada' : 'Disponível';
    return [route.id || '—', String(index + 1), `${route.provider || '—'} / ${connection?.name || 'sem credencial'}`, route.upstreamModel || '—', `${route.priority ?? 100} · peso ${route.weight ?? 1}`, state];
  });
  globalRows($('route-relationships'), rows, 6);
}
function renderRouting(routeResult) {
  const policy = routeResult.policy || { strategy: 'round_robin', maxAttempts: null, retryStatuses: [429, 500, 502, 503, 504], timeoutMs: null, cooldownMs: 0, failoverOnError: true };
  $('routing-strategy').value = policy.strategy;
  $('routing-max-attempts').value = policy.maxAttempts ?? '';
  $('routing-retry-statuses').value = (policy.retryStatuses || []).join(', ');
  $('routing-failover').checked = policy.failoverOnError !== false;
  $('routing-timeout').value = policy.timeoutMs ?? '';
  $('routing-cooldown').value = policy.cooldownMs ?? 0;
  const audit = $('route-audit-list'); audit.replaceChildren();
  const labels = { policy: 'Política', rotate: 'Rotação', remove: 'Remoção', cooldown: 'Resfriamento', route_create: 'Criação', route_enable: 'Habilitação', route_disable: 'Desabilitação', route_update: 'Atualização' };
  const describe = value => {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value)) return `${value.length} destino(s)`;
    if (value.strategy) return `${value.strategy}${value.maxAttempts ? ` · ${value.maxAttempts} tent.` : ''}`;
    return `${value.priority ?? ''}${value.weight ? ` · peso ${value.weight}` : ''}`.trim() || '—';
  };
  for (const event of routeResult.audit || []) {
    const row = document.createElement('div'); row.className = 'audit-row';
    row.textContent = `${new Date(event.at).toLocaleString('pt-BR')} · ${labels[event.action] || event.action} · ${event.target || 'routing'} · ${describe(event.before)} → ${describe(event.after)}${event.detail ? ` · ${event.detail}` : ''}`;
    audit.append(row);
  }
  if (!audit.childElementCount) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Nenhuma alteração registrada.'; audit.append(empty); }
}
function resetRoute() { $('route-form').reset(); $('route-destination-id').value = ''; $('route-id').readOnly = false; $('route-priority').value = 100; $('route-weight').value = 1; }
$('route-new').addEventListener('click', resetRoute);
$('route-form').addEventListener('submit', async e => { e.preventDefault(); $('route-message').textContent = ''; try { const c = connections.find(item => item.id === $('route-connection').value); if (!c) throw new Error('Cadastre uma conexão primeiro.'); await post('/admin/routes', { destinationId: $('route-destination-id').value || undefined, id: $('route-id').value.trim(), provider: c.provider, connectionId: c.id, upstreamModel: $('upstream-model').value.trim(), priority: Number($('route-priority').value), weight: Number($('route-weight').value), enabled: $('enabled').checked }); resetRoute(); $('route-message').textContent = 'Destino salvo.'; await show(); } catch (error) { $('route-message').textContent = error.message; } });
$('routing-policy-form').addEventListener('submit', async e => { e.preventDefault(); $('routing-policy-message').textContent = ''; try { await post('/admin/routing-policy', { strategy: $('routing-strategy').value, maxAttempts: $('routing-max-attempts').value, retryStatuses: $('routing-retry-statuses').value, failoverOnError: $('routing-failover').checked, timeoutMs: $('routing-timeout').value, cooldownMs: $('routing-cooldown').value }); $('routing-policy-message').textContent = 'Política salva.'; await show(); } catch (error) { $('routing-policy-message').textContent = error.message; } });
$('referral-register-form').addEventListener('submit', async e => {
  e.preventDefault(); $('referral-message').textContent = '';
  try {
    await post('/admin/referrals', { ownerKeyId: $('referral-owner').value, contact: $('referral-contact').value, note: $('referral-note').value });
    $('referral-contact').value = ''; $('referral-note').value = '';
    $('referral-message').textContent = 'Indicação registrada; o contato foi mascarado.';
    await show();
  } catch (error) { $('referral-message').textContent = error.message; }
});
$('referral-qualify-form').addEventListener('submit', async e => {
  e.preventDefault(); $('referral-message').textContent = '';
  try {
    await post('/admin/referrals/qualify', { id: $('referral-qualify-id').value, depositAmount: $('referral-deposit').value, reference: $('referral-reference').value });
    $('referral-deposit').value = ''; $('referral-reference').value = '';
    $('referral-message').textContent = 'Depósito informado registrado. Nenhum valor foi cobrado.';
    await show();
  } catch (error) { $('referral-message').textContent = error.message; }
});
$('referral-status-form').addEventListener('submit', async e => {
  e.preventDefault(); $('referral-message').textContent = '';
  try {
    await post('/admin/referrals/status', { id: $('referral-status-id').value, status: $('referral-status').value, reason: $('referral-reason').value });
    $('referral-reason').value = '';
    $('referral-message').textContent = 'Revisão registrada.';
    await show();
  } catch (error) { $('referral-message').textContent = error.message; }
});
$('referral-move-form').addEventListener('submit', async e => {
  e.preventDefault(); $('referral-message').textContent = '';
  try {
    const ids = [...$('referral-move-ids').selectedOptions].map(option => option.value);
    await post('/admin/referrals/move-credit', { ids });
    $('referral-message').textContent = 'Crédito simulado movido. Nenhum pagamento foi realizado.';
    await show();
  } catch (error) { $('referral-message').textContent = error.message; }
});
$('user-search').addEventListener('input', renderUserList);
$('user-refresh').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try { await show(); } catch (error) { $('user-status-message').textContent = error.message; }
  finally { e.currentTarget.disabled = false; }
});
$('user-plan-form').addEventListener('submit', async e => {
  e.preventDefault(); const user = selectedUserReport(); if (!user) return;
  $('user-plan-message').textContent = ''; const button = e.target.querySelector('button'); button.disabled = true;
  try {
    const result = await post(`/admin/users/${encodeURIComponent(user.id)}/plan`, { planId: $('user-plan-select').value || null });
    $('user-plan-message').textContent = `Plano aplicado a ${result.updated} chave(s).`;
    await show();
  } catch (error) { $('user-plan-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('user-key-form').addEventListener('submit', async e => {
  e.preventDefault(); const user = selectedUserReport(); if (!user) return;
  $('user-key-message').textContent = ''; const button = e.target.querySelector('button'); button.disabled = true;
  try {
    const result = await post(`/admin/users/${encodeURIComponent(user.id)}/keys`, { name: $('user-key-name').value, planId: $('user-key-plan').value || null });
    $('user-key-name').value = '';
    $('user-key-created').textContent = `Chave ${result.label}: ${result.key}\nCopie agora; ela não será exibida novamente.`;
    $('user-key-message').textContent = 'Chave derivada criada para o titular.';
    await show();
  } catch (error) { $('user-key-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('user-topup-form').addEventListener('submit', async e => {
  e.preventDefault(); const user = selectedUserReport(); if (!user) return;
  $('user-topup-message').textContent = ''; const button = e.target.querySelector('button'); button.disabled = true;
  try {
    const keyId = $('user-topup-key').value;
    if (!user.keys.some(key => key.id === keyId && key.active)) throw new Error('Selecione uma chave ativa do titular.');
    const currency = $('user-topup-currency').value.trim().toUpperCase();
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `user-topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await post('/admin/topup', { keyId, amount: $('user-topup-amount').value, currency, note: $('user-topup-note').value, idempotencyKey });
    $('user-topup-amount').value = ''; $('user-topup-note').value = '';
    $('user-topup-message').textContent = `${result.duplicate ? 'Recarga já registrada' : 'Crédito simulado registrado'}: ${result.topup.currency} ${moneyText(result.topup.amount)}${result.wallet ? ` · saldo ${moneyText(result.wallet.balance)}` : ''}. Nenhum pagamento foi realizado.`;
    await show();
  } catch (error) { $('user-topup-message').textContent = error.message; }
  finally { button.disabled = false; }
});
async function setUserActive(active) {
  const user = selectedUserReport(); if (!user) return;
  $('user-status-message').textContent = '';
  try {
    const result = await post(`/admin/users/${encodeURIComponent(user.id)}/active`, { active });
    $('user-status-message').textContent = result.blocked ? `${result.updated} chave(s) bloqueada(s); sessões temporárias revogadas.` : `${result.updated} chave(s) desbloqueada(s).`;
    await show();
  } catch (error) { $('user-status-message').textContent = error.message; }
}
$('user-block-button').addEventListener('click', () => setUserActive(false));
$('user-unblock-button').addEventListener('click', () => setUserActive(true));
$('user-referral-register-form').addEventListener('submit', async e => {
  e.preventDefault(); const user = selectedUserReport(); if (!user) return;
  $('user-referral-message').textContent = '';
  try {
    await post('/admin/referrals', { ownerKeyId: user.id, contact: $('user-referral-contact').value, note: $('user-referral-note').value });
    $('user-referral-contact').value = ''; $('user-referral-note').value = '';
    $('user-referral-message').textContent = 'Indicação registrada; o contato foi mascarado.';
    await show();
  } catch (error) { $('user-referral-message').textContent = error.message; }
});
$('user-referral-qualify-form').addEventListener('submit', async e => {
  e.preventDefault(); $('user-referral-message').textContent = '';
  try {
    await post('/admin/referrals/qualify', { id: $('user-referral-qualify-id').value, depositAmount: $('user-referral-deposit').value, reference: $('user-referral-reference').value });
    $('user-referral-deposit').value = ''; $('user-referral-reference').value = '';
    $('user-referral-message').textContent = 'Depósito informado registrado. Nada foi cobrado.';
    await show();
  } catch (error) { $('user-referral-message').textContent = error.message; }
});
$('user-referral-status-form').addEventListener('submit', async e => {
  e.preventDefault(); $('user-referral-message').textContent = '';
  try {
    await post('/admin/referrals/status', { id: $('user-referral-status-id').value, status: $('user-referral-status').value, reason: $('user-referral-reason').value });
    $('user-referral-reason').value = '';
    $('user-referral-message').textContent = 'Revisão registrada.';
    await show();
  } catch (error) { $('user-referral-message').textContent = error.message; }
});
$('user-referral-move-form').addEventListener('submit', async e => {
  e.preventDefault(); $('user-referral-message').textContent = '';
  try {
    const ids = [...$('user-referral-move-ids').selectedOptions].map(option => option.value);
    const result = await post('/admin/referrals/move-credit', { ids });
    $('user-referral-message').textContent = `${result.moved} indicação(ões) creditadas na simulação. Nenhum pagamento foi realizado.`;
    await show();
  } catch (error) { $('user-referral-message').textContent = error.message; }
});
for (const { picker, status } of clientSessionPickers) {
  $(picker)?.addEventListener('change', async () => {
    const keyId = $(picker).value;
    if (!keyId) { clearClientSession(); $(status).textContent = 'Seleção removida. Informe uma chave ou escolha outra.'; return; }
    $(status).textContent = 'Preparando acesso temporário...';
    try {
      const info = await post('/admin/keys/session', { keyId });
      announceClientSession(info);
      $(status).textContent = `Chave ${info.label || info.prefix} liberada nesta aba por 30 minutos. A chave completa não foi exibida.`;
    } catch (error) { $(status).textContent = error.message; }
  });
}
// Sem chave administrativa, /chat, /minha-conta e /indicacoes abrem o mesmo painel em modo cliente:
// apenas essas seções ficam visíveis, e o acesso é feito pela chave do cliente.
const clientPaths = new Set(['/chat', '/minha-conta', '/indicacoes']);
function enterClientMode() {
  document.body.classList.add('client-mode');
  $('login').hidden = true;
  $('dashboard').hidden = false;
  const pageByPath = { '/chat': 'chat', '/minha-conta': 'client-area', '/indicacoes': 'referrals-client' };
  showPage(pageByPath[location.pathname] || 'chat', false);
}
if (adminKey) show().catch(() => { clearClientSession(); sessionStorage.removeItem('anubis-admin'); adminKey = ''; });
else if (clientPaths.has(location.pathname)) enterClientMode();
