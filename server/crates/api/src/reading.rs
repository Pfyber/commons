//! Reading in the Library (ADR 0012, L2). A book's text is fetched from
//! Project Gutenberg by this server (never the player's browser) the first
//! time anyone opens it: one fetch at a time, a pause between fetches, a
//! proper User-Agent. It's cleaned of Gutenberg's header and footer (what's
//! left is plain public-domain text), hard-wrapped prose is joined back into
//! paragraphs (verse keeps its lines), and it's cut into pages at paragraph
//! breaks and kept in `book_pages`. Each player's place in each book is
//! kept in `reading`.
//!
//! - `GET /api/library/books/{id}/text[?page=n]`: a page (without `page`:
//!   where you left off, with the contents).
//! - `POST /api/library/reading`: `{book, page}`, your place.
//! - `GET /api/library/reading`: what you've been reading, latest first.

use crate::AppState;
use crate::economy::bearer_player;
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::config;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

type S = State<Arc<AppState>>;

/// How texts are cleaned and paged: bump it when that changes, and books
/// are fetched and paged again as they're next opened.
pub const TEXT_VERSION: i32 = 2;

/// Characters on a page, about a screenful.
pub const PAGE_CHARS: usize = 2400;
/// Biggest text we'll take (the longest Gutenberg texts are a few MB).
const MAX_BYTES: usize = 24 << 20;
/// Readers waiting on fetches before we say the stacks are busy.
const MAX_WAITING: usize = 24;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/library/books/{id}/text", get(text))
        .route("/library/reading", post(save_place).get(recent))
}

// ---- cleaning and paging ------------------------------------------------------

/// The book itself: Gutenberg's header (up to the `*** START OF …` line)
/// and footer (from `*** END OF …`) taken off, line endings made plain.
pub fn clean(raw: &str) -> String {
    let text = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let marker = |line: &str, word: &str| {
        let l = line.trim().to_ascii_uppercase();
        l.starts_with("***") && l.contains(word) && l.contains("GUTENBERG")
    };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines
        .iter()
        .position(|l| marker(l, "START OF"))
        .map_or(0, |i| i + 1);
    let end = lines[start..]
        .iter()
        .position(|l| marker(l, "END OF"))
        .map_or(lines.len(), |i| start + i);
    lines[start..end].join("\n").trim_matches('\n').to_string()
}

/// Paragraphs: blank-line separated. Hard-wrapped prose (every line but the
/// last runs long, and they don't all start with capitals) is joined back
/// into one line; anything else (verse, headings, lists, tables) keeps its
/// line breaks and indentation.
pub fn paragraphs(text: &str) -> Vec<String> {
    let mut out = vec![];
    for block in bracketed(text) {
        let lines: Vec<&str> = block
            .lines()
            .map(str::trim_end)
            .filter(|l| !l.trim().is_empty())
            .collect();
        if lines.is_empty() {
            continue;
        }
        // Verse: (nearly) every line starts with a capital, however long.
        let capitals = lines[1..]
            .iter()
            .filter(|l| {
                l.trim_start()
                    .chars()
                    .find(|c| c.is_alphabetic())
                    .is_some_and(char::is_uppercase)
            })
            .count();
        let verse = lines.len() >= 3 && capitals * 5 >= (lines.len() - 1) * 4;
        let prose = lines.len() > 1
            && !verse
            && lines[..lines.len() - 1]
                .iter()
                .all(|l| l.chars().count() >= 45 && !l.starts_with("    "));
        if prose || lines.len() == 1 {
            out.push(lines.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" "));
        } else {
            // Keep the verse's shape, minus the spaces every line starts with.
            let indent = lines
                .iter()
                .map(|l| l.len() - l.trim_start_matches(' ').len())
                .min()
                .unwrap_or(0);
            out.push(
                lines
                    .iter()
                    .map(|l| &l[indent..])
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
    }
    out
}

/// Blank-line separated blocks, except that a bracketed note running over
/// several (`[Illustration: …]`, `[Footnote …]`) stays one block (up to a
/// dozen: an unclosed bracket mustn't swallow the book).
fn bracketed(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut open = 0;
    for block in text.split("\n\n") {
        let depth = block.matches('[').count() as i32 - block.matches(']').count() as i32;
        match out.last_mut() {
            Some(last) if open > 0 => {
                last.push('\n');
                last.push_str(block);
                open = if depth < 0 { 0 } else { open - 1 };
            }
            _ => {
                out.push(block.to_string());
                open = if depth > 0 && block.trim_start().starts_with('[') {
                    12
                } else {
                    0
                };
            }
        }
    }
    out
}

/// Splits a paragraph too long for a page at sentence ends.
fn split_long(p: &str, max: usize) -> Vec<String> {
    if p.len() <= max {
        return vec![p.to_string()];
    }
    let mut out = vec![];
    let mut cur = String::new();
    for sentence in p.split_inclusive(". ") {
        if !cur.is_empty() && cur.len() + sentence.len() > max {
            out.push(cur.trim_end().to_string());
            cur.clear();
        }
        cur.push_str(sentence);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim_end().to_string());
    }
    out
}

