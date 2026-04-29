document.getElementById("copyright-year").textContent = new Date().getFullYear();

// // ===== LocalStorage helpers (no defaults) =====
// const STORAGE_KEYS = {
//   hist: "area51_hist_leaderboard",
//   today: "area51_today_leaderboard",
// };

// function save(key, value) {
//   localStorage.setItem(key, JSON.stringify(value));
// }

// function loadStrict(key) {
//   try {
//     const raw = localStorage.getItem(key);
//     if (!raw) return [];
//     const arr = JSON.parse(raw);
//     return Array.isArray(arr) ? arr : [];
//   } catch {
//     return [];
//   }
// }

// // ===== Live data (ALWAYS from Local Storage) =====
// const histData = loadStrict(STORAGE_KEYS.hist);
// const todayData = loadStrict(STORAGE_KEYS.today);

// ===== Remote storage via Supabase =====
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

let GLOBAL_NEXT_ID = 0;
let selectedTodayDateKey = todayBrisbaneKey();

/** Convert DB rows -> [{id,name,score}] */
function rowsFromDB(dbRows) {
  return (dbRows || [])
    .map(r => ({
      id: r.id == null ? undefined : Number(r.id),
      name: (r.name || "").trim(),
      score: Number(r.score) || 0,
      venue: r.venue,
      board: r.board,
      status: r.status,
      updated_at: r.updated_at || null,
      created_at: r.created_at || null
    }))
    .filter(r => r.name !== "");
}

function timeValue(iso) {
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * Leaderboard ranking:
 * 1) lower score first
 * 2) if same score, earlier updated_at first (who got it first ranks first)
 * 3) stable fallback by id
 */
