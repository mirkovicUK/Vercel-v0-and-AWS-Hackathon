/*
 * m6.js — the synthetic (m6) question review app.
 *
 * Loads synthetic/review-bundle.json and renders one generated question at a
 * time: the stem + five options with the Generator's correctIndex marked, the
 * Generator solution, the Inspector cold answer/steps/difficulty estimate, the
 * Adjudicator verdict (when present), the triage verdict + flag reason(s), and
 * the in-batch duplicates list. The operator records approve/reject and may
 * adjust the stem / options / correctIndex / topic / difficulty of a flagged
 * item. State is held in localStorage continuously. "Export decisions"
 * downloads m6-decisions.json in the exact shape build_handoff consumes.
 *
 * Decision rules (Req 8.2, 8.3):
 *   - green  entries are pre-seeded "approve"; one click flips to reject.
 *   - flagged entries start undecided; "approve" is only valid once the reviewer
 *     has edited a field OR ticked the reviewed-confirmation. The export refuses
 *     to emit a bare "approve" for an untouched flagged item.
 *
 * Served by `python -m http.server` from data/ so relative fetches resolve:
 *   open  http://localhost:8000/pipeline/review_app/m6.html
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5.
 */

const STORAGE_KEY = 'm6-decisions';
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

const state = {
  bundle: null,
  view: [],          // indices into bundle.entries currently shown (filter-aware)
  pos: 0,            // position within state.view
  decisions: {},     // qid -> { decision, stem, options, correctIndex, topic,
                     //          difficulty, note, edited, reviewed }
  onlyFlagged: false,
  qidIndex: {},      // qid -> index into bundle.entries (built once on load)
};

// ---------- persistence ----------

function loadDecisions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveDecisions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.decisions));
}

// ---------- data load ----------

async function load() {
  state.decisions = loadDecisions();
  const res = await fetch('../../synthetic/review-bundle.json');
  if (!res.ok) {
    alert('Could not load synthetic/review-bundle.json. Run build_m6_review.py first.');
    return;
  }
  state.bundle = await res.json();
  // Build a qid -> index map once so the duplicates panel can resolve each
  // duplicate qid to its full entry (and jump target) without rescanning.
  state.qidIndex = {};
  state.bundle.entries.forEach((e, i) => { state.qidIndex[e.qid] = i; });
  rebuildView();
  render();
}

function isFlagged(e) {
  return !!(e.triage && e.triage.verdict === 'flagged');
}

function rebuildView() {
  const entries = state.bundle.entries;
  state.view = entries
    .map((e, i) => i)
    .filter((i) => (state.onlyFlagged ? isFlagged(entries[i]) : true));
  if (state.pos >= state.view.length) state.pos = 0;
}

// ---------- decision helpers ----------

function currentEntry() {
  if (!state.view.length) return null;
  return state.bundle.entries[state.view[state.pos]];
}

function decisionFor(e) {
  if (!state.decisions[e.qid]) {
    // Pre-seed editable fields from the bundle entry. The decision is taken from
    // the bundle's pre-seeded value: "approve" for green, null for flagged.
    state.decisions[e.qid] = {
      decision: e.decision || null,
      stem: e.stem || '',
      options: (e.options || []).slice(),
      correctIndex: typeof e.correctIndex === 'number' ? e.correctIndex : null,
      topic: e.topic || '',
      difficulty: typeof e.difficulty === 'number' ? e.difficulty : null,
      note: '',
      edited: false,    // reviewer changed an editable field
      reviewed: false,  // reviewer explicitly confirmed a flagged item
    };
  }
  return state.decisions[e.qid];
}

function countDecided() {
  return Object.values(state.decisions).filter((d) => d.decision).length;
}

// approve is only valid for a flagged item once it was edited or confirmed.
function approveBlocked(e, d) {
  return isFlagged(e) && d.decision === 'approve' && !(d.edited || d.reviewed);
}

