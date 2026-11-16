export const DEG = 180 / Math.PI
export const RAD = Math.PI / 180
export const KM_PER_AU = 149597870.7

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** Turn an azimuth in degrees (0 = north, 90 = east) into a 16-point compass direction. */
export function compass(azimuth) {
  const a = ((azimuth % 360) + 360) % 360
  return POINTS[Math.round(a / 22.5) % 16]
}

/** Accept a Date, a millisecond timestamp or a date string; return milliseconds. */
export function toMs(value, name) {
  if (value === undefined || value === null) return undefined
  const ms = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : Date.parse(value)
  if (!Number.isFinite(ms)) throw new TypeError(`${name} is not a valid date: ${value}`)
  return ms
}

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
export const norm = (a) => Math.sqrt(dot(a, a))
