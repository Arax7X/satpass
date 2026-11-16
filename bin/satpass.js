#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { getPasses, fetchTle, parseTle } from '../src/index.js'

const HELP = `Usage: satpass <catalog-number> --lat <degrees> --lon <degrees> [options]

When can you see a satellite? Lists its passes over you, and which ones you
can see with the naked eye. Orbit data comes from CelesTrak.

Options:
  --lat <degrees>     Your latitude, north positive
  --lon <degrees>     Your longitude, east positive
  --alt <metres>      Your height above sea level (default 0)
  --days <n>          How many days ahead to look (default 2)
  --start <time>      When to start, as an ISO 8601 time (default now)
  --min-el <degrees>  Lowest elevation that counts as a pass (default 10)
  --visible           Only list passes you can see with the naked eye
  --mag <magnitude>   The satellite's standard magnitude, to estimate brightness
  --tle <file>        Read orbit data (TLE or OMM JSON) from a file instead
  --utc               Show times in UTC instead of your time zone
  --json              Print the passes as JSON
  -h, --help          Show this help
  -v, --version       Show the version

Example:
  satpass 25544 --lat 51.5072 --lon -0.1276 --visible     ISS over London
`

const NUMERIC = new Set(['--lat', '--lon', '--alt', '--days', '--min-el', '--mag'])

// "--lon -0.1276" would otherwise read as an unknown option "-0.1276".
function joinNegativeValues(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    if (NUMERIC.has(argv[i]) && /^-\d|^-\.\d/.test(argv[i + 1] ?? '')) out.push(`${argv[i]}=${argv[++i]}`)
    else out.push(argv[i])
  }
  return out
}

function fail(message) {
  process.stderr.write(`satpass: ${message}\n`)
  process.exit(1)
}

function number(value, name) {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) fail(`--${name} must be a number, got "${value}"`)
  return n
}

let args
try {
  args = parseArgs({
    args: joinNegativeValues(process.argv.slice(2)),
    allowPositionals: true,
    options: {
      lat: { type: 'string' },
      lon: { type: 'string' },
      alt: { type: 'string' },
      days: { type: 'string' },
      start: { type: 'string' },
      'min-el': { type: 'string' },
      visible: { type: 'boolean' },
      mag: { type: 'string' },
      tle: { type: 'string' },
      utc: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
} catch (err) {
  fail(`${err.message}\nRun "satpass --help" for usage.`)
}
const { values: opt, positionals } = args

if (opt.help) {
  process.stdout.write(HELP)
  process.exit(0)
}
if (opt.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

const id = positionals[0]
if (!id && !opt.tle) fail('give a NORAD catalog number, for example 25544 for the ISS.\nRun "satpass --help" for usage.')
if (opt.lat === undefined || opt.lon === undefined) fail('--lat and --lon are required.')

const observer = { lat: number(opt.lat, 'lat'), lon: number(opt.lon, 'lon'), alt: number(opt.alt, 'alt') ?? 0 }
const stdMagnitude = number(opt.mag, 'mag')

let satellite
try {
  if (opt.tle) {
    const text = readFileSync(opt.tle, 'utf8')
    satellite = parseTle(text.trimStart().startsWith('{') || text.trimStart().startsWith('[')
      ? [JSON.parse(text)].flat()[0]
      : text)
  } else {
    satellite = await fetchTle(id)
  }
} catch (err) {
  fail(opt.tle ? err.message : `${err.message}\nYou can also read orbit data from a file with --tle <file>.`)
}

let passes
try {
  passes = getPasses(satellite, observer, {
    start: opt.start,
    days: number(opt.days, 'days') ?? 2,
    minElevation: number(opt['min-el'], 'min-el') ?? 10,
    visibleOnly: opt.visible,
    stdMagnitude,
  })
} catch (err) {
  fail(err.message)
}

if (opt.json) {
  process.stdout.write(`${JSON.stringify({ satellite: { name: satellite.name, id: satellite.id, epoch: satellite.epoch }, observer, passes }, null, 2)}\n`)
  process.exit(0)
}

const timeZone = opt.utc ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const stampFmt = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const hm = (d) => timeFmt.format(d)
const length = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
const coord = (v, pos, neg) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`

const ageDays = (Date.now() - satellite.epoch.getTime()) / 86400000
const lines = [
  `${satellite.name}  #${satellite.id}  ·  orbit data from ${stampFmt.format(satellite.epoch)}`,
  `From ${coord(observer.lat, 'N', 'S')} ${coord(observer.lon, 'E', 'W')}  ·  passes above ${number(opt['min-el'], 'min-el') ?? 10}°  ·  times in ${timeZone}`,
  '',
]
if (ageDays > 14) lines.splice(2, 0, `Note: this orbit data is ${Math.round(ageDays)} days old, so times may be off by minutes.`)

if (passes.length === 0) {
  lines.push(opt.visible ? '  No passes you can see in this period.' : '  No passes in this period.')
} else {
  const rows = [['Day', 'Rise', 'Highest', 'Set', 'Length', 'Naked eye']]
  for (const p of passes) {
    let seen = '–'
    if (p.visible) {
      const { start, end } = p.visibility
      const secs = Math.round((end.time - start.time) / 1000)
      seen = secs < 60 ? `${hm(start.time)} for ${secs}s` : `${hm(start.time)}–${hm(end.time)}`
      if (p.magnitude !== null) seen += `  mag ${p.magnitude.toFixed(1)}`
    }
    rows.push([
      dayFmt.format(p.rise.time),
      hm(p.rise.time),
      `${hm(p.peak.time)}  ${Math.round(p.peak.elevation)}° ${p.peak.direction}`,
      hm(p.set.time),
      length(p.duration),
      seen,
    ])
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  for (const r of rows) lines.push(`  ${r.map((c, i) => c.padEnd(widths[i])).join('   ').trimEnd()}`)
}
process.stdout.write(`${lines.join('\n')}\n`)
