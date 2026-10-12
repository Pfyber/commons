//! Town life for a quiet launch: topic quarters and their boards (spec §9,
//! starting as corners of the founders' park), town goals funded by
//! donations, and daily notice-board requests.
//!
//! Quarters: players join as many as they like. Each has a board of short
//! posts; `#tags` in a post are collected, and a tag used by enough different
//! people lately is reported as "a street forming" (the seed of an alley).
//!
//! Town goals: one is open at a time. Donations go through the economy (so
//! they are idempotent and can't overspend) and never overshoot the target;
//! reaching it opens the next goal.
//!
//! Requests: three a day, the same for everyone, derived from the date. No
//! table: delivering one is an economy operation whose idempotency key
//! includes the day and request number, so each can be done once.

use crate::AppState;
use crate::auth::bearer;
use crate::economy::{self, COIN, Catalog, EconError, Op};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::filter;
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, Row};
use std::sync::Arc;
use uuid::Uuid;

/// Distinct authors using a tag within `STREET_WINDOW_DAYS` for it to count
/// as a street forming.
pub const STREET_AUTHORS: i64 = 8;
pub const STREET_WINDOW_DAYS: i32 = 21;
pub const MAX_POST_CHARS: usize = 280;
const MAX_TAGS: usize = 3;
/// At most one post per this many seconds, and this many per day.
const POST_GAP_SECS: i64 = 20;
const POSTS_PER_DAY: i64 = 30;
const MAX_DONATION: i32 = 1000;
pub const REQUESTS_PER_DAY: usize = 3;

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/town/quarters", get(quarters))
        .route("/town/quarters/{slug}/join", post(join))
        .route("/town/quarters/{slug}/leave", post(leave))
        .route("/town/quarters/{slug}/board", get(board).post(post_board))
        .route("/town/goal", get(goal))
        .route("/town/goal/donate", post(donate))
        .route("/town/requests", get(requests))
        .route("/town/requests/{n}/deliver", post(deliver))
}

fn me(state: &AppState, headers: &HeaderMap) -> ApiResult<(Uuid, String)> {
    let who = bearer(state, headers)?;
    let id =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    Ok((id, who.name))
}

fn not_found(what: &str) -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("No such {what}."),
    )
}

// ---- quarters ---------------------------------------------------------------------

#[derive(Serialize)]
struct QuarterView {
    slug: String,
    name: String,
    blurb: String,
    icon: String,
    members: i64,
    joined: bool,
    posts_this_week: i64,
}

async fn quarters(State(state): S, headers: HeaderMap) -> ApiResult<Json<Vec<QuarterView>>> {
    let (me, _) = me(&state, &headers)?;
    let rows = sqlx::query(
        "SELECT q.slug, q.name, q.blurb, q.icon,
                (SELECT count(*) FROM quarter_members m WHERE m.quarter = q.slug) AS members,
                EXISTS (SELECT 1 FROM quarter_members m WHERE m.quarter = q.slug AND m.player_id = $1) AS joined,
                (SELECT count(*) FROM board_posts p WHERE p.quarter = q.slug AND NOT p.hidden
                    AND p.created_at > now() - interval '7 days') AS posts_this_week
         FROM quarters q ORDER BY q.sort",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(
        rows.iter()
            .map(|r| QuarterView {
                slug: r.get("slug"),
                name: r.get("name"),
                blurb: r.get("blurb"),
                icon: r.get("icon"),
                members: r.get("members"),
                joined: r.get("joined"),
                posts_this_week: r.get("posts_this_week"),
            })
            .collect(),
    ))
}

async fn quarter_exists(conn: &mut PgConnection, slug: &str) -> ApiResult<()> {
    let ok: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM quarters WHERE slug = $1)")
        .bind(slug)
        .fetch_one(conn)
        .await
        .map_err(db_err)?;
    if ok {
        Ok(())
    } else {
        Err(not_found("quarter"))
    }
}

async fn join(
    State(state): S,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    quarter_exists(&mut conn, &slug).await?;
    sqlx::query(
        "INSERT INTO quarter_members (quarter, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(&slug)
    .bind(me)
    .execute(&mut *conn)
    .await
    .map_err(db_err)?;
    Ok(Json(serde_json::json!({ "joined": true })))
}

async fn leave(
    State(state): S,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    sqlx::query("DELETE FROM quarter_members WHERE quarter = $1 AND player_id = $2")
        .bind(&slug)
        .bind(me)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(serde_json::json!({ "joined": false })))
}

