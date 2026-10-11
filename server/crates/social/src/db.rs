//! Friendship, messages, gifts and notifications in Postgres.

use commons_api::economy::{Applied, Catalog, EconError, Op, apply};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Friendship levels (spec §8.1). Level 0 "acquainted" is reserved.
pub const FRIEND: i16 = 1;
pub const CLOSE_FRIEND: i16 = 2;
/// Points needed to become close friends; a gift is worth 10.
pub const CLOSE_AT: i32 = 30;
pub const GIFT_POINTS: i32 = 10;

/// Friendships are stored once, with `a < b`.
fn pair(x: Uuid, y: Uuid) -> (Uuid, Uuid) {
    if x < y { (x, y) } else { (y, x) }
}

pub async fn player_by_name(db: &PgPool, name: &str) -> sqlx::Result<Option<(Uuid, String)>> {
    let row =
        sqlx::query("SELECT id, display_name FROM players WHERE lower(display_name) = lower($1)")
            .bind(name.trim())
            .fetch_optional(db)
            .await?;
    Ok(row.map(|r| (r.get("id"), r.get("display_name"))))
}

pub async fn name_of(db: &PgPool, id: Uuid) -> sqlx::Result<String> {
    let name: Option<String> = sqlx::query_scalar("SELECT display_name FROM players WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(name.unwrap_or_else(|| "someone".into()))
}

/// True if either has blocked the other.
pub async fn blocked(db: &PgPool, a: Uuid, b: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1))",
    )
    .bind(a)
    .bind(b)
    .fetch_one(db)
    .await
}

/// The friendship level between two players, if any.
pub async fn level(db: &PgPool, x: Uuid, y: Uuid) -> sqlx::Result<Option<i16>> {
    let (a, b) = pair(x, y);
    sqlx::query_scalar("SELECT level FROM friendships WHERE a = $1 AND b = $2")
        .bind(a)
        .bind(b)
        .fetch_optional(db)
        .await
}

#[derive(Debug, Serialize, Clone)]
pub struct Friend {
    pub id: String,
    pub name: String,
    pub look: i64,
    pub level: i16,
    pub points: i32,
}

pub async fn friends_of(db: &PgPool, me: Uuid) -> sqlx::Result<Vec<Friend>> {
    let rows = sqlx::query(
        "SELECT p.id, p.display_name, COALESCE((p.avatar->>'look')::bigint, 0) AS look, f.level, f.points
         FROM friendships f JOIN players p ON p.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
         WHERE f.a = $1 OR f.b = $1
         ORDER BY lower(p.display_name)",
    )
    .bind(me)
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Friend {
            id: r.get::<Uuid, _>("id").to_string(),
            name: r.get("display_name"),
            look: r.get("look"),
            level: r.get("level"),
            points: r.get("points"),
        })
        .collect())
}

pub async fn friend_ids(db: &PgPool, me: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT CASE WHEN a = $1 THEN b ELSE a END FROM friendships WHERE a = $1 OR b = $1",
    )
    .bind(me)
    .fetch_all(db)
    .await
}

#[derive(Debug, Serialize)]
pub struct Person {
    pub id: String,
    pub name: String,
}

/// Incoming and outgoing pending requests, and people I've blocked.
pub async fn requests_and_blocks(
    db: &PgPool,
    me: Uuid,
) -> sqlx::Result<(Vec<Person>, Vec<Person>, Vec<Person>)> {
    let q = |sql: &'static str| async move {
        let rows = sqlx::query(sql).bind(me).fetch_all(db).await?;
        Ok::<_, sqlx::Error>(
            rows.iter()
                .map(|r| Person {
                    id: r.get::<Uuid, _>("id").to_string(),
                    name: r.get("display_name"),
                })
                .collect::<Vec<_>>(),
        )
    };
    Ok((
        q("SELECT p.id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.from_id WHERE r.to_id = $1 ORDER BY r.created_at").await?,
        q("SELECT p.id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.to_id WHERE r.from_id = $1 ORDER BY r.created_at").await?,
        q("SELECT p.id, p.display_name FROM blocks b JOIN players p ON p.id = b.blocked WHERE b.blocker = $1 ORDER BY b.created_at").await?,
    ))
}

#[derive(Debug, PartialEq, Eq)]
pub enum RequestOutcome {
    Sent,
    /// They had already asked us, so this makes us friends.
    Accepted,
    AlreadyFriends,
    AlreadySent,
}

