// Snow days: the dates it most often snows in Ljubljana, looked up once (not
// worked out as we go) from ten winters of records, and every year on those
// dates it snows in town. Mirrored in the server (`sim::nature::SNOW_RECORD`),
// so bugs and mushrooms keep to the same sky.
//
// The record: daily snowfall at Ljubljana, 1 Jul 2015 – 30 Jun 2025 (the ten
// winters 2015/16 to 2024/25), from the Open-Meteo historical archive (ECMWF
// ERA5 reanalysis, 46.06° N 14.51° E). A day counts as snowy with at least
// 0.5 cm of fresh snow. Over those ten winters that was 136 days (13.6 a
// year: Nov 17, Dec 33, Jan 34, Feb 28, Mar 19, Apr 4, Oct 1); spread round
// as they are, no single date snowed in more than four winters of the ten.
// Below: every date that snowed in at least two of them, [MM-DD, winters].

export const SNOW_RECORD: [string, number][] = [
  ["11-21", 2], ["11-22", 2], ["11-26", 2], ["11-29", 2], ["11-30", 2],
  ["12-02", 2], ["12-06", 2], ["12-08", 2], ["12-09", 4], ["12-13", 3], ["12-20", 2], ["12-28", 2],
  ["01-03", 2], ["01-04", 2], ["01-05", 2], ["01-06", 3], ["01-10", 2], ["01-16", 2], ["01-18", 3], ["01-19", 2], ["01-23", 2], ["01-28", 2], ["01-31", 2],
  ["02-03", 2], ["02-11", 2], ["02-12", 2], ["02-13", 2], ["02-26", 3],
  ["03-01", 3], ["03-03", 2],
];
/** Out of how many winters. */
const WINTERS = 10;
/** It snows on a date that snowed in at least this share of the winters on record (4 of 10: 9 December). */
export const SNOW_CHANCE = 0.4;

/** The dates it snows (MM-DD). */
const SNOW_DATES = new Set(SNOW_RECORD.filter(([, n]) => n / WINTERS >= SNOW_CHANCE).map(([d]) => d));

/**
 * Whether it's a snow day at `ms` (unix ms): the date in Ljubljana (winter's
 * all in CET, UTC+1: no summer time to mind) is one it snows on.
 */
export function snowDay(ms: number): boolean {
  const d = new Date(ms + 3_600_000);
  const md = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return SNOW_DATES.has(md);
}
