//! The Commons wire protocol (spec §5).
//!
//! Messages are defined once here; `cargo run -p commons-protocol --bin gen-ts`
//! regenerates the client's TypeScript codec from the same definitions.
//!
//! Units: tile coordinates are u16, entity ids are u32 per instance, times are
//! u32 milliseconds since the instance epoch.

pub mod schema;
pub mod ts;
pub mod wire;

pub use wire::{DecodeError, Wire, push_framed, split_frame};

/// Bumped on any incompatible message change.
pub const PROTOCOL_VERSION: u16 = 8;

/// Spatial-hash cell size in tiles (spec §3).
pub const CELL_TILES: u16 = 16;

records! {
    Tile { x: u16, y: u16 }

    /// Everything a client needs to render another avatar, including any
    /// walk in progress so it can be simulated locally, and what it signals
    /// to others (`mood::*`).
    EntityInfo {
        id: u32,
        name: String,
        look: u32,
        x: u16,
        y: u16,
        state: u8,
        speed_x10: u8,
        t0: u32,
        path: Vec<Tile>,
        mood: u8,
    }
}

message_enum! {
    /// Client → server.
    ClientMsg {
        1 Hello { join_token: String, version: u16, view_w: u8, view_h: u8 }
        2 MoveTo { x: u16, y: u16 }
        3 Emote { emote: u8 }
        4 ChatSay { text: String }
        5 Ping { client_t: u32 }
        /// Sit on a seat (a bench tile index, `y * width + x`) or on the
        /// ground with [`SEAT_GROUND`]. Sent while walking to an adjacent
        /// tile, it takes effect on arrival.
        6 Sit { seat: u32 }
        7 Stand {}
        /// A table-game move in UCI notation (`e2e4`, `e7e8q`), or the
        /// actions `new` (rematch after a finished game) and `resign`.
        8 GameMove { table: u32, uci: String }
        /// Cast a line at water tile (x, y), standing within 2 tiles of it.
        9 FishCast { x: u16, y: u16 }
        /// Reel in after a bite; `quality` 0–1000 is the timing mini-game score.
        10 FishReel { quality: u16 }
        /// Garden plot action (`plot_action::*`); `item` is the seed to plant.
        11 PlotAction { x: u16, y: u16, action: u8, item: u32 }
        /// Place a furniture item at (x, y) in your home.
        12 Place { item: u32, x: u16, y: u16 }
        /// Pick up the furniture at (x, y) in your home.
        13 Pickup { x: u16, y: u16 }
        /// Play a note at the bandstand (`instrument::*`, `pitch` 0–7 of a
        /// pentatonic scale) on shared beat `beat` (server time / `BEAT_MS`).
        14 JamNote { instrument: u8, pitch: u8, beat: u32 }
        /// Paint one cell (`y * EASEL_SIZE + x`) of an easel's canvas with a
        /// palette colour (0 erases). Saving goes through the API; this is
        /// the live relay to people nearby.
        15 Paint { easel: u8, cell: u16, color: u8 }
        /// Show others how you'd like company (`mood::*`; 0 clears).
        16 SetMood { mood: u8 }
        /// Offer avatar `to` something done together (`together::*`).
        17 Offer { to: u32, kind: u8 }
        /// Accept `from`'s offer.
        18 Accept { from: u32, kind: u8 }
        /// Release a sky lantern carrying a short wish.
        19 SkyLantern { text: String }
        /// You changed clothes (saved through the API); show it to people nearby.
        20 SetLook { look: u32 }
        /// Step onto your skateboard (or off it, `on: false`). Outdoors only.
        21 Skate { on: bool }
        /// Your pick in a rock paper scissors match (`rps::ROCK`…).
        22 RpsPick { pick: u8 }
    }
}

