// Runs user JavaScript off the main thread so infinite loops can be killed with terminate().

function format(v) {
  if (typeof v === 'string') return v;
  try {
    const s = JSON.stringify(v, (k, x) =>
      typeof x === 'bigint' ? x.toString()
        : x instanceof Map ? Object.fromEntries(x)
        : x instanceof Set ? [...x]
        : x);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

self.onmessage = e => {
  const { source, stdin = '' } = e.data;
  let stdout = '';
  const print = (...args) => {
    stdout += args.map(format).join(' ') + '\n';
  };
  const sandboxConsole = { log: print, info: print, warn: print, error: print, debug: print, table: print };
  const lines = stdin.split('\n');
  const readline = () => (lines.length ? lines.shift() : null);

  let fn;
  try {
    fn = new Function('console', 'readline', 'print', source);
  } catch (err) {
    self.postMessage({ stdout, compileError: `${err.name}: ${err.message}` });
    return;
  }
  try {
    fn(sandboxConsole, readline, print);
    self.postMessage({ stdout });
  } catch (err) {
    self.postMessage({ stdout, error: err && err.stack ? `${err.name}: ${err.message}` : String(err) });
  }
};
