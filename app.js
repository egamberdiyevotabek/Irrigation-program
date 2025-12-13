function mmToM3PerHa(mm) {
  return mm * 10.0; // 1 mm = 10 m³/ga
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg || "";
}

function setSummary(html) {
  const el = document.getElementById("summary");
  el.classList.remove("muted");
  el.innerHTML = html;
}

function clearTables() {
  document.querySelector("#hourlyTable tbody").innerHTML = "";
  document.querySelector("#dailyTable tbody").innerHTML = "";
}

function addRow(tbody, cells) {
  const tr = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    td.textContent = c;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function pickSoilKey(hourly) {
  const keys = [
    "soil_moisture_9_to_27cm",
    "soil_moisture_7_to_28cm",
    "soil_moisture_3_to_9cm",
    "soil_moisture_1_to_3cm",
    "soil_moisture_0_to_1cm",
    "soil_moisture_0_to_7cm",
    "soil_moisture_28_to_100cm",
  ];
  for (const k of keys) if (hourly[k] !== undefined) return k;
  throw new Error("Soil moisture o‘zgaruvchisi topilmadi.");
}

function endpointForDate(dStr) {
  const today = new Date();
  const d = new Date(dStr + "T00:00:00");
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return d < t0
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";
}

function initDateDefault() {
  const el = document.getElementById("date");
  if (!el.value) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    el.value = `${yyyy}-${mm}-${dd}`;
  }
}

