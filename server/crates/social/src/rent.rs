//! Renting (ADR 0010, C4): every house, apartment, market stall and club
//! room is leased for coins per period, by tier (`assets/city/rent.json`).
//! Nothing is ever bought, and nothing is lost when a lease ends: furniture
//! and stall goods go back to the player's bag. A club room's rent comes
//! out of the club's treasury (ADR 0014), and its notices go to the club's
//! owner and moderators.
//!
//! - Opening a lease pays the first period up front.
//! - A sweeper renews leases as they come due; one that can't be paid gets
//!   a grace period (and a notice), then ends.
//! - Upgrading pays the difference for the current period; downgrading is
//!   free, as long as what's there still fits.
//!
//! Players: `GET /api/social/rent`, `POST /api/social/rent/{tier,pay,end}`.

use crate::State as SocialState;
use crate::routes::{db_err, me};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_common::config;
use commons_sim::city::{RentCatalog, RentTier, rent_catalog};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgConnection, PgPool, Row};
use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The rent catalog, with the period and grace overridable for testing
/// (`COMMONS_RENT_PERIOD_SECS`, `COMMONS_RENT_GRACE_SECS`).
pub static RENT: LazyLock<RentCatalog> = LazyLock::new(|| {
    let mut r = rent_catalog();
    r.period_secs = config::env_or("COMMONS_RENT_PERIOD_SECS", r.period_secs);
    r.grace_secs = config::env_or("COMMONS_RENT_GRACE_SECS", r.grace_secs);
    r
});

/// "home" (a house or an apartment), "stall" or "club" (a club room).
pub fn slot_of(kind: &str) -> &'static str {
    match kind {
        "stall" => "stall",
        "club_room" => "club",
        _ => "home",
    }
}

#[derive(Debug, Clone)]
pub struct Lease {
    pub id: i64,
    pub kind: String,
    pub plot: String,
    pub player: Uuid,
    pub tier: i16,
    pub periods_paid: i32,
    pub paid_until: i64,
    pub grace_until: Option<i64>,
    pub state: String,
    /// A club room: the club it's for (rent from its treasury).
    pub club: Option<Uuid>,
}

pub(crate) const LEASE_COLS: &str = "id, kind, plot, player_id, tier, periods_paid, \
     extract(epoch FROM paid_until)::bigint AS paid_until, \
     extract(epoch FROM grace_until)::bigint AS grace_until, state, club_id";

pub(crate) fn lease_row(r: &sqlx::postgres::PgRow) -> Lease {
    Lease {
        id: r.get("id"),
        kind: r.get("kind"),
        plot: r.get("plot"),
        player: r.get("player_id"),
        tier: r.get("tier"),
        periods_paid: r.get("periods_paid"),
        paid_until: r.get("paid_until"),
        grace_until: r.get("grace_until"),
        state: r.get("state"),
        club: r.get("club_id"),
    }
}

impl Lease {
    pub fn tier_info(&self) -> &'static RentTier {
        RENT.tier(&self.kind, self.tier)
            .or_else(|| RENT.kinds.get(&self.kind).and_then(|k| k.tiers.first()))
            .expect("every kind has tiers")
    }

    pub fn json(&self) -> serde_json::Value {
        let t = self.tier_info();
        json!({
            "id": self.id, "kind": self.kind, "plot": self.plot, "tier": self.tier,
            "tier_name": t.name, "rent": t.rent, "furniture": t.furniture, "listings": t.listings,
            "members": t.members,
            "paid_until": self.paid_until, "grace_until": self.grace_until, "state": self.state,
        })
    }
}

/// The open lease `player` holds in `slot` ("home" or "stall").
pub async fn lease_of(db: &PgPool, player: Uuid, slot: &str) -> sqlx::Result<Option<Lease>> {
    let row = sqlx::query(&format!(
        "SELECT {LEASE_COLS} FROM leases WHERE player_id = $1 AND slot = $2 AND state <> 'ended'"
    ))
    .bind(player)
    .bind(slot)
    .fetch_optional(db)
    .await?;
    Ok(row.as_ref().map(lease_row))
}

/// Every open lease of a kind, with the holder's name.
pub async fn open_leases(db: &PgPool, kinds: &[&str]) -> sqlx::Result<Vec<(Lease, String)>> {
    let kinds: Vec<String> = kinds.iter().map(|k| k.to_string()).collect();
    let rows = sqlx::query(&format!(
        "SELECT x.*, p.display_name FROM (SELECT {LEASE_COLS} FROM leases
           WHERE state <> 'ended' AND kind = ANY($1)) x
         JOIN players p ON p.id = x.player_id ORDER BY x.plot"
    ))
    .bind(&kinds)
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| (lease_row(r), r.get("display_name")))
        .collect())
}

