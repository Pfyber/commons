//! Bugs and mushrooms in the town's green places (ADR 0019): what's out
//! where, worked out from the clock, the weather, the season and the moon,
//! so everyone sees the same creatures without any messages, and nobody
//! writes anything new by the day.
//!
//! The map has `forage` spots (`bug:<habitat>` or `shroom:<habitat>`). Each
//! bug spot rolls every ten minutes whether something's there and what; each
//! mushroom spot every weather spell (two hours), more often after rain.
//! What can turn up depends on the spot's habitat, the hour, the weather, the
//! season and, for one or two, the full moon.

/// How long a bug stays at its spot, and a mushroom (one weather spell).
pub const BUG_SLOT_MS: i64 = 10 * 60_000;
pub const SHROOM_SLOT_MS: i64 = 2 * 60 * 60_000;
/// The weather's spells (the client's `weatherAt`).
const SPELL_MS: i64 = 2 * 60 * 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Habitat {
    Meadow,
    Woods,
    Orchard,
    /// The edges of the pond and the lake.
    Water,
    /// The park's lawns.
    Park,
}

impl Habitat {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "meadow" => Self::Meadow,
            "woods" => Self::Woods,
            "orchard" => Self::Orchard,
            "water" => Self::Water,
            "park" => Self::Park,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Meadow => "the Meadow",
            Self::Woods => "the Woods",
            Self::Orchard => "the Orchard",
            Self::Water => "the water's edge",
            Self::Park => "the Park",
        }
    }
    fn bit(self) -> u8 {
        1 << self as u8
    }
}

const M: u8 = 1;
const W: u8 = 2;
const O: u8 = 4;
const P: u8 = 8;
const K: u8 = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Weather {
    Clear,
    Cloudy,
    Rain,
    Mist,
    /// One of Ljubljana's snow days (`SNOW_RECORD`): snowing all day.
    Snow,
}

impl Weather {
    pub fn key(self) -> &'static str {
        match self {
            Self::Clear => "clear",
            Self::Cloudy => "cloudy",
            Self::Rain => "rain",
            Self::Mist => "mist",
            Self::Snow => "snow",
        }
    }
}