/// Cuts paragraphs into pages of about `PAGE_CHARS`, at paragraph breaks.
pub fn paginate(paras: &[String]) -> Vec<String> {
    let mut pages = vec![];
    let mut cur: Vec<String> = vec![];
    let mut len = 0;
    for p in paras.iter().flat_map(|p| split_long(p, PAGE_CHARS * 3 / 2)) {
        if !cur.is_empty() && len + p.len() > PAGE_CHARS {
            pages.push(cur.join("\n\n"));
            cur.clear();
            len = 0;
        }
        len += p.len() + 2;
        cur.push(p);
    }
    if !cur.is_empty() {
        pages.push(cur.join("\n\n"));
    }
    pages
}

/// Words that start a chapter heading.
const HEADINGS: &[&str] = &[
    "chapter",
    "book",
    "part",
    "act",
    "letter",
    "stave",
    "canto",
    "volume",
    "prologue",
    "epilogue",
    "preface",
    "introduction",
    "chapitre",
    "livre",
    "kapitel",
    "capitulo",
    "capítulo",
    "capitolo",
    "luku",
];

fn heading(p: &str) -> bool {
    if p.contains('\n') || p.chars().count() > 70 {
        return false;
    }
    let p = p.trim_matches(|c| c == '[' || c == ']');
    let first = p
        .split(|c: char| !c.is_alphanumeric())
        .find(|w| !w.is_empty())
        .unwrap_or("")
        .to_lowercase();
    HEADINGS.contains(&first.as_str())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub page: usize,
    pub title: String,
}

/// The book's contents: its chapter headings and the page each is on. A
/// heading that appears more than once (in a printed table of contents,
/// then at the chapter itself) counts where it last appears.
pub fn contents(pages: &[String]) -> Vec<Entry> {
    let mut out: Vec<Entry> = vec![];
    for (i, page) in pages.iter().enumerate() {
        for p in page.split("\n\n") {
            // A heading can close a picture's caption: "[Illustration: … Chapter I.]".
            let p = if p.trim_start().starts_with('[') {
                p.lines().last().unwrap_or("")
            } else {
                p
            };
            if !heading(p) {
                continue;
            }
            let title = p
                .trim()
                .trim_matches(|c| c == '[' || c == ']')
                .trim()
                .to_string();
            out.retain(|e| e.title != title);
            out.push(Entry { page: i, title });
        }
    }
    out.sort_by_key(|e| e.page);
    out.truncate(400);
    out
}

// ---- fetching -----------------------------------------------------------------

struct Fetcher {
    client: reqwest::Client,
    /// One fetch at a time; when the last one finished.
    gate: tokio::sync::Mutex<Option<Instant>>,
    waiting: AtomicUsize,
    pause: Duration,
}

static FETCHER: LazyLock<Fetcher> = LazyLock::new(|| {
    let contact = config::env_str("LIBRARY_CONTACT", "");
    Fetcher {
        client: reqwest::Client::builder()
            .user_agent(format!("Commons-library/0.1 ({contact})"))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("http client"),
        gate: tokio::sync::Mutex::new(None),
        waiting: AtomicUsize::new(0),
        pause: Duration::from_millis(config::env_or("LIBRARY_FETCH_PAUSE_MS", 1500)),
    }
});