message_enum! {
    /// Server → client.
    ServerMsg {
        1 Welcome { zone: String, instance: u16, self_id: u32, server_t: u32 }
        2 CellEnter { cell: u16, entities: Vec<EntityInfo> }
        /// `ids` lists the entities in the cell, so the client can drop them
        /// without tracking cell membership itself.
        3 CellLeave { cell: u16, ids: Vec<u32> }
        4 Spawn { entity: EntityInfo }
        5 Despawn { id: u32 }
        /// `path` holds corner waypoints only; the avatar walks straight
        /// lines between them, starting at `path[0]` at time `t0`.
        6 MoveStart { id: u32, speed_x10: u8, t0: u32, path: Vec<Tile> }
        7 Snap { id: u32, x: u16, y: u16 }
        8 EmoteShown { id: u32, emote: u8 }
        9 ChatBubble { id: u32, text: String }
        10 Pong { client_t: u32, server_t: u32 }
        11 Error { code: u16, message: String }
        /// Posture change (`state::*`); `x`/`y` is where the avatar now is.
        12 StateChange { id: u32, state: u8, x: u16, y: u16 }
        /// Full state of a table game. `white`/`black` are entity ids (0 =
        /// empty seat); `legal` lists the side to move's UCI moves.
        13 GameState {
            table: u32,
            status: u8,
            white: u32,
            black: u32,
            fen: String,
            last: String,
            legal: Vec<String>,
        }
        /// What the big screen is showing. Clients play `source` from
        /// `(now - started_t)` so everyone sees the same moment.
        14 ScreenState { screen: u32, title: String, source: String, started_t: u32, duration_ms: u32 }
        /// Fishing progress (`fish_event::*`) for avatar `id`; `item` is the catch.
        15 FishEvent { id: u32, kind: u8, x: u16, y: u16, item: u32 }
        /// A garden plot; `plant` 0 means empty. `stage_ms` is how long each
        /// stage takes and `stage_left_ms` the time left in the current one
        /// (meaningful only while `watered`).
        16 PlotState {
            x: u16,
            y: u16,
            plant: u32,
            stage: u8,
            watered: bool,
            owner: String,
            stage_left_ms: u32,
        }
        /// Furniture at (x, y); `item` 0 means removed.
        17 ObjectUpdate { x: u16, y: u16, item: u32 }
        /// Your inventory changed: `added` received now, `total` held, and
        /// whether it's a first-ever find for the album.
        18 Granted { item: u32, added: u16, total: u32, first: bool }
        /// Someone nearby played a note; play it on `beat`.
        19 JamNote { id: u32, instrument: u8, pitch: u8, beat: u32 }
        /// Someone painted an easel cell.
        20 Painted { id: u32, easel: u8, cell: u16, color: u8 }
        /// The pitch's ball: at (`x`, `y`) at time `t0`, moving at (`vx`,
        /// `vy`) and slowing by `BALL_FRICTION`. Positions are in
        /// 1/`BALL_UNITS` tiles; velocities in 1/`BALL_UNITS` tiles per
        /// second, offset by `BALL_V_OFFSET` (they can be negative). `left`
        /// and `right` are the goals scored at each end.
        21 Ball { x: u16, y: u16, vx: u16, vy: u16, t0: u32, left: u8, right: u8 }
        /// Avatar `id` changed its mood.
        22 MoodShown { id: u32, mood: u8 }
        /// `from` offers you something together; answer with `Accept`.
        23 Offered { from: u32, kind: u8 }
        /// `a` and `b` do something together (a hug, a high five, a dance).
        24 Together { a: u32, b: u32, kind: u8 }
        /// Someone nearby released a sky lantern from (x, y).
        25 LanternRise { id: u32, x: u16, y: u16, text: String }
        /// Avatar `id` changed its look.
        26 LookChanged { id: u32, look: u32 }
        /// A rock paper scissors match between `a` and `b` (`rps::*` phase).
        /// While choosing, picks are hidden (0) and `ends_t` is the deadline;
        /// at the reveal they show what each chose (0: didn't choose in time).
        27 Rps { a: u32, b: u32, phase: u8, a_pick: u8, b_pick: u8, ends_t: u32 }
    }
}

/// Emote ids for `Emote` / `EmoteShown` (spec §7).
pub mod emote {
    pub const WAVE: u8 = 1;
    pub const LAUGH: u8 = 2;
    pub const CLAP: u8 = 3;
    pub const DANCE: u8 = 4;
    pub const SLEEP: u8 = 5;
    pub const CHEER: u8 = 6;
    pub const HEART: u8 = 7;
    pub const MAX: u8 = HEART;
}

/// Looks reserved for non-player characters (the Caretaker).
pub const NPC_LOOKS: [u32; 1] = [0xffff_fff1];

/// `SetMood.mood` / `EntityInfo.mood`.
pub mod mood {
    pub const NONE: u8 = 0;
    /// Happy to chat with anyone: come say hi.
    pub const OPEN: u8 = 1;
    /// Quiet company: sit with me, no need to talk.
    pub const QUIET: u8 = 2;
    /// Up for a game.
    pub const PLAY: u8 = 3;
    pub const MAX: u8 = PLAY;
}

