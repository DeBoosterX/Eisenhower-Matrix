/* ============================================================
   Eisenhower Matrix — app.js
   Features: LocalStorage, Drag & drop (between + within quadrant),
   Due dates, Overdue highlight, Priority score, Tags, Notes,
   Task completion + archive, Search, Filter, Stats panel,
   Export (text/JSON/print), Gemini AI auto-sort
   ============================================================ */

'use strict';

/* ─── STATE ─────────────────────────────────────────────────── */
let tasks = {};          // { [id]: taskObj }
let archived = [];       // [ taskObj ]
let dragId = null;
let dragOverId = null;   // for within-quadrant reorder
let idCounter = Date.now();
let activeFilter = 'all';
let searchQuery = '';
let editingId = null;
let geminiKey = '';

/* ─── CONSTANTS ─────────────────────────────────────────────── */
const STORAGE_TASKS    = 'em_tasks_v3';
const STORAGE_ARCHIVED = 'em_archived_v3';
const STORAGE_KEY      = 'em_gemini_key';
const QUADRANT_NAMES   = { q1: 'Do First', q2: 'Schedule', q3: 'Delegate', q4: 'Eliminate' };
const TAG_ICONS        = { work:'💼', personal:'🏠', health:'❤️', finance:'💰', study:'📚', project:'🚀' };
const TAG_LABELS       = { work:'Work', personal:'Personal', health:'Health', finance:'Finance', study:'Study', project:'Project' };
const PRIORITY_STARS   = { 1:'★', 2:'★★', 3:'★★★', 4:'★★★★', 5:'★★★★★' };

/* ─── HELPERS ────────────────────────────────────────────────── */
function uid() { return 'task-' + (++idCounter); }

