//! Zone map files (`assets/maps/*.json`) and the collision grid derived from them.

use crate::TilePos;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapObject {
    pub kind: String,
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Spawn {
    pub x: u16,
    pub y: u16,
}

/// On-disk map format. Layers are row-major `width * height` arrays; ground and
/// decor values index into their legends, collision is 0 (walkable) / 1 (blocked).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapFile {
    pub name: String,
    pub width: u16,
    pub height: u16,
    pub spawn: Spawn,
    pub ground_legend: Vec<String>,
    pub decor_legend: Vec<String>,
    pub ground: Vec<u8>,
    pub decor: Vec<u8>,
    pub collision: Vec<u8>,
    pub objects: Vec<MapObject>,
}

impl MapFile {
    pub fn from_json(s: &str) -> Result<Self, String> {
        let map: MapFile = serde_json::from_str(s).map_err(|e| e.to_string())?;
        let n = map.width as usize * map.height as usize;
        for (layer, len) in [
            ("ground", map.ground.len()),
            ("decor", map.decor.len()),
            ("collision", map.collision.len()),
        ] {
            if len != n {
                return Err(format!("layer {layer} has {len} cells, expected {n}"));
            }
        }
        let grid = map.grid();
        if !grid.walkable(map.spawn.x, map.spawn.y) {
            return Err("spawn tile is not walkable".into());
        }
        Ok(map)
    }

    pub fn grid(&self) -> Grid {
        Grid {
            w: self.width,
            h: self.height,
            blocked: self.collision.iter().map(|&c| c != 0).collect(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Grid {
    pub w: u16,
    pub h: u16,
    pub blocked: Vec<bool>,
}

impl Grid {
    pub fn open(w: u16, h: u16) -> Self {
        Grid {
            w,
            h,
            blocked: vec![false; w as usize * h as usize],
        }
    }

    #[inline]
    pub fn idx(&self, x: u16, y: u16) -> usize {
        y as usize * self.w as usize + x as usize
    }

    #[inline]
    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w as i32 && y < self.h as i32
    }

    #[inline]
    pub fn walkable(&self, x: u16, y: u16) -> bool {
        x < self.w && y < self.h && !self.blocked[self.idx(x, y)]
    }

    #[inline]
    pub fn walkable_i(&self, x: i32, y: i32) -> bool {
        self.in_bounds(x, y) && !self.blocked[y as usize * self.w as usize + x as usize]
    }

    pub fn set_blocked(&mut self, x: u16, y: u16, blocked: bool) {
        let i = self.idx(x, y);
        self.blocked[i] = blocked;
    }

    /// The walkable tile closest to `p` (spiral search), if any within `radius`.
    pub fn nearest_walkable(&self, p: TilePos, radius: u16) -> Option<TilePos> {
        if self.walkable(p.0, p.1) {
            return Some(p);
        }
        for r in 1..=radius as i32 {
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx.abs() != r && dy.abs() != r {
                        continue;
                    }
                    let (x, y) = (p.0 as i32 + dx, p.1 as i32 + dy);
                    if self.walkable_i(x, y) {
                        return Some((x as u16, y as u16));
                    }
                }
            }
        }
        None
    }
}
