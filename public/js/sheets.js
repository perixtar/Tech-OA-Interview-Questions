// Google Sheets logging through the Apps Script webhook in scripts/google-sheets-apps-script.js.
import { store, today } from './store.js';

let serverConfig = { sheetFromEnv: false, reachable: false };

export function setServerConfig(config) {
  serverConfig = { ...serverConfig, ...config };
}

export function sheetConfigured() {
  return Boolean(store.sheetUrl || serverConfig.sheetFromEnv);
}

export function sheetSourceLabel() {
  if (store.sheetUrl) return 'Your webhook URL';
  if (serverConfig.sheetFromEnv) return 'Webhook from the server’s .env';
  return 'Not connected';
}

// Same columns the Apps Script expects (see SHEET_HEADERS there).
export function sheetRow(q, note, status = 'Solved') {
  return {
    title: q.title,
    company: (q.companies || []).join(', '),
    category: q.format || '',
    pattern: note.pattern || '',
    timeTaken: note.timeTaken || '',
    quality: note.quality || 'Solved Clean',
    status,
    dateSolved: status === 'Solved' ? note.dateSolved || today() : '',
    link: q.url,
    date: q.date,
    comments: note.comments || '',
  };
}

// Returns { ok, verified, message }. `verified` is false when we could only fire a
// no-cors request and never saw the script's reply.
export async function sendToSheet(payload) {
  if (serverConfig.reachable) {
    try {
      const res = await fetch('/api/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, webhookUrl: store.sheetUrl || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body.status !== 'error';
      return { ok, verified: true, message: body.message || (ok ? 'Logged to Google Sheet' : `HTTP ${res.status}`) };
    } catch {
      // Server went away; try the browser path below.
    }
  }
  if (!store.sheetUrl) return { ok: false, verified: true, message: 'No Google Sheet connected' };
  try {
    await fetch(store.sheetUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return { ok: true, verified: false, message: 'Sent to Google Sheet' };
  } catch (err) {
    return { ok: false, verified: true, message: err.message };
  }
}

export const pingSheet = () => sendToSheet({ action: 'ping' });

export function syncAllSolved(questions) {
  const items = questions.filter(q => store.isSolved(q.id)).map(q => sheetRow(q, store.getNote(q.id)));
  if (!items.length) return Promise.resolve({ ok: false, verified: true, message: 'Nothing solved yet' });
  return sendToSheet({ action: 'batch', items }).then(r => ({ ...r, count: items.length }));
}
