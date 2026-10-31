import {
  LANGUAGES, caseArgs, casesFromProblem, formatValue, harnessSupport, parseSignature, starterCode, tryParseValue, valuesEqual,
} from '../harness.js';
import { ENGINE_LABEL, runScript, runTests, warmUp } from '../runner.js';
import { sendToSheet, sheetConfigured, sheetRow } from '../sheets.js';
import { store } from '../store.js';
import { logFieldsHtml, readLogFields } from '../log-form.js';
import { $, $$, esc, formatPill, icon, relativeTime, sanitizeStatement, shortDate, toast } from '../ui.js';

async function loadProblem(q) {
  try {
    const res = await fetch(`/api/problem?id=${encodeURIComponent(q.id)}&url=${encodeURIComponent(q.url)}`);
    if (res.ok) return await res.json();
  } catch {}
  try {
    const res = await fetch(`/data/problems/${encodeURIComponent(q.id)}.json`);
    if (res.ok) return await res.json();
  } catch {}
  return { id: q.id, title: q.title, hasSignature: false, statementHtml: '', examples: [], constraints: [], offline: true };
}

const VERDICT = {
  accepted: { label: 'Accepted', tone: 'ok' },
  wrong: { label: 'Wrong Answer', tone: 'bad' },
  runtime: { label: 'Runtime Error', tone: 'bad' },
  compile: { label: 'Compile Error', tone: 'bad' },
  tle: { label: 'Time Limit Exceeded', tone: 'bad' },
  finished: { label: 'Finished', tone: 'neutral' },
  input: { label: 'Invalid Test Input', tone: 'bad' },
};

function formatClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function renderWorkspace(root, ctx, id) {
  const q = ctx.byId.get(id);
  if (!q) {
    root.innerHTML = `<div class="boot-error"><h1>Problem not found</h1><p class="muted">It may have been renamed upstream.</p><a class="btn" href="#/">${icon('arrowLeft', 15)} Back to problems</a></div>`;
    return () => {};
  }

  const order = ctx.listOrder.length ? ctx.listOrder : ctx.questions.map(x => x.id);
  const pos = order.indexOf(id);
  const prevId = pos > 0 ? order[pos - 1] : null;
  const nextId = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null;

  const st = {
    detail: null,
    sig: null,
    cases: [],
    activeCase: 0,
    resultCase: 0,
    lastRun: null,
    lang: LANGUAGES[store.prefs.lang] ? store.prefs.lang : 'python',
    running: false,
    seconds: 0,
    paused: false,
    stdin: '',
  };

  document.title = `${q.title} · OA Prep`;

  root.innerHTML = `
    <div class="ws">
      <header class="ws-bar">
        <div class="ws-bar-left">
          <a class="brand-mark" href="#/" aria-label="Back to problems" title="Back to problems">${icon('logo', 24)}</a>
          <a class="crumb" href="#/">Problems</a>
          <span class="crumb-sep" aria-hidden="true">/</span>
          <span class="crumb-current" title="${esc(q.title)}">${esc(q.title)}</span>
          <div class="ws-nav">
            <button type="button" class="icon-btn sm" id="prev" aria-label="Previous problem" ${prevId ? '' : 'disabled'}>${icon('chevronLeft', 17)}</button>
            <button type="button" class="icon-btn sm" id="next" aria-label="Next problem" ${nextId ? '' : 'disabled'}>${icon('chevronRight', 17)}</button>
          </div>
        </div>
        <div class="ws-bar-center">
          <button type="button" class="btn btn-run" id="run" title="Run (Ctrl+')">${icon('play', 14)}<span>Run</span></button>
          <button type="button" class="btn btn-submit" id="submit" title="Submit (Ctrl+Enter)">${icon('upload', 15)}<span>Submit</span></button>
        </div>
        <div class="ws-bar-right">
          <button type="button" class="timer" id="timer" aria-label="Pause timer" title="Time on this problem — click to pause">${icon('timer', 15)}<span id="clock">00:00</span></button>
          ${ctx.headerActions({ sync: false })}
        </div>
      </header>

      <div class="ws-main" id="ws-main" style="--left:${store.prefs.leftPane}%">
        <section class="pane pane-left" aria-label="Problem">
          <div class="tabs" role="tablist" aria-label="Problem panels">
            <button type="button" role="tab" id="tab-desc" aria-controls="panel-desc" aria-selected="true" data-tab="desc">${icon('file', 15)}Description</button>
            <button type="button" role="tab" id="tab-notes" aria-controls="panel-notes" aria-selected="false" tabindex="-1" data-tab="notes">${icon('pencil', 15)}Notes</button>
            <button type="button" role="tab" id="tab-subs" aria-controls="panel-subs" aria-selected="false" tabindex="-1" data-tab="subs">${icon('history', 15)}Submissions</button>
          </div>
          <div class="pane-body prose-pane" role="tabpanel" id="panel-desc" aria-labelledby="tab-desc">
            <div class="skeleton"><i></i><i></i><i></i><i class="short"></i></div>
          </div>
          <div class="pane-body" role="tabpanel" id="panel-notes" aria-labelledby="tab-notes" hidden></div>
          <div class="pane-body" role="tabpanel" id="panel-subs" aria-labelledby="tab-subs" hidden></div>
        </section>

        <div class="gutter gutter-x" id="gutter-x" role="separator" aria-orientation="vertical" aria-label="Resize problem panel" tabindex="0"></div>

        <section class="ws-right" id="ws-right" style="--top:${store.prefs.editorPane}%">
          <div class="pane pane-editor">
            <div class="pane-head">
              <label class="lang-picker">
                <span class="sr-only">Language</span>
                ${icon('code', 15)}
                <select id="lang">${Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
              </label>
              <span class="engine-note" id="engine-note"></span>
              <span class="grow"></span>
              <button type="button" class="icon-btn sm" id="reset" aria-label="Reset to starter code" title="Reset to starter code">${icon('reset', 16)}</button>
            </div>
            <div class="editor" id="editor"></div>
          </div>

          <div class="gutter gutter-y" id="gutter-y" role="separator" aria-orientation="horizontal" aria-label="Resize console" tabindex="0"></div>

          <div class="pane pane-console">
            <div class="tabs" role="tablist" aria-label="Console">
              <button type="button" role="tab" id="ctab-cases" aria-controls="cpanel-cases" aria-selected="true" data-ctab="cases">${icon('terminal', 15)}Testcase</button>
              <button type="button" role="tab" id="ctab-result" aria-controls="cpanel-result" aria-selected="false" tabindex="-1" data-ctab="result">${icon('checkSquare', 15)}Test Result</button>
              <span class="grow"></span>
              <span class="run-status" id="run-status" aria-live="polite"></span>
            </div>
            <div class="pane-body console-body" role="tabpanel" id="cpanel-cases" aria-labelledby="ctab-cases"></div>
            <div class="pane-body console-body" role="tabpanel" id="cpanel-result" aria-labelledby="ctab-result" hidden>
              <p class="muted console-empty">Run your code to see results here.</p>
            </div>
          </div>
        </section>
      </div>
    </div>`;

  const els = {
    main: $('#ws-main', root),
    right: $('#ws-right', root),
    desc: $('#panel-desc', root),
    notes: $('#panel-notes', root),
    subs: $('#panel-subs', root),
    cases: $('#cpanel-cases', root),
    result: $('#cpanel-result', root),
    lang: $('#lang', root),
    run: $('#run', root),
    submit: $('#submit', root),
    status: $('#run-status', root),
    clock: $('#clock', root),
    timer: $('#timer', root),
    engine: $('#engine-note', root),
  };
  els.lang.value = st.lang;
  ctx.bindHeaderActions($('.ws-bar-right', root));

  /* ------------------------------------------------------------- editor */

  const editor = ace.edit($('#editor', root), {
    theme: 'ace/theme/oa',
    mode: LANGUAGES[st.lang].mode,
    fontSize: store.prefs.fontSize,
    fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    showPrintMargin: false,
    tabSize: 4,
    useSoftTabs: true,
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: false,
    highlightActiveLine: true,
    scrollPastEnd: 0.4,
    displayIndentGuides: true,
    fixedWidthGutter: true,
  });
  editor.renderer.setPadding(8);
  editor.renderer.setScrollMargin(10, 10);
  editor.setValue('', -1);
  editor.setReadOnly(true);

  // Only keep drafts that differ from the starter, so browsing doesn't fill localStorage.
  function saveCode(lang = st.lang) {
    if (!st.detail) return;
    const code = editor.getValue();
    if (code === starterCode(lang, st.sig)) store.clearCode(q.id, lang);
    else store.setCode(q.id, lang, code);
  }

  let saveTimer;
  editor.session.on('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCode(), 400);
  });

  editor.commands.addCommand({ name: 'oaRun', bindKey: { win: "Ctrl-'", mac: "Command-'" }, exec: () => run('run') });
  editor.commands.addCommand({ name: 'oaSubmit', bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' }, exec: () => run('submit') });

  function loadCode(lang) {
    const saved = store.getCode(q.id, lang);
    editor.session.setMode(LANGUAGES[lang].mode);
    editor.setValue(saved ?? starterCode(lang, st.sig), 1);
    editor.session.getUndoManager().reset();
    const harness = harnessSupport(lang, st.sig);
    els.engine.textContent = ENGINE_LABEL[lang] + (st.sig && !harness ? ' · plain program (signature not supported in this language)' : '');
  }

  const onPrefs = () => editor.setFontSize(store.prefs.fontSize);
  window.addEventListener('oa:prefs', onPrefs);

  const ro = new ResizeObserver(() => editor.resize());
  ro.observe($('#editor', root));

  /* -------------------------------------------------------------- tabs */

  function selectTab(list, attr, value) {
    $$(`[role="tab"][data-${attr}]`, list).forEach(tab => {
      const on = tab.dataset[attr] === value;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
  }

  function bindTabs(list, attr, onSelect) {
    list.addEventListener('click', e => {
      const tab = e.target.closest(`[role="tab"][data-${attr}]`);
      if (!tab) return;
      selectTab(list, attr, tab.dataset[attr]);
      onSelect?.(tab.dataset[attr]);
    });
    list.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = $$(`[role="tab"][data-${attr}]`, list);
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  }

  const leftTabs = $('.pane-left .tabs', root);
  const consoleTabs = $('.pane-console .tabs', root);
  bindTabs(leftTabs, 'tab', tab => {
    if (tab === 'notes') renderNotes();
    if (tab === 'subs') renderSubmissions();
  });
  bindTabs(consoleTabs, 'ctab');

  /* -------------------------------------------------------- description */

  function renderDescription() {
    const d = st.detail;
    const statement = d.statementHtml ? sanitizeStatement(d.statementHtml) : '';
    const examples = (d.examples || []).filter(ex => ex.inputRaw);
    const constraints = d.constraints || [];
    els.desc.innerHTML = `
      <h1 class="problem-title">${esc(q.title)}</h1>
      <div class="problem-meta">
        ${formatPill(q.format)}
        ${q.isHot ? '<span class="hot">Hot</span>' : q.isNew ? '<span class="new">New</span>' : ''}
        ${store.isSolved(q.id) ? `<span class="solved-tag">${icon('check', 13)}Solved</span>` : ''}
        <span class="meta-text">${esc(q.companies.join(', '))}</span>
        <span class="meta-dot" aria-hidden="true">·</span>
        <span class="meta-text">Reported ${esc(shortDate(q.isoDate, q.date))}</span>
      </div>
      ${statement ? `<div class="statement">${statement}</div>` : ''}
      ${!statement || !st.sig ? `
        <div class="callout">
          <p>${d.offline
            ? 'The full statement couldn’t be loaded because the server is offline.'
            : 'FastPrep runs this one as a guided, interactive problem, so only a summary shows here. Sketch your approach in the editor or Notes, then work through it there.'}</p>
          <a class="btn" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">Open on FastPrep ${icon('external', 14)}</a>
        </div>` : ''}
      ${st.sig ? `
        <h3 class="section-label">Function</h3>
        <pre class="sig"><code>${esc(st.sig.name)}(${st.sig.params.map(p => `<span class="sig-name">${esc(p.name)}</span>: <span class="sig-type">${esc(p.type)}</span>`).join(', ')}) → <span class="sig-type">${esc(st.sig.ret)}</span></code></pre>` : ''}
      ${examples.length ? `
        <h3 class="section-label">Examples</h3>
        ${examples.map((ex, i) => `
          <div class="example">
            <div class="example-label">Example ${i + 1}</div>
            <div class="example-row"><span>Input</span><code>${esc(ex.inputRaw.replace(/\n/g, ', '))}</code></div>
            ${ex.expectedRaw ? `<div class="example-row"><span>Output</span><code>${esc(ex.expectedRaw)}</code></div>` : ''}
            ${ex.explanation ? `<div class="example-row"><span>Why</span><p>${esc(ex.explanation)}</p></div>` : ''}
          </div>`).join('')}` : ''}
      ${constraints.length ? `
        <h3 class="section-label">Constraints</h3>
        <ul class="constraints">${constraints.map(c => `<li><code>${esc(c)}</code></li>`).join('')}</ul>` : ''}
      <footer class="source">
        <a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">View on FastPrep ${icon('external', 13)}</a>
      </footer>`;
  }

  /* -------------------------------------------------------------- notes */

  function renderNotes() {
    const solved = store.isSolved(q.id);
    const note = store.getNote(q.id);
    if (!solved && !note.timeTaken && st.seconds >= 60) note.timeTaken = String(Math.round(st.seconds / 60));
    els.notes.innerHTML = `
      <form class="notes" id="notes-form">
        <div class="notes-head">
          <div>
            <h2 class="notes-title">Solve log</h2>
            <p class="muted">${solved ? `Solved ${esc(shortDate(note.dateSolved))}.` : 'Not solved yet.'} ${sheetConfigured() ? 'Saving writes this row to your Google Sheet.' : 'Connect a Google Sheet in Settings to keep a copy there.'}</p>
          </div>
          ${solved ? '<span class="solved-tag">' + icon('check', 13) + 'Solved</span>' : ''}
        </div>
        ${logFieldsHtml(note, 'notes')}
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">${solved ? 'Update' : 'Save & mark solved'}${sheetConfigured() && store.prefs.autoLog ? ' · log to Sheet' : ''}</button>
          ${solved ? '<button type="button" class="btn ghost" id="unmark">Mark unsolved</button>' : ''}
        </div>
      </form>`;
    $('#notes-form', els.notes).addEventListener('submit', e => {
      e.preventDefault();
      const fields = readLogFields(e.currentTarget);
      const wasSolved = store.isSolved(q.id);
      const saved = store.markSolved(q.id, fields);
      if (sheetConfigured() && store.prefs.autoLog) {
        sendToSheet(sheetRow(q, saved)).then(r =>
          toast(r.ok ? 'Saved · logged to Google Sheet' : `Saved locally · Sheet: ${r.message}`, { tone: r.ok ? 'ok' : 'bad' }));
      } else {
        toast(wasSolved ? 'Solve log updated' : 'Marked solved', { tone: 'ok' });
      }
      renderNotes();
      renderDescription();
    });
    $('#unmark', els.notes)?.addEventListener('click', () => {
      ctx.toggleSolved(q);
      renderNotes();
      renderDescription();
    });
  }

  /* -------------------------------------------------------- submissions */

  function renderSubmissions() {
    const subs = store.getSubmissions(q.id);
    els.subs.innerHTML = subs.length
      ? `<ul class="subs">${subs.map((s, i) => `
          <li class="sub-item">
            <span class="sub-verdict tone-${VERDICT[s.verdict]?.tone || 'neutral'}">${esc(VERDICT[s.verdict]?.label || s.verdict)}</span>
            <span class="sub-meta">${esc(LANGUAGES[s.lang]?.label || s.lang)} · ${s.passed}/${s.total} passed${s.ms != null ? ` · ${s.ms.toFixed(1)} ms` : ''}</span>
            <span class="sub-time">${esc(relativeTime(s.at))}</span>
            <button type="button" class="btn ghost sm" data-load="${i}">Load code</button>
          </li>`).join('')}</ul>`
      : '<div class="empty-panel"><p class="empty-title">No submissions yet</p><p class="muted">Submit runs every test case and keeps your code here.</p></div>';
    els.subs.onclick = e => {
      const i = e.target.closest('[data-load]')?.dataset.load;
      if (i == null) return;
      const sub = subs[Number(i)];
      if (sub.lang !== st.lang) {
        saveCode();
        st.lang = sub.lang;
        els.lang.value = sub.lang;
        store.savePrefs({ lang: sub.lang });
        loadCode(sub.lang);
      }
      editor.setValue(sub.code, 1);
      toast('Loaded submitted code');
    };
  }

  /* --------------------------------------------------------- test cases */

  function renderCases() {
    if (!st.sig) {
      els.cases.innerHTML = `
        <p class="muted console-hint">This problem has no function signature, so <strong>Run</strong> executes your code as a program.</p>
        <div class="case-field">
          <label for="stdin">stdin</label>
          <textarea id="stdin" rows="4" spellcheck="false" placeholder="Optional input for your program">${esc(st.stdin)}</textarea>
        </div>`;
      $('#stdin', els.cases).addEventListener('input', e => {
        st.stdin = e.target.value;
      });
      return;
    }
    const c = st.cases[st.activeCase];
    els.cases.innerHTML = `
      <div class="case-tabs" role="tablist" aria-label="Test cases">
        ${st.cases.map((_, i) => `
          <span class="case-tab-wrap">
            <button type="button" role="tab" class="case-tab" aria-selected="${i === st.activeCase}" data-case="${i}">Case ${i + 1}</button>
            ${st.cases.length > 1 ? `<button type="button" class="case-del" data-del="${i}" aria-label="Delete case ${i + 1}">${icon('x', 11)}</button>` : ''}
          </span>`).join('')}
        <button type="button" class="icon-btn sm" id="add-case" aria-label="Add a test case" title="Add a test case (copies the current one)">${icon('plus', 15)}</button>
      </div>
      ${c ? `
        <div class="case-fields">
          ${st.sig.params.map(p => `
            <div class="case-field">
              <label for="cf-${esc(p.name)}">${esc(p.name)} <span class="type">${esc(p.type)}</span></label>
              <textarea id="cf-${esc(p.name)}" data-param="${esc(p.name)}" rows="1" spellcheck="false">${esc(c.values[p.name] ?? '')}</textarea>
            </div>`).join('')}
          <div class="case-field">
            <label for="cf-expected">Expected <span class="type">${esc(st.sig.ret)}</span></label>
            <textarea id="cf-expected" data-expected rows="1" spellcheck="false" placeholder="Leave empty to just see the output">${esc(c.expected)}</textarea>
          </div>
        </div>` : ''}`;
    autosize(els.cases);
  }

  function autosize(scope) {
    $$('textarea', scope).forEach(t => {
      t.style.height = 'auto';
      t.style.height = `${Math.min(t.scrollHeight + 2, 160)}px`;
    });
  }

  els.cases.addEventListener('input', e => {
    const c = st.cases[st.activeCase];
    if (!c) return;
    if (e.target.dataset.param) c.values[e.target.dataset.param] = e.target.value;
    if ('expected' in e.target.dataset) c.expected = e.target.value;
    autosize(els.cases);
  });

  els.cases.addEventListener('click', e => {
    const caseBtn = e.target.closest('[data-case]');
    const del = e.target.closest('[data-del]');
    if (del) {
      st.cases.splice(Number(del.dataset.del), 1);
      st.activeCase = Math.min(st.activeCase, st.cases.length - 1);
      renderCases();
    } else if (caseBtn) {
      st.activeCase = Number(caseBtn.dataset.case);
      renderCases();
    } else if (e.target.closest('#add-case')) {
      const base = st.cases[st.activeCase] || { values: {}, expected: '' };
      st.cases.push({ values: { ...base.values }, expected: '', custom: true });
      st.activeCase = st.cases.length - 1;
      renderCases();
    }
  });

  /* ------------------------------------------------------------ results */

  function evaluate(res) {
    if (res.compileError) return { verdict: 'compile', passed: 0 };
    let passed = 0;
    let verdict = 'accepted';
    let anyExpected = false;
    res.cases.forEach((c, i) => {
      const expectedText = (st.cases[i]?.expected || '').trim();
      c.expectedText = expectedText;
      if (c.status === 'error') {
        c.pass = false;
        if (verdict !== 'tle') verdict = res.timedOut ? 'tle' : 'runtime';
        return;
      }
      if (c.status !== 'ok') {
        c.pass = false;
        return;
      }
      if (!expectedText) {
        c.pass = null;
        return;
      }
      anyExpected = true;
      const exp = tryParseValue(expectedText);
      c.pass = exp.ok ? valuesEqual(c.value, exp.value) : c.raw === expectedText || String(c.value) === expectedText;
      if (c.pass) passed++;
      else if (verdict === 'accepted') verdict = 'wrong';
    });
    if (verdict === 'accepted' && !anyExpected) verdict = 'finished';
    return { verdict, passed };
  }

  function renderResult() {
    const r = st.lastRun;
    if (!r) return;
    const v = VERDICT[r.verdict];
    const head = `
      <div class="verdict tone-${v.tone}">
        <h2>${esc(v.label)}</h2>
        ${r.mode === 'tests' && r.verdict !== 'compile' && r.verdict !== 'input'
          ? `<span class="muted">${r.passed}/${r.total} passed${r.ms != null ? ` · ${r.ms.toFixed(2)} ms` : ''}</span>` : ''}
      </div>`;

    if (r.verdict === 'input') {
      els.result.innerHTML = `${head}<pre class="error-box">${esc(r.message)}</pre>`;
      return;
    }
    if (r.compileError) {
      els.result.innerHTML = `${head}<pre class="error-box">${esc(r.compileError)}</pre>`;
      return;
    }
    if (r.mode === 'script') {
      els.result.innerHTML = `${head}
        <div class="io"><div class="io-label">Output</div><pre class="io-box">${esc(r.stdout) || '<span class="muted">(no output)</span>'}</pre></div>
        ${r.stderr ? `<div class="io"><div class="io-label">Errors</div><pre class="error-box">${esc(r.stderr)}</pre></div>` : ''}`;
      return;
    }

    const c = r.cases[st.resultCase] || r.cases[0];
    const tc = r.inputs[c.index];
    els.result.innerHTML = `${head}
      <div class="case-tabs" role="tablist" aria-label="Case results">
        ${r.cases.map((x, i) => `
          <button type="button" role="tab" class="case-tab" aria-selected="${i === st.resultCase}" data-rcase="${i}">
            <span class="case-dot ${x.pass === true ? 'ok' : x.pass === false ? 'bad' : ''}" aria-hidden="true"></span>Case ${i + 1}
            <span class="sr-only">${x.pass === true ? 'passed' : x.pass === false ? 'failed' : ''}</span>
          </button>`).join('')}
      </div>
      <div class="io">
        <div class="io-label">Input</div>
        <div class="io-box io-vars">${st.sig.params.map(p => `<div><span class="io-var">${esc(p.name)} =</span><code>${esc(tc.values[p.name] ?? '')}</code></div>`).join('')}</div>
      </div>
      ${c.status === 'error'
        ? `<div class="io"><div class="io-label">Error</div><pre class="error-box">${esc(c.error)}</pre></div>`
        : c.status === 'ok'
          ? `<div class="io"><div class="io-label">Output</div><pre class="io-box ${c.pass === false ? 'is-bad' : ''}">${esc(formatValue(c.value))}</pre></div>`
          : '<div class="io"><div class="io-label">Output</div><pre class="io-box muted">Not run</pre></div>'}
      ${c.expectedText ? `<div class="io"><div class="io-label">Expected</div><pre class="io-box">${esc(c.expectedText)}</pre></div>` : ''}
      ${c.stdout ? `<div class="io"><div class="io-label">Stdout</div><pre class="io-box">${esc(c.stdout)}</pre></div>` : ''}
      ${r.stdout ? `<div class="io"><div class="io-label">Program output</div><pre class="io-box">${esc(r.stdout)}</pre></div>` : ''}`;
  }

  els.result.addEventListener('click', e => {
    const btn = e.target.closest('[data-rcase]');
    if (!btn) return;
    st.resultCase = Number(btn.dataset.rcase);
    renderResult();
  });

  /* ---------------------------------------------------------------- run */

  function setRunning(on, label = '') {
    st.running = on;
    els.run.disabled = on;
    els.submit.disabled = on;
    els.status.innerHTML = on ? `<span class="spinner" aria-hidden="true"></span>${esc(label)}` : esc(label);
  }

  async function run(kind) {
    if (st.running || !st.detail) return;
    if (!st.sig && kind === 'submit') {
      ctx.openSolveDialog(q, { eyebrow: 'Mark solved', timeTaken: Math.max(1, Math.round(st.seconds / 60)) }).then(saved => {
        if (saved) renderDescription();
      });
      return;
    }
    const code = editor.getValue();
    saveCode();
    selectTab(consoleTabs, 'ctab', 'result');
    els.result.innerHTML = '<div class="verdict tone-neutral"><h2 class="muted">Running…</h2></div>';
    setRunning(true, 'Starting…');
    const onStatus = label => setRunning(true, label);
    const started = performance.now();

    try {
      if (!st.sig || !harnessSupport(st.lang, st.sig)) {
        const res = await runScript({ lang: st.lang, code, stdin: st.stdin, onStatus });
        st.lastRun = {
          mode: 'script',
          verdict: res.compileError ? 'compile' : res.timedOut ? 'tle' : res.stderr ? 'runtime' : 'finished',
          ...res,
        };
      } else {
        let argsList;
        try {
          argsList = st.cases.map(c => caseArgs(c, st.sig));
        } catch (err) {
          st.lastRun = { mode: 'tests', verdict: 'input', message: err.message };
          renderResult();
          return;
        }
        if (!argsList.length) {
          st.lastRun = { mode: 'tests', verdict: 'input', message: 'Add at least one test case.' };
          renderResult();
          return;
        }
        const res = await runTests({ lang: st.lang, code, sig: st.sig, argsList, onStatus });
        const { verdict, passed } = evaluate(res);
        const times = res.cases.filter(c => c.ms != null).map(c => c.ms);
        st.lastRun = {
          mode: 'tests',
          verdict,
          passed,
          total: res.cases.length,
          ms: times.length ? Math.max(...times) : null,
          inputs: st.cases.map(c => ({ values: { ...c.values }, expected: c.expected })),
          ...res,
        };
        const firstFail = res.cases.findIndex(c => c.pass === false);
        st.resultCase = firstFail >= 0 ? firstFail : 0;

        if (kind === 'submit') {
          store.addSubmission(q.id, { at: new Date().toISOString(), lang: st.lang, verdict, passed, total: res.cases.length, ms: st.lastRun.ms, code });
          if (!$('#panel-subs', root).hidden) renderSubmissions();
          if (verdict === 'accepted') onAccepted();
        }
      }
    } catch (err) {
      st.lastRun = { mode: 'script', verdict: 'runtime', stdout: '', stderr: err.message || String(err) };
    } finally {
      setRunning(false, `Done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
      renderResult();
    }
  }

  function onAccepted() {
    const minutes = Math.max(1, Math.round(st.seconds / 60));
    ctx.openSolveDialog(q, { eyebrow: 'Accepted', timeTaken: minutes }).then(saved => {
      if (saved) {
        renderDescription();
        if (!$('#panel-notes', root).hidden) renderNotes();
      }
    });
  }

  els.run.addEventListener('click', () => run('run'));
  els.submit.addEventListener('click', () => run('submit'));

  els.lang.addEventListener('change', () => {
    saveCode();
    st.lang = els.lang.value;
    store.savePrefs({ lang: st.lang });
    loadCode(st.lang);
    warmUp(st.lang);
  });

  $('#reset', root).addEventListener('click', () => {
    const previous = editor.getValue();
    const starter = starterCode(st.lang, st.sig);
    if (previous === starter) return;
    editor.setValue(starter, 1);
    store.clearCode(q.id, st.lang);
    toast('Code reset to the starter template', {
      action: { label: 'Undo', onClick: () => editor.setValue(previous, 1) },
    });
  });

  $('#prev', root).addEventListener('click', () => prevId && ctx.navigate(`/problems/${encodeURIComponent(prevId)}`));
  $('#next', root).addEventListener('click', () => nextId && ctx.navigate(`/problems/${encodeURIComponent(nextId)}`));

  const onKey = e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || document.querySelector('dialog[open]')) return;
    if (e.key === "'") {
      e.preventDefault();
      run('run');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run('submit');
    }
  };
  document.addEventListener('keydown', onKey);

  /* -------------------------------------------------------------- timer */

  const tick = setInterval(() => {
    if (st.paused || document.hidden) return;
    st.seconds++;
    els.clock.textContent = formatClock(st.seconds);
  }, 1000);
  els.timer.addEventListener('click', () => {
    st.paused = !st.paused;
    els.timer.classList.toggle('paused', st.paused);
    els.timer.setAttribute('aria-label', st.paused ? 'Resume timer' : 'Pause timer');
    els.timer.querySelector('svg').outerHTML = icon(st.paused ? 'pause' : 'timer', 15);
  });

  /* ------------------------------------------------------------- gutters */

  function bindGutter(gutter, axis) {
    const apply = pct => {
      if (axis === 'x') {
        const v = Math.min(70, Math.max(24, pct));
        els.main.style.setProperty('--left', `${v}%`);
        store.prefs.leftPane = Math.round(v);
      } else {
        const v = Math.min(88, Math.max(18, pct));
        els.right.style.setProperty('--top', `${v}%`);
        store.prefs.editorPane = Math.round(v);
      }
    };
    gutter.addEventListener('pointerdown', e => {
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
      const box = (axis === 'x' ? els.main : els.right).getBoundingClientRect();
      const move = ev => apply(axis === 'x'
        ? ((ev.clientX - box.left) / box.width) * 100
        : ((ev.clientY - box.top) / box.height) * 100);
      const up = () => {
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        gutter.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-x', 'resizing-y');
        store.savePrefs({});
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
      gutter.addEventListener('pointercancel', up);
    });
    gutter.addEventListener('keydown', e => {
      const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const current = axis === 'x' ? store.prefs.leftPane : store.prefs.editorPane;
      apply(current + (e.key === keys[0] ? -3 : 3));
      store.savePrefs({});
    });
  }
  bindGutter($('#gutter-x', root), 'x');
  bindGutter($('#gutter-y', root), 'y');

  /* ---------------------------------------------------------------- load */

  const unsubscribe = store.subscribe(change => {
    if (change.type === 'sheet') ctx.refreshHeader();
    if (change.id === q.id && st.detail) renderDescription();
  });

  let alive = true;
  warmUp(st.lang);
  loadProblem(q).then(detail => {
    if (!alive) return;
    st.detail = detail;
    st.sig = parseSignature(detail);
    st.cases = st.sig ? casesFromProblem(detail, st.sig) : [];
    if (st.sig && !st.cases.length) {
      st.cases = [{ values: Object.fromEntries(st.sig.params.map(p => [p.name, ''])), expected: '' }];
    }
    renderDescription();
    renderCases();
    editor.setReadOnly(false);
    loadCode(st.lang);
    if (!st.sig) $('#submit span', root).textContent = 'Mark solved';
    editor.focus();
  });

  return () => {
    alive = false;
    clearInterval(tick);
    clearTimeout(saveTimer);
    saveCode();
    ro.disconnect();
    unsubscribe();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('oa:prefs', onPrefs);
    editor.destroy();
    document.title = 'OA Prep';
  };
}
