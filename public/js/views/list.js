import { store } from '../store.js';
import { $, esc, formatClass, formatPill, icon, shortDate } from '../ui.js';

const PAGE = 80;
const FORMAT_ORDER = ['Coding', 'System design', 'Low-level design', 'AI coding', 'SQL'];
const LIST_LABEL = { all: 'All problems', starred: 'Starred', solved: 'Solved' };

const defaultState = () => ({
  list: 'all',
  format: '',
  company: '',
  search: '',
  fresh: 'all',
  status: 'all',
  sort: 'newest',
  scrollY: 0,
});

function inScope(q, s) {
  if (s.list === 'starred' && !store.isStarred(q.id)) return false;
  if (s.list === 'solved' && !store.isSolved(q.id)) return false;
  if (s.format && q.format !== s.format) return false;
  if (s.company && !q.companies.includes(s.company)) return false;
  return true;
}

function matches(q, s, terms) {
  if (s.fresh === 'hot' && !q.isHot) return false;
  if (s.fresh === 'recent' && !(q.isHot || q.isNew)) return false;
  if (s.status === 'todo' && store.isSolved(q.id)) return false;
  if (s.status === 'solved' && !store.isSolved(q.id)) return false;
  return terms.every(t => q._search.includes(t));
}

function sortList(items, sort) {
  const out = [...items];
  if (sort === 'oldest') out.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || b.index - a.index);
  else if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'company') out.sort((a, b) => (a.companies[0] || '').localeCompare(b.companies[0] || '') || a.index - b.index);
  else out.sort((a, b) => b.isoDate.localeCompare(a.isoDate) || a.index - b.index);
  return out;
}

function rowHtml(q) {
  const solved = store.isSolved(q.id);
  const starred = store.isStarred(q.id);
  const [first, ...rest] = q.companies;
  return `
    <div class="row${solved ? ' is-solved' : ''}" data-id="${esc(q.id)}" role="row">
      <span role="cell"><button type="button" class="solve-btn" data-act="solve" aria-pressed="${solved}" aria-label="${solved ? 'Mark unsolved' : 'Mark solved'}: ${esc(q.title)}">${icon(solved ? 'circleCheck' : 'circle', 19)}</button></span>
      <span role="cell"><button type="button" class="star-btn${starred ? ' on' : ''}" data-act="star" aria-pressed="${starred}" aria-label="Star ${esc(q.title)}">${icon('star', 16)}</button></span>
      <span role="cell" class="cell-title">
        <a class="title-link" href="#/problems/${encodeURIComponent(q.id)}">${esc(q.title)}</a>
        ${q.isHot ? '<span class="hot" title="Reported in the last 2 weeks">Hot</span>' : q.isNew ? '<span class="new" title="Reported in the last 45 days">New</span>' : ''}
      </span>
      <span role="cell" class="cell-company" title="${esc(q.companies.join(', '))}">${esc(first || '—')}${rest.length ? `<span class="more">+${rest.length}</span>` : ''}</span>
      <span role="cell" class="cell-format">${formatPill(q.format)}</span>
      <span role="cell" class="cell-date">${esc(shortDate(q.isoDate, q.date))}</span>
      <span role="cell" class="cell-ext"><a class="ext-link" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(q.title)} on FastPrep" title="Open on FastPrep">${icon('external', 15)}</a></span>
    </div>`;
}