// ---------- rendering ----------

function render() {
  const e = currentEntry();
  const total = state.bundle.entries.length;
  if (!e) {
    document.getElementById('progress').textContent =
      `0 shown (${countDecided()}/${total} decided)`;
    document.getElementById('q-heading').textContent = '(nothing matches the filter)';
    document.getElementById('q-stem').textContent = '';
    document.getElementById('q-options').innerHTML = '';
    document.getElementById('flags').innerHTML = '';
    return;
  }
  const d = decisionFor(e);

  document.getElementById('progress').textContent =
    `${e.qid} · ${state.pos + 1}/${state.view.length} shown · ${countDecided()}/${total} decided`;

  renderQuestionView(e, d);

  // evidence — generator solution
  document.getElementById('gen-solution').textContent = e.generatorSolution || '(none)';

  // evidence — inspector
  document.getElementById('inspector-box').innerHTML = renderInspector(e.inspector);

  // evidence — adjudicator
  document.getElementById('adjudicator-box').innerHTML = renderAdjudicator(e.adjudicator);

  // evidence — triage
  document.getElementById('triage-box').innerHTML = renderTriage(e.triage);

  // evidence — duplicates
  document.getElementById('dups-box').innerHTML = renderDuplicates(e.duplicates);

  // controls
  setRadio('decision', d.decision);
  document.getElementById('note-input').value = d.note || '';
  document.getElementById('only-flagged').checked = state.onlyFlagged;

  // flagged-only confirmation control
  const confirmRow = document.getElementById('confirm-row');
  confirmRow.hidden = !isFlagged(e);
  document.getElementById('confirm-reviewed').checked = !!d.reviewed;

  // editable fields
  document.getElementById('edit-stem').value = d.stem || '';
  renderEditOptions(e, d);
  renderEditCorrect(d);
  document.getElementById('edit-topic').value = d.topic || '';
  document.getElementById('edit-difficulty').value = d.difficulty != null ? String(d.difficulty) : '';
  // open the editor by default for flagged items so the reviewer sees it
  document.getElementById('edit-group').open = isFlagged(e);

  showWarning(e, d);
}

// re-render only the left "child view" (used on live edits to avoid focus loss)
function renderQuestionView(e, d) {
  // flags
  const flags = [];
  const tf = (e.triage && e.triage.verdict) || 'none';
  flags.push(`<span class="badge triage-${tf}">${tf}</span>`);
  if (d.edited) flags.push('<span class="badge info">edited</span>');
  if (d.decision) {
    const cls = approveBlocked(e, d) ? 'danger' : 'ok';
    flags.push(`<span class="badge ${cls}">${d.decision}</span>`);
  }
  document.getElementById('flags').innerHTML = flags.join(' ');

  document.getElementById('q-heading').textContent =
    `${e.qid}  ·  seed ${e.seedQid || '?'}  ·  ${d.topic || '?'}  ·  difficulty ${d.difficulty ?? '?'}`;
  document.getElementById('q-stem').textContent = d.stem || '';

  const ul = document.getElementById('q-options');
  ul.innerHTML = '';
  (d.options || []).forEach((opt, i) => {
    const li = document.createElement('li');
    if (i === d.correctIndex) li.className = 'correct';
    const letter = document.createElement('span');
    letter.className = 'opt-letter';
    letter.textContent = LETTERS[i] || String(i + 1);
    const text = document.createElement('span');
    text.textContent = opt + (i === d.correctIndex ? '  ✓' : '');
    li.appendChild(letter);
    li.appendChild(text);
    ul.appendChild(li);
  });
}

