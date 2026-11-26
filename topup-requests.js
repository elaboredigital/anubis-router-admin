// Admin: pedidos de recarga dos clientes. Aprovar credita o valor no saldo da conta; recusar só registra o motivo.
// Script clássico carregado depois de app.js: usa api(), post() e a sessão administrativa já aberta por ele.
(() => {
  const section = document.querySelector('[data-page="topup-requests"]');
  if (!section) return;
  const byId = id => document.getElementById(id);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const usd = value => value === null || value === undefined ? '—' : `US$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  const when = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const LABEL = { pending: 'Aguardando', approved: 'Creditado', rejected: 'Recusado' };
  let data = null; let loading = false;

  function badge() {
    const nav = document.querySelector('[data-nav="topup-requests"] .nav-count');
    if (!nav) return;
    nav.textContent = data?.pending ? String(data.pending) : '';
    nav.hidden = !data?.pending;
  }

  function actions(item) {
    const td = make('td');
    if (item.status !== 'pending') { td.append(make('span', 'muted', item.note || item.reason || '')); return td; }
    const form = make('form', 'tr-actions');
    const note = make('input'); note.type = 'text'; note.maxLength = 160; note.placeholder = 'Observação (opcional)';
    note.setAttribute('aria-label', `Observação do pedido de ${item.keyName}`);
    const approve = make('button', '', 'Aprovar'); approve.type = 'submit';
    const reject = make('button', 'secondary', 'Recusar'); reject.type = 'button';
    const message = make('p', 'form-message'); message.setAttribute('role', 'status');
    const decide = async action => {
      approve.disabled = true; reject.disabled = true;
      try { await post(`/admin/topup-requests/${encodeURIComponent(item.id)}/${action}`, { note: note.value.trim() }); await load(true); }
      catch (error) { message.textContent = error.message; approve.disabled = false; reject.disabled = false; }
    };
    form.addEventListener('submit', event => { event.preventDefault(); if (confirm(`Creditar ${usd(item.amount)} para ${item.keyName}? Confirme que o pagamento foi recebido.`)) decide('approve'); });
    reject.addEventListener('click', () => decide('reject'));
    form.append(note, approve, reject, message);
    td.append(form);
    return td;
  }

  function render() {
    if (!data) return;
    const filter = byId('tr-filter').value;
    const list = data.requests.filter(item => filter === 'all' || item.status === filter);
    byId('tr-pending').textContent = String(data.pending);
    byId('tr-pending-amount').textContent = usd(data.requests.filter(item => item.status === 'pending').reduce((sum, item) => sum + Number(item.amount), 0));
    byId('tr-approved').textContent = usd(data.requests.filter(item => item.status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0));
    const body = byId('tr-rows');
    body.replaceChildren();
    for (const item of list) {
      const tr = make('tr');
      const client = make('td'); client.append(make('strong', '', item.keyName), make('span', 'model-analytics-id', item.keyLabel));
      tr.append(make('td', '', when(item.createdAt)), client, make('td', '', usd(item.amount)), make('td', '', usd(item.balance)), make('td', `tr-status ${item.status}`, LABEL[item.status] || item.status), actions(item));
      body.append(tr);
    }
    if (!list.length) { const tr = make('tr'); const td = make('td', 'muted', 'Nenhum pedido neste filtro.'); td.colSpan = 6; tr.append(td); body.append(tr); }
    badge();
  }

  async function load(force = false) {
    if (loading || (data && !force)) return;
    loading = true;
    try { data = await api('/admin/topup-requests'); byId('tr-message').textContent = ''; render(); }
    catch (error) { byId('tr-message').textContent = error.message; }
    finally { loading = false; }
  }

  byId('tr-filter').addEventListener('change', render);
  byId('tr-refresh').addEventListener('click', () => load(true));
  new MutationObserver(() => { if (!section.hidden) load(true); }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  // Atualiza o contador do menu ao entrar no painel e a cada minuto.
  const poll = () => { if (document.visibilityState === 'visible' && document.querySelector('.sidebar')?.offsetParent !== null) load(true); };
  setTimeout(poll, 1500);
  setInterval(poll, 60_000);
})();