async function run() {
  clearTables();
  setStatus("Yuklanmoqda...");

  const lat = parseFloat(document.getElementById("lat").value);
  const lon = parseFloat(document.getElementById("lon").value);
  const alt = parseFloat(document.getElementById("alt").value);

  const d = document.getElementById("date").value; // YYYY-MM-DD
  const t = (document.getElementById("time")?.value || "").trim(); // HH:MM optional

  const kc = parseFloat(document.getElementById("kc").value);
  const raw = clamp(parseFloat(document.getElementById("raw").value), 0, 100);

  const soilManualStr = (document.getElementById("soilManual")?.value || "").trim();
  const soilManual = soilManualStr === "" ? null : clamp(parseFloat(soilManualStr), 0, 100);

  if (!d) {
    setStatus("");
    setSummary("Sana kiritilmagan. Date tanlang.");
    return;
  }

  const base = endpointForDate(d);
  const isArchive = base.includes("archive-api");
  const soilVar = isArchive ? "soil_moisture_7_to_28cm" : "soil_moisture_9_to_27cm";

  const hourly = [
    "et0_fao_evapotranspiration",
    "precipitation",
    soilVar
  ].join(",");

  const daily = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "shortwave_radiation_sum"
  ].join(",");

  const url = new URL(base);
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("elevation", alt);
  url.searchParams.set("start_date", d);
  url.searchParams.set("end_date", d);
  url.searchParams.set("hourly", hourly);
  url.searchParams.set("daily", daily);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  let data;
  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    setStatus("");
    setSummary(`Xatolik: ${e.message}`);
    return;
  }

  const h = data.hourly;
  if (!h || !h.time) {
    setStatus("");
    setSummary("Hourly ma’lumot kelmadi (API javobi bo‘sh bo‘lishi mumkin).");
    return;
  }

  const soilKey = pickSoilKey(h);
  const times = h.time; // local ISO strings

  const et0 = h.et0_fao_evapotranspiration.map(Number); // mm/h
  const etc = et0.map(x => x * kc);                     // mm/h
  const rain = (h.precipitation || Array(et0.length).fill(0)).map(Number);

  const soilPctApi = h[soilKey].map(x => Number(x) * 100.0);

  // Use manual soil moisture if provided; otherwise use API soil moisture
  const soilPctUsed = soilManual !== null
    ? Array(times.length).fill(soilManual)
    : soilPctApi;

  const soilSourceLabel = soilManual !== null
    ? `Manual (${soilManual.toFixed(1)}%)`
    : `${soilKey} (API model)`;

  // Hourly table (first 24)
  const tbH = document.querySelector("#hourlyTable tbody");
  const n = Math.min(24, times.length);
  for (let i = 0; i < n; i++) {
    addRow(tbH, [
      times[i],
      soilPctUsed[i].toFixed(1),
      et0[i].toFixed(3),
      etc[i].toFixed(3),
      mmToM3PerHa(et0[i]).toFixed(2),
      mmToM3PerHa(etc[i]).toFixed(2),
      rain[i].toFixed(2),
    ]);
  }

  // Daily table from API (if present)
  const tbD = document.querySelector("#dailyTable tbody");
  if (data.daily && data.daily.time && data.daily.time.length > 0) {
    addRow(tbD, [
      data.daily.time[0],
      (data.daily.precipitation_sum?.[0] ?? "").toString(),
      (data.daily.temperature_2m_max?.[0] ?? "").toString(),
      (data.daily.temperature_2m_min?.[0] ?? "").toString(),
      (data.daily.shortwave_radiation_sum?.[0] ?? "").toString(),
    ]);
  }

  // Daily ET totals from hourly
  const et0Day = et0.reduce((a, b) => a + b, 0);
  const etcDay = etc.reduce((a, b) => a + b, 0);

  // Find first time in the day when soil <= RAW
  let firstRawIdx = -1;
  for (let i = 0; i < times.length; i++) {
    if (soilPctUsed[i] <= raw) { firstRawIdx = i; break; }
  }

  // If user provided a time, compute watering decision at that time.
  // If user did NOT provide time, DO NOT show that specific “should I water at that time” answer.
  let timeDecisionHtml = "";
  if (t) {
    const target = `${d}T${t}`;

    // Use closest next hour if exact match missing
    let idxAtTime = times.findIndex(ts => ts >= target);
    if (idxAtTime === -1) idxAtTime = times.length - 1;

    const soilAtTime = soilPctUsed[idxAtTime];
    const shouldWaterAtTime = soilAtTime <= raw;

    const decisionLine = shouldWaterAtTime
      ? "✅ <b>BU VAQTDA SUG‘ORISH KERAK</b> (namlik RAWdan past yoki teng)"
      : "⏳ <b>BU VAQTDA SUG‘ORISH SHART EMAS</b> (namlik RAWdan yuqori)";

    timeDecisionHtml = `
      <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
      <div>${decisionLine}</div>
      <div>🕒 Tanlangan vaqt: <b>${times[idxAtTime]}</b></div>
      <div>🌱 Namlik: <b>${soilAtTime.toFixed(1)}%</b> | RAW: <b>${raw.toFixed(1)}%</b></div>
    `;
  }

  const rawWhenMsg = firstRawIdx >= 0
    ? `✅ RAW ga birinchi tushish vaqti: <b>${times[firstRawIdx]}</b> (Soil: ${soilPctUsed[firstRawIdx].toFixed(1)}%)`
    : "⏳ Bu kunda soil moisture RAW ga tushmadi (model bo‘yicha).";

  setStatus("");
  setSummary(`
    <div><b>Joylashuv:</b> lat=${lat.toFixed(6)}, lon=${lon.toFixed(6)}, alt=${alt.toFixed(1)} m</div>
    <div><b>Sana:</b> ${d} | <b>Soil manbasi:</b> ${soilSourceLabel}</div>
    <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
    <div><b>Kunlik ET0:</b> ${et0Day.toFixed(2)} mm/kun (${mmToM3PerHa(et0Day).toFixed(1)} m³/ga)</div>
    <div><b>Kunlik ETc (Kc=${kc.toFixed(2)}):</b> ${etcDay.toFixed(2)} mm/kun (${mmToM3PerHa(etcDay).toFixed(1)} m³/ga)</div>
    <div style="margin-top:10px;">${rawWhenMsg}</div>
    ${timeDecisionHtml}
  `);
}

document.getElementById("run").addEventListener("click", run);
initDateDefault();
