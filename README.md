# Irrigation Program (ET₀ / ETc / RAW based)

A web-based irrigation decision-support tool built on **Open-Meteo** weather and soil data.  
The application helps determine **whether irrigation is needed at a specific time**, based on **reference evapotranspiration (ET₀)**, **crop evapotranspiration (ETc)**, **soil moisture**, and a **user-defined RAW threshold**.

The tool is fully client-side and deployed via **GitHub Pages**.

---

## Features

- Location-based analysis using **latitude, longitude, and altitude**
- Uses **Open-Meteo Forecast and Archive APIs**
- Supports **past and current dates**
- Hourly and daily data visualization
- Calculates:
  - Reference evapotranspiration (**ET₀**)
  - Crop evapotranspiration (**ETc = Kc × ET₀**)
- Soil moisture handling:
  - Automatically fetched from Open-Meteo (modelled soil moisture)
  - Optional **manual soil moisture input**
- **RAW-based irrigation decision**
  - Indicates if irrigation is required **at a specific user-selected time**
  - Shows the first predicted time when soil moisture drops below RAW
- Outputs values in:
  - mm
  - m³/ha
  - percentage (%)

---

## How the Decision Logic Works

1. **ET₀** is obtained directly from Open-Meteo (FAO-56 standard).
2. **ETc** is calculated using the user-provided crop coefficient (**Kc**).
3. **Soil moisture** is either:
   - Taken from Open-Meteo (default), or
   - Manually entered by the user.
4. **RAW threshold (%)** defines the minimum acceptable soil moisture.
5. If a **time is provided**, the tool answers:
   - **“Should I irrigate at this time?”**
6. If no time is provided:
   - The tool does **not** make a “water now” decision
   - It only shows daily totals and the first RAW crossing time (if any)

---

## Inputs

| Parameter | Description |
|---------|------------|
| Latitude | Decimal degrees |
| Longitude | Decimal degrees |
| Altitude | Meters above sea level |
| Date | YYYY-MM-DD |
| Time (optional) | HH:MM |
| Kc | Crop coefficient |
| RAW (%) | Soil moisture threshold |
| Soil moisture (%) (optional) | Manual override |

---

## Outputs

- Hourly table (first 24 hours):
  - Soil moisture (%)
  - ET₀ (mm/h, m³/ha·h)
  - ETc (mm/h, m³/ha·h)
  - Precipitation
- Daily summary:
  - ET₀ and ETc totals
  - Daily precipitation and temperature
- Irrigation recommendation:
  - At selected time (if provided)
  - First predicted RAW crossing time

---

## Data Sources

- **Open-Meteo Forecast API**
- **Open-Meteo Archive API**
- FAO-56 reference evapotranspiration model

> ⚠️ Soil moisture values from Open-Meteo are **modelled grid-based estimates**, not sensor measurements.

---

## Limitations

- Not a replacement for soil sensors
- Model accuracy depends on:
  - Grid resolution
  - Soil depth assumptions
  - Crop parameter accuracy
- Intended as a **decision-support tool**, not an automated controller

---

## Deployment

The application is deployed using **GitHub Pages** and requires no backend.

Live demo:  
👉 https://egamberdiyevotabek.github.io/Irrigation-program/