/// Where a book's plain text is: `{id}` is replaced by its number.
fn text_url(id: i32) -> String {
    config::env_str(
        "LIBRARY_TEXT_URL",
        "https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt",
    )
    .replace("{id}", &id.to_string())
}

enum Fetched {
    Text(String),
    Missing,
}

async fn download(id: i32) -> Result<Fetched, ApiError> {
    let busy = || {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "stacks_busy",
            "The stacks are busy. Try again in a moment.",
        )
    };
    let res = FETCHER.client.get(text_url(id)).send().await.map_err(|e| {
        tracing::warn!(book = id, error = %e, "fetching a book");
        busy()
    })?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Fetched::Missing);
    }
    if !res.status().is_success() {
        tracing::warn!(book = id, status = %res.status(), "fetching a book");
        return Err(busy());
    }
    if res.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Ok(Fetched::Missing);
    }
    let bytes = res.bytes().await.map_err(|_| busy())?;
    if bytes.len() > MAX_BYTES {
        return Ok(Fetched::Missing);
    }
    Ok(Fetched::Text(String::from_utf8_lossy(&bytes).into_owned()))
}

/// Cleans, pages and keeps a fetched text; returns how many pages.
pub async fn store(db: &PgPool, id: i32, raw: &str) -> sqlx::Result<usize> {
    let pages = paginate(&paragraphs(&clean(raw)));
    let toc = contents(&pages);
    let chars: usize = pages.iter().map(|p| p.len()).sum();
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO book_texts (book_id, status, pages, chars, contents, version)
         VALUES ($1, 'ok', $2, $3, $4, $5)
         ON CONFLICT (book_id) DO UPDATE SET status = 'ok', pages = $2, chars = $3,
             contents = $4, version = $5, fetched_at = now()",
    )
    .bind(id)
    .bind(pages.len() as i32)
    .bind(chars as i32)
    .bind(sqlx::types::Json(&toc))
    .bind(TEXT_VERSION)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM book_pages WHERE book_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let nums: Vec<i32> = (0..pages.len() as i32).collect();
    sqlx::query(
        "INSERT INTO book_pages (book_id, page, body) SELECT $1, * FROM UNNEST($2::int[], $3::text[])",
    )
    .bind(id)
    .bind(&nums)
    .bind(&pages)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pages.len())
}

struct Text {
    status: String,
    pages: i32,
    contents: Vec<Entry>,
}

async fn cached(db: &PgPool, id: i32) -> sqlx::Result<Option<Text>> {
    let row: Option<(String, i32, sqlx::types::Json<Vec<Entry>>)> = sqlx::query_as(
        "SELECT status, pages, contents FROM book_texts WHERE book_id = $1 AND version >= $2",
    )
    .bind(id)
    .bind(TEXT_VERSION)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|(status, pages, c)| Text {
        status,
        pages,
        contents: c.0,
    }))
}

/// The book's text, fetching it first if nobody has opened it before.
async fn ensure(db: &PgPool, id: i32) -> Result<Text, ApiError> {
    if let Some(t) = cached(db, id).await.map_err(db_err)? {
        return Ok(t);
    }
    let f = &*FETCHER;
    if f.waiting.fetch_add(1, Ordering::SeqCst) >= MAX_WAITING {
        f.waiting.fetch_sub(1, Ordering::SeqCst);
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "stacks_busy",
            "The stacks are busy. Try again in a moment.",
        ));
    }
    let mut last = f.gate.lock().await;
    f.waiting.fetch_sub(1, Ordering::SeqCst);
    // Someone may have fetched it while we waited.
    if let Some(t) = cached(db, id).await.map_err(db_err)? {
        return Ok(t);
    }
    if let Some(at) = *last {
        let since = at.elapsed();
        if since < f.pause {
            tokio::time::sleep(f.pause - since).await;
        }
    }
    let got = download(id).await;
    *last = Some(Instant::now());
    drop(last);
    match got? {
        Fetched::Text(raw) => {
            let pages = store(db, id, &raw).await.map_err(db_err)?;
            tracing::info!(book = id, pages, "fetched a book");
        }
        Fetched::Missing => {
            sqlx::query(
                "INSERT INTO book_texts (book_id, status, version) VALUES ($1, 'missing', $2)
                 ON CONFLICT (book_id) DO UPDATE SET status = 'missing', pages = 0, version = $2,
                     fetched_at = now()",
            )
            .bind(id)
            .bind(TEXT_VERSION)
            .execute(db)
            .await
            .map_err(db_err)?;
        }
    }
    cached(db, id).await.map_err(db_err)?.ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Lost the book.",
        )
    })
}

