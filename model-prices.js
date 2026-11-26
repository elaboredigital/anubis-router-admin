// Admin: os três preços de cada modelo público.
// Original (tabela do fabricante, só exibição) · custo de cada fornecedor e a média · venda ao cliente (média × multiplicador).
// Script clássico carregado depois de app.js: usa api(), post() e a sessão administrativa já abertos por ele.
(() => {
  const section = document.querySelector('[data-page="model-prices"]');
  if (!section) return;
  const byId = id => document.getElementById(id);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const FIELDS = [['input', 'Entrada'], ['output', 'Saída'], ['cacheRead', 'Cache leitura'], ['cacheWrite', 'Cache escrita'], ['request', 'Por requisição']];
  let data = null; let loading = false;

  const num = value => value === null || value === undefined || value === '' ? null : Number(value);
  function money(value) {
    const n = num(value);
    if (n === null || !Number.isFinite(n)) return '—';
    if (n === 0) return '0';
    return n >= 1 ? n.toFixed(2).replace(/\.00$/, '') : String(Number(n.toPrecision(3)));
  }
  /** Linha compacta: entrada / saída (ou valor por requisição). */
  function pair(price) {
    if (!price) return '—';
    if (price.billingType === 'request' || (price.request !== null && price.request !== undefined && num(price.input) === null)) return `${money(price.request)} /req`;
    return `${money(price.input)} / ${money(price.output)}`;
  }
  function off(original, sale) {
    if (!original || !sale) return '—';
    const field = num(original.input) !== null && num(sale.input) !== null ? 'input' : num(original.request) !== null && num(sale.request) !== null ? 'request' : null;
    if (!field) return '—';
    const before = num(original[field]); const after = num(sale[field]);
    if (!before) return '—';
    const pct = Math.round((1 - after / before) * 100);
    return pct > 0 ? `-${pct}%` : `+${Math.abs(pct)}%`;
  }

  function supplierCell(model) {
    const td = make('td');
    const target = data.targetSuppliers || 3;
    const count = make('strong', model.supplierCount >= target ? 'mp-ok' : model.supplierCount > 1 ? 'mp-warn' : 'mp-low', `${model.supplierCount}/${target}`);
    td.append(count);
    const list = make('ul', 'mp-suppliers');
    for (const s of model.suppliers) {
      const li = make('li');
      li.append(make('span', '', s.connectionName || s.provider), make('small', '', s.cost ? pair(s.cost) : 'sem preço'));
      list.append(li);
    }
    td.append(list);
    return td;
  }

  function editor(model) {
    const details = make('details', 'mp-edit');
    details.append(make('summary', '', model.original ? 'Editar original' : 'Definir original'));
    const form = make('form');
    const inputs = {};
    for (const [field, label] of FIELDS) {
      const wrap = make('label', '', label);
      const input = make('input'); input.type = 'number'; input.min = '0'; input.step = 'any'; input.value = model.original?.[field] ?? '';
      input.setAttribute('aria-label', `${label} original por 1M (${model.id})`);
      inputs[field] = input; wrap.append(input); form.append(wrap);
    }
    const save = make('button', '', 'Salvar'); save.type = 'submit';
    const message = make('p', 'form-message'); message.setAttribute('role', 'status');
    form.append(save);
    if (model.original) {
      const clear = make('button', 'secondary', 'Remover'); clear.type = 'button';
      clear.addEventListener('click', async () => { clear.disabled = true; try { await post('/admin/model-prices', { model: model.id, price: null }); await load(true); } catch (error) { message.textContent = error.message; clear.disabled = false; } });
      form.append(clear);
    }
    form.append(message);
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      const price = { currency: 'USD' };
      for (const [field] of FIELDS) if (inputs[field].value !== '') price[field] = inputs[field].value;
      try { await post('/admin/model-prices', { model: model.id, price }); await load(true); }
      catch (error) { message.textContent = error.message; save.disabled = false; }
    });
    details.append(form);
    return details;
  }

  function render() {
    if (!data) return;
    const query = byId('mp-search').value.trim().toLowerCase();
    const filter = byId('mp-filter').value;
    const target = data.targetSuppliers || 3;
    const list = data.models.filter(m =>
      (!query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)) &&
      (filter === 'all' || (filter === 'under' && m.supplierCount < target) || (filter === 'no-original' && !m.original) || (filter === 'unpriced' && !m.sale)));
    byId('mp-total').textContent = String(data.models.length);
    byId('mp-target').textContent = String(data.models.filter(m => m.supplierCount >= target).length);
    byId('mp-under').textContent = String(data.models.filter(m => m.supplierCount < target).length);
    byId('mp-original').textContent = String(data.models.filter(m => m.original).length);
    const body = byId('mp-rows');
    body.replaceChildren();
    for (const model of list) {
      const tr = make('tr');
      const name = make('td');
      name.append(make('strong', '', model.name), make('span', 'model-analytics-id', model.id));
      const sale = make('td');
      sale.append(make('strong', '', pair(model.sale)), make('small', 'mp-rule', model.manual ? 'preço manual' : `média × ${model.multiplier}`));
      const actions = make('td'); actions.append(editor(model));
      tr.append(name, supplierCell(model), make('td', '', pair(model.original)), make('td', '', pair(model.averageCost)), sale, make('td', '', off(model.original, model.sale)), actions);
      body.append(tr);
    }
    if (!list.length) { const tr = make('tr'); const td = make('td', 'muted', 'Nenhum modelo com esse filtro.'); td.colSpan = 7; tr.append(td); body.append(tr); }
  }

  async function load(force = false) {
    if (loading || (data && !force)) return;
    loading = true; byId('mp-message').textContent = data ? '' : 'Carregando preços.';
    try { data = await api('/admin/model-prices'); byId('mp-message').textContent = ''; render(); }
    catch (error) { byId('mp-message').textContent = error.message; }
    finally { loading = false; }
  }

  byId('mp-search').addEventListener('input', render);
  byId('mp-filter').addEventListener('change', render);
  byId('mp-refresh').addEventListener('click', () => load(true));
  // Carrega quando a página fica visível (showPage alterna o atributo hidden).
  new MutationObserver(() => { if (!section.hidden) load(); }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  if (!section.hidden) load();
})();
