// simple script for inspecting time slots
const timeSlots = [];
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

// use console.log when running under node or browser
// console.log("Time slots:", timeSlots);
// console.log("Hour slots:", hourSlots);

const timeIndex = timeSlots.reduce((acc, t, idx) => {
  acc[t] = idx;
  return acc;
}, {});
// console.log("Time index:", timeIndex);