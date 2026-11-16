// Checks satpass against passes computed independently with Skyfield
// (scripts/skyfield_reference.py), for four satellites over five cities.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getPasses, parseTle } from '../src/index.js'

const tles = JSON.parse(readFileSync(new URL('./fixtures/tles.json', import.meta.url))).satellites
const ref = JSON.parse(readFileSync(new URL('./fixtures/skyfield-passes.json', import.meta.url)))
const start = Date.parse(ref.start)
const end = start + ref.days * 86400000
const seconds = (date, iso) => Math.abs(date.getTime() - Date.parse(iso)) / 1000

for (const c of ref.cases) {
  const name = `${tles[c.satellite].name} over ${c.observer.name}`
  test(`matches Skyfield: ${name}`, () => {
    const ours = getPasses(parseTle(tles[c.satellite]), c.observer, {
      start,
      end,
      minElevation: ref.minElevation,
      maxSunElevation: ref.maxSunElevation,
    }).filter((p) => p.rise.time >= start && p.set.time <= end) // the reference has only whole passes

    assert.equal(ours.length, c.passes.length, 'number of passes')
    c.passes.forEach((r, i) => {
      const p = ours[i]
      const at = `pass ${i + 1} (${r.peak})`
      assert.ok(seconds(p.rise.time, r.rise) < 1, `${at}: rise ${p.rise.time.toISOString()} vs ${r.rise}`)
      assert.ok(seconds(p.set.time, r.set) < 1, `${at}: set ${p.set.time.toISOString()} vs ${r.set}`)
      assert.ok(seconds(p.peak.time, r.peak) < 1, `${at}: peak ${p.peak.time.toISOString()} vs ${r.peak}`)
      assert.ok(Math.abs(p.peak.elevation - r.peakElevation) < 0.02, `${at}: peak elevation ${p.peak.elevation} vs ${r.peakElevation}`)
      assert.equal(p.visible, r.visibility !== null, `${at}: visible`)
      if (r.visibility) {
        // Skyfield's window is sampled once a second.
        assert.ok(seconds(p.visibility.start.time, r.visibility.start) < 2, `${at}: visible from`)
        assert.ok(seconds(p.visibility.end.time, r.visibility.end) < 2, `${at}: visible until`)
      }
    })
  })
}

test('a coarse search step still finds every pass', () => {
  for (const c of ref.cases.slice(0, 8)) {
    const passes = getPasses(parseTle(tles[c.satellite]), c.observer, {
      start, end, minElevation: ref.minElevation, stepSeconds: 120,
    }).filter((p) => p.rise.time >= start && p.set.time <= end)
    assert.equal(passes.length, c.passes.length, `${c.satellite} over ${c.observer.name}`)
  }
})
