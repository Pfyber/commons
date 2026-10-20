//! The Commons Mall's departments (ADR 0011), shared by mapgen (where the
//! shops and displays go) and the API (what's on each display and what it
//! costs). Read from `assets/mall/departments.json` and `events.json`.
//!
//! **Rotation (M3):** time is cut into rotations (a week by default, from a
//! Monday). Each rotation every shop puts its `always` items on show and
//! fills the rest of its displays with a weighted draw from the rest of its
//! catalog, the same for everyone: a pure function of the rotation number.
//! **Limited** items have a stock per rotation (counted by the API). The
//! **seasonal pop-up** sells the items of whichever event in the yearly
//! calendar is on.

use serde::{Deserialize, Serialize};

/// Rotations count from Monday 5 January 2026, 00:00 UTC.
pub const ROTATION_EPOCH: i64 = 1_767_571_200;
/// A week, unless configured otherwise.
pub const DEFAULT_ROTATION_SECS: i64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CatalogEntry {
    /// The item's key in the `items` table.
    pub item: String,
    /// Coins.
    pub price: i32,
    /// Always on show (otherwise drawn by weight each rotation).
    #[serde(default)]
    pub always: bool,
    /// Relative chance of being drawn (default 1).
    #[serde(default = "one")]
    pub weight: u32,
    /// How many there are to go round each rotation (unlimited if absent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limited: Option<i32>,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Department {
    pub key: String,
    pub name: String,
    /// `shelves`, `racks`, `showroom`, `pens`, `track`.
    #[serde(rename = "type")]
    pub kind: String,
    /// The shop's rectangle on the floor, walls included (inclusive).
    pub unit: [u16; 4],
    /// The wall its doorway is in: n, s, e or w.
    pub door: String,
    pub open: bool,
    /// Displays on the shop floor.
    #[serde(default)]
    pub slots: u16,
    /// Where things to wear can be tried on: `fitting_room` or `mirror`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub try_on: Option<String>,
    #[serde(default)]
    pub catalog: Vec<CatalogEntry>,
}

/// The pop-up stand by the entrance: its displays sell the current event's
/// items.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Popup {
    pub name: String,
    pub slots: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Departments {
    pub departments: Vec<Department>,
    pub popup: Popup,
}

/// A season in the yearly calendar, from `from` to `to` ("MM-DD",
/// inclusive; it may wrap past New Year).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Event {
    pub key: String,
    pub name: String,
    pub from: String,
    pub to: String,
    pub items: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Events {
    pub events: Vec<Event>,
}

/// What's on one display.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Shelf {
    pub slot: u16,
    pub item: String,
    pub price: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limited: Option<i32>,
}

impl Shelf {
    fn of(slot: u16, c: &CatalogEntry) -> Shelf {
        Shelf {
            slot,
            item: c.item.clone(),
            price: c.price,
            limited: c.limited,
        }
    }
}

fn check_catalog(what: &str, catalog: &[CatalogEntry]) -> Result<(), String> {
    if catalog.iter().any(|c| !(1..=9999).contains(&c.price)) {
        return Err(format!("{what}: prices are 1 to 9999 coins"));
    }
    if catalog.iter().any(|c| c.limited.is_some_and(|n| n < 1)) {
        return Err(format!("{what}: limited stock is at least 1"));
    }
    Ok(())
}

impl Departments {
    pub fn from_json(s: &str) -> Result<Self, String> {
        let d: Departments = serde_json::from_str(s).map_err(|e| e.to_string())?;
        for dep in &d.departments {
            if dep.open && (dep.slots == 0 || dep.catalog.is_empty()) {
                return Err(format!("{} is open with nothing to sell", dep.key));
            }
            if dep.catalog.iter().filter(|c| c.always).count() > dep.slots as usize {
                return Err(format!("{}: more `always` items than displays", dep.key));
            }
            check_catalog(&dep.key, &dep.catalog)?;
        }
        Ok(d)
    }

    pub fn get(&self, key: &str) -> Option<&Department> {
        self.departments.iter().find(|d| d.key == key)
    }
}

