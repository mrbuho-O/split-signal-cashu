import QRCode from 'qrcode';
import { allocate, makeDemoRequest, MAX_RECIPIENTS, MAX_TOTAL, MAX_WEIGHT, paymentURI, readTemplate, REQUEST_MAX } from './payment.js';

const colors = ['#943e4b', '#b57632', '#526c62', '#6b5081', '#486783', '#7d6448'];
const number = new Intl.NumberFormat('en-US');
const container = document.querySelector('#app');
const example = {
  show: 'The Listening Room',
  episode: 'Who gets to be heard?',
  notes: 'Support the people behind this episode. Choose a boost, then send each share from your Cashu wallet.',
  demo: true,
  recipients: [
    { name: 'Mara Reyes', role: 'Host', weight: 60, request: makeDemoRequest('host') },
    { name: 'Theo Lin', role: 'Guest', weight: 25, request: makeDemoRequest('guest') },
    { name: 'Room Tone Studio', role: 'Sound design', weight: 15, request: makeDemoRequest('sound') },
  ],
};
const newEpisode = () => ({ show: '', episode: '', notes: '', demo: false, recipients: [newRecipient()] });
const newRecipient = () => ({ name: '', role: '', weight: 1, request: '' });

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function checked(model) {
  if (!model || typeof model !== 'object' || !Array.isArray(model.recipients) || model.recipients.length > MAX_RECIPIENTS) {
    throw new Error('This episode file could not be read.');
  }
  const show = String(model.show ?? '').trim().slice(0, 72);
  const episode = String(model.episode ?? '').trim().slice(0, 100);
  const notes = String(model.notes ?? '').trim().slice(0, 360);
  if (!show || !episode) throw new Error('Enter a show name and an episode title.');
  const recipients = model.recipients.map((row, index) => {
    const name = String(row.name ?? '').trim().slice(0, 64);
    if (!name) throw new Error(`Enter a name for recipient ${index + 1}.`);
    const request = String(row.request ?? '').trim();
    const role = String(row.role ?? '').trim().slice(0, 40);
    try {
      readTemplate(request, model.demo === true);
    } catch (error) {
      throw new Error(`${name}: ${explain(error)}`);
    }
    return { name, role, weight: Number(row.weight), request };
  });
  allocate(500, recipients.map(row => row.weight));
  if (new Set(recipients.map(item => item.request)).size < recipients.length) {
    throw new Error('Give each recipient their own Cashu request.');
  }
  return { show, episode, notes, demo: model.demo === true, recipients };
}

function explain(error) {
  const detail = String(error.message ?? '');
  return /^(Paste|Invalid |Incomplete Cashu|This Cashu request|Create a |Use a |The Cashu request|Enter a )/.test(detail)
    ? detail
    : 'The payment request could not be decoded. Copy it again from the receiving wallet.';
}

function topBar(view, published = false) {
  return `<header class="mast"><div class="wrap mast-inner">
    <div class="wordmark"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span> Split Signal</div>
    ${published ? '<span class="mast-note">Cashu episode boosts</span>' : `<nav aria-label="Workspace">
      <button data-action="studio" ${view === 'studio' ? 'aria-current="page"' : ''}>Studio</button>
      <button data-action="preview" ${view === 'preview' ? 'aria-current="page"' : ''}>Listener preview</button>
    </nav>`}</div></header>`;
}

function footer() {
  return '<footer class="wrap footer"><span>Split Signal</span><a href="https://cashubtc.github.io/nuts/18/" target="_blank" rel="noopener noreferrer">Cashu payment requests <span aria-hidden="true">↗</span></a></footer>';
}

let draft = structuredClone(example);
let view = 'studio';
let total = 500;
let current = null;
let published = false;
let active = 0;
let marked = new Set();
let revision = 0;

function getParts(rows, value) {
  return allocate(value, rows.map(row => Number(row.weight)));
}

