// The real sun over Ljubljana, for the light: how high it stands at any
// moment (a standard solar-position formula, good to a fraction of a degree),
// and from that the "light hour": where the day's lighting (daynight.ts's
// keyframes) stands. So the game gets dark when it does outside in Slovenia:
// early in winter (the sun's down by half past four in December), late in
// summer (light till after nine in June), dawn and dusk lasting as long as
// they really do.

/** Ljubljana. */
const LAT = 46.0569;
const LON = 14.5058;
const RAD = Math.PI / 180;

/** The sun's place in the sky at `ms` (unix ms): its height above the horizon (degrees), and its hour angle (degrees: <0 morning, >0 afternoon). */
export function sunAt(ms: number, lat = LAT, lon = LON): { alt: number; ha: number; dec: number } {
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  let ha = (gmst * 15 + lon - ra) % 360;
  if (ha > 180) ha -= 360;
  if (ha < -180) ha += 360;
  const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha * RAD)) / RAD;
  return { alt, ha, dec };
}

/** How far from noon (hour angle, degrees, 0–180) the sun's at height `alt` today (declination `dec`); 180 if it never gets that low, 0 if never that high. */
function hourAngleAt(alt: number, dec: number, lat = LAT): number {
  const c = (Math.sin(alt * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
  if (c <= -1) return 180;
  if (c >= 1) return 0;
  return Math.acos(c) / RAD;
}

/**
 * The light's stages (sun height → the lighting keyframes' hour): sunrise and
 * sunset are where the sun's rim crosses the horizon (-0.833°, with the air's
 * bending), civil twilight ends at -6° (lamps on, colours gone), nautical at
 * -12° (dark), astronomical at -18° (night).
 */
const MORNING: [number, number][] = [
  [-18, 4],
  [-12, 5],
  [-6, 5.75],
  [-0.833, 6.5],
  [5, 7.3],
  [10, 8],
];
const EVENING: [number, number][] = [
  [12, 16.5],
  [5, 17.6],
  [-0.833, 18.5],
  [-6, 20],
  [-12, 21.5],
  [-18, 23],
];

/**
 * The light hour at `ms`: the hour on the lighting's own clock (8–16.5 full
 * day, 18.5 sunset, 20 dusk, 21.5 dark, 4–5 the night ending) that matches how
 * high the sun really is over Ljubljana now.
 */
export function lightHour(ms: number): number {
  const { ha, dec } = sunAt(ms);
  // Each stage's hour angle today: mornings before noon (negative), evenings after.
  const pts: [number, number][] = [
    ...MORNING.map(([alt, h]) => [-hourAngleAt(alt, dec), h] as [number, number]),
    ...EVENING.map(([alt, h]) => [hourAngleAt(alt, dec), h] as [number, number]),
  ];
  // Round the night: from the last evening stage on through midnight to the first morning one.
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (ha >= last[0] || ha <= first[0]) {
    const span = 360 - last[0] + first[0];
    const into = ha >= last[0] ? ha - last[0] : ha + 360 - last[0];
    const h = last[1] + (into / (span || 1)) * (24 - last[1] + first[1]);
    return h >= 24 ? h - 24 : h;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, ha0] = pts[i];
    const [b, hb] = pts[i + 1];
    if (ha >= a && ha <= b) return ha0 + ((ha - a) / (b - a || 1)) * (hb - ha0);
  }
  return 12;
}