export function renderList(root, ctx) {
  const s = (ctx.listState ||= defaultState());
  const { questions, meta } = ctx;
  const formats = [...new Set([...FORMAT_ORDER.filter(f => meta.formatCounts?.[f]), ...Object.keys(meta.formatCounts || {})])];
  const companies = meta.companies || [];

  root.innerHTML = `
    <div class="page">
      <header class="appbar">
        <a class="brand" href="#/" aria-label="OA Prep home">${icon('logo', 26)}<span>OA Prep</span></a>
        <nav class="appbar-nav" aria-label="Primary"><a href="#/" aria-current="page">Problems</a></nav>
        <div class="appbar-actions">${ctx.headerActions()}</div>
      </header>

      <div class="list-layout">
        <aside class="sidebar" aria-label="Lists and filters">
          <div class="side-group">
            <div class="side-label">Library</div>
            ${['all', 'starred', 'solved'].map(l => `
              <button type="button" class="side-item" data-list="${l}">
                <span>${LIST_LABEL[l]}</span><span class="count" data-count="${l}"></span>
              </button>`).join('')}
          </div>
          <div class="side-group">
            <div class="side-label">Format</div>
            ${formats.map(f => `
              <button type="button" class="side-item side-format" data-format="${esc(f)}">
                <span class="fmt-dot ${formatClass(f)}"></span><span class="grow">${esc(f)}</span>
                <span class="count" data-fcount="${esc(f)}"></span>
                <span class="mini-track"><i data-fbar="${esc(f)}"></i></span>
              </button>`).join('')}
          </div>
          <div class="side-group">
            <div class="side-label">Top companies</div>
            ${companies.slice(0, 12).map(c => `
              <button type="button" class="side-item" data-company="${esc(c.name)}">
                <span class="grow">${esc(c.name)}</span><span class="count">${c.count}</span>
              </button>`).join('')}
          </div>
        </aside>

        <main class="list-main" id="main">
          <div class="list-head">
            <div>
              <h1 id="list-title"></h1>
              <p class="sub" id="list-sub"></p>
            </div>
            <div class="progress-card" aria-live="polite">
              <div class="progress-num"><strong id="prog-solved">0</strong><span id="prog-total"></span></div>
              <div class="progress-track"><i id="prog-bar"></i></div>
            </div>
          </div>

          <div class="toolbar">
            <label class="search">
              ${icon('search', 16)}
              <input id="search" type="search" placeholder="Search problems or companies" autocomplete="off" spellcheck="false" aria-label="Search problems">
              <kbd aria-hidden="true">/</kbd>
            </label>
            <div class="company-field">
              <input id="company" list="company-options" placeholder="Any company" autocomplete="off" aria-label="Filter by company">
              <datalist id="company-options">${companies.map(c => `<option value="${esc(c.name)}">${c.count} problems</option>`).join('')}</datalist>
            </div>
            <div class="segmented" role="radiogroup" aria-label="Freshness">
              ${[['all', 'All'], ['hot', 'Hot'], ['recent', 'Recent']].map(([v, l]) => `
                <label title="${v === 'hot' ? 'Reported in the last 2 weeks' : v === 'recent' ? 'Reported in the last 45 days' : 'Everything'}"><input type="radio" name="fresh" value="${v}"><span>${l}</span></label>`).join('')}
            </div>
            <select id="status" aria-label="Status">
              <option value="all">Any status</option>
              <option value="todo">To do</option>
              <option value="solved">Solved</option>
            </select>
            <select id="sort" aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">A–Z</option>
              <option value="company">Company</option>
            </select>
            <button type="button" class="icon-btn" id="random" title="Open a random problem from this list" aria-label="Random problem">${icon('shuffle', 17)}</button>
          </div>

          <div class="chips" id="chips"></div>

          <div class="table" role="table" aria-label="Problems">
            <div class="row row-head" role="row">
              <span role="columnheader">Status</span>
              <span role="columnheader"><span class="sr-only">Star</span></span>
              <span role="columnheader">Problem</span>
              <span role="columnheader" class="cell-company">Company</span>
              <span role="columnheader" class="cell-format">Format</span>
              <span role="columnheader" class="cell-date">Reported</span>
              <span role="columnheader"><span class="sr-only">Link</span></span>
            </div>
            <div id="rows" role="rowgroup"></div>
            <div id="sentinel" aria-hidden="true"></div>
            <div class="empty" id="empty" hidden>
              <p class="empty-title">No problems match</p>
              <p class="muted">Try a different search or clear the filters.</p>
              <button type="button" class="btn ghost" id="clear-all">Clear filters</button>
            </div>
          </div>
        </main>
      </div>
    </div>`;

  const els = {
    rows: $('#rows', root),
    sentinel: $('#sentinel', root),
    empty: $('#empty', root),
    search: $('#search', root),
    company: $('#company', root),
    status: $('#status', root),
    sort: $('#sort', root),
    chips: $('#chips', root),
  };

  let filtered = [];
  let shown = 0;

  function syncControls() {
    els.search.value = s.search;
    els.company.value = s.company;
    els.status.value = s.status;
    els.sort.value = s.sort;
    root.querySelectorAll('input[name="fresh"]').forEach(r => {
      r.checked = r.value === s.fresh;
    });
    root.querySelectorAll('.side-item').forEach(btn => {
      const active =
        (btn.dataset.list && btn.dataset.list === s.list && !s.format && !s.company) ||
        (btn.dataset.format && btn.dataset.format === s.format) ||
        (btn.dataset.company && btn.dataset.company === s.company);
      btn.classList.toggle('active', Boolean(active));
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function updateCounts() {
    const solvedTotal = questions.filter(q => store.isSolved(q.id)).length;
    $('[data-count="all"]', root).textContent = questions.length.toLocaleString();
    $('[data-count="starred"]', root).textContent = questions.filter(q => store.isStarred(q.id)).length.toLocaleString();
    $('[data-count="solved"]', root).textContent = solvedTotal.toLocaleString();
    for (const f of formats) {
      const all = questions.filter(q => q.format === f);
      const done = all.filter(q => store.isSolved(q.id)).length;
      $(`[data-fcount="${CSS.escape(f)}"]`, root).textContent = done ? `${done}/${all.length.toLocaleString()}` : all.length.toLocaleString();
      $(`[data-fbar="${CSS.escape(f)}"]`, root).style.width = `${all.length ? (done / all.length) * 100 : 0}%`;
    }
  }

  function renderHead() {
    const scope = questions.filter(q => inScope(q, s));
    const done = scope.filter(q => store.isSolved(q.id)).length;
    const title = [s.company, s.format].filter(Boolean).join(' · ') || LIST_LABEL[s.list];
    $('#list-title', root).textContent = s.list !== 'all' && (s.company || s.format) ? `${LIST_LABEL[s.list]} · ${title}` : title;
    const showing = filtered.length === scope.length ? '' : ` · ${filtered.length.toLocaleString()} shown`;
    $('#list-sub', root).textContent = `${scope.length.toLocaleString()} problems${showing}`;
    $('#prog-solved', root).textContent = done.toLocaleString();
    $('#prog-total', root).textContent = `/ ${scope.length.toLocaleString()} solved`;
    $('#prog-bar', root).style.width = `${scope.length ? Math.max((done / scope.length) * 100, done ? 1.5 : 0) : 0}%`;

    const chips = [];
    if (s.list !== 'all') chips.push(['list', LIST_LABEL[s.list]]);
    if (s.format) chips.push(['format', s.format]);
    if (s.company) chips.push(['company', s.company]);
    if (s.fresh !== 'all') chips.push(['fresh', s.fresh === 'hot' ? 'Hot' : 'Recent']);
    if (s.status !== 'all') chips.push(['status', s.status === 'todo' ? 'To do' : 'Solved']);
    if (s.search) chips.push(['search', `“${s.search}”`]);
    els.chips.innerHTML = chips.length
      ? chips.map(([k, label]) => `<button type="button" class="chip" data-clear="${k}" aria-label="Remove filter ${esc(label)}">${esc(label)}${icon('x', 12)}</button>`).join('') +
        '<button type="button" class="chip chip-clear" data-clear="all">Clear all</button>'
      : '';
  }

  function renderMore() {
    if (shown >= filtered.length) return;
    const next = filtered.slice(shown, shown + PAGE);
    els.rows.insertAdjacentHTML('beforeend', next.map(rowHtml).join(''));
    shown += next.length;
  }

  function apply({ keepScroll = false } = {}) {
    const terms = s.search.toLowerCase().split(/\s+/).filter(Boolean);
    filtered = sortList(questions.filter(q => inScope(q, s) && matches(q, s, terms)), s.sort);
    ctx.listOrder = filtered.map(q => q.id);
    els.rows.innerHTML = '';
    shown = 0;
    renderMore();
    if (keepScroll) {
      while (shown < filtered.length && els.rows.offsetHeight < s.scrollY + innerHeight) renderMore();
    }
    els.empty.hidden = filtered.length > 0;
    renderHead();
    syncControls();
  }

  function setFilter(patch) {
    Object.assign(s, patch);
    apply();
    if (scrollY > 200) $('#main', root).scrollIntoView({ block: 'start' });
  }

  function refreshRow(id) {
    const row = els.rows.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    const q = ctx.byId.get(id);
    if (row && q) row.outerHTML = rowHtml(q);
  }

  // Events
  ctx.bindHeaderActions($('.appbar', root));

  root.querySelector('.sidebar').addEventListener('click', e => {
    const btn = e.target.closest('.side-item');
    if (!btn) return;
    if (btn.dataset.list) setFilter({ list: btn.dataset.list, format: '', company: '' });
    if (btn.dataset.format) setFilter({ format: s.format === btn.dataset.format ? '' : btn.dataset.format });
    if (btn.dataset.company) setFilter({ company: s.company === btn.dataset.company ? '' : btn.dataset.company });
  });

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilter({ search: els.search.value.trim() }), 120);
  });
  els.company.addEventListener('change', () => {
    const value = els.company.value.trim();
    const match = companies.find(c => c.name.toLowerCase() === value.toLowerCase());
    setFilter({ company: match ? match.name : '' });
  });
  els.company.addEventListener('input', () => {
    if (!els.company.value && s.company) setFilter({ company: '' });
  });
  els.status.addEventListener('change', () => setFilter({ status: els.status.value }));
  els.sort.addEventListener('change', () => setFilter({ sort: els.sort.value }));
  root.querySelectorAll('input[name="fresh"]').forEach(r => r.addEventListener('change', () => setFilter({ fresh: r.value })));

  els.chips.addEventListener('click', e => {
    const key = e.target.closest('[data-clear]')?.dataset.clear;
    if (!key) return;
    if (key === 'all') setFilter({ ...defaultState(), sort: s.sort });
    else setFilter({ [key]: key === 'list' || key === 'fresh' || key === 'status' ? 'all' : '' });
  });
  $('#clear-all', root).addEventListener('click', () => setFilter({ ...defaultState(), sort: s.sort }));

  $('#random', root).addEventListener('click', () => {
    if (!filtered.length) return;
    const todo = filtered.filter(q => !store.isSolved(q.id));
    const pool = todo.length ? todo : filtered;
    ctx.navigate(`/problems/${encodeURIComponent(pool[Math.floor(Math.random() * pool.length)].id)}`);
  });

  els.rows.addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    const q = ctx.byId.get(row.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'solve') {
      ctx.toggleSolved(q);
      return;
    }
    if (act === 'star') {
      store.toggleStar(q.id);
      return;
    }
    if (e.target.closest('a')) return;
    ctx.navigate(`/problems/${encodeURIComponent(q.id)}`);
  });

  const unsubscribe = store.subscribe(change => {
    if (change.id) refreshRow(change.id);
    updateCounts();
    renderHead();
    if (change.type === 'sheet') ctx.refreshHeader();
  });

  const io = new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) renderMore();
  }, { rootMargin: '600px' });
  io.observe(els.sentinel);

  const onKey = e => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      els.search.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  const onScroll = () => {
    s.scrollY = scrollY;
  };
  addEventListener('scroll', onScroll, { passive: true });

  updateCounts();
  apply({ keepScroll: true });
  requestAnimationFrame(() => scrollTo(0, s.scrollY));

  return () => {
    io.disconnect();
    unsubscribe();
    document.removeEventListener('keydown', onKey);
    removeEventListener('scroll', onScroll);
  };
}
