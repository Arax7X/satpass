import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../bin/satpass.js', import.meta.url))
const tle = fileURLToPath(new URL('./fixtures/iss.tle', import.meta.url))
const run = (...args) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } })

test('prints a table of passes', () => {
  const out = run('--tle', tle, '--lat', '51.5072', '--lon', '-0.1276', '--start', '2026-11-17T12:00:00Z', '--days', '1', '--mag', '-1.8', '--utc')
  assert.match(out, /ISS \(ZARYA\) {2}#25544/)
  assert.match(out, /51\.5072°N 0\.1276°W/)
  assert.match(out, /times in UTC/)
  assert.match(out, /Day +Rise +Highest +Set +Length +Naked eye/)
  assert.match(out, /Tue 17 Nov +17:34 +17:37 {2}46° SSE +17:40 +6m 27s +17:34–17:39 {2}mag -3\.4/)
})

test('--json prints the same passes as the library', () => {
  const out = JSON.parse(run('--tle', tle, '--lat', '51.5072', '--lon', '-0.1276', '--start', '2026-11-17T12:00:00Z', '--days', '1', '--json'))
  assert.equal(out.satellite.id, 25544)
  assert.ok(out.passes.length > 3)
  assert.ok(out.passes.every((p) => typeof p.rise.time === 'string' && 'visible' in p))
})

test('--visible lists only passes you can see', () => {
  const out = JSON.parse(run('--tle', tle, '--lat', '51.5072', '--lon', '-0.1276', '--start', '2026-11-17T12:00:00Z', '--visible', '--json'))
  assert.ok(out.passes.length > 0 && out.passes.every((p) => p.visible))
})

test('mistakes give a short message and exit code 1', () => {
  const missing = spawnSync(process.execPath, [bin, '25544'], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /--lat and --lon are required/)
  const bad = spawnSync(process.execPath, [bin, '--tle', tle, '--lat', 'north', '--lon', '0'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /--lat must be a number/)
})

test('--help and --version', () => {
  assert.match(run('--help'), /Usage: satpass <catalog-number>/)
  assert.match(run('--version'), /^\d+\.\d+\.\d+\n$/)
})
