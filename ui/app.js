const $ = selector => document.querySelector(selector);
const form = $('#config-form');
const layout = $('.layout');
const saveButton = $('#save-button');
const testButton = $('#test-button');
const keyInput = $('#api-key');
let csrf = '';
let catalog = {}, availableModels = [], dirty = false, accountInfo;
const effortInputs = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const option = (value, label = value) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
function refreshModelChoices() {
  const names = [...document.querySelectorAll('[data-route-name]')].map(x => x.value.trim()).filter(Boolean);
  for (const client of ['claude', 'codex']) {
    const select = $('#' + client + '-default-model'), selected = select.value;
    select.replaceChildren(...names.map(n => option(n)));
    if (names.includes(selected)) select.value = selected;
  }
}
function fillEfforts(card, efforts, map) {
  const grid = card.querySelector('.effort-grid'); grid.replaceChildren();
  for (const level of effortInputs) {
    const label = document.createElement('label');
    label.textContent = level === 'default' ? 'Effort gelmezse' : level;
    const select = document.createElement('select'); select.dataset.effort = level;
    select.setAttribute('aria-label', (card.querySelector('[data-route-name]').value || 'Yeni model') + ' ' + level + ' eşlemesi');
    select.replaceChildren(option('reject', 'Reddet (422)'), option('omit', 'Gönderme (model varsayılanı)'), ...efforts.map(e => option(e)));
    select.value = map?.[level] ?? (level === 'default' ? 'omit' : efforts.includes(level) ? level : 'reject');
    label.append(select); grid.append(label);
  }
}
function modelOptions(selected) {
  const ids = [...new Set([...availableModels, selected].filter(Boolean))];
  return ids.map(id => option(id));
}
function refreshUpstreamChoices() {
  for (const select of document.querySelectorAll('[data-upstream]')) {
    const selected = select.value;
    select.replaceChildren(...modelOptions(selected));
    select.value = selected;
  }
}
function addRoute(name, model) {
  const card = document.createElement('fieldset'); card.className = 'model-route'; card._model = model;
  card.innerHTML = `<legend>Model yönlendirmesi</legend><div class="field-grid">
    <label class="field">İstemcide görünen model adı<input data-route-name required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}" spellcheck="false"></label>
    <label class="field">Command Code model ID<select data-upstream required></select></label>
    <label class="field">Desteklenen effort seviyeleri<input data-efforts placeholder="low, medium, high" spellcheck="false"></label>
    <label class="field">Varsayılan maksimum çıktı<input data-max type="number" min="1" max="1000000" required></label></div>
    <p class="model-support"></p><details open><summary>İstemci effort → Command Code effort</summary><div class="effort-grid"></div></details>
    <div class="model-actions"><label><input data-vision type="checkbox"> Görsel girdi</label><button class="button secondary" type="button" data-remove>Yönlendirmeyi kaldır</button></div>`;
  card.querySelector('[data-route-name]').value = name;
  card.querySelector('[data-upstream]').replaceChildren(...modelOptions(model.upstreamModel));
  card.querySelector('[data-upstream]').value = model.upstreamModel;
  card.querySelector('[data-efforts]').value = model.efforts.join(', ');
  card.querySelector('[data-max]').value = model.defaultMaxTokens;
  card.querySelector('[data-vision]').checked = model.vision;
  const support = () => { const efforts = catalog[card.querySelector('[data-upstream]').value];
    card.querySelector('.model-support').textContent = efforts?.length
      ? 'Effort desteği: kurulu Command Code 1.54.0 kataloğu. Hesabınızın erişimi ayrıca test edilir.'
      : efforts ? 'Command Code kataloğunda; CLI bu model için effort parametresi listelemiyor.'
        : 'Katalogda yok: desteklenen seviyeleri modelinizin belgesine göre girin; canlı erişim henüz doğrulanmadı.'; };
  support(); fillEfforts(card, model.efforts, model.effortMap);
  card.querySelector('[data-route-name]').addEventListener('change', refreshModelChoices);
  card.querySelector('[data-upstream]').addEventListener('change', () => {
    const efforts = catalog[card.querySelector('[data-upstream]').value];
    if (efforts) { card.querySelector('[data-efforts]').value = efforts.join(', '); fillEfforts(card, efforts); }
    support();
  });
  card.querySelector('[data-efforts]').addEventListener('change', () => fillEfforts(card,
    card.querySelector('[data-efforts]').value.split(',').map(s => s.trim()).filter(Boolean)));
  card.querySelector('[data-remove]').addEventListener('click', () => { card.remove(); dirty = true; refreshModelChoices(); });
  $('#model-routes').append(card); refreshModelChoices();
}
function readModels() {
  const models = Object.create(null);
  for (const card of document.querySelectorAll('.model-route')) {
    const name = card.querySelector('[data-route-name]').value.trim();
    if (Object.hasOwn(models, name)) throw Error('duplicate_model');
    models[name] = { ...card._model, upstreamModel: card.querySelector('[data-upstream]').value.trim(),
      efforts: card.querySelector('[data-efforts]').value.split(',').map(s => s.trim()).filter(Boolean),
      defaultMaxTokens: Number(card.querySelector('[data-max]').value), vision: card.querySelector('[data-vision]').checked,
      effortMap: Object.fromEntries([...card.querySelectorAll('[data-effort]')].map(s => [s.dataset.effort, s.value])) };
  }
  if (!Object.keys(models).length) throw Error('missing_model');
  return models;
}

