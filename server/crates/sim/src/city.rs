//! The city: a square grid of blocks separated by streets (ADR 0010).
//!
//! ```text
//!  street │ block 0 │ street │ block 1 │ street │ …
//!  S tiles│ B tiles │ S tiles│ B tiles │ S tiles│
//! ```
//!
//! The *pitch* is `B + S`. A city of `n × n` blocks is `n·P + S` tiles
//! across, with streets on its outer edges too. With the default 48-tile
//! blocks and 4-tile streets, 7 × 7 blocks are 368 tiles across, and a
//! 20 × 20 city would be 1,044: positions stay in `u16` with room to spare.
//!
//! Positions travel and are simulated as global tiles. They're stored (and
//! zones are addressed) as a block plus a local offset. Each block's zone
//! owns the block and the near half of the streets around it, so authority
//! hands over at a street's centre line.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A tile anywhere in the city.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GlobalTile {
    pub x: u16,
    pub y: u16,
}

/// A block's grid position (0-based, `bx` east, `by` south).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct BlockId {
    pub bx: u8,
    pub by: u8,
}

impl BlockId {
    /// Stable string form for keys and subjects: `b3_3`.
    pub fn key(self) -> String {
        format!("b{}_{}", self.bx, self.by)
    }

    pub fn parse(s: &str) -> Option<BlockId> {
        let (x, y) = s.strip_prefix('b')?.split_once('_')?;
        Some(BlockId {
            bx: x.parse().ok()?,
            by: y.parse().ok()?,
        })
    }
}

/// A tile inside a block, relative to the block's north-west corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LocalTile {
    pub block: BlockId,
    pub x: u8,
    pub y: u8,
}

/// What a global tile is: inside a block, or on a street.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    Block(LocalTile),
    Street,
}

/// Grid geometry: sizes only, no content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Geometry {
    /// Blocks are `block_tiles × block_tiles`.
    pub block_tiles: u16,
    pub street_tiles: u16,
    /// Blocks per side.
    pub blocks: u16,
    /// Interest-management cell size; divides the pitch evenly.
    pub cell_tiles: u16,
}

impl Geometry {
    pub fn pitch(&self) -> u16 {
        self.block_tiles + self.street_tiles
    }

    /// Tiles per side of the whole city, outer streets included.
    pub fn size(&self) -> u16 {
        self.blocks * self.pitch() + self.street_tiles
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.block_tiles == 0 || self.block_tiles > 255 {
            return Err(format!("block_tiles {} must be 1..=255", self.block_tiles));
        }
        if self.street_tiles < 2 || !self.street_tiles.is_multiple_of(2) {
            return Err(format!(
                "street_tiles {} must be even and ≥ 2",
                self.street_tiles
            ));
        }
        if self.blocks == 0 || self.blocks > 255 {
            return Err(format!("blocks {} must be 1..=255", self.blocks));
        }
        if self.cell_tiles == 0 || !self.pitch().is_multiple_of(self.cell_tiles) {
            return Err(format!(
                "cell_tiles {} must divide the pitch {}",
                self.cell_tiles,
                self.pitch()
            ));
        }
        if (self.blocks as u32) * (self.pitch() as u32) + self.street_tiles as u32 > u16::MAX as u32
        {
            return Err("the city doesn't fit in u16 tile coordinates".into());
        }
        Ok(())
    }

    /// The global tile of a block's north-west corner.
    pub fn block_origin(&self, b: BlockId) -> GlobalTile {
        GlobalTile {
            x: self.street_tiles + b.bx as u16 * self.pitch(),
            y: self.street_tiles + b.by as u16 * self.pitch(),
        }
    }

    pub fn to_global(&self, l: LocalTile) -> GlobalTile {
        let o = self.block_origin(l.block);
        GlobalTile {
            x: o.x + l.x as u16,
            y: o.y + l.y as u16,
        }
    }

    /// Splits one axis: `Some((block index, offset))` inside a block,
    /// `None` on a street.
    fn axis(&self, v: u16) -> Option<(u16, u16)> {
        let p = self.pitch();
        let off = v % p;
        let b = v / p;
        (off >= self.street_tiles && b < self.blocks).then(|| (b, off - self.street_tiles))
    }