function compareLeaderboardRows(a, b) {
  const scoreDiff = Number(a.score || 0) - Number(b.score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  const updatedDiff = timeValue(a.updated_at) - timeValue(b.updated_at);
  if (updatedDiff !== 0) return updatedDiff;

  return Number(a.id || 0) - Number(b.id || 0);
}


/** Build DB payload for a single row write */
function toDBPayload(boardKeyStr, venueStr, row, status=1) {
  return {
    id: Number.isInteger(row.id) ? row.id : undefined,
    board: boardKeyStr,                     // keep compatibility with existing data
    venue: venueStr,                        // NEW: explicit venue column
    name: (row.name || "").trim(),
    score: Math.round((Number(row.score) || 0) * 100) / 100,
    status                                   // 1 active, 0 soft-deleted
  };
}

/** Load one board ("hist" | "today") respecting venue and status=1 */
/** Load one board ("hist" | "today") from Supabase */
async function loadBoard(board) {
  const ACTIVE = 1;

  if (currentVenue !== "all") {
    // For a single venue:
    //  - Historical page: board = 'both' (top 10 only)
    //  - Today page:      board IN ['today', 'both'] (selected date, active only, top 10)
    const boardsToInclude = board === "hist"
      ? ["both"]
      : ["today", "both"];

    let query = supabase
      .from("leaderboard")
      .select("id, board, venue, name, score, status, created_at, updated_at")
      .in("board", boardsToInclude)
      .eq("venue", currentVenue);

    // Keep both boards clean (active rows only).
    query = query.eq("status", ACTIVE);

    const { data, error } = await query
      .order("score", { ascending: true })
      .limit(600);

    if (error) {
      console.warn("[remote] load error", error);
      return [];
    }
    let rows = data || [];
    if (board === "hist") {
      rows = rows.filter(r => Number(r.status) === ACTIVE);
    }
    if (board === "today") {
      const dateKey = selectedTodayDateKey || todayBrisbaneKey();
      rows = rows.filter(r => brisbaneDayKeyFromIso(r.created_at) === dateKey);
    }

    const parsed = rowsFromDB(rows).sort(compareLeaderboardRows);
    return parsed.slice(0, 10);
  } else {
    // ALL view = merge all venues
    const boardsToInclude = board === "hist"
      ? ["both"]
      : ["today", "both"];

    let query = supabase
      .from("leaderboard")
      .select("id, board, venue, name, score, status, created_at, updated_at")
      .in("board", boardsToInclude)
      .in("venue", VENUES);

    query = query.eq("status", ACTIVE);

    const { data, error } = await query
      .order("score", { ascending: true })
      .limit(600);

    if (error) {
      console.warn("[remote] load error", error);
      return [];
    }

    let rows = data || [];
    if (board === "hist") {
      rows = rows.filter(r => Number(r.status) === ACTIVE);
    }

    // For ALL → Today's leaderboard: keep rows created on selected date in Brisbane
    if (board !== "hist") {
      const dateKey = selectedTodayDateKey || todayBrisbaneKey();
      rows = rows.filter(r => brisbaneDayKeyFromIso(r.created_at) === dateKey);
    }

    const merged = rowsFromDB(rows).sort(compareLeaderboardRows);

    return merged.slice(0, 10);
  }
}

/** Load the single Best Girl record (board="girl") */
async function loadGirlRecord() {
  if (currentVenue === "all") return [];

  const ACTIVE = 1;
  const { data, error } = await supabase
    .from("leaderboard")
    .select("id, board, venue, name, score, status")
    .eq("board", "girl")
    .eq("venue", currentVenue)
    .eq("status", ACTIVE)
    .order("score", { ascending: true })
    .limit(1);

  if (error) {
    console.warn("[remote] load girl error", error);
    return [];
  }

  return rowsFromDB(data || []).slice(0, 1);
}

function applyGirlCardVisibility() {
  const girlCard = document.getElementById("girl-card");
  if (!girlCard) return;
  girlCard.hidden = currentVenue === "all";
}


/**
 * Save the current board by:
 * 1) Upserting all current rows (status=1, preserving id)
 * 2) Soft-deleting any previously-active rows that were removed (status=0)
 * Notes:
 * - No-ops in ALL view (UI already disables buttons there).
 */
async function saveBoard(board, rows, opts = {}) {
  if (currentVenue === "all") {
    alert("Select a specific venue to edit or save.");
    return true;
  }

  const key = boardKey(board, currentVenue);

  // Fetch currently-active rows on server (both this board's records AND 'both' records)
  const { data: activeNow, error: loadErr } = await supabase
    .from('leaderboard')
    .select('id, name, score, venue, board, status')
    .in('board', [key, 'both'])
    .eq('venue', currentVenue)
    .eq('status', 1)
    .limit(500);

  if (loadErr) {
    console.warn('[remote] pre-save load error', loadErr);
    return false;
  }

  const activeIds = new Set((activeNow || []).map(r => r.id).filter(Number.isInteger));
  // Create a map of ID -> original board value to preserve 'both'
  const originalBoardMap = {};
  (activeNow || []).forEach(r => {
    if (Number.isInteger(r.id)) {
      originalBoardMap[r.id] = r.board;
    }
  });

  // Normalize incoming rows
  const cleaned = (rows || []).map(r => ({
    id: Number.isInteger(r.id) ? r.id : undefined,
    name: (r.name || "").trim(),
    score: Math.round((Number(r.score)||0)*100)/100
  })).filter(r => r.name !== "");

  // 1) Upsert all provided rows as status=1
  const upserts = cleaned.map(r => {
    // Preserve 'both' board attribute, otherwise use the current board key
    const finalBoard = originalBoardMap[r.id] === 'both' ? 'both' : key;
    return toDBPayload(finalBoard, currentVenue, r, 1);
  });
  if (upserts.length) {
    const { error: upErr } = await supabase.from('leaderboard').upsert(upserts, { onConflict: 'id' });
    if (upErr) { console.warn('[remote] upsert error', upErr); return false; }
  }

  // 2) Soft-delete rows that used to be active but are not in the new list
  const incomingIds = new Set(cleaned.map(r => r.id).filter(Number.isInteger));
  const toArchive = [...activeIds].filter(id => !incomingIds.has(id));

  if (toArchive.length) {
    const { error: archErr } = await supabase
      .from('leaderboard')
      .update({ status: 2 })     // ← archive, NOT delete
      .in('id', toArchive);
    if (archErr) { console.warn('[remote] archive error', archErr); return false; }
  }

  return true;
}




// ===== Live data (now from SERVER) =====
const histData = [];
const todayData = [];
const girlData = [];

// Ensure ids stay unique across both arrays (you already have helpers that rely on this)
function hydrate(board, rows) {
  const target = board === 'hist' ? histData : todayData;
  const incoming = board === "hist"
    ? [...(rows || [])].sort(compareLeaderboardRows).slice(0, 10)
    : (rows || []);
  target.splice(0, target.length, ...incoming);
}

function hydrateGirl(rows) {
  girlData.splice(0, girlData.length, ...(rows || []).slice(0, 1));
}

/** One-time bootstrap */
async function init(){
  document.querySelectorAll(".venue-pill").forEach(b=>{
    b.addEventListener("click", ()=> setVenue(b.dataset.venue));
  });

  // NEW: get the current max id once, at startup
  await initNextIdFromServer();

  await refreshFromServer();
}
init();



function renderLeaderboard(rows, tableSelector) {
  // Rebuild headers for this table based on current venue
  renderHeaders(tableSelector);

  const tbody = document.querySelector(`${tableSelector} tbody`);
  if (!tbody) return;

  // ASC: lower time is better
  const sorted = [...rows].sort(compareLeaderboardRows);
  const visibleRows = tableSelector === "#rank-table-hist"
    ? sorted.slice(0, 10)
    : sorted;
  const showVenue = currentVenue === "all";

  tbody.innerHTML = visibleRows
    .map((row, i) => {
      const rank  = i + 1;
      const time  = Number(row.score) || 0;
      const name  = (row.name ?? "").toString();
      const venue = venueLabel(row.venue);
      const id    = Number.isInteger(row.id) ? row.id : "";

      // Rank | Name | [Venue] | Time
      return `<tr data-id="${id}">
        <td>${rank}</td>
        <td>${name}</td>
        ${showVenue ? `<td>${venue}</td>` : ``}
        <td>${time.toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  // highlight fastest 3 (top 3)
  [...tbody.rows].forEach((tr, i) => {
    tr.style.background = "";
    if (i === 0) tr.style.background = "#fff4d6";
    if (i === 1) tr.style.background = "#f2f7ff";
    if (i === 2) tr.style.background = "#f3fff1";
  });

  // if you're in edit mode, reattach delete UI
  maybeReattachDeleteUI(tableSelector);

  applyMedals();

  showEmptyStateIfNeeded(document.getElementById("rank-table-today"));
  showEmptyStateIfNeeded(document.getElementById("rank-table-hist"));

  refreshEmptyState?.();
}

function renderGirlRecord(rows) {
  const table = document.getElementById("rank-table-girl");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;

  const top = [...(rows || [])]
    .sort((a, b) => Number(a.score || 0) - Number(b.score || 0))
    .slice(0, 1);

  tbody.innerHTML = top
    .map((row) => {
      const time = Number(row.score) || 0;
      const name = (row.name ?? "").toString();
      const id = Number.isInteger(row.id) ? row.id : "";
      return `<tr data-id="${id}">
        <td>1</td>
        <td>${name}</td>
        <td>${time.toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  applyMedals();
  showEmptyStateIfNeeded(table, "There are no records yet.");
  refreshEmptyState?.();
}



// Convert current table → array (used when finishing Edit)
function tableToArray(tableSelector) {
  const rows = [...document.querySelectorAll(`${tableSelector} tbody tr`)];

  return rows
    .filter(tr => !tr.classList.contains("table-empty"))    // ← ignore placeholder
    .filter(tr => tr.cells.length >= 3)                     // ← need Rank, Name, Time
    .map((tr) => {
      const idAttr = tr.getAttribute("data-id");
      const id = Number.parseInt(idAttr, 10);
      const tds = tr.querySelectorAll("td");
      const name  = (tds[1]?.textContent || "").trim();
      const score = parseFloat((tds[2]?.textContent || "").trim());
      return {
        id: Number.isFinite(id) ? id : undefined,
        name,
        score: Number.isFinite(score) ? score : 0
      };
    })
    .filter(r => r.name !== "");                            // ← drop blank lines
}


// ===== Edit toggle: when turning OFF, read table → save =====
async function toggleEditable(tableSelector, btnEl, which) {
  const tbody = document.querySelector(`${tableSelector} tbody`);
  const card = tbody.closest(".card");
  const on = tbody.getAttribute("contenteditable") === "true";

  if (on) {
    // === Turning OFF edit ===
    tbody.setAttribute("contenteditable", "false");
    btnEl.textContent = "Edit";
    btnEl.classList.remove("is-editing");
    card.classList.remove("editing");

    // turn off delete UI for this table
    document.querySelector(tableSelector).dataset.wantDeleteCol = "0";
    disableDeleteUI(tableSelector);

    // Grab latest table → array
    const edited = tableToArray(tableSelector);
    const before = tbody._snapshot || [];

    // Only save if changed (still use normalized compare)
    if (!isSameData(before, edited)) {
      try {
        if (which === "girl") {
          await applyGirlEdits(edited);
          const girlRows = await loadGirlRecord();
          hydrateGirl(girlRows);
          renderGirlRecord(girlData);
        } else if (which === "hist") {
          // 🔧 NEW: Historical has special logic based on board value
          const { changedBoth } = await applyHistoricalEdits(edited);

          if (changedBoth) {
            // Some board='both' rows changed → refresh both Today & Historical
            await refreshFromServer();
          } else {
            // Only Historical-only rows (or new hist rows) changed
            const histRows = await loadBoard("hist");
            hydrate("hist", histRows);
            renderLeaderboard(histData, "#rank-table-hist");
          }
        } else {
          // Today behaviour stays as before (including delete semantics)
          const merged = mergeEditsIntoData(which, edited);

          if (which === "hist") {
            // (kept for completeness; not used now)
            histData.splice(0, histData.length, ...merged);
            await saveBoard("hist", histData);
            renderLeaderboard(histData, "#rank-table-hist");
          } else {
            todayData.splice(0, todayData.length, ...merged);
            await saveBoard("today", todayData);
            renderLeaderboard(todayData, "#rank-table-today");
          }
        }
      } catch (err) {
        console.warn("[edit save] error", err);
        alert("Save failed. Check your connection and try again.");
      }
    }

    showEmptyStateIfNeeded(document.getElementById("rank-table-hist"));
    showEmptyStateIfNeeded(document.getElementById("rank-table-today"));
    showEmptyStateIfNeeded(document.getElementById("rank-table-girl"));
    refreshEmptyState();

    // Cleanup listeners/flags + tip
    tbody.removeEventListener("input", tbody._markDirty);
    tbody.removeEventListener("keydown", tbody._finishOnEnter);
    if (tbody._timeHandler) {
      tbody.removeEventListener("click", tbody._timeHandler, true);
      tbody.removeEventListener("focusin", tbody._timeHandler, true);
      delete tbody._timeHandler;
    }
    delete tbody._markDirty;
    delete tbody._finishOnEnter;
    delete tbody._snapshot;
    delete tbody.dataset.dirty;
    card.querySelector(".edit-tip")?.remove();

  } else {
    // === Turning ON edit ===
    tbody.setAttribute("contenteditable", "true");

    // Keep the empty-state placeholder non-editable even in edit mode
    tbody.querySelectorAll("tr.table-empty, tr.table-empty > td").forEach(el => {
      el.setAttribute("contenteditable", "false");
      el.style.userSelect = "none";
    });

    // Rank column not editable
    [...tbody.rows].forEach(tr => tr.cells[0]?.setAttribute("contenteditable", "false"));

    // 🆕 Open numpad when the 3rd cell (Time) is focused/clicked
    const isTimeCell = (td) => td && td.cellIndex === 2 && !td.classList.contains("del-col");

    tbody._timeHandler = (e) => {
      const td = e.target.closest?.("td");
      if (!td || !isTimeCell(td)) return;
      e.preventDefault();
      openNumPadForCell(td);
    };

    tbody.addEventListener("click", tbody._timeHandler, true);
    tbody.addEventListener("focusin", tbody._timeHandler, true);

    btnEl.textContent = "Done (Save)";
    btnEl.classList.add("is-editing");
    card.classList.add("editing");

    // ❌ No delete column for Historical edit
    if (which === "hist" || which === "girl") {
      document.querySelector(tableSelector).dataset.wantDeleteCol = "0";
      disableDeleteUI(tableSelector);
    } else {
      // Today still gets the delete column
      document.querySelector(tableSelector).dataset.wantDeleteCol = "1";
      enableDeleteUI(tableSelector);
    }

    // Add a small tip below the buttons (once)
    if (!card.querySelector(".edit-tip")) {
      const tip = document.createElement("div");
      tip.className = "edit-tip";
      tip.textContent = "You’re in EDIT MODE — type directly in the table. Press Ctrl/Cmd+Enter or click Done (Save).";
      card.appendChild(tip);
    }

    // Take a snapshot for change detection
    tbody._snapshot = tableToArray(tableSelector);
    tbody.dataset.dirty = "0";

    // Mark dirty on any change
    tbody._markDirty = () => { tbody.dataset.dirty = "1"; };
    tbody.addEventListener("input", tbody._markDirty);

    // Convenience: Ctrl/Cmd+Enter finishes editing
    tbody._finishOnEnter = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        btnEl.click();
      }
    };
    tbody.addEventListener("keydown", tbody._finishOnEnter);
  }
}



async function resetHistorical() {
  if (currentVenue === "all") return;
  // Server: mark all rows in this board+venue as status=2
  await supabase.from('leaderboard')
    .update({ status: 2 })
    .eq('board', boardKey('hist', currentVenue))
    .eq('venue', currentVenue)
    .eq('status', 1); // only active

  // Local: clear and render
  histData.splice(0, histData.length);
  renderLeaderboard(histData, "#rank-table-hist");
}




async function mergeTodayIntoHistorical() {
  if (currentVenue === "all") {
    alert("Please pick a specific venue before merging.");
    return;
  }

  const dateKey = selectedTodayDateKey || todayBrisbaneKey();

  // Optional: check if there is anything to merge for the selected day
  const { data, error } = await supabase
    .from("leaderboard")
    .select("id, created_at")
    .eq("venue", currentVenue)
    .eq("status", 1)
    .eq("board", "today")
    .order("score", { ascending: true })
    .limit(600);

  if (error) {
    console.warn("[merge] pre-check error", error);
    alert("Merge failed, please check the connection.");
    return;
  }

  const todaysRows = (data || []).filter(r => brisbaneDayKeyFromIso(r.created_at) === dateKey);
  if (!todaysRows.length) {
    alert("No new rows to merge.");
    return;
  }

  // 1) Apply your Historical top-10 rules (this is the real 'merge')
  await enforceTopNStatus("hist", 10);

  // 2) Also make sure Today's leaderboard stays at top-10 for this venue
  await enforceTopNStatus("today", 10);
}




function normalizeRows(rows) {
  return rows
    .map(r => ({
      id: Number.isInteger(r.id) ? r.id : undefined,
      name: (r.name || "").trim(),
      score: Math.round((Number(r.score) || 0) * 100) / 100,
    }))
    .filter(r => r.name !== "");  // ← do not keep empty-name rows
}


function isSameData(a, b) {
  const A = normalizeRows(a);
  const B = normalizeRows(b);
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    if ((A[i].id ?? -1) !== (B[i].id ?? -1)) return false;
    if (A[i].name !== B[i].name) return false;
    if (A[i].score !== B[i].score) return false;
  }
  return true;
}

function keepTopNByTimeAsc(arr, n = 10) {
  arr.sort((a, b) => Number(a.score || 0) - Number(b.score || 0)); // low → high
  if (arr.length > n) arr.length = n; // drop the slowest after sort
}

let _addTarget = null;      // "today" or "hist"
let _addOpener = null;

function openAddModal(target, openerEl) {
  _addTarget = target;
  _addOpener = openerEl || document.activeElement;

  const modal = document.getElementById("add-modal");
  modal.classList.add("modal--under-topbar");   // <<< pin panel under topbar
  modal.classList.remove("hidden");
  modal.removeAttribute("aria-hidden");
  modal.removeAttribute("inert");

  document.body.style.overflow = "hidden";

  document.getElementById("add-name").value = "";
  document.getElementById("add-score").value = "";
  setTimeout(() => document.getElementById("add-name").focus(), 0);
}

function closeAddModal() {
  const modal = document.getElementById("add-modal");

  if (_addOpener && typeof _addOpener.focus === "function") {
    _addOpener.focus();
  } else {
    document.body.focus?.();
  }

  // ALSO close the keypad if it is open
  closeNumPad();  // ← added

  modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("inert", "");
  modal.classList.add("hidden");
  modal.classList.remove("modal--under-topbar");

  document.body.style.overflow = "";
  _addTarget = null;
  _addOpener = null;
}

async function confirmAddFromModal() {
  const name = (document.getElementById("add-name").value || "").trim();
  const scoreStr = (document.getElementById("add-score").value || "").trim();

  // --- validations ---
  if (!name) { alert("Please enter a name."); return; }
  if (scoreStr === "") { alert("Please enter a time."); return; }

  const scoreNum = Number(scoreStr);
  if (!Number.isFinite(scoreNum)) { alert("Please enter a valid time (e.g., 5.35)."); return; }
  if (scoreNum <= 0) { alert("Time must be greater than 0."); return; }

  const score = Math.round(scoreNum * 100) / 100;

  // Block add in ALL view (read-only)
  if (currentVenue === "all") {
    alert("Select a specific venue to add data.");
    return;
  }

  if (_addTarget === "today" || _addTarget === "hist") {
    try {
      const id = nextGlobalId();
      const row = { id, name, score };
      const dbPayload = toDBPayload(boardKey(_addTarget, currentVenue), currentVenue, row, 1);

      // insert or update single row immediately with status=1
      const { error: insErr } = await supabase
        .from('leaderboard')
        .upsert([dbPayload], { onConflict: 'id' });

      if (insErr) { throw insErr; }

      // Ask the server to enforce "top 10" for this board+venue.
      // This will trim overflow (status=2 or demote 'both') and then reload & re-render.
      await enforceTopNStatus(_addTarget, 10);

      // close the modal / cleanup
      closeAddModal();

    } catch (err) {
      console.warn("Add failed:", err);
      alert("Save failed. Check your connection and try again.");
    }
  }
}


// Add a "Delete" column with × buttons (only in edit mode)
function enableDeleteUI(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const tbody = table.tBodies?.[0];
  const hasRows = !!tbody && tbody.rows.length > 0;

  // If empty, ensure the delete column is NOT shown at all
  if (!hasRows) {
    disableDeleteUI(tableSelector);
    table.dataset.showDelete = "1"; // remember we're in edit mode, but no delete column
    return;
  }

  // mark so we know it's active
  table.dataset.showDelete = "1";

  // 1) header: add "Delete" th if missing
  const theadRow = table.tHead?.rows?.[0];
  if (theadRow && !theadRow.querySelector("th.del-col")) {
    const th = document.createElement("th");
    th.textContent = "Delete";
    th.className = "del-col";
    theadRow.appendChild(th);
  }

  // 2) body: append a delete cell to each row if missing
  [...tbody.rows].forEach((tr) => {
    if (!tr.querySelector("td.del-col")) {
      const td = document.createElement("td");
      td.className = "del-col";
      td.innerHTML = `<button class="row-del" title="Delete this row">×</button>`;
      tr.appendChild(td);
    }
  });
}


// Remove the extra "Delete" column when exiting edit mode
function disableDeleteUI(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  delete table.dataset.showDelete;

  // remove last TH if it’s the delete column
  const theadRow = table.tHead?.rows?.[0];
  if (theadRow && theadRow.lastElementChild?.classList.contains("del-col")) {
    theadRow.removeChild(theadRow.lastElementChild);
  }

  // remove last TD in each row if it’s the delete column
  [...table.tBodies[0].rows].forEach((tr) => {
    const last = tr.lastElementChild;
    if (last?.classList.contains("del-col")) tr.removeChild(last);
  });
}

// After we re-render during Edit mode, we need to re-attach the delete column
function maybeReattachDeleteUI(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return;
  const tbody = table.tBodies?.[0];
  const editing = tbody?.getAttribute("contenteditable") === "true";
  const want = table.dataset.wantDeleteCol === "1";
  const hasRows = countRows(tbody) > 0;

  if (editing && want && hasRows) {
    enableDeleteUI(tableSelector);
  } else {
    // If empty (or not editing), make sure the column is gone
    disableDeleteUI(tableSelector);
  }
}


function applyTop3MedalsToTable(table) {
  if (!table || !table.tBodies || !table.tBodies[0]) return;
  const rows = Array.from(table.tBodies[0].rows);

  // Clear any previous medals
  rows.forEach(tr => {
    const last = tr.lastElementChild;
    if (last) {
      last.classList.remove('has-medal');
      last.removeAttribute('data-medal');
    }
  });

  // Add medals to top 3 rows (0,1,2)
  const medals = ['gold', 'silver', 'bronze'];
  rows.slice(0, 3).forEach((tr, i) => {
    const last = tr.lastElementChild;  // assume last column is Time
    if (!last) return;
    last.classList.add('has-medal');
    last.setAttribute('data-medal', medals[i]);
  });
}

// Apply to whichever tables you have
function applyMedals() {
  const tables = document.querySelectorAll('#rank-table, #rank-table-today, #rank-table-hist, #rank-table-girl');
  tables.forEach(applyTop3MedalsToTable);
}

// ==== Generic Confirm Modal (reuses #delete-modal HTML) ====
// _delContext now carries an action: "delete" | "reset-hist" | "reset-today"
let _delContext = null; // { action, which, name?, timeNum?, timeStr?, opener, tableSelector? }

// Utility: focus something safely
function safeFocus(el) {
  if (!el) return;
  // blur the currently focused element first
  document.activeElement?.blur?.();
  // queue the focus so it happens before we hide the modal
  requestAnimationFrame(() => el.focus?.());
}

// keep using the same global
// let _delContext = { action, which, id?, name?, timeNum?, timeStr?, opener, ... };

function openConfirmModal(ctx) {
  _delContext = ctx;

  const modal = document.getElementById("delete-modal");
  const title = document.getElementById("del-title");
  const msg   = document.getElementById("del-msg");
  const confirmBtn = document.getElementById("del-confirm");

  if (ctx.action === "delete") {
    title.textContent = "Confirm Delete";
    msg.textContent   = `Delete ${ctx.name}'s time ${ctx.timeStr}?`;
    confirmBtn.textContent = "Delete";
    confirmBtn.classList.add("btn--danger");
  } else if (ctx.action === "reset-hist") {
    title.textContent = "Confirm Reset";
    msg.textContent   = "Clear all data from Historical Leaderboard on the server?";
    confirmBtn.textContent = "Reset";
    confirmBtn.classList.add("btn--danger");
  } else if (ctx.action === "reset-today") {
    title.textContent = "Confirm Reset";
    msg.textContent   = "Clear all data from Today's Leaderboard on the server?";
    confirmBtn.textContent = "Reset";
    confirmBtn.classList.add("btn--danger");
  }

  modal.classList.remove("hidden");
  modal.removeAttribute("aria-hidden");
  modal.removeAttribute("inert");
  document.body.style.overflow = "hidden";

  // focus primary action
  safeFocus(confirmBtn);
}

function closeConfirmModal() {
  const modal = document.getElementById("delete-modal");
  const confirmBtn = document.getElementById("del-confirm");

  // choose a safe place to return focus:
  // 1) the button that opened the modal (if it still exists)
  // 2) the current card's Edit/Done button
  // 3) a global fallback (today-edit or hist-edit) or body
  let fallback =
    _delContext?.opener ||
    document.querySelector(".card.editing .btn.is-editing") ||
    document.getElementById("girl-edit") ||
    document.getElementById("today-edit") ||
    document.getElementById("hist-edit") ||
    document.body;

  // Move focus OUT of the modal BEFORE hiding it
  safeFocus(fallback);

  // Now it's safe to hide
  modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("inert", "");
  modal.classList.add("hidden");
  document.body.style.overflow = "";

  // cleanup styling/state
  confirmBtn.classList.remove("btn--danger");
  _delContext = null;
}

// ===== ID helpers =====

async function confirmFromModal() {
  if (!_delContext) return;
  const { action, which, id } = _delContext;

  // --- DELETE ---
  if (action === "delete" && id != null) {
    // Always soft delete for any board/table delete action.
    const { error } = await supabase
      .from("leaderboard")
      .update({ status: 0 })
      .eq("id", id);

    if (error) {
      console.warn(`[delete-${which}] error`, error);
      alert("Delete failed.");
      closeConfirmModal();
      return;
    }

    await refreshFromServer();
    closeConfirmModal();
    return;
  }

  if (action === "reset-hist") {
    if (currentVenue === "all") {
      alert("Pick a specific venue before resetting Historical.");
    } else {
      // 1) rows that are BOTH -> keep only on Today
      const { error: errBothToToday } = await supabase
        .from("leaderboard")
        .update({ board: "today", status: 1 })
        .eq("venue", currentVenue)
        .eq("board", "both")
        .eq("status", 1);

      if (errBothToToday) {
        console.warn("[reset-hist] both->today error", errBothToToday);
      }

      // 2) rows that are only HIST -> archive
      const { error: errHistArchive } = await supabase
        .from("leaderboard")
        .update({ status: 2 })
        .eq("venue", currentVenue)
        .eq("board", "hist")
        .eq("status", 1);

      if (errHistArchive) {
        console.warn("[reset-hist] hist->status2 error", errHistArchive);
      }
    }

    // Clear Historical locally & reload from DB
    histData.splice(0, histData.length);
    await refreshFromServer();
    closeConfirmModal();
    return;
  }

  if (action === "reset-today") {
    if (currentVenue === "all") {
      alert("Pick a specific venue before resetting Today.");
    } else {
      // 1) rows that are BOTH -> keep only on Historical (historical now uses "both")
      const { error: errBoth } = await supabase
        .from("leaderboard")
        .update({ board: "both" })
        .eq("venue", currentVenue)
        .eq("board", "both")
        .eq("status", 1);

      if (errBoth) {
        console.warn("[reset-today] update both->hist error", errBoth);
      }

      // 2) rows that are only TODAY -> soft delete (status 0)
      const { error: errToday } = await supabase
        .from("leaderboard")
        .update({ status: 0 })
        .eq("venue", currentVenue)
        .eq("board", "today")
        .eq("status", 1);

      if (errToday) {
        console.warn("[reset-today] delete today error", errToday);
      }
    }

    // Clear Today locally & reload from DB
    todayData.splice(0, todayData.length);
    await refreshFromServer();
    closeConfirmModal();
    return;
  }


  

  closeConfirmModal();
}


async function initNextIdFromServer() {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    if (!error && data && data.length && data[0].id != null) {
      GLOBAL_NEXT_ID = Number(data[0].id) || 0;
    } else {
      GLOBAL_NEXT_ID = 0;
    }
  } catch (e) {
    console.warn('[id] failed to init max id from server', e);
    GLOBAL_NEXT_ID = 0;
  }
}

// Whenever we need a new id, just bump the counter
function nextGlobalId() {
  GLOBAL_NEXT_ID += 1;
  return GLOBAL_NEXT_ID;
}


function ensureAllHaveIds() {
  let changed = false;
  // start from the highest id we know about, including existing data
  const maxExisting = Math.max(
    GLOBAL_NEXT_ID,
    ...histData.map(r => r.id ?? -1),
    ...todayData.map(r => r.id ?? -1)
  );
  GLOBAL_NEXT_ID = Number.isFinite(maxExisting) ? maxExisting : 0;

  const seen = new Set();
  for (const arr of [histData, todayData]) {
    for (const r of arr) {
      const id = Number(r.id);
      const invalid = !Number.isInteger(id) || id <= 0;
      const duplicate = !invalid && seen.has(id);
      if (invalid || duplicate) {
        GLOBAL_NEXT_ID += 1;
        r.id = GLOBAL_NEXT_ID;
        changed = true;
        seen.add(r.id);
      } else {
        r.id = id;
        seen.add(id);
      }
    }
  }
  return changed;
}



let _numpadTarget = null;
let _repositionPadHandler = null;

/** Position keypad under the input, but never overlapping the modal panel */
function positionNumpadUnder(targetEl) {
  const pad        = document.getElementById("numpad");
  const panel      = pad?.querySelector(".numpad__panel");
  const modalPanel = document.querySelector("#add-modal .modal__panel");
  const topbar     = document.querySelector(".topbar");
  if (!pad || !panel) return;

  pad.classList.add("numpad--anchored");

  const modalOpen = !!(modalPanel && modalPanel.offsetParent !== null);

  let top = 0;

  if (modalOpen && targetEl) {
    // ADD flow: keep your existing behavior — under the input,
    // but never overlap the modal panel bottom
    const inputRect = targetEl.getBoundingClientRect();
    const modalRect = modalPanel.getBoundingClientRect();
    const guard = 8;   // small gap under modal panel
    top = Math.max(inputRect.bottom, modalRect.bottom + guard);
  } else {
    // EDIT flow: mimic the add experience — place under the topbar
    const tb = topbar?.getBoundingClientRect();
    const gapBelowTopbar = 12; // tiny breathing room
    top = (tb ? tb.bottom : 0) + gapBelowTopbar;
  }

  panel.style.top = `${Math.round(top)}px`;
}

/** Open keypad and anchor it */
function openNumPadFor(inputSelector) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  _numpadTarget = input;

  const pad  = document.getElementById("numpad");
  const disp = document.getElementById("numpad-display");
  disp.value = (input.value || "").toString();

  pad.classList.remove("hidden");
  pad.removeAttribute("aria-hidden");
  document.body.style.overflow = "hidden";

  installZoomGuards(pad); 

  // wait a frame so layout is correct, then position
  requestAnimationFrame(() => positionNumpadUnder(input));

  // keep it attached on viewport changes
  _repositionPadHandler = () => positionNumpadUnder(input);
  window.addEventListener("resize", _repositionPadHandler, { passive: true });
  window.addEventListener("scroll", _repositionPadHandler, { passive: true });
  window.addEventListener("orientationchange", _repositionPadHandler, { passive: true });
}

/** Close keypad and clean up */
function closeNumPad() {
  const pad = document.getElementById("numpad");
  const disp = document.getElementById("numpad-display");
  pad.classList.add("hidden");
  pad.setAttribute("aria-hidden", "true");
  pad.classList.remove("numpad--anchored");
  document.body.style.overflow = "";
  _numpadTarget = null;

  removeZoomGuards(); 

  if (_repositionPadHandler) {
    window.removeEventListener("resize", _repositionPadHandler);
    window.removeEventListener("scroll", _repositionPadHandler);
    window.removeEventListener("orientationchange", _repositionPadHandler);
    _repositionPadHandler = null;
  }
  delete pad.dataset.mode;
  delete pad.dataset.prev;
  disp.placeholder = "";
}