function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function isDueSoon(dateStr) {
  if (!dateStr) return false;
  const due = new Date(dateStr);
  const now = new Date();
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 3;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < today();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showToast(msg, duration = 2400) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ─── STORAGE ────────────────────────────────────────────────── */
function saveTasks() {
  localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
  localStorage.setItem(STORAGE_ARCHIVED, JSON.stringify(archived));
}

function loadTasks() {
  try {
    const t = localStorage.getItem(STORAGE_TASKS);
    const a = localStorage.getItem(STORAGE_ARCHIVED);
    if (t) tasks = JSON.parse(t);
    if (a) archived = JSON.parse(a);
  } catch (e) {
    tasks = {}; archived = [];
  }
}

function saveKey() {
  if (geminiKey) localStorage.setItem(STORAGE_KEY, geminiKey);
  else localStorage.removeItem(STORAGE_KEY);
}

function loadKey() {
  geminiKey = localStorage.getItem(STORAGE_KEY) || '';
}

/* ─── TASK OBJECT ────────────────────────────────────────────── */
function makeTask(text, opts = {}) {
  return {
    id:        opts.id || uid(),
    text:      text.trim(),
    q:         opts.q || 'q1',
    date:      opts.date || '',
    priority:  parseInt(opts.priority) || 3,
    tag:       opts.tag || '',
    notes:     opts.notes || '',
    completed: opts.completed || false,
    created:   opts.created || Date.now(),
    order:     opts.order || Date.now(),
  };
}

/* ─── RENDER SINGLE TASK CARD ────────────────────────────────── */
function createTaskEl(task) {
  const card = document.createElement('div');
  card.className = 'task-card' +
    (task.completed ? ' completed' : '') +
    (isOverdue(task.date) && !task.completed ? ' overdue' : '');
  card.dataset.id = task.id;
  card.draggable = true;

  // Priority dot
  const priDot = `<span class="priority-dot pri-${task.priority}" title="Priority ${task.priority}"></span>`;

  // Tag pill
  const tagHtml = task.tag
    ? `<span class="tag-pill tag-${task.tag}">${TAG_ICONS[task.tag] || ''} ${TAG_LABELS[task.tag] || task.tag}</span>`
    : '';

  // Due date label
  let dueHtml = '';
  if (task.date) {
    if (isOverdue(task.date) && !task.completed) {
      dueHtml = `<span class="due-label overdue">⚠ Overdue · ${formatDate(task.date)}</span>`;
    } else if (isDueSoon(task.date) && !task.completed) {
      dueHtml = `<span class="due-label due-soon">⏰ Due soon · ${formatDate(task.date)}</span>`;
    } else {
      dueHtml = `<span class="due-label">📅 ${formatDate(task.date)}</span>`;
    }
  }

  // Notes preview
  const notesHtml = task.notes
    ? `<div class="task-notes-preview" title="${escHtml(task.notes)}">💬 ${escHtml(task.notes)}</div>`
    : '';

  card.innerHTML = `
    <div class="task-top">
      <span class="drag-handle" aria-hidden="true">⠿</span>
      <div class="task-main">
        <div class="task-text">${escHtml(task.text)}</div>
      </div>
      <div class="task-actions">
        <button class="btn-check ${task.completed ? 'checked' : ''}" data-id="${task.id}" title="${task.completed ? 'Uncheck' : 'Complete'}">
          ${task.completed ? '✅' : '○'}
        </button>
        <button class="btn-edit-task" data-id="${task.id}" title="Edit">✏️</button>
        <button class="btn-del-task" data-id="${task.id}" title="Delete">×</button>
      </div>
    </div>
    <div class="task-meta">
      ${priDot}
      ${tagHtml}
      ${dueHtml}
    </div>
    ${notesHtml}
  `;

  // Drag events
  card.addEventListener('dragstart', onCardDragStart);
  card.addEventListener('dragend', onCardDragEnd);
  card.addEventListener('dragover', onCardDragOver);
  card.addEventListener('drop', onCardDrop);

  // Button events
  card.querySelector('.btn-check').addEventListener('click', e => {
    e.stopPropagation();
    toggleComplete(task.id);
  });
  card.querySelector('.btn-edit-task').addEventListener('click', e => {
    e.stopPropagation();
    openDetail(task.id);
  });
  card.querySelector('.btn-del-task').addEventListener('click', e => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  return card;
}

/* ─── RENDER ALL ─────────────────────────────────────────────── */
function renderAll() {
  ['q1','q2','q3','q4'].forEach(q => {
    const list = document.getElementById('list-' + q);
    list.innerHTML = '';

    // Filter + search tasks for this quadrant
    let qTasks = Object.values(tasks).filter(t => {
      if (t.q !== q) return false;
      if (searchQuery) {
        const s = searchQuery.toLowerCase();
        if (!t.text.toLowerCase().includes(s) &&
            !(t.notes || '').toLowerCase().includes(s)) return false;
      }
      if (activeFilter === 'all') return true;
      if (activeFilter === 'completed') return t.completed;
      if (activeFilter === 'overdue') return isOverdue(t.date) && !t.completed;
      return t.tag === activeFilter;
    });

    // Sort: priority desc, then order asc
    qTasks.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.order - b.order;
    });

    qTasks.forEach(task => list.appendChild(createTaskEl(task)));

    // Show/hide drop hint
    const hint = document.getElementById('hint-' + q);
    if (qTasks.length > 0) hint.classList.add('hidden');
    else hint.classList.remove('hidden');

    // Badge count (always show real total, not filtered)
    const total = Object.values(tasks).filter(t => t.q === q).length;
    document.getElementById('badge-' + q).textContent = total;
  });

  updateFooter();
}

/* ─── FOOTER / PROGRESS ──────────────────────────────────────── */
function updateFooter() {
  const all = Object.values(tasks);
  const total = all.length;
  const completed = all.filter(t => t.completed).length;
  const overdue = all.filter(t => isOverdue(t.date) && !t.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById('footerTotal').textContent = `${total} task${total !== 1 ? 's' : ''}`;
  document.getElementById('footerCompleted').textContent = `${completed} completed`;
  document.getElementById('footerOverdue').textContent = overdue > 0 ? `${overdue} overdue` : '';
  document.getElementById('progressBar').style.width = pct + '%';
}

/* ─── ADD TASK ───────────────────────────────────────────────── */
function addTask(overrideQ) {
  const text = document.getElementById('taskInput').value.trim();
  if (!text) { showToast('Please enter a task first.'); return; }

  const task = makeTask(text, {
    q:        overrideQ || document.getElementById('taskQuadrant').value,
    date:     document.getElementById('taskDate').value,
    priority: document.getElementById('taskPriority').value,
    tag:      document.getElementById('taskTag').value,
    notes:    document.getElementById('taskNotes').value.trim(),
  });

  tasks[task.id] = task;
  saveTasks();
  renderAll();
  clearInputs();
  showToast('Task added to ' + QUADRANT_NAMES[task.q]);
}

function clearInputs() {
  document.getElementById('taskInput').value = '';
  document.getElementById('taskDate').value = '';
  document.getElementById('taskPriority').value = '3';
  document.getElementById('taskTag').value = '';
  document.getElementById('taskNotes').value = '';
  document.getElementById('taskInput').focus();
}

/* ─── COMPLETE / ARCHIVE ─────────────────────────────────────── */
function toggleComplete(id) {
  const task = tasks[id];
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  renderAll();
  if (task.completed) showToast('Task completed! Archived after 5s…');

  // Auto-archive after 5s if completed
  if (task.completed) {
    setTimeout(() => {
      if (tasks[id] && tasks[id].completed) {
        archiveTask(id);
      }
    }, 5000);
  }
}

function archiveTask(id) {
  const task = tasks[id];
  if (!task) return;
  archived.unshift({ ...task, archivedAt: Date.now() });
  if (archived.length > 200) archived = archived.slice(0, 200);
  delete tasks[id];
  saveTasks();
  renderAll();
}

/* ─── DELETE ─────────────────────────────────────────────────── */
function deleteTask(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.style.transition = 'all 0.2s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.85)';
  }
  setTimeout(() => {
    delete tasks[id];
    saveTasks();
    renderAll();
  }, 200);
}

