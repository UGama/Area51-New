// Main leaderboard front-end logic
// Venue pages use Supabase rows with status: 0 = soft delete, 1 = normal, 2 = archive.
// Historical board loads only board = 'hist' and status = 1.
// Today board loads only board = 'today' and status = 1.

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON = window.SUPABASE_ANON;
const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON);

const VENUES = ["helensvale", "redcliffe", "gardencity"];
let currentVenue = "all";
let selectedTodayDateKey = todayBrisbaneKey();

const histData = [];
const todayData = [];
const girlData = [];
let todayEditing = false;
let histEditing = false;
let pendingDelete = null;

function rowsFromDB(rows) {
  return (rows || [])
    .map((row) => ({
      id: row.id == null ? undefined : Number(row.id),
      name: (row.name || "").trim(),
      score: Number(row.score) || 0,
      venue: row.venue || "",
      board: row.board || "",
      status: Number(row.status) || 0,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    }))
    .filter((row) => row.name !== "");
}

function timeValue(iso) {
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareLeaderboardRows(a, b) {
  const scoreDiff = Number(a.score || 0) - Number(b.score || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const updatedDiff = timeValue(a.updated_at) - timeValue(b.updated_at);
  if (updatedDiff !== 0) return updatedDiff;
  return Number(a.id || 0) - Number(b.id || 0);
}

async function loadBoard(board) {
  if (!supabase) return [];

  const query = supabase
    .from('leaderboard')
    .select('id, board, venue, name, score, status, created_at, updated_at');

  if (currentVenue !== 'all') {
    query.eq('venue', currentVenue);
  }

  query.eq('status', 1);

  if (board === 'hist') {
    query.eq('board', 'hist');
  } else if (board === 'today') {
    query.in('board', ['today', 'hist']);
    if (selectedTodayDateKey) {
      query
        .gte('created_at', `${selectedTodayDateKey}T00:00:00Z`)
        .lte('created_at', `${selectedTodayDateKey}T23:59:59.999Z`);
    }
  }

  const { data, error } = await query.order('score', { ascending: true }).limit(100);
  if (error) {
    console.warn('[loadBoard] Supabase error', error);
    return [];
  }

  const parsed = rowsFromDB(data);
  return parsed.sort(compareLeaderboardRows).slice(0, 10);
}

async function loadGirlRecord() {
  if (!supabase || currentVenue === 'all') return [];

  const { data, error } = await supabase
    .from('leaderboard')
    .select('id, board, venue, name, score, status, created_at, updated_at')
    .eq('venue', currentVenue)
    .eq('board', 'girl')
    .eq('status', 1)
    .order('score', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('[loadGirlRecord] Supabase error', error);
    return [];
  }

  return rowsFromDB(data).slice(0, 1);
}

function renderHeaders(tableSelector) {
  const theadRow = document.querySelector(`${tableSelector} thead tr`);
  if (!theadRow) return;

  const isAll = currentVenue === 'all';
  const cols = isAll ? ['Rank', 'Name', 'Venue', 'Time'] : ['Rank', 'Name', 'Time'];
  theadRow.innerHTML = cols.map((title) => `<th>${title}</th>`).join('');
}

function renderLeaderboard(rows, tableSelector) {
  renderHeaders(tableSelector);
  const tbody = document.querySelector(`${tableSelector} tbody`);
  if (!tbody) return;

  const sorted = [...rows].sort(compareLeaderboardRows);
  const showVenue = currentVenue === 'all';
  tbody.innerHTML = sorted
    .map((row, index) => {
      const rank = index + 1;
      const time = Number(row.score || 0).toFixed(2);
      const venue = showVenue ? `<td>${(row.venue || '').toString()}</td>` : '';
      return `<tr class="table-row-height" data-id="${Number.isFinite(row.id) ? row.id : ''}">
        <td>${rank}</td>
        <td>${(row.name || '').toString()}</td>
        ${venue}
        <td>${time}</td>
      </tr>`;
    })
    .join('');

  if (tbody.rows.length === 0) {
    const colCount = showVenue ? 4 : 3;
    tbody.innerHTML = `<tr class="table-empty"><td colspan="${colCount}">No records found.</td></tr>`;
  }
}

function renderGirlRecord(rows) {
  const tbody = document.querySelector('#rank-table-girl tbody');
  if (!tbody) return;
  const winner = rows[0];
  if (!winner) {
    tbody.innerHTML = '<tr class="table-empty"><td colspan="3">No records yet.</td></tr>';
    return;
  }
  tbody.innerHTML = `<tr class="table-row-height" data-id="${Number.isFinite(winner.id) ? winner.id : ''}">
      <td>1</td>
      <td>${(winner.name || '').toString()}</td>
      <td>${Number(winner.score || 0).toFixed(2)}</td>
    </tr>`;
}

function syncTodayDatePicker() {
  const picker = document.getElementById('today-date-picker');
  if (!picker) return;
  picker.value = selectedTodayDateKey || todayBrisbaneKey();
}

function updateAddButtonState() {
  const addButton = document.getElementById('today-add');
  if (!addButton) return;

  const todayKey = todayBrisbaneKey();
  const isToday = (selectedTodayDateKey || todayKey) === todayKey;
  const isAllowed = currentVenue !== 'all' && isToday;
  addButton.disabled = !isAllowed;
  addButton.title = isAllowed
    ? 'Add a record for today'
    : currentVenue === 'all'
      ? 'Add is unavailable when viewing all venues'
      : 'Add is only available for today\'s date';
}

function applyVenueButtonState() {
  const isAll = currentVenue === 'all';
  ['#hist-edit', '#hist-add', '#hist-reset', '#today-edit', '#today-add', '#today-merge', '#girl-edit']
    .forEach((selector) => {
      const button = document.querySelector(selector);
      if (button) button.disabled = isAll;
    });
}

function toSupabaseTimestamp(dateKey) {
  if (!dateKey) return new Date().toISOString();

  const now = new Date();
  const timePart = now.toISOString().slice(11, 19);
  const date = new Date(`${dateKey}T${timePart}+10:00`);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createNewId() {
  return Date.now();
}

async function reconcileTodayBoardForDate() {
  if (!supabase || currentVenue === 'all') return;

  const dateKey = selectedTodayDateKey || todayBrisbaneKey();
  const { data, error } = await supabase
    .from('leaderboard')
    .select('id, board, venue, name, score, status, created_at, updated_at')
    .eq('venue', currentVenue)
    .eq('board', 'today')
    .in('status', [1, 2])
    .gte('created_at', `${dateKey}T00:00:00Z`)
    .lte('created_at', `${dateKey}T23:59:59.999Z`);

  if (error) {
    console.warn('[reconcileTodayBoardForDate] Supabase error', error);
    return;
  }

  const rows = (data || [])
    .map((row) => ({
      ...row,
      score: Number(row.score) || 0,
      status: Number(row.status) || 0,
    }))
    .filter((row) => row.name)
    .sort(compareLeaderboardRows);

  const topTenIds = new Set(rows.slice(0, 10).map((row) => row.id).filter(Number.isFinite));

  await Promise.all(rows.map((row) => {
    const nextStatus = topTenIds.has(row.id) ? 1 : 2;
    return supabase
      .from('leaderboard')
      .update({ status: nextStatus })
      .eq('id', row.id);
  }));
}

async function confirmAddFromModal() {
  if (!supabase || currentVenue === 'all') {
    alert('Select a specific venue to add data.');
    return;
  }

  const name = (document.getElementById('add-name')?.value || '').trim();
  const scoreText = (document.getElementById('add-score')?.value || '').trim();
  const score = Number(scoreText);

  if (!name) {
    alert('Please enter a name.');
    return;
  }

  if (!Number.isFinite(score) || score <= 0) {
    alert('Please enter a valid time.');
    return;
  }

  const payload = {
    id: createNewId(),
    board: 'today',
    venue: currentVenue,
    name,
    score: Math.round(score * 100) / 100,
    status: 1,
  };

  const { error } = await supabase
    .from('leaderboard')
    .upsert([payload], { onConflict: 'id' });

  if (error) {
    console.warn('[confirmAddFromModal] Supabase error', error);
    alert('Failed to add the row.');
    return;
  }

  await reconcileTodayBoardForDate();
  await refreshFromServer();
  closeAddModal();
}

function setTodayEditMode(enabled) {
  const tbody = document.querySelector('#rank-table-today tbody');
  const button = document.getElementById('today-edit');
  const card = document.querySelector('.card-today');
  if (!tbody || !button) return;

  todayEditing = enabled;
  button.textContent = enabled ? 'Done' : 'Edit';
  button.classList.toggle('is-editing', enabled);
  card?.classList.toggle('editing', enabled);

  [...tbody.querySelectorAll('tr')].forEach((row) => {
    if (row.classList.contains('table-empty')) return;

    const nameCell = row.cells[1];
    const scoreCell = row.cells[2];
    if (nameCell) nameCell.setAttribute('contenteditable', enabled ? 'true' : 'false');
    if (scoreCell) scoreCell.setAttribute('contenteditable', enabled ? 'true' : 'false');

    let deleteCell = row.querySelector('.today-delete-cell');
    if (enabled) {
      if (!deleteCell) {
        deleteCell = document.createElement('td');
        deleteCell.className = 'today-delete-cell';
        deleteCell.innerHTML = '<button class="row-delete" type="button" title="Delete row">×</button>';
        row.appendChild(deleteCell);
      }
    } else if (deleteCell) {
      deleteCell.remove();
    }
  });
}

function collectTodayRowsFromTable() {
  const tbody = document.querySelector('#rank-table-today tbody');
  if (!tbody) return [];

  return [...tbody.querySelectorAll('tr')]
    .filter((row) => !row.classList.contains('table-empty'))
    .map((row) => {
      const id = Number.parseInt(row.getAttribute('data-id'), 10);
      const name = (row.cells[1]?.textContent || '').trim();
      const score = Number.parseFloat((row.cells[2]?.textContent || '').trim());
      return {
        id: Number.isFinite(id) ? id : null,
        name,
        score: Number.isFinite(score) ? score : 0,
      };
    });
}

async function saveTodayEdits() {
  if (!supabase || currentVenue === 'all') return;

  const rows = collectTodayRowsFromTable();
  const updates = rows.filter((row) => Number.isFinite(row.id));

  await Promise.all(updates.map((row) => supabase
    .from('leaderboard')
    .update({
      name: row.name,
      score: Math.round((Number(row.score) || 0) * 100) / 100,
    })
    .eq('id', row.id)));

  await reconcileTodayBoardForDate();
  await refreshFromServer();
}

async function softDeleteTodayRow(id) {
  if (!supabase || currentVenue === 'all' || !Number.isFinite(id)) return;
  await supabase
    .from('leaderboard')
    .update({ status: 0 })
    .eq('id', id);
  await reconcileTodayBoardForDate();
  await refreshFromServer();
}

function setHistEditMode(enabled) {
  const tbody = document.querySelector('#rank-table-hist tbody');
  const button = document.getElementById('hist-edit');
  const card = document.querySelector('.card-hist');
  if (!tbody || !button) return;

  histEditing = enabled;
  button.textContent = enabled ? 'Done' : 'Edit';
  button.classList.toggle('is-editing', enabled);
  card?.classList.toggle('editing', enabled);

  [...tbody.querySelectorAll('tr')].forEach((row) => {
    if (row.classList.contains('table-empty')) return;

    const nameCell = row.cells[1];
    const scoreCell = row.cells[2];
    if (nameCell) nameCell.setAttribute('contenteditable', enabled ? 'true' : 'false');
    if (scoreCell) scoreCell.setAttribute('contenteditable', enabled ? 'true' : 'false');

    let deleteCell = row.querySelector('.hist-delete-cell');
    if (enabled) {
      if (!deleteCell) {
        deleteCell = document.createElement('td');
        deleteCell.className = 'hist-delete-cell';
        deleteCell.innerHTML = '<button class="row-delete" type="button" title="Delete row">×</button>';
        row.appendChild(deleteCell);
      }
    } else if (deleteCell) {
      deleteCell.remove();
    }
  });
}

function collectHistRowsFromTable() {
  const tbody = document.querySelector('#rank-table-hist tbody');
  if (!tbody) return [];

  return [...tbody.querySelectorAll('tr')]
    .filter((row) => !row.classList.contains('table-empty'))
    .map((row) => {
      const id = Number.parseInt(row.getAttribute('data-id'), 10);
      const name = (row.cells[1]?.textContent || '').trim();
      const score = Number.parseFloat((row.cells[2]?.textContent || '').trim());
      return {
        id: Number.isFinite(id) ? id : null,
        name,
        score: Number.isFinite(score) ? score : 0,
      };
    });
}

async function saveHistEdits() {
  if (!supabase || currentVenue === 'all') return;

  const rows = collectHistRowsFromTable();
  const updates = rows.filter((r) => Number.isFinite(r.id));

  // Update existing rows
  await Promise.all(updates.map((row) => supabase
    .from('leaderboard')
    .update({
      name: row.name,
      score: Math.round((Number(row.score) || 0) * 100) / 100,
    })
    .eq('id', row.id)));

  // Find DB-side active hist ids for this venue and archive any removed ones (soft-delete)
  const { data: active, error: actErr } = await supabase
    .from('leaderboard')
    .select('id')
    .eq('venue', currentVenue)
    .eq('board', 'hist')
    .eq('status', 1)
    .limit(1000);

  if (!actErr && active) {
    const dbIds = new Set((active || []).map(r => Number(r.id)).filter(Number.isFinite));
    const tableIds = new Set(updates.map(r => Number(r.id)).filter(Number.isFinite));
    const toSoftDelete = [...dbIds].filter(id => !tableIds.has(id));
    if (toSoftDelete.length) {
      await Promise.all(toSoftDelete.map(id => supabase
        .from('leaderboard')
        .update({ status: 0 })
        .eq('id', id)));
    }
  }

  await refreshFromServer();
}

async function softDeleteHistRow(id) {
  if (!supabase || currentVenue === 'all' || !Number.isFinite(id)) return;
  await supabase
    .from('leaderboard')
    .update({ status: 0 })
    .eq('id', id);
  await refreshFromServer();
}

async function mergeTodayIntoHistorical() {
  if (!supabase || currentVenue === 'all') return;

  const dateKey = selectedTodayDateKey || todayBrisbaneKey();

  const [{ data: histRows, error: histError }, { data: todayRows, error: todayError }] = await Promise.all([
    supabase
      .from('leaderboard')
      .select('id, board, venue, name, score, status, created_at, updated_at')
      .eq('venue', currentVenue)
      .eq('board', 'hist')
      .eq('status', 1)
      .order('score', { ascending: true })
      .limit(200),
    supabase
      .from('leaderboard')
      .select('id, board, venue, name, score, status, created_at, updated_at')
      .eq('venue', currentVenue)
      .eq('board', 'today')
      .eq('status', 1)
      .gte('created_at', `${dateKey}T00:00:00Z`)
      .lte('created_at', `${dateKey}T23:59:59.999Z`)
      .order('score', { ascending: true })
      .limit(200),
  ]);

  if (histError || todayError) {
    console.warn('[mergeTodayIntoHistorical] Supabase error', histError || todayError);
    return;
  }

  const todayCandidates = (todayRows || []).filter((row) => row.name);
  if (!todayCandidates.length) {
    alert('No update');
    return;
  }

  const merged = [];
  const seenIds = new Set();

  for (const row of [...(histRows || []), ...todayCandidates]) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || seenIds.has(id)) continue;
    seenIds.add(id);
    merged.push({
      ...row,
      id,
      score: Number(row.score) || 0,
      status: Number(row.status) || 1,
    });
  }

  merged.sort(compareLeaderboardRows);
  const topTen = merged.slice(0, 10);
  const topTenIds = new Set(topTen.map((row) => row.id).filter(Number.isFinite));

  const updates = merged.map((row) => {
    const nextBoard = topTenIds.has(row.id) && row.board === 'today' ? 'hist' : row.board === 'hist' && !topTenIds.has(row.id) ? 'today' : row.board;
    return supabase
      .from('leaderboard')
      .update({ board: nextBoard, status: 1 })
      .eq('id', row.id);
  });

  await Promise.all(updates);
  await refreshFromServer();
}

let activeNumpadTarget = null;

function openNumpad(targetInput) {
  const numpad = document.getElementById('numpad');
  const display = document.getElementById('numpad-display');
  if (!numpad || !display || !targetInput) return;

  activeNumpadTarget = targetInput;
  display.value = targetInput.value || '';
  numpad.classList.remove('hidden');
  numpad.setAttribute('aria-hidden', 'false');
  numpad.classList.add('numpad--anchored');
}

function closeNumpad() {
  const numpad = document.getElementById('numpad');
  if (!numpad) return;
  numpad.classList.add('hidden');
  numpad.setAttribute('aria-hidden', 'true');
  numpad.classList.remove('numpad--anchored');
  activeNumpadTarget = null;
}

function applyNumpadValue(value) {
  const display = document.getElementById('numpad-display');
  if (!display) return;
  display.value = value;
}

function handleNumpadKey(key) {
  const display = document.getElementById('numpad-display');
  if (!display) return;

  if (key === 'del') {
    display.value = display.value.slice(0, -1);
    return;
  }

  if (key === '.') {
    if (display.value.includes('.')) return;
    if (!display.value) {
      display.value = '0.';
    } else {
      display.value += '.';
    }
    return;
  }

  if (/^[0-9]$/.test(key)) {
    const nextValue = display.value + key;
    if (nextValue === '00') {
      display.value = '0';
      return;
    }
    display.value = nextValue;
  }
}

function acceptNumpadValue() {
  if (!activeNumpadTarget) return;
  activeNumpadTarget.value = document.getElementById('numpad-display')?.value || '';
  closeNumpad();
}

function openAddModal() {
  const modal = document.getElementById('add-modal');
  const nameInput = document.getElementById('add-name');
  const scoreInput = document.getElementById('add-score');
  if (!modal || !nameInput || !scoreInput) return;

  modal.classList.remove('hidden');
  modal.removeAttribute('aria-hidden');
  nameInput.value = '';
  scoreInput.value = '';
  closeNumpad();

  requestAnimationFrame(() => {
    nameInput.focus();
    nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
  });

  window.setTimeout(() => {
    if (document.activeElement !== nameInput) {
      nameInput.focus();
    }
  }, 220);
}

function closeAddModal() {
  const modal = document.getElementById('add-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  closeNumpad();
}

function openDeleteModal(id, type) {
  const modal = document.getElementById('delete-modal');
  if (!modal) return;
  pendingDelete = { id, type };
  modal.classList.remove('hidden');
  modal.removeAttribute('aria-hidden');
  document.getElementById('del-msg').textContent = 'Delete this record? This cannot be undone.';
}

function closeDeleteModal() {
  const modal = document.getElementById('delete-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  pendingDelete = null;
}

async function confirmDelete() {
  if (!pendingDelete) return;
  const { id, type } = pendingDelete;
  await closeDeleteModal();
  if (type === 'today') {
    await softDeleteTodayRow(id);
  } else if (type === 'hist') {
    await softDeleteHistRow(id);
  }
}

async function refreshFromServer() {
  syncTodayDatePicker();
  const [histRows, todayRows, girlRows] = await Promise.all([
    loadBoard('hist'),
    loadBoard('today'),
    loadGirlRecord(),
  ]);

  histData.splice(0, histData.length, ...histRows);
  todayData.splice(0, todayData.length, ...todayRows);
  girlData.splice(0, girlData.length, ...girlRows);

  renderLeaderboard(histData, '#rank-table-hist');
  renderLeaderboard(todayData, '#rank-table-today');
  renderGirlRecord(girlData);
  applyVenueButtonState();
  updateAddButtonState();
  if (todayEditing) setTodayEditMode(true);
  if (histEditing) setHistEditMode(true);
}

function todayBrisbaneKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
}

function setVenue(venue) {
  currentVenue = venue;
  document.querySelectorAll('.venue-pill').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.venue === venue);
  });
  refreshFromServer();
}

