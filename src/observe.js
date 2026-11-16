import {
  propagate, gstime, eciToEcf, ecfToEci, ecfToLookAngles, geodeticToEcf, eciToGeodetic,
  degreesLat, degreesLong, sunPos, shadowFraction, jday,
} from 'satellite.js'
import { parseTle } from './tle.js'
import { DEG, RAD, KM_PER_AU, compass, toMs, sub, dot, norm } from './util.js'

/** Normalise `{ lat, lon, alt }` (degrees, degrees, metres) and check it. */
export function makeObserver(observer) {
  if (!observer || typeof observer !== 'object') {
    throw new TypeError('observer must be an object like { lat: 51.5, lon: -0.13 }')
  }
  const lat = observer.lat ?? observer.latitude
  const lon = observer.lon ?? observer.lng ?? observer.longitude
  const alt = observer.alt ?? observer.altitude ?? 0
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError(`observer latitude must be between -90 and 90, got ${lat}`)
  if (!Number.isFinite(lon) || lon < -180 || lon > 360) throw new RangeError(`observer longitude must be between -180 and 180, got ${lon}`)
  if (!Number.isFinite(alt)) throw new RangeError(`observer altitude must be a number of metres, got ${alt}`)
  return { lat, lon, alt, gd: { latitude: lat * RAD, longitude: lon * RAD, height: alt / 1000 } }
}

/** Where the satellite is in the observer's sky at one instant, or null if SGP4 fails. */
export function lookAt(sat, obs, ms) {
  const date = new Date(ms)
  const pv = propagate(sat.satrec, date)
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return null
  const gmst = gstime(date)
  const look = ecfToLookAngles(obs.gd, eciToEcf(pv.position, gmst))
  return {
    ms,
    gmst,
    eci: pv.position,
    velocity: pv.velocity,
    azimuth: look.azimuth * DEG,
    elevation: look.elevation * DEG,
    rangeKm: look.rangeSat,
  }
}

/** Sunlight on the satellite and the Sun's height in the observer's sky. */
export function lighting(look, obs) {
  const sunAu = sunPos(jday(new Date(look.ms))).rsun
  const sunKm = { x: sunAu.x * KM_PER_AU, y: sunAu.y * KM_PER_AU, z: sunAu.z * KM_PER_AU }
  const shadow = shadowFraction(sunAu, look.eci)
  const sunElevation = ecfToLookAngles(obs.gd, eciToEcf(sunKm, look.gmst)).elevation * DEG
  // Sunlit while the centre of the Sun is not hidden behind the Earth.
  return { shadow, sunlit: shadow < 0.5, sunElevation, sunKm }
}

/**
 * Estimated visual magnitude (lower is brighter).
 *
 * `stdMagnitude` is the satellite's brightness at 1000 km when half lit.
 * `cosPhase` is the cosine of the Sun–satellite–observer angle, and
 * `sunVisible` the fraction of the Sun's disc the satellite can see (1 outside
 * the Earth's shadow). The satellite is treated as a sphere; the dimming of
 * the atmosphere near the horizon is ignored.
 */
export function brightness(stdMagnitude, rangeKm, cosPhase, sunVisible = 1) {
  const lit = (1 + cosPhase) / 2
  if (lit <= 1e-6 || sunVisible <= 0) return null
  return stdMagnitude - 15.75 +
    2.5 * Math.log10((rangeKm * rangeKm) / lit) -
    2.5 * Math.log10(sunVisible)
}

export function magnitude(stdMagnitude, look, light, obs) {
  if (!light.sunlit) return null
  const obsEci = ecfToEci(geodeticToEcf(obs.gd), look.gmst)
  const toSun = sub(light.sunKm, look.eci)
  const toObs = sub(obsEci, look.eci)
  const cosPhase = dot(toSun, toObs) / (norm(toSun) * norm(toObs))
  return brightness(stdMagnitude, look.rangeKm, cosPhase, 1 - light.shadow)
}

/**
 * Where a satellite is in the sky for an observer at one moment, whether it is
 * sunlit, and whether it can be seen with the naked eye.
 */
export function observe(satellite, observer, time = new Date(), options = {}) {
  const sat = parseTle(satellite)
  const obs = makeObserver(observer)
  const { maxSunElevation = -6, stdMagnitude } = options
  const ms = toMs(time, 'time')
  const look = lookAt(sat, obs, ms)
  if (!look) return null
  const light = lighting(look, obs)
  const result = {
    time: new Date(ms),
    azimuth: look.azimuth,
    elevation: look.elevation,
    direction: compass(look.azimuth),
    rangeKm: look.rangeKm,
    sunlit: light.sunlit,
    sunElevation: light.sunElevation,
    visible: look.elevation > 0 && light.sunlit && light.sunElevation <= maxSunElevation,
  }
  if (stdMagnitude !== undefined) {
    result.magnitude = look.elevation > 0 ? magnitude(stdMagnitude, look, light, obs) : null
  }
  return result
}

/** The point on Earth below the satellite, its altitude and its speed. */
export function getPosition(satellite, time = new Date()) {
  const sat = parseTle(satellite)
  const date = new Date(toMs(time, 'time'))
  const pv = propagate(sat.satrec, date)
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return null
  const gd = eciToGeodetic(pv.position, gstime(date))
  return {
    time: date,
    lat: degreesLat(gd.latitude),
    lon: degreesLong(gd.longitude),
    altKm: gd.height,
    speedKmS: norm(pv.velocity),
  }
}