/* ─── DRAG & DROP (between quadrants) ───────────────────────── */
function onCardDragStart(e) {
  dragId = this.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}
function onCardDragEnd() {
  this.classList.remove('dragging');
  dragId = null; dragOverId = null;
}
function onCardDragOver(e) {
  e.preventDefault();
  dragOverId = this.dataset.id;
}
function onCardDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!dragId || dragId === dragOverId) return;
  const src = tasks[dragId];
  const tgt = tasks[dragOverId];
  if (!src || !tgt) return;

  // Move to same quadrant and reorder
  src.q = tgt.q;
  // Swap order values
  const tmpOrder = src.order;
  src.order = tgt.order - 0.5;
  saveTasks();
  renderAll();
}

function setupQuadrantDrop(el) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    if (!dragId || !tasks[dragId]) return;
    const qId = el.dataset.q;
    if (tasks[dragId].q === qId) return;
    tasks[dragId].q = qId;
    tasks[dragId].order = Date.now();
    saveTasks();
    renderAll();
    showToast('Moved to ' + QUADRANT_NAMES[qId]);
  });
}

/* ─── EDIT DETAIL MODAL ──────────────────────────────────────── */
function openDetail(id) {
  const task = tasks[id];
  if (!task) return;
  editingId = id;
  document.getElementById('detailText').value     = task.text;
  document.getElementById('detailDate').value     = task.date || '';
  document.getElementById('detailPriority').value = task.priority || 3;
  document.getElementById('detailTag').value      = task.tag || '';
  document.getElementById('detailNotes').value    = task.notes || '';
  document.getElementById('detailQuadrant').value = task.q;
  document.getElementById('detailOverlay').style.display = 'flex';
}

function saveDetail() {
  if (!editingId || !tasks[editingId]) return;
  const t = tasks[editingId];
  t.text     = document.getElementById('detailText').value.trim() || t.text;
  t.date     = document.getElementById('detailDate').value;
  t.priority = parseInt(document.getElementById('detailPriority').value);
  t.tag      = document.getElementById('detailTag').value;
  t.notes    = document.getElementById('detailNotes').value.trim();
  t.q        = document.getElementById('detailQuadrant').value;
  saveTasks();
  renderAll();
  closeDetail();
  showToast('Task updated');
}

function deleteFromDetail() {
  if (!editingId) return;
  deleteTask(editingId);
  closeDetail();
}

function closeDetail() {
  document.getElementById('detailOverlay').style.display = 'none';
  editingId = null;
}

