//! The Library's catalogue (ADR 0012): every Project Gutenberg text, each
//! standing in its wing at its place in the shelf list
//! (`commons_sim::library`). `library-import` fills it ([`upsert`]) and
//! re-shelves it ([`reshelve`]); the routes let the game browse it.
//!
//! - `GET /api/library/wings`: the wings and how many books each holds.
//! - `GET /api/library/wing/{wing}`: the first and last book in each
//!   bookcase, for the signs at the ends of the rows.
//! - `GET /api/library/case/{wing}/{n}`: the books in bookcase `n` (wing
//!   `new`: the New Arrivals case).
//! - `GET /api/library/search?q=&lang=`: the catalogue desk.
//! - `GET /api/library/books/{id}`: a book's card.

use crate::AppState;
use crate::economy::bearer_player;
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use commons_sim::library::{
    self as lib, PER_CASE, Shelving, WINGS, first_language, language_name, shelf_key, surname,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::BTreeMap;
use std::sync::Arc;

type S = State<Arc<AppState>>;

/// The New Arrivals case in the hall.
pub const NEW: &str = "new";

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/library/wings", get(wings))
        .route("/library/wing/{wing}", get(wing))
        .route("/library/case/{wing}/{n}", get(case))
        .route("/library/search", get(search))
        .route("/library/books/{id}", get(book))
}

/// How many books each wing holds, and how many are new arrivals.
async fn wings(State(state): S) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT wing, count(shelf_index), count(*) - count(shelf_index) FROM books GROUP BY wing",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let counts: BTreeMap<_, _> = rows.iter().map(|(w, n, _)| (w.as_str(), *n)).collect();
    let arrivals: i64 = rows.iter().map(|r| r.2).sum();
    let list: Vec<_> = WINGS
        .iter()
        .map(|w| {
            json!({
                "key": w.key,
                "name": w.name,
                "zone": w.zone(),
                "count": counts.get(w.key).copied().unwrap_or(0),
                "cases": w.cases(),
            })
        })
        .collect();
    let total: i64 = counts.values().sum::<i64>() + arrivals;
    Ok(Json(
        json!({ "total": total, "arrivals": arrivals, "wings": list }),
    ))
}

fn known_wing(key: &str) -> ApiResult<&'static lib::Wing> {
    lib::wing(key).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "no_wing", "No such wing."))
}

/// What a row-end sign says about a book: its class and its author's
/// surname (or its title, with no author); in World Languages, its language.
fn sign_label(locc: &str, authors: &str, title: &str, languages: &str) -> Value {
    let who = match surname(authors) {
        "" => title
            .split_whitespace()
            .take(3)
            .collect::<Vec<_>>()
            .join(" "),
        s => s.to_string(),
    };
    json!({
        "c": lib::codes(locc).next().unwrap_or(""),
        "a": who,
        "l": language_name(first_language(languages)),
    })
}

/// The first and last book in each filled bookcase of a wing.
async fn wing(State(state): S, Path(key): Path<String>) -> ApiResult<Json<Value>> {
    let w = known_wing(&key)?;
    let rows: Vec<(i32, String, String, String, String)> = sqlx::query_as(
        "SELECT shelf_index, locc, authors, title, languages FROM books
         WHERE wing = $1 AND shelf_index IS NOT NULL
           AND (shelf_index % $2 IN (0, $2 - 1)
                OR shelf_index = (SELECT max(shelf_index) FROM books WHERE wing = $1))
         ORDER BY shelf_index",
    )
    .bind(w.key)
    .bind(PER_CASE as i32)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let mut cases: Vec<[Value; 2]> = vec![];
    let mut count = 0;
    for (i, locc, authors, title, languages) in rows {
        let label = sign_label(&locc, &authors, &title, &languages);
        let n = i as usize / PER_CASE;
        if (i as usize).is_multiple_of(PER_CASE) {
            cases.push([label.clone(), label]);
        } else if let Some(c) = cases.get_mut(n) {
            c[1] = label;
        }
        count = i + 1;
    }
    Ok(Json(json!({
        "key": w.key,
        "name": w.name,
        "count": count,
        "cases": cases,
    })))
}

#[derive(sqlx::FromRow)]
struct Spine {
    id: i32,
    title: String,
    authors: String,
    languages: String,
    shelf_index: Option<i32>,
}

fn spine(b: &Spine, slot: usize) -> Value {
    json!({
        "slot": slot,
        "id": b.id,
        "title": b.title,
        "authors": b.authors,
        "lang": first_language(&b.languages),
        "language": language_name(first_language(&b.languages)),
    })
}