/// The client's `hash` (world/art.ts), bit for bit.
pub fn hash(x: u32, y: u32, salt: u32) -> u32 {
    let mut h =
        x.wrapping_mul(0x9e37_79b1) ^ y.wrapping_mul(0x85eb_ca77) ^ salt.wrapping_mul(0xc2b2_ae3d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h
}

/// The dates it most often snows in Ljubljana, from ten winters of records
/// (2015/16–2024/25, Open-Meteo's ERA5 archive, a day with 0.5 cm of fresh
/// snow or more): (month, day, winters of the ten it snowed). The client's
/// `SNOW_RECORD` (ambient/snowdays.ts), where the record's told in full.
pub const SNOW_RECORD: [(u32, u32, u32); 30] = [(11, 21, 2), (11, 22, 2), (11, 26, 2), (11, 29, 2), (11, 30, 2), (12, 2, 2), (12, 6, 2), (12, 8, 2), (12, 9, 4), (12, 13, 3), (12, 20, 2), (12, 28, 2), (1, 3, 2), (1, 4, 2), (1, 5, 2), (1, 6, 3), (1, 10, 2), (1, 16, 2), (1, 18, 3), (1, 19, 2), (1, 23, 2), (1, 28, 2), (1, 31, 2), (2, 3, 2), (2, 11, 2), (2, 12, 2), (2, 13, 2), (2, 26, 3), (3, 1, 3), (3, 3, 2)];
/// It snows on a date that snowed in at least this many of the ten winters (four: 9 December).
pub const SNOW_WINTERS: u32 = 4;

/// Whether `ms` (unix ms) falls on a snow day: the date in Ljubljana (all
/// winter in CET, UTC+1) is one of the snowiest on record.
pub fn snow_day(ms: i64) -> bool {
    let days = (ms + 3_600_000).div_euclid(86_400_000);
    let (month, day) = month_day(days);
    SNOW_RECORD
        .iter()
        .any(|&(m, d, n)| m == month && d == day && n >= SNOW_WINTERS)
}

/// The (month, day) of `days` since 1 Jan 1970 (the civil calendar).
fn month_day(days: i64) -> (u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (month, day)
}

/// The weather at `ms` (unix ms) for a local `hour` (0–24): the client's `weatherAt`.
pub fn weather_at(ms: i64, hour: f64) -> Weather {
    if snow_day(ms) {
        return Weather::Snow;
    }
    let spell = ms.div_euclid(SPELL_MS) as u32;
    let h = hash(spell, 7, 31) % 100;
    let w = match h {
        0..45 => Weather::Clear,
        45..75 => Weather::Cloudy,
        75..90 => Weather::Rain,
        _ => Weather::Mist,
    };
    if w == Weather::Mist && !(4.5..10.0).contains(&hour) {
        Weather::Cloudy
    } else {
        w
    }
}

/// How far through the moon's month `ms` is: 0 new, 0.5 full.
pub fn moon_phase(ms: i64) -> f64 {
    // A new moon: 6 Jan 2000, 18:14 UTC; the synodic month.
    const NEW: f64 = 947_182_440_000.0;
    const MONTH: f64 = 29.530_588_853 * 86_400_000.0;
    ((ms as f64 - NEW) / MONTH).rem_euclid(1.0)
}

/// About three nights a month.
pub fn full_moon(ms: i64) -> bool {
    (moon_phase(ms) - 0.5).abs() < 0.05
}

pub fn moon_name(ms: i64) -> &'static str {
    let p = moon_phase(ms);
    match p {
        _ if full_moon(ms) => "full moon",
        _ if !(0.03..0.97).contains(&p) => "new moon",
        _ if p < 0.22 => "waxing crescent",
        _ if p < 0.28 => "first quarter",
        _ if p < 0.5 => "waxing gibbous",
        _ if p < 0.72 => "waning gibbous",
        _ if p < 0.78 => "last quarter",
        _ => "waning crescent",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
}

impl Season {
    /// The northern year, by month (1–12).
    pub fn of_month(month: u32) -> Self {
        match month {
            3..=5 => Self::Spring,
            6..=8 => Self::Summer,
            9..=11 => Self::Autumn,
            _ => Self::Winter,
        }
    }
    fn bit(self) -> u8 {
        1 << self as u8
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Spring => "spring",
            Self::Summer => "summer",
            Self::Autumn => "autumn",
            Self::Winter => "winter",
        }
    }
}

const SP: u8 = 1;
const SU: u8 = 2;
const AU: u8 = 4;
const WI: u8 = 8;
const ALL: u8 = 15;

/// When in the day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hours {
    Any,
    /// 6:00–18:00.
    Day,
    /// 17:00–22:00.
    Dusk,
    /// 20:00–6:00.
    Night,
}

impl Hours {
    fn holds(self, hour: f64) -> bool {
        match self {
            Self::Any => true,
            Self::Day => (6.0..18.0).contains(&hour),
            Self::Dusk => (17.0..22.0).contains(&hour),
            Self::Night => !(6.0..20.0).contains(&hour),
        }
    }
}

/// The weather it wants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sky {
    Any,
    /// Clear skies.
    Sunny,
    /// Anything but rain.
    Dry,
    /// Rain now (mushrooms: or in the spell before).
    Wet,
    Mist,
}

impl Sky {
    fn holds(self, now: Weather, rained: bool) -> bool {
        match self {
            Self::Any => true,
            Self::Sunny => now == Weather::Clear,
            Self::Dry => now != Weather::Rain,
            Self::Wet => rained,
            Self::Mist => now == Weather::Mist,
        }
    }
}

