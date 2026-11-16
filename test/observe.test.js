import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sunPos } from 'satellite.js'
import { observe, getPosition, getPasses, parseTle, compass } from '../src/index.js'
import { brightness } from '../src/observe.js'

const tles = JSON.parse(readFileSync(new URL('./fixtures/tles.json', import.meta.url))).satellites
const iss = parseTle(tles['25544'])
const london = { lat: 51.5072, lon: -0.1276 }

test('observe agrees with the peak of a predicted pass', () => {
  const [p] = getPasses(iss, london, { start: '2026-11-17T17:00:00Z', days: 1, visibleOnly: true })
  const o = observe(iss, london, p.peak.time)
  assert.ok(Math.abs(o.elevation - p.peak.elevation) < 1e-9)
  assert.ok(Math.abs(o.azimuth - p.peak.azimuth) < 1e-9)
  assert.equal(o.direction, p.peak.direction)
})

test('observe reports sunlight and naked-eye visibility', () => {
  const [p] = getPasses(iss, london, { start: '2026-11-17T17:00:00Z', days: 1, visibleOnly: true })
  const during = observe(iss, london, p.visibility.start.time.getTime() + 5000, { stdMagnitude: -1.8 })
  assert.equal(during.visible, true)
  assert.equal(during.sunlit, true)
  assert.ok(during.sunElevation <= -6)
  assert.equal(typeof during.magnitude, 'number')
  const below = observe(iss, london, p.set.time.getTime() + 20 * 60000, { stdMagnitude: -1.8 })
  assert.ok(below.elevation < 0)
  assert.equal(below.visible, false)
  assert.equal(below.magnitude, null)
})

test('getPosition gives the ground point, height and speed of the ISS', () => {
  const pos = getPosition(iss, '2026-11-16T20:31:00Z')
  assert.ok(Math.abs(pos.lat) <= 51.7, 'within the orbit inclination')
  assert.ok(pos.lon >= -180 && pos.lon <= 180)
  assert.ok(pos.altKm > 380 && pos.altKm < 450, `altitude ${pos.altKm}`)
  assert.ok(pos.speedKmS > 7.5 && pos.speedKmS < 7.8, `speed ${pos.speedKmS}`)
})

test('brightness follows the standard magnitude definition', () => {
  // At 1000 km and half lit the estimate is the standard magnitude itself.
  assert.ok(Math.abs(brightness(-1.8, 1000, 0) - -1.8) < 0.01)
  // Twice as far is four times fainter: 2.5 * log10(4) = 1.5 magnitudes.
  assert.ok(Math.abs(brightness(-1.8, 2000, 0) - brightness(-1.8, 1000, 0) - 1.505) < 0.001)
  // Fully lit (Sun behind the observer) is brighter than half lit.
  assert.ok(brightness(-1.8, 1000, 1) < brightness(-1.8, 1000, 0))
  // Half the Sun hidden by the Earth makes it 0.75 magnitudes fainter.
  assert.ok(Math.abs(brightness(-1.8, 1000, 0, 0.5) - brightness(-1.8, 1000, 0) - 0.753) < 0.001)
  assert.equal(brightness(-1.8, 1000, -1), null) // lit side faces away
  assert.equal(brightness(-1.8, 1000, 0, 0), null) // in full shadow
})

test('the Sun position used for daylight is accurate to 0.01°', () => {
  // Meeus, Astronomical Algorithms, example 25.a: 1992 October 13, 0h TD.
  const { rtasc, decl } = sunPos(2448908.5)
  const ra = ((rtasc * 180) / Math.PI + 360) % 360
  assert.ok(Math.abs(ra - 198.38083) < 0.01, `right ascension ${ra}`)
  assert.ok(Math.abs((decl * 180) / Math.PI - -7.78507) < 0.01, `declination ${(decl * 180) / Math.PI}`)
})

test('compass directions', () => {
  assert.equal(compass(0), 'N')
  assert.equal(compass(359), 'N')
  assert.equal(compass(22.5), 'NNE')
  assert.equal(compass(90), 'E')
  assert.equal(compass(200), 'SSW')
  assert.equal(compass(-90), 'W')
})