// ---- boards -----------------------------------------------------------------------

/// `#tags` in a post: lowercase letters, digits and dashes, 2–20 long, at
/// most three, in order of first appearance.
pub fn hashtags(body: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for word in
        body.split(|c: char| c.is_whitespace() || c == ',' || c == '.' || c == '!' || c == '?')
    {
        let Some(raw) = word.strip_prefix('#') else {
            continue;
        };
        let tag: String = raw
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>()
            .to_ascii_lowercase();
        if (2..=20).contains(&tag.len()) && !tags.contains(&tag) {
            tags.push(tag);
        }
        if tags.len() == MAX_TAGS {
            break;
        }
    }
    tags
}

#[derive(Serialize)]
struct PostView {
    id: i64,
    author_id: String,
    author_name: String,
    body: String,
    tags: Vec<String>,
    at: i64,
}

#[derive(Serialize)]
struct TagView {
    tag: String,
    authors: i64,
    /// Enough different people use it: a street is forming.
    forming: bool,
}

#[derive(Deserialize)]
struct BoardQuery {
    tag: Option<String>,
}

async fn board(
    State(state): S,
    headers: HeaderMap,
    Path(slug): Path<String>,
    Query(q): Query<BoardQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    me(&state, &headers)?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    quarter_exists(&mut conn, &slug).await?;
    let tag = q
        .tag
        .map(|t| t.trim_start_matches('#').to_ascii_lowercase());
    let posts = sqlx::query(
        "SELECT id, author_id, author_name, body, tags, extract(epoch FROM created_at)::bigint AS at
         FROM board_posts
         WHERE quarter = $1 AND NOT hidden AND ($2::text IS NULL OR $2 = ANY(tags))
         ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&slug)
    .bind(&tag)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?;
    let tags = street_tags(&mut conn, &slug).await?;
    let posts: Vec<PostView> = posts
        .iter()
        .map(|r| PostView {
            id: r.get("id"),
            author_id: r.get::<Uuid, _>("author_id").to_string(),
            author_name: r.get("author_name"),
            body: r.get("body"),
            tags: r.get("tags"),
            at: r.get("at"),
        })
        .collect();
    Ok(Json(serde_json::json!({ "posts": posts, "tags": tags })))
}

/// The quarter's busiest tags lately, by distinct authors.
async fn street_tags(conn: &mut PgConnection, slug: &str) -> ApiResult<Vec<TagView>> {
    let rows = sqlx::query(
        "SELECT tag, count(DISTINCT author_id) AS authors
         FROM board_posts, unnest(tags) AS tag
         WHERE quarter = $1 AND NOT hidden AND created_at > now() - make_interval(days => $2)
         GROUP BY tag ORDER BY authors DESC, tag LIMIT 8",
    )
    .bind(slug)
    .bind(STREET_WINDOW_DAYS)
    .fetch_all(conn)
    .await
    .map_err(db_err)?;
    Ok(rows
        .iter()
        .map(|r| {
            let authors: i64 = r.get("authors");
            TagView {
                tag: r.get("tag"),
                authors,
                forming: authors >= STREET_AUTHORS,
            }
        })
        .collect())
}

#[derive(Deserialize)]
struct NewPost {
    body: String,
}

async fn post_board(
    State(state): S,
    headers: HeaderMap,
    Path(slug): Path<String>,
    Json(req): Json<NewPost>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, name) = me(&state, &headers)?;
    if crate::gov::muted_until(&state.db, me)
        .await
        .map_err(db_err)?
        > 0
    {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "muted",
            "You're muted for a little while.",
        ));
    }
    let body = clean_post(&req.body)
        .ok_or_else(|| ApiError::bad_request("empty", "Write something first."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    quarter_exists(&mut tx, &slug).await?;
    let (last_gap, today): (Option<i64>, i64) = sqlx::query_as(
        "SELECT extract(epoch FROM now() - max(created_at))::bigint,
                count(*) FILTER (WHERE created_at > now() - interval '1 day')
         FROM board_posts WHERE author_id = $1",
    )
    .bind(me)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if last_gap.is_some_and(|g| g < POST_GAP_SECS) || today >= POSTS_PER_DAY {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "slow_down",
            "Take a breath: try posting again in a moment.",
        ));
    }
    let tags = hashtags(&body);
    // Posting in a quarter makes you one of its members.
    sqlx::query(
        "INSERT INTO quarter_members (quarter, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(&slug)
    .bind(me)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO board_posts (quarter, author_id, author_name, body, tags) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(&slug)
    .bind(me)
    .bind(&name)
    .bind(&body)
    .bind(&tags)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    crate::gov::touch(&state.db, me).await;
    Ok(Json(serde_json::json!({ "id": id, "tags": tags })))
}