/// A bug or a mushroom: its item key, and where and when it's out.
#[derive(Debug, Clone, Copy)]
pub struct Kind {
    pub key: &'static str,
    pub rarity: i16,
    habitats: u8,
    pub hours: Hours,
    pub sky: Sky,
    seasons: u8,
    /// Only on nights of the full moon.
    pub moon: bool,
}

const fn k(
    key: &'static str,
    rarity: i16,
    habitats: u8,
    hours: Hours,
    sky: Sky,
    seasons: u8,
) -> Kind {
    Kind {
        key,
        rarity,
        habitats,
        hours,
        sky,
        seasons,
        moon: false,
    }
}

use Hours::{Any as AnyTime, Day, Dusk, Night};
use Sky::{Any, Dry, Mist, Sunny, Wet};

/// The bugs (items 1000–1032, kind `bug`).
pub const BUGS: &[Kind] = &[
    k("cabbage_white", 0, M | K | O, Day, Dry, SP | SU | AU),
    k("red_admiral", 1, M | O, Day, Sunny, SU | AU),
    k("peacock_butterfly", 2, M, Day, Sunny, SP | SU),
    k("swallowtail", 3, M, Day, Sunny, SU),
    k("blue_morpho", 4, W, Day, Sunny, SU),
    k("brimstone", 1, W | O, Day, Sunny, WI | SP),
    k("ladybird", 0, K | O | M, Day, Dry, SP | SU | AU),
    k("honeybee", 0, M | O, Day, Dry, SP | SU),
    k("bumblebee", 1, M | K, Day, Any, SP | SU | AU),
    k("garden_snail", 0, K | O | W, AnyTime, Wet, SP | SU | AU),
    k("banded_snail", 2, W, AnyTime, Wet, SP | AU),
    k("grasshopper", 0, M | K, Day, Sunny, SU | AU),
    k("field_cricket", 1, M | K, Night, Dry, SU | AU),
    k("bush_cricket", 2, M | W, Dusk, Any, SU),
    k("firefly", 1, M | P, Night, Dry, SP | SU | AU),
    k("common_darter", 0, P, Day, Dry, SU | AU),
    k("emperor_dragonfly", 2, P, Day, Sunny, SU),
    k("azure_damselfly", 1, P, Day, Any, SP | SU),
    k("pond_skater", 0, P, AnyTime, Any, SP | SU | AU),
    k("diving_beetle", 2, P, AnyTime, Wet, ALL),
    k("stag_beetle", 3, W, Dusk, Dry, SU),
    k("rhino_beetle", 4, W, Night, Any, SU),
    k("jewel_beetle", 3, O | W, Day, Sunny, SP | SU),
    k("ground_beetle", 0, W | K, Night, Any, ALL),
    k("woodlouse", 0, W | O, AnyTime, Wet, ALL),
    k("garden_spider", 1, K | O | W, AnyTime, Any, AU),
    k("money_spider", 2, M | K, AnyTime, Mist, AU | WI),
    k("luna_moth", 4, W, Night, Dry, SP | SU),
    k("tiger_moth", 2, M | K, Night, Any, SU),
    k("winter_moth", 1, W | O | K, Night, Any, AU | WI),
    k("snow_flea", 1, W | K, Day, Any, WI),
    k("praying_mantis", 3, M, Day, Sunny, AU),
    k("golden_scarab", 5, M | O, Day, Sunny, SU),
];

