//! Messages in bottles: kindness between strangers. Write a short anonymous
//! note and throw it into the pond; now and then you find someone else's.
//! The finder can send a thank-you, which reaches the author as a
//! notification (still anonymous), or report it to the Caretaker.

use crate::AppState;
use crate::auth::bearer;
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::filter;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// Bottles one person may throw per day.
const THROWS_PER_DAY: i64 = 3;
/// One find per this many minutes.
const FIND_EVERY_MIN: i64 = 60;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/bottles", get(mine).post(throw))
        .route("/bottles/find", post(find))
        .route("/bottles/{id}/thanks", post(thanks))
        .route("/bottles/{id}/report", post(report))
}

fn me(state: &AppState, headers: &HeaderMap) -> ApiResult<(Uuid, String)> {
    let who = bearer(state, headers)?;
    let id =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    Ok((id, who.name))
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg.to_string())
}

#[derive(Deserialize)]
struct ThrowReq {
    text: String,
}

/// Throws a bottle into the pond.
async fn throw(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ThrowReq>,
) -> ApiResult<Json<Value>> {
    let (id, _) = me(&state, &headers)?;
    if crate::gov::muted_until(&state.db, id)
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
    let text = filter::clean_chat(&req.text)
        .filter(|t| t.chars().count() >= 2)
        .ok_or_else(|| ApiError::bad_request("empty", "Write a few words first."))?;
    let text: String = text.chars().take(200).collect();
    let today: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM bottles WHERE author_id = $1 AND created_at > now() - interval '1 day'",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if today >= THROWS_PER_DAY {
        return Err(conflict(
            "enough_today",
            "That's three bottles today. The pond will carry them; come back tomorrow.",
        ));
    }
    sqlx::query("INSERT INTO bottles (author_id, body) VALUES ($1, $2)")
        .bind(id)
        .bind(&text)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    crate::gov::touch(&state.db, id).await;
    Ok(Json(
        json!({ "thrown": true, "left_today": THROWS_PER_DAY - today - 1 }),
    ))
}

/// Looks along the shore: a bottle from someone else, now and then.
async fn find(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (id, _) = me(&state, &headers)?;
    let wait: Option<i64> = sqlx::query_scalar(
        "SELECT ceil(extract(epoch FROM (max(found_at) + make_interval(mins => $2::int)) - now()) / 60)::bigint
         FROM bottles WHERE found_by = $1 HAVING max(found_at) + make_interval(mins => $2::int) > now()",
    )
    .bind(id)
    .bind(FIND_EVERY_MIN as i32)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    if let Some(min) = wait {
        return Ok(Json(json!({ "found": false, "wait_min": min.max(1) })));
    }
    // One of the oldest few adrift, from someone who isn't you and with no
    // block either way, picked at random; the guarded update keeps two
    // finders from getting the same bottle.
    let row = sqlx::query(
        "WITH pick AS (
             SELECT id FROM (
                 SELECT b.id FROM bottles b
                 WHERE b.found_by IS NULL AND NOT b.hidden AND b.author_id <> $1
                   AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = $1 AND k.blocked = b.author_id)
                                                            OR (k.blocker = b.author_id AND k.blocked = $1))
                 ORDER BY b.created_at LIMIT 20
             ) oldest ORDER BY random() LIMIT 1
         )
         UPDATE bottles SET found_by = $1, found_at = now()
         WHERE id = (SELECT id FROM pick) AND found_by IS NULL
         RETURNING id, body, extract(epoch FROM created_at)::bigint AS at",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let Some(r) = row else {
        return Ok(Json(json!({ "found": false, "empty": true })));
    };
    let bottle: i64 = r.get("id");
    crate::gov::touch(&state.db, id).await;
    Ok(Json(json!({
        "found": true,
        "bottle": { "id": bottle, "text": r.get::<String, _>("body"), "at": r.get::<i64, _>("at") },
    })))
}

/// The finder thanks the (anonymous) author.
async fn thanks(
    State(state): S,
    headers: HeaderMap,
    Path(bottle): Path<i64>,
) -> ApiResult<Json<Value>> {
    let (id, _) = me(&state, &headers)?;
    let author: Option<Uuid> = sqlx::query_scalar(
        "UPDATE bottles SET thanked = true WHERE id = $1 AND found_by = $2 AND NOT thanked RETURNING author_id",
    )
    .bind(bottle)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let Some(author) = author else {
        return Err(conflict(
            "not_yours",
            "That bottle isn't one you found, or you've thanked it already.",
        ));
    };
    sqlx::query(
        "INSERT INTO notifications (player_id, kind, body) VALUES ($1, 'bottle_thanks', '{}')",
    )
    .bind(author)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

/// The finder reports an unkind bottle: it's hidden and goes to the Caretaker.
async fn report(
    State(state): S,
    headers: HeaderMap,
    Path(bottle): Path<i64>,
) -> ApiResult<Json<Value>> {
    let (id, _) = me(&state, &headers)?;
    let row = sqlx::query(
        "UPDATE bottles b SET hidden = true FROM players p
         WHERE b.id = $1 AND b.found_by = $2 AND p.id = b.author_id
         RETURNING b.author_id, p.display_name, b.body",
    )
    .bind(bottle)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| conflict("not_yours", "That bottle isn't one you found."))?;
    sqlx::query(
        "INSERT INTO reports (reporter_id, target_id, target_name, reason, context) VALUES ($1, $2, $3, 'unkind', $4)",
    )
    .bind(id)
    .bind(row.get::<Uuid, _>("author_id"))
    .bind(row.get::<String, _>("display_name"))
    .bind(format!("Message in a bottle: {}", row.get::<String, _>("body")))
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

/// Your bottles: thrown, found by someone, thanked.
async fn mine(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (id, _) = me(&state, &headers)?;
    let r = sqlx::query(
        "SELECT count(*) AS thrown, count(found_by) AS found, count(*) FILTER (WHERE thanked) AS thanked,
                count(*) FILTER (WHERE created_at > now() - interval '1 day') AS today
         FROM bottles WHERE author_id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    let today: i64 = r.get("today");
    Ok(Json(json!({
        "thrown": r.get::<i64, _>("thrown"),
        "found": r.get::<i64, _>("found"),
        "thanked": r.get::<i64, _>("thanked"),
        "left_today": (THROWS_PER_DAY - today).max(0),
    })))
}