/// A small, platform-independent hash for the weekly draw.
fn mix(mut h: u64) -> u64 {
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

fn seed(key: &str, rotation: i64) -> u64 {
    key.bytes()
        .fold(mix(rotation as u64 ^ 0x9e37_79b9_7f4a_7c15), |h, b| {
            mix(h ^ b as u64)
        })
}

impl Department {
    /// What's on each display in `rotation`.
    pub fn stock_at(&self, rotation: i64) -> Vec<Shelf> {
        if !self.open || self.catalog.is_empty() {
            return vec![];
        }
        let mut chosen: Vec<&CatalogEntry> = self.catalog.iter().filter(|c| c.always).collect();
        let mut pool: Vec<&CatalogEntry> = self.catalog.iter().filter(|c| !c.always).collect();
        let mut h = seed(&self.key, rotation);
        while chosen.len() < self.slots as usize && !pool.is_empty() {
            let total: u64 = pool.iter().map(|c| c.weight.max(1) as u64).sum();
            h = mix(h);
            let mut at = h % total;
            let i = pool
                .iter()
                .position(|c| {
                    let w = c.weight.max(1) as u64;
                    if at < w {
                        true
                    } else {
                        at -= w;
                        false
                    }
                })
                .unwrap_or(0);
            chosen.push(pool.remove(i));
        }
        // Fewer items than displays: show some twice.
        let n = chosen.len();
        (0..self.slots)
            .map(|slot| Shelf::of(slot, chosen[slot as usize % n]))
            .collect()
    }
}

impl Popup {
    /// The pop-up's displays during `event`.
    pub fn stock(&self, event: Option<&Event>) -> Vec<Shelf> {
        let Some(e) = event.filter(|e| !e.items.is_empty()) else {
            return vec![];
        };
        (0..self.slots)
            .map(|slot| Shelf::of(slot, &e.items[slot as usize % e.items.len()]))
            .collect()
    }
}

/// "MM-DD" as a day of the year's (month, day), for comparing.
fn md(s: &str) -> Option<(u32, u32)> {
    let (m, d) = s.split_once('-')?;
    Some((m.parse().ok()?, d.parse().ok()?))
}

impl Events {
    pub fn from_json(s: &str) -> Result<Self, String> {
        let e: Events = serde_json::from_str(s).map_err(|e| e.to_string())?;
        for ev in &e.events {
            if md(&ev.from).is_none() || md(&ev.to).is_none() {
                return Err(format!("{}: dates are MM-DD", ev.key));
            }
            check_catalog(&ev.key, &ev.items)?;
        }
        Ok(e)
    }

    /// The event on on (month, day), if any.
    pub fn on(&self, month: u32, day: u32) -> Option<&Event> {
        let today = (month, day);
        self.events.iter().find(|e| {
            let (from, to) = (md(&e.from).unwrap(), md(&e.to).unwrap());
            if from <= to {
                from <= today && today <= to
            } else {
                today >= from || today <= to
            }
        })
    }

    /// The next event to start after (month, day), wrapping round the year.
    pub fn next_after(&self, month: u32, day: u32) -> Option<&Event> {
        let today = (month, day);
        let mut starts: Vec<_> = self
            .events
            .iter()
            .map(|e| (md(&e.from).unwrap(), e))
            .collect();
        starts.sort_by_key(|(d, _)| *d);
        starts
            .iter()
            .find(|(d, _)| *d > today)
            .or(starts.first())
            .map(|(_, e)| *e)
    }
}

/// The rotation running at `unix` seconds.
pub fn rotation_at(unix: i64, period: i64) -> i64 {
    (unix - ROTATION_EPOCH).div_euclid(period.max(1))
}

/// When `rotation` ends (unix seconds).
pub fn rotation_ends(rotation: i64, period: i64) -> i64 {
    ROTATION_EPOCH + (rotation + 1) * period.max(1)
}

/// The real departments.
pub fn departments() -> Departments {
    Departments::from_json(include_str!("../../../../assets/mall/departments.json"))
        .expect("assets/mall/departments.json is valid")
}

/// The real event calendar.
pub fn events() -> Events {
    Events::from_json(include_str!("../../../../assets/mall/events.json"))
        .expect("assets/mall/events.json is valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_display_is_filled_and_always_items_stay() {
        let d = departments();
        for dep in d.departments.iter().filter(|d| d.open) {
            for r in 0..20 {
                let stock = dep.stock_at(r);
                assert_eq!(stock.len(), dep.slots as usize);
                for c in dep.catalog.iter().filter(|c| c.always) {
                    assert!(
                        stock.iter().any(|s| s.item == c.item),
                        "{} always on show",
                        c.item
                    );
                }
                // No item twice while there are others to show.
                let distinct: std::collections::HashSet<_> =
                    stock.iter().map(|s| &s.item).collect();
                assert_eq!(distinct.len(), stock.len().min(dep.catalog.len()));
            }
        }
        // Every shop is open now; a department with nothing in its catalog
        // would sell nothing.
        let mut empty = d.get("tools").unwrap().clone();
        empty.catalog.clear();
        assert!(
            empty.stock_at(3).is_empty(),
            "nothing to sell, nothing on show"
        );
    }

    #[test]
    fn rotations_are_shared_and_change() {
        let d = departments();
        let f = d.get("furniture").unwrap();
        assert_eq!(f.stock_at(7), f.stock_at(7), "the same for everyone");
        let weeks: std::collections::HashSet<Vec<String>> = (0..8)
            .map(|r| f.stock_at(r).into_iter().map(|s| s.item).collect())
            .collect();
        assert!(weeks.len() > 3, "the shelves change from week to week");
        // Over enough weeks everything gets its turn.
        let seen: std::collections::HashSet<String> = (0..40)
            .flat_map(|r| f.stock_at(r))
            .map(|s| s.item)
            .collect();
        assert_eq!(seen.len(), f.catalog.len());
    }

    #[test]
    fn rotation_numbers_count_weeks_from_a_monday() {
        let w = DEFAULT_ROTATION_SECS;
        assert_eq!(rotation_at(ROTATION_EPOCH, w), 0);
        assert_eq!(rotation_at(ROTATION_EPOCH + w - 1, w), 0);
        assert_eq!(rotation_at(ROTATION_EPOCH + w, w), 1);
        assert_eq!(rotation_at(ROTATION_EPOCH - 1, w), -1);
        assert_eq!(rotation_ends(0, w), ROTATION_EPOCH + w);
    }

    #[test]
    fn the_calendar_has_a_season_every_day_and_wraps_the_year() {
        let e = events();
        for m in 1..=12 {
            for d in [1, 15, 28] {
                assert!(e.on(m, d).is_some(), "nothing on {m}-{d}");
            }
        }
        assert_eq!(e.on(10, 16).unwrap().key, "autumn_harvest");
        assert_eq!(
            e.on(1, 10).unwrap().key,
            "winter_lights",
            "wraps past New Year"
        );
        assert_eq!(e.next_after(10, 16).unwrap().key, "winter_lights");
        let p = departments().popup;
        assert_eq!(p.stock(e.on(10, 16)).len(), p.slots as usize);
        assert!(p.stock(None).is_empty());
    }
}
