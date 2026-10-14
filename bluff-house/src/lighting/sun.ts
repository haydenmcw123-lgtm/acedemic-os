/**
 * NOAA solar position (the NOAA Solar Calculator spreadsheet algorithm).
 * Accurate to well under a minute for sunrise/sunset in this century.
 */
const rad = Math.PI / 180, deg = 180 / Math.PI;

export interface SunState {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon (refraction-corrected). */
  elevation: number;
  /** Unit vector toward the sun in world space (+x east, −z north, +y up). */
  dir: [number, number, number];
}

export interface SunDay { sunrise: number; solarNoon: number; sunset: number }

function core(jd: number) {
  const jc = (jd - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(M * rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(obliq * rad) * Math.sin(appLong * rad)) * deg;
  const y = Math.tan((obliq / 2) * rad) ** 2;
  const eqTime = 4 * deg * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  return { decl, eqTime };
}

/** Sun position at local clock `hour` (e.g. 17.75) on a date, for a site with a fixed UTC offset in hours (EDT = −4). */
export function sunPosition(year: number, month: number, day: number, hour: number, lat: number, lon: number, utcOffset: number): SunState {
  const ms = Date.UTC(year, month - 1, day) + (hour - utcOffset) * 3600_000;
  const jd = ms / 86400_000 + 2440587.5;
  const { decl, eqTime } = core(jd);
  const minutesLocal = hour * 60;
  const tst = (((minutesLocal + eqTime + 4 * lon - 60 * utcOffset) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const cz = Math.sin(lat * rad) * Math.sin(decl * rad) + Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(ha * rad);
  const zen = Math.acos(Math.max(-1, Math.min(1, cz))) * deg;
  const elev0 = 90 - zen;
  // atmospheric refraction (NOAA)
  let refr = 0;
  if (elev0 <= 85) {
    const te = Math.tan(elev0 * rad);
    if (elev0 > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev0 > -0.575) refr = 1735 + elev0 * (-518.2 + elev0 * (103.4 + elev0 * (-12.79 + elev0 * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  const elevation = elev0 + refr;
  const acosArg = (Math.sin(lat * rad) * Math.cos(zen * rad) - Math.sin(decl * rad)) / (Math.cos(lat * rad) * Math.sin(zen * rad));
  const a = Math.acos(Math.max(-1, Math.min(1, acosArg))) * deg;
  const azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  const az = azimuth * rad, el = elevation * rad;
  return { azimuth, elevation, dir: [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)] };
}

/** Sunrise, solar noon and sunset as local clock hours. */
export function sunDay(year: number, month: number, day: number, lat: number, lon: number, utcOffset: number): SunDay {
  // evaluate the ephemeris at local noon, then refine once at each event
  const at = (h: number) => core(Date.UTC(year, month - 1, day) / 86400_000 + 2440587.5 + (h - utcOffset) / 24);
  const solve = (h: number, sign: -1 | 0 | 1) => {
    const { decl, eqTime } = at(h);
    const noon = (720 - 4 * lon - eqTime + utcOffset * 60) / 60;
    if (sign === 0) return noon;
    const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl * rad)) - Math.tan(lat * rad) * Math.tan(decl * rad);
    const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * deg;
    return noon + (sign * 4 * H) / 60;
  };
  const sunrise = solve(solve(12, -1), -1), sunset = solve(solve(12, 1), 1), solarNoon = solve(12, 0);
  return { sunrise, solarNoon, sunset };
}

export const fmtClock = (h: number) => {
  let H = Math.floor(h), M = Math.round((h - H) * 60);
  if (M === 60) { H++; M = 0; }
  return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H >= 12 ? 'PM' : 'AM'}`;
};
