// ---------- util ----------
const $ = (id) => document.getElementById(id);

function mmToM3PerHa(mm) { return mm * 10.0; } // 1 mm = 10 m³/ga
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function setStatus(msg) { $("status").textContent = msg || ""; }

function setSummary(el, html, muted=false) {
  el.classList.toggle("muted", !!muted);
  el.innerHTML = html;
}

function clearTable(tbody) { tbody.innerHTML = ""; }

function addRow(tbody, cells) {
  const tr = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    td.textContent = c;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

// ---------- tabs ----------
function activateTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tabPanel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
}
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

// ---------- geolocation ----------
function detectLocation() {
  if (!navigator.geolocation) { setStatus("Brauzer joylashuvni qo‘llab-quvvatlamaydi."); return; }
  setStatus("Joylashuv aniqlanmoqda...");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const alt = pos.coords.altitude;

      $("api_lat").value = lat.toFixed(6);
      $("api_lon").value = lon.toFixed(6);
      $("m_lat").value = lat.toFixed(6);
      $("m_lon").value = lon.toFixed(6);

      if (alt !== null && Number.isFinite(alt)) {
        $("api_alt").value = alt.toFixed(1);
        $("m_alt").value = alt.toFixed(1);
      }
      setStatus("Joylashuv aniqlandi.");
    },
    () => setStatus("Joylashuvni aniqlab bo‘lmadi (ruxsat berilmadi yoki xato)."),
    { enableHighAccuracy:true, timeout: 10000, maximumAge: 60000 }
  );
}

// ---------- Open-Meteo ----------
function endpointForDate(dStr) {
  const today = new Date();
  const d = new Date(dStr + "T00:00:00");
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return d < t0
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";
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
  throw new Error("Tuproq namligi o‘zgaruvchisi topilmadi.");
}

