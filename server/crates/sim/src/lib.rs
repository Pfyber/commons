//! Deterministic simulation shared by the server, bots and (later, via WASM)
//! the client. Everything here must give identical results on every platform:
//! integer costs, fixed neighbour order, explicit tie-breaking.

pub mod furniture;
pub mod garden;
pub mod map;
pub mod motion;
pub mod path;

pub use map::{Grid, MapFile};
pub use motion::{Motion, WALK_SPEED_X10};
pub use path::{compress, find_path};

pub type TilePos = (u16, u16);

/// Seedlings in the Founders' Grove (spec §11): the founding season closes
/// when every slot has a founder's tree. The park map has exactly this many
/// `grove_slot` objects.
pub const GROVE_SLOTS: usize = 80;
