// Troca de usuário e senha do admin. Script clássico carregado depois de app.js: usa post() e a sessão aberta por ele.
(() => {
  const button = document.getElementById('change-password');
  if (!button) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'password-dialog';
  dialog.setAttribute('aria-labelledby', 'password-title');
  dialog.innerHTML = `<form method="dialog" id="password-form">
    <h2 id="password-title">Alterar usuário e senha</h2>
    <p class="muted">A troca encerra as outras sessões abertas com este usuário.</p>
    <label for="password-user">Novo usuário (opcional)</label><input id="password-user" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32">
    <label for="password-current">Senha atual</label><input id="password-current" type="password" autocomplete="current-password" required>
    <label for="password-next">Nova senha</label><input id="password-next" type="password" autocomplete="new-password" minlength="10" required>
    <label for="password-confirm">Repita a nova senha</label><input id="password-confirm" type="password" autocomplete="new-password" minlength="10" required>
    <p id="password-message" class="form-message" role="status" aria-live="polite"></p>
    <div class="password-actions"><button type="submit" class="primary" value="save">Salvar</button><button type="button" class="secondary" id="password-cancel">Cancelar</button></div>
  </form>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(id);
  const message = (text, tone = '') => { $('password-message').textContent = text; $('password-message').className = `form-message${tone ? ` ${tone}` : ''}`; };
  button.addEventListener('click', () => {
    $('password-form').reset(); message('');
    // Entrada pela chave de emergência não tem usuário para trocar.
    // eslint-disable-next-line no-undef -- adminKey vem de app.js
    if (!String(adminKey).startsWith('anubis_adm_')) message('Entre com usuário e senha para alterar a senha.', 'error');
    dialog.showModal();
  });
  $('password-cancel').addEventListener('click', () => dialog.close());
  $('password-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('password-next').value !== $('password-confirm').value) { message('As duas senhas novas não são iguais.', 'error'); return; }
    message('Salvando...');
    try {
      // eslint-disable-next-line no-undef -- post() vem de app.js
      const result = await post('/admin/password', { current: $('password-current').value, next: $('password-next').value, username: $('password-user').value.trim() || undefined });
      message(`Pronto. Use o usuário "${result.username}" e a nova senha no próximo login.`, 'ok');
      setTimeout(() => dialog.close(), 1800);
    } catch (error) { message(error.message, 'error'); }
  });
})();
