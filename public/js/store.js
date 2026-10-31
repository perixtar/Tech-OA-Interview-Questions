// Local progress state. The tech_oa_*_v1 keys are shared with the previous version of
// the app so existing solved/starred/notes data carries over.

const KEYS = {
  solved: 'tech_oa_solved_v1',
  starred: 'tech_oa_bookmarks_v1',
  notes: 'tech_oa_notes_v1',
  solvedDates: 'tech_oa_solved_dates_v1',
  comments: 'tech_oa_comments_v1',
  sheetUrl: 'tech_oa_gsheet_url_v1',
  prefs: 'oa_prefs_v2',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {}
}

function readRaw(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

const listeners = new Set();

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const store = {
  solved: new Set(read(KEYS.solved, [])),
  starred: new Set(read(KEYS.starred, [])),
  notes: read(KEYS.notes, {}),
  solvedDates: read(KEYS.solvedDates, {}),
  comments: read(KEYS.comments, {}),
  sheetUrl: readRaw(KEYS.sheetUrl),
  prefs: {
    lang: 'python',
    autoLog: true,
    fontSize: 14,
    leftPane: 44,
    editorPane: 62,
    ...read(KEYS.prefs, {}),
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  emit(change) {
    listeners.forEach(fn => fn(change));
  },

  isSolved(id) {
    return this.solved.has(id);
  },

  isStarred(id) {
    return this.starred.has(id);
  },

  toggleStar(id) {
    if (this.starred.has(id)) this.starred.delete(id);
    else this.starred.add(id);
    write(KEYS.starred, [...this.starred]);
    this.emit({ type: 'star', id });
    return this.starred.has(id);
  },

  // The solve log mirrors one row of the Google Sheet.
  getNote(id) {
    const note = this.notes[id] || {};
    return {
      pattern: note.pattern || '',
      timeTaken: note.timeTaken || '',
      quality: note.quality || 'Solved Clean',
      dateSolved: note.dateSolved || this.solvedDates[id] || today(),
      comments: note.comments ?? this.comments[id] ?? '',
    };
  },

  markSolved(id, note = {}) {
    const merged = { ...this.getNote(id), ...note };
    this.solved.add(id);
    this.notes[id] = merged;
    this.solvedDates[id] = merged.dateSolved;
    if (merged.comments) this.comments[id] = merged.comments;
    else delete this.comments[id];
    write(KEYS.solved, [...this.solved]);
    write(KEYS.notes, this.notes);
    write(KEYS.solvedDates, this.solvedDates);
    write(KEYS.comments, this.comments);
    this.emit({ type: 'solved', id });
    return merged;
  },

  markUnsolved(id) {
    this.solved.delete(id);
    write(KEYS.solved, [...this.solved]);
    this.emit({ type: 'solved', id });
  },

  setSheetUrl(url) {
    this.sheetUrl = url.trim();
    if (this.sheetUrl) write(KEYS.sheetUrl, this.sheetUrl);
    else {
      try {
        localStorage.removeItem(KEYS.sheetUrl);
      } catch {}
    }
    this.emit({ type: 'sheet' });
  },

  savePrefs(patch) {
    Object.assign(this.prefs, patch);
    write(KEYS.prefs, this.prefs);
  },

  getCode(id, lang) {
    return readRaw(`oa_code_v2:${id}:${lang}`) || null;
  },

  setCode(id, lang, code) {
    write(`oa_code_v2:${id}:${lang}`, code);
  },

  clearCode(id, lang) {
    try {
      localStorage.removeItem(`oa_code_v2:${id}:${lang}`);
    } catch {}
  },

  getSubmissions(id) {
    return read(`oa_subs_v2:${id}`, []);
  },

  addSubmission(id, sub) {
    const subs = [sub, ...this.getSubmissions(id)].slice(0, 15);
    write(`oa_subs_v2:${id}`, subs);
    return subs;
  },
};