function renderInspector(insp) {
  if (!insp) return '<p class="verdict-kv">No inspector result.</p>';
  // Each field renders as its own block-level row so they stack one per line
  // (wrapped in .kv-stack so the block override doesn't affect other panels
  // that reuse .verdict-kv inline).
  const kv = (k, val) => `<div class="verdict-kv"><b>${k}:</b> ${escapeHtml(String(val))}</div>`;
  const fields = [
    kv('answer', insp.answer ?? '—'),
    kv('matchedIndex', insp.inspectorIndex ?? '—'),
    kv('answersAgree', insp.answersAgree),
    kv('difficulty', insp.inspectorDifficulty ?? '—'),
    kv('exactlyOneCorrect', insp.exactlyOneCorrect),
  ];
  const rows = [`<div class="kv-stack">${fields.join('')}</div>`];
  if (insp.steps) rows.push(`<p class="evidence-text">${escapeHtml(insp.steps)}</p>`);
  return rows.join('');
}

function renderAdjudicator(adj) {
  if (!adj) return '<p class="verdict-kv">Not adjudicated (solvers agreed, unambiguous).</p>';
  const kv = (k, val) => `<span class="verdict-kv"><b>${k}:</b> ${escapeHtml(String(val))}</span>`;
  const rows = [
    `<div class="verdict-row">${kv('correctAnswer', adj.correctAnswer ?? '—')} ${kv('unresolved', adj.unresolved)} ${kv('exactlyOneCorrect', adj.exactlyOneCorrect)}</div>`,
  ];
  if (adj.rationale) rows.push(`<p class="evidence-text">${escapeHtml(adj.rationale)}</p>`);
  return rows.join('');
}

