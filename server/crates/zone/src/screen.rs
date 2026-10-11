//! The big screen's programme (spec §7: synced screen, timestamp sync).
//!
//! The schedule is a pure function of the instance clock: programme `i`
//! starts when the previous ones have run, looping forever. Every client plays
//! the current source from `now - started_t`, so all viewers see the same
//! moment. Sources are `scene:<name>` (procedural broadcasts drawn by the
//! client, no licensing needed) or a video URL the Caretaker has rights to.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Programme {
    pub title: String,
    pub source: String,
    pub duration_s: u32,
}

#[derive(Debug, Clone)]
pub struct Playlist {
    items: Vec<Programme>,
    total_ms: u64,
}

impl Default for Playlist {
    fn default() -> Self {
        let p = |title: &str, source: &str, duration_s| Programme {
            title: title.into(),
            source: source.into(),
            duration_s,
        };
        Playlist::new(vec![
            p("The Pond, Underwater", "scene:aquarium", 240),
            p("Stars over the Park", "scene:stars", 240),
            p("Town Noticeboard", "scene:notice", 90),
        ])
    }
}

impl Playlist {
    pub fn new(items: Vec<Programme>) -> Self {
        let items: Vec<_> = items.into_iter().filter(|p| p.duration_s > 0).collect();
        let total_ms = items.iter().map(|p| p.duration_s as u64 * 1000).sum();
        Playlist { items, total_ms }
    }

    /// Loads `path` if it exists, otherwise the built-in programme.
    pub fn load(path: &str) -> anyhow::Result<Self> {
        match std::fs::read_to_string(path) {
            Ok(text) => {
                let items: Vec<Programme> = serde_json::from_str(&text)?;
                anyhow::ensure!(
                    items.iter().any(|p| p.duration_s > 0),
                    "{path}: playlist is empty"
                );
                Ok(Playlist::new(items))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Playlist::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// The programme showing at instance time `now`, its index and start time.
    pub fn at(&self, now: u32) -> (usize, &Programme, u32) {
        let loop_start = now as u64 - now as u64 % self.total_ms;
        let mut start = loop_start;
        for (i, p) in self.items.iter().enumerate() {
            let end = start + p.duration_s as u64 * 1000;
            if (now as u64) < end {
                return (i, p, start as u32);
            }
            start = end;
        }
        unreachable!("now always falls inside the loop")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_loops() {
        let pl = Playlist::default();
        assert_eq!(pl.at(0).0, 0);
        assert_eq!(pl.at(239_999).0, 0);
        let (i, p, start) = pl.at(240_000);
        assert_eq!((i, p.source.as_str(), start), (1, "scene:stars", 240_000));
        let total = 570_000;
        assert_eq!(pl.at(total + 5).2, total);
        assert_eq!(pl.at(total + 500_000).0, 2);
    }
}
