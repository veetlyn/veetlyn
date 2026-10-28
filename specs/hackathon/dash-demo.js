/* Local prototype interactions. No API calls, messages or financial effects. */
(() => {
  const money = minor => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
  const payouts = [
    { id: 'out-101', name: 'Aicha Diallo', project: 'Bakery website', projectId: 'PRJ-1021', amount: 18000, state: 'approval', asked: 'Oct 27', next: 'Two approvals required' },
    { id: 'out-102', name: 'Yaw Mensah', project: 'Shopify theme fixes', projectId: 'PRJ-1035', amount: 28800, state: 'approval', asked: 'Oct 24', next: 'Two approvals required' },
    { id: 'out-103', name: 'Kofi Boateng', project: 'Product photos', projectId: 'PRJ-1018', amount: 17200, state: 'held', asked: 'Oct 26', next: 'Payout destination changed' },
    { id: 'out-104', name: 'Ama Owusu', project: 'Logo and menu refresh', projectId: 'PRJ-1040', amount: 9500, state: 'requested', asked: 'Oct 27', next: 'Not in this approval review' },
    ...[
      ['Yaw Mensah', 'Event poster', 24000, 'Oct 20'],
      ['Aicha Diallo', 'Pitch deck', 31000, 'Oct 20'],
      ['Kojo Asare', 'Menu photos', 13000, 'Oct 13'],
      ['Ama Owusu', 'Illustrations', 15000, 'Oct 12'],
      ['Yaw Mensah', 'Store setup', 26000, 'Oct 11'],
      ['Aicha Diallo', 'Brand guidelines', 19500, 'Oct 10'],
      ['Kojo Asare', 'Product shoot', 18000, 'Oct 9'],
      ['Ama Owusu', 'Packaging artwork', 22500, 'Oct 8'],
      ['Yaw Mensah', 'Site updates', 20000, 'Oct 6'],
      ['Aicha Diallo', 'Landing page', 25000, 'Oct 3'],
    ].map(([name, project, amount, asked], index) => ({ id: `out-${105 + index}`, name, project, amount, state: 'paid', asked, next: `Paid ${asked}` })),
  ];
  // All 10 paid rows total $2,140. Keep the summary derived from the fixture.
  const labels = { approval: 'Awaiting approval', held: 'Held', requested: 'Requested', paid: 'Paid' };
  const selected = new Set(payouts.filter(p => p.state === 'approval').map(p => p.id));
  let filter = 'all';
  let query = '';
  let limit = 7;
  const body = document.querySelector('[data-payouts]');
  const callBody = document.querySelector('[data-call-payouts]');
  const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
  const td = (text, className) => {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  };
  function checkbox(payout, readonly = false) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.className = 'check';
    input.checked = selected.has(payout.id);
    input.disabled = readonly || payout.state !== 'approval';
    input.setAttribute('aria-label', `${payout.name}, ${money(payout.amount)}${payout.state === 'approval' ? ', select for approval' : ', unavailable for this approval'}`);
    input.title = payout.state === 'approval' ? 'Select for approval' : payout.next;
    input.addEventListener('change', () => {
      if (input.checked) selected.add(payout.id); else selected.delete(payout.id);
      render();
    });
    return input;
  }
  const picked = () => payouts.filter(p => selected.has(p.id) && p.state === 'approval');
  function updateSelection() {
    const rows = picked();
    document.querySelectorAll('[data-selection-count]').forEach(el => { el.textContent = `${rows.length} payout${rows.length === 1 ? '' : 's'}`; });
    document.querySelectorAll('[data-selection-amount]').forEach(el => { el.textContent = money(sum(rows)); });
    document.querySelectorAll('[data-selection-names]').forEach(el => { el.textContent = rows.length ? rows.map(p => p.name).join(' and ') : 'Select a payout awaiting approval.'; });
    document.querySelectorAll('[data-review-approval]').forEach(button => { button.disabled = !rows.length; });
    const textarea = document.querySelector('.composer textarea');
    if (body && textarea) textarea.placeholder = rows.length ? `Ask Payleor about payouts, or about the ${rows.length} selected` : 'Ask Payleor about payouts';
    const paid = document.querySelector('[data-paid-total]');
    if (paid) paid.textContent = money(sum(payouts.filter(p => p.state === 'paid')));
  }
  function render() {
    if (!body) return updateSelection();
    const results = payouts.filter(p => (filter === 'all' || p.state === filter) && `${p.name} ${p.project} ${p.projectId || ''}`.toLowerCase().includes(query));
    const visible = results.slice(0, limit);
    body.replaceChildren();
    visible.forEach(p => {
      const row = document.createElement('tr');
      row.classList.toggle('sel', selected.has(p.id));
      const checkCell = td(''); checkCell.append(checkbox(p));
      const projectCell = td(p.project, 't-2');
      if (p.projectId) projectCell.title = p.projectId;
      row.append(checkCell, td(p.name, 'medium'), projectCell, td(money(p.amount), 'r data medium'), td(labels[p.state], p.state === 'held' ? 'warn' : 't-2'), td(p.next, 't-2 next-step'), td(p.asked, 'r t-3'));
      body.append(row);
    });
    if (!visible.length) {
      const row = document.createElement('tr'); const cell = td('No payouts match this search.');
      cell.colSpan = 7; row.append(cell); body.append(row);
    }
    const count = document.querySelector('[data-result-count]');
    count.textContent = `${visible.length} of ${results.length} payouts shown${query || filter !== 'all' ? `, from ${payouts.length} in October` : ''}`;
    const more = document.querySelector('[data-show-more]');
    more.hidden = visible.length >= results.length;
    more.textContent = `Show ${results.length - visible.length} more`;
    const all = document.querySelector('[data-select-all]');
    const eligible = visible.filter(p => p.state === 'approval');
    all.disabled = !eligible.length;
    all.checked = eligible.length > 0 && eligible.every(p => selected.has(p.id));
    all.indeterminate = eligible.some(p => selected.has(p.id)) && !all.checked;
    all.setAttribute('aria-label', 'Select visible payouts awaiting approval');
    updateSelection();
  }
  if (callBody) {
    payouts.slice(0, 3).forEach(p => {
      const row = document.createElement('tr'); row.classList.toggle('sel', p.state === 'approval');
      const name = td(p.name, 'medium'); const project = document.createElement('div');
      project.className = 't-sm t-3'; project.textContent = p.project; name.append(project);
      row.append(name, td(p.state === 'held' ? 'Destination changed' : 'Awaiting approval', p.state === 'held' ? 'warn' : 't-2'), td(money(p.amount), 'r data'));
      callBody.append(row);
    });
  }
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      filter = button.dataset.filter; limit = 7;
      document.querySelectorAll('[data-filter]').forEach(other => { other.classList.toggle('on', other === button); other.setAttribute('aria-pressed', String(other === button)); });
      render();
    });
  });
  document.querySelector('input[type="search"]')?.addEventListener('input', event => { query = event.target.value.trim().toLowerCase(); limit = 7; render(); });
  document.querySelector('[data-show-more]')?.addEventListener('click', () => { limit = payouts.length; render(); });
  document.querySelector('[data-select-all]')?.addEventListener('change', event => {
    const visible = payouts.filter(p => (filter === 'all' || p.state === filter) && `${p.name} ${p.project} ${p.projectId || ''}`.toLowerCase().includes(query)).slice(0, limit);
    visible.filter(p => p.state === 'approval').forEach(p => { if (event.target.checked) selected.add(p.id); else selected.delete(p.id); }); render();
  });
  const dialog = document.createElement('dialog');
  dialog.className = 'preview-dialog'; dialog.setAttribute('aria-labelledby', 'preview-title');
  dialog.innerHTML = '<h2 id="preview-title" class="t-title"></h2><div class="preview-body"></div><p class="t-sm t-2">Prototype preview only. Nothing is sent or recorded.</p><form method="dialog"><button class="btn btn-secondary">Close preview</button></form>';
  document.body.append(dialog);
  function preview(title, lines) {
    dialog.querySelector('h2').textContent = title;
    const content = dialog.querySelector('.preview-body'); content.replaceChildren();
    lines.forEach(line => { const p = document.createElement('p'); p.textContent = line; content.append(p); });
    dialog.showModal();
  }
  document.querySelectorAll('[data-review-approval]').forEach(button => button.addEventListener('click', () => {
    const rows = picked();
    preview(`Your approval for ${money(sum(rows))}`, [
      ...rows.map(p => `${p.name}: ${money(p.amount)} gross, from ${p.project}.`),
      'This would record your first of two required approvals. It would not send money now.',
      'Once both approvals are recorded, sending follows the next eligible scheduled payout run, Friday 00:00 UTC. Current holds, limits and destination checks still apply.',
      'Gross amounts are shown. Fees and the estimated net to each member must be reviewed before an actual send.',
    ]);
  }));
  document.querySelectorAll('[data-bring-in]').forEach(button => button.addEventListener('click', () => preview('Bring in work', ['Baobab, PRJ-1042: client review. This project is already referenced in this private call.', 'Only work visible to everyone in this call can be shared here.'])));
  document.querySelector('[data-preview-note]')?.addEventListener('click', () => preview('Message to Lina Haddad', ['Baobab project conversation', document.querySelector('#client-note').value]));
  document.querySelectorAll('[data-focus-composer]').forEach(button => button.addEventListener('click', () => document.querySelector('.composer textarea')?.focus()));
  document.querySelectorAll('.composer').forEach(composer => {
    const textarea = composer.querySelector('textarea'); const send = composer.querySelector('.send');
    const sync = () => { send.disabled = !textarea.value.trim(); };
    textarea.addEventListener('input', sync); sync();
    const sendPreview = () => { if (textarea.value.trim()) preview('Message preview', [textarea.value]); };
    send.addEventListener('click', sendPreview);
    textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendPreview(); }
    });
  });
  updateSelection(); render();
  window.lucide?.createIcons();
})();

document.querySelectorAll('[data-ctx-toggle]').forEach(b => b.addEventListener('click', () => document.body.classList.toggle('ctx-off')));
