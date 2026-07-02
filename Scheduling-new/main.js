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
const rosterGenerateBtn = document.getElementById("roster-generate-btn");
const rosterExportBtn = document.getElementById("roster-export-btn");
const appModal = document.getElementById("app-modal");
const appModalMessage = document.getElementById("app-modal-message");
const appModalClose = document.getElementById("app-modal-close");

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
    Array.from({ length: rowCount }, () => ({ label: "", color: "", shiftName: "" }))
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
        cell.shiftName = shift.name;
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
        dayCells[dIdx][r + span].color === color &&
        dayCells[dIdx][r + span].shiftName === cell.shiftName
      ) {
        span++;
      }
      if (label) {
        const block = addItem("", "roster-block", dIdx + 2, r + 2, span);
        block.style.background = color || colorForShift("", dIdx);
        renderShiftAssignments(block, assignmentsMap[`${day}-${cell.shiftName}`] || []);
      }
      r += span;
    }
  });
}

function positionClass(position) {
  const normalized = normalizeText(position);
  if (normalized === "cafe") return "position-cafe";
  if (normalized === "floor") return "position-floor";
  if (normalized === "reception") return "position-reception";
  return "position-other";
}

function positionIcon(position) {
  const normalized = normalizeText(position);
  if (normalized === "cafe") return "pic/cafe.png";
  if (normalized === "floor") return "pic/floor.png";
  if (normalized === "reception") return "pic/reception.png";
  return "pic/employees.png";
}

function renderShiftAssignments(block, assigned) {
  const groups = assigned.reduce((acc, item) => {
    const key = normalizeText(item.position) || "other";
    if (!acc.has(key)) {
      acc.set(key, { position: item.position || "other", assignments: [] });
    }
    acc.get(key).assignments.push(item);
    return acc;
  }, new Map());

  groups.forEach((group) => {
    const row = document.createElement("div");
    row.className = `roster-position ${positionClass(group.position)}`;

    const position = document.createElement("span");
    position.className = "roster-position__role";

    const icon = document.createElement("img");
    icon.className = "roster-position__icon";
    icon.src = positionIcon(group.position);
    icon.alt = "";

    const label = document.createElement("span");
    label.textContent = `${group.position}:`;

    position.appendChild(icon);
    position.appendChild(label);

    const names = document.createElement("ul");
    names.className = "roster-position__names";
    group.assignments.forEach((assignment) => {
      const name = document.createElement("li");
      name.className = "roster-position__name";
      renderRosterNameDisplay(name, assignment, group.position);
      names.appendChild(name);
    });

    row.appendChild(position);
    row.appendChild(names);
    block.appendChild(row);
  });
}

function renderRosterNameDisplay(container, assignment, position) {
  container.innerHTML = "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "roster-position__name-button";
  button.textContent = assignment.name || "Unfilled";
  button.addEventListener("click", () => {
    renderRosterNameEditor(container, assignment, position);
  });

  container.appendChild(button);
}

function renderRosterNameEditor(container, assignment, position) {
  container.innerHTML = "";
  const originalName = assignment.name || "Unfilled";

  const editor = document.createElement("div");
  editor.className = "roster-position__name-editor";

  const input = document.createElement("input");
  input.className = "roster-position__name-input";
  input.type = "text";
  input.value = assignment.name || "";
  input.setAttribute("aria-label", `${position} employee name`);

  const suggestions = document.createElement("ul");
  suggestions.className = "suggestions roster-position__suggestions";
  let editorClosed = false;

  const closeEditor = (value, validateName = true) => {
    editorClosed = true;
    if (validateName) {
      const employee = findEmployeeByName(value);
      if (!employee) {
        showModal("Please choose a valid employee name from the suggestions.");
        assignment.name = originalName;
        renderRosterNameDisplay(container, assignment, position);
        return;
      }
      assignment.name = employee.name || originalName;
    } else {
      assignment.name = value || originalName;
    }
    renderRosterNameDisplay(container, assignment, position);
  };

  const saveName = () => {
    closeEditor(input.value.trim());
  };

  input.addEventListener("input", () => {
    renderNameSuggestions(input.value, suggestions, (row) => {
      closeEditor(row?.name || originalName, false);
    });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveName();
    }
    if (event.key === "Escape") {
      editorClosed = true;
      renderRosterNameDisplay(container, assignment, position);
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!editorClosed) saveName();
    }, 120);
  });

  editor.appendChild(input);
  editor.appendChild(suggestions);
  container.appendChild(editor);
  input.focus();
  input.select();
}

function renderDetail(row) {
  if (!row) {
    detailName.textContent = "—";
    detailVenue.textContent = "—";
    detailPosition.textContent = "—";
    detailType.textContent = "—";
    currentDetail = null;
    return;
  }
  detailName.textContent = row.name || "Unnamed";
  detailVenue.textContent = row.venue || "—";
  detailPosition.textContent = row.position || "—";
  detailType.textContent = row.type || "—";
  currentDetail = row;
}