function applyNumPadValue() {
  const disp = document.getElementById("numpad-display");
  if (_numpadTarget) {
    const raw = disp.value;
    if (_numpadTarget.tagName === "INPUT") {
      _numpadTarget.value = raw;
    } else {
      if (raw.trim() === "") { closeNumPad(); return; } // ← keep old value
      const num = Number(raw);
      if (!Number.isFinite(num)) { closeNumPad(); return; } // ← ignore bad input
      const n2 = Math.round(num * 100) / 100;
      _numpadTarget.textContent = n2.toFixed(2);
      const tbody = _numpadTarget.closest("tbody");
      if (tbody && typeof tbody._markDirty === "function") tbody._markDirty();
    }
  }
  closeNumPad();
}



function showEmptyStateIfNeeded(table, message = "There are no records yet.") {
  if (!table || !table.tBodies || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];

  // Remove any previous empty-state row
  tbody.querySelectorAll("tr.table-empty").forEach(tr => tr.remove());

  // If there are **no data rows**, insert an empty-state row
  if (tbody.rows.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "table-empty";
    tr.setAttribute("contenteditable", "false");   // ← block editing of this row

    const td = document.createElement("td");

    // Use header length if available; fallback to current column count or 3
    const colCount =
      (table.tHead && table.tHead.rows[0]?.cells.length) ||
      (table.rows[0]?.cells.length) ||
      3;

    td.colSpan = colCount;
    td.textContent = message;

    // Optional UX polish: don’t allow caret or selection on the text itself
    td.setAttribute("contenteditable", "false");   // ← block editing of the cell too
    td.style.userSelect = "none";                  // ← avoid text selection while editing

    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function openNumPadForCell(td) {
  if (!td) return;
  _numpadTarget = td;

  const pad  = document.getElementById("numpad");
  const disp = document.getElementById("numpad-display");

  // Remember the previous value (for reference) but start BLANK for quick typing
  const prev = (td.textContent || "").trim();
  pad.dataset.mode = "cell";
  pad.dataset.prev = prev;

  disp.value = "";                 // ← clear automatically
  disp.placeholder = prev || "";   // ← optional: show old value as a hint

  pad.classList.remove("hidden");
  pad.removeAttribute("aria-hidden");
  document.body.style.overflow = "hidden";

  installZoomGuards(pad); 

  requestAnimationFrame(() => positionNumpadUnder(td));
  _repositionPadHandler = () => positionNumpadUnder(td);
  window.addEventListener("resize", _repositionPadHandler, { passive: true });
  window.addEventListener("scroll", _repositionPadHandler, { passive: true });
  window.addEventListener("orientationchange", _repositionPadHandler, { passive: true });

  // Put cursor in the display so typing starts immediately
  disp.focus();
}

const VENUES = ["helensvale", "redcliffe", "gardencity"];
let currentVenue = "all"; // default

function boardKey(board, venue){
  // board: "hist" | "today"; venue: "helensvale"...
  // Historical rows are stored as "both" (shared with historical leaderboard).
  if (board === "hist") return "both";
  return board;
}

function setVenue(venue){
  currentVenue = venue;
  // toggle pill active state
  document.querySelectorAll(".venue-pill").forEach(b=>{
    b.classList.toggle("is-active", b.dataset.venue === venue);
  });
  // reload tables for the new scope
  syncTodayDatePicker();
  refreshFromServer();
}

function syncTodayDatePicker() {
  const picker = document.getElementById("today-date-picker");
  if (!picker) return;
  const value = selectedTodayDateKey || todayBrisbaneKey();
  picker.value = value;
}

// Disable Edit/Add/Reset in ALL view (read-only merged view)
function applyVenueButtonState(){
  const isAll = currentVenue === "all";
  [
    "#hist-edit","#hist-add","#hist-reset",
    "#today-edit","#today-add","#today-reset","#today-merge",
    "#girl-edit"
  ].forEach(sel=>{
    const btn = document.querySelector(sel);
    if (btn) btn.disabled = isAll;
  });

  applyGirlCardVisibility();
}

async function refreshFromServer(){
  syncTodayDatePicker();
  const [histRows, todayRows, girlRows] = await Promise.all([
    loadBoard('hist'),
    loadBoard('today'),
    loadGirlRecord()
  ]);
  hydrate('hist', histRows);
  hydrate('today', todayRows);
  hydrateGirl(girlRows);

  // ensure ids locally so edit/delete helpers work
  const changed = ensureAllHaveIds();
  if (changed && currentVenue !== "all") {
    await saveBoard('hist', histData);
    await saveBoard('today', todayData);
  }

  renderLeaderboard(histData, "#rank-table-hist");
  renderLeaderboard(todayData, "#rank-table-today");
  renderGirlRecord(girlData);
  applyVenueButtonState();
  refreshEmptyState?.();
}

async function refreshTodayFromServer() {
  syncTodayDatePicker();
  const todayRows = await loadBoard("today");
  hydrate("today", todayRows);
  renderLeaderboard(todayData, "#rank-table-today");
  refreshEmptyState?.();
}

// Pretty label for venues
function venueLabel(v) {
  const map = { helensvale: "Helensvale", redcliffe: "Redcliffe", gardencity: "Garden City" };
  return map[v?.toLowerCase?.()] || v || "";
}

// Rebuild table headers depending on current venue
function renderHeaders(tableSelector) {
  const theadRow = document.querySelector(`${tableSelector} thead tr`);
  if (!theadRow) return;

  const isAll = currentVenue === "all";
  const cols = isAll ? ["Rank", "Name", "Venue", "Time"] : ["Rank", "Name", "Time"];

  theadRow.innerHTML = cols.map((t) => `<th>${t}</th>`).join("");
}

async function applyGirlEdits(editedRows) {
  const current = girlData.find(r => Number.isInteger(r.id));
  if (!current) return;

  const edited = normalizeRows(editedRows)[0];
  if (!edited) return;

  const origName = (current.name || "").trim();
  const origScore = Math.round((Number(current.score) || 0) * 100) / 100;
  const nextName = (edited.name || "").trim();
  const nextScore = Math.round((Number(edited.score) || 0) * 100) / 100;

  if (!nextName) return;
  if (origName === nextName && origScore === nextScore) return;

  const { error } = await supabase
    .from("leaderboard")
    .update({ name: nextName, score: nextScore })
    .eq("id", current.id);

  if (error) {
    console.warn("[girl edit] update error", error);
    throw error;
  }
}

/**
 * Apply edits made in the Historical leaderboard to Supabase.
 *
 * Rules:
 * - If an existing row (matched by id) has board='both' and its name/time changed:
 *      → update that row (board stays 'both', status stays 1)
 *      → we'll later re-render BOTH Today & Historical.
 * - If an existing row has board other than 'both' (e.g. 'hist') and its name/time changed:
 *      → update that row (board unchanged, status stays 1)
 *      → we'll later re-render Historical only.
 * - If a row is NEW (no known id in histData):
 *      → create it as a Historical row: board='both', status=1.
 * - If a row disappears from the table, we DO NOT delete/archive anything in Supabase.
 *
 * Returns: { changedBoth: boolean } indicating if any 'both' row was edited.
 */
async function applyHistoricalEdits(editedRows) {
  if (currentVenue === "all") return { changedBoth: false };

  // Map current historical data (for this venue) by id so we can see board/status
  const byId = new Map(
    histData
      .filter(r => Number.isInteger(r.id))
      .map(r => [Number(r.id), r])
  );

  const payloads = [];
  let changedBoth = false;

  for (const r of editedRows) {
    const cleanName  = (r.name || "").trim();
    const cleanScore = Math.round((Number(r.score) || 0) * 100) / 100;
    if (!cleanName) continue;

    const id = Number.isInteger(r.id) ? r.id : undefined;

    // NEW ROW typed directly in Historical
    if (id == null || !byId.has(id)) {
      const newId = id ?? nextGlobalId();
      payloads.push(
        toDBPayload("both", currentVenue, { id: newId, name: cleanName, score: cleanScore }, 1)
      );
      continue;
    }

    // EXISTING ROW
    const orig = byId.get(id);
    const origName  = (orig.name || "").trim();
    const origScore = Math.round((Number(orig.score) || 0) * 100) / 100;

    // Skip if nothing actually changed
    if (origName === cleanName && origScore === cleanScore) continue;

    const board  = (orig.board && orig.board !== "hist") ? orig.board : "both";
    const status = orig.status ?? 1;

    payloads.push({
      id,
      board,
      venue: currentVenue,
      name: cleanName,
      score: cleanScore,
      status
    });

    if (board === "both") changedBoth = true;
  }

  if (!payloads.length) return { changedBoth: false };

  const { error } = await supabase
    .from("leaderboard")
    .upsert(payloads, { onConflict: "id" });

  if (error) {
    console.warn("[hist edit] upsert error", error);
    throw error;
  }

  return { changedBoth };
}


// Button clicks
document.getElementById("numpad")?.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;

  // backdrop close
  if (e.target.id === "numpad") { closeNumPad(); return; }

  const k = e.target.getAttribute("data-k");
  if (!k && e.target.id !== "numpad-ok" && e.target.id !== "numpad-cancel") return;

  const disp = document.getElementById("numpad-display");

  if (k === "del") {
    disp.value = disp.value.slice(0, -1);
  } else if (k === ".") {
    if (!disp.value.includes(".")) {
      disp.value = disp.value ? disp.value + "." : "0.";
    }
  } else if (k) {
    // digits 0-9
    disp.value += k;
  } else if (e.target.id === "numpad-ok") {
    applyNumPadValue();
  } else if (e.target.id === "numpad-cancel") {
    closeNumPad();
  }
});