/// The mushrooms (items 1050–1070, kind `shroom`).
pub const SHROOMS: &[Kind] = &[
    k("field_mushroom", 0, M | K, AnyTime, Any, SU | AU),
    k("shaggy_ink_cap", 1, K | M, AnyTime, Wet, AU),
    k("giant_puffball", 2, M, AnyTime, Any, SU | AU),
    k("fly_agaric", 2, W, AnyTime, Any, AU),
    k("chanterelle", 2, W, AnyTime, Wet, SU | AU),
    k("porcini", 3, W, AnyTime, Wet, AU),
    k("oyster_mushroom", 1, W | O, AnyTime, Any, AU | WI),
    k("honey_fungus", 0, W | O, AnyTime, Any, AU),
    k("turkey_tail", 0, W, AnyTime, Any, ALL),
    k("velvet_shank", 1, W | O, AnyTime, Any, WI),
    k("morel", 3, O | W, AnyTime, Wet, SP),
    k("st_georges", 1, M | K, AnyTime, Any, SP),
    k("parasol", 1, M, AnyTime, Any, SU | AU),
    k("amethyst_deceiver", 2, W, AnyTime, Mist, AU),
    k("fairy_ring", 2, M, Night, Any, SP | SU | AU),
    Kind {
        moon: true,
        ..k("ghost_glowcap", 4, W, Night, Any, ALL)
    },
    k("giggle_cap", 2, M | K, AnyTime, Mist, AU),
    k("wobble_puff", 1, W, AnyTime, Wet, SU | AU),
    k("lions_mane", 4, W, AnyTime, Any, AU),
    k("jelly_ear", 0, W, AnyTime, Wet, ALL),
    k("starcap", 5, M, Night, Sunny, ALL),
];

/// Mushrooms that make you woozy for a little while when you pick them.
pub const WOOZY: &[&str] = &["giggle_cap", "wobble_puff"];

/// How often each rarity turns up, relative to each other.
const WEIGHT: [u32; 6] = [1000, 450, 180, 70, 25, 6];

/// Everything about the moment that decides what's out.
#[derive(Debug, Clone, Copy)]
pub struct Moment {
    /// Local hour (0–24) and weather at the slot's start.
    pub hour: f64,
    pub weather: Weather,
    /// It's raining, or it did in the spell before.
    pub rained: bool,
    pub season: Season,
    pub full_moon: bool,
}

impl Moment {
    /// The moment at `ms` (unix ms), given the local hour and month there.
    pub fn at(ms: i64, hour: f64, month: u32) -> Self {
        let weather = weather_at(ms, hour);
        let before = weather_at(ms - SPELL_MS, (hour + 22.0) % 24.0);
        Self {
            hour,
            weather,
            rained: weather == Weather::Rain || before == Weather::Rain,
            season: Season::of_month(month),
            full_moon: full_moon(ms),
        }
    }
}

impl Kind {
    pub fn lives_in(&self, h: Habitat) -> bool {
        self.habitats & h.bit() != 0
    }
    pub fn habitats(&self) -> impl Iterator<Item = Habitat> + '_ {
        [
            Habitat::Meadow,
            Habitat::Woods,
            Habitat::Orchard,
            Habitat::Water,
            Habitat::Park,
        ]
        .into_iter()
        .filter(|h| self.lives_in(*h))
    }
    pub fn in_season(&self, s: Season) -> bool {
        self.seasons & s.bit() != 0
    }
    pub fn seasons(&self) -> impl Iterator<Item = Season> + '_ {
        [
            Season::Spring,
            Season::Summer,
            Season::Autumn,
            Season::Winter,
        ]
        .into_iter()
        .filter(|s| self.in_season(*s))
    }
    fn out_at(&self, h: Habitat, m: &Moment) -> bool {
        self.lives_in(h)
            && self.in_season(m.season)
            && self.hours.holds(m.hour)
            && self.sky.holds(m.weather, m.rained)
            && (!self.moon || m.full_moon)
    }

    /// Where and when to look, in a few words: "the Meadow · day · sunny · summer".
    pub fn hint(&self) -> String {
        let places: Vec<&str> = self.habitats().map(Habitat::name).collect();
        let mut parts = vec![places.join(", ")];
        match self.hours {
            Hours::Any => {}
            Hours::Day => parts.push("by day".into()),
            Hours::Dusk => parts.push("at dusk".into()),
            Hours::Night => parts.push(
                if self.moon {
                    "on full-moon nights"
                } else {
                    "at night"
                }
                .into(),
            ),
        }
        match self.sky {
            Sky::Any => {}
            Sky::Sunny => parts.push("when it's sunny".into()),
            Sky::Dry => parts.push("when it's dry".into()),
            Sky::Wet => parts.push("in or after rain".into()),
            Sky::Mist => parts.push("on misty mornings".into()),
        }
        if self.seasons != ALL {
            let s: Vec<&str> = self.seasons().map(Season::name).collect();
            parts.push(format!("in {}", s.join(" and ")));
        }
        parts.join(" · ")
    }
}