function matchingEmployees(query) {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return employees
    .filter((emp) => normalizeText(emp.name).includes(normalized))
    .slice(0, 8);
}

function findEmployeeByName(name) {
  const normalized = normalizeText(name);
  if (!normalized) return null;
  return employees.find((emp) => normalizeText(emp.name) === normalized) || null;
}

function closeSuggestions(listEl = suggestionsEl) {
  if (!listEl) return;
  listEl.innerHTML = "";
  listEl.classList.remove("open");
}

function selectEmployee(row) {
  renderDetail(row);
  searchInput.value = row?.name || "";
  closeSuggestions();
}

function showInvalidEmployeeNameModal() {
  showModal("Please choose a valid employee name from the suggestions.");
}

function renderNameSuggestions(query, listEl, onSelect) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const matches = matchingEmployees(query);

  if (!query.trim()) {
    closeSuggestions(listEl);
    return;
  }

  if (!matches.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No matching employees.";
    listEl.appendChild(empty);
    listEl.classList.add("open");
    return;
  }

  matches.forEach((row) => {
    const item = document.createElement("li");
    item.textContent = row.name || "Unnamed";
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      onSelect(row);
    });
    listEl.appendChild(item);
  });
  listEl.classList.add("open");
}

function renderSearchSuggestions(query) {
  renderNameSuggestions(query, suggestionsEl, selectEmployee);
}

function wireEmployeeSearch() {
  if (!searchInput || !searchForm) return;

  searchInput.addEventListener("input", () => {
    renderSearchSuggestions(searchInput.value);
  });

  searchInput.addEventListener("focus", () => {
    renderSearchSuggestions(searchInput.value);
  });

  searchInput.addEventListener("blur", () => {
    setTimeout(closeSuggestions, 120);
  });

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = searchInput.value;
    if (!query.trim()) return;
    const selected = findEmployeeByName(query);
    if (!selected) {
      showInvalidEmployeeNameModal();
      return;
    }
    selectEmployee(selected);
  });
}

function wireRuleNameSearch() {
  if (!ruleNameInput || !ruleNameSuggestionsEl) return;

  const selectRuleEmployee = (row) => {
    ruleNameInput.value = row?.name || "";
    closeSuggestions(ruleNameSuggestionsEl);
  };

  ruleNameInput.addEventListener("input", () => {
    renderNameSuggestions(ruleNameInput.value, ruleNameSuggestionsEl, selectRuleEmployee);
  });

  ruleNameInput.addEventListener("focus", () => {
    renderNameSuggestions(ruleNameInput.value, ruleNameSuggestionsEl, selectRuleEmployee);
  });

  ruleNameInput.addEventListener("blur", () => {
    setTimeout(() => {
      closeSuggestions(ruleNameSuggestionsEl);
      if (ruleNameInput.value.trim() && !findEmployeeByName(ruleNameInput.value)) {
        showInvalidEmployeeNameModal();
      }
    }, 120);
  });
}

function wireRuleFormValidation() {
  if (!ruleForm || !ruleNameInput) return;
  ruleForm.addEventListener("submit", (event) => {
    if (!findEmployeeByName(ruleNameInput.value)) {
      event.preventDefault();
      showInvalidEmployeeNameModal();
    }
  });
}

function renderRules() {
  if (!rulesListEl) return;
  rulesListEl.innerHTML = "";
  if (!rules.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "No rules yet.";
    rulesListEl.appendChild(div);
    return;
  }
  rules.forEach((rule, idx) => {
    const div = document.createElement("div");
    div.className = "rule-line";
    div.innerHTML = `${idx + 1}. ${rule.name} <strong>${rule.require}</strong> be scheduled from ${rule.start} to ${rule.end} on ${rule.day}`;
    rulesListEl.appendChild(div);
  });
}

const wireGenerate = (btn) => {
  if (btn) {
    btn.addEventListener("click", () => {
      const result = generateRoster();
      if (!result) return;
      const { assignments, errors } = result;
      if (errors.length) {
        alert(errors.join("\n"));
      }
      renderRosterGrid(assignments);
    });
  }
};

function showModal(message) {
  if (!appModal) {
    alert(message);
    return;
  }
  if (appModalMessage) appModalMessage.textContent = message;
  appModal.hidden = false;
  appModalClose?.focus();
}

function closeModal() {
  if (appModal) appModal.hidden = true;
}

function wireModal() {
  appModalClose?.addEventListener("click", closeModal);
  appModal?.addEventListener("click", (event) => {
    if (event.target === appModal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appModal && !appModal.hidden) closeModal();
  });
}

