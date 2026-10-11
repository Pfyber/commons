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
pub const PROTOCOL_VERSION: u16 = 2;

/// Spatial-hash cell size in tiles (spec §3).
pub const CELL_TILES: u16 = 16;

records! {
    Tile { x: u16, y: u16 }

    /// Everything a client needs to render another avatar, including any
    /// walk in progress so it can be simulated locally.
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
}

/// `Sit.seat` value for sitting on the ground where you stand.
pub const SEAT_GROUND: u32 = u32::MAX;

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
