//! Corner activities that keep state: the shared easels and their gallery
//! (art corner) and the town word (games corner). The live parts (strokes
//! appearing for people nearby, jam notes, the ball) go through the zone
//! server; this is what's saved.
//!
//! Easels: anyone can paint; painters are remembered until someone hangs the
//! painting in the gallery, credited to all of them, and the easel is wiped.
//!
//! Town word: one five-letter word a day, solved by everyone together. Every
//! guess is shown to every visitor, so each one helps the next. Whoever
//! solves it gets a small reward, and so does everyone who guessed that day.

use crate::AppState;
use crate::auth::bearer;
use crate::economy::{self, COIN, Op};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::filter;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

pub const EASELS: i16 = 3;
pub const CELLS: usize = 256;
pub const COLORS: u8 = 16;
/// A painting needs this many painted cells before it can be hung.
pub const MIN_TO_HANG: usize = 24;
const MAX_STROKE: usize = 64;

/// Guesses the whole town gets each day, and each person's share of them.
pub const TOWN_GUESSES: i64 = 30;
pub const GUESSES_EACH: i64 = 6;
const GUESS_GAP_SECS: i64 = 8;
pub const SOLVER_REWARD: i32 = 30;
pub const HELPER_REWARD: i32 = 10;

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/play/easels/{id}", get(easel))
        .route("/play/easels/{id}/paint", post(paint))
        .route("/play/easels/{id}/hang", post(hang))
        .route("/play/gallery", get(gallery))
        .route("/play/word", get(word))
        .route("/play/word/guess", post(guess))
}

fn me(state: &AppState, headers: &HeaderMap) -> ApiResult<(Uuid, String)> {
    let who = bearer(state, headers)?;
    let id =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    Ok((id, who.name))
}

fn easel_id(id: i16) -> ApiResult<i16> {
    if (0..EASELS).contains(&id) {
        Ok(id)
    } else {
        Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "No such easel.",
        ))
    }
}

// ---- easels ---------------------------------------------------------------------------

#[derive(Serialize)]
struct EaselView {
    id: i16,
    cells: Vec<u8>,
    painters: Vec<String>,
}