// ---- routes -------------------------------------------------------------------

#[derive(Deserialize)]
struct PageQ {
    page: Option<i32>,
}

/// A page of a book. Without `page`: the page you were on (the first, for a
/// new book), and the book's contents.
async fn text(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i32>,
    Query(q): Query<PageQ>,
) -> ApiResult<Json<Value>> {
    let player = bearer_player(&state, &headers)?;
    let title: Option<(String,)> = sqlx::query_as("SELECT title FROM books WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(db_err)?;
    let Some((title,)) = title else {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_book",
            "That book isn't in the catalogue.",
        ));
    };
    let t = ensure(&state.db, id).await?;
    if t.status != "ok" || t.pages == 0 {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_text",
            "This one's text can't be found in the stacks, sorry.",
        ));
    }
    let opening = q.page.is_none();
    let page = match q.page {
        Some(p) => p,
        None => sqlx::query_scalar::<_, i32>(
            "SELECT page FROM reading WHERE player_id = $1 AND book_id = $2",
        )
        .bind(player)
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(db_err)?
        .unwrap_or(0),
    }
    .clamp(0, t.pages - 1);
    let body: String =
        sqlx::query_scalar("SELECT body FROM book_pages WHERE book_id = $1 AND page = $2")
            .bind(id)
            .bind(page)
            .fetch_one(&state.db)
            .await
            .map_err(db_err)?;
    let mut out = json!({
        "id": id,
        "title": title,
        "page": page,
        "pages": t.pages,
        "body": body,
    });
    if opening {
        out["contents"] = json!(t.contents);
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
struct Place {
    book: i32,
    page: i32,
}

/// Keeps your place in a book.
async fn save_place(
    State(state): S,
    headers: HeaderMap,
    Json(p): Json<Place>,
) -> ApiResult<StatusCode> {
    let player = bearer_player(&state, &headers)?;
    let pages: Option<i32> =
        sqlx::query_scalar("SELECT pages FROM book_texts WHERE book_id = $1 AND status = 'ok'")
            .bind(p.book)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let Some(pages) = pages else {
        return Err(ApiError::bad_request("not_open", "Open the book first."));
    };
    sqlx::query(
        "INSERT INTO reading (player_id, book_id, page) VALUES ($1, $2, $3)
         ON CONFLICT (player_id, book_id) DO UPDATE SET page = $3, updated_at = now()",
    )
    .bind(player)
    .bind(p.book)
    .bind(p.page.clamp(0, pages - 1))
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

/// What you've been reading, latest first.
async fn recent(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let player = bearer_player(&state, &headers)?;
    let rows: Vec<(i32, String, String, i32, i32)> = sqlx::query_as(
        "SELECT r.book_id, b.title, b.authors, r.page, t.pages
         FROM reading r JOIN books b ON b.id = r.book_id JOIN book_texts t ON t.book_id = r.book_id
         WHERE r.player_id = $1 ORDER BY r.updated_at DESC LIMIT 10",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let list: Vec<_> = rows
        .iter()
        .map(|(id, title, authors, page, pages)| {
            json!({ "id": id, "title": title, "authors": authors, "page": page, "pages": pages })
        })
        .collect();
    Ok(Json(json!({ "books": list })))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &str = "\u{feff}The Project Gutenberg eBook of A Test\r\n\r\nThis ebook is for the use of anyone.\r\n\r\n*** START OF THE PROJECT GUTENBERG EBOOK A TEST ***\r\n\r\nCONTENTS\r\n\r\nCHAPTER I. The Start\r\nCHAPTER II. The End\r\n\r\nCHAPTER I. The Start\r\n\r\nIt was a bright cold day in April, and the clocks were striking\r\nthirteen. Winston Smith, his chin nuzzled into his breast in an\r\neffort to escape the vile wind.\r\n\r\n    Tyger Tyger, burning bright,\r\n      In the forests of the night;\r\n\r\nCHAPTER II. The End\r\n\r\nShort.\r\n\r\n*** END OF THE PROJECT GUTENBERG EBOOK A TEST ***\r\n\r\nUpdated editions will replace the previous one.\r\n";

    #[test]
    fn takes_off_the_header_and_footer() {
        let c = clean(RAW);
        assert!(c.starts_with("CONTENTS"));
        assert!(c.ends_with("Short."));
        assert!(!c.contains("Gutenberg"));
        assert!(!c.contains('\r'));
        assert_eq!(clean("Just a text."), "Just a text.");
    }

    #[test]
    fn joins_prose_and_keeps_verse() {
        let p = paragraphs(&clean(RAW));
        assert_eq!(
            p[3],
            "It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast in an effort to escape the vile wind."
        );
        assert_eq!(
            p[4],
            "Tyger Tyger, burning bright,\n  In the forests of the night;"
        );
        assert_eq!(p[1], "CHAPTER I. The Start\nCHAPTER II. The End");
    }

    #[test]
    fn a_picture_spanning_paragraphs_is_one() {
        let text = "Before.\n\n[Illustration:\n\nGEORGE ALLEN\n\nLONDON\n]\n\nAfter.";
        let p = paragraphs(text);
        assert_eq!(p.len(), 3);
        assert!(p[1].starts_with("[Illustration:") && p[1].ends_with(']'));
        assert_eq!(p[2], "After.");
    }

    #[test]
    fn long_verse_keeps_its_lines() {
        let raven = "Once upon a midnight dreary, while I pondered, weak and weary,
Over many a quaint and curious volume of forgotten lore—
While I nodded, nearly napping, suddenly there came a tapping,
As of some one gently rapping, rapping at my chamber door.";
        let p = paragraphs(raven);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].lines().count(), 4);
        let prose = "It is a truth universally acknowledged, that a single man in
possession of a good fortune, must be in want of a wife. However little
known the feelings or views of such a man may be on his first entering
a neighbourhood, this truth is so well fixed.";
        assert_eq!(paragraphs(prose)[0].lines().count(), 1);
    }

    #[test]
    fn pages_break_between_paragraphs() {
        let paras: Vec<String> = (0..50)
            .map(|i| format!("{i} {}", "word ".repeat(40)))
            .collect();
        let pages = paginate(&paras);
        assert!(pages.len() > 1);
        assert!(pages.iter().all(|p| p.len() <= PAGE_CHARS + 300));
        let back: Vec<&str> = pages.iter().flat_map(|p| p.split("\n\n")).collect();
        assert_eq!(back.len(), 50, "no paragraph lost or split");
        // A giant paragraph is cut at sentence ends.
        let giant = vec!["A sentence here. ".repeat(600)];
        let pages = paginate(&giant);
        assert!(pages.len() >= 3);
        assert!(pages.iter().all(|p| p.ends_with('.')));
    }

    #[test]
    fn contents_point_at_the_chapters() {
        let mut pages: Vec<String> = vec!["CONTENTS\n\nCHAPTER I. The Start".into()];
        pages.push("CHAPTER I. The Start\n\nOnce upon a time.".into());
        pages.push("More.".into());
        pages.push("Chapter II\n\nThe end.\n\nCHAPTER III is mentioned in a long sentence that runs on and on well past seventy characters.".into());
        let c = contents(&pages);
        assert_eq!(
            c,
            vec![
                Entry {
                    page: 1,
                    title: "CHAPTER I. The Start".into()
                },
                Entry {
                    page: 3,
                    title: "Chapter II".into()
                },
            ]
        );
    }
}