function indicator(element, state) {
  element.className = 'status-dot ' + state;
}

function result(state, title, detail) {
  const root = $('#result-content');
  indicator(root.querySelector('.status-dot'), state);
  root.querySelector('strong').textContent = title;
  root.querySelector('small').textContent = detail;
}

function summary(state, title, detail) {
  const root = $('#save-summary');
  indicator(root.querySelector('.status-dot'), state);
  root.querySelector('strong').textContent = title;
  root.querySelector('small').textContent = detail;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (!button.dataset.label) button.dataset.label = button.textContent.trim();
  const text = button.querySelector('span');
  if (text) text.textContent = busy ? label : button.dataset.label;
  else button.textContent = busy ? label : button.dataset.label;
}

function clientState(name, client) {
  const dot = $('#' + name + '-dot');
  const ready = $('#' + name + '-ready');
  const version = $('#' + name + '-version');
  indicator(dot, client.installed ? 'success' : 'error');
  ready.textContent = client.installed ? 'Hazır' : 'Bulunamadı';
  ready.style.color = client.installed ? 'var(--success)' : 'var(--error)';
  version.textContent = client.version ?? 'PATH üzerinde executable yok';
  const nodeDot = $('#' + name + '-node .status-dot');
  indicator(nodeDot, client.installed ? 'success' : 'error');
}

function render(data) {
  csrf = data.csrf;
  const config = data.config;
  catalog = data.catalog.models;
  availableModels = [...new Set(Object.values(config.models).map(model => model.upstreamModel))];
  $('#model-routes').replaceChildren();
  for (const [name, model] of Object.entries(config.models)) addRoute(name, model);
  for (const client of ['claude', 'codex']) {
    $('#' + client + '-default-model').value = config.clients[client].model;
    $('#' + client + '-default-effort').value = config.clients[client].effort;
    $('#launch-' + client).disabled = !data.clients[client].installed;
  }
  $('#trace-mode').value = config.traceMode;
  dirty = false;
  $('#workspace').value = config.workspaceId;
  $('#project-slug').value = config.projectSlug;
  $('#permission-mode').value = config.permissionMode;
  $('#taste-learning').checked = config.tasteLearning;
  keyInput.value = '';
  keyInput.placeholder = data.apiKeyConfigured ? 'Kaydedilmiş anahtarı değiştirmek için yazın' : 'Command Code API anahtarını girin';
  indicator($('#key-indicator'), data.apiKeyConfigured ? 'success' : 'error');
  $('#key-status').textContent = data.apiKeyConfigured ? 'Anahtar kayıtlı' : 'API anahtarı gerekli';
  for (const id of ['endpoint-inline', 'endpoint-map', 'endpoint-status']) $('#' + id).textContent = data.endpoint;
  $('#claude-command').textContent = data.commands.claude;
  $('#codex-command').textContent = data.commands.codex;
  clientState('claude', data.clients.claude);
  clientState('codex', data.clients.codex);
  const ready = data.apiKeyConfigured && data.clients.claude.installed && data.clients.codex.installed;
  $('#overall-status').textContent = ready ? 'Tümü hazır' : 'Ayar gerekli';
  if (data.lastSavedAt) {
    const time = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastSavedAt));
    summary('success', 'Ayarlar uygulandı', 'Son kayıt: ' + time);
  } else summary('success', 'Yapılandırma yüklendi', data.activeTurns ? data.activeTurns + ' aktif istek var.' : 'Değişiklik yapmaya hazır.');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(csrf ? { 'x-astra-admin': csrf } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({ error: { code: 'invalid_response' } }));
  if (!response.ok) throw new Error(body.error?.code ?? 'request_failed');
  return body;
}