/// The books in one bookcase, by slot (0..100, five shelves of twenty from
/// the top left).
async fn case(State(state): S, Path((key, n)): Path<(String, i32)>) -> ApiResult<Json<Value>> {
    if key == NEW {
        let books: Vec<Spine> = sqlx::query_as(
            "SELECT id, title, authors, languages, shelf_index FROM books
             WHERE shelf_index IS NULL ORDER BY id DESC LIMIT $1",
        )
        .bind(PER_CASE as i64)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
        let list: Vec<_> = books.iter().enumerate().map(|(i, b)| spine(b, i)).collect();
        return Ok(Json(json!({ "wing": NEW, "case": 0, "books": list })));
    }
    let w = known_wing(&key)?;
    if n < 0 || n as usize >= w.cases() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_case",
            "No such bookcase.",
        ));
    }
    let first = n * PER_CASE as i32;
    let books: Vec<Spine> = sqlx::query_as(
        "SELECT id, title, authors, languages, shelf_index FROM books
         WHERE wing = $1 AND shelf_index >= $2 AND shelf_index < $3 ORDER BY shelf_index",
    )
    .bind(w.key)
    .bind(first)
    .bind(first + PER_CASE as i32)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let list: Vec<_> = books
        .iter()
        .map(|b| spine(b, (b.shelf_index.unwrap_or(first) - first) as usize))
        .collect();
    Ok(Json(json!({ "wing": w.key, "case": n, "books": list })))
}

#[derive(Deserialize)]
struct SearchQ {
    #[serde(default)]
    q: String,
    /// Only books in this language (an ISO code).
    #[serde(default)]
    lang: String,
}

/// A prefix query for Postgres from what someone typed: every word must
/// match the start of a word in the title, authors or subjects.
pub fn ts_query(q: &str) -> Option<String> {
    let words: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(8)
        .map(|w| format!("{}:*", w.to_lowercase()))
        .collect();
    (!words.is_empty()).then(|| words.join(" & "))
}

/// Where a book stands: its wing, bookcase and slot (or the New Arrivals case).
fn place(wing: &str, shelf_index: Option<i32>) -> Value {
    match shelf_index {
        Some(i) => json!({
            "wing": wing,
            "case": i as usize / PER_CASE,
            "slot": i as usize % PER_CASE,
        }),
        None => json!({ "wing": NEW, "case": 0, "slot": Value::Null }),
    }
}

/// The catalogue desk: books matching every word, best first; a number
/// finds that book.
async fn search(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<SearchQ>,
) -> ApiResult<Json<Value>> {
    bearer_player(&state, &headers)?;
    if q.q.len() > 200 || q.lang.len() > 8 {
        return Err(ApiError::bad_request(
            "bad_request",
            "That's a long search.",
        ));
    }
    let lang = q.lang.trim();
    let id: Option<i32> = q.q.trim().parse().ok();
    let Some(tsq) = ts_query(&q.q) else {
        return Ok(Json(json!({ "books": [] })));
    };
    let rows: Vec<(i32, String, String, String, String, Option<i32>)> = sqlx::query_as(
        "SELECT id, title, authors, languages, wing, shelf_index FROM books
         WHERE (search @@ to_tsquery('simple', $1) OR id = $2)
           AND ($3 = '' OR $3 = ANY(string_to_array(replace(languages, ' ', ''), ';')))
         ORDER BY id = $2 DESC, ts_rank(search, to_tsquery('simple', $1)) DESC, id
         LIMIT 40",
    )
    .bind(&tsq)
    .bind(id)
    .bind(lang)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let books: Vec<_> = rows
        .iter()
        .map(|(id, title, authors, languages, wing, shelf)| {
            json!({
                "id": id,
                "title": title,
                "authors": authors,
                "lang": first_language(languages),
                "language": language_name(first_language(languages)),
                "at": place(wing, *shelf),
            })
        })
        .collect();
    Ok(Json(json!({ "books": books })))
}

/// A book's card.
async fn book(State(state): S, Path(id): Path<i32>) -> ApiResult<Json<Value>> {
    type Row = (
        String,
        String,
        String,
        String,
        String,
        String,
        Option<chrono::NaiveDate>,
        String,
        Option<i32>,
    );
    let row: Option<Row> = sqlx::query_as(
        "SELECT title, authors, languages, subjects, locc, bookshelves, issued, wing, shelf_index
         FROM books WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let Some((title, authors, languages, subjects, locc, shelves, issued, wing, shelf)) = row
    else {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_book",
            "That book isn't in the catalogue.",
        ));
    };
    let list = |s: &str| lib::codes(s).map(String::from).collect::<Vec<_>>();
    let langs: Vec<_> = lib::codes(&languages)
        .map(|c| json!({ "code": c, "name": language_name(c) }))
        .collect();
    Ok(Json(json!({
        "id": id,
        "title": title,
        "authors": list(&authors),
        "languages": langs,
        "subjects": list(&subjects),
        "locc": list(&locc),
        "bookshelves": lib::codes(&shelves)
            .map(|s| s.trim_start_matches("Category: ").to_string())
            .collect::<Vec<_>>(),
        "issued": issued.map(|d| d.to_string()),
        "at": place(&wing, shelf),
    })))
}