function splitStrip(model, shares, whole) {
  return `<div class="split-strip" aria-hidden="true">${shares.map((share, index) => share > 0
    ? `<span style="--portion:${share / whole};--tint:${colors[index % colors.length]}" title="${escape(model.recipients[index].name)}"></span>`
    : '').join('')}</div>`;
}

function summary() {
  try {
    const shares = getParts(draft.recipients, 500);
    return `${splitStrip(draft, shares, 500)}<ul class="mini-breakdown">${draft.recipients.map((row, index) => `<li>
      <span class="part-dot" style="--tint:${colors[index % colors.length]}"></span><span>${escape(row.name || `Recipient ${index + 1}`)}</span><strong>${number.format(shares[index])} <small>sats</small></strong></li>`).join('')}</ul>`;
  } catch {
    return '<p class="quiet">Use whole, positive weights to calculate the shares.</p>';
  }
}

function recipientRow(row, index) {
  const id = `person-${index}`;
  return `<li class="recipient" data-index="${index}">
    <div class="recipient-head"><span class="part-dot" style="--tint:${colors[index % colors.length]}"></span><strong>Recipient ${index + 1}</strong>
      <button class="text-button remove" type="button" data-action="remove" aria-label="Remove recipient ${index + 1}" ${draft.recipients.length === 1 ? 'disabled' : ''}>Remove</button></div>
    <div class="recipient-fields">
      <label for="${id}-name">Name<input id="${id}-name" data-field="name" maxlength="64" value="${escape(row.name)}" placeholder="Name or studio"></label>
      <label for="${id}-role">Role <small>Optional</small><input id="${id}-role" data-field="role" maxlength="40" value="${escape(row.role)}" placeholder="Host, guest, editor"></label>
      <label for="${id}-weight">Weight<input id="${id}-weight" data-field="weight" type="number" inputmode="numeric" min="1" max="${MAX_WEIGHT}" step="1" value="${escape(row.weight)}"></label>
    </div>
    <label for="${id}-request">Cashu receiving request<input id="${id}-request" class="request-input" data-field="request" type="text" maxlength="${REQUEST_MAX}" spellcheck="false" autocapitalize="none" autocomplete="off" value="${escape(row.request)}" placeholder="creqA… or CREQB1…" aria-describedby="${id}-status"></label>
    <p id="${id}-status" class="request-status">${requestStatus(row)}</p>
  </li>`;
}

function requestStatus(row) {
  if (!row.request) return 'Use a reusable request with no fixed amount.';
  try {
    const result = readTemplate(row.request, draft.demo);
    const mintText = result.mints.length ? `${result.mints.length} ${result.mintPreferred ? 'preferred' : 'accepted'} ${result.mints.length === 1 ? 'mint' : 'mints'}` : 'any mint';
    return `<span class="status-ok">${draft.demo ? 'Demo destination' : `Ready · ${escape(result.destinations[0].kind)}`}</span> ${escape(result.destinations[0].label)} · ${mintText}`;
  } catch (error) {
    return `<span class="status-error">${escape(explain(error))}</span>`;
  }
}