fn not_enough(t: &RentTier) -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "not_enough_coins",
        format!(
            "A {} is {} coins a week. Not enough coins yet.",
            t.name, t.rent
        ),
    )
}

/// Opens a lease on `plot`, paying the first period. `kind` is the plot's.
pub async fn open(
    state: &SocialState,
    player: Uuid,
    kind: &str,
    plot: &str,
    tier: i16,
) -> ApiResult<Lease> {
    let t = RENT
        .tier(kind, tier)
        .ok_or_else(|| ApiError::bad_request("bad_tier", "There's no such tier."))?;
    // Say "you already have one" before "it's taken": that's what matters.
    if lease_of(&state.db, player, slot_of(kind))
        .await
        .map_err(db_err)?
        .is_some()
    {
        return Err(if kind == "stall" {
            ApiError::new(
                StatusCode::CONFLICT,
                "has_stall",
                "You already rent a stall.",
            )
        } else {
            ApiError::new(StatusCode::CONFLICT, "has_home", "You already have a home.")
        });
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let row = sqlx::query(&format!(
        "INSERT INTO leases (kind, plot, player_id, tier, periods_paid, paid_until)
         VALUES ($1, $2, $3, $4, 1, now() + make_interval(secs => $5))
         RETURNING {LEASE_COLS}"
    ))
    .bind(kind)
    .bind(plot)
    .bind(player)
    .bind(tier)
    .bind(RENT.period_secs as f64)
    .fetch_one(&mut *tx)
    .await;
    let lease = match row {
        Ok(r) => lease_row(&r),
        Err(e) => {
            let constraint = e
                .as_database_error()
                .and_then(|d| d.constraint())
                .unwrap_or("")
                .to_string();
            return Err(match constraint.as_str() {
                "leases_plot_open" => ApiError::new(
                    StatusCode::CONFLICT,
                    "taken",
                    "Someone has just moved in there.",
                ),
                "leases_player_slot_open" if kind == "stall" => ApiError::new(
                    StatusCode::CONFLICT,
                    "has_stall",
                    "You already rent a stall.",
                ),
                "leases_player_slot_open" => {
                    ApiError::new(StatusCode::CONFLICT, "has_home", "You already have a home.")
                }
                _ => db_err(e),
            });
        }
    };
    charge_in(
        &mut tx,
        state,
        &lease,
        t.rent,
        &format!("rent:{}:0", lease.id),
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => not_enough(t),
        e => e.into(),
    })?;
    record_charge(&mut tx, lease.id, 0, t.rent).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(lease)
}

pub(crate) async fn charge_in(
    conn: &mut PgConnection,
    state: &SocialState,
    lease: &Lease,
    amount: i32,
    key: &str,
) -> Result<(), EconError> {
    if amount <= 0 {
        return Ok(());
    }
    if let Some(club) = lease.club {
        return crate::clubs::spend(conn, club, amount, "rent", key).await;
    }
    apply(
        conn,
        &state.catalog,
        lease.player,
        &[Op {
            item: COIN,
            delta: -amount,
        }],
        "rent",
        key,
    )
    .await
    .map(|_| ())
}

