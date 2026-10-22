//! Borrowing from the Library (ADR 0012, L3). Books are read in the library;
//! borrowed on your library card, they go with you (up to [`MAX_LOANS`], for
//! [`LOAN_DAYS`] days; borrowing again renews). A loan past its due date is
//! simply back on the shelf. There are always more copies in the stacks, so
//! anyone can borrow any book; while someone has it out, its place on the
//! shelf shows a gap.
//!
//! - `POST /api/library/borrow` `{book}`: take it out (or renew it).
//! - `POST /api/library/return` `{book}`: bring it back.
//! - `GET /api/library/loans`: what you have out, with your place in each.
//! - `GET /api/library/out/{wing}`: the shelf places with a book out.

use crate::AppState;
use crate::economy::bearer_player;
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

type S = State<Arc<AppState>>;

/// Books out on one card at a time.
pub const MAX_LOANS: i64 = 5;
/// How long a loan lasts.
pub const LOAN_DAYS: i32 = 21;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/library/borrow", post(borrow))
        .route("/library/return", post(give_back))
        .route("/library/loans", get(loans))
        .route("/library/out/{wing}", get(out))
}

#[derive(Deserialize)]
struct BookReq {
    book: i32,
}

/// Takes a book out on your card, or renews it.
async fn borrow(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BookReq>,
) -> ApiResult<Json<Value>> {
    let player = bearer_player(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // One borrowing at a time per card, so two at once can't both squeeze
    // past the limit.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('loans:' || $1::text))")
        .bind(player)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM books WHERE id = $1)")
        .bind(req.book)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if !exists {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_book",
            "That book isn't in the catalogue.",
        ));
    }
    // Loans past due went back on the shelf.
    sqlx::query("DELETE FROM loans WHERE player_id = $1 AND due_at <= now()")
        .bind(player)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let (out, this): (i64, bool) = sqlx::query_as(
        "SELECT count(*), bool_or(book_id = $2) IS TRUE FROM loans WHERE player_id = $1",
    )
    .bind(player)
    .bind(req.book)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if !this && out >= MAX_LOANS {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "too_many",
            "You've five books out already. Bring one back first.",
        ));
    }
    let due: i64 = sqlx::query_scalar(
        "INSERT INTO loans (player_id, book_id, due_at) VALUES ($1, $2, now() + make_interval(days => $3))
         ON CONFLICT (player_id, book_id) DO UPDATE SET due_at = EXCLUDED.due_at
         RETURNING extract(epoch FROM due_at)::bigint",
    )
    .bind(player)
    .bind(req.book)
    .bind(LOAN_DAYS)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        json!({ "book": req.book, "due": due, "renewed": this }),
    ))
}

/// Brings a book back.
async fn give_back(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BookReq>,
) -> ApiResult<StatusCode> {
    let player = bearer_player(&state, &headers)?;
    sqlx::query("DELETE FROM loans WHERE player_id = $1 AND book_id = $2")
        .bind(player)
        .bind(req.book)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

/// What you have out: soonest due first, with your place in each.
async fn loans(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let player = bearer_player(&state, &headers)?;
    type Row = (i32, String, String, i64, Option<i32>, Option<i32>);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT l.book_id, b.title, b.authors, extract(epoch FROM l.due_at)::bigint, r.page, t.pages
         FROM loans l JOIN books b ON b.id = l.book_id
         LEFT JOIN reading r ON r.player_id = l.player_id AND r.book_id = l.book_id
         LEFT JOIN book_texts t ON t.book_id = l.book_id AND t.status = 'ok'
         WHERE l.player_id = $1 AND l.due_at > now()
         ORDER BY l.due_at",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let list: Vec<_> = rows
        .iter()
        .map(|(id, title, authors, due, page, pages)| {
            json!({ "id": id, "title": title, "authors": authors, "due": due, "page": page, "pages": pages })
        })
        .collect();
    Ok(Json(json!({ "books": list, "max": MAX_LOANS })))
}

/// The shelf places in a wing whose book someone has out (the gaps).
async fn out(State(state): S, Path(wing): Path<String>) -> ApiResult<Json<Value>> {
    let places: Vec<i32> = sqlx::query_scalar(
        "SELECT DISTINCT b.shelf_index FROM loans l JOIN books b ON b.id = l.book_id
         WHERE b.wing = $1 AND b.shelf_index IS NOT NULL AND l.due_at > now()
         ORDER BY 1 LIMIT 5000",
    )
    .bind(&wing)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "wing": wing, "out": places })))
}

/// How many readers have book `id` out.
pub async fn out_count(db: &sqlx::PgPool, id: i32) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM loans WHERE book_id = $1 AND due_at > now()")
        .bind(id)
        .fetch_one(db)
        .await
}