/// Chat-style cleaning (control characters, whitespace, word list), with a
/// longer limit for board posts.
pub fn clean_post(text: &str) -> Option<String> {
    let trimmed: String = text.chars().take(MAX_POST_CHARS).collect();
    // `clean_chat` caps at chat length, so clean in chat-sized pieces.
    let parts: Vec<String> = trimmed
        .split_whitespace()
        .collect::<Vec<_>>()
        .chunks(16)
        .filter_map(|words| filter::clean_chat(&words.join(" ")))
        .collect();
    let out = parts.join(" ");
    (!out.is_empty()).then(|| out.chars().take(MAX_POST_CHARS).collect())
}

// ---- town goals -------------------------------------------------------------------

#[derive(Serialize)]
pub struct GoalView {
    pub key: String,
    pub title: String,
    pub blurb: String,
    pub target: i32,
    pub raised: i32,
    pub done: bool,
    /// What the asking player has given to this goal.
    pub mine: i64,
    /// Keys of every goal reached so far (the park shows them).
    pub reached: Vec<String>,
}

async fn goal_view(conn: &mut PgConnection, me: Uuid) -> ApiResult<GoalView> {
    // The open goal, or the last one if all are done.
    let row = sqlx::query(
        "SELECT id, key, title, blurb, target, raised, done_at IS NOT NULL AS done FROM town_goals
         ORDER BY (done_at IS NOT NULL), CASE WHEN done_at IS NULL THEN seq ELSE -seq END LIMIT 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_err)?
    .ok_or_else(|| not_found("goal"))?;
    let id: i32 = row.get("id");
    let mine: i64 = sqlx::query_scalar(
        "SELECT coalesce(sum(amount), 0)::bigint FROM goal_donations WHERE goal_id = $1 AND player_id = $2",
    )
    .bind(id)
    .bind(me)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_err)?;
    let reached: Vec<String> =
        sqlx::query_scalar("SELECT key FROM town_goals WHERE done_at IS NOT NULL ORDER BY seq")
            .fetch_all(&mut *conn)
            .await
            .map_err(db_err)?;
    Ok(GoalView {
        key: row.get("key"),
        title: row.get("title"),
        blurb: row.get("blurb"),
        target: row.get("target"),
        raised: row.get("raised"),
        done: row.get("done"),
        mine,
        reached,
    })
}

async fn goal(State(state): S, headers: HeaderMap) -> ApiResult<Json<GoalView>> {
    let (me, _) = me(&state, &headers)?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    Ok(Json(goal_view(&mut conn, me).await?))
}

#[derive(Deserialize)]
struct DonateReq {
    amount: i32,
    /// Client-generated idempotency key per button press.
    key: String,
}

/// Outcome of a donation: how much was taken (never more than the goal still
/// needs) and whether this donation completed the goal.
#[derive(Debug, PartialEq, Eq)]
pub struct Donated {
    pub accepted: i32,
    pub completed: bool,
}

/// Donates up to `amount` coins to goal `goal_id` if it is still open.
pub async fn donate_to(
    state: &AppState,
    goal_id: i32,
    player: Uuid,
    amount: i32,
    key: &str,
) -> ApiResult<Donated> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let row = sqlx::query("SELECT target, raised, done_at IS NOT NULL AS done FROM town_goals WHERE id = $1 FOR UPDATE")
        .bind(goal_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| not_found("goal"))?;
    let (target, raised, done): (i32, i32, bool) =
        (row.get("target"), row.get("raised"), row.get("done"));
    if done {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "goal_done",
            "That goal has already been reached!",
        ));
    }
    let accepted = amount.min(target - raised);
    let applied = economy::apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: COIN,
            delta: -accepted,
        }],
        "town_goal",
        &format!("donate:{player}:{key}"),
    )
    .await
    .map_err(|e| match e {
        EconError::Race => ApiError::new(StatusCode::CONFLICT, "retry", "Please try again."),
        e => e.into(),
    })?;
    if applied.duplicate {
        return Ok(Donated {
            accepted: 0,
            completed: false,
        });
    }
    let completed = raised + accepted >= target;
    sqlx::query("UPDATE town_goals SET raised = raised + $2, done_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1")
        .bind(goal_id)
        .bind(accepted)
        .bind(completed)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("INSERT INTO goal_donations (goal_id, player_id, amount) VALUES ($1, $2, $3)")
        .bind(goal_id)
        .bind(player)
        .bind(accepted)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Donated {
        accepted,
        completed,
    })
}