pub(crate) async fn record_charge(
    conn: &mut PgConnection,
    lease: i64,
    period: i32,
    amount: i32,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO rent_charges (lease_id, period, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(lease)
        .bind(period)
        .bind(amount)
        .execute(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Pays the next period. Ok(false): not enough coins (nothing changed).
pub(crate) async fn renew(state: &SocialState, lease: &Lease) -> ApiResult<bool> {
    let rent = lease.tier_info().rent;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let key = format!("rent:{}:{}", lease.id, lease.periods_paid);
    match charge_in(&mut tx, state, lease, rent, &key).await {
        Ok(()) => {}
        Err(EconError::Insufficient(_)) => return Ok(false),
        Err(e) => return Err(e.into()),
    }
    record_charge(&mut tx, lease.id, lease.periods_paid, rent).await?;
    // From when it was due, or from now if it's long overdue: never two
    // periods at once.
    sqlx::query(
        "UPDATE leases SET periods_paid = periods_paid + 1, state = 'active', grace_until = NULL,
             paid_until = greatest(paid_until, now()) + make_interval(secs => $2)
         WHERE id = $1 AND periods_paid = $3",
    )
    .bind(lease.id)
    .bind(RENT.period_secs as f64)
    .bind(lease.periods_paid)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(true)
}

/// Ends a lease: furniture or goods back to the bag, the plot free again.
pub async fn release(state: &SocialState, lease: &Lease, reason: &str) -> ApiResult<i32> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let ended = sqlx::query(
        "UPDATE leases SET state = 'ended', ended_at = now(), end_reason = $2 WHERE id = $1 AND state <> 'ended'",
    )
    .bind(lease.id)
    .bind(reason)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected();
    if ended == 0 {
        return Ok(0);
    }
    // A club room's furniture goes back to each piece's placer.
    let back: Vec<(i32, i64)> = if let Some(club) = lease.club {
        crate::clublife::return_pieces(
            &mut tx,
            state,
            club,
            None,
            &format!("release:{}", lease.id),
        )
        .await?;
        vec![]
    } else if slot_of(&lease.kind) == "home" {
        let rows = sqlx::query_as(
            "SELECT item_id, count(*) FROM home_objects WHERE owner_id = $1 GROUP BY item_id ORDER BY item_id",
        )
        .bind(lease.player)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
        sqlx::query("DELETE FROM home_objects WHERE owner_id = $1")
            .bind(lease.player)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        rows
    } else {
        let rows = sqlx::query_as(
            "SELECT item_id, sum(qty)::bigint FROM stall_listings WHERE lease_id = $1 GROUP BY item_id ORDER BY item_id",
        )
        .bind(lease.id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
        sqlx::query("DELETE FROM stall_listings WHERE lease_id = $1")
            .bind(lease.id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        rows
    };
    let ops: Vec<Op> = back
        .iter()
        .map(|&(item, n)| Op {
            item,
            delta: n as i32,
        })
        .collect();
    if !ops.is_empty() {
        apply(
            &mut tx,
            &state.catalog,
            lease.player,
            &ops,
            "release",
            &format!("release:{}", lease.id),
        )
        .await?;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(ops.iter().map(|o| o.delta).sum())
}

/// Tells whoever holds the lease, or for a club room its owner and
/// moderators (naming the club).
async fn notify_lease(state: &SocialState, lease: &Lease, kind: &str, mut body: serde_json::Value) {
    let Some(club) = lease.club else {
        crate::routes::notify(state, lease.player, kind, body).await;
        return;
    };
    let (name, staff) = crate::clubs::staff(&state.db, club)
        .await
        .unwrap_or_default();
    body["club"] = json!(name);
    body["what"] = json!(format!("{name}'s club room"));
    for p in staff {
        crate::routes::notify(state, p, kind, body.clone()).await;
    }
}

/// Renews leases that are due, starts grace for those that can't pay, and
/// ends those whose grace has run out. Returns how many leases it looked at.
pub async fn sweep(state: &SocialState) -> ApiResult<usize> {
    let due: Vec<Lease> = sqlx::query(&format!(
        "SELECT {LEASE_COLS} FROM leases
         WHERE state <> 'ended' AND paid_until <= now() ORDER BY paid_until LIMIT 500"
    ))
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?
    .iter()
    .map(lease_row)
    .collect();
    let now: i64 = sqlx::query_scalar("SELECT extract(epoch FROM now())::bigint")
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
    for lease in &due {
        if renew(state, lease).await? {
            continue;
        }
        let t = lease.tier_info();
        let what = format!("your {}", t.name);
        if lease.state == "active" {
            let grace_until = lease.paid_until + RENT.grace_secs;
            sqlx::query(
                "UPDATE leases SET state = 'grace', grace_until = to_timestamp($2) WHERE id = $1 AND state = 'active'",
            )
            .bind(lease.id)
            .bind(grace_until as f64)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
            notify_lease(
                state,
                lease,
                "rent_due",
                json!({ "kind": lease.kind, "plot": lease.plot, "what": what, "rent": t.rent, "grace_until": grace_until }),
            )
            .await;
        } else if lease.grace_until.is_some_and(|g| g <= now) {
            let back = release(state, lease, "unpaid").await?;
            notify_lease(
                state,
                lease,
                "lease_ended",
                json!({ "kind": lease.kind, "plot": lease.plot, "what": what, "returned": back }),
            )
            .await;
        }
    }
    Ok(due.len())
}

/// Runs `sweep` every `COMMONS_RENT_SWEEP_SECS` (default a minute).
pub fn spawn_sweeper(state: Arc<SocialState>) {
    let every = Duration::from_secs(config::env_or("COMMONS_RENT_SWEEP_SECS", 60));
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        loop {
            tick.tick().await;
            if let Err(e) = sweep(&state).await {
                tracing::error!(error = ?e, "rent sweep failed");
            }
        }
    });
}

// ---- routes ---------------------------------------------------------------------

/// Your leases and what everything costs.
pub async fn mine(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let home = lease_of(&state.db, me, "home").await.map_err(db_err)?;
    let stall = lease_of(&state.db, me, "stall").await.map_err(db_err)?;
    let used: i64 = sqlx::query_scalar("SELECT count(*) FROM home_objects WHERE owner_id = $1")
        .bind(me)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
    let kinds: BTreeMap<_, _> = RENT.kinds.iter().collect();
    Ok(Json(json!({
        "home": home.as_ref().map(Lease::json),
        "stall": stall.as_ref().map(Lease::json),
        "furniture_used": used,
        "period_secs": RENT.period_secs,
        "grace_secs": RENT.grace_secs,
        "kinds": kinds,
    })))
}

#[derive(Deserialize)]
pub struct SlotReq {
    slot: String,
    #[serde(default)]
    tier: i16,
}

async fn my_lease(state: &SocialState, me: Uuid, slot: &str) -> ApiResult<Lease> {
    if slot != "home" && slot != "stall" {
        return Err(ApiError::bad_request(
            "bad_slot",
            "Nothing like that to rent.",
        ));
    }
    lease_of(&state.db, me, slot)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "no_lease", "You don't rent one."))
}

/// Upgrade (pay the difference for this period) or downgrade (free, if
/// what's there still fits).
pub async fn change_tier(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SlotReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let lease = my_lease(&state, me, &req.slot).await?;
    if lease.state == "grace" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "unpaid",
            "Pay this week's rent first.",
        ));
    }
    let old = lease.tier_info();
    let new = RENT
        .tier(&lease.kind, req.tier)
        .ok_or_else(|| ApiError::bad_request("bad_tier", "There's no such tier."))?;
    if new.tier == old.tier {
        return Ok(Json(lease.json()));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if new.rent > old.rent {
        let key = format!("tier:{}:{}:{}", lease.id, lease.periods_paid, new.tier);
        charge_in(&mut tx, &state, &lease, new.rent - old.rent, &key)
            .await
            .map_err(|e| match e {
                EconError::Insufficient(_) => ApiError::new(
                    StatusCode::CONFLICT,
                    "not_enough_coins",
                    format!(
                        "Moving up to a {} costs {} coins this week.",
                        new.name,
                        new.rent - old.rent
                    ),
                ),
                e => e.into(),
            })?;
    } else {
        let (have, cap, what) = if slot_of(&lease.kind) == "home" {
            let n: i64 =
                sqlx::query_scalar("SELECT count(*) FROM home_objects WHERE owner_id = $1")
                    .bind(me)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db_err)?;
            (n, new.furniture.unwrap_or(0), "pieces of furniture")
        } else {
            let n: i64 =
                sqlx::query_scalar("SELECT count(*) FROM stall_listings WHERE lease_id = $1")
                    .bind(lease.id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db_err)?;
            (n, new.listings.unwrap_or(0), "goods on show")
        };
        if have > cap {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "too_full",
                format!(
                    "A {} holds {cap} {what}; you have {have}. Make some room first.",
                    new.name
                ),
            ));
        }
    }
    sqlx::query("UPDATE leases SET tier = $2 WHERE id = $1")
        .bind(lease.id)
        .bind(new.tier)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    let lease = my_lease(&state, me, &req.slot).await?;
    Ok(Json(lease.json()))
}

/// Pays overdue rent now instead of waiting for the next sweep.
pub async fn pay(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SlotReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let lease = my_lease(&state, me, &req.slot).await?;
    if lease.state != "grace" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "paid",
            "Your rent is already paid.",
        ));
    }
    if !renew(&state, &lease).await? {
        return Err(not_enough(lease.tier_info()));
    }
    let lease = my_lease(&state, me, &req.slot).await?;
    Ok(Json(lease.json()))
}

/// Moves out (or gives up a stall): everything back to the bag.
pub async fn end(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SlotReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let lease = my_lease(&state, me, &req.slot).await?;
    let back = release(&state, &lease, "moved_out").await?;
    Ok(Json(json!({ "returned": back })))
}