// Keyboard support for desktop (optional)
document.getElementById("numpad")?.addEventListener("keydown", (e) => {
  const disp = document.getElementById("numpad-display");
  if (e.key >= "0" && e.key <= "9") { disp.value += e.key; e.preventDefault(); }
  if (e.key === "." && !disp.value.includes(".")) { disp.value += "."; e.preventDefault(); }
  if (e.key === "Backspace") { disp.value = disp.value.slice(0, -1); e.preventDefault(); }
  if (e.key === "Enter") { applyNumPadValue(); e.preventDefault(); }
  if (e.key === "Escape") { closeNumPad(); e.preventDefault(); }
});

// Prevent typing directly in #add-score (we use the keypad)
document.getElementById("add-score")?.addEventListener("keydown", (e) => e.preventDefault());


// ===== Wire buttons (ids from your HTML) =====
document.getElementById("hist-edit")?.addEventListener("click", (e) => {
  toggleEditable("#rank-table-hist", e.currentTarget, "hist");
});
document.getElementById("girl-edit")?.addEventListener("click", (e) => {
  toggleEditable("#rank-table-girl", e.currentTarget, "girl");
});
// Historical Reset -> modal confirm
document.getElementById("hist-reset")?.addEventListener("click", (e) => {
  openConfirmModal({ action: "reset-hist", opener: e.currentTarget });
});