function renderStudio() {
  view = 'studio';
  container.innerHTML = `${topBar(view)}<main class="wrap" id="main-content">
    <section class="intro"><div><p class="eyebrow">Creator studio</p><h1>Share the boost.</h1>
      <p>Give hosts, guests and everyone behind the episode a share. Listeners choose the total and pay each person from their Cashu wallet.</p></div>
      <button type="button" class="button quiet-button" data-action="${draft.demo ? 'new' : 'example'}">${draft.demo ? 'Start my own episode' : 'Load example'}</button></section>
    ${draft.demo ? '<p class="demo-note"><strong>Example episode.</strong> The demo addresses cannot receive funds.</p>' : ''}
    <div class="studio-grid">
      <div class="studio-form">
        <section class="box episode-fields" aria-labelledby="episode-title"><h2 id="episode-title">Episode details</h2>
          <div class="episode-inputs">
            <label>Show name<input data-model="show" value="${escape(draft.show)}" maxlength="72" placeholder="Your podcast name"></label>
            <label>Episode title<input data-model="episode" value="${escape(draft.episode)}" maxlength="100" placeholder="This week's episode"></label>
          </div>
          <label>Note to listeners <small>Optional</small><textarea data-model="notes" maxlength="360" rows="2" placeholder="Tell listeners who their sats support.">${escape(draft.notes)}</textarea></label>
        </section>
        <section class="box participants" aria-labelledby="recipient-title">
          <div class="section-head"><div><h2 id="recipient-title">Recipients</h2><p>Weights show each person's share. They do not have to add to 100.</p></div><button type="button" class="button outline" data-action="import">Import RSS splits</button></div>
          <input id="rss-file" type="file" accept=".xml,.rss,application/rss+xml,application/xml,text/xml" hidden>
          <ul>${draft.recipients.map(recipientRow).join('')}</ul>
          <button type="button" class="button outline" data-action="add" ${draft.recipients.length >= MAX_RECIPIENTS ? 'disabled' : ''}>+ Add recipient</button>
          <details class="wallet-help"><summary>Where to find a Cashu request</summary><p>Ask each person for a reusable Cashu payment request without an amount, with Nostr or HTTPS delivery enabled. In Cashu.me, enable <strong>Payment requests</strong> in Settings, then use <strong>Receive → Ecash → Request</strong>. Test each destination with your collaborators before publishing.</p></details>
        </section>
      </div>
      <aside class="box preview-card" aria-labelledby="breakdown-title">
        <p class="eyebrow">Example boost</p><div class="preview-total"><h2 id="breakdown-title">500</h2><span>sats</span></div>
        <div id="summary">${summary()}</div>
        <button type="button" class="button primary" data-action="preview">Preview listener page <span aria-hidden="true">→</span></button>
        <p class="minor">Download a stand-alone HTML page to publish with your show notes.</p>
        <p class="feedback" id="studio-status" role="status"></p>
      </aside>
    </div>
    <dialog id="rss-dialog"><form method="dialog"><h2>Choose RSS splits</h2><p>Recipient names and weights are imported. Add each person's Cashu request afterward.</p><div id="rss-options"></div><div class="dialog-actions"><button class="button outline" value="cancel">Cancel</button><button class="button primary" data-action="apply-rss" value="apply">Import</button></div></form></dialog>
    <dialog id="replace-dialog"><form method="dialog"><h2>Replace this draft?</h2><p>Copy the current details before loading the example.</p><div class="dialog-actions"><button class="button outline" value="cancel">Cancel</button><button class="button primary" data-action="confirm-example" value="replace">Load example</button></div></form></dialog>
  </main>${footer()}`;
}

function listenerRows() {
  const shares = getParts(current.recipients, total);
  return `<div class="listener-split">${splitStrip(current, shares, total)}</div><ol class="listener-rows">${current.recipients.map((row, index) => `
    <li><button class="share-row" data-action="select" data-index="${index}" aria-pressed="${index === active}" ${shares[index] === 0 ? 'disabled' : ''}>
      <span class="part-dot" style="--tint:${colors[index % colors.length]}" aria-hidden="true"></span>
      <span class="share-person"><strong>${escape(row.name)}</strong>${row.role ? `<small>${escape(row.role)}</small>` : ''}</span>
      <span class="share-value">${number.format(shares[index])} <small>sats</small>${marked.has(index) ? '<small class="sent">Marked sent</small>' : ''}</span>
      <span class="chevron" aria-hidden="true">›</span></button></li>`).join('')}</ol>`;
}