function init() {
  document.querySelectorAll('.venue-pill').forEach((button) => {
    button.addEventListener('click', () => setVenue(button.dataset.venue));
  });

  document.getElementById('today-add')?.addEventListener('click', openAddModal);
  document.getElementById('today-edit')?.addEventListener('click', async () => {
    if (todayEditing) {
      await saveTodayEdits();
      setTodayEditMode(false);
    } else {
      setTodayEditMode(true);
    }
  });
  document.getElementById('hist-edit')?.addEventListener('click', async () => {
    if (histEditing) {
      await saveHistEdits();
      setHistEditMode(false);
    } else {
      setHistEditMode(true);
    }
  });
  document.querySelector('#rank-table-today tbody')?.addEventListener('click', async (event) => {
    if (!todayEditing) return;
    const deleteButton = event.target.closest('.row-delete');
    if (!deleteButton) return;
    const row = deleteButton.closest('tr');
    const id = Number.parseInt(row?.getAttribute('data-id'), 10);
    if (Number.isFinite(id)) {
      openDeleteModal(id, 'today');
    }
  });
  document.querySelector('#rank-table-hist tbody')?.addEventListener('click', async (event) => {
    if (!histEditing) return;
    const deleteButton = event.target.closest('.row-delete');
    if (!deleteButton) return;
    const row = deleteButton.closest('tr');
    const id = Number.parseInt(row?.getAttribute('data-id'), 10);
    if (Number.isFinite(id)) {
      openDeleteModal(id, 'hist');
    }
  });
  document.getElementById('add-cancel')?.addEventListener('click', closeAddModal);
  document.getElementById('add-confirm')?.addEventListener('click', confirmAddFromModal);
  document.getElementById('del-cancel')?.addEventListener('click', closeDeleteModal);
  document.getElementById('del-confirm')?.addEventListener('click', confirmDelete);
  document.getElementById('delete-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'delete-modal') closeDeleteModal();
  });
  document.getElementById('delete-modal')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDeleteModal();
  });
  document.getElementById('today-merge')?.addEventListener('click', mergeTodayIntoHistorical);

  document.getElementById('add-score')?.addEventListener('click', (event) => {
    event.preventDefault();
    openNumpad(event.currentTarget);
  });

  document.querySelectorAll('#numpad .numpad__grid button').forEach((button) => {
    button.addEventListener('click', () => {
      handleNumpadKey(button.dataset.k);
    });
  });

  document.getElementById('numpad-cancel')?.addEventListener('click', closeNumpad);
  document.getElementById('numpad-ok')?.addEventListener('click', acceptNumpadValue);
  document.getElementById('numpad')?.addEventListener('click', (event) => {
    if (event.target.id === 'numpad') closeNumpad();
  });
  document.getElementById('add-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'add-modal') closeAddModal();
  });
  document.getElementById('add-modal')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAddModal();
    if (event.key === 'Enter' && document.activeElement?.id !== 'add-cancel') confirmAddFromModal();
  });

  document.getElementById('today-date-picker')?.addEventListener('change', (event) => {
    selectedTodayDateKey = event.target.value || todayBrisbaneKey();
    updateAddButtonState();
    refreshFromServer();
  });

  document.getElementById('copyright-year').textContent = new Date().getFullYear();
  syncTodayDatePicker();
  refreshFromServer();
}

init();
