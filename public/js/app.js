import { buildBank } from './question-parser.js';
import { store, today } from './store.js';
import { pingSheet, sendToSheet, setServerConfig, sheetConfigured, sheetRow, sheetSourceLabel, syncAllSolved } from './sheets.js';
import { logFieldsHtml, readLogFields } from './log-form.js';
import { $, esc, icon, relativeTime, toast } from './ui.js';
import { renderList } from './views/list.js';
import { renderWorkspace } from './views/workspace.js';

const UPSTREAM_RAW = 'https://raw.githubusercontent.com/perixtar/Tech-OA-Interview-Questions/master/';
const SYNC_POLL_MS = 5 * 60_000;

const ctx = {
  questions: [],
  byId: new Map(),
  meta: {},
  config: { upstream: 'perixtar/Tech-OA-Interview-Questions', syncIntervalMin: 30, sheetFromEnv: false },
  server: false,
  sync: { source: 'local', syncedAt: null, syncing: false, lastError: null },
  listOrder: [],
  listState: null,
  navigate: path => {
    location.hash = path;
  },
  toggleSolved,
  openSolveDialog,
  openSettings,
  headerActions,
  bindHeaderActions,
  refreshHeader,
  syncNow,
};

/* -------------------------------------------------------------------- data */

function setQuestions(bank) {
  ctx.questions = bank.questions.map((q, index) => ({
    ...q,
    index,
    _search: `${q.title} ${q.companies.join(' ')} ${q.format}`.toLowerCase(),
  }));
  ctx.byId = new Map(ctx.questions.map(q => [q.id, q]));
  ctx.meta = bank.metadata || {};
  if (bank.sync) ctx.sync = bank.sync;
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// No server (e.g. static hosting): read the upstream markdown straight from GitHub.
async function loadFromGitHub() {
  const pages = [];
  for (let n = 1; n <= 50; n++) {
    const res = await fetch(UPSTREAM_RAW + (n === 1 ? 'README.md' : `question-bank/page-${n}.md`), { cache: 'no-cache' });
    if (!res.ok) {
      if (n === 1) throw new Error(`GitHub HTTP ${res.status}`);
      break;
    }
    pages.push(await res.text());
  }
  return buildBank(pages, { source: 'github' });
}

async function loadQuestions() {
  try {
    const [bank, config] = await Promise.all([fetchJson('/api/questions'), fetchJson('/api/config')]);
    ctx.server = true;
    ctx.config = { ...ctx.config, ...config };
    setServerConfig({ reachable: true, sheetFromEnv: config.sheetFromEnv });
    setQuestions(bank);
    return;
  } catch {
    ctx.server = false;
  }
  try {
    setQuestions(await loadFromGitHub());
    ctx.sync = { source: 'github', syncedAt: new Date().toISOString(), syncing: false, lastError: null };
    return;
  } catch {}
  setQuestions(await fetchJson('/data/questions.json'));
  ctx.sync = { source: 'bundled', syncedAt: null, syncing: false, lastError: 'Offline copy' };
}

async function syncNow({ quiet = false } = {}) {
  if (!ctx.server || ctx.sync.syncing) return;
  ctx.sync = { ...ctx.sync, syncing: true };
  refreshHeader();
  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const status = await res.json();
    ctx.sync = status;
    if (status.lastError) {
      toast(`Couldn't pull from GitHub: ${status.lastError}`, { tone: 'bad' });
    } else {
      const before = ctx.questions.length;
      setQuestions(await fetchJson('/api/questions'));
      const added = Math.max(status.added || 0, ctx.questions.length - before);
      if (added > 0) toast(`${added} new problem${added === 1 ? '' : 's'} pulled from upstream`, { tone: 'ok' });
      else if (!quiet) toast('Question bank is up to date');
      if (!location.hash.startsWith('#/problems/')) route();
    }
  } catch (err) {
    ctx.sync = { ...ctx.sync, syncing: false, lastError: err.message };
    toast('Sync failed — is the server running?', { tone: 'bad' });
  }
  refreshHeader();
}

// The server pulls on its own schedule; pick up its results without a reload.
async function pollServerSync() {
  if (!ctx.server) return;
  try {
    const status = await fetchJson('/api/sync');
    const changed = status.syncedAt && status.syncedAt !== ctx.sync.syncedAt;
    ctx.sync = { ...ctx.sync, ...status };
    if (changed) {
      const before = new Set(ctx.questions.map(q => q.url));
      setQuestions(await fetchJson('/api/questions'));
      const added = ctx.questions.filter(q => !before.has(q.url)).length;
      if (added) {
        toast(`${added} new problem${added === 1 ? '' : 's'} pulled from upstream`, { tone: 'ok' });
        if (!location.hash.startsWith('#/problems/')) route();
      }
    }
    refreshHeader();
  } catch {}
}

