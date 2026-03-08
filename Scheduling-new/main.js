const SUPABASE_URL = window.SUPABASE_URL || "https://rhgfzhmessbxoesqkixr.supabase.co";
const SUPABASE_ANON_KEY =
  window.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoZ2Z6aG1lc3NieG9lc3FraXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzNzIzNjYsImV4cCI6MjA3Njk0ODM2Nn0.auo5AOo3iV4j1pZIFYQSBfYUrKOIH8_mz0k4F56VkkY";
const TABLE_NAME = "Employee";

const listEl = document.getElementById("name-list");
const windowEl = document.getElementById("name-window");
const hintEl = document.getElementById("load-hint");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const suggestionsEl = document.getElementById("suggestions");
const detailName = document.getElementById("detail-name");
const detailVenue = document.getElementById("detail-venue");
const detailPosition = document.getElementById("detail-position");
const detailType = document.getElementById("detail-type");
const ruleForm = document.getElementById("rule-form");
const ruleNameInput = document.getElementById("rule-name-input");
const ruleNameSuggestionsEl = document.getElementById("rule-name-suggestions");
const ruleRequireSel = document.getElementById("rule-require");
const ruleStartSel = document.getElementById("rule-start");
const ruleEndSel = document.getElementById("rule-end");
const ruleDaySel = document.getElementById("rule-day");
const rulesListEl = document.getElementById("rules-list");
const rosterGrid = document.getElementById("roster-grid");
const copyrightYear = document.getElementById("copyright-year");
const generateBtn = document.getElementById("generate-btn");
const rosterGenerateBtn = document.getElementById("roster-generate-btn");

let employees = [];
let currentDetail = null;

const timeSlots = []; // half-hour markers
for (let h = 8; h <= 21; h++) {
  ["00", "30"].forEach((m) => {
    timeSlots.push(`${String(h).padStart(2, "0")}:${m}`);
  });
}
timeSlots.push("22:00"); // end marker
const hourSlots = [];
for (let h = 8; h < 22; h++) {
  hourSlots.push(`${String(h).padStart(2, "0")}:00`);
}
const shifts = [
  { name: "Morning", start: "08:00", end: "16:30" },
  { name: "Night", start: "16:30", end: "21:30" },
];
const timeIndex = timeSlots.reduce((acc, t, idx) => {
  acc[t] = idx;
  return acc;
}, {});

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let rules = [];
const inputsForValidation = [ruleNameInput, ruleRequireSel, ruleStartSel, ruleEndSel, ruleDaySel];

fetchEmployees();
renderRosterGrid();

async function fetchEmployees() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("your-project-ref")) {
    hintEl.textContent = "Set your Supabase URL and anon key to load employees.";
    return;
  }
  if (typeof supabase === "undefined") {
    hintEl.textContent = "Supabase client failed to load.";
    return;
  }
  try {
    hintEl.textContent = "Loading employees…";
    const { createClient } = supabase;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await client
      .from(TABLE_NAME)
      .select("id, name, venue, position, type")
      .order("id", { ascending: true });
    if (error) throw error;
    renderList(data);
    hintEl.textContent = `Showing ${data.length} employee${data.length === 1 ? "" : "s"}.`;
    renderDetail(null); // no default selection on load
    renderRules();
  } catch (err) {
    console.error("Error loading employees", err);
    const message = err?.message || "Failed to load employees.";
    hintEl.textContent = message;
    renderList([]);
  }
}

function renderList(rows) {
  employees = rows || [];
  listEl.innerHTML = "";
  if (!employees.length) {
    const empty = document.createElement("li");
    empty.textContent = "No employees found.";
    listEl.appendChild(empty);
    return;
  }
  employees.forEach((row, idx) => {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = idx + 1;

    const text = document.createElement("span");
    text.textContent = row.name || "Unnamed";

    li.appendChild(badge);
    li.appendChild(text);
    listEl.appendChild(li);
  });
}

function renderRosterGrid(assignmentsMap) {
  if (!rosterGrid) return;
  rosterGrid.innerHTML = "";
  const hasAssignments =
    assignmentsMap && Object.values(assignmentsMap).some((v) => Array.isArray(v) && v.length);
  const rowSlots = hasAssignments ? timeSlots.slice(0, -1) : hourSlots; // hour rows when empty
  const rowHeight = hasAssignments ? 24 : 48; // keep total height similar when fewer rows
  const rowCount = rowSlots.length;
  rosterGrid.style.gridTemplateColumns = `120px repeat(${daysOfWeek.length}, minmax(120px, 1fr))`;
  rosterGrid.style.gridTemplateRows = `40px repeat(${rowCount}, ${rowHeight}px)`;

  const addItem = (text, cls, col, row, rowSpan = 1) => {
    const div = document.createElement("div");
    div.className = cls;
    if (text) div.textContent = text;
    div.style.gridColumn = `${col}`;
    div.style.gridRow = `${row} / span ${rowSpan}`;
    rosterGrid.appendChild(div);
    return div;
  };

  // headers
  daysOfWeek.forEach((day, idx) => addItem(day, "roster-header", idx + 2, 1));
  if (hasAssignments) {
    timeSlots.slice(0, -1).forEach((slot, idx) => {
      if (slot.endsWith(":00")) addItem(slot, "roster-time", 1, idx + 2, 2);
    });
  } else {
    rowSlots.forEach((slot, idx) => addItem(slot, "roster-time", 1, idx + 2));
  }

  // base grid cells for lines/backgrounds
  for (let r = 0; r < rowCount; r++) {
    daysOfWeek.forEach((_, dIdx) => {
      const cell = addItem("", "roster-cell base", dIdx + 2, r + 2);
      const parity = (dIdx + r) % 2;
      cell.style.background = parity ? "#f7f4ff" : "#fbfaff";
    });
  }

  if (!hasAssignments) return;

  // build per-day half-hour cells
  const dayCells = daysOfWeek.map(() =>
    Array.from({ length: rowCount }, () => ({ label: "", color: "" }))
  );

  const slotIdx = (t) => timeSlots.indexOf(t);

  shifts.forEach((shift) => {
    const sIdx = slotIdx(shift.start);
    const eIdx = slotIdx(shift.end);
    if (sIdx === -1 || eIdx === -1 || eIdx <= sIdx) return;
    daysOfWeek.forEach((day, dIdx) => {
      const label = getShiftLabel(assignmentsMap, day, shift.name);
      if (!label) return;
      for (let i = sIdx; i < eIdx; i++) {
        const cell = dayCells[dIdx][i];
        cell.label = label;
        cell.color = colorForShift(shift.name, dIdx);
      }
    });
  });

  // render merged contiguous cells
  daysOfWeek.forEach((day, dIdx) => {
    let r = 0;
    while (r < rowCount) {
      const cell = dayCells[dIdx][r];
      const label = cell.label;
      const color = cell.color;
      let span = 1;
      while (
        r + span < rowCount &&
        dayCells[dIdx][r + span].label === label &&
        dayCells[dIdx][r + span].color === color
      ) {
        span++;
      }
      if (label) {
        const block = addItem(label, "roster-block", dIdx + 2, r + 2, span);
        block.style.background = color || colorForShift("", dIdx);
      }
      r += span;
    }
  });
}