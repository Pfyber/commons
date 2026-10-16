//! The Commons Mall's departments (ADR 0011), shared by mapgen (where the
//! shops and displays go) and the API (what's on each display and what it
//! costs). Read from `assets/mall/departments.json`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CatalogEntry {
    /// The item's key in the `items` table.
    pub item: String,
    /// Coins.
    pub price: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Department {
    pub key: String,
    pub name: String,
    /// `shelves`, `racks`, `showroom`, `track`, `popup`.
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
    #[serde(default)]
    pub catalog: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Departments {
    pub departments: Vec<Department>,
}

/// What's on one display.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Shelf {
    pub slot: u16,
    pub item: String,
    pub price: i32,
}

impl Departments {
    pub fn from_json(s: &str) -> Result<Self, String> {
        let d: Departments = serde_json::from_str(s).map_err(|e| e.to_string())?;
        for dep in &d.departments {
            if dep.open && (dep.slots == 0 || dep.catalog.is_empty()) {
                return Err(format!("{} is open with nothing to sell", dep.key));
            }
            if dep.catalog.iter().any(|c| !(1..=9999).contains(&c.price)) {
                return Err(format!("{}: prices are 1 to 9999 coins", dep.key));
            }
        }
        Ok(d)
    }

    pub fn get(&self, key: &str) -> Option<&Department> {
        self.departments.iter().find(|d| d.key == key)
    }
}

impl Department {
    /// What's on each display. Every catalog item has a place; with more
    /// displays than items, items repeat. (Weekly rotation comes in M3.)
    pub fn stock(&self) -> Vec<Shelf> {
        if !self.open || self.catalog.is_empty() {
            return vec![];
        }
        (0..self.slots)
            .map(|slot| {
                let c = &self.catalog[slot as usize % self.catalog.len()];
                Shelf {
                    slot,
                    item: c.item.clone(),
                    price: c.price,
                }
            })
            .collect()
    }
}

/// The real departments.
pub fn departments() -> Departments {
    Departments::from_json(include_str!("../../../../assets/mall/departments.json"))
        .expect("assets/mall/departments.json is valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_shops_have_something_on_every_display() {
        let d = departments();
        let open: Vec<_> = d.departments.iter().filter(|d| d.open).collect();
        assert!(open.iter().any(|d| d.key == "furniture"));
        assert!(open.iter().any(|d| d.key == "seeds"));
        for dep in open {
            let stock = dep.stock();
            assert_eq!(stock.len(), dep.slots as usize);
            // Everything in the catalog is on show somewhere.
            for c in &dep.catalog {
                assert!(
                    stock.iter().any(|s| s.item == c.item),
                    "{} isn't on show",
                    c.item
                );
            }
        }
        assert!(
            d.get("pets").unwrap().stock().is_empty(),
            "closed shops sell nothing"
        );
    }
}