/* ----------------------------------------------------------- header pieces */

function syncLabel() {
  const s = ctx.sync;
  if (s.syncing) return 'Syncing…';
  if (s.source === 'github') return 'Live from GitHub';
  if (s.source === 'bundled') return 'Offline copy';
  if (s.lastError && !s.syncedAt) return 'Sync failed';
  if (s.syncedAt) return `Synced ${relativeTime(s.syncedAt)}`;
  return 'Local copy';
}

function headerActions({ sync = true } = {}) {
  const connected = sheetConfigured();
  return `
    ${sync ? `<button type="button" class="chip-btn" data-action="sync" title="Pull new problems from ${esc(ctx.config.upstream)}">
      ${icon('refresh', 14, ctx.sync.syncing ? 'spin' : '')}<span class="hide-sm" data-sync-label>${esc(syncLabel())}</span>
    </button>` : ''}
    <button type="button" class="chip-btn" data-action="sheet" title="${connected ? 'Google Sheet connected' : 'Connect a Google Sheet'}">
      <span class="dot ${connected ? 'dot-ok' : ''}" data-sheet-dot></span>${icon('sheet', 14)}<span class="hide-sm">Sheet</span>
    </button>
    <button type="button" class="icon-btn" data-action="settings" aria-label="Settings" title="Settings">${icon('sliders', 17)}</button>`;
}

function bindHeaderActions(root) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'sync') {
      if (ctx.server) syncNow();
      else toast(ctx.sync.source === 'github' ? 'Loaded live from GitHub — reload to refresh' : 'Start the server (bun run dev) to pull updates');
    }
    if (btn.dataset.action === 'sheet' || btn.dataset.action === 'settings') openSettings(btn.dataset.action === 'sheet' ? 'sheet' : null);
  });
}

function refreshHeader() {
  document.querySelectorAll('[data-sync-label]').forEach(el => {
    el.textContent = syncLabel();
    el.previousElementSibling?.classList.toggle('spin', Boolean(ctx.sync.syncing));
  });
  document.querySelectorAll('[data-sheet-dot]').forEach(el => el.classList.toggle('dot-ok', sheetConfigured()));
}

/* ------------------------------------------------------------ solve state */

async function logToSheet(q, note, status) {
  if (!sheetConfigured() || !store.prefs.autoLog) return;
  const res = await sendToSheet(sheetRow(q, note, status));
  if (res.ok) {
    toast(status === 'Solved' ? 'Logged to Google Sheet' : 'Sheet row marked unsolved', { tone: 'ok', duration: 2400 });
  } else {
    toast(`Google Sheet: ${res.message}`, { tone: 'bad' });
  }
}

function toggleSolved(q) {
  if (store.isSolved(q.id)) {
    store.markUnsolved(q.id);
    toast(`Unmarked “${q.title}”`);
    logToSheet(q, store.getNote(q.id), 'Unsolved');
    return false;
  }
  const note = store.markSolved(q.id, { dateSolved: today() });
  toast(`Solved “${q.title}”`, {
    tone: 'ok',
    action: { label: 'Add details', onClick: () => openSolveDialog(q, { eyebrow: 'Solved' }) },
  });
  logToSheet(q, note, 'Solved');
  return true;
}

function openSolveDialog(q, { eyebrow = 'Log solve', timeTaken } = {}) {
  const dialog = $('#solve-dialog');
  const note = store.getNote(q.id);
  if (timeTaken && !store.isSolved(q.id)) note.timeTaken = String(timeTaken);
  $('#solve-eyebrow').textContent = eyebrow;
  $('#solve-problem').textContent = `${q.title} · ${q.companies.join(', ')}`;
  $('#solve-fields').innerHTML = logFieldsHtml(note, 'solve');
  $('#solve-save').textContent = sheetConfigured() && store.prefs.autoLog ? 'Save & log to Sheet' : 'Save';
  dialog.returnValue = '';
  dialog.showModal();

  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const saved = dialog.returnValue === 'save';
      dialog.returnValue = '';
      if (saved) {
        const next = store.markSolved(q.id, readLogFields($('#solve-form')));
        toast(`Saved “${q.title}”`, { tone: 'ok', duration: 2200 });
        logToSheet(q, next, 'Solved');
      }
      resolve(saved);
    }, { once: true });
  });
}

/* --------------------------------------------------------------- settings */

function themeValue() {
  try {
    return localStorage.getItem('oa_color_scheme') || 'light dark';
  } catch {
    return 'light dark';
  }
}

function setTheme(value) {
  try {
    if (value === 'light dark') localStorage.removeItem('oa_color_scheme');
    else localStorage.setItem('oa_color_scheme', value);
  } catch {}
  document.querySelector('meta[name="color-scheme"]').content = value;
}

