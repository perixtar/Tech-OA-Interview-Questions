// The solve log: one row in the Google Sheet. Used by the solve dialog and the Notes tab.
import { esc } from './ui.js';

export const QUALITY_OPTIONS = [
  ['Solved Clean', 'Solved clean, no hints'],
  ['Needed Hints', 'Needed hints'],
  ['Looked at Solution', 'Looked at the solution'],
  ['Needs Review', 'Needs review / retry'],
  ['Timed Out', 'Timed out'],
];

export function logFieldsHtml(note, idPrefix) {
  const id = name => `${idPrefix}-${name}`;
  return `
    <div class="form-grid">
      <div class="field">
        <label for="${id('pattern')}">Pattern</label>
        <input id="${id('pattern')}" name="pattern" list="pattern-list" value="${esc(note.pattern)}" placeholder="e.g. Sliding window" autocomplete="off">
      </div>
      <div class="field">
        <label for="${id('time')}">Time taken <span class="muted">(min)</span></label>
        <input id="${id('time')}" name="timeTaken" type="number" min="0" step="1" inputmode="numeric" value="${esc(note.timeTaken)}">
      </div>
      <div class="field">
        <label for="${id('quality')}">How did it go?</label>
        <select id="${id('quality')}" name="quality">
          ${QUALITY_OPTIONS.map(([v, label]) => `<option value="${esc(v)}"${v === note.quality ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="${id('date')}">Date solved</label>
        <input id="${id('date')}" name="dateSolved" type="date" value="${esc(note.dateSolved)}">
      </div>
      <div class="field span-2">
        <label for="${id('comments')}">Notes</label>
        <textarea id="${id('comments')}" name="comments" rows="4" placeholder="Key insight, edge cases, what to revisit">${esc(note.comments)}</textarea>
      </div>
    </div>`;
}

export function readLogFields(form) {
  const data = new FormData(form);
  return {
    pattern: String(data.get('pattern') || '').trim(),
    timeTaken: String(data.get('timeTaken') || '').trim(),
    quality: String(data.get('quality') || 'Solved Clean'),
    dateSolved: String(data.get('dateSolved') || ''),
    comments: String(data.get('comments') || '').trim(),
  };
}
