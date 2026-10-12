//! Zone definitions loaded from map files, and the live instances of each.

use crate::econ::EconomyClient;
use crate::instance::{Instance, InstanceHandle};
use crate::screen::Playlist;
use crate::social::SocialClient;
use crate::stats::InstanceSnapshot;
use anyhow::Context;
use commons_protocol::CELL_TILES;
use commons_sim::furniture::Furniture;
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
    pub furniture: Furniture,
    /// Present when the map has a big screen.
    pub playlist: Option<Arc<Playlist>>,
    /// Present when the map has a pitch with two goals.
    pub pitch: Option<crate::instance::play::Pitch>,
}

impl ZoneDef {
    pub fn new(id: String, map: MapFile, playlist: Option<Arc<Playlist>>) -> Self {
        let grid = map.grid();
        let cells_w = map.width.div_ceil(CELL_TILES);
        let cells_h = map.height.div_ceil(CELL_TILES);
        let furniture = Furniture::from_map(&map);
        let pitch = crate::instance::play::Pitch::from_map(&map);
        let playlist = playlist.filter(|_| map.objects.iter().any(|o| o.kind == "big_screen"));
        ZoneDef {
            id,
            map,
            grid,
            cells_w,
            cells_h,
            furniture,
            playlist,
            pitch,
        }
    }
}

/// Instances are keyed by zone, number and (for homes) owner.
type InstanceKey = (String, u16, Option<String>);

pub struct Registry {
    pub secret: Vec<u8>,
    pub economy: Option<Arc<EconomyClient>>,
    pub social: Option<Arc<SocialClient>>,
    zones: HashMap<String, Arc<ZoneDef>>,
    instances: Mutex<HashMap<InstanceKey, InstanceHandle>>,
}

impl Registry {
    /// Loads every `*.json` map in `dir`; the file stem is the zone id.
    pub fn load(
        dir: &str,
        playlist: Playlist,
        secret: Vec<u8>,
        economy: Option<Arc<EconomyClient>>,
        social: Option<Arc<SocialClient>>,
    ) -> anyhow::Result<Self> {
        let playlist = Arc::new(playlist);
        let mut zones = HashMap::new();
        for entry in std::fs::read_dir(dir).with_context(|| format!("reading maps dir {dir}"))? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "json") {
                let id = path.file_stem().unwrap().to_string_lossy().to_string();
                let text = std::fs::read_to_string(&path)?;
                let map = MapFile::from_json(&text)
                    .map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
                let def = ZoneDef::new(id.clone(), map, Some(playlist.clone()));
                tracing::info!(
                    zone = %id,
                    name = %def.map.name,
                    seats = def.furniture.seats.len(),
                    tables = def.furniture.tables.len(),
                    screen = def.playlist.is_some(),
                    "loaded zone"
                );
                zones.insert(id, Arc::new(def));
            }
        }
        anyhow::ensure!(!zones.is_empty(), "no maps found in {dir}");
        Ok(Registry {
            secret,
            economy,
            social,
            zones,
            instances: Mutex::new(HashMap::new()),
        })
    }

    pub fn instance(
        &self,
        zone: &str,
        number: u16,
        owner: Option<String>,
    ) -> Option<InstanceHandle> {
        if number == 0 || number > MAX_INSTANCES_PER_ZONE {
            return None;
        }
        let def = self.zones.get(zone)?;
        let mut instances = self.instances.lock().unwrap();
        let handle = instances
            .entry((zone.to_string(), number, owner.clone()))
            .or_insert_with(|| {
                Instance::spawn(
                    def.clone(),
                    number,
                    owner,
                    self.economy.clone(),
                    self.social.clone(),
                )
            });
        Some(handle.clone())
    }

    pub fn stats(&self) -> Vec<InstanceSnapshot> {
        let instances = self.instances.lock().unwrap();
        let mut out: Vec<_> = instances
            .iter()
            .map(|((zone, n, _), h)| h.stats.snapshot(zone, *n))
            .collect();
        out.sort_by(|a, b| (&a.zone, a.instance).cmp(&(&b.zone, b.instance)));
        out
    }
}