/* ─── STATS MODAL ────────────────────────────────────────────── */
function openStats() {
  const all = Object.values(tasks);
  const q1c = all.filter(t => t.q === 'q1').length;
  const q2c = all.filter(t => t.q === 'q2').length;
  const q3c = all.filter(t => t.q === 'q3').length;
  const q4c = all.filter(t => t.q === 'q4').length;
  const done = all.filter(t => t.completed).length;
  const ov   = all.filter(t => isOverdue(t.date) && !t.completed).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card stat-q1"><div class="stat-num">${q1c}</div><div class="stat-label">🔥 Do First</div></div>
    <div class="stat-card stat-q2"><div class="stat-num">${q2c}</div><div class="stat-label">📅 Schedule</div></div>
    <div class="stat-card stat-q3"><div class="stat-num">${q3c}</div><div class="stat-label">🤝 Delegate</div></div>
    <div class="stat-card stat-q4"><div class="stat-num">${q4c}</div><div class="stat-label">🗑️ Eliminate</div></div>
    <div class="stat-card stat-done"><div class="stat-num">${done + archived.length}</div><div class="stat-label">✅ Completed</div></div>
    <div class="stat-card stat-overdue"><div class="stat-num">${ov}</div><div class="stat-label">⚠️ Overdue</div></div>
  `;
  document.getElementById('statsOverlay').style.display = 'flex';
}

/* ─── ARCHIVE MODAL ──────────────────────────────────────────── */
function openArchive() {
  const list = document.getElementById('archiveList');
  list.innerHTML = '';
  if (archived.length === 0) {
    list.innerHTML = '<div class="empty-msg">No archived tasks yet.</div>';
  } else {
    archived.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'archive-item';
      item.innerHTML = `
        <span>${escHtml(t.text)}</span>
        ${t.tag ? `<span class="tag-pill tag-${t.tag}" style="font-size:9px">${TAG_LABELS[t.tag]||t.tag}</span>` : ''}
        <button class="arc-restore" data-i="${i}">Restore</button>
      `;
      item.querySelector('.arc-restore').addEventListener('click', () => {
        restoreArchived(i);
      });
      list.appendChild(item);
    });
  }
  document.getElementById('archiveOverlay').style.display = 'flex';
}

function restoreArchived(index) {
  const t = archived.splice(index, 1)[0];
  if (!t) return;
  t.completed = false;
  tasks[t.id] = t;
  saveTasks();
  renderAll();
  openArchive(); // refresh
  showToast('Task restored');
}

/* ─── EXPORT ─────────────────────────────────────────────────── */
function buildTextExport() {
  let out = '=== EISENHOWER MATRIX ===\n\n';
  ['q1','q2','q3','q4'].forEach(q => {
    const qTasks = Object.values(tasks).filter(t => t.q === q);
    out += `── ${QUADRANT_NAMES[q].toUpperCase()} (${qTasks.length}) ──\n`;
    qTasks.forEach((t, i) => {
      out += `  ${i+1}. ${t.completed ? '[✓]' : '[ ]'} ${t.text}`;
      if (t.date) out += ` | Due: ${formatDate(t.date)}`;
      if (t.tag)  out += ` | ${TAG_LABELS[t.tag]}`;
      out += ` | P${t.priority}`;
      if (t.notes) out += `\n       Notes: ${t.notes}`;
      out += '\n';
    });
    out += '\n';
  });
  return out;
}

function openExport() {
  document.getElementById('exportPreview').textContent = buildTextExport();
  document.getElementById('exportOverlay').style.display = 'flex';
}

/* ─── SEARCH ─────────────────────────────────────────────────── */
function toggleSearch() {
  const bar = document.getElementById('searchBar');
  if (bar.style.display === 'none') {
    bar.style.display = 'flex';
    document.getElementById('searchInput').focus();
  } else {
    bar.style.display = 'none';
    searchQuery = '';
    renderAll();
  }
}

/* ─── FILTER ─────────────────────────────────────────────────── */
function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  renderAll();
}

/* ─── GEMINI AI AUTO-SORT ────────────────────────────────────── */
async function aiSort() {
  const text = document.getElementById('taskInput').value.trim();
  if (!text) { showToast('Enter a task first.'); return; }
  if (!geminiKey) { showToast('Add your Gemini API key first.'); return; }

  const btn = document.getElementById('btnAI');
  const status = document.getElementById('aiStatus');
  btn.disabled = true;
  status.style.display = 'block';
  status.textContent = '✨ Gemini is analyzing your task…';

  const prompt = `You are an expert productivity assistant using the Eisenhower Matrix.
Given this task: "${text}"

Classify it into exactly one quadrant:
- q1: Urgent AND Important (deadlines, crises, critical issues)
- q2: NOT Urgent BUT Important (planning, learning, relationships, strategic work)
- q3: Urgent BUT NOT Important (interruptions, some meetings, others' requests)
- q4: NOT Urgent AND NOT Important (busywork, time wasters, trivial tasks)

Also suggest a label from: work, personal, health, finance, study, project (or empty string)
Also suggest a priority from 1-5 (1=lowest, 5=critical)
Also write a one-sentence reason.

Respond ONLY with valid JSON, no markdown, no explanation outside JSON:
{"quadrant":"q1","label":"study","priority":4,"reason":"This has a near deadline and directly impacts your academic goals."}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
        })
      }
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid response format');
    const parsed = JSON.parse(jsonMatch[0]);

    const q = ['q1','q2','q3','q4'].includes(parsed.quadrant) ? parsed.quadrant : 'q1';
    const tag = ['work','personal','health','finance','study','project'].includes(parsed.label) ? parsed.label : '';
    const pri = [1,2,3,4,5].includes(parsed.priority) ? parsed.priority : 3;

    // Apply to fields
    document.getElementById('taskQuadrant').value = q;
    if (tag) document.getElementById('taskTag').value = tag;
    document.getElementById('taskPriority').value = pri;

    status.textContent = `✨ Gemini suggests: ${QUADRANT_NAMES[q]} · P${pri}${tag ? ' · ' + TAG_LABELS[tag] : ''} — ${parsed.reason || ''}`;

    // Auto-add task
    addTask(q);
    status.style.display = 'none';

  } catch (err) {
    status.textContent = `❌ Error: ${err.message}. Check your API key and try again.`;
    console.error('Gemini error:', err);
  } finally {
    btn.disabled = false;
  }
}