async fn donate(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DonateReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    if !(1..=MAX_DONATION).contains(&req.amount) || req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid donation."));
    }
    let open: Option<i32> =
        sqlx::query_scalar("SELECT id FROM town_goals WHERE done_at IS NULL ORDER BY seq LIMIT 1")
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let open = open.ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "goal_done",
            "Every goal has been reached. Thank you!",
        )
    })?;
    let d = donate_to(&state, open, me, req.amount, &req.key).await?;
    crate::gov::touch(&state.db, me).await;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let mut coins = economy::totals(&mut conn, me, &[COIN])
        .await
        .map_err(db_err)?;
    Ok(Json(serde_json::json!({
        "accepted": d.accepted,
        "completed": d.completed,
        "coins": coins.pop().map(|c| c.1).unwrap_or(0),
        "goal": goal_view(&mut conn, me).await?,
    })))
}

// ---- daily requests -----------------------------------------------------------------

const REQUESTERS: &[&str] = &[
    "Hazel", "Old Tom", "Mira", "Bram", "Juniper", "Otto", "Wren", "Sol",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Request {
    pub n: usize,
    pub from: String,
    pub text: String,
    pub item: i32,
    pub qty: i32,
    pub reward: i32,
}

fn mix(mut h: u64) -> u64 {
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

/// The day's requests: everyday fish and garden plants, nothing rare, a
/// reward a bit above the market price.
pub fn requests_for(catalog: &Catalog, day: &str) -> Vec<Request> {
    let mut pool: Vec<&economy::Item> = catalog
        .items
        .iter()
        .filter(|i| (i.kind == "fish" || i.kind == "plant") && i.rarity <= 1 && i.sell().is_some())
        .collect();
    let seed = day.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100_0000_01b3)
    });
    let mut out = Vec::new();
    for n in 0..REQUESTS_PER_DAY {
        if pool.is_empty() {
            break;
        }
        let h = mix(seed ^ (n as u64 + 1));
        let item = pool.remove((h % pool.len() as u64) as usize);
        let qty = 1 + ((h >> 16) % if item.kind == "fish" { 2 } else { 3 }) as i32;
        let from = REQUESTERS[((h >> 32) % REQUESTERS.len() as u64) as usize];
        let reward = ((item.sell().unwrap_or(1) * qty as i64 * 8 + 4) / 5 + 10) as i32;
        let text = if item.kind == "fish" {
            format!(
                "{from} is hoping for {qty} × {} for a pond-side supper.",
                item.name
            )
        } else {
            format!(
                "{from} would love {qty} × {} for the windowsill.",
                item.name
            )
        };
        out.push(Request {
            n,
            from: from.into(),
            text,
            item: item.id,
            qty,
            reward,
        });
    }
    out
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn request_key(player: Uuid, day: &str, n: usize) -> String {
    format!("request:{player}:{day}:{n}")
}

async fn requests(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let day = today();
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let mut list = Vec::new();
    for r in requests_for(&state.catalog, &day) {
        let done = economy::key_used(&mut conn, &request_key(me, &day, r.n))
            .await
            .map_err(db_err)?;
        let mut v = serde_json::to_value(&r).unwrap_or_default();
        v["done"] = serde_json::json!(done);
        list.push(v);
    }
    Ok(Json(serde_json::json!({ "day": day, "requests": list })))
}

async fn deliver(
    State(state): S,
    headers: HeaderMap,
    Path(n): Path<usize>,
) -> ApiResult<Json<economy::Applied>> {
    let (me, _) = me(&state, &headers)?;
    let day = today();
    let r = requests_for(&state.catalog, &day)
        .into_iter()
        .find(|r| r.n == n)
        .ok_or_else(|| not_found("request"))?;
    let ops = [
        Op {
            item: r.item,
            delta: -r.qty,
        },
        Op {
            item: COIN,
            delta: r.reward,
        },
    ];
    let applied = economy::apply_tx(
        &state.db,
        &state.catalog,
        me,
        &ops,
        "request",
        &request_key(me, &day, n),
    )
    .await?;
    if applied.duplicate {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "already_done",
            "You've already helped with that one today.",
        ));
    }
    crate::gov::touch(&state.db, me).await;
    Ok(Json(applied))
}
