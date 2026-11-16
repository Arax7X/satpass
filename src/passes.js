import { parseTle } from './tle.js'
import { makeObserver, lookAt, lighting, magnitude } from './observe.js'
import { compass, toMs } from './util.js'

const DAY = 86400000
const TIME_TOLERANCE = 100 // ms: rise, peak and set are found to a tenth of a second
const EDGE_TOLERANCE = 250 // ms: start and end of the naked-eye window
const SEARCH_OUTSIDE = DAY // how far past the window to look for a rise or set

/**
 * Predict the passes of a satellite over an observer.
 *
 * A pass starts when the satellite climbs above `minElevation` and ends when it
 * drops below it again. Passes already under way at `start` are included, so
 * `rise.time` can be earlier than `start`.
 */
export function getPasses(satellite, observer, options = {}) {
  const sat = parseTle(satellite)
  const obs = makeObserver(observer)
  const {
    minElevation = 10,
    maxSunElevation = -6,
    visibleOnly = false,
    stdMagnitude,
    stepSeconds = 30,
    limit = Infinity,
  } = options
  if (!Number.isFinite(minElevation) || minElevation < -90 || minElevation >= 90) {
    throw new RangeError(`minElevation must be between -90 and 90 degrees, got ${minElevation}`)
  }
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0 || stepSeconds > 600) {
    throw new RangeError(`stepSeconds must be between 0 and 600, got ${stepSeconds}`)
  }
  const start = toMs(options.start, 'start') ?? Date.now()
  const end = toMs(options.end, 'end') ?? start + (options.days ?? 1) * DAY
  if (!(end > start)) throw new RangeError('end must be after start')
  const step = stepSeconds * 1000

  const elevation = (ms) => lookAt(sat, obs, ms)?.elevation ?? -90
  const isUp = (e) => e >= minElevation

  // Time where elevation crosses minElevation between a and b.
  const crossing = (a, b) => {
    const upAtA = isUp(elevation(a))
    while (b - a > TIME_TOLERANCE) {
      const m = (a + b) / 2
      if (isUp(elevation(m)) === upAtA) a = m
      else b = m
    }
    return Math.round((a + b) / 2)
  }

  // Time of highest elevation between a and b (golden-section search).
  const highest = (a, b) => {
    const g = (Math.sqrt(5) - 1) / 2
    let c = b - g * (b - a)
    let d = a + g * (b - a)
    let ec = elevation(c)
    let ed = elevation(d)
    while (b - a > TIME_TOLERANCE) {
      if (ec > ed) {
        b = d; d = c; ed = ec
        c = b - g * (b - a); ec = elevation(c)
      } else {
        a = c; c = d; ec = ed
        d = a + g * (b - a); ed = elevation(d)
      }
    }
    return Math.round((a + b) / 2)
  }

  const passes = []
  const add = (rise, roughPeak, set) => {
    if (set <= start || rise >= end || passes.length >= limit) return
    const peak = highest(Math.max(rise, roughPeak - step), Math.min(set, roughPeak + step))
    const pass = describe(sat, obs, rise, peak, set, { maxSunElevation, stdMagnitude })
    if (!visibleOnly || pass.visible) passes.push(pass)
  }

  let prevT = start
  let prevE = elevation(start)
  let beforeE = elevation(start - step)
  let open = null // the pass we are inside: { rise, best, bestE }

  if (isUp(prevE)) {
    // Already above minElevation at the start: walk back to find the rise.
    let t = start
    let e = prevE
    open = { rise: null, best: t, bestE: e }
    while (isUp(e) && start - t < SEARCH_OUTSIDE) {
      t -= step
      e = elevation(t)
      if (e > open.bestE) { open.best = t; open.bestE = e }
    }
    // Up for a whole day (for example a geostationary satellite): it never
    // rises or sets, so there are no passes to report.
    if (isUp(e)) return []
    open.rise = crossing(t, t + step)
  }

  while (passes.length < limit) {
    const t = prevT + step
    const e = elevation(t)
    if (open) {
      if (e > open.bestE) { open.best = t; open.bestE = e }
      if (!isUp(e)) {
        add(open.rise, open.best, crossing(prevT, t))
        open = null
      } else if (t - end > SEARCH_OUTSIDE) {
        break // never set again: nothing more to report
      }
    } else if (isUp(e)) {
      if (t > end + step) break
      open = { rise: crossing(prevT, t), best: t, bestE: e }
    } else if (prevE >= beforeE && prevE >= e && !isUp(beforeE) && prevE > minElevation - 10) {
      // A peak between samples that might poke briefly above minElevation.
      const peak = highest(prevT - step, t)
      if (isUp(elevation(peak))) add(crossing(prevT - step, peak), peak, crossing(peak, t))
    }
    if (!open && t >= end) break
    beforeE = prevE
    prevE = e
    prevT = t
  }
  return passes
}

function point(sat, obs, ms) {
  const look = lookAt(sat, obs, ms)
  return {
    time: new Date(ms),
    azimuth: look.azimuth,
    elevation: look.elevation,
    direction: compass(look.azimuth),
    rangeKm: look.rangeKm,
  }
}

// Fill in one pass: the three key points, when it can be seen, and how bright it gets.
function describe(sat, obs, rise, peak, set, { maxSunElevation, stdMagnitude }) {
  const canSee = (ms) => {
    const look = lookAt(sat, obs, ms)
    if (!look) return false
    const light = lighting(look, obs)
    return light.sunlit && light.sunElevation <= maxSunElevation
  }
  const edge = (a, b) => {
    const atA = canSee(a)
    while (b - a > EDGE_TOLERANCE) {
      const m = (a + b) / 2
      if (canSee(m) === atA) a = m
      else b = m
    }
    return Math.round((a + b) / 2)
  }

  // Sample the pass and find every stretch in which it can be seen.
  const sampleStep = Math.min(10000, Math.max(1000, (set - rise) / 40))
  const windows = []
  let from = canSee(rise) ? rise : null
  let prev = rise
  let prevSeen = from !== null
  for (let t = rise + sampleStep; ; t += sampleStep) {
    const ms = Math.min(t, set)
    const seen = canSee(ms)
    if (seen !== prevSeen) {
      const at = edge(prev, ms)
      if (seen) from = at
      else windows.push([from, at])
    }
    prev = ms
    prevSeen = seen
    if (ms === set) break
  }
  if (prevSeen) windows.push([from, set])

  const pass = {
    rise: point(sat, obs, rise),
    peak: point(sat, obs, peak),
    set: point(sat, obs, set),
    duration: Math.round((set - rise) / 1000),
    visible: windows.length > 0,
    visibility: null,
    magnitude: null,
  }
  if (!pass.visible) return pass

  const [vStart, vEnd] = windows.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
  pass.visibility = { start: point(sat, obs, vStart), end: point(sat, obs, vEnd) }

  if (stdMagnitude !== undefined) {
    let best = null
    const times = [vStart, vEnd]
    for (let t = vStart; t < vEnd; t += 2000) times.push(t)
    if (peak > vStart && peak < vEnd) times.push(peak)
    for (const ms of times) {
      const look = lookAt(sat, obs, ms)
      const mag = magnitude(stdMagnitude, look, lighting(look, obs), obs)
      if (mag !== null && (best === null || mag < best.magnitude)) best = { ms, magnitude: mag }
    }
    if (best) {
      pass.magnitude = best.magnitude
      pass.brightest = { ...point(sat, obs, best.ms), magnitude: best.magnitude }
    }
  }
  return pass
}