pub async fn request(db: &PgPool, from: Uuid, to: Uuid) -> sqlx::Result<RequestOutcome> {
    if level(db, from, to).await?.is_some() {
        return Ok(RequestOutcome::AlreadyFriends);
    }
    let reverse: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM friend_requests WHERE from_id = $1 AND to_id = $2)",
    )
    .bind(to)
    .bind(from)
    .fetch_one(db)
    .await?;
    if reverse {
        accept(db, to, from).await?;
        return Ok(RequestOutcome::Accepted);
    }
    let r = sqlx::query(
        "INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(from)
    .bind(to)
    .execute(db)
    .await?;
    Ok(if r.rows_affected() == 1 {
        RequestOutcome::Sent
    } else {
        RequestOutcome::AlreadySent
    })
}

/// Accepts `from`'s request to `to`. Returns false if there was none.
pub async fn accept(db: &PgPool, from: Uuid, to: Uuid) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let r = sqlx::query("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2")
        .bind(from)
        .bind(to)
        .execute(&mut *tx)
        .await?;
    if r.rows_affected() == 0 {
        return Ok(false);
    }
    sqlx::query("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2")
        .bind(to)
        .bind(from)
        .execute(&mut *tx)
        .await?;
    let (a, b) = pair(from, to);
    sqlx::query("INSERT INTO friendships (a, b, level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(a)
        .bind(b)
        .bind(FRIEND)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn decline(db: &PgPool, from: Uuid, to: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2")
        .bind(from)
        .bind(to)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn unfriend(db: &PgPool, x: Uuid, y: Uuid) -> sqlx::Result<()> {
    let (a, b) = pair(x, y);
    sqlx::query("DELETE FROM friendships WHERE a = $1 AND b = $2")
        .bind(a)
        .bind(b)
        .execute(db)
        .await?;
    Ok(())
}

/// Blocking also ends any friendship and pending requests.
pub async fn block(db: &PgPool, me: Uuid, other: Uuid) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(me)
        .bind(other)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)")
        .bind(me)
        .bind(other)
        .execute(&mut *tx)
        .await?;
    let (a, b) = pair(me, other);
    sqlx::query("DELETE FROM friendships WHERE a = $1 AND b = $2")
        .bind(a)
        .bind(b)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

pub async fn unblock(db: &PgPool, me: Uuid, other: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM blocks WHERE blocker = $1 AND blocked = $2")
        .bind(me)
        .bind(other)
        .execute(db)
        .await?;
    Ok(())
}

/// Adds friendship points; returns true if this made them close friends.
pub async fn add_points(db: &PgPool, x: Uuid, y: Uuid, points: i32) -> sqlx::Result<bool> {
    let (a, b) = pair(x, y);
    let row = sqlx::query(
        "UPDATE friendships SET points = points + $3,
             level = CASE WHEN points + $3 >= $4 THEN GREATEST(level, $5) ELSE level END
         WHERE a = $1 AND b = $2
         RETURNING level, (points - $3) < $4 AS was_below",
    )
    .bind(a)
    .bind(b)
    .bind(points)
    .bind(CLOSE_AT)
    .bind(CLOSE_FRIEND)
    .fetch_optional(db)
    .await?;
    Ok(row
        .is_some_and(|r| r.get::<i16, _>("level") == CLOSE_FRIEND && r.get::<bool, _>("was_below")))
}

#[derive(Debug, Serialize)]
pub struct Dm {
    pub id: i64,
    pub from: String,
    pub to: String,
    pub text: String,
    pub at: i64,
}

pub async fn send_dm(db: &PgPool, from: Uuid, to: Uuid, text: &str) -> sqlx::Result<Dm> {
    let row = sqlx::query(
        "INSERT INTO direct_messages (from_id, to_id, body) VALUES ($1, $2, $3)
         RETURNING id, extract(epoch FROM sent_at)::bigint AS at",
    )
    .bind(from)
    .bind(to)
    .bind(text)
    .fetch_one(db)
    .await?;
    Ok(Dm {
        id: row.get("id"),
        from: from.to_string(),
        to: to.to_string(),
        text: text.into(),
        at: row.get("at"),
    })
}

pub async fn dm_history(db: &PgPool, me: Uuid, other: Uuid) -> sqlx::Result<Vec<Dm>> {
    let rows = sqlx::query(
        "SELECT id, from_id, to_id, body, extract(epoch FROM sent_at)::bigint AS at FROM direct_messages
         WHERE LEAST(from_id, to_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(from_id, to_id) = GREATEST($1::uuid, $2::uuid)
         ORDER BY id DESC LIMIT 50",
    )
    .bind(me)
    .bind(other)
    .fetch_all(db)
    .await?;
    let mut out: Vec<Dm> = rows
        .iter()
        .map(|r| Dm {
            id: r.get("id"),
            from: r.get::<Uuid, _>("from_id").to_string(),
            to: r.get::<Uuid, _>("to_id").to_string(),
            text: r.get("body"),
            at: r.get("at"),
        })
        .collect();
    out.reverse();
    Ok(out)
}

// ---- gifts -----------------------------------------------------------------------

#[derive(Debug)]
pub enum GiftError {
    Econ(EconError),
    Db(sqlx::Error),
    NotFound,
}

impl From<sqlx::Error> for GiftError {
    fn from(e: sqlx::Error) -> Self {
        GiftError::Db(e)
    }
}

/// A gift being sent.
pub struct NewGift<'a> {
    pub from: Uuid,
    pub to: Uuid,
    pub item: i32,
    pub qty: i32,
    pub note: &'a str,
    pub key: &'a str,
}

/// Takes the item from the sender and leaves it on the recipient's doorstep.
/// Returns the sender's new totals and whether this was a retry.
pub async fn send_gift(
    db: &PgPool,
    catalog: &Catalog,
    g: &NewGift<'_>,
) -> Result<Applied, GiftError> {
    let mut tx = db.begin().await?;
    let applied = apply(
        &mut tx,
        catalog,
        g.from,
        &[Op {
            item: g.item,
            delta: -g.qty,
        }],
        "gift_send",
        g.key,
    )
    .await
    .map_err(GiftError::Econ)?;
    if !applied.duplicate {
        sqlx::query(
            "INSERT INTO gifts (from_id, to_id, item_id, qty, note) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(g.from)
        .bind(g.to)
        .bind(g.item)
        .bind(g.qty)
        .bind(g.note)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(applied)
}

#[derive(Debug, Serialize)]
pub struct Gift {
    pub id: String,
    pub from: String,
    pub from_name: String,
    pub item: i32,
    pub qty: i32,
    pub note: String,
}

pub async fn unopened_gifts(db: &PgPool, me: Uuid) -> sqlx::Result<Vec<Gift>> {
    let rows = sqlx::query(
        "SELECT g.id, g.from_id, p.display_name, g.item_id, g.qty, g.note FROM gifts g
         JOIN players p ON p.id = g.from_id WHERE g.to_id = $1 AND g.opened_at IS NULL ORDER BY g.sent_at",
    )
    .bind(me)
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Gift {
            id: r.get::<Uuid, _>("id").to_string(),
            from: r.get::<Uuid, _>("from_id").to_string(),
            from_name: r.get("display_name"),
            item: r.get("item_id"),
            qty: r.get("qty"),
            note: r.get("note"),
        })
        .collect())
}

/// Opens a gift: marks it opened and adds the item, in one transaction.
pub async fn open_gift(
    db: &PgPool,
    catalog: &Catalog,
    me: Uuid,
    gift: Uuid,
) -> Result<(Applied, String), GiftError> {
    let mut tx = db.begin().await?;
    let row = sqlx::query(
        "UPDATE gifts SET opened_at = now() WHERE id = $1 AND to_id = $2 AND opened_at IS NULL
         RETURNING item_id, qty, from_id",
    )
    .bind(gift)
    .bind(me)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(GiftError::NotFound)?;
    let (item, qty, from): (i32, i32, Uuid) =
        (row.get("item_id"), row.get("qty"), row.get("from_id"));
    let applied = apply(
        &mut tx,
        catalog,
        me,
        &[Op { item, delta: qty }],
        "gift_open",
        &format!("giftopen:{gift}"),
    )
    .await
    .map_err(GiftError::Econ)?;
    tx.commit().await?;
    Ok((applied, name_of(db, from).await?))
}

// ---- notifications ------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct Notification {
    pub id: i64,
    pub kind: String,
    pub body: serde_json::Value,
    pub at: i64,
    pub read: bool,
}