    /// Whether `t` is inside a block or on a street. Tiles outside the city
    /// count as street (there's nothing there to own).
    pub fn place(&self, t: GlobalTile) -> Place {
        match (self.axis(t.x), self.axis(t.y)) {
            (Some((bx, lx)), Some((by, ly))) => Place::Block(LocalTile {
                block: BlockId {
                    bx: bx as u8,
                    by: by as u8,
                },
                x: lx as u8,
                y: ly as u8,
            }),
            _ => Place::Street,
        }
    }

    /// The block whose zone has authority over `t`: the nearest block,
    /// streets split down their centre lines.
    pub fn owner(&self, t: GlobalTile) -> BlockId {
        let half = self.street_tiles / 2;
        let p = self.pitch();
        let axis = |v: u16| -> u8 {
            let b = (v.saturating_sub(half) / p).min(self.blocks - 1);
            b as u8
        };
        BlockId {
            bx: axis(t.x),
            by: axis(t.y),
        }
    }

    /// The area a block's zone owns, `(x0, y0, x1, y1)` inclusive: the block
    /// and half of every street around it (all of it at the city's edge).
    pub fn owned_area(&self, b: BlockId) -> (u16, u16, u16, u16) {
        let half = self.street_tiles / 2;
        let p = self.pitch();
        let span = |i: u8| -> (u16, u16) {
            let i = i as u16;
            let lo = if i == 0 { 0 } else { half + i * p };
            let hi = if i + 1 == self.blocks {
                self.size() - 1
            } else {
                half + (i + 1) * p - 1
            };
            (lo, hi)
        };
        let (x0, x1) = span(b.bx);
        let (y0, y1) = span(b.by);
        (x0, y0, x1, y1)
    }

    /// The blocks whose owned areas lie within `radius` tiles of `t`
    /// (always including `t`'s owner): the zones a player standing at `t`
    /// should be subscribed to.
    pub fn nearby_owners(&self, t: GlobalTile, radius: u16) -> Vec<BlockId> {
        let mut out = vec![];
        let lo = |v: u16| v.saturating_sub(radius);
        let hi = |v: u16| (v + radius).min(self.size() - 1);
        for y in [lo(t.y), t.y, hi(t.y)] {
            for x in [lo(t.x), t.x, hi(t.x)] {
                let b = self.owner(GlobalTile { x, y });
                if !out.contains(&b) {
                    out.push(b);
                }
            }
        }
        out.sort();
        out
    }
}

/// `assets/city/city.json`: geometry plus which block type stands where.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityFile {
    pub name: String,
    pub block_tiles: u16,
    pub street_tiles: u16,
    pub cell_tiles: u16,
    /// `[bx, by]` of the block players arrive in.
    pub spawn_block: [u8; 2],
    /// `blocks[by][bx]`: a block type key.
    pub blocks: Vec<Vec<String>>,
    #[serde(default)]
    pub tram: Option<serde_json::Value>,
    #[serde(default)]
    pub metro: Vec<serde_json::Value>,
}

/// One entry of `assets/city/block_types.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockType {
    pub key: String,
    pub name: String,
    pub category: String,
    pub enabled: bool,
    pub swappable: bool,
    #[serde(default)]
    pub rentable: Vec<String>,
    #[serde(default)]
    pub instanced: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct BlockTypesFile {
    types: Vec<BlockType>,
}

/// The city, checked: geometry, the catalog of block types, and the grid.
#[derive(Debug, Clone)]
pub struct City {
    pub name: String,
    pub geometry: Geometry,
    pub spawn_block: BlockId,
    pub types: HashMap<String, BlockType>,
    grid: Vec<String>,
}