/// `Offer.kind` / `Together.kind`.
pub mod together {
    pub const HUG: u8 = 1;
    pub const HIGH_FIVE: u8 = 2;
    pub const DANCE: u8 = 3;
    /// Walk after someone wherever they go (friends accept on their own).
    pub const FOLLOW: u8 = 4;
    /// Either side ends a follow; just a notice, nothing to accept.
    pub const STOP_FOLLOW: u8 = 5;
    /// A game of rock paper scissors (see `rps`); anyone may be asked.
    pub const RPS: u8 = 6;
    pub const MAX: u8 = RPS;
}

/// Rock paper scissors: picks for `RpsPick` / `Rps`, and `Rps.phase`.
pub mod rps {
    pub const ROCK: u8 = 1;
    pub const PAPER: u8 = 2;
    pub const SCISSORS: u8 = 3;
    /// Both choose within `CHOOSE_MS`.
    pub const CHOOSING: u8 = 0;
    pub const REVEAL: u8 = 1;
    /// Someone left before the reveal.
    pub const CANCELLED: u8 = 2;
    pub const CHOOSE_MS: u32 = 10_000;

    /// Whether pick `a` beats pick `b` (not choosing loses to any pick).
    pub fn beats(a: u8, b: u8) -> bool {
        matches!((a, b), (ROCK, SCISSORS) | (PAPER, ROCK) | (SCISSORS, PAPER))
            || (a != 0 && b == 0)
    }
}

/// Codes for `Error`.
pub mod error_code {
    pub const BAD_MESSAGE: u16 = 1;
    pub const UNAUTHORIZED: u16 = 2;
    pub const VERSION_MISMATCH: u16 = 3;
    pub const NO_PATH: u16 = 4;
    pub const RATE_LIMITED: u16 = 5;
    pub const REPLACED: u16 = 6;
    pub const UNKNOWN_ZONE: u16 = 7;
    pub const SLOW_CONSUMER: u16 = 8;
    pub const SEAT_TAKEN: u16 = 9;
    pub const TOO_FAR: u16 = 10;
    pub const ILLEGAL_MOVE: u16 = 11;
    pub const NOT_ALLOWED: u16 = 12;
    /// A backing service (economy) is unavailable; try again shortly.
    pub const UNAVAILABLE: u16 = 13;
}

/// `PlotAction.action`.
pub mod plot_action {
    pub const PLANT: u8 = 1;
    pub const WATER: u8 = 2;
    pub const HARVEST: u8 = 3;
}

/// `FishEvent.kind`.
pub mod fish_event {
    pub const CAST: u8 = 0;
    pub const BITE: u8 = 1;
    pub const CAUGHT: u8 = 2;
    pub const ESCAPED: u8 = 3;
}

/// Shared jam beat length (a sixteenth note at 120 bpm).
pub const BEAT_MS: u32 = 125;

/// `JamNote.instrument`.
pub mod instrument {
    pub const BELLS: u8 = 0;
    pub const BASS: u8 = 1;
    pub const DRUMS: u8 = 2;
    pub const MAX: u8 = DRUMS;
}

/// Easel canvases are `EASEL_SIZE`² cells; colours index a shared palette of
/// `EASEL_COLORS` (0 = blank).
pub const EASEL_SIZE: u16 = 16;
pub const EASEL_COLORS: u8 = 16;

/// Ball units: positions and velocities are sent in 1/64 tile.
pub const BALL_UNITS: f64 = 64.0;
pub const BALL_V_OFFSET: u16 = 32768;
/// Deceleration in tiles/s².
pub const BALL_FRICTION: f64 = 3.5;

/// `Sit.seat` value for sitting on the ground where you stand.
pub const SEAT_GROUND: u32 = u32::MAX;

/// `GameState.white`/`black` when the Park Elder (the computer opponent) has
/// that side. Players ask for it with `GameMove { uci: "elder" }` while
/// sitting alone at a table.
pub const ELDER_ID: u32 = u32::MAX - 1;

/// `GameState.status`.
pub mod game_status {
    pub const WAITING: u8 = 0;
    pub const PLAYING: u8 = 1;
    pub const WHITE_WON: u8 = 2;
    pub const BLACK_WON: u8 = 3;
    pub const DRAW: u8 = 4;
}