/// A forage spot on the map.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Spot {
    pub x: u16,
    pub y: u16,
    pub habitat: Habitat,
    pub shroom: bool,
}

impl Spot {
    /// A spot's id (for claims): its tile.
    pub fn id(&self) -> i32 {
        ((self.x as i32) << 16) | self.y as i32
    }

    /// From a map object: `forage` with `bug:<habitat>` or `shroom:<habitat>`.
    pub fn from_object(kind: &str, label: Option<&str>, x: u16, y: u16) -> Option<Self> {
        if kind != "forage" {
            return None;
        }
        let (what, hab) = label?.split_once(':')?;
        Some(Self {
            x,
            y,
            habitat: Habitat::parse(hab)?,
            shroom: match what {
                "bug" => false,
                "shroom" => true,
                _ => return None,
            },
        })
    }

    /// Which slot `ms` falls in for this spot.
    pub fn slot(&self, ms: i64) -> i64 {
        ms.div_euclid(if self.shroom {
            SHROOM_SLOT_MS
        } else {
            BUG_SLOT_MS
        })
    }

    pub fn slot_start(&self, slot: i64) -> i64 {
        slot * if self.shroom {
            SHROOM_SLOT_MS
        } else {
            BUG_SLOT_MS
        }
    }

    /// What's at this spot in `slot` at moment `m` (taken at the slot's start), if anything.
    pub fn out(&self, slot: i64, m: &Moment) -> Option<&'static Kind> {
        let (kinds, chance) = if self.shroom {
            (SHROOMS, if m.rained { 55 } else { 30 })
        } else {
            (BUGS, 32)
        };
        let s = slot as u32;
        let id = self.id() as u32;
        if hash(id, s, 0x6e61_7475) % 100 >= chance {
            return None;
        }
        let total: u32 = kinds
            .iter()
            .filter(|k| k.out_at(self.habitat, m))
            .map(|k| WEIGHT[k.rarity as usize])
            .sum();
        if total == 0 {
            return None;
        }
        let mut x = hash(s, id, 0x7069_636b) % total;
        for k in kinds.iter().filter(|k| k.out_at(self.habitat, m)) {
            let w = WEIGHT[k.rarity as usize];
            if x < w {
                return Some(k);
            }
            x -= w;
        }
        None
    }
}

pub fn kind(key: &str) -> Option<&'static Kind> {
    BUGS.iter().chain(SHROOMS).find(|k| k.key == key)
}

#[cfg(test)]
mod tests {

    #[test]
    fn it_snows_on_ljubljanas_snowiest_day() {
        // 9 Dec, every year (noon and late in the evening, CET); not the 8th, nor in July.
        for (y, ms) in [(2025, 1_765_281_600_000_i64), (2026, 1_796_817_600_000)] {
            assert_eq!(weather_at(ms, 12.0), Weather::Snow, "{y}: noon");
            assert_eq!(weather_at(ms + 11 * 3_600_000 - 60_000, 23.0), Weather::Snow, "{y}: 23:59 CET");
            assert_ne!(weather_at(ms - 86_400_000, 12.0), Weather::Snow, "{y}: the 8th");
        }
        assert_ne!(weather_at(1_783_944_000_000, 12.0), Weather::Snow, "July");
        assert_eq!(month_day(0), (1, 1));
        assert_eq!(month_day(20_431), (12, 9), "9 Dec 2025");
    }
    use super::*;

