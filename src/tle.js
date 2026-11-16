import { twoline2satrec, json2satrec, alpha5ToNumber } from 'satellite.js'

/**
 * The checksum digit a TLE line should end with: the sum of its digits,
 * counting each minus sign as 1, modulo 10.
 */
export function tleChecksum(line) {
  let sum = 0
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48
    else if (ch === '-') sum += 1
  }
  return sum % 10
}

function checkLine(line, n, verifyChecksum) {
  if (typeof line !== 'string' || !line.startsWith(`${n} `)) {
    throw new SyntaxError(`TLE line ${n} should start with "${n} "`)
  }
  if (line.length !== 69) {
    throw new SyntaxError(`TLE line ${n} is ${line.length} characters long; it should be 69`)
  }
  if (verifyChecksum) {
    const expected = tleChecksum(line)
    if (Number(line[68]) !== expected) {
      throw new SyntaxError(
        `TLE line ${n} fails its checksum (ends in ${line[68]}, expected ${expected}). ` +
        'It was probably copied incompletely.',
      )
    }
  }
}

function makeSatellite(name, id, satrec) {
  const jd = satrec.jdsatepoch + (satrec.jdsatepochF ?? 0)
  return {
    name: name || String(id),
    id,
    epoch: new Date(Math.round((jd - 2440587.5) * 86400000)),
    satrec,
  }
}

function fromLines(name, line1, line2, verifyChecksum) {
  checkLine(line1, 1, verifyChecksum)
  checkLine(line2, 2, verifyChecksum)
  if (line1.slice(2, 7) !== line2.slice(2, 7)) {
    throw new SyntaxError(
      `TLE lines 1 and 2 belong to different satellites (${line1.slice(2, 7).trim()} and ${line2.slice(2, 7).trim()})`,
    )
  }
  const satrec = twoline2satrec(line1, line2)
  if (satrec.error) throw new Error(`SGP4 could not initialise this TLE (error code ${satrec.error})`)
  const cleanName = name?.replace(/^0 /, '').trim()
  return makeSatellite(cleanName, alpha5ToNumber(line1.slice(2, 7)), satrec)
}

function fromOmm(omm) {
  const satrec = json2satrec(omm)
  if (satrec.error) throw new Error(`SGP4 could not initialise this OMM record (error code ${satrec.error})`)
  return makeSatellite(omm.OBJECT_NAME?.trim(), Number(omm.NORAD_CAT_ID), satrec)
}

const isSatellite = (x) => x && typeof x === 'object' && x.satrec && 'id' in x && x.epoch instanceof Date

/**
 * Read orbit data in any of the usual forms and return a satellite object
 * `{ name, id, epoch, satrec }` that the other functions accept.
 *
 * Accepts a TLE as text (2 or 3 lines), as an array of lines, or as
 * `{ name, line1, line2 }`; a CelesTrak OMM JSON record; a satellite.js satrec;
 * or a satellite object returned by this function.
 */
export function parseTle(input, { verifyChecksum = true } = {}) {
  if (isSatellite(input)) return input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if ('MEAN_MOTION' in input && 'NORAD_CAT_ID' in input) return fromOmm(input)
    if ('line1' in input && 'line2' in input) {
      return fromLines(input.name, input.line1.trim(), input.line2.trim(), verifyChecksum)
    }
    if ('satnum' in input && 'jdsatepoch' in input) {
      return makeSatellite(undefined, alpha5ToNumber(String(input.satnum)), input)
    }
    throw new TypeError('Expected TLE text, { line1, line2 }, an OMM record or a satrec')
  }
  if (typeof input !== 'string' && !Array.isArray(input)) {
    throw new TypeError('Expected TLE text, { line1, line2 }, an OMM record or a satrec')
  }
  const lines = (Array.isArray(input) ? input : input.split(/\r?\n/))
    .map((l) => String(l).trim())
    .filter((l) => l !== '')
  if (lines.length === 2) return fromLines(undefined, lines[0], lines[1], verifyChecksum)
  if (lines.length === 3) return fromLines(lines[0], lines[1], lines[2], verifyChecksum)
  throw new SyntaxError(`Expected a TLE of 2 or 3 lines, got ${lines.length}`)
}

/**
 * Download the latest orbit data for one satellite from CelesTrak, by its
 * NORAD catalog number (25544 is the ISS).
 *
 * CelesTrak sends no CORS headers, so in a browser point `baseUrl` at your
 * own proxy. Please cache the result: CelesTrak updates each satellite at
 * most a few times a day and blocks clients that download too often.
 */
export async function fetchTle(id, { baseUrl = 'https://celestrak.org', fetch: fetchFn = globalThis.fetch, signal } = {}) {
  if (!/^\d{1,9}$/.test(String(id))) throw new TypeError(`Not a NORAD catalog number: ${id}`)
  if (typeof fetchFn !== 'function') throw new Error('No fetch() available; pass one in options.fetch')
  const url = `${baseUrl.replace(/\/+$/, '')}/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`
  let res
  try {
    res = await fetchFn(url, { signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error(`Could not reach CelesTrak (${err.message}). Check your internet connection.`, { cause: err })
  }
  if (!res.ok) throw new Error(`CelesTrak answered HTTP ${res.status} for satellite ${id}`)
  const text = (await res.text()).trim()
  if (!text || /no gp data found/i.test(text)) throw new Error(`CelesTrak has no orbit data for satellite ${id}`)
  return parseTle(text)
}