function renderTriage(triage) {
  if (!triage) return '<p class="verdict-kv">No triage verdict.</p>';
  const rows = [`<div class="verdict-row"><span class="badge triage-${triage.verdict}">${triage.verdict}</span></div>`];
  if (triage.reasons && triage.reasons.length) {
    rows.push('<ul class="reasons">' + triage.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>');
  }
  return rows.join('');
}

function renderDuplicates(dups) {
  if (!dups || !dups.length) return '<p class="verdict-kv">None.</p>';
  return dups.map((qid) => {
    const idx = state.qidIndex ? state.qidIndex[qid] : undefined;
    const dup = idx != null ? state.bundle.entries[idx] : null;
    // Shouldn't happen, but degrade gracefully to the bare qid as before.
    if (!dup) {
      return `<div class="dup-card"><div class="dup-head"><code>${escapeHtml(qid)}</code>`
        + ` <span class="verdict-kv">(not in bundle)</span></div></div>`;
    }
    const opts = (dup.options || []).map((opt, i) => {
      const correct = i === dup.correctIndex;
      const letter = LETTERS[i] || String(i + 1);
      return `<li class="${correct ? 'correct' : ''}">`
        + `<span class="opt-letter">${letter}</span>`
        + `<span>${escapeHtml(opt)}${correct ? '  ✓' : ''}</span></li>`;
    }).join('');
    return `<div class="dup-card">`
      + `<div class="dup-head">`
      + `<code>${escapeHtml(dup.qid)}</code> `
      + `<span class="verdict-kv">${escapeHtml(dup.topic || '?')} · difficulty `
      + `${escapeHtml(String(dup.difficulty ?? '?'))}</span> `
      + `<button type="button" class="dup-jump" data-jump-qid="${escapeHtml(dup.qid)}">Jump to</button>`
      + `</div>`
      + `<p class="evidence-text">${escapeHtml(dup.stem || '')}</p>`
      + `<ul class="dup-options q-options">${opts}</ul>`
      + `</div>`;
  }).join('');
}

// Navigate the review view to a duplicate entry. If the duplicate is filtered
// out by the needs-review filter, switch the filter off so it becomes visible,
// then position on it. Falls back to an alert if it can't be located.
function jumpToDuplicate(qid) {
  const targetIdx = state.qidIndex ? state.qidIndex[qid] : undefined;
  if (targetIdx == null) { alert(`${qid} is not in the bundle.`); return; }
  let pos = state.view.indexOf(targetIdx);
  if (pos < 0) {
    // Filtered out (e.g. it's green and the needs-review filter is on).
    // Drop the filter so the duplicate is visible.
    state.onlyFlagged = false;
    rebuildView();
    pos = state.view.indexOf(targetIdx);
  }
  if (pos >= 0) { state.pos = pos; render(); }
  else { alert(`Could not navigate to ${qid}.`); }
}

function renderEditOptions(e, d) {
  const wrap = document.getElementById('edit-options');
  wrap.innerHTML = '';
  (d.options || []).forEach((opt, i) => {
    const row = document.createElement('div');
    row.className = 'edit-option-row';
    const letter = document.createElement('span');
    letter.className = 'opt-letter';
    letter.textContent = LETTERS[i] || String(i + 1);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = opt;
    input.addEventListener('input', (ev) => {
      d.options[i] = ev.target.value;
      markEdited(d);
      renderQuestionView(e, d);
      saveDecisions();
    });
    row.appendChild(letter);
    row.appendChild(input);
    wrap.appendChild(row);
  });
}

function renderEditCorrect(d) {
  const sel = document.getElementById('edit-correct');
  sel.innerHTML = '';
  (d.options || []).forEach((_opt, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${LETTERS[i] || i + 1}`;
    sel.appendChild(o);
  });
  if (d.correctIndex != null) sel.value = String(d.correctIndex);
}

function markEdited(d) {
  d.edited = true;
}

function showWarning(e, d) {
  const el = document.getElementById('warning');
  const msgs = [];
  if (approveBlocked(e, d)) {
    msgs.push('This flagged item is set to "approve" but was not adjusted or confirmed. '
      + 'Edit a field or tick the reviewed confirmation (or reject) — the export will refuse it otherwise.');
  }
  if (d.decision === 'approve' && (!d.stem || !d.stem.trim())) {
    msgs.push('Stem is empty — build_handoff will exclude this question.');
  }
  if (d.decision === 'approve' && (d.options || []).some((o) => !o || !o.trim())) {
    msgs.push('One or more options are empty — build_handoff will exclude this question.');
  }
  if (msgs.length) { el.hidden = false; el.textContent = msgs.join(' '); }
  else { el.hidden = true; }
}

// ---------- controls ----------

function wire() {
  document.getElementById('prev-btn').addEventListener('click', () => move(-1));
  document.getElementById('next-btn').addEventListener('click', () => move(1));
  document.getElementById('jump-input').addEventListener('change', (ev) => {
    const num = String(ev.target.value).padStart(3, '0');
    const idx = state.view.findIndex((i) => state.bundle.entries[i].qid.endsWith(num));
    if (idx >= 0) { state.pos = idx; render(); }
  });

  document.querySelectorAll('input[name="decision"]').forEach((r) => {
    r.addEventListener('change', () => {
      decisionFor(currentEntry()).decision = r.value;
      saveDecisions(); render();
    });
  });

  document.getElementById('confirm-reviewed').addEventListener('change', (ev) => {
    decisionFor(currentEntry()).reviewed = ev.target.checked;
    saveDecisions(); render();
  });

  document.getElementById('edit-stem').addEventListener('input', (ev) => {
    const e = currentEntry(); const d = decisionFor(e);
    d.stem = ev.target.value; markEdited(d); renderQuestionView(e, d);
    showWarning(e, d); saveDecisions();
  });
  document.getElementById('edit-correct').addEventListener('change', (ev) => {
    const e = currentEntry(); const d = decisionFor(e);
    d.correctIndex = parseInt(ev.target.value, 10); markEdited(d);
    renderQuestionView(e, d); saveDecisions();
  });
  document.getElementById('edit-topic').addEventListener('change', (ev) => {
    const e = currentEntry(); const d = decisionFor(e);
    d.topic = ev.target.value; markEdited(d); renderQuestionView(e, d); saveDecisions();
  });
  document.getElementById('edit-difficulty').addEventListener('change', (ev) => {
    const e = currentEntry(); const d = decisionFor(e);
    d.difficulty = parseInt(ev.target.value, 10); markEdited(d);
    renderQuestionView(e, d); saveDecisions();
  });

  document.getElementById('note-input').addEventListener('input', (ev) => {
    decisionFor(currentEntry()).note = ev.target.value; saveDecisions();
  });

  document.getElementById('only-flagged').addEventListener('change', (ev) => {
    state.onlyFlagged = ev.target.checked;
    state.pos = 0;
    rebuildView(); render();
  });

  document.getElementById('export-btn').addEventListener('click', exportDecisions);

  // Delegated handler for the inline "Jump to" buttons in the Duplicates panel.
  // The panel's innerHTML is rebuilt on every render, so a single delegated
  // listener on the stable container avoids re-binding per render.
  document.getElementById('dups-box').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-jump-qid]');
    if (btn) jumpToDuplicate(btn.getAttribute('data-jump-qid'));
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT'
        || ev.target.tagName === 'SELECT') return;
    if (ev.key === 'ArrowLeft') move(-1);
    if (ev.key === 'ArrowRight') move(1);
  });
}

function move(delta) {
  if (!state.view.length) return;
  state.pos = (state.pos + delta + state.view.length) % state.view.length;
  render();
}

function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === value; });
}

// ---------- export (Req 8.4, 8.5) ----------

function exportDecisions() {
  const out = {};
  const blocked = [];
  let greenAuto = 0;     // green entries auto-approved without an explicit decision
  let reviewed = 0;      // entries carrying an explicit reviewer decision

  // Req 8.2: iterate over EVERY bundle entry, not just the ones held in
  // state.decisions. A green entry the reviewer never navigated to has no
  // localStorage record, but it still passed all checks and must be exported.
  for (const e of state.bundle.entries) {
    const d = state.decisions[e.qid];

    if (d && d.decision) {
      // Reviewer made an explicit choice (a flagged approve/reject, or a green
      // they flipped to reject). Source fields from state.decisions so any
      // edits to stem/options/correctIndex/topic/difficulty are preserved.
      // Req 8.3: still refuse a bare "approve" on an untouched flagged item.
      if (approveBlocked(e, d)) { blocked.push(e.qid); continue; }
      out[e.qid] = {
        decision: d.decision,
        topic: d.topic,
        difficulty: d.difficulty,
        correctIndex: d.correctIndex,
        stem: d.stem,
        options: (d.options || []).slice(),
        figure: null,
        note: d.note || '',
      };
      reviewed += 1;
    } else if (e.decision === 'approve') {
      // Green, untouched by the reviewer: auto-approve straight from the bundle
      // entry's own fields. Green = passed all checks, so it is never blocked.
      out[e.qid] = {
        decision: 'approve',
        topic: e.topic || '',
        difficulty: typeof e.difficulty === 'number' ? e.difficulty : null,
        correctIndex: typeof e.correctIndex === 'number' ? e.correctIndex : null,
        stem: e.stem || '',
        options: (e.options || []).slice(),
        figure: null,
        note: '',
      };
      greenAuto += 1;
    }
    // else: flagged and undecided — still needs review, so skip it.
  }

  if (blocked.length) {
    alert(`Export refused. ${blocked.length} flagged item(s) are set to "approve" but were never `
      + `adjusted or confirmed:\n\n${blocked.join(', ')}\n\n`
      + `Edit a field, tick the reviewed confirmation, or reject each one, then export again.`);
    return;
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'm6-decisions.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  alert(`Exported ${Object.keys(out).length} decisions `
    + `(${greenAuto} green auto-approved, ${reviewed} explicitly reviewed). `
    + `Save it as data/review/m6-decisions.json`);
}

// ---------- util ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- boot ----------

wire();
load();