function renderSettingsState() {
  const solvedCount = ctx.questions.filter(q => store.isSolved(q.id)).length;
  $('#sheet-url').value = store.sheetUrl;
  $('#sheet-url').placeholder = ctx.config.sheetFromEnv ? 'Using the URL from the server’s .env' : 'https://script.google.com/macros/s/…/exec';
  $('#auto-log').checked = store.prefs.autoLog;
  $('#sheet-sync-all').textContent = `Sync all solved (${solvedCount})`;
  const status = $('#sheet-status');
  status.innerHTML = `<span class="dot ${sheetConfigured() ? 'dot-ok' : ''}"></span>${esc(sheetSourceLabel())}`;

  const s = ctx.sync;
  $('#bank-source').textContent = ctx.config.upstream;
  $('#bank-status').textContent = ctx.server
    ? `${ctx.questions.length.toLocaleString()} problems · ${syncLabel().toLowerCase()} · checks every ${ctx.config.syncIntervalMin} min${s.lastError ? ` · last error: ${s.lastError}` : ''}`
    : `${ctx.questions.length.toLocaleString()} problems · ${syncLabel().toLowerCase()} · start the server for automatic pulls`;
  $('#bank-sync').disabled = !ctx.server;

  const theme = themeValue();
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.checked = r.value === theme;
  });
  $('#font-size').value = String(store.prefs.fontSize);
}

function openSettings(focus) {
  const dialog = $('#settings-dialog');
  renderSettingsState();
  dialog.showModal();
  if (focus === 'sheet') $('#sheet-url').focus();
}

function bindSettings() {
  $('#sheet-save').addEventListener('click', () => {
    const url = $('#sheet-url').value.trim();
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      toast('That doesn’t look like an Apps Script /exec URL', { tone: 'bad' });
      return;
    }
    store.setSheetUrl(url);
    renderSettingsState();
    refreshHeader();
    toast(url ? 'Webhook saved' : 'Webhook cleared');
  });

  $('#sheet-test').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await pingSheet();
    btn.disabled = false;
    if (!res.ok) toast(`Connection failed: ${res.message}`, { tone: 'bad' });
    else toast(res.verified ? `Connected — ${res.message}` : 'Ping sent (the browser can’t read the reply; check your sheet)', { tone: 'ok' });
  });

  $('#sheet-sync-all').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await syncAllSolved(ctx.questions);
    btn.disabled = false;
    toast(res.ok ? `Synced ${res.count} solved problems` : res.message, { tone: res.ok ? 'ok' : 'bad' });
  });

  // Enter in the URL field should save, not submit (and close) the dialog form.
  $('#sheet-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#sheet-save').click();
    }
  });
  $('#auto-log').addEventListener('change', e => store.savePrefs({ autoLog: e.target.checked }));
  $('#bank-sync').addEventListener('click', async () => {
    await syncNow();
    renderSettingsState();
  });
  document.querySelectorAll('input[name="theme"]').forEach(r => r.addEventListener('change', () => setTheme(r.value)));
  $('#font-size').addEventListener('change', e => {
    store.savePrefs({ fontSize: Number(e.target.value) });
    window.dispatchEvent(new CustomEvent('oa:prefs'));
  });
}

/* ----------------------------------------------------------------- routing */

let cleanup = null;

function route() {
  const root = $('#app');
  cleanup?.();
  cleanup = null;
  const match = location.hash.match(/^#\/problems\/([^/?#]+)/);
  if (match) {
    document.body.dataset.view = 'workspace';
    cleanup = renderWorkspace(root, ctx, decodeURIComponent(match[1]));
  } else {
    document.body.dataset.view = 'list';
    cleanup = renderList(root, ctx);
  }
}

// Ace theme whose colors come from CSS variables, so it follows light/dark.
function defineEditorTheme() {
  if (!window.ace) return;
  ace.config.set('basePath', '/vendor/ace');
  ace.define('ace/theme/oa', ['require', 'exports'], (require, exports) => {
    exports.isDark = matchMedia('(prefers-color-scheme: dark)').matches;
    exports.cssClass = 'ace-oa';
    exports.cssText = '';
  });
}

async function init() {
  defineEditorTheme();
  bindSettings();
  try {
    await loadQuestions();
  } catch (err) {
    $('#app').innerHTML = `<div class="boot-error"><h1>Couldn’t load the question bank</h1><p>${esc(err.message)}</p><p>Run <code>bun run dev</code> and open <code>http://localhost:3000</code>.</p></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  // The server starts a pull at boot; check back soon to pick up its result.
  setTimeout(pollServerSync, 20_000);
  setInterval(pollServerSync, SYNC_POLL_MS);
  window.addEventListener('storage', e => {
    if (e.key === 'oa_color_scheme') document.querySelector('meta[name="color-scheme"]').content = e.newValue || 'light dark';
  });
}

init();