/// Avatar states for `EntityInfo.state`.
pub mod state {
    pub const IDLE: u8 = 0;
    pub const SITTING: u8 = 1;
    pub const FISHING: u8 = 2;
    /// On a skateboard: moves at `SKATE_SPEED_X10`.
    pub const SKATING: u8 = 3;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_server_messages() {
        let info = EntityInfo {
            id: 7,
            name: "Ana ✿".into(),
            look: 0xdead_beef,
            x: 3,
            y: 4,
            state: 0,
            speed_x10: 40,
            t0: 1234,
            path: vec![Tile { x: 3, y: 4 }, Tile { x: 9, y: 4 }],
            mood: 2,
        };
        let msgs = vec![
            ServerMsg::Welcome {
                zone: "founders_park".into(),
                instance: 1,
                self_id: 7,
                server_t: 99,
            },
            ServerMsg::CellEnter {
                cell: 5,
                entities: vec![info.clone(), info.clone()],
            },
            ServerMsg::CellLeave {
                cell: 5,
                ids: vec![1, 2, 3],
            },
            ServerMsg::Spawn { entity: info },
            ServerMsg::Despawn { id: 3 },
            ServerMsg::MoveStart {
                id: 1,
                speed_x10: 40,
                t0: 5,
                path: vec![Tile { x: 1, y: 1 }],
            },
            ServerMsg::Snap { id: 1, x: 2, y: 3 },
            ServerMsg::EmoteShown {
                id: 1,
                emote: emote::HEART,
            },
            ServerMsg::ChatBubble {
                id: 1,
                text: "hi".into(),
            },
            ServerMsg::StateChange {
                id: 1,
                state: state::SITTING,
                x: 4,
                y: 5,
            },
            ServerMsg::GameState {
                table: 99,
                status: game_status::PLAYING,
                white: 1,
                black: 2,
                fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
                last: "".into(),
                legal: vec!["e2e4".into(), "g1f3".into()],
            },
            ServerMsg::ScreenState {
                screen: 1,
                title: "Aquarium".into(),
                source: "scene:aquarium".into(),
                started_t: 10,
                duration_ms: 180_000,
            },
            ServerMsg::Pong {
                client_t: 1,
                server_t: 2,
            },
            ServerMsg::Error {
                code: error_code::NO_PATH,
                message: "no".into(),
            },
        ];
        let mut frame = Vec::new();
        for m in &msgs {
            push_framed(&mut frame, &m.to_bytes());
        }
        let back: Vec<ServerMsg> = split_frame(&frame)
            .map(|b| ServerMsg::decode(b.unwrap()).unwrap())
            .collect();
        assert_eq!(back, msgs);
    }

    #[test]
    fn move_start_fits_budget() {
        // Spec §5.3: ≤ 24 bytes for a MoveStart with a short path.
        let m = ServerMsg::MoveStart {
            id: 1,
            speed_x10: 40,
            t0: 1,
            path: vec![
                Tile { x: 1, y: 1 },
                Tile { x: 5, y: 1 },
                Tile { x: 9, y: 5 },
            ],
        };
        assert!(m.to_bytes().len() <= 24, "{} bytes", m.to_bytes().len());
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(ClientMsg::decode(&[]), Err(DecodeError::Eof));
        assert_eq!(ClientMsg::decode(&[200]), Err(DecodeError::UnknownTag(200)));
        assert_eq!(ClientMsg::decode(&[3, 1, 0]), Err(DecodeError::Trailing(1)));
        // Vec length larger than remaining bytes.
        assert_eq!(
            ServerMsg::decode(&[3, 0, 0, 0xff, 0xff]),
            Err(DecodeError::Eof)
        );
        assert_eq!(
            ClientMsg::decode(&[4, 2, 0, 0xff, 0xfe]),
            Err(DecodeError::Utf8)
        );
        let truncated: Vec<_> = split_frame(&[5, 0, 1]).collect();
        assert_eq!(truncated, vec![Err(DecodeError::Eof)]);
    }

    #[test]
    fn generated_typescript_is_up_to_date() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../client/src/net/protocol.gen.ts"
        );
        let on_disk = std::fs::read_to_string(path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert!(
            on_disk == ts::generate(),
            "client/src/net/protocol.gen.ts is stale: run `cargo run -p commons-protocol --bin gen-ts`"
        );
    }
}
