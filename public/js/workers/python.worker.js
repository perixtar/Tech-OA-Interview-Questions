// CPython compiled to WebAssembly (Pyodide), loaded once per worker.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';

let ready;
try {
  importScripts(`${PYODIDE_URL}pyodide.js`);
  ready = loadPyodide({ indexURL: PYODIDE_URL });
  ready.then(
    () => self.postMessage({ type: 'ready' }),
    err => self.postMessage({ type: 'load-error', error: String(err && err.message || err) }),
  );
} catch (err) {
  self.postMessage({ type: 'load-error', error: String(err && err.message || err) });
}

self.onmessage = async e => {
  const { source, stdin = '' } = e.data;
  const py = await ready;
  let stdout = '';
  const write = s => {
    stdout += s + '\n';
  };
  py.setStdout({ batched: write });
  py.setStderr({ batched: write });
  const lines = stdin.split('\n');
  py.setStdin({ stdin: () => (lines.length ? lines.shift() : undefined) });

  const globals = py.globals.get('dict')();
  try {
    await py.runPythonAsync(source, { globals });
    self.postMessage({ type: 'result', stdout });
  } catch (err) {
    self.postMessage({ type: 'result', stdout, error: String(err && err.message || err) });
  } finally {
    globals.destroy();
  }
};