async fn easel(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i16>,
) -> ApiResult<Json<EaselView>> {
    me(&state, &headers)?;
    let id = easel_id(id)?;
    let cells: Vec<u8> = sqlx::query_scalar("SELECT cells FROM easels WHERE id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
    let painters: Vec<String> =
        sqlx::query_scalar("SELECT name FROM easel_painters WHERE easel = $1 ORDER BY name")
            .bind(id)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    Ok(Json(EaselView {
        id,
        cells,
        painters,
    }))
}

#[derive(Deserialize)]
struct Stroke {
    /// `[cell, colour]` pairs.
    cells: Vec<(u16, u8)>,
}

async fn paint(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i16>,
    Json(req): Json<Stroke>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, name) = me(&state, &headers)?;
    let id = easel_id(id)?;
    if req.cells.is_empty()
        || req.cells.len() > MAX_STROKE
        || req
            .cells
            .iter()
            .any(|&(c, col)| c as usize >= CELLS || col >= COLORS)
    {
        return Err(ApiError::bad_request("bad_stroke", "Invalid stroke."));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let mut cells: Vec<u8> =
        sqlx::query_scalar("SELECT cells FROM easels WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    for &(c, col) in &req.cells {
        cells[c as usize] = col;
    }
    sqlx::query("UPDATE easels SET cells = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(&cells)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query(
        "INSERT INTO easel_painters (easel, player_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(me)
    .bind(&name)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct HangReq {
    title: String,
}

#[derive(Serialize)]
struct Painting {
    id: i64,
    title: String,
    cells: Vec<u8>,
    painters: Vec<String>,
    hung_by: String,
    at: i64,
}

async fn hang(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i16>,
    Json(req): Json<HangReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (_, name) = me(&state, &headers)?;
    let id = easel_id(id)?;
    let title = filter::clean_chat(&req.title)
        .map(|t| t.chars().take(40).collect::<String>())
        .ok_or_else(|| ApiError::bad_request("no_title", "Give it a title first."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let cells: Vec<u8> = sqlx::query_scalar("SELECT cells FROM easels WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if cells.iter().filter(|&&c| c != 0).count() < MIN_TO_HANG {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "too_empty",
            "Paint a little more before hanging it.",
        ));
    }
    let painters: Vec<String> =
        sqlx::query_scalar("SELECT name FROM easel_painters WHERE easel = $1 ORDER BY name")
            .bind(id)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_err)?;
    let gallery_id: i64 = sqlx::query_scalar(
        "INSERT INTO gallery (title, cells, painters, hung_by) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(&title)
    .bind(&cells)
    .bind(&painters)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("UPDATE easels SET cells = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(vec![0u8; CELLS])
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM easel_painters WHERE easel = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        serde_json::json!({ "id": gallery_id, "painters": painters }),
    ))
}

async fn gallery(State(state): S, headers: HeaderMap) -> ApiResult<Json<Vec<Painting>>> {
    me(&state, &headers)?;
    let rows = sqlx::query(
        "SELECT id, title, cells, painters, hung_by, extract(epoch FROM hung_at)::bigint AS at
         FROM gallery WHERE NOT hidden ORDER BY hung_at DESC LIMIT 24",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(
        rows.iter()
            .map(|r| Painting {
                id: r.get("id"),
                title: r.get("title"),
                cells: r.get("cells"),
                painters: r.get("painters"),
                hung_by: r.get("hung_by"),
                at: r.get("at"),
            })
            .collect(),
    ))
}

// ---- the town word ----------------------------------------------------------------------

/// Friendly, everyday five-letter words.
pub const WORDS: &[&str] = &[
    "apple", "beach", "bench", "berry", "bloom", "board", "bread", "brook", "brush", "cabin",
    "candy", "chair", "chalk", "charm", "chess", "cider", "cliff", "cloud", "coast", "cocoa",
    "coral", "craft", "crane", "cream", "crown", "daisy", "dance", "dream", "eagle", "earth",
    "fable", "feast", "fence", "field", "flame", "flute", "frost", "fruit", "ghost", "glass",
    "globe", "grape", "grass", "green", "guest", "happy", "heart", "honey", "horse", "house",
    "jelly", "jolly", "juice", "kayak", "lemon", "light", "lilac", "lunar", "magic", "mango",
    "maple", "march", "melon", "merry", "mirth", "money", "moose", "music", "night", "noble",
    "ocean", "olive", "otter", "paint", "panda", "paper", "party", "peach", "pearl", "piano",
    "pilot", "plant", "plaza", "plume", "polka", "poppy", "pride", "quiet", "quilt", "radio",
    "raven", "river", "robin", "royal", "salad", "scarf", "shade", "shell", "shine", "shore",
    "skate", "sleep", "smile", "snack", "spark", "spice", "sport", "spray", "stage", "stars",
    "stone", "storm", "story", "sugar", "sunny", "swing", "table", "tango", "teach", "thyme",
    "tiger", "toast", "tower", "train", "trail", "treat", "tulip", "tuned", "union", "unity",
    "vapor", "voice", "waltz", "water", "whale", "wheat", "while", "windy", "witty", "woods",
    "world", "yacht", "yummy", "zebra",
];

fn mix(mut h: u64) -> u64 {
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

/// The word for `day` (YYYY-MM-DD), the same everywhere.
pub fn word_for(day: &str) -> &'static str {
    let seed = day.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100_0000_01b3)
    });
    WORDS[(mix(seed) % WORDS.len() as u64) as usize]
}

/// Per-letter marks for a guess: `g` right place, `y` elsewhere in the word,
/// `.` not in it (repeated letters counted like the classic game).
pub fn marks(answer: &str, guess: &str) -> String {
    let a: Vec<u8> = answer.bytes().collect();
    let g: Vec<u8> = guess.bytes().collect();
    let mut out = [b'.'; 5];
    let mut left = [0u8; 26];
    for i in 0..5 {
        if g[i] == a[i] {
            out[i] = b'g';
        } else {
            left[(a[i] - b'a') as usize] += 1;
        }
    }
    for i in 0..5 {
        if out[i] != b'g' && left[(g[i] - b'a') as usize] > 0 {
            out[i] = b'y';
            left[(g[i] - b'a') as usize] -= 1;
        }
    }
    String::from_utf8(out.to_vec()).unwrap()
}

fn today() -> chrono::NaiveDate {
    chrono::Utc::now().date_naive()
}

#[derive(Serialize)]
struct GuessView {
    name: String,
    guess: String,
    marks: String,
}