/// One row of Gutenberg's catalogue (`pg_catalog.csv`).
#[derive(Debug, Clone, Default)]
pub struct Record {
    pub id: i32,
    pub title: String,
    pub authors: String,
    pub languages: String,
    pub subjects: String,
    pub locc: String,
    pub bookshelves: String,
    /// "1971-12-01", or empty.
    pub issued: String,
}

/// Adds new books and updates changed ones, in batches. New books (and
/// books whose wing changed) have no place yet: they wait on the New
/// Arrivals case until the next [`reshelve`]. Returns how many were new.
pub async fn upsert(db: &PgPool, records: &[Record]) -> sqlx::Result<usize> {
    let mut added = 0;
    for chunk in records.chunks(2000) {
        let col =
            |f: fn(&Record) -> &str| chunk.iter().map(|r| f(r).to_string()).collect::<Vec<_>>();
        let ids: Vec<i32> = chunk.iter().map(|r| r.id).collect();
        let wings: Vec<String> = chunk
            .iter()
            .map(|r| lib::wing_for(&r.languages, &r.locc).to_string())
            .collect();
        let inserted: Vec<(bool,)> = sqlx::query_as(
            "INSERT INTO books (id, title, authors, languages, subjects, locc, bookshelves, issued, wing)
             SELECT id, title, authors, languages, subjects, locc, bookshelves, NULLIF(issued, '')::date, wing
             FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                         $7::text[], $8::text[], $9::text[])
                  AS t(id, title, authors, languages, subjects, locc, bookshelves, issued, wing)
             ON CONFLICT (id) DO UPDATE SET
                 title = EXCLUDED.title, authors = EXCLUDED.authors,
                 languages = EXCLUDED.languages, subjects = EXCLUDED.subjects,
                 locc = EXCLUDED.locc, bookshelves = EXCLUDED.bookshelves,
                 issued = EXCLUDED.issued, wing = EXCLUDED.wing,
                 shelf_index = CASE WHEN books.wing = EXCLUDED.wing THEN books.shelf_index END
             WHERE (books.title, books.authors, books.languages, books.subjects, books.locc,
                    books.bookshelves, books.issued, books.wing)
                   IS DISTINCT FROM
                   (EXCLUDED.title, EXCLUDED.authors, EXCLUDED.languages, EXCLUDED.subjects,
                    EXCLUDED.locc, EXCLUDED.bookshelves, EXCLUDED.issued, EXCLUDED.wing)
             RETURNING (xmax = 0)",
        )
        .bind(&ids)
        .bind(col(|r| &r.title))
        .bind(col(|r| &r.authors))
        .bind(col(|r| &r.languages))
        .bind(col(|r| &r.subjects))
        .bind(col(|r| &r.locc))
        .bind(col(|r| &r.bookshelves))
        .bind(col(|r| &r.issued))
        .bind(&wings)
        .fetch_all(db)
        .await?;
        added += inserted.iter().filter(|r| r.0).count();
    }
    Ok(added)
}

#[derive(Debug, thiserror::Error)]
pub enum ShelveError {
    #[error(
        "the {wing} wing holds {capacity} books but has {books}: make it bigger in commons_sim::library::WINGS (and regenerate the maps)"
    )]
    Full {
        wing: &'static str,
        capacity: usize,
        books: usize,
    },
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Files every book into its wing's shelf list, in call-number order
/// (new arrivals included). Refuses, changing nothing, if a wing would
/// overflow. Returns how many books each wing holds.
pub async fn reshelve(db: &PgPool) -> Result<BTreeMap<&'static str, usize>, ShelveError> {
    let rows: Vec<(i32, String, String, String, String, String)> =
        sqlx::query_as("SELECT id, title, authors, languages, locc, wing FROM books")
            .fetch_all(db)
            .await?;
    let mut by_wing: BTreeMap<&'static str, Vec<Shelving>> = BTreeMap::new();
    for (id, title, authors, languages, locc, wing) in &rows {
        let Some(w) = lib::wing(wing) else { continue };
        by_wing.entry(w.key).or_default().push(Shelving {
            id: *id,
            title,
            authors,
            languages,
            locc,
        });
    }
    let mut ids = vec![];
    let mut places = vec![];
    let mut counts = BTreeMap::new();
    for (key, books) in &mut by_wing {
        let w = lib::wing(key).expect("known wing");
        if books.len() > w.capacity() {
            return Err(ShelveError::Full {
                wing: w.key,
                capacity: w.capacity(),
                books: books.len(),
            });
        }
        books.sort_by_cached_key(shelf_key);
        for (i, b) in books.iter().enumerate() {
            ids.push(b.id);
            places.push(i as i32);
        }
        counts.insert(*key, books.len());
    }
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE books SET shelf_index = NULL")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE books b SET shelf_index = t.i FROM UNNEST($1::int[], $2::int[]) AS t(id, i)
         WHERE b.id = t.id",
    )
    .bind(&ids)
    .bind(&places)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(counts)
}
