import type { SatRec, OMMJsonObject } from 'satellite.js'

/** A satellite ready for the other functions, as returned by `parseTle`. */
export interface Satellite {
  /** Name from the TLE's title line, or the catalog number if there is none. */
  name: string
  /** NORAD catalog number. */
  id: number
  /** When the orbit data was measured. Predictions get less accurate as this ages. */
  epoch: Date
  /** The satellite.js record used for SGP4 propagation. */
  satrec: SatRec
}

/** Anything `parseTle` accepts. */
export type SatelliteInput =
  | string
  | readonly string[]
  | { name?: string; line1: string; line2: string }
  | OMMJsonObject
  | SatRec
  | Satellite

/** Where you are. Latitude and longitude in degrees, altitude in metres. */
export interface Observer {
  lat?: number
  lon?: number
  /** Height above sea level in metres. Default 0. */
  alt?: number
  latitude?: number
  longitude?: number
  lng?: number
  altitude?: number
}

export type DateInput = Date | number | string

/** A position in the observer's sky. */
export interface SkyPoint {
  time: Date
  /** Degrees clockwise from north: 0 = N, 90 = E. */
  azimuth: number
  /** Degrees above the horizon. */
  elevation: number
  /** 16-point compass direction such as "NNE". */
  direction: string
  /** Distance from the observer in kilometres. */
  rangeKm: number
}

export interface Pass {
  /** When it climbs above `minElevation`. Can be before `start` for a pass already under way. */
  rise: SkyPoint
  /** Its highest point. */
  peak: SkyPoint
  /** When it drops below `minElevation`. */
  set: SkyPoint
  /** Seconds from rise to set. */
  duration: number
  /** True when part of the pass is sunlit while your sky is dark. */
  visible: boolean
  /** The longest stretch you can see it with the naked eye, or null. */
  visibility: { start: SkyPoint; end: SkyPoint } | null
  /** Brightest estimated magnitude while visible; null without `stdMagnitude` or when not visible. */
  magnitude: number | null
  /** Where and when it is brightest. Present when `magnitude` is a number. */
  brightest?: SkyPoint & { magnitude: number }
}

export interface PassOptions {
  /** Start of the search. Default now. */
  start?: DateInput
  /** End of the search. Default `start` plus `days`. */
  end?: DateInput
  /** Days to search when `end` is not given. Default 1. */
  days?: number
  /** Lowest elevation in degrees that counts as a pass. Default 10. */
  minElevation?: number
  /** The sky counts as dark when the Sun is below this elevation. Default -6 (end of civil twilight). */
  maxSunElevation?: number
  /** Only return passes you can see with the naked eye. Default false. */
  visibleOnly?: boolean
  /** The satellite's standard magnitude (at 1000 km, half lit), to estimate brightness. */
  stdMagnitude?: number
  /** Search step in seconds; passes are then refined to 0.1 s. Default 30. */
  stepSeconds?: number
  /** Stop after this many passes. */
  limit?: number
}

export interface Observation extends SkyPoint {
  /** True when the satellite is in sunlight. */
  sunlit: boolean
  /** The Sun's elevation for the observer, in degrees. */
  sunElevation: number
  /** Above the horizon, sunlit, and the sky is dark. */
  visible: boolean
  /** Estimated magnitude, when `stdMagnitude` is given; null when not lit or below the horizon. */
  magnitude?: number | null
}

export interface Position {
  time: Date
  /** Latitude of the point below the satellite, in degrees. */
  lat: number
  /** Longitude of the point below the satellite, in degrees. */
  lon: number
  /** Height above the Earth's surface in kilometres. */
  altKm: number
  /** Speed in kilometres per second. */
  speedKmS: number
}

export function getPasses(satellite: SatelliteInput, observer: Observer, options?: PassOptions): Pass[]

export function observe(
  satellite: SatelliteInput,
  observer: Observer,
  time?: DateInput,
  options?: { maxSunElevation?: number; stdMagnitude?: number },
): Observation | null

export function getPosition(satellite: SatelliteInput, time?: DateInput): Position | null

export function parseTle(input: SatelliteInput, options?: { verifyChecksum?: boolean }): Satellite

export function fetchTle(
  id: number | string,
  options?: { baseUrl?: string; fetch?: typeof fetch; signal?: AbortSignal },
): Promise<Satellite>

export function tleChecksum(line: string): number

export function compass(azimuth: number): string
