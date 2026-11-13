import { hasPhonePowers, phone } from './device'

// ----------------------------------------------------------------------------
// Leo weather — free Open-Meteo (no key). Location = the city the user named,
// else the phone's approximate location (Android app), else the browser's.
// Returns a compact text summary for Leo to speak about.
// ----------------------------------------------------------------------------

const CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'fog', 48: 'fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
}

/** fetch with a hard timeout — a slow network must never freeze Leo */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    return r.ok ? await r.json() as T : null
  } catch { return null }
}

async function coords(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  if (city.trim()) {
    const j = await getJson<{ results?: { latitude: number; longitude: number; name: string; admin1?: string }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&language=en`)
    const g = j?.results?.[0]
    return g ? { lat: g.latitude, lon: g.longitude, name: [g.name, g.admin1].filter(Boolean).join(', ') } : null
  }
  if (hasPhonePowers()) {
    const p = await phone('location', {}, 8000) as { ok: boolean; lat?: number; lon?: number }
    if (p.ok && typeof p.lat === 'number' && typeof p.lon === 'number') return { lat: p.lat, lon: p.lon, name: 'your location' }
  }
  // the Android WebView has no geolocation prompt — only use it in a real browser,
  // and never wait more than 7 s (a permission prompt can otherwise hang forever)
  if (!hasPhonePowers() && 'geolocation' in navigator) {
    const pos = await Promise.race([
      new Promise<GeolocationPosition | null>((res) =>
        navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 6000, maximumAge: 30 * 60_000 })),
      new Promise<null>((res) => setTimeout(() => res(null), 7000)),
    ])
    if (pos) return { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'your location' }
  }
  return null
}

export async function weatherSummary(city = ''): Promise<string> {
  const c = await coords(city)
  if (!c) return city ? `I couldn't find a place called ${city}.` : "I couldn't get your location — tell me the city."
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3'
  const j = await getJson<{
    current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number }
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] }
  }>(url)
  if (!j?.current || !j.daily) return "The weather service isn't answering right now — try again in a minute."
  const cur = j.current
  const d = j.daily
  const day = (i: number) => `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.time[i]}: ${CODES[d.weather_code[i]] ?? 'mixed'}, ` +
    `${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])}°C, rain chance ${d.precipitation_probability_max[i] ?? 0}%`
  return `Weather for ${c.name}. Now: ${Math.round(cur.temperature_2m)}°C (feels ${Math.round(cur.apparent_temperature)}°C), ` +
    `${CODES[cur.weather_code] ?? 'mixed'}, humidity ${cur.relative_humidity_2m}%, wind ${Math.round(cur.wind_speed_10m)} km/h. ` +
    [0, 1, 2].map(day).join('. ')
}
