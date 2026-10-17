//! Things to wear from the mall (ADR 0011, M4): outfits, hats, accessories
//! and full-body skins. Each is an item of that kind with a `code` in its
//! meta; what a player wears is their `style`, a byte per slot (outfit, hat,
//! accessory, skin, low to high), 0 for none. Bought once and kept: they're
//! account-bound, so never sold back, given or put on a stall.

use crate::economy::{Catalog, Item};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

/// The slots, in the order of their bytes in `style`.
pub const SLOTS: [&str; 4] = ["outfit", "hat", "accessory", "skin"];

/// Whether `kind` is something to wear.
pub fn is_cosmetic(kind: &str) -> bool {
    SLOTS.contains(&kind)
}

/// The item worn in each slot of `style` (slot, code), skipping empty ones.
pub fn worn(style: u32) -> Vec<(&'static str, u8)> {
    SLOTS
        .iter()
        .enumerate()
        .map(|(i, &slot)| (slot, (style >> (8 * i)) as u8))
        .filter(|&(_, code)| code != 0)
        .collect()
}

/// The item with `code` in `slot`.
pub fn item_for<'a>(catalog: &'a Catalog, slot: &'a str, code: u8) -> Option<&'a Item> {
    catalog
        .of_kind(slot)
        .find(|i| i.meta.get("code").and_then(|c| c.as_u64()) == Some(code as u64))
}

/// Everything in `style` exists and `player` owns it.
pub async fn check_owned(
    db: &PgPool,
    catalog: &Catalog,
    player: Uuid,
    style: u32,
) -> ApiResult<()> {
    for (slot, code) in worn(style) {
        let item = item_for(catalog, slot, code)
            .ok_or_else(|| ApiError::bad_request("bad_style", "There's no such thing to wear."))?;
        let have: i32 = sqlx::query_scalar(
            "SELECT coalesce((SELECT qty FROM inventory WHERE player_id = $1 AND item_id = $2), 0)",
        )
        .bind(player)
        .bind(item.id)
        .fetch_one(db)
        .await
        .map_err(db_err)?;
        if have < 1 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "not_yours",
                format!("You don't have the {} yet.", item.name),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn style_bytes_are_slots() {
        assert_eq!(worn(0), vec![]);
        assert_eq!(
            worn(0x0300_0201),
            vec![("outfit", 1), ("hat", 2), ("skin", 3)]
        );
    }
}