const wireRosterExport = (btn) => {
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const section = document.querySelector(".roster-section");
    if (!section) return;
    if (!rosterGrid?.querySelector(".roster-block")) {
      showModal("Please generate the roster before exporting.");
      return;
    }
    if (typeof html2canvas === "undefined") {
      alert("Export library is still loading. Please try again in a moment.");
      return;
    }

    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Exporting...";

    try {
      const canvas = await html2canvas(section, {
        backgroundColor: "#ffffff",
        scale: window.devicePixelRatio || 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      link.download = `weekly-roster-${date}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Roster export failed", err);
      alert("Could not export the roster image. Please try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function timesOverlap(startA, endA, startB, endB) {
  const aStart = timeIndex[startA];
  const aEnd = timeIndex[endA];
  const bStart = timeIndex[startB];
  const bEnd = timeIndex[endB];
  if ([aStart, aEnd, bStart, bEnd].some((idx) => idx === undefined)) return false;
  return aStart < bEnd && bStart < aEnd;
}

function ruleEffectFor(name, day, shift) {
  return rules.reduce(
    (effect, rule) => {
      const sameEmployee = normalizeText(rule.name) === normalizeText(name);
      const sameDay = rule.day === day;
      const sameTime = timesOverlap(rule.start, rule.end, shift.start, shift.end);
      if (!sameEmployee || !sameDay || !sameTime) return effect;

      if (rule.require === "can't") effect.blocked = true;
      if (rule.require === "must") effect.must = true;
      return effect;
    },
    { blocked: false, must: false }
  );
}

function hasPosition(emp, position) {
  const employeePosition = normalizeText(emp.position);
  const requiredPosition = normalizeText(position);
  if (!employeePosition || !requiredPosition) return false;
  return employeePosition
    .split(/[,/&]+|\band\b/)
    .map((part) => part.trim())
    .some((part) => part === requiredPosition);
}

function getShiftLabel(assignmentsMap, day, shiftName) {
  const assigned = assignmentsMap?.[`${day}-${shiftName}`] || [];
  return assigned.map((item) => `${item.position}: ${item.name}`).join("\n");
}

function colorForShift(shiftName, dayIndex) {
  const palettes = {
    Morning: ["#b8d8f0", "#badfc4", "#efd384", "#e9b6bf", "#c9bff0", "#b7d9d5", "#e1bfaa"],
    Night: ["#9fb4e8", "#9fceb8", "#e6b65f", "#dc97a6", "#b0a0e0", "#95c8c3", "#ce9f85"],
  };
  const colors = palettes[shiftName] || palettes.Morning;
  return colors[dayIndex % colors.length];
}

function generateRoster() {
  if (!employees.length) {
    alert("No employees loaded.");
    return null;
  }
  const counts = new Map();
  employees.forEach((e) => counts.set(e.id ?? e.name, 0));

  const assignments = {};
  const errors = [];

  const requirements = (day) => {
    const weekend = day === "Saturday" || day === "Sunday";
    const set = weekend ? 2 : 1;
    return [
      ...Array(set).fill({ position: "floor" }),
      ...Array(set).fill({ position: "cafe" }),
      ...Array(set).fill({ position: "reception" }),
    ];
  };

  const pickCandidate = (position, day, shift) => {
    let candidates = employees
      .map((emp) => {
        const eff = ruleEffectFor(emp.name, day, shift);
        return {
          emp,
          blocked: eff.blocked,
          must: eff.must,
          hasPos: hasPosition(emp, position),
        };
      })
      .filter((c) => !c.blocked);

    candidates = candidates.filter((c) => c.hasPos);
    // fallback to any non-blocked if none match
    if (!candidates.length) {
      candidates = employees
        .map((emp) => {
          const eff = ruleEffectFor(emp.name, day, shift);
          return { emp, blocked: eff.blocked, must: eff.must, hasPos: true };
        })
        .filter((c) => !c.blocked);
    }
    if (!candidates.length) {
      errors.push(`No available ${position} on ${day} (${shift.name}).`);
      return null;
    }
    candidates.sort((a, b) => {
      if (a.must !== b.must) return a.must ? -1 : 1;
      const ca = counts.get(a.emp.id ?? a.emp.name) || 0;
      const cb = counts.get(b.emp.id ?? b.emp.name) || 0;
      if (ca !== cb) return ca - cb;
      return Math.random() - 0.5;
    });
    const chosen = candidates[0].emp;
    const key = chosen.id ?? chosen.name;
    counts.set(key, (counts.get(key) || 0) + 1);
    return chosen;
  };

  shifts.forEach((shift) => {
    daysOfWeek.forEach((day) => {
      const reqs = requirements(day);
      const key = `${day}-${shift.name}`;
      assignments[key] = [];
      reqs.forEach((req) => {
        const pick = pickCandidate(req.position, day, shift);
        assignments[key].push({
          position: req.position,
          name: pick ? pick.name || "Unnamed" : "Unfilled",
        });
      });
    });
  });

  return { assignments, errors };
}

fetchEmployees();
if (copyrightYear) copyrightYear.textContent = new Date().getFullYear();
renderRosterGrid();
wireEmployeeSearch();
wireRuleNameSearch();
wireRuleFormValidation();
wireModal();
wireGenerate(rosterGenerateBtn);
wireRosterExport(rosterExportBtn);