impl City {
    /// Parses and validates `city.json` against `block_types.json`.
    pub fn from_json(city: &str, types: &str) -> Result<City, String> {
        let file: CityFile = serde_json::from_str(city).map_err(|e| format!("city.json: {e}"))?;
        let catalog: BlockTypesFile =
            serde_json::from_str(types).map_err(|e| format!("block_types.json: {e}"))?;
        let n = file.blocks.len();
        let geometry = Geometry {
            block_tiles: file.block_tiles,
            street_tiles: file.street_tiles,
            blocks: n as u16,
            cell_tiles: file.cell_tiles,
        };
        geometry.validate()?;
        let types: HashMap<String, BlockType> = catalog
            .types
            .into_iter()
            .map(|t| (t.key.clone(), t))
            .collect();
        let mut grid = Vec::with_capacity(n * n);
        for (by, row) in file.blocks.iter().enumerate() {
            if row.len() != n {
                return Err(format!("row {by} has {} blocks, expected {n}", row.len()));
            }
            for (bx, key) in row.iter().enumerate() {
                match types.get(key) {
                    None => return Err(format!("block ({bx},{by}): unknown type {key:?}")),
                    Some(t) if !t.enabled => {
                        return Err(format!("block ({bx},{by}): type {key:?} isn't enabled yet"));
                    }
                    Some(_) => grid.push(key.clone()),
                }
            }
        }
        let [sx, sy] = file.spawn_block;
        if sx as usize >= n || sy as usize >= n {
            return Err("spawn_block is outside the city".into());
        }
        Ok(City {
            name: file.name,
            geometry,
            spawn_block: BlockId { bx: sx, by: sy },
            types,
            grid,
        })
    }

    /// The block type standing at `b`.
    pub fn block_type(&self, b: BlockId) -> &BlockType {
        let n = self.geometry.blocks as usize;
        &self.types[&self.grid[b.by as usize * n + b.bx as usize]]
    }

    /// Every block, row by row.
    pub fn blocks(&self) -> impl Iterator<Item = (BlockId, &BlockType)> {
        let n = self.geometry.blocks as u8;
        (0..n).flat_map(move |by| {
            (0..n).map(move |bx| {
                let b = BlockId { bx, by };
                (b, self.block_type(b))
            })
        })
    }

    /// Ring index of a block: 0 at the centre, 1 around it, …
    pub fn ring(&self, b: BlockId) -> u8 {
        let c = (self.geometry.blocks / 2) as i32;
        (b.bx as i32 - c).abs().max((b.by as i32 - c).abs()) as u8
    }

    /// Every home lot in the city, block by block (ADR 0010, C3).
    pub fn home_lots(&self) -> Vec<String> {
        self.blocks()
            .filter(|(_, t)| t.key == "home")
            .flat_map(|(b, _)| (0..HOME_LOTS).map(move |i| lot_key(b, i)))
            .collect()
    }
}

/// Houses on a home block: three along the north edge, three along the
/// south, one on the west.
pub const HOME_LOTS: u8 = 7;

/// A home lot's id, e.g. `b0_3:5` (block, then the house on it).
pub fn lot_key(b: BlockId, i: u8) -> String {
    format!("{}:{i}", b.key())
}

/// Apartments above the Market's shops (`apt:1`…) and market stalls
/// (`stall:1`…), C4.
pub const APARTMENTS: u8 = 8;
pub const STALLS: u8 = 6;

/// What kind of rentable plot `plot` is in the real city, if it is one.
pub fn plot_kind(plot: &str) -> Option<&'static str> {
    let numbered = |prefix: &str, n: u8| {
        plot.strip_prefix(prefix)
            .and_then(|i| i.parse::<u8>().ok())
            .is_some_and(|i| (1..=n).contains(&i))
    };
    if numbered("apt:", APARTMENTS) {
        Some("apartment")
    } else if numbered("stall:", STALLS) {
        Some("stall")
    } else if city_home_lots().iter().any(|l| l == plot) {
        Some("home")
    } else {
        None
    }
}

/// One tier of something rentable (`assets/city/rent.json`).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RentTier {
    pub tier: i16,
    pub name: String,
    /// Coins per period.
    pub rent: i32,
    /// Homes: furniture pieces that can be placed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub furniture: Option<i64>,
    /// Stalls: goods that can be on show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listings: Option<i64>,
    /// Club rooms: how many members the club can have.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RentKind {
    pub name: String,
    pub tiers: Vec<RentTier>,
}