/* ─── INIT ───────────────────────────────────────────────────── */
function init() {
  loadTasks();
  loadKey();

  // Restore API key display
  if (geminiKey) {
    document.getElementById('apiKeyInput').value = geminiKey;
    document.getElementById('apiKeyInput').placeholder = 'API key saved ✓';
  }

  // Quadrant drop zones
  ['q1','q2','q3','q4'].forEach(q => {
    setupQuadrantDrop(document.getElementById(q));
  });

  // Render
  renderAll();

  // ── Input bar ──
  document.getElementById('taskInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTask();
  });
  document.getElementById('btnAdd').addEventListener('click', () => addTask());
  document.getElementById('btnAI').addEventListener('click', aiSort);

  // ── API Key ──
  document.getElementById('btnSaveKey').addEventListener('click', () => {
    geminiKey = document.getElementById('apiKeyInput').value.trim();
    saveKey();
    showToast(geminiKey ? '🔑 API key saved!' : 'API key cleared.');
  });
  document.getElementById('btnClearKey').addEventListener('click', () => {
    geminiKey = '';
    document.getElementById('apiKeyInput').value = '';
    saveKey();
    showToast('API key cleared.');
  });

  // ── Search ──
  document.getElementById('btnSearch').addEventListener('click', toggleSearch);
  document.getElementById('btnCloseSearch').addEventListener('click', () => {
    document.getElementById('searchBar').style.display = 'none';
    searchQuery = '';
    renderAll();
  });
  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderAll();
  });

  // ── Filter ──
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });

  // ── Stats ──
  document.getElementById('btnStats').addEventListener('click', openStats);
  document.getElementById('btnCloseStats').addEventListener('click', () => {
    document.getElementById('statsOverlay').style.display = 'none';
  });

  // ── Archive ──
  document.getElementById('btnArchive').addEventListener('click', openArchive);
  document.getElementById('btnCloseArchive').addEventListener('click', () => {
    document.getElementById('archiveOverlay').style.display = 'none';
  });
  document.getElementById('btnClearArchive').addEventListener('click', () => {
    archived = [];
    saveTasks();
    openArchive();
    showToast('Archive cleared.');
  });

  // ── Detail modal ──
  document.getElementById('btnCloseDetail').addEventListener('click', closeDetail);
  document.getElementById('btnSaveDetail').addEventListener('click', saveDetail);
  document.getElementById('btnDeleteDetail').addEventListener('click', deleteFromDetail);

  // ── Export ──
  document.getElementById('btnExport').addEventListener('click', openExport);
  document.getElementById('btnCloseExport').addEventListener('click', () => {
    document.getElementById('exportOverlay').style.display = 'none';
  });
  document.getElementById('btnCopyText').addEventListener('click', () => {
    navigator.clipboard.writeText(buildTextExport())
      .then(() => showToast('Copied to clipboard!'))
      .catch(() => showToast('Copy failed. Try manually.'));
  });
  document.getElementById('btnPrintPDF').addEventListener('click', () => {
    window.print();
  });
  document.getElementById('btnExportJSON').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ tasks, archived }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'eisenhower-matrix.json';
    a.click(); URL.revokeObjectURL(url);
    showToast('JSON exported!');
  });

  // ── Close modals on overlay click ──
  ['statsOverlay','archiveOverlay','detailOverlay','exportOverlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
      if (e.target === this) this.style.display = 'none';
    });
  });

  // ── Keyboard: Escape closes modals ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['statsOverlay','archiveOverlay','detailOverlay','exportOverlay'].forEach(id => {
        document.getElementById(id).style.display = 'none';
      });
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