async fn word_view(state: &AppState, me: Uuid) -> ApiResult<serde_json::Value> {
    let day = today();
    let answer = word_for(&day.to_string());
    let rows =
        sqlx::query("SELECT player_id, name, guess FROM word_guesses WHERE day = $1 ORDER BY at")
            .bind(day)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    let guesses: Vec<GuessView> = rows
        .iter()
        .map(|r| {
            let guess: String = r.get("guess");
            GuessView {
                name: r.get("name"),
                marks: marks(answer, &guess),
                guess,
            }
        })
        .collect();
    let solved_by = guesses
        .iter()
        .find(|g| g.guess == answer)
        .map(|g| g.name.clone());
    let mine = rows
        .iter()
        .filter(|r| r.get::<Uuid, _>("player_id") == me)
        .count() as i64;
    let over = solved_by.is_some() || guesses.len() as i64 >= TOWN_GUESSES;
    Ok(serde_json::json!({
        "day": day.to_string(),
        "guesses": guesses,
        "solved_by": solved_by,
        "answer": over.then_some(answer),
        "town_left": (TOWN_GUESSES - guesses.len() as i64).max(0),
        "mine_left": (GUESSES_EACH - mine).max(0),
        "helpers": rows.iter().map(|r| r.get::<Uuid, _>("player_id")).collect::<std::collections::HashSet<_>>().len(),
    }))
}

async fn word(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    Ok(Json(word_view(&state, me).await?))
}

#[derive(Deserialize)]
struct GuessReq {
    guess: String,
}

async fn guess(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<GuessReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, name) = me(&state, &headers)?;
    let g = req.guess.trim().to_ascii_lowercase();
    if g.len() != 5 || !g.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(ApiError::bad_request(
            "bad_guess",
            "Guesses are five letters.",
        ));
    }
    let day = today();
    let answer = word_for(&day.to_string());
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // One guess at a time for the whole town, so the counts stay exact.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('word_guesses'))")
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let (total, solved, mine, gap): (i64, bool, i64, Option<i64>) = sqlx::query_as(
        "SELECT count(*), bool_or(guess = $3), count(*) FILTER (WHERE player_id = $2),
                extract(epoch FROM now() - max(at) FILTER (WHERE player_id = $2))::bigint
         FROM word_guesses WHERE day = $1",
    )
    .bind(day)
    .bind(me)
    .bind(answer)
    .fetch_one(&mut *tx)
    .await
    .map(|(t, s, m, g): (i64, Option<bool>, i64, Option<i64>)| (t, s.unwrap_or(false), m, g))
    .map_err(db_err)?;
    let refuse = |code, msg: &str| Err(ApiError::new(StatusCode::CONFLICT, code, msg.to_string()));
    if solved {
        return refuse(
            "solved",
            "Today's word is already solved. New one tomorrow!",
        );
    }
    if total >= TOWN_GUESSES {
        return refuse("out_of_guesses", "The town is out of guesses today.");
    }
    if mine >= GUESSES_EACH {
        return refuse(
            "your_share",
            "You've made your guesses today. Let someone else try!",
        );
    }
    if gap.is_some_and(|s| s < GUESS_GAP_SECS) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "slow_down",
            "Take a moment to think first.",
        ));
    }
    sqlx::query("INSERT INTO word_guesses (day, player_id, name, guess) VALUES ($1, $2, $3, $4)")
        .bind(day)
        .bind(me)
        .bind(&name)
        .bind(&g)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let helpers: Vec<Uuid> =
        sqlx::query_scalar("SELECT DISTINCT player_id FROM word_guesses WHERE day = $1")
            .bind(day)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;

    crate::gov::touch(&state.db, me).await;
    let won = g == answer;
    if won {
        // Everyone who guessed today helped; the solver gets a bit more.
        for p in helpers {
            let coins = HELPER_REWARD + if p == me { SOLVER_REWARD } else { 0 };
            economy::apply_tx(
                &state.db,
                &state.catalog,
                p,
                &[Op {
                    item: COIN,
                    delta: coins,
                }],
                "town_word",
                &format!("word:{day}:{p}"),
            )
            .await?;
        }
    }
    let mut view = word_view(&state, me).await?;
    view["marks"] = serde_json::json!(marks(answer, &g));
    view["won"] = serde_json::json!(won);
    Ok(Json(view))
}