/// Rent for every kind of plot, by tier.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RentCatalog {
    pub period_secs: i64,
    pub grace_secs: i64,
    pub kinds: std::collections::BTreeMap<String, RentKind>,
}

impl RentCatalog {
    pub fn tier(&self, kind: &str, tier: i16) -> Option<&RentTier> {
        self.kinds.get(kind)?.tiers.iter().find(|t| t.tier == tier)
    }
}

/// The real rent catalog.
pub fn rent_catalog() -> RentCatalog {
    serde_json::from_str(include_str!("../../../../assets/city/rent.json"))
        .expect("assets/city/rent.json is valid")
}

/// The lot ids of the real city (`assets/city/`), for services that check
/// lots without loading the map.
pub fn city_home_lots() -> Vec<String> {
    City::from_json(
        include_str!("../../../../assets/city/city.json"),
        include_str!("../../../../assets/city/block_types.json"),
    )
    .expect("assets/city is valid")
    .home_lots()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo(block: u16) -> Geometry {
        Geometry {
            block_tiles: block,
            street_tiles: 4,
            blocks: 7,
            cell_tiles: (block + 4) / 4,
        }
    }

    fn the_city() -> City {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../assets/city");
        City::from_json(
            &std::fs::read_to_string(format!("{dir}/city.json")).unwrap(),
            &std::fs::read_to_string(format!("{dir}/block_types.json")).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn sizes_for_both_block_sizes() {
        assert_eq!(geo(32).size(), 256, "7 × 36 + 4");
        assert_eq!(geo(48).size(), 368, "7 × 52 + 4");
        let big = Geometry {
            blocks: 20,
            ..geo(48)
        };
        assert_eq!(big.size(), 1044);
        big.validate().unwrap();
    }

    #[test]
    fn global_and_local_round_trip_and_streets() {
        for g in [geo(32), geo(48)] {
            g.validate().unwrap();
            for y in 0..g.size() {
                for x in 0..g.size() {
                    let t = GlobalTile { x, y };
                    if let Place::Block(l) = g.place(t) {
                        assert_eq!(g.to_global(l), t);
                        assert!((l.x as u16) < g.block_tiles && (l.y as u16) < g.block_tiles);
                    }
                }
            }
            // The outer ring and the gaps between blocks are street.
            assert_eq!(g.place(GlobalTile { x: 0, y: 30 }), Place::Street);
            assert_eq!(
                g.place(GlobalTile {
                    x: g.pitch(),
                    y: 30
                }),
                Place::Street
            );
            assert_eq!(
                g.place(GlobalTile {
                    x: g.size() - 1,
                    y: 30
                }),
                Place::Street
            );
        }
    }

    #[test]
    fn streets_split_down_the_middle_and_owned_areas_tile_the_city() {
        let g = geo(48);
        let mut owner_count = vec![0u8; g.size() as usize * g.size() as usize];
        for by in 0..7 {
            for bx in 0..7 {
                let b = BlockId { bx, by };
                let (x0, y0, x1, y1) = g.owned_area(b);
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        assert_eq!(g.owner(GlobalTile { x, y }), b, "({x},{y})");
                        owner_count[y as usize * g.size() as usize + x as usize] += 1;
                    }
                }
            }
        }
        assert!(
            owner_count.iter().all(|&c| c == 1),
            "every tile has exactly one owner"
        );
        // The street between blocks 0 and 1 (x 52..56) splits at 54.
        assert_eq!(g.owner(GlobalTile { x: 53, y: 10 }).bx, 0);
        assert_eq!(g.owner(GlobalTile { x: 54, y: 10 }).bx, 1);
    }

    #[test]
    fn neighbours_near_an_edge() {
        let g = geo(48);
        let mid = g.to_global(LocalTile {
            block: BlockId { bx: 3, by: 3 },
            x: 24,
            y: 24,
        });
        assert_eq!(g.nearby_owners(mid, 12), vec![BlockId { bx: 3, by: 3 }]);
        // Near the north-east corner of block (3,3): four zones.
        let corner = g.to_global(LocalTile {
            block: BlockId { bx: 3, by: 3 },
            x: 46,
            y: 1,
        });
        assert_eq!(g.nearby_owners(corner, 12).len(), 4);
    }

    #[test]
    fn the_city_file_is_valid_and_matches_the_plan() {
        let c = the_city();
        assert_eq!(c.geometry.blocks, 7);
        assert_eq!(c.geometry.size(), 368);
        assert_eq!(c.block_type(c.spawn_block).key, "market");
        let count = |k: &str| c.blocks().filter(|(_, t)| t.key == k).count();
        assert_eq!(count("home"), 24, "the whole outer ring");
        // Two of the first eight club lots became the bowling alley and the arena.
        assert_eq!(count("club_lot") + count("club_hall"), 6);
        for k in [
            "park",
            "pond",
            "museum",
            "cafe",
            "library",
            "cinema",
            "town_hall",
            "arcade",
        ] {
            assert_eq!(count(k), 1, "{k}");
            let (b, _) = c.blocks().find(|(_, t)| t.key == k).unwrap();
            assert_eq!(c.ring(b), 1, "{k} is in ring 1");
        }
        for k in [
            "orchard",
            "woods",
            "meadow",
            "lake",
            "theater",
            "fairground",
            "gallery",
            "casino",
            "bowling",
            "arena",
        ] {
            let (b, _) = c.blocks().find(|(_, t)| t.key == k).unwrap();
            assert_eq!(c.ring(b), 2, "{k} is in ring 2");
        }
        // The park is north of the market and the pond south.
        let at = |k: &str| c.blocks().find(|(_, t)| t.key == k).unwrap().0;
        assert_eq!(at("park"), BlockId { bx: 3, by: 2 });
        assert_eq!(at("pond"), BlockId { bx: 3, by: 4 });
    }

    #[test]
    fn unknown_or_future_types_are_refused() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../assets/city");
        let types = std::fs::read_to_string(format!("{dir}/block_types.json")).unwrap();
        let city = std::fs::read_to_string(format!("{dir}/city.json")).unwrap();
        let future = city.replacen("\"casino\"", "\"karaoke_bar\"", 1);
        assert!(
            City::from_json(&future, &types)
                .unwrap_err()
                .contains("isn't enabled")
        );
        let unknown = city.replacen("\"casino\"", "\"moonbase\"", 1);
        assert!(
            City::from_json(&unknown, &types)
                .unwrap_err()
                .contains("unknown type")
        );
    }

    #[test]
    fn block_keys_round_trip() {
        let b = BlockId { bx: 3, by: 5 };
        assert_eq!(b.key(), "b3_5");
        assert_eq!(BlockId::parse("b3_5"), Some(b));
        assert_eq!(BlockId::parse("x3_5"), None);
    }

    #[test]
    fn home_lots_number_seven_per_home_block() {
        let lots = city_home_lots();
        assert_eq!(lots.len(), 24 * HOME_LOTS as usize);
        assert_eq!(lots[0], "b0_0:0");
        assert!(lots.contains(&"b6_6:6".to_string()));
        assert!(!lots.iter().any(|l| l.starts_with("b3_3")));
    }

    #[test]
    fn plots_and_rent() {
        assert_eq!(plot_kind("b0_0:6"), Some("home"));
        assert_eq!(plot_kind("b0_0:7"), None);
        assert_eq!(plot_kind("apt:8"), Some("apartment"));
        assert_eq!(plot_kind("apt:9"), None);
        assert_eq!(plot_kind("stall:1"), Some("stall"));
        assert_eq!(plot_kind("stall:0"), None);
        let r = rent_catalog();
        for kind in ["home", "apartment", "stall"] {
            let tiers = &r.kinds[kind].tiers;
            assert!(
                tiers.windows(2).all(|w| w[0].rent < w[1].rent),
                "{kind} tiers rise"
            );
            assert_eq!(tiers[0].tier, 1);
        }
        assert_eq!(r.tier("home", 1).unwrap().furniture, Some(12));
        assert!(r.tier("stall", 9).is_none());
    }
}