pub async fn notify(
    db: &PgPool,
    player: Uuid,
    kind: &str,
    body: serde_json::Value,
) -> sqlx::Result<Notification> {
    let row = sqlx::query(
        "INSERT INTO notifications (player_id, kind, body) VALUES ($1, $2, $3)
         RETURNING id, extract(epoch FROM created_at)::bigint AS at",
    )
    .bind(player)
    .bind(kind)
    .bind(&body)
    .fetch_one(db)
    .await?;
    Ok(Notification {
        id: row.get("id"),
        kind: kind.into(),
        body,
        at: row.get("at"),
        read: false,
    })
}

pub async fn notifications(db: &PgPool, me: Uuid) -> sqlx::Result<Vec<Notification>> {
    let rows = sqlx::query(
        "SELECT id, kind, body, extract(epoch FROM created_at)::bigint AS at, read_at IS NOT NULL AS read
         FROM notifications WHERE player_id = $1 ORDER BY id DESC LIMIT 50",
    )
    .bind(me)
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Notification {
            id: r.get("id"),
            kind: r.get("kind"),
            body: r.get("body"),
            at: r.get("at"),
            read: r.get("read"),
        })
        .collect())
}

pub async fn mark_read(db: &PgPool, me: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL",
    )
    .bind(me)
    .execute(db)
    .await?;
    Ok(())
}