function listenerPayment() {
  const shares = getParts(current.recipients, total);
  if (!shares[active]) active = shares.findIndex(share => share > 0);
  const row = current.recipients[active];
  const sats = shares[active];
  const template = readTemplate(row.request, current.demo);
  return `<p class="eyebrow">${current.demo ? 'Wallet preview' : 'Cashu request'}</p><h2>${escape(row.name)}</h2>
    <div class="payment-amount"><strong>${number.format(sats)}</strong><span>sats</span></div>
    <div class="qr-frame"><canvas id="pay-qr" aria-label="${current.demo ? 'Sample QR without a payment destination' : `Scan to request ${sats} sats for ${escape(row.name)}`}" role="img"></canvas></div>
    ${current.demo ? '<p class="quiet qr-hint">This sample QR cannot request funds.</p>' : `<div class="pay-actions"><button type="button" class="button primary" data-action="copy">Copy request</button><a class="button outline" href="${escape(paymentURI(template.withAmount(sats)))}">Open wallet <span aria-hidden="true">↗</span></a></div><p class="minor qr-hint">Approve in your wallet. Pay each share separately.</p>`}
    <button type="button" class="text-button mark-button" data-action="mark">${marked.has(active) ? 'Undo sent mark' : current.demo ? 'Try marking this share sent' : 'Mark as sent'}</button>
    <p class="feedback" id="listener-status" role="status"></p>`;
}

function renderListener() {
  view = 'preview';
  container.innerHTML = `${topBar(view, published)}<main class="wrap listener" id="main-content">
    ${published ? '' : `<div class="preview-actions"><button class="text-button" data-action="studio" type="button">← Back to studio</button><button class="button outline" data-action="download" type="button">Download ${current.demo ? 'example' : 'support page'} <span aria-hidden="true">↓</span></button></div>`}
    <section class="listener-intro"><p class="eyebrow">${escape(current.show)}</p><h1>${escape(current.episode)}</h1><p>${escape(current.notes || 'Send a Cashu boost to the people who made this episode.')}</p></section>
    ${current.demo ? '<p class="demo-note"><strong>Example episode.</strong> These shares are for practice.</p>' : ''}
    <div class="listener-grid"><section class="box amount-box" aria-labelledby="amount-title"><h2 id="amount-title">Your boost</h2>
      <div class="amount-controls"><div class="presets" aria-label="Suggested amounts">${[100, 500, 1000].map(value => `<button class="preset" data-action="amount" data-value="${value}" type="button" aria-pressed="${value === total}">${number.format(value)}</button>`).join('')}</div>
      <label class="amount-label" for="boost-value">Custom sats<input id="boost-value" type="number" inputmode="numeric" min="1" max="${MAX_TOTAL}" step="1" value="${total}"></label></div>
      <p class="feedback" id="amount-status" role="status"></p>
      <div class="allocation-head"><h3>Who gets what</h3><p id="sent-count" aria-live="polite"></p></div><div id="listener-rows"></div>
      <p class="minor">Sent marks are for your own checklist. Your wallet shows whether the payment went through.</p>
    </section><section class="box payment-box" id="listener-payment" aria-label="Selected Cashu payment request"></section></div>
  </main>${footer()}`;
  updateListener();
}

function updateListener() {
  const shares = getParts(current.recipients, total);
  if (!shares[active]) active = shares.findIndex(share => share > 0);
  document.querySelector('#listener-rows').innerHTML = listenerRows();
  document.querySelector('#listener-payment').innerHTML = listenerPayment();
  document.querySelector('#sent-count').textContent = `${marked.size} of ${shares.filter(Boolean).length} marked sent`;
  const canvas = document.querySelector('#pay-qr');
  const request = current.demo ? `Split Signal demo: ${current.recipients[active].name}, ${shares[active]} sats`
    : readTemplate(current.recipients[active].request).withAmount(shares[active]);
  const rendering = ++revision;
  QRCode.toCanvas(canvas, request, { errorCorrectionLevel: 'M', width: 224, margin: 3, color: { dark: '#2a2020', light: '#ffffff' } }).catch(() => {
    if (revision !== rendering) return;
    canvas.hidden = true;
    const hint = document.querySelector('.qr-hint');
    if (hint) hint.textContent = 'This request is too long for QR. Use Copy request or Open wallet.';
  });
}

