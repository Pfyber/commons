//! The bar: drinks from the bartender. A beer costs coins (charged through
//! the economy) and leaves you woozy for a minute, which everyone nearby
//! sees; a glass of water is free and sobers you up.

use super::Instance;
use crate::econ::CallError;
use commons_protocol::{ServerMsg, drink, error_code};

/// Zones with a bar.
const BAR_ZONES: &[&str] = &["bar"];
/// Coin's item id.
const COIN: u32 = 1;

impl Instance {
    pub(super) fn drink(&mut self, id: u32, kind: u8, now: u32) {
        if !BAR_ZONES.contains(&self.zone.id.as_str()) {
            return self.error(id, error_code::NOT_ALLOWED, "there's no bar here");
        }
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.emote_rl.try_take(now as u64) {
            return;
        }
        match kind {
            drink::WATER => self.woozy(id, 0),
            drink::BEER => {
                let Some(econ) = self.economy.clone() else {
                    return self.error(id, error_code::UNAVAILABLE, "the taps are off just now");
                };
                let player = self.avatars[&id].player_id.clone();
                let key = self.next_key("beer");
                self.spawn_call(
                    async move { econ.grant(&player, COIN, -drink::BEER_PRICE, "bar_beer", &key).await },
                    move |inst, result| match result {
                        Ok(applied) if inst.avatars.contains_key(&id) => {
                            inst.send_granted(id, &applied);
                            inst.woozy(id, drink::WOOZY_MS);
                        }
                        Ok(_) => {}
                        Err(CallError::Rejected(_)) => {
                            inst.error(id, error_code::NOT_ALLOWED, "not enough coins for a beer")
                        }
                        Err(CallError::Unavailable) => {
                            inst.error(id, error_code::UNAVAILABLE, "the till's stuck; try again")
                        }
                    },
                );
            }
            _ => {}
        }
    }

    fn woozy(&mut self, id: u32, ms: u32) {
        let cell = self.avatars[&id].cell;
        self.broadcast(cell, &ServerMsg::Woozy { id, ms }, None);
    }
}