// Today's Reset -> modal confirm
document.getElementById("today-reset")?.addEventListener("click", (e) => {
  openConfirmModal({ action: "reset-today", opener: e.currentTarget });
});


document.getElementById("today-merge")?.addEventListener("click", () => {
  mergeTodayIntoHistorical();
});
document.getElementById("today-edit")?.addEventListener("click", (e) => {
  toggleEditable("#rank-table-today", e.currentTarget, "today");
});

document.getElementById("today-add")?.addEventListener("click", (e) => {
  openAddModal("today", e.currentTarget);
});
document.getElementById("today-date-picker")?.addEventListener("change", (e) => {
  const picked = e.target?.value;
  if (!picked) return;
  selectedTodayDateKey = picked;
  refreshTodayFromServer();
});
document.getElementById("hist-add")?.addEventListener("click", (e) => {
  openAddModal("hist", e.currentTarget);
});
// Delegated click handlers for row delete (both tables)
document.querySelector("#rank-table-hist tbody")?.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;
  if (!e.target.classList.contains("row-del")) return;
  handleRowDelete(e, "hist", "#rank-table-hist");
});

document.querySelector("#rank-table-today tbody")?.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;
  if (!e.target.classList.contains("row-del")) return;
  handleRowDelete(e, "today", "#rank-table-today");
});

// Delete implementation
async function handleRowDelete(e, which, tableSelector) {
  // 🚫 Historical rows cannot be deleted via the edit UI
  if (which === "hist") return;

  const tr = e.target.closest("tr");
  if (!tr) return;

  const idAttr = tr.getAttribute("data-id");
  const rowId  = Number.parseInt(idAttr, 10);
  const name   = (tr.cells[1]?.textContent || "").trim();
  const timeStr = (tr.cells[2]?.textContent || "").trim();
  const timeNum = Number(timeStr);

  if (!name) return;

  // Open your existing confirmation modal
  openConfirmModal({
    action: "delete",
    which,
    id: Number.isFinite(rowId) ? rowId : undefined,
    name,
    timeStr,
    timeNum,
    opener: e.target,
    tableSelector
  });
}



// --- Temporary zoom guard (iPad/iOS) just during numeric input ---
let _zoomGuards = null;

function installZoomGuards(container = document) {
  if (_zoomGuards) return;

  let lastTouchEnd = 0;

  // Block double-tap zoom inside the given container
  const onTouchEnd = (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();             // cancel double-tap zoom
    }
    lastTouchEnd = now;
  };

  // Block pinch-zoom while entering numbers
  const onGestureStart = (e) => { e.preventDefault(); };

  // Must be passive:false so preventDefault() actually works
  container.addEventListener('touchend', onTouchEnd, { passive: false });
  container.addEventListener('gesturestart', onGestureStart, { passive: false });

  // Extra safety on iOS: temporarily lock viewport scaling
  const vp = document.querySelector('meta[name="viewport"]');
  const original = vp?.getAttribute('content') || '';
  if (vp) {
    // append flags without losing your existing settings
    const appended = original.includes('user-scalable')
      ? original.replace(/user-scalable=\s*\w+/i, 'user-scalable=no')
               .replace(/maximum-scale=\s*[\d.]+/i, 'maximum-scale=1')
      : `${original}, maximum-scale=1, user-scalable=no`;
    vp.setAttribute('content', appended);
  }

  _zoomGuards = { container, onTouchEnd, onGestureStart, vp, original };
}

function removeZoomGuards() {
  const g = _zoomGuards;
  if (!g) return;

  g.container.removeEventListener('touchend', g.onTouchEnd);
  g.container.removeEventListener('gesturestart', g.onGestureStart);

  // Restore original viewport so double-tap/pinch work again elsewhere
  if (g.vp) g.vp.setAttribute('content', g.original);

  _zoomGuards = null;
}

/**
 * Keep only the fastest N rows visible on a given board+venue.
 *
 * TODAY MODE:
 *   - board === "today" → consider rows with board IN ("today","both")
 *   - After sort:
 *       · top N: unchanged (stay as they are, status=1)
 *       · overflow:
 *            - board="today" → status = 2 (archive)
 *            - board="both"  → board="both" (historical-only in this setup)
 *
 * HISTORICAL MODE (used on merge):
 *   - board === "hist"
 *   - Build candidates from:
 *       1) selected-day Today rows (board='today', status=1, current venue)
 *       2) all active Historical rows (board='both', status=1, current venue)
 *   - Sort combined candidates with normal leaderboard ranking and keep top N.
 *   - For any top-N row coming from Today, promote it to board='both'.
 *
 * After DB updates we call refreshFromServer() so UI shows fresh top 10.
 */
async function enforceTopNStatus(board, n = 10) {
  if (currentVenue === "all") return; // never write in ALL view

  // ---------- TODAY MODE ----------
  if (board === "today") {
    // Keep DB data status/board unchanged for Today.
    // UI load path already shows top-10 for selected date.
    await refreshFromServer();
    return;
  }

  // ---------- HISTORICAL MODE (merge semantics) ----------
  if (board === "hist") {
    const dateKey = selectedTodayDateKey || todayBrisbaneKey();
    const { data, error } = await supabase
      .from("leaderboard")
      .select("id, board, score, created_at, updated_at")
      .in("board", ["today", "both"])
      .eq("venue", currentVenue)
      .eq("status", 1)
      .order("score", { ascending: true })
      .limit(500);

    if (error) {
      console.warn("[enforceTopN hist] load error", error);
      return;
    }

    const rows = data || [];
    const todayRowsForDate = rows.filter(
      r => r.board === "today" && brisbaneDayKeyFromIso(r.created_at) === dateKey
    );
    const bothRows = rows.filter(r => r.board === "both");
    const candidates = [...todayRowsForDate, ...bothRows]
      .sort(compareLeaderboardRows);

    if (!candidates.length) {
      await refreshFromServer();
      return;
    }

    const top = candidates.slice(0, n);
    const topTodayIds = top.filter(r => r.board === "today").map(r => r.id);

    // Promote selected-day Today rows that made historical top N
    if (topTodayIds.length) {
      const { error: e1 } = await supabase
        .from("leaderboard")
        .update({ board: "both", status: 1 })
        .in("id", topTodayIds)
        .eq("venue", currentVenue);
      if (e1) console.warn("[enforceTopN hist] top today->both error", e1);
    }

    await refreshFromServer();
  }
}

function mergeEditsIntoData(which, editedRows) {
  const target = which === "hist" ? histData : todayData;
  const existingById = new Map(
    target
      .filter(r => Number.isInteger(r.id))
      .map(r => [r.id, r])
  );

  let nextId = nextGlobalId();
  const result = [];

  for (const r of editedRows) {
    const cleanName  = (r.name || "").trim();
    const cleanScore = Math.round((Number(r.score) || 0) * 100) / 100;
    if (!cleanName) continue;

    let rowObj;

    if (Number.isInteger(r.id) && existingById.has(r.id)) {
      // Update existing row: keep board/venue/status
      const existing = existingById.get(r.id);
      existingById.delete(r.id);
      rowObj = {
        ...existing,
        name: cleanName,
        score: cleanScore
      };
    } else {
      // New row created in edit mode
      const baseBoard = which === "hist" ? "both" : "today";
      rowObj = {
        id: Number.isInteger(r.id) ? r.id : nextId++,
        name: cleanName,
        score: cleanScore,
        board: baseBoard,         // new rows belong to the editing board
        venue: currentVenue,
        status: 1
      };
    }

    result.push(rowObj);
  }

  // Any rows left in existingById were removed in the UI → they disappear from this board’s view
  return result;
}

