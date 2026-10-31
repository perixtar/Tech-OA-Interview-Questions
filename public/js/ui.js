// Small shared UI helpers: icons, escaping, toasts, statement sanitizing.

const ICON_PATHS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  circleCheck: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.3 4.6-4.8"/>',
  star: '<path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  play: '<path d="M7.5 5.2v13.6a.6.6 0 0 0 .92.5l10.4-6.8a.6.6 0 0 0 0-1L8.42 4.7a.6.6 0 0 0-.92.5z" fill="currentColor" stroke="none"/>',
  upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  external: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5"/><path d="M4 3.5v5h5"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 1.6M9.5 2.8h5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  shuffle: '<path d="M16 4h4v4"/><path d="M4 19 20 4"/><path d="M20 16v4h-4"/><path d="m14.5 14.5 5.5 5.5"/><path d="M4 5l5 5"/>',
  file: '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 2 2"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5"/><path d="M4 3.5v5h5M12 8v4l2.8 1.8"/>',
  terminal: '<path d="m5 17 5-5-5-5"/><path d="M12.5 18H19"/>',
  checkSquare: '<path d="m8.5 11.5 2.5 2.5 6-6"/><rect x="4" y="4" width="16" height="16" rx="3"/>',
  code: '<path d="m16 17 5-5-5-5"/><path d="m8 7-5 5 5 5"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="1.8"/><path d="M8.5 20h7M12 16.5V20"/>',
  logo: '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="var(--accent)" stroke="none"/><path d="m9.5 9-3 3 3 3M14.5 9l3 3-3 3" stroke="var(--accent-contrast)" stroke-width="2"/>',
};

export function icon(name, size = 16, extra = '') {
  return `<svg class="icon ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const FORMAT_CLASS = {
  coding: 'f-coding',
  'system design': 'f-sd',
  'low-level design': 'f-lld',
  'ai coding': 'f-ai',
  sql: 'f-sql',
};

export function formatClass(format) {
  return FORMAT_CLASS[String(format || '').toLowerCase()] || 'f-coding';
}

export function formatPill(format) {
  return `<span class="pill ${formatClass(format)}">${esc(format)}</span>`;
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function shortDate(isoDate, fallback = '') {
  if (!isoDate) return fallback;
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/* ------------------------------------------------------------------- toasts */

const TOAST_MS = 3800;

// popover="manual" keeps toasts in the top layer without light-dismiss.
export function toast(message, { tone = 'neutral', action, duration = TOAST_MS } = {}) {
  const stack = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.onClick();
      dismiss();
    });
    el.append(btn);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML = icon('x', 14);
  close.addEventListener('click', () => dismiss());
  el.append(close);
  stack.append(el);
  if (stack.showPopover && !stack.matches(':popover-open')) stack.showPopover();

  let timer = setTimeout(dismiss, duration);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => {
    timer = setTimeout(dismiss, 1500);
  });

  function dismiss() {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => {
      el.remove();
      if (!stack.children.length && stack.hidePopover && stack.matches(':popover-open')) stack.hidePopover();
    }, 180);
  }
  return dismiss;
}

/* -------------------------------------------------------------- statements */

const ALLOWED_TAGS = new Set(['P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'CODE', 'PRE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H3', 'H4', 'H5', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUP', 'SUB', 'A', 'IMG', 'SPAN', 'DIV', 'DETAILS', 'SUMMARY']);
const UNWRAP_TAGS = new Set(['SECTION', 'ARTICLE', 'MAIN', 'FONT', 'LABEL']);

// FastPrep statement HTML is third-party content: keep a strict allowlist.
export function sanitizeStatement(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild;

  root.querySelectorAll('h2').forEach(h => {
    if (/^problem statement$/i.test(h.textContent.trim())) h.remove();
  });
  root.querySelectorAll('aside').forEach(aside => {
    const details = doc.createElement('details');
    details.className = 'source-note';
    const summary = doc.createElement('summary');
    summary.textContent = 'Source note';
    details.append(summary, ...aside.childNodes);
    aside.replaceWith(details);
  });

  const walk = node => {
    for (const child of [...node.children]) {
      const tag = child.tagName;
      if (tag === 'H1' || tag === 'H2') {
        const h = doc.createElement('h3');
        h.append(...child.childNodes);
        child.replaceWith(h);
        walk(h);
        continue;
      }
      if (UNWRAP_TAGS.has(tag)) {
        child.replaceWith(...child.childNodes);
        walk(node);
        return;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const keep =
          (tag === 'A' && attr.name === 'href' && /^https?:/i.test(attr.value)) ||
          (tag === 'IMG' && (attr.name === 'alt' || (attr.name === 'src' && /^https:/i.test(attr.value)))) ||
          ((tag === 'TD' || tag === 'TH') && (attr.name === 'colspan' || attr.name === 'rowspan')) ||
          (tag === 'DETAILS' && attr.name === 'class');
        if (!keep) child.removeAttribute(attr.name);
      }
      if (tag === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
