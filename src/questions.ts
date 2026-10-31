import { existsSync, mkdirSync, readdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { buildBank } from '../public/js/question-parser.js';

export const UPSTREAM_REPO = process.env.UPSTREAM_REPO || 'perixtar/Tech-OA-Interview-Questions';
export const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH || 'master';
const RAW_BASE = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}/`;
const MAX_PAGES = 50;

export interface SyncStatus {
  source: 'upstream' | 'local' | 'cache';
  syncedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  added: number;
  syncing: boolean;
}

type Bank = ReturnType<typeof buildBank>;

async function fetchText(path: string): Promise<string | null> {
  const res = await fetch(RAW_BASE + path, { headers: { 'Cache-Control': 'no-cache' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status} for ${path}`);
  return res.text();
}

export async function fetchUpstreamPages(): Promise<string[]> {
  const readme = await fetchText('README.md');
  if (!readme) throw new Error(`README.md not found in ${UPSTREAM_REPO}`);
  const pages = [readme];
  for (let n = 2; n <= MAX_PAGES; n++) {
    const page = await fetchText(`question-bank/page-${n}.md`);
    if (!page) break;
    pages.push(page);
  }
  return pages;
}

export async function readLocalPages(root: string): Promise<string[]> {
  const pages = [await readFile(join(root, 'README.md'), 'utf-8')];
  const dir = join(root, 'question-bank');
  if (existsSync(dir)) {
    const files = readdirSync(dir)
      .map(f => ({ f, n: Number(f.match(/^page-(\d+)\.md$/)?.[1]) }))
      .filter(x => x.n)
      .sort((a, b) => a.n - b.n);
    for (const { f } of files) pages.push(await readFile(join(dir, f), 'utf-8'));
  }
  return pages;
}

export class QuestionStore {
  bank: Bank | null = null;
  status: SyncStatus = { source: 'local', syncedAt: null, lastAttemptAt: null, lastError: null, added: 0, syncing: false };
  private timer: ReturnType<typeof setInterval> | null = null;
  private cachePath: string;

  constructor(private root: string) {
    const cacheDir = join(root, 'data', '.cache');
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    this.cachePath = join(cacheDir, 'questions.json');
  }

  // Last upstream snapshot if we have one, otherwise the checked-out markdown.
  async load() {
    if (existsSync(this.cachePath)) {
      try {
        this.bank = JSON.parse(await readFile(this.cachePath, 'utf-8'));
        this.status.source = 'cache';
        this.status.syncedAt = this.bank!.metadata.syncedAt ?? null;
        return;
      } catch {}
    }
    this.bank = buildBank(await readLocalPages(this.root), { source: 'local', repo: UPSTREAM_REPO });
    this.status.source = 'local';
  }

  async sync(): Promise<SyncStatus> {
    if (this.status.syncing) return this.status;
    this.status.syncing = true;
    this.status.lastAttemptAt = new Date().toISOString();
    try {
      const pages = await fetchUpstreamPages();
      const syncedAt = new Date().toISOString();
      const next = buildBank(pages, { source: 'upstream', repo: UPSTREAM_REPO, syncedAt });
      const previous = new Set(this.bank?.questions.map(q => q.url) ?? []);
      this.status.added = previous.size ? next.questions.filter(q => !previous.has(q.url)).length : 0;
      this.bank = next;
      this.status.source = 'upstream';
      this.status.syncedAt = syncedAt;
      this.status.lastError = null;
      await writeFile(this.cachePath, JSON.stringify(next), 'utf-8');
    } catch (err: any) {
      this.status.lastError = err?.message || String(err);
    } finally {
      this.status.syncing = false;
    }
    return this.status;
  }

  startAutoSync(minutes: number) {
    this.sync().then(s => this.log(s));
    if (minutes > 0) {
      this.timer = setInterval(() => this.sync().then(s => this.log(s)), minutes * 60_000);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private log(s: SyncStatus) {
    if (s.lastError) console.warn(`[sync] upstream pull failed: ${s.lastError}`);
    else console.log(`[sync] ${this.bank?.metadata.total} questions from ${UPSTREAM_REPO}${s.added ? ` (+${s.added} new)` : ''}`);
  }
}

// `bun run sync` — pull once and refresh the cache without starting the server.
if (import.meta.main) {
  const store = new QuestionStore(process.cwd());
  await store.load();
  const status = await store.sync();
  if (status.lastError) {
    console.error(`Sync failed: ${status.lastError}`);
    process.exit(1);
  }
  console.log(`Synced ${store.bank?.metadata.total} questions from ${UPSTREAM_REPO} (+${status.added} new).`);
}
