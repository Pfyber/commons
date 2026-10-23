//! In-memory presence (spec §4.1 social gateway): who is connected, where
//! they are, and how to push to them. A single gateway process holds this for
//! now; with several gateways it moves to Redis + NATS (M5).

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use uuid::Uuid;

/// How long a home invitation stays valid.
pub const INVITE_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Location {
    pub zone: String,
    pub instance: u16,
    /// For homes: whose home it is.
    pub owner: Option<String>,
    /// Human-readable, e.g. "Founders' Park · 1" or "at home".
    pub label: String,
}

#[derive(Default)]
struct Inner {
    sockets: HashMap<Uuid, HashMap<u64, mpsc::Sender<String>>>,
    locations: HashMap<Uuid, Location>,
    /// Timestamp of the newest presence report applied per player.
    last_report: HashMap<Uuid, i64>,
    invites: HashMap<(Uuid, Uuid), Instant>,
    next_conn: u64,
}

#[derive(Default)]
pub struct Hub(Mutex<Inner>);

impl Hub {
    /// Registers a socket; returns its id and whether the player just came online.
    pub fn connect(&self, player: Uuid, tx: mpsc::Sender<String>) -> (u64, bool) {
        let mut h = self.0.lock().unwrap();
        h.next_conn += 1;
        let id = h.next_conn;
        let conns = h.sockets.entry(player).or_default();
        let first = conns.is_empty();
        conns.insert(id, tx);
        (id, first)
    }

    /// Removes a socket; returns true if the player is now offline.
    pub fn disconnect(&self, player: Uuid, conn: u64) -> bool {
        let mut h = self.0.lock().unwrap();
        let Some(conns) = h.sockets.get_mut(&player) else {
            return false;
        };
        conns.remove(&conn);
        if conns.is_empty() {
            h.sockets.remove(&player);
            return true;
        }
        false
    }

    pub fn online(&self, player: Uuid) -> bool {
        self.0.lock().unwrap().sockets.contains_key(&player)
    }

    /// Pushes a JSON message to everyone online (dropped where full).
    pub fn broadcast(&self, msg: &serde_json::Value) {
        let text = msg.to_string();
        let h = self.0.lock().unwrap();
        for tx in h.sockets.values().flat_map(|c| c.values()) {
            let _ = tx.try_send(text.clone());
        }
    }

    /// Pushes a JSON message to every socket of `player` (dropped if full).
    pub fn send(&self, player: Uuid, msg: &serde_json::Value) {
        let text = msg.to_string();
        let h = self.0.lock().unwrap();
        if let Some(conns) = h.sockets.get(&player) {
            for tx in conns.values() {
                let _ = tx.try_send(text.clone());
            }
        }
    }

    pub fn location(&self, player: Uuid) -> Option<Location> {
        self.0.lock().unwrap().locations.get(&player).cloned()
    }

    /// Applies a zone's arrival (`present`) or departure report. Reports older
    /// than the newest one applied are ignored, and a departure only clears the
    /// location if the player is still there, so a late "left the park" can't
    /// erase a newer "arrived home". Returns true if anything changed.
    pub fn set_location(&self, player: Uuid, loc: Location, present: bool, at_ms: i64) -> bool {
        let mut h = self.0.lock().unwrap();
        if h.last_report.get(&player).is_some_and(|last| at_ms < *last) {
            return false;
        }
        h.last_report.insert(player, at_ms);
        if present {
            return h.locations.insert(player, loc.clone()).as_ref() != Some(&loc);
        }
        let same_place = h.locations.get(&player).is_some_and(|l| {
            l.zone == loc.zone && l.instance == loc.instance && l.owner == loc.owner
        });
        if same_place {
            h.locations.remove(&player);
        }
        same_place
    }

    pub fn invite(&self, owner: Uuid, guest: Uuid) {
        let mut h = self.0.lock().unwrap();
        let now = Instant::now();
        h.invites
            .retain(|_, at| now.duration_since(*at) < INVITE_TTL);
        h.invites.insert((owner, guest), now);
    }

    pub fn invited(&self, owner: Uuid, guest: Uuid) -> bool {
        let h = self.0.lock().unwrap();
        h.invites
            .get(&(owner, guest))
            .is_some_and(|at| at.elapsed() < INVITE_TTL)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loc(zone: &str) -> Location {
        Location {
            zone: zone.into(),
            instance: 1,
            owner: None,
            label: zone.into(),
        }
    }

    #[test]
    fn presence_and_stale_leave() {
        let hub = Hub::default();
        let p = Uuid::new_v4();
        let (tx, mut rx) = mpsc::channel(4);
        let (c1, first) = hub.connect(p, tx.clone());
        assert!(first && hub.online(p));
        let (c2, first) = hub.connect(p, tx);
        assert!(!first);
        hub.send(p, &serde_json::json!({ "t": "x" }));
        assert!(
            rx.try_recv().is_ok() && rx.try_recv().is_ok(),
            "both sockets get it"
        );
        assert!(!hub.disconnect(p, c1));
        assert!(hub.disconnect(p, c2));

        // Arrive home, then a late "left the park" report must not clear it.
        hub.set_location(p, loc("founders_park"), true, 1);
        hub.set_location(p, loc("home"), true, 3);
        assert!(!hub.set_location(p, loc("founders_park"), false, 2));
        assert_eq!(hub.location(p).unwrap().zone, "home");
        // Rejoining the same place: a departure report that arrives late is stale.
        hub.set_location(p, loc("home"), true, 5);
        assert!(!hub.set_location(p, loc("home"), false, 4));
        assert!(hub.location(p).is_some());
        assert!(hub.set_location(p, loc("home"), false, 6));
        assert!(hub.location(p).is_none());
    }

    #[test]
    fn invites_are_directional() {
        let hub = Hub::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        hub.invite(a, b);
        assert!(hub.invited(a, b));
        assert!(!hub.invited(b, a));
    }
}