    #[test]
    fn hash_matches_the_client() {
        // world/art.ts: hash(3, 7, 31) and hash(123456, 7, 31).
        assert_eq!(hash(3, 7, 31), js_hash(3, 7, 31));
        assert_eq!(hash(123_456, 7, 31), js_hash(123_456, 7, 31));
    }

    /// The client's hash, step by step in i32 as JavaScript does it.
    fn js_hash(x: i32, y: i32, salt: i32) -> u32 {
        let mut h = x.wrapping_mul(0x9e37_79b1u32 as i32)
            ^ y.wrapping_mul(0x85eb_ca77u32 as i32)
            ^ salt.wrapping_mul(0xc2b2_ae3du32 as i32);
        h ^= ((h as u32) >> 15) as i32;
        h = h.wrapping_mul(0x2c1b_3c6d);
        h ^= ((h as u32) >> 12) as i32;
        h as u32
    }

    #[test]
    fn every_kind_can_be_found_somewhere_sometime() {
        let spots: Vec<Spot> = [
            Habitat::Meadow,
            Habitat::Woods,
            Habitat::Orchard,
            Habitat::Water,
            Habitat::Park,
        ]
        .into_iter()
        .flat_map(|h| {
            (0..12u16).flat_map(move |i| {
                [false, true].map(|s| Spot {
                    x: i,
                    y: i * 3,
                    habitat: h,
                    shroom: s,
                })
            })
        })
        .collect();
        let mut seen = std::collections::HashSet::new();
        for month in 1..=12 {
            for hour in [3.0, 8.0, 12.0, 19.0, 23.0] {
                for weather in [
                    Weather::Clear,
                    Weather::Cloudy,
                    Weather::Rain,
                    Weather::Mist,
                    Weather::Snow,
                ] {
                    for moon in [false, true] {
                        let m = Moment {
                            hour,
                            weather,
                            rained: weather == Weather::Rain,
                            season: Season::of_month(month),
                            full_moon: moon,
                        };
                        for s in &spots {
                            for slot in 0..400 {
                                if let Some(k) = s.out(slot, &m) {
                                    seen.insert(k.key);
                                }
                            }
                        }
                    }
                }
            }
        }
        for k in BUGS.iter().chain(SHROOMS) {
            assert!(seen.contains(k.key), "{} never turns up", k.key);
        }
    }

    #[test]
    fn something_is_always_about_in_every_season() {
        for month in 1..=12 {
            for hour in [2.0, 12.0] {
                let m = Moment {
                    hour,
                    weather: Weather::Cloudy,
                    rained: false,
                    season: Season::of_month(month),
                    full_moon: false,
                };
                let bugs = BUGS
                    .iter()
                    .filter(|k| k.out_at(Habitat::Woods, &m) || k.out_at(Habitat::Park, &m))
                    .count();
                assert!(bugs > 0, "no bugs in month {month} at {hour}");
                let shrooms = SHROOMS
                    .iter()
                    .filter(|k| k.out_at(Habitat::Woods, &m))
                    .count();
                assert!(shrooms > 0, "no mushrooms in month {month} at {hour}");
            }
        }
    }

    #[test]
    fn the_moon_turns_and_the_weather_matches_its_spells() {
        // 15 Sep 2024 was near a full moon (the 18th, 02:34 UTC).
        assert!(full_moon(1_726_626_840_000));
        assert!(!full_moon(1_726_626_840_000 + 14 * 86_400_000));
        // Mist only in the morning.
        for spell in 0..500i64 {
            assert_ne!(weather_at(spell * SPELL_MS, 15.0), Weather::Mist);
        }
    }

    #[test]
    fn spots_are_read_from_the_map() {
        let s = Spot::from_object("forage", Some("shroom:woods"), 10, 20).unwrap();
        assert!(s.shroom && s.habitat == Habitat::Woods && s.id() == (10 << 16 | 20));
        assert!(Spot::from_object("spot", Some("bug:woods"), 1, 1).is_none());
        assert!(Spot::from_object("forage", Some("bug:moon"), 1, 1).is_none());
    }
}
