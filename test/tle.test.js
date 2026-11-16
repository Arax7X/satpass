import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseTle, tleChecksum, fetchTle, getPosition } from '../src/index.js'

const { name, line1, line2 } = JSON.parse(readFileSync(new URL('./fixtures/tles.json', import.meta.url))).satellites['25544']

test('reads a three-line TLE', () => {
  const sat = parseTle(`${name}\n${line1}\n${line2}\n`)
  assert.equal(sat.name, 'ISS (ZARYA)')
  assert.equal(sat.id, 25544)
  assert.equal(sat.epoch.toISOString(), '2026-11-16T13:27:14.699Z')
  assert.equal(sat.satrec.satnum, '25544')
})

test('reads two lines, Windows line endings, indentation, arrays and objects', () => {
  assert.equal(parseTle(`${line1}\n${line2}`).name, '25544')
  assert.equal(parseTle(`  ${name}\r\n  ${line1}\r\n  ${line2}\r\n`).name, 'ISS (ZARYA)')
  assert.equal(parseTle([name, line1, line2]).id, 25544)
  assert.equal(parseTle({ name, line1, line2 }).name, 'ISS (ZARYA)')
  assert.equal(parseTle(`0 ${name}\n${line1}\n${line2}`).name, 'ISS (ZARYA)')
})

test('a parsed satellite and a raw satrec are passed through', () => {
  const sat = parseTle({ name, line1, line2 })
  assert.equal(parseTle(sat), sat)
  assert.equal(parseTle(sat.satrec).id, 25544)
})

test('checksums are verified', () => {
  assert.equal(tleChecksum(line1), Number(line1[68]))
  assert.equal(tleChecksum(line2), Number(line2[68]))
  const broken = line1.slice(0, 20) + (line1[20] === '1' ? '2' : '1') + line1.slice(21)
  assert.throws(() => parseTle([broken, line2]), /line 1 fails its checksum/)
  assert.doesNotThrow(() => parseTle([broken, line2], { verifyChecksum: false }))
})

test('malformed input is rejected with a clear message', () => {
  assert.throws(() => parseTle(line1), /2 or 3 lines/)
  assert.throws(() => parseTle([line2, line1]), /should start with "1 "/)
  assert.throws(() => parseTle([line1.slice(0, 60), line2]), /69/)
  const other = JSON.parse(readFileSync(new URL('./fixtures/tles.json', import.meta.url))).satellites['20580']
  assert.throws(() => parseTle([line1, other.line2]), /different satellites/)
  assert.throws(() => parseTle(42), TypeError)
  assert.throws(() => parseTle({ foo: 1 }), TypeError)
})

test('an OMM record gives the same orbit as the TLE', () => {
  const omm = {
    OBJECT_NAME: 'ISS (ZARYA)',
    OBJECT_ID: '1998-067A',
    EPOCH: '2026-11-16T13:27:14.698656',
    MEAN_MOTION: 15.49415609,
    ECCENTRICITY: 0.000739,
    INCLINATION: 51.632,
    RA_OF_ASC_NODE: 266.0553,
    ARG_OF_PERICENTER: 32.4819,
    MEAN_ANOMALY: 327.6623,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: 25544,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 59537,
    BSTAR: 0.0001776,
    MEAN_MOTION_DOT: 0.00009493,
    MEAN_MOTION_DDOT: 0,
  }
  const fromOmm = parseTle(omm)
  const fromTle = parseTle({ name, line1, line2 })
  assert.equal(fromOmm.name, 'ISS (ZARYA)')
  assert.equal(fromOmm.id, 25544)
  const when = '2026-11-17T13:00:00Z'
  const a = getPosition(fromOmm, when)
  const b = getPosition(fromTle, when)
  assert.ok(Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lon - b.lon) < 1e-3, 'same place')
  assert.ok(Math.abs(a.altKm - b.altKm) < 0.01, 'same height')
})

test('fetchTle asks CelesTrak for one satellite and parses the answer', async () => {
  let asked
  const fetch = async (url) => {
    asked = url
    return { ok: true, status: 200, text: async () => `${name.padEnd(24)}\r\n${line1}\r\n${line2}\r\n` }
  }
  const sat = await fetchTle(25544, { fetch })
  assert.equal(asked, 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE')
  assert.equal(sat.name, 'ISS (ZARYA)')
  await fetchTle('25544', { fetch, baseUrl: 'https://example.org/proxy/' })
  assert.equal(asked, 'https://example.org/proxy/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE')
})

test('fetchTle explains what went wrong', async () => {
  const answer = (status, body) => async () => ({ ok: status === 200, status, text: async () => body })
  await assert.rejects(fetchTle(99999999, { fetch: answer(200, 'No GP data found') }), /no orbit data for satellite 99999999/)
  await assert.rejects(fetchTle(25544, { fetch: answer(403, '') }), /HTTP 403/)
  await assert.rejects(fetchTle(25544, { fetch: async () => { throw new TypeError('fetch failed') } }), /Could not reach CelesTrak/)
  await assert.rejects(fetchTle('ISS'), /Not a NORAD catalog number/)
})