function feedback(id, message, isError = false) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('status-error', isError);
}

function startPreview() {
  try {
    current = checked(draft);
  } catch (error) {
    feedback('studio-status', error.message, true);
    document.querySelector('#studio-status')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  total = 500;
  active = 0;
  marked.clear();
  renderListener();
  focusMain();
}

function focusMain() {
  window.scrollTo(0, 0);
  const heading = document.querySelector('main h1');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function setAmount(value) {
  if (value === total) return;
  total = value;
  marked.clear();
  document.querySelector('#boost-value').value = value;
  document.querySelectorAll('[data-action="amount"]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.value) === value)));
  updateListener();
}

function downloadPage() {
  const copy = document.documentElement.cloneNode(true);
  copy.querySelector('#app').replaceChildren();
  copy.querySelector('#episode-data').textContent = JSON.stringify(current).replace(/</g, '\\u003c');
  copy.querySelector('title').textContent = `Support ${current.show}`;
  copy.querySelector('meta[name="description"]').content = 'Send a Cashu boost to the people who made this episode.';
  const url = URL.createObjectURL(new Blob(['<!doctype html>\n', copy.outerHTML], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${current.episode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'episode'}-support.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyRequest() {
  const share = getParts(current.recipients, total)[active];
  const request = readTemplate(current.recipients[active].request).withAmount(share);
  try {
    await navigator.clipboard.writeText(request);
    feedback('listener-status', 'Copied. Paste the request into your Cashu wallet.');
  } catch {
    const field = document.createElement('textarea');
    field.className = 'manual-copy';
    field.setAttribute('aria-label', 'Cashu request to copy');
    field.readOnly = true;
    field.value = request;
    document.querySelector('.manual-copy')?.remove();
    document.querySelector('#listener-status').before(field);
    field.focus();
    field.select();
    feedback('listener-status', 'Copy the selected request and paste it into your wallet.');
  }
}

const podcastNamespace = 'https://podcastindex.org/namespace/1.0';
let importOptions = [];

async function readRSS(file) {
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Choose an RSS file smaller than 2 MB.');
    const xml = await file.text();
    if (/<!DOCTYPE/i.test(xml)) throw new Error('Use an RSS file without a document type declaration.');
    const data = new DOMParser().parseFromString(xml, 'application/xml');
    const channel = data.querySelector('rss > channel');
    if (data.querySelector('parsererror') || !channel) throw new Error('The file is not a readable RSS feed.');
    const ns = tag => tag.namespaceURI?.replace(/\/$/, '') === podcastNamespace;
    const title = node => [...node.children].find(child => child.localName === 'title' && !child.namespaceURI)?.textContent?.trim() || '';
    const show = title(channel).slice(0, 72);
    const sources = [channel, ...[...channel.children].filter(child => child.localName === 'item' && !child.namespaceURI).slice(0, 100)];
    importOptions = sources.flatMap((node, index) => {
      const values = [...node.children].filter(child => ns(child) && child.localName === 'value');
      const value = values.find(el => el.getAttribute('type') === 'lightning') ?? values[0];
      if (!value) return [];
      const recipients = [...value.children].filter(child => ns(child) && child.localName === 'valueRecipient' && child.getAttribute('fee') !== 'true').map((child, position) => ({
        ...newRecipient(), name: (child.getAttribute('name') || `Recipient ${position + 1}`).slice(0, 64), weight: Number(child.getAttribute('split')),
      })).filter(row => Number.isInteger(row.weight) && row.weight > 0 && row.weight <= MAX_WEIGHT);
      if (!recipients.length || recipients.length > MAX_RECIPIENTS) return [];
      return [{ title: index === 0 ? 'Show-level splits' : title(node) || `Episode ${index}`, episode: index ? title(node).slice(0, 100) : '', show, recipients }];
    });
    if (!importOptions.length) throw new Error('No supported Podcasting 2.0 splits were found in this feed.');
    document.querySelector('#rss-options').innerHTML = `<label>Use splits from<select id="rss-choice">${importOptions.map((option, index) => `<option value="${index}">${escape(option.title)}</option>`).join('')}</select></label>`;
    document.querySelector('#rss-dialog').showModal();
  } catch (error) {
    feedback('studio-status', error.message, true);
  }
}

container.addEventListener('input', event => {
  const el = event.target;
  if (view === 'studio' && el.dataset.model) draft[el.dataset.model] = el.value;
  if (view === 'studio' && el.dataset.field) {
    const parent = el.closest('[data-index]');
    const row = draft.recipients[Number(parent.dataset.index)];
    row[el.dataset.field] = el.value;
    if (el.dataset.field === 'request') parent.querySelector('.request-status').innerHTML = requestStatus(row);
    if (el.dataset.field === 'weight' || el.dataset.field === 'name') document.querySelector('#summary').innerHTML = summary();
  }
  if (el.id === 'boost-value') {
    if (!el.validity.valid || !el.value) {
      feedback('amount-status', 'Enter a whole number of sats from 1 to 10,000,000.', true);
      return;
    }
    feedback('amount-status', '');
    setAmount(Number(el.value));
  }
});

container.addEventListener('change', event => {
  if (event.target.id !== 'rss-file') return;
  readRSS(event.target.files[0]);
  event.target.value = '';
});

container.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'studio':
      if (view !== 'studio') { renderStudio(); focusMain(); }
      break;
    case 'preview':
      if (view !== 'preview') startPreview();
      break;
    case 'new':
      draft = newEpisode(); renderStudio(); document.querySelector('[data-model="show"]').focus();
      break;
    case 'example': document.querySelector('#replace-dialog').showModal(); break;
    case 'confirm-example':
      event.preventDefault(); draft = structuredClone(example); renderStudio(); focusMain();
      break;
    case 'add':
      if (draft.recipients.length < MAX_RECIPIENTS) {
        draft.recipients.push(newRecipient()); renderStudio(); document.querySelector(`#person-${draft.recipients.length - 1}-name`).focus();
      }
      break;
    case 'remove': {
      const index = Number(button.closest('[data-index]').dataset.index);
      draft.recipients.splice(index, 1); renderStudio(); document.querySelector(`#person-${Math.max(0, index - 1)}-name`).focus();
      break;
    }
    case 'import': document.querySelector('#rss-file').click(); break;
    case 'apply-rss': {
      event.preventDefault();
      const imported = importOptions[Number(document.querySelector('#rss-choice').value)];
      draft = { ...newEpisode(), show: imported.show || (draft.demo ? '' : draft.show), episode: imported.episode, recipients: imported.recipients };
      renderStudio(); document.querySelector('#person-0-request').focus();
      feedback('studio-status', 'Splits imported. Add each recipient’s Cashu request.');
      break;
    }
    case 'amount':
      feedback('amount-status', '');
      document.querySelector('#boost-value').value = button.dataset.value;
      setAmount(Number(button.dataset.value));
      break;
    case 'select':
      active = Number(button.dataset.index); updateListener(); document.querySelector(`.share-row[data-index="${active}"]`).focus();
      break;
    case 'mark':
      if (marked.has(active)) marked.delete(active);
      else marked.add(active);
      updateListener(); document.querySelector('.mark-button').focus();
      break;
    case 'copy': if (!current.demo) copyRequest(); break;
    case 'download': downloadPage(); break;
  }
});

try {
  const incoming = JSON.parse(document.querySelector('#episode-data').textContent);
  if (incoming) {
    current = checked(incoming);
    published = true;
    renderListener();
  } else renderStudio();
} catch {
  container.innerHTML = `${topBar('preview', true)}<main id="main-content" class="wrap intro"><div><h1>Episode page unavailable</h1><p>Ask the creator for a fresh copy of this page.</p></div></main>${footer()}`;
}
