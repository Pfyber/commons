//! Client for the economy service's internal endpoints (spec §4.1: zone
//! servers request grants, they never change inventory themselves).
//! Every mutating call carries an idempotency key, so retries are safe.

use commons_common::token::{self, ServiceClaims};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallError {
    /// The economy refused (not enough items, occupied, …); show the message.
    Rejected(String),
    /// Network or server trouble; try again later.
    Unavailable,
}

/// One player's activity since the last report.
#[derive(Debug, Clone, Serialize)]
pub struct ActivityRow {
    pub player: String,
    pub secs: u32,
    pub interactions: u32,
    /// Sat down with someone (a shared bench, a game of chess): one of the
    /// Caretaker's first tasks.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub sat_together: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Applied {
    #[serde(default)]
    pub totals: Vec<(i32, i32)>,
    #[serde(default)]
    pub added: Vec<(i32, i32)>,
    #[serde(default)]
    pub firsts: Vec<i32>,
}

/// A club-room piece picked up: the bag update, and whose bag it was.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClubPickup {
    #[serde(flatten)]
    pub applied: Applied,
    pub to: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Plot {
    pub x: i16,
    pub y: i16,
    pub owner_name: String,
    pub plant: i32,
    pub stage: i16,
    pub stage_started_ms: i64,
    pub watered: bool,
    #[serde(default)]
    pub uv: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlotResult {
    pub plot: Option<Plot>,
    pub applied: Applied,
}

/// A player's saved look (`look`), what they wear from the mall (`style`),
/// the pet out on a walk with them (`pet`, 0 for none) and what they ride.
#[derive(Debug, Clone, Deserialize)]
pub struct SavedLook {
    pub look: u32,
    pub style: u32,
    #[serde(default)]
    pub pet: u16,
    /// What they're riding (`commons_sim::vehicles`), 0 on foot.
    #[serde(default)]
    pub vehicle: u8,
    /// The rod (low four bits) and watering can they use.
    #[serde(default)]
    pub tool: u8,
    /// The instruments and toys they own: bit `code` for each.
    #[serde(default)]
    pub kit: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HomeObject {
    pub x: i16,
    pub y: i16,
    pub item: i32,
    #[serde(default)]
    pub layer: i16,
    /// A fish tank's fish.
    #[serde(default)]
    pub fish: Vec<i32>,
    /// Quarter turns.
    #[serde(default)]
    pub rot: i16,
    /// When its fish last ate (unix seconds).
    #[serde(default)]
    pub fed: i64,
}

/// A tank changed: what it holds now, and the bag's change.
/// A tank fed: when, and the bag's change.
#[derive(Debug, Clone, Deserialize)]
pub struct TankFed {
    pub fed: i64,
    pub applied: Applied,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TankDone {
    pub fish: Vec<i32>,
    pub applied: Applied,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogItem {
    id: i32,
    kind: String,
    name: String,
    rarity: i16,
    meta: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FishInfo {
    pub id: u32,
    pub weight: u32,
    pub rarity: i16,
    pub night: bool,
}

/// The parts of the catalogue the zone server needs.
#[derive(Debug, Default)]
pub struct ZoneCatalog {
    pub fish: Vec<FishInfo>,
    /// What a magnet brings up from the bottom (by the same odds as fish).
    pub scrap: Vec<FishInfo>,
    /// seed item → plant item
    pub seeds: HashMap<u32, u32>,
    pub furniture: HashSet<u32>,
    /// Furniture that turns on and off (lights, the TV…), and fish tanks (how many they hold).
    pub toggles: HashSet<u32>,
    pub tanks: HashMap<u32, u8>,
    /// Tables (things stand on them), the small things that do, and what hangs on a wall.
    pub surfaces: HashSet<u32>,
    pub tops: HashSet<u32>,
    pub walls: HashSet<u32>,
    /// Wall pieces that may stand on the floor too.
    pub stands: HashSet<u32>,
    /// Pots things grow in, and the lights that speed them up.
    pub planters: HashSet<u32>,
    pub uv: HashSet<u32>,
    /// What can be sat on, and what can be walked over (rugs).
    pub seats: HashSet<u32>,
    pub walk: HashSet<u32>,
    /// Garden ponds (two tiles by two, and fishable).
    pub ponds: HashSet<u32>,
    /// Set up anywhere outdoors (a lawn chair), not kept.
    pub portable: HashSet<u32>,
    pub names: HashMap<u32, String>,
}

impl ZoneCatalog {
    fn from_items(items: Vec<CatalogItem>) -> Self {
        let mut c = ZoneCatalog::default();
        for it in items {
            let id = it.id as u32;
            c.names.insert(id, it.name);
            let meta = |k: &str| it.meta.get(k).and_then(|v| v.as_i64());
            match it.kind.as_str() {
                "fish" | "junk" => c.fish.push(FishInfo {
                    id,
                    weight: meta("weight").unwrap_or(1) as u32,
                    rarity: it.rarity,
                    night: it
                        .meta
                        .get("night")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                }),
                "scrap" => c.scrap.push(FishInfo {
                    id,
                    weight: meta("weight").unwrap_or(1) as u32,
                    rarity: it.rarity,
                    night: false,
                }),
                "seed" => {
                    if let Some(p) = meta("grows") {
                        c.seeds.insert(id, p as u32);
                    }
                }
                "furniture" => {
                    c.furniture.insert(id);
                    if it.meta.get("use").and_then(|v| v.as_str()) == Some("toggle") {
                        c.toggles.insert(id);
                    }
                    if let Some(n) = meta("tank") {
                        c.tanks.insert(id, n.clamp(1, 20) as u8);
                    }
                    let flag = |k: &str| it.meta.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
                    if meta("surface").is_some() {
                        c.surfaces.insert(id);
                    }
                    if flag("top") {
                        c.tops.insert(id);
                    }
                    if flag("stands") {
                        c.stands.insert(id);
                    }
                    if flag("planter") {
                        c.planters.insert(id);
                    }
                    if flag("uv") {
                        c.uv.insert(id);
                    }
                    if flag("seat") {
                        c.seats.insert(id);
                    }
                    if flag("walk") {
                        c.walk.insert(id);
                    }
                    if flag("pond") {
                        c.ponds.insert(id);
                    }
                    if flag("portable") {
                        c.portable.insert(id);
                    }
                    if flag("wall") {
                        c.walls.insert(id);
                    }
                }
                _ => {}
            }
        }
        c
    }
}

pub struct EconomyClient {
    http: reqwest::Client,
    base: String,
    secret: Vec<u8>,
    catalog: RwLock<Option<Arc<ZoneCatalog>>>,
}

#[derive(Deserialize)]
struct ErrBody {
    message: String,
}

impl EconomyClient {
    pub fn new(base: String, secret: Vec<u8>) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("http client");
        Arc::new(EconomyClient {
            http,
            base,
            secret,
            catalog: RwLock::new(None),
        })
    }

    pub fn catalog(&self) -> Option<Arc<ZoneCatalog>> {
        self.catalog.read().unwrap().clone()
    }

    /// Loads the catalogue, retrying until the API is up.
    pub async fn load_catalog_forever(self: Arc<Self>) {
        #[derive(Deserialize)]
        struct Resp {
            items: Vec<CatalogItem>,
        }
        loop {
            match self
                .call::<(), Resp>(reqwest::Method::GET, "/api/catalog", None)
                .await
            {
                Ok(r) => {
                    let c = ZoneCatalog::from_items(r.items);
                    tracing::info!(
                        fish = c.fish.len(),
                        seeds = c.seeds.len(),
                        "catalogue loaded from api"
                    );
                    *self.catalog.write().unwrap() = Some(Arc::new(c));
                    return;
                }
                Err(_) => {
                    tracing::warn!(base = %self.base, "economy api not reachable yet; retrying");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            }
        }
    }

    async fn call<B: Serialize, R: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<R, CallError> {
        let auth = token::sign(&self.secret, &ServiceClaims { svc: "zone".into() }, 60);
        let mut req = self
            .http
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(auth);
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await.map_err(|e| {
            tracing::warn!(error = %e, path, "economy call failed");
            CallError::Unavailable
        })?;
        let status = resp.status();
        if status.is_success() {
            return resp.json::<R>().await.map_err(|e| {
                tracing::error!(error = %e, path, "economy response didn't parse");
                CallError::Unavailable
            });
        }
        if status.is_server_error() {
            return Err(CallError::Unavailable);
        }
        let msg = resp
            .json::<ErrBody>()
            .await
            .map(|b| b.message)
            .unwrap_or_else(|_| "that didn't work".into());
        Err(CallError::Rejected(msg))
    }

    /// Time present and interactions per player, for activity days.
    /// Fire-and-forget: a lost report only costs a minute of activity.
    pub fn report_activity(self: &Arc<Self>, rows: Vec<ActivityRow>) {
        let body = serde_json::json!({ "rows": rows });
        let this = self.clone();
        tokio::spawn(async move {
            if let Err(e) = this
                .call::<_, serde_json::Value>(
                    reqwest::Method::POST,
                    "/internal/activity",
                    Some(&body),
                )
                .await
            {
                tracing::debug!(?e, "activity report failed");
            }
        });
    }

    pub async fn grant(
        &self,
        player: &str,
        item: u32,
        delta: i32,
        reason: &str,
        key: &str,
    ) -> Result<Applied, CallError> {
        let body = serde_json::json!({ "player": player, "item": item, "delta": delta, "reason": reason, "key": key });
        self.call(reqwest::Method::POST, "/internal/grant", Some(&body))
            .await
    }

    /// How many of `item` the player holds.
    pub async fn has(&self, player: &str, item: u32) -> Result<i64, CallError> {
        let path = format!("/internal/has?player={}&item={item}", urlencode(player));
        let r: serde_json::Value = self
            .call::<(), _>(reqwest::Method::GET, &path, None)
            .await?;
        Ok(r.get("qty").and_then(|v| v.as_i64()).unwrap_or(0))
    }

    pub async fn plots(&self, space: &str) -> Result<Vec<Plot>, CallError> {
        let path = format!("/internal/plots?space={}", urlencode(space));
        self.call::<(), _>(reqwest::Method::GET, &path, None).await
    }

    pub async fn plant(
        &self,
        space: &str,
        x: u16,
        y: u16,
        player: &str,
        seed: u32,
        key: &str,
    ) -> Result<PlotResult, CallError> {
        let body = serde_json::json!({ "space": space, "x": x, "y": y, "player": player, "seed": seed, "key": key });
        self.call(reqwest::Method::POST, "/internal/plots/plant", Some(&body))
            .await
    }

    pub async fn water(&self, space: &str, x: u16, y: u16) -> Result<Option<Plot>, CallError> {
        let body = serde_json::json!({ "space": space, "x": x, "y": y });
        self.call(reqwest::Method::POST, "/internal/plots/water", Some(&body))
            .await
    }

    pub async fn harvest(
        &self,
        space: &str,
        x: u16,
        y: u16,
        player: &str,
        key: &str,
    ) -> Result<PlotResult, CallError> {
        let body =
            serde_json::json!({ "space": space, "x": x, "y": y, "player": player, "key": key });
        self.call(
            reqwest::Method::POST,
            "/internal/plots/harvest",
            Some(&body),
        )
        .await
    }

    pub async fn player_look(&self, player: &str) -> Result<SavedLook, CallError> {
        self.call::<(), _>(
            reqwest::Method::GET,
            &format!("/internal/look/{player}"),
            None,
        )
        .await
    }

    /// Adds to a player's tally for the leaderboards (`arena_wins`, `paintball_wins`).
    pub async fn stat_add(
        &self,
        player: &str,
        stat: &str,
        n: i64,
    ) -> Result<serde_json::Value, CallError> {
        let body = serde_json::json!({ "player": player, "stat": stat, "n": n });
        self.call(reqwest::Method::POST, "/internal/stats/add", Some(&body))
            .await
    }

    pub async fn home_objects(&self, owner: &str) -> Result<Vec<HomeObject>, CallError> {
        self.call::<(), _>(
            reqwest::Method::GET,
            &format!("/internal/home/{owner}/objects"),
            None,
        )
        .await
    }

    /// Every front yard's pieces.
    pub async fn yard_objects(&self) -> Result<Vec<HomeObject>, CallError> {
        self.call::<(), _>(reqwest::Method::GET, "/internal/home-yards/objects", None)
            .await
    }

    /// A pinch of fish food for the tank at (x, y).
    pub async fn tank_feed(
        &self,
        owner: &str,
        x: u16,
        y: u16,
        layer: u8,
        key: &str,
    ) -> Result<TankFed, CallError> {
        let body =
            serde_json::json!({ "owner": owner, "x": x, "y": y, "layer": layer, "key": key });
        self.call(
            reqwest::Method::POST,
            "/internal/home/tank/feed",
            Some(&body),
        )
        .await
    }

    /// A fish from `owner`'s bag into the tank at (x, y).
    pub async fn tank_put(
        &self,
        owner: &str,
        x: u16,
        y: u16,
        layer: u8,
        fish: u32,
        key: &str,
    ) -> Result<TankDone, CallError> {
        let body = serde_json::json!({ "owner": owner, "x": x, "y": y, "layer": layer, "fish": fish, "key": key });
        self.call(
            reqwest::Method::POST,
            "/internal/home/tank/put",
            Some(&body),
        )
        .await
    }

    /// The `index`th fish out of the tank at (x, y), back to the bag.
    pub async fn tank_take(
        &self,
        owner: &str,
        x: u16,
        y: u16,
        layer: u8,
        index: u8,
        key: &str,
    ) -> Result<TankDone, CallError> {
        let body = serde_json::json!({ "owner": owner, "x": x, "y": y, "layer": layer, "index": index, "key": key });
        self.call(
            reqwest::Method::POST,
            "/internal/home/tank/take",
            Some(&body),
        )
        .await
    }

    pub async fn place(
        &self,
        owner: &str,
        item: u32,
        x: u16,
        y: u16,
        layer: u8,
        rot: u8,
        lot: Option<&str>,
        key: &str,
    ) -> Result<Applied, CallError> {
        let body = serde_json::json!({ "owner": owner, "item": item, "x": x, "y": y, "layer": layer, "rot": rot, "lot": lot, "key": key });
        self.call(reqwest::Method::POST, "/internal/home/place", Some(&body))
            .await
    }

    /// Furniture in club `club`'s room (ADR 0014, C2).
    pub async fn club_objects(&self, club: &str) -> Result<Vec<HomeObject>, CallError> {
        self.call::<(), _>(
            reqwest::Method::GET,
            &format!("/internal/club/{}/objects", urlencode(club)),
            None,
        )
        .await
    }

    /// A member puts a piece from their bag in the club's room.
    pub async fn club_place(
        &self,
        club: &str,
        player: &str,
        item: u32,
        x: u16,
        y: u16,
        key: &str,
    ) -> Result<Applied, CallError> {
        let body = serde_json::json!({ "club": club, "player": player, "item": item, "x": x, "y": y, "key": key });
        self.call(reqwest::Method::POST, "/internal/club/place", Some(&body))
            .await
    }

    /// Picks a piece up in a club room: it goes back to its placer's bag
    /// (`to` says whose).
    pub async fn club_pickup(
        &self,
        club: &str,
        player: &str,
        x: u16,
        y: u16,
        key: &str,
    ) -> Result<ClubPickup, CallError> {
        let body =
            serde_json::json!({ "club": club, "player": player, "x": x, "y": y, "key": key });
        self.call(reqwest::Method::POST, "/internal/club/pickup", Some(&body))
            .await
    }

    pub async fn pickup(
        &self,
        owner: &str,
        x: u16,
        y: u16,
        layer: u8,
        yard: bool,
        key: &str,
    ) -> Result<Applied, CallError> {
        let body = serde_json::json!({ "owner": owner, "x": x, "y": y, "layer": layer, "yard": yard, "key": key });
        self.call(reqwest::Method::POST, "/internal/home/pickup", Some(&body))
            .await
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
impl EconomyClient {
    /// A client with a preloaded catalogue and no reachable API.
    pub fn with_catalog(c: ZoneCatalog) -> Arc<Self> {
        let e = EconomyClient::new("http://127.0.0.1:9".into(), b"test".to_vec());
        *e.catalog.write().unwrap() = Some(Arc::new(c));
        e
    }
}

#[cfg(test)]
impl ZoneCatalog {
    pub fn for_tests() -> Self {
        let fish = vec![
            FishInfo {
                id: 100,
                weight: 40,
                rarity: 0,
                night: false,
            },
            FishInfo {
                id: 105,
                weight: 2,
                rarity: 3,
                night: false,
            },
            FishInfo {
                id: 106,
                weight: 3,
                rarity: 2,
                night: true,
            },
            FishInfo {
                id: 107,
                weight: 10,
                rarity: 0,
                night: false,
            },
        ];
        ZoneCatalog {
            fish,
            scrap: vec![
                FishInfo {
                    id: 121,
                    weight: 50,
                    rarity: 0,
                    night: false,
                },
                FishInfo {
                    id: 127,
                    weight: 1,
                    rarity: 4,
                    night: false,
                },
            ],
            seeds: [(200, 300)].into(),
            furniture: [400, 445].into(),
            toggles: [434].into(),
            tanks: [(445, 3)].into(),
            surfaces: [454].into(),
            tops: [445, 460].into(),
            walls: [430].into(),
            stands: Default::default(),
            planters: Default::default(),
            uv: Default::default(),
            seats: Default::default(),
            walk: Default::default(),
            ponds: Default::default(),
            portable: Default::default(),
            names: Default::default(),
        }
    }
}
