import express from 'express';
import cors from 'cors';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { EXTRACTOR_VERSION, parseProblemHtml } from './extractor';
import { QuestionStore, UPSTREAM_REPO } from './questions';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SYNC_INTERVAL_MIN = parseInt(process.env.SYNC_INTERVAL_MIN || '30', 10);
const ROOT = process.cwd();
const PROBLEMS_DIR = join(ROOT, 'data', 'problems');

const SHEET_URL_PATTERN = /^https:\/\/script\.google(?:usercontent)?\.com\/macros\/s\/[\w-]+\/exec$/;
const ENV_SHEET_URL = [process.env.GSHEET_WEBHOOK_URL, process.env.URL]
  .map(v => (v || '').trim())
  .find(v => SHEET_URL_PATTERN.test(v)) || '';

if (!existsSync(PROBLEMS_DIR)) {
  mkdirSync(PROBLEMS_DIR, { recursive: true });
}

const store = new QuestionStore(ROOT);
await store.load();
store.startAutoSync(SYNC_INTERVAL_MIN);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(ROOT, 'public')));
app.use('/vendor', express.static(join(ROOT, 'vendor')));
app.use('/assets', express.static(join(ROOT, 'assets')));
app.use('/data', express.static(join(ROOT, 'data')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', runtime: 'bun', port: PORT });
});

app.get('/api/config', (_req, res) => {
  res.json({
    upstream: UPSTREAM_REPO,
    syncIntervalMin: SYNC_INTERVAL_MIN,
    sheetFromEnv: Boolean(ENV_SHEET_URL),
  });
});

app.get('/api/questions', (_req, res) => {
  res.json({ ...store.bank, sync: store.status });
});

app.get('/api/sync', (_req, res) => {
  res.json({ ...store.status, total: store.bank?.metadata.total ?? 0 });
});

app.post('/api/sync', async (_req, res) => {
  const status = await store.sync();
  res.status(status.lastError ? 502 : 200).json({ ...status, total: store.bank?.metadata.total ?? 0 });
});

app.get('/api/problem', async (req, res) => {
  const id = String(req.query.id || '').trim();
  const url = String(req.query.url || `https://www.fastprep.io/problems/${id}`).trim();

  if (!/^[\w-]{1,160}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid problem id' });
  }
  if (!url.startsWith('https://www.fastprep.io/')) {
    return res.status(400).json({ error: 'Only fastprep.io problem URLs are supported' });
  }

  const cachePath = join(PROBLEMS_DIR, `${id}.json`);
  let cached: any = null;
  if (existsSync(cachePath)) {
    try {
      cached = JSON.parse(await readFile(cachePath, 'utf-8'));
      if (cached.v === EXTRACTOR_VERSION) return res.json(cached);
    } catch {}
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error(`FastPrep returned HTTP ${response.status}`);

    const parsed = parseProblemHtml(id, await response.text());
    await writeFile(cachePath, JSON.stringify(parsed, null, 2), 'utf-8');
    return res.json(parsed);
  } catch (err: any) {
    // An older cache entry beats nothing when FastPrep is unreachable.
    if (cached) return res.json(cached);
    return res.status(502).json({ error: err.message || 'Failed to fetch problem' });
  }
});

// Forwards progress rows to the Google Apps Script webhook (scripts/google-sheets-apps-script.js).
// Going through the server lets the app read the script's JSON reply, which a browser
// can't do because Apps Script doesn't send CORS headers.
app.post('/api/sheet', async (req, res) => {
  const { payload, webhookUrl } = req.body || {};
  const target = typeof webhookUrl === 'string' && webhookUrl.trim() ? webhookUrl.trim() : ENV_SHEET_URL;

  if (!target) {
    return res.status(400).json({ status: 'error', message: 'No Google Sheet webhook configured' });
  }
  if (!SHEET_URL_PATTERN.test(target)) {
    return res.status(400).json({ status: 'error', message: 'Webhook must be a Google Apps Script /exec URL' });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ status: 'error', message: 'Missing payload' });
  }

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { status: response.ok ? 'success' : 'error', message: text.slice(0, 200) };
    }
    return res.status(response.ok ? 200 : 502).json(body);
  } catch (err: any) {
    return res.status(502).json({ status: 'error', message: err.message || 'Could not reach Google Apps Script' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
