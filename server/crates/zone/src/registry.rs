//! Zone definitions loaded from map files, and the live instances of each.

use crate::instance::{Instance, InstanceHandle};
use crate::stats::InstanceSnapshot;
use anyhow::Context;
use commons_protocol::CELL_TILES;
use commons_sim::{Grid, MapFile};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Upper bound on instance numbers a join token may name.
pub const MAX_INSTANCES_PER_ZONE: u16 = 256;

pub struct ZoneDef {
    pub id: String,
    pub map: MapFile,
    pub grid: Grid,
    pub cells_w: u16,
    pub cells_h: u16,
}

impl ZoneDef {
    pub fn new(id: String, map: MapFile) -> Self {
        let grid = map.grid();
        let cells_w = map.width.div_ceil(CELL_TILES);
        let cells_h = map.height.div_ceil(CELL_TILES);
        ZoneDef {
            id,
            map,
            grid,
            cells_w,
            cells_h,
        }
    }
}

pub struct Registry {
    pub secret: Vec<u8>,
    zones: HashMap<String, Arc<ZoneDef>>,
    instances: Mutex<HashMap<(String, u16), InstanceHandle>>,
}

impl Registry {
    /// Loads every `*.json` map in `dir`; the file stem is the zone id.
    pub fn load(dir: &str, secret: Vec<u8>) -> anyhow::Result<Self> {
        let mut zones = HashMap::new();
        for entry in std::fs::read_dir(dir).with_context(|| format!("reading maps dir {dir}"))? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "json") {
                let id = path.file_stem().unwrap().to_string_lossy().to_string();
                let text = std::fs::read_to_string(&path)?;
                let map = MapFile::from_json(&text)
                    .map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
                tracing::info!(zone = %id, name = %map.name, w = map.width, h = map.height, "loaded zone");
                zones.insert(id.clone(), Arc::new(ZoneDef::new(id, map)));
            }
        }
        anyhow::ensure!(!zones.is_empty(), "no maps found in {dir}");
        Ok(Registry {
            secret,
            zones,
            instances: Mutex::new(HashMap::new()),
        })
    }

    pub fn instance(&self, zone: &str, number: u16) -> Option<InstanceHandle> {
        if number == 0 || number > MAX_INSTANCES_PER_ZONE {
            return None;
        }
        let def = self.zones.get(zone)?;
        let mut instances = self.instances.lock().unwrap();
        let handle = instances
            .entry((zone.to_string(), number))
            .or_insert_with(|| Instance::spawn(def.clone(), number));
        Some(handle.clone())
    }

    pub fn stats(&self) -> Vec<InstanceSnapshot> {
        let instances = self.instances.lock().unwrap();
        let mut out: Vec<_> = instances
            .iter()
            .map(|((zone, n), h)| h.stats.snapshot(zone, *n))
            .collect();
        out.sort_by(|a, b| (&a.zone, a.instance).cmp(&(&b.zone, b.instance)));
        out
    }
}