const errors = {
  invalid_workspace: 'Çalışma alanı bulunamadı veya bir dizin değil.',
  invalid_api_key: 'API anahtarı geçerli görünmüyor.',
  invalid_model_alias: 'Model adları farklı ve yalnızca harf, sayı, nokta, alt çizgi veya tire olmalı.',
  invalid_project_slug: 'Proje slug değeri geçersiz.',
  configuration_busy: 'Aktif bir istek var. Tamamlanınca yeniden deneyin.',
  upstream_auth: 'Command Code API anahtarı reddedildi.',
  connection_test_failed: 'Model beklenen test cevabını vermedi.',
  invalid_effort_map: 'Effort hedefi, bu modelin desteklenen seviyelerinden biri olmalı.',
  unsupported_model_effort: 'Bu effort seviyesi Command Code kataloğunda model için desteklenmiyor.',
  invalid_client_effort: 'Başlangıç effort seviyesi seçili modelin eşlemesinde reddediliyor.',
  invalid_client_model: 'Her istemci için mevcut bir model yönlendirmesi seçin.',
  duplicate_model: 'Her model adı benzersiz olmalı.', missing_model: 'En az bir model yönlendirmesi gerekli.',
  unsupported_effort: 'Gelen effort, eşleme tablosunda reddediliyor.',
  upstream_http_error: 'Command Code endpointi isteği kabul etmedi.',
  upstream_rate_limit: 'Command Code hız sınırına ulaştı.',
};

function explain(error) {
  return errors[error.message] ?? 'İşlem tamamlanamadı: ' + error.message;
}

async function load() {
  try {
    render(await api('/admin/config'));
    layout.setAttribute('aria-busy', 'false');
    await Promise.all([loadModels(), loadRequests()]);
  } catch (error) {
    layout.setAttribute('aria-busy', 'false');
    summary('error', 'Servise bağlanılamadı', explain(error));
  }
}

function payload() {
  const values = Object.fromEntries(new FormData(form));
  return {
    ...(keyInput.value ? { apiKey: keyInput.value } : {}),
    models: readModels(), traceMode: $('#trace-mode').value,
    clients: Object.fromEntries(['claude', 'codex'].map(c => [c, {
      model: $('#' + c + '-default-model').value, effort: $('#' + c + '-default-effort').value }])),
    workspaceId: values.workspaceId.trim(),
    projectSlug: values.projectSlug.trim(),
    permissionMode: values.permissionMode,
    tasteLearning: $('#taste-learning').checked,
  };
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  setBusy(saveButton, true, 'Uygulanıyor…');
  summary('pending', 'Ayarlar doğrulanıyor', 'Secret ve model profili yerel olarak güncelleniyor.');
  try {
    const data = await api('/admin/config', { method: 'POST', body: JSON.stringify(payload()) });
    render(data);
    await loadModels();
    result('success', 'Ayarlar kaydedildi', 'Yeni istekler güncel model ve anahtarı kullanacak.');
  } catch (error) {
    summary('error', 'Ayarlar uygulanamadı', explain(error));
    result('error', 'Kayıt başarısız', explain(error));
    form.classList.add('shake');
    setTimeout(() => form.classList.remove('shake'), 500);
  } finally { setBusy(saveButton, false); }
});

testButton.addEventListener('click', async () => {
  setBusy(testButton, true, 'Test ediliyor…');
  result('pending', 'Bağlantı sınanıyor', 'Kısa bir gerçek inference isteği gönderiliyor.');
  try {
    if (dirty || keyInput.value) {
      const saved = await api('/admin/config', { method: 'POST', body: JSON.stringify(payload()) });
      render(saved);
    }
    const response = await api('/admin/test', { method: 'POST', body: '{}' });
    result('success', 'Bağlantı başarılı', response.model + ' · ' + response.latencyMs + ' ms');
    indicator($('#key-indicator'), 'success');
    $('#key-status').textContent = 'Anahtar doğrulandı';
    await Promise.all([loadModels(), loadRequests()]);
  } catch (error) { result('error', 'Bağlantı başarısız', explain(error)); }
  finally { setBusy(testButton, false); }
});

$('#toggle-key').addEventListener('click', () => {
  const hidden = keyInput.type === 'password';
  keyInput.type = hidden ? 'text' : 'password';
  $('#toggle-key').setAttribute('aria-label', hidden ? 'Anahtarı gizle' : 'Anahtarı göster');
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const value = $('#' + button.dataset.copy).textContent;
  try {
    await navigator.clipboard.writeText(value);
    const old = button.title, oldLabel = button.getAttribute('aria-label');
    button.title = 'Kopyalandı';
    button.setAttribute('aria-label', 'Kopyalandı');
    setTimeout(() => { button.title = old; button.setAttribute('aria-label', oldLabel); }, 1300);
  } catch { result('error', 'Kopyalanamadı', 'Komutu seçip Ctrl+C ile kopyalayın.'); }
});