function brisbaneDayKeyFromIso(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;

    const fmt = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Brisbane",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    const parts = fmt.formatToParts(d);
    let y, m, day;
    for (const p of parts) {
      if (p.type === "year")  y = p.value;
      if (p.type === "month") m = p.value;
      if (p.type === "day")   day = p.value;
    }
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`; // e.g. "2025-11-21"
  } catch (err) {
    console.warn("[date] failed to parse timestamp", isoString, err);
    return null;
  }
}

/** Today’s date in Brisbane, as YYYY-MM-DD */
function todayBrisbaneKey() {
  return brisbaneDayKeyFromIso(new Date().toISOString());
}

// Modal controls
document.getElementById("add-cancel")?.addEventListener("click", closeAddModal);
document.getElementById("add-confirm")?.addEventListener("click", confirmAddFromModal);

// Close on Escape, Confirm on Enter
document.getElementById("add-modal")?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAddModal();
  if (e.key === "Enter") {
    // avoid submitting when focus is on Cancel
    const active = document.activeElement;
    if (active?.id !== "add-cancel") confirmAddFromModal();
  }
});

// Close when clicking the shaded backdrop (not the panel)
document.getElementById("add-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "add-modal") closeAddModal();
});


// (Optional) storage dump button you already added
// document.getElementById('dump-storage')?.addEventListener('click', () => {
//   const hist = JSON.parse(localStorage.getItem(STORAGE_KEYS.hist) || '[]');
//   const today = JSON.parse(localStorage.getItem(STORAGE_KEYS.today) || '[]');
//   console.log('Historical:', hist);
//   console.table(hist);
//   console.log("Today's:", today);
//   console.table(today);
//   alert('Opened console with Local Storage contents.');
// });
// Confirm/Cancel for the generic confirm modal
document.getElementById("del-cancel")?.addEventListener("click", closeConfirmModal);
document.getElementById("del-confirm")?.addEventListener("click", confirmFromModal);

// Keyboard + backdrop for the same modal
document.getElementById("delete-modal")?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeConfirmModal();
  if (e.key === "Enter") {
    const active = document.activeElement;
    if (active?.id !== "del-cancel") confirmFromModal();
  }
});
document.getElementById("delete-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "delete-modal") closeConfirmModal();
});

// Show custom keypad when Time input is clicked/focused
document.getElementById("add-score")?.addEventListener("click", () => openNumPadFor("#add-score"));
document.getElementById("add-score")?.addEventListener("focus", () => openNumPadFor("#add-score"));

// Close keypad when clicking anywhere that's NOT inside the keypad panel or the Add modal panel
document.addEventListener("click", (e) => {
  const pad = document.getElementById("numpad");
  if (!pad || pad.classList.contains("hidden")) return;

  const kpPanel = document.querySelector("#numpad .numpad__panel");
  const modalPanel = document.querySelector("#add-modal .modal__panel");
  const t = e.target;

  const clickedInsideKeypad = kpPanel?.contains(t);
  const clickedInsideAddModal = modalPanel?.contains(t);

  if (!clickedInsideKeypad && !clickedInsideAddModal) {
    closeNumPad();
  }
}, true); // capture phase helps with nested elements

// Close keypad on Escape even if focus isn't inside it
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const pad = document.getElementById("numpad");
    if (pad && !pad.classList.contains("hidden")) closeNumPad();
  }
});

// ===== Empty-state helpers =====
function ensureEmptyLabel(container, id, text) {
  if (!container) return null;
  let msg = container.querySelector(`#${id}`);
  if (!msg) {
    msg = document.createElement("div");
    msg.id = id;
    msg.textContent = text || "There are no records yet";
    msg.style.cssText = "margin:8px 0; font-size:12px; color:#333;";
    container.appendChild(msg);
  }
  return msg;
}

function countRows(tbody) {
  if (!tbody) return 0;
  return [...tbody.querySelectorAll("tr")]
    .filter(tr => !tr.hidden && !tr.classList.contains("table-empty")) // ← ignore placeholder row
    .length;
}


function refreshEmptyState() {
  // Use your real table IDs
  const histTable  = document.getElementById("rank-table-hist");
  const todayTable = document.getElementById("rank-table-today");
  const girlTable  = document.getElementById("rank-table-girl");

  const histTbody  = histTable?.querySelector("tbody");
  const todayTbody = todayTable?.querySelector("tbody");
  const girlTbody  = girlTable?.querySelector("tbody");

  // Toggle inline “There are no records yet” <tr>
  showEmptyStateIfNeeded(histTable,  "There are no records yet.");
  showEmptyStateIfNeeded(todayTable, "There are no records yet.");
  showEmptyStateIfNeeded(girlTable,  "There are no records yet.");

  const histCount  = countRows(histTbody);
  const todayCount = countRows(todayTbody);
  const girlCount = countRows(girlTbody);

  // If a table is empty, strip the Delete column entirely (even in edit mode)
  if (histCount === 0)  disableDeleteUI("#rank-table-hist");
  if (todayCount === 0) disableDeleteUI("#rank-table-today");

  // Disable any delete buttons when there are no rows in either table
  const anyRows = (histCount + todayCount + girlCount) > 0;
  document.querySelectorAll('[data-action="delete"], .btn-delete-row, .row-del').forEach(btn => {
    btn.disabled = !anyRows;
    btn.setAttribute("aria-disabled", !anyRows ? "true" : "false");
  });
}



// Observe DOM changes to keep the empty-state in sync automatically
function setupEmptyStateObservers() {
  const histTbody  = document.querySelector("#rank-table-hist tbody");
  const todayTbody = document.querySelector("#rank-table-today tbody");
  const girlTbody  = document.querySelector("#rank-table-girl tbody");

  const obs = new MutationObserver(() => refreshEmptyState());
  if (histTbody)  obs.observe(histTbody,  { childList: true, subtree: false });
  if (todayTbody) obs.observe(todayTbody, { childList: true, subtree: false });
  if (girlTbody)  obs.observe(girlTbody,  { childList: true, subtree: false });
}

document.getElementById("add-score")
  ?.addEventListener("click", () => openNumPadFor("#add-score"));


// Prevent pointless delete actions when there's nothing to delete.
// Handles toolbar delete/reset buttons and per-row ".row-del" buttons.
document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-action="delete"], .btn-delete-row, .row-del');
  if (!btn) return;

  // If already disabled by UI, just swallow.
  if (btn.matches('[disabled], [aria-disabled="true"]')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // Row delete buttons only render when a row exists -> allow.
  if (btn.classList.contains("row-del")) return;

  // For toolbar delete buttons, prefer a specific target table via data-target
  // e.g. <button data-action="delete" data-target="#rank-table-hist">Reset</button>
  const targetSel = btn.getAttribute("data-target");
  const tbody = targetSel ? document.querySelector(`${targetSel} tbody`) : null;

  // If no explicit target, fall back to sum of both tables
  const count = tbody
    ? countRows(tbody)
    : (countRows(document.querySelector("#rank-table-hist tbody")) +
       countRows(document.querySelector("#rank-table-today tbody")));

  if (count === 0) {
    e.preventDefault();
    e.stopImmediatePropagation();
    alert("No records to delete.");
  }
}, true);




// Author: Gama
// Surfers Paradise, QLD
// 18/10/25
// 位卑未敢忘忧国，哪怕无人知我
