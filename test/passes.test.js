import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getPasses, parseTle } from '../src/index.js'

const tles = JSON.parse(readFileSync(new URL('./fixtures/tles.json', import.meta.url))).satellites
const iss = parseTle(tles['25544'])
const goes = parseTle(tles['41866'])
const london = { lat: 51.5072, lon: -0.1276 }
const START = '2026-11-16T12:00:00Z'

test('each pass has rise, peak and set in order, with sensible values', () => {
  const passes = getPasses(iss, london, { start: START, days: 3 })
  assert.ok(passes.length > 5)
  for (const p of passes) {
    assert.ok(p.rise.time < p.peak.time && p.peak.time < p.set.time)
    assert.ok(Math.abs(p.rise.elevation - 10) < 0.05, `rise elevation ${p.rise.elevation}`)
    assert.ok(Math.abs(p.set.elevation - 10) < 0.05, `set elevation ${p.set.elevation}`)
    assert.ok(p.peak.elevation >= 10 && p.peak.elevation <= 90)
    assert.equal(p.duration, Math.round((p.set.time - p.rise.time) / 1000))
    assert.match(p.peak.direction, /^[NESW]{1,3}$/)
    assert.ok(p.peak.rangeKm > 400 && p.peak.rangeKm < 2000)
  }
  for (let i = 1; i < passes.length; i++) assert.ok(passes[i].rise.time > passes[i - 1].set.time)
})

test('a pass already under way at the start is included, with its real rise', () => {
  const all = getPasses(iss, london, { start: START, days: 1 })
  const p = all[2]
  const mid = new Date((p.rise.time.getTime() + p.set.time.getTime()) / 2)
  const [first] = getPasses(iss, london, { start: mid, days: 1 })
  assert.ok(first.rise.time < mid)
  assert.ok(Math.abs(first.rise.time - p.rise.time) < 500)
  assert.ok(Math.abs(first.set.time - p.set.time) < 500)
})

test('minElevation changes what counts as a pass', () => {
  const low = getPasses(iss, london, { start: START, days: 2, minElevation: 0 })
  const high = getPasses(iss, london, { start: START, days: 2, minElevation: 40 })
  assert.ok(low.length > high.length)
  for (const p of high) assert.ok(p.peak.elevation >= 40)
  for (const p of low) assert.ok(Math.abs(p.rise.elevation) < 0.05)
})

test('visibleOnly keeps only passes you can see, and limit caps the list', () => {
  const visible = getPasses(iss, london, { start: START, days: 3, visibleOnly: true })
  assert.ok(visible.length > 0)
  for (const p of visible) {
    assert.equal(p.visible, true)
    assert.ok(p.visibility.start.time >= p.rise.time && p.visibility.end.time <= p.set.time)
  }
  assert.equal(getPasses(iss, london, { start: START, days: 3, limit: 2 }).length, 2)
})

test('brightness is estimated when a standard magnitude is given', () => {
  const passes = getPasses(iss, london, { start: START, days: 3, visibleOnly: true, stdMagnitude: -1.8 })
  for (const p of passes) {
    assert.equal(typeof p.magnitude, 'number')
    assert.ok(p.magnitude > -6 && p.magnitude < 5, `magnitude ${p.magnitude}`)
    assert.equal(p.brightest.magnitude, p.magnitude)
    assert.ok(p.brightest.time >= p.visibility.start.time && p.brightest.time <= p.visibility.end.time)
  }
  const [plain] = getPasses(iss, london, { start: START, days: 3, visibleOnly: true })
  assert.equal(plain.magnitude, null)
})

test('a geostationary satellite never rises or sets', () => {
  assert.deepEqual(getPasses(goes, { lat: -0.18, lon: -78.47 }, { start: START, days: 2 }), []) // always up
  assert.deepEqual(getPasses(goes, { lat: -33.87, lon: 151.21 }, { start: START, days: 2 }), []) // never up
})

test('a satellite that never comes up gives no passes', () => {
  assert.deepEqual(getPasses(iss, { lat: 89, lon: 0 }, { start: START, days: 2 }), [])
})

test('bad options are rejected with a clear message', () => {
  assert.throws(() => getPasses(iss, { lat: 100, lon: 0 }), /latitude/)
  assert.throws(() => getPasses(iss, { lon: 0 }), /latitude/)
  assert.throws(() => getPasses(iss, london, { start: START, end: '2026-11-15T00:00:00Z' }), /end must be after start/)
  assert.throws(() => getPasses(iss, london, { minElevation: 95 }), /minElevation/)
  assert.throws(() => getPasses(iss, london, { stepSeconds: 0 }), /stepSeconds/)
  assert.throws(() => getPasses(iss, london, { start: 'not a date' }), /start is not a valid date/)
})

test('observer altitude and coordinate aliases are accepted', () => {
  const a = getPasses(iss, london, { start: START, days: 1 })
  const b = getPasses(iss, { latitude: 51.5072, longitude: -0.1276, altitude: 0 }, { start: START, days: 1 })
  assert.deepEqual(a.map((p) => p.rise.time.getTime()), b.map((p) => p.rise.time.getTime()))
  const high = getPasses(iss, { ...london, alt: 3000 }, { start: START, days: 1 })
  assert.equal(high.length, a.length)
})
