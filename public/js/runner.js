import { buildScriptProgram, buildTestProgram, harnessSupport, parseHarnessOutput } from './harness.js';

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';
const WANDBOX_COMPILERS = {
  cpp: { compiler: 'gcc-head', 'compiler-option-raw': '-O2\n-std=gnu++20' },
  java: { compiler: 'openjdk-jdk-22+36' },
  python: { compiler: 'cpython-3.13.8' },
};
const TIME_LIMIT_MS = { javascript: 6000, python: 15000 };

export const ENGINE_LABEL = {
  javascript: 'Runs in your browser (Web Worker)',
  python: 'Runs in your browser (Pyodide · CPython 3.13 on WebAssembly)',
  cpp: 'Compiled with GCC on wandbox.org',
  java: 'Compiled with OpenJDK 22 on wandbox.org',
};

class WorkerEngine {
  constructor(url, { waitForReady }) {
    this.url = url;
    this.waitForReady = waitForReady;
    this.worker = null;
    this.ready = null;
    this.failed = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.worker = new Worker(this.url);
    this.ready = new Promise((resolve, reject) => {
      if (!this.waitForReady) return resolve();
      const onMessage = e => {
        if (e.data?.type === 'ready') {
          this.worker.removeEventListener('message', onMessage);
          resolve();
        } else if (e.data?.type === 'load-error') {
          this.failed = e.data.error;
          reject(new Error(e.data.error));
        }
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', err => {
        this.failed = err.message || 'Worker failed to start';
        reject(new Error(this.failed));
      });
    });
    this.ready.catch(() => this.reset());
    return this.ready;
  }

  reset() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  async run(payload, timeoutMs) {
    await this.start();
    const worker = this.worker;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMessage);
        this.reset();
        resolve({ stdout: '', timedOut: true });
      }, timeoutMs);
      const onMessage = e => {
        if (e.data?.type === 'ready') return;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        resolve(e.data);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage(payload);
    });
  }
}

const engines = {
  javascript: new WorkerEngine('/js/workers/js.worker.js', { waitForReady: false }),
  python: new WorkerEngine('/js/workers/python.worker.js', { waitForReady: true }),
};

// Start downloading Pyodide before the first Run click.
export function warmUp(lang) {
  if (lang === 'python') engines.python.start().catch(() => {});
}

async function runOnWandbox(lang, source, stdin) {
  let res;
  try {
    res = await fetch(WANDBOX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...WANDBOX_COMPILERS[lang], code: source, stdin: stdin || '' }),
    });
  } catch (err) {
    return { stdout: '', error: `Couldn't reach wandbox.org: ${err.message}` };
  }
  if (!res.ok) return { stdout: '', error: `wandbox.org returned HTTP ${res.status}` };
  const data = await res.json();
  const ran = 'program_output' in data || 'program_error' in data || data.status === '0';
  if (!ran && data.compiler_error) {
    return { stdout: '', compileError: data.compiler_error };
  }
  const failed = data.status && data.status !== '0';
  return {
    stdout: data.program_output || '',
    stderr: data.program_error || '',
    error: failed ? `Process exited with status ${data.status}${data.signal ? ` (${data.signal})` : ''}` : null,
  };
}

async function runRaw(lang, source, stdin, onStatus) {
  if (lang === 'javascript') {
    onStatus?.('Running…');
    return engines.javascript.run({ source, stdin }, TIME_LIMIT_MS.javascript);
  }
  if (lang === 'python') {
    if (!engines.python.failed) {
      try {
        onStatus?.(engines.python.ready ? 'Running…' : 'Loading Python runtime…');
        await engines.python.start();
        onStatus?.('Running…');
        return await engines.python.run({ source, stdin }, TIME_LIMIT_MS.python);
      } catch {
        // Pyodide couldn't load (offline CDN, old browser) — fall through to Wandbox.
      }
    }
    onStatus?.('Running on wandbox.org…');
    return runOnWandbox('python', source, stdin);
  }
  onStatus?.('Compiling on wandbox.org…');
  return runOnWandbox(lang, source, stdin);
}

// Runs the solution against argsList (one array of arguments per case).
// Returns { compileError, cases: [{ status, value, raw, ms, error, stdout }], stdout, stderr, timedOut }.
export async function runTests({ lang, code, sig, argsList, onStatus }) {
  const source = buildTestProgram(lang, code, sig, argsList);
  const raw = await runRaw(lang, source, '', onStatus);
  const parsed = parseHarnessOutput(raw.stdout, argsList.length);
  const compileError = parsed.compileError || raw.compileError || null;
  const crashMessage = raw.timedOut
    ? `Time limit exceeded (${TIME_LIMIT_MS[lang] / 1000}s)`
    : [raw.stderr, raw.error].filter(Boolean).join('\n').trim() || 'Program stopped before finishing this case';

  for (const c of parsed.cases) {
    if (c.status === 'crashed' || (c.status === 'skipped' && !compileError && (raw.error || raw.timedOut || raw.stderr))) {
      c.status = 'error';
      c.error = crashMessage;
      break;
    }
  }
  return {
    compileError,
    cases: parsed.cases,
    stdout: parsed.stdout,
    stderr: raw.stderr || '',
    timedOut: Boolean(raw.timedOut),
  };
}

// Runs the code as a plain program (no signature to call).
export async function runScript({ lang, code, stdin, onStatus }) {
  const raw = await runRaw(lang, buildScriptProgram(lang, code), stdin, onStatus);
  return {
    compileError: raw.compileError || null,
    stdout: raw.stdout || '',
    stderr: [raw.stderr, raw.error].filter(Boolean).join('\n'),
    timedOut: Boolean(raw.timedOut),
  };
}

export { harnessSupport };