async function loadAccount() {
  try {
    accountInfo = await api('/admin/account');
    $('#account-status').textContent = accountInfo.verified
      ? 'Doğrulanmış hesap: ' + accountInfo.userName + ' · anahtar izi ' + accountInfo.fingerprint
      : 'Hesap doğrulanamadı. Anahtar kayıtlı olması doğru hesapta olduğumuzu kanıtlamaz.';
  } catch { $('#account-status').textContent = 'Hesap bilgisi alınamadı.'; }
}
async function loadModels() {
  $('#model-catalog-status').textContent = 'Command Code hesabı ve model kataloğu doğrulanıyor…';
  try {
    const data = await api('/admin/models');
    accountInfo = data.account;
    catalog = data.catalog.models;
    availableModels = Object.keys(catalog);
    refreshUpstreamChoices();
    $('#account-status').textContent = 'Doğrulanmış hesap: ' + accountInfo.userName + ' · anahtar izi ' + accountInfo.fingerprint;
    $('#model-catalog-status').textContent = availableModels.length + ' model · Command Code hesabı doğrulandı · CLI ' + data.source.replace('command-code-cli-', '');
  } catch (error) {
    $('#model-catalog-status').textContent = 'Model kataloğu doğrulanamadı: ' + explain(error);
    await loadAccount();
  }
}
async function loadRequests() {
  try {
    const data = await api('/admin/requests');
    $('#request-summary').textContent = data.activeTurns + ' aktif istek · Son ' + data.requests.length + ' kayıt (bellekte). Prompt ve araç içeriği kaydedilmez.';
    const num = n => n == null ? '?' : n.toLocaleString('tr-TR');
    const seconds = n => n == null ? '—' : (n / 1000).toFixed(2) + ' s';
    $('#request-rows').replaceChildren(...data.requests.slice().reverse().map(r => {
      const m = r.metrics ?? {}, tr = document.createElement('tr');
      for (const text of [new Date(r.at).toLocaleTimeString('tr-TR') + ' · ' + r.protocol,
        (m.publicModel ?? '—') + ' → ' + (m.upstreamModel ?? '—'),
        (m.requestedEffort ?? 'varsayılan') + ' → ' + (m.upstreamEffort ?? 'gönderilmedi'),
        seconds(m.firstContentMs) + ' / ' + seconds(r.durationMs),
        num(m.inputTokens) + ' / ' + num(m.cacheReadTokens) + ' / ' + num(m.uncachedInputTokens),
        r.traceId ?? 'gönderilmedi', r.outcome === 'ok' ? 'Tamamlandı' : (r.code ?? 'Hata') + (r.param ? ' (' + r.param + ')' : '')]) {
        const td = document.createElement('td'); td.textContent = text; tr.append(td);
      }
      tr.title = 'Hesap izi: ' + (m.accountFingerprint ?? '?') + ' · Sabit prompt bölümleri: ' +
        (m.samePrefixAsPrevious === null ? 'ilk istek' : m.samePrefixAsPrevious ? 'aynı' : 'değişti') + ' · Metin parçası: ' + (m.textDeltas ?? 0) +
        ' · Araç parçası: ' + (m.toolDeltas ?? 0) + ' · İlk metin: ' + seconds(m.firstTextMs) + ' · İlk araç: ' + seconds(m.firstToolMs);
      return tr;
    }));
  } catch { $('#request-summary').textContent = 'İstek kayıtları alınamadı. Yenile ile tekrar deneyin.'; }
}
form.addEventListener('input', () => { dirty = true; });
form.addEventListener('change', () => { dirty = true; });
$('#add-model').addEventListener('click', () => {
  addRoute('yeni-model-' + (document.querySelectorAll('.model-route').length + 1), {
    upstreamModel: '', defaultMaxTokens: 64000, vision: true, reasoningText: 'verified', efforts: [], clientToolSearch: false }); dirty = true;
});
$('#refresh-requests').addEventListener('click', loadRequests);
for (const client of ['claude', 'codex']) $('#launch-' + client).addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  const button = $('#launch-' + client); setBusy(button, true, 'Açılıyor…');
  try {
    if (dirty) render(await api('/admin/config', { method: 'POST', body: JSON.stringify(payload()) }));
    button.disabled = true;
    const launched = await api('/admin/launch', { method: 'POST', body: JSON.stringify({ client }) });
    result('success', 'Terminal açıldı', client + ' · işlem ' + launched.pid + ' · seçilen model ve effort ile başlatıldı.');
  } catch (error) { result('error', 'Başlatılamadı', explain(error)); }
  finally { setBusy(button, false); }
});
load();
setInterval(() => { if (!document.hidden && csrf) loadRequests(); }, 5000);