async function fetchApi(lat, lon, alt, dStr) {
  const base = endpointForDate(dStr);
  const isArchive = base.includes("archive-api");
  const soilVar = isArchive ? "soil_moisture_7_to_28cm" : "soil_moisture_9_to_27cm";

  const hourly = ["et0_fao_evapotranspiration","precipitation",soilVar].join(",");
  const daily  = ["precipitation_sum","temperature_2m_max","temperature_2m_min","shortwave_radiation_sum"].join(",");

  const url = new URL(base);
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("elevation", alt);
  url.searchParams.set("start_date", dStr);
  url.searchParams.set("end_date", dStr);
  url.searchParams.set("hourly", hourly);
  url.searchParams.set("daily", daily);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API xatosi: HTTP ${res.status}`);
  return await res.json();
}

// ---------- Manual FAO-56 PM (hourly) ----------
function wind10to2(u10) {
  return u10 * 4.87 / Math.log(67.8*10 - 5.42);
}
function es_kpa(Tc) { return 0.6108 * Math.exp((17.27*Tc)/(Tc+237.3)); }
function delta_kpa_per_c(Tc) {
  const e = es_kpa(Tc);
  return 4098.0 * e / Math.pow(Tc+237.3, 2);
}
function gamma_kpa_per_c(P_kpa) { return 0.000665 * P_kpa; }
function wpm2_to_mjpm2h(w) { return w * 3600.0 / 1_000_000.0; }

// Solar geometry bits (FAO-56 style)
const GSC = 0.0820;               // MJ m-2 min-1
const SIGMA_H = 4.903e-9 / 24.0;  // MJ K-4 m-2 h-1

function dayOfYear(dt) {
  const start = new Date(dt.getFullYear(), 0, 0);
  return Math.floor((dt - start) / (1000*60*60*24));
}
function solarDeclination(J) { return 0.409 * Math.sin(2*Math.PI*J/365 - 1.39); }
function invRelDistES(J) { return 1 + 0.033 * Math.cos(2*Math.PI*J/365); }
function seasonalCorrection(J) {
  const B = 2*Math.PI*(J - 81)/364;
  return 0.1645*Math.sin(2*B) - 0.1255*Math.cos(B) - 0.025*Math.sin(B);
}
function hourAngle(solarTimeHours) { return Math.PI/12.0 * (solarTimeHours - 12.0); }
function sunsetHourAngle(phi, delta) {
  let x = -Math.tan(phi)*Math.tan(delta);
  x = Math.max(-1, Math.min(1, x));
  return Math.acos(x);
}
function extraterrestrialRaHourly(localISO, latDeg, lonDeg, tzHours) {
  const dt = new Date(localISO);
  const J = dayOfYear(dt);
  const dr = invRelDistES(J);
  const delta = solarDeclination(J);
  const phi = latDeg * Math.PI/180.0;
  const ws = sunsetHourAngle(phi, delta);

  const midpoint = dt.getHours() + dt.getMinutes()/60.0;
  const Lz = tzHours * 15.0;
  const Sc = seasonalCorrection(J);
  const TcMin = 4.0*(lonDeg - Lz) + 60.0*Sc;
  const solar_t = midpoint + TcMin/60.0;

  const t1 = solar_t - 0.5;
  const t2 = solar_t + 0.5;

  const w1 = hourAngle(t1);
  const w2 = hourAngle(t2);

  const w1l = Math.max(-ws, Math.min(ws, w1));
  const w2l = Math.max(-ws, Math.min(ws, w2));
  if (w1l >= w2l) return 0.0;

  const Ra = (12*60/Math.PI) * GSC * dr *
    ((w2l - w1l)*Math.sin(phi)*Math.sin(delta) +
     Math.cos(phi)*Math.cos(delta)*(Math.sin(w2l) - Math.sin(w1l)));

  return Math.max(0.0, Ra);
}

function computeEt0HourlyPM({localISO, lat, lon, alt, tzHours, T, RH, u10, P_hPa, Rs_W}) {
  const Tc = T;
  const u2 = wind10to2(u10);
  const P_kpa = P_hPa / 10.0;
  const Rs = wpm2_to_mjpm2h(Rs_W);

  const es = es_kpa(Tc);
  const ea = es * RH / 100.0;
  const vpd = Math.max(0.0, es - ea);

  const Delta = delta_kpa_per_c(Tc);
  const gamma = gamma_kpa_per_c(P_kpa);

  const Ra = extraterrestrialRaHourly(localISO, lat, lon, tzHours);
  const Rso = Ra > 0 ? (0.75 + 2e-5*alt) * Ra : 0.0;

  const albedo = 0.23;
  const Rns = (1 - albedo) * Rs;

  let f_cloud = 0.05;
  if (Rso > 0) {
    f_cloud = 1.35 * Math.min(Rs / Rso, 1.0) - 0.35;
    f_cloud = Math.max(0.05, Math.min(1.0, f_cloud));
  }

  const Tk = Tc + 273.15;
  const Rnl = SIGMA_H * Math.pow(Tk,4) * (0.34 - 0.14*Math.sqrt(Math.max(ea, 0.0))) * f_cloud;
  const Rn = Rns - Rnl;

  const G = (Rs > 0) ? 0.1*Rn : 0.5*Rn;

  const num = 0.408*Delta*(Rn - G) + gamma*(37.0/(Tc + 273.0))*u2*vpd;
  const den = Delta + gamma*(1.0 + 0.34*u2);

  const et0 = (den !== 0) ? Math.max(0.0, num/den) : 0.0;
  return { et0 };
}

function tzHoursFromBrowser() {
  return -new Date().getTimezoneOffset() / 60.0;
}

// ---------- State for report/PDF ----------
const STATE = { api: null, manual: null };

// ---------- API RUN ----------
async function runApi() {
  try {
    setStatus("API ma’lumotlari olinmoqda...");
    clearTable($("api_hourlyTable").querySelector("tbody"));
    clearTable($("api_dailyTable").querySelector("tbody"));
    setSummary($("api_summary"), "Yuklanmoqda...", true);

    const lat = parseFloat($("api_lat").value);
    const lon = parseFloat($("api_lon").value);
    const alt = parseFloat($("api_alt").value);
    const d = $("api_date").value;
    const t = ($("api_time").value || "").trim();
    const kc = parseFloat($("api_kc").value);
    const raw = clamp(parseFloat($("api_raw").value), 0, 100);

    const soilManualStr = ($("api_soilManual").value || "").trim();
    const soilManual = soilManualStr === "" ? null : clamp(parseFloat(soilManualStr), 0, 100);

    if (!d) { setStatus(""); setSummary($("api_summary"), "Sana tanlanmagan.", false); return; }

    const data = await fetchApi(lat, lon, alt, d);
    const h = data.hourly;
    if (!h || !h.time) throw new Error("Soatlik ma’lumot kelmadi.");

    const times = h.time;
    const et0 = h.et0_fao_evapotranspiration.map(Number);
    const etc = et0.map(x => x * kc);
    const rain = (h.precipitation || Array(et0.length).fill(0)).map(Number);

    const soilKey = pickSoilKey(h);
    const soilPctApi = h[soilKey].map(x => Number(x)*100.0);
    const soilPct = (soilManual !== null) ? Array(times.length).fill(soilManual) : soilPctApi;
    const soilSource = (soilManual !== null) ? `Manual (${soilManual.toFixed(1)}%)` : `${soilKey} (API model)`;

    const tbH = $("api_hourlyTable").querySelector("tbody");
    for (let i=0; i<Math.min(24, times.length); i++) {
      addRow(tbH, [
        times[i],
        soilPct[i].toFixed(1),
        et0[i].toFixed(3),
        etc[i].toFixed(3),
        mmToM3PerHa(et0[i]).toFixed(2),
        mmToM3PerHa(etc[i]).toFixed(2),
        rain[i].toFixed(2),
      ]);
    }

    const tbD = $("api_dailyTable").querySelector("tbody");
    if (data.daily && data.daily.time && data.daily.time.length) {
      addRow(tbD, [
        data.daily.time[0],
        (data.daily.precipitation_sum?.[0] ?? "").toString(),
        (data.daily.temperature_2m_max?.[0] ?? "").toString(),
        (data.daily.temperature_2m_min?.[0] ?? "").toString(),
        (data.daily.shortwave_radiation_sum?.[0] ?? "").toString(),
      ]);
    }

    const et0Day = et0.reduce((a,b)=>a+b, 0);
    const etcDay = etc.reduce((a,b)=>a+b, 0);

    let firstRawIdx = -1;
    for (let i=0; i<times.length; i++) { if (soilPct[i] <= raw) { firstRawIdx=i; break; } }
    const rawMsg = (firstRawIdx>=0)
      ? `✅ RAW ga birinchi tushish vaqti: <b>${times[firstRawIdx]}</b> (Soil: ${soilPct[firstRawIdx].toFixed(1)}%)`
      : "⏳ Bu kunda tuproq namligi RAW ga tushmadi (model bo‘yicha).";

    // time decision only if time entered
    let timeDecision = "";
    if (t) {
      const target = `${d}T${t}`;
      let idx = times.findIndex(ts => ts >= target);
      if (idx === -1) idx = times.length - 1;
      const soilAt = soilPct[idx];
      const should = soilAt <= raw;

      timeDecision = `
        <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
        <div>${should ? "✅ <b>BU VAQTDA SUG‘ORISH KERAK</b>" : "⏳ <b>BU VAQTDA SUG‘ORISH SHART EMAS</b>"}</div>
        <div>🕒 Tanlangan vaqt: <b>${times[idx]}</b></div>
        <div>🌱 Namlik: <b>${soilAt.toFixed(1)}%</b> | RAW: <b>${raw.toFixed(1)}%</b></div>
      `;
    }

    const summaryHtml = `
      <div><b>Joylashuv:</b> lat=${lat.toFixed(6)}, lon=${lon.toFixed(6)}, alt=${alt.toFixed(1)} m</div>
      <div><b>Sana:</b> ${d} | <b>Soil manbasi:</b> ${soilSource}</div>
      <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
      <div><b>Kunlik ET0:</b> ${et0Day.toFixed(2)} mm/kun (${mmToM3PerHa(et0Day).toFixed(1)} m³/ga)</div>
      <div><b>Kunlik ETc (Kc=${kc.toFixed(2)}):</b> ${etcDay.toFixed(2)} mm/kun (${mmToM3PerHa(etcDay).toFixed(1)} m³/ga)</div>
      <div style="margin-top:10px;">${rawMsg}</div>
      ${timeDecision}
    `;

    setSummary($("api_summary"), summaryHtml, false);
    setStatus("");

    STATE.api = {
      inputs: { lat, lon, alt, d, t, kc, raw, soilSource },
      hourlyRows12: times.slice(0, 12).map((tm, i) => ({ time: tm, soil: soilPct[i], et0: et0[i], etc: etc[i] })),
      totals: { et0Day, etcDay },
      rawMsg
    };

  } catch (e) {
    setStatus("");
    setSummary($("api_summary"), `Xatolik: ${e.message}`, false);
  }
}

// ---------- Manual mode UI ----------
let MANUAL_MODE = "snapshot";

function setManualMode(mode) {
  MANUAL_MODE = mode;
  $("modeSnapshot").classList.toggle("active", mode==="snapshot");
  $("modeSeries").classList.toggle("active", mode==="series");
  $("snapshotBox").classList.toggle("hidden", mode!=="snapshot");
  $("seriesBox").classList.toggle("hidden", mode!=="series");
}

function seriesAddRow(row) {
  const tb = $("seriesTable").querySelector("tbody");
  const tr = document.createElement("tr");
  const cols = ["time","T","RH","u10","P","Rs","cloud","soil"];

  for (const c of cols) {
    const td = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = (row && row[c] !== undefined) ? row[c] : "";
    inp.style.width = "100%";
    inp.style.background = "#0b0d10";
    inp.style.border = "1px solid #243047";
    inp.style.color = "#e9eef5";
    inp.style.borderRadius = "10px";
    inp.style.padding = "8px";
    inp.dataset.col = c;
    td.appendChild(inp);
    tr.appendChild(td);
  }
  tb.appendChild(tr);
}

function getSeriesRows() {
  const tb = $("seriesTable").querySelector("tbody");
  const rows = [];
  for (const tr of tb.querySelectorAll("tr")) {
    const obj = {};
    tr.querySelectorAll("input").forEach(inp => obj[inp.dataset.col] = inp.value.trim());
    if (obj.time) rows.push(obj);
  }
  return rows;
}

function make24Hours(dateStr) {
  const tb = $("seriesTable").querySelector("tbody");
  tb.innerHTML = "";
  for (let h=0; h<24; h++) {
    const hh = String(h).padStart(2,"0");
    seriesAddRow({ time: `${dateStr}T${hh}:00`, T:"0", RH:"0", u10:"0", P:"0", Rs:"0", cloud:"0", soil:"" });
  }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(s=>s.trim());
  const rows = [];
  for (let i=1; i<lines.length; i++) {
    const parts = lines[i].split(",").map(s=>s.trim());
    const obj = {};
    header.forEach((h, idx)=> obj[h] = parts[idx] ?? "");
    rows.push(obj);
  }
  return rows.map(r => ({
    time: r.time || r.datetime || r.dt || "",
    T: r.T ?? r.temp ?? r.temperature ?? "",
    RH: r.RH ?? r.relative_humidity ?? "",
    u10: r.u10 ?? r.wind_speed_10m ?? "",
    P: r.P ?? r.pressure ?? r.surface_pressure ?? "",
    Rs: r.Rs ?? r.shortwave_radiation ?? "",
    cloud: r.cloud ?? r.cloud_cover ?? "",
    soil: r.soil ?? r.soil_moisture ?? r.soil_pct ?? ""
  })).filter(r => r.time);
}

function renderManualHourlyTable(rows) {
  const tb = $("m_hourlyTable").querySelector("tbody");
  tb.innerHTML = "";
  for (let i=0; i<Math.min(24, rows.length); i++) {
    const r = rows[i];
    addRow(tb, [
      r.time,
      r.soil.toFixed(1),
      r.et0.toFixed(3),
      r.etc.toFixed(3),
      mmToM3PerHa(r.et0).toFixed(2),
      mmToM3PerHa(r.etc).toFixed(2),
    ]);
  }
}

function manualBaseInputs() {
  const lat = parseFloat($("m_lat").value);
  const lon = parseFloat($("m_lon").value);
  const alt = parseFloat($("m_alt").value);
  const d = $("m_date").value;
  const t = ($("m_time").value || "").trim();
  const kc = parseFloat($("m_kc").value);
  const raw = clamp(parseFloat($("m_raw").value), 0, 100);
  const soil = clamp(parseFloat($("m_soil").value), 0, 100);

  if (!d) throw new Error("Manual: sana tanlanmagan.");
  if (!t) throw new Error("Manual: vaqt kiritilmagan.");
  return { lat, lon, alt, d, t, kc, raw, soil };
}

function runManualSnapshot() {
  try {
    setStatus("Manual snapshot hisoblanmoqda...");
    setSummary($("m_summary"), "Hisoblanmoqda...", true);
    $("m_hourlyTable").querySelector("tbody").innerHTML = "";

    const base = manualBaseInputs();
    const timeISO = `${base.d}T${base.t}`;
    const tz = tzHoursFromBrowser();

    const T = parseFloat($("s_T").value);
    const RH = parseFloat($("s_RH").value);
    const u10 = parseFloat($("s_u10").value);
    const P = parseFloat($("s_P").value);
    const Rs = parseFloat($("s_Rs").value);

    const out = computeEt0HourlyPM({
      localISO: timeISO, lat: base.lat, lon: base.lon, alt: base.alt, tzHours: tz,
      T, RH, u10, P_hPa: P, Rs_W: Rs
    });

    const et0 = out.et0;
    const etc = base.kc * et0;
    const should = base.soil <= base.raw;

    const summaryHtml = `
      <div><b>Manual (snapshot)</b></div>
      <div><b>Joylashuv:</b> lat=${base.lat.toFixed(6)}, lon=${base.lon.toFixed(6)}, alt=${base.alt.toFixed(1)} m</div>
      <div><b>Sana/Vaqt:</b> ${timeISO}</div>
      <div><b>Kc:</b> ${base.kc.toFixed(2)} | <b>RAW:</b> ${base.raw.toFixed(1)}% | <b>Soil:</b> ${base.soil.toFixed(1)}%</div>
      <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
      <div><b>ET0:</b> ${et0.toFixed(3)} mm/soat (${mmToM3PerHa(et0).toFixed(2)} m³/ga·soat)</div>
      <div><b>ETc:</b> ${etc.toFixed(3)} mm/soat (${mmToM3PerHa(etc).toFixed(2)} m³/ga·soat)</div>
      <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
      <div>${should ? "✅ <b>BU VAQTDA SUG‘ORISH KERAK</b>" : "⏳ <b>BU VAQTDA SUG‘ORISH SHART EMAS</b>"}</div>
    `;

    setSummary($("m_summary"), summaryHtml, false);
    renderManualHourlyTable([{ time: timeISO, soil: base.soil, et0, etc }]);
    setStatus("");

    STATE.manual = {
      mode: "snapshot",
      inputs: base,
      hourlyRows12: [{ time: timeISO, soil: base.soil, et0, etc }],
      totals: { et0Day: et0, etcDay: etc }, // snapshot: 1 soatlik natija sifatida
      decision: { time: timeISO, should }
    };

  } catch (e) {
    setStatus("");
    setSummary($("m_summary"), `Xatolik: ${e.message}`, false);
  }
}

function runManualSeries() {
  try {
    setStatus("Manual series hisoblanmoqda...");
    setSummary($("m_summary"), "Hisoblanmoqda...", true);
    $("m_hourlyTable").querySelector("tbody").innerHTML = "";

    const base = manualBaseInputs();
    const tz = tzHoursFromBrowser();
    const rowsIn = getSeriesRows();
    if (!rowsIn.length) throw new Error("Series jadvali bo‘sh.");

    const calcRows = rowsIn.map(r => {
      const time = r.time;
      const T = parseFloat(r.T);
      const RH = parseFloat(r.RH);
      const u10 = parseFloat(r.u10);
      const P = parseFloat(r.P);
      const Rs = parseFloat(r.Rs);
      if (![T,RH,u10,P,Rs].every(Number.isFinite)) throw new Error(`Series: qiymatlar noto‘g‘ri (time=${time}).`);

      const out = computeEt0HourlyPM({
        localISO: time, lat: base.lat, lon: base.lon, alt: base.alt, tzHours: tz,
        T, RH, u10, P_hPa: P, Rs_W: Rs
      });

      const et0 = out.et0;
      const etc = base.kc * et0;
      const soil = (r.soil && Number.isFinite(parseFloat(r.soil))) ? clamp(parseFloat(r.soil), 0, 100) : base.soil;

      return { time, soil, et0, etc };
    });

    const et0Day = calcRows.reduce((a,b)=>a+b.et0, 0);
    const etcDay = calcRows.reduce((a,b)=>a+b.etc, 0);

    const target = `${base.d}T${base.t}`;
    let idx = calcRows.findIndex(rr => rr.time >= target);
    if (idx === -1) idx = calcRows.length - 1;
    const soilAt = calcRows[idx].soil;
    const should = soilAt <= base.raw;

    const summaryHtml = `
      <div><b>Manual (series)</b></div>
      <div><b>Joylashuv:</b> lat=${base.lat.toFixed(6)}, lon=${base.lon.toFixed(6)}, alt=${base.alt.toFixed(1)} m</div>
      <div><b>Sana:</b> ${base.d} | <b>Tekshiruv vaqti:</b> ${calcRows[idx].time}</div>
      <div><b>Kc:</b> ${base.kc.toFixed(2)} | <b>RAW:</b> ${base.raw.toFixed(1)}% | <b>Soil:</b> ${soilAt.toFixed(1)}%</div>
      <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
      <div><b>Σ ET0:</b> ${et0Day.toFixed(2)} mm/kun (${mmToM3PerHa(et0Day).toFixed(1)} m³/ga)</div>
      <div><b>Σ ETc:</b> ${etcDay.toFixed(2)} mm/kun (${mmToM3PerHa(etcDay).toFixed(1)} m³/ga)</div>
      <hr style="border:0;border-top:1px solid #243047;margin:10px 0;">
      <div>${should ? "✅ <b>BU VAQTDA SUG‘ORISH KERAK</b>" : "⏳ <b>BU VAQTDA SUG‘ORISH SHART EMAS</b>"}</div>
    `;

    setSummary($("m_summary"), summaryHtml, false);
    renderManualHourlyTable(calcRows);
    setStatus("");

    STATE.manual = {
      mode: "series",
      inputs: base,
      hourlyRows12: calcRows.slice(0, 12),
      totals: { et0Day, etcDay },
      decision: { time: calcRows[idx].time, should }
    };

  } catch (e) {
    setStatus("");
    setSummary($("m_summary"), `Xatolik: ${e.message}`, false);
  }
}

// ---------- Report + PDF ----------
function buildReportPreview() {
  const api = STATE.api;
  const man = STATE.manual;

  if (!api && !man) {
    setSummary($("reportPreview"), "Avval API yoki Manual hisoblashni bajaring.", false);
    return;
  }

  const lines = [];
  lines.push(`<div><b>API:</b> ${api ? "mavjud" : "mavjud emas"}</div>`);
  lines.push(`<div><b>Manual:</b> ${man ? "mavjud" : "mavjud emas"}</div>`);

  if (api) lines.push(`<div>API ΣET0=${api.totals.et0Day.toFixed(2)} mm, ΣETc=${api.totals.etcDay.toFixed(2)} mm</div>`);
  if (man) lines.push(`<div>Manual (${man.mode}) ΣET0=${man.totals.et0Day.toFixed(2)} mm, ΣETc=${man.totals.etcDay.toFixed(2)} mm</div>`);

  if (api && man) {
    const dEt0 = man.totals.et0Day - api.totals.et0Day;
    const dEtc = man.totals.etcDay - api.totals.etcDay;
    lines.push(`<hr style="border:0;border-top:1px solid #243047;margin:10px 0;">`);
    lines.push(`<div><b>Farq (Manual - API):</b> ET0=${dEt0.toFixed(2)} mm, ETc=${dEtc.toFixed(2)} mm</div>`);
  }

  setSummary($("reportPreview"), lines.join(""), false);
}

function fillPdfReportDom() {
  const api = STATE.api;
  const man = STATE.manual;

  const now = new Date();
  $("reportMeta").innerHTML = `
    <div><b>Yaratilgan:</b> ${now.toLocaleString()}</div>
    <div><b>Manba:</b> Brauzer + API + Manual</div>
  `;

  $("reportApiBlock").innerHTML = api ? `
    <div><b>Joylashuv:</b> lat=${api.inputs.lat.toFixed(6)}, lon=${api.inputs.lon.toFixed(6)}, alt=${api.inputs.alt.toFixed(1)} m</div>
    <div><b>Sana:</b> ${api.inputs.d}</div>
    <div><b>Kc:</b> ${api.inputs.kc.toFixed(2)} | <b>RAW:</b> ${api.inputs.raw.toFixed(1)}%</div>
    <div><b>Soil:</b> ${api.inputs.soilSource}</div>
    <div style="margin-top:8px;"><b>Σ ET0:</b> ${api.totals.et0Day.toFixed(2)} mm (${mmToM3PerHa(api.totals.et0Day).toFixed(1)} m³/ga)</div>
    <div><b>Σ ETc:</b> ${api.totals.etcDay.toFixed(2)} mm (${mmToM3PerHa(api.totals.etcDay).toFixed(1)} m³/ga)</div>
    <div style="margin-top:8px;">${api.rawMsg.replaceAll("<b>","").replaceAll("</b>","")}</div>
  ` : `<div>API natijalari mavjud emas.</div>`;

  $("reportManualBlock").innerHTML = man ? `
    <div><b>Rejim:</b> ${man.mode}</div>
    <div><b>Joylashuv:</b> lat=${man.inputs.lat.toFixed(6)}, lon=${man.inputs.lon.toFixed(6)}, alt=${man.inputs.alt.toFixed(1)} m</div>
    <div><b>Sana:</b> ${man.inputs.d} | <b>Vaqt:</b> ${man.inputs.t}</div>
    <div><b>Kc:</b> ${man.inputs.kc.toFixed(2)} | <b>RAW:</b> ${man.inputs.raw.toFixed(1)}% | <b>Soil:</b> ${man.inputs.soil.toFixed(1)}%</div>
    <div style="margin-top:8px;"><b>Σ ET0:</b> ${man.totals.et0Day.toFixed(2)} mm (${mmToM3PerHa(man.totals.et0Day).toFixed(1)} m³/ga)</div>
    <div><b>Σ ETc:</b> ${man.totals.etcDay.toFixed(2)} mm (${mmToM3PerHa(man.totals.etcDay).toFixed(1)} m³/ga)</div>
    <div style="margin-top:8px;"><b>Qaror:</b> ${man.decision.should ? "SUG‘ORISH KERAK" : "SUG‘ORISH SHART EMAS"} (${man.decision.time})</div>
  ` : `<div>Manual natijalari mavjud emas.</div>`;

  let compare = `<div>Taqqoslash uchun API va Manual natijalari kerak.</div>`;
  if (api && man) {
    const dEt0 = man.totals.et0Day - api.totals.et0Day;
    const dEtc = man.totals.etcDay - api.totals.etcDay;
    compare = `
      <div><b>Farq (Manual - API):</b></div>
      <div>ET0: ${dEt0.toFixed(2)} mm (${mmToM3PerHa(dEt0).toFixed(1)} m³/ga)</div>
      <div>ETc: ${dEtc.toFixed(2)} mm (${mmToM3PerHa(dEtc).toFixed(1)} m³/ga)</div>
    `;
  }
  $("reportCompareBlock").innerHTML = compare;

  const apiTb = $("reportApiTable").querySelector("tbody");
  apiTb.innerHTML = "";
  if (api) api.hourlyRows12.forEach(r => addRow(apiTb, [r.time, r.soil.toFixed(1), r.et0.toFixed(3), r.etc.toFixed(3)]));

  const manTb = $("reportManualTable").querySelector("tbody");
  manTb.innerHTML = "";
  if (man) man.hourlyRows12.forEach(r => addRow(manTb, [r.time, r.soil.toFixed(1), r.et0.toFixed(3), r.etc.toFixed(3)]));
}

async function downloadPdf() {
  if (typeof window.html2pdf === "undefined") {
    setStatus("PDF xatosi: html2pdf kutubxonasi yuklanmadi. Sahifani yangilang yoki internetni tekshiring.");
    return;
  }

  fillPdfReportDom();

  const node = $("reportPdf");
  node.classList.remove("hidden");

  const filename = `Sugorish_Hisoboti_${new Date().toISOString().slice(0,10)}.pdf`;

  const opt = {
    margin: 10,
    filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
  };

  try {
    setStatus("PDF tayyorlanmoqda...");

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      // Mobile-friendly: generate blob and open in new tab
      const worker = window.html2pdf().set(opt).from(node);
      const pdf = await worker.outputPdf("blob");

      const url = URL.createObjectURL(pdf);
      const w = window.open(url, "_blank");

      if (!w) {
        // If popup blocked, show a fallback link
        setStatus("PDF ochilmadi (popup blok). Pastdagi havolani bosing.");
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.textContent = "PDF ni ochish";
        link.style.display = "inline-block";
        link.style.marginTop = "10px";
        $("reportPreview").appendChild(document.createElement("br"));
        $("reportPreview").appendChild(link);
      } else {
        setStatus("PDF yangi oynada ochildi. Saqlash/ulashish tugmasidan foydalaning.");
      }

      // Don't revoke immediately; mobile needs time to load it
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      // Desktop: direct download
      await window.html2pdf().set(opt).from(node).save();
      setStatus("");
    }
  } catch (e) {
    setStatus(`PDF xato: ${e.message}`);
  } finally {
    node.classList.add("hidden");
  }
}

// ---------- events ----------
$("locate").addEventListener("click", detectLocation);

$("runApi").addEventListener("click", async () => { await runApi(); });

$("modeSnapshot").addEventListener("click", () => setManualMode("snapshot"));
$("modeSeries").addEventListener("click", () => setManualMode("series"));

$("runManualSnapshot").addEventListener("click", runManualSnapshot);
$("runManualSeries").addEventListener("click", runManualSeries);

$("add24").addEventListener("click", () => {
  const d = $("m_date").value;
  if (!d) { setStatus("Avval manual sanani tanlang."); return; }
  make24Hours(d);
  setStatus("24 soatlik jadval yaratildi.");
});

$("loadCsv").addEventListener("click", () => {
  const txt = ($("csvPaste").value || "").trim();
  if (!txt) { setStatus("CSV bo‘sh."); return; }
  const rows = parseCsv(txt);
  const tb = $("seriesTable").querySelector("tbody");
  tb.innerHTML = "";
  rows.forEach(r => seriesAddRow(r));
  setStatus(`CSV yuklandi: ${rows.length} qator`);
});

$("buildReport").addEventListener("click", () => {
  buildReportPreview();
  fillPdfReportDom();
  setStatus("Hisobot yangilandi.");
});

$("downloadPdf").addEventListener("click", downloadPdf);

// defaults
setManualMode("snapshot");
activateTab("api");
setSummary($("api_summary"), "Hisoblash uchun ma’lumotlarni kiriting.", true);
setSummary($("m_summary"), "Manual hisoblashni bajaring.", true);
setSummary($("reportPreview"), "Hisobotni ko‘rish uchun “Hisobotni yangilash” tugmasini bosing.", true);
