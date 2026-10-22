//! Stocking the Library (ADR 0012): reading Project Gutenberg's catalogue
//! (`pg_catalog.csv`, every text in every language) into `books`. The API
//! server does this by itself: on starting with an empty library, and then
//! once a week for new books ([`spawn`], `LIBRARY_AUTO_STOCK`). The
//! `library-import` command does the same by hand.
//!
//! The first stocking files every book into the wings; later ones put new
//! books on the New Arrivals case until a re-shelving.

use crate::library::{Record, ShelveError, reshelve, upsert};
use anyhow::Context;
use commons_common::config;
use sqlx::PgPool;
use std::collections::BTreeMap;
use std::time::Duration;

pub const CATALOG_URL: &str = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv";

/// How often a running server looks for new books.
const EVERY: Duration = Duration::from_secs(7 * 24 * 3600);
/// After a failed stocking (Gutenberg down, no network), try again in an hour.
const RETRY: Duration = Duration::from_secs(3600);

/// Reads the catalogue: texts only (not the audio books), the columns we keep.
pub fn parse(csv: &[u8]) -> anyhow::Result<Vec<Record>> {
    let mut rd = csv::Reader::from_reader(csv);
    let head = rd.headers()?.clone();
    let names = [
        "Text#",
        "Type",
        "Issued",
        "Title",
        "Language",
        "Authors",
        "Subjects",
        "LoCC",
        "Bookshelves",
    ];
    let mut cols = [0; 9];
    for (c, name) in cols.iter_mut().zip(names) {
        *c = head
            .iter()
            .position(|h| h == name)
            .with_context(|| format!("the catalogue has no {name} column"))?;
    }
    let [
        id,
        kind,
        issued,
        title,
        language,
        authors,
        subjects,
        locc,
        shelves,
    ] = cols;
    let mut out = vec![];
    for row in rd.records() {
        let row = row?;
        if &row[kind] != "Text" {
            continue;
        }
        let Ok(n) = row[id].parse() else { continue };
        // Multi-line titles are a title and a subtitle.
        let title = row[title].split_whitespace().collect::<Vec<_>>().join(" ");
        let issued = &row[issued];
        out.push(Record {
            id: n,
            title,
            authors: row[authors].to_string(),
            languages: row[language].to_string(),
            subjects: row[subjects].to_string(),
            locc: row[locc].to_string(),
            bookshelves: row[shelves].to_string(),
            issued: if issued.len() == 10 {
                issued.to_string()
            } else {
                String::new()
            },
        });
    }
    Ok(out)
}

/// Downloads the catalogue (about 20 MB) from `LIBRARY_CATALOG_URL`.
pub async fn download() -> anyhow::Result<Vec<u8>> {
    let url = config::env_str("LIBRARY_CATALOG_URL", CATALOG_URL);
    let contact = config::env_str("LIBRARY_CONTACT", "");
    let res = reqwest::Client::builder()
        .user_agent(format!("Commons-library-import/0.1 ({contact})"))
        .timeout(Duration::from_secs(300))
        .build()?
        .get(&url)
        .send()
        .await
        .with_context(|| format!("fetching {url}"))?
        .error_for_status()?;
    Ok(res.bytes().await?.to_vec())
}

/// What a stocking did.
#[derive(Debug)]
pub struct Stocked {
    /// Texts in the catalogue.
    pub texts: usize,
    /// Books we didn't have.
    pub added: usize,
    /// Books per wing, when everything was (re-)shelved.
    pub shelved: Option<BTreeMap<&'static str, usize>>,
}

/// Adds the catalogue's new books and updates changed ones; files everything
/// into the wings if asked to or if nothing is shelved yet (the first time).
pub async fn stock(db: &PgPool, csv: &[u8], force_reshelve: bool) -> anyhow::Result<Stocked> {
    let records = parse(csv)?;
    let added = upsert(db, &records).await?;
    let shelved_now: i64 =
        sqlx::query_scalar("SELECT count(*) FROM books WHERE shelf_index IS NOT NULL")
            .fetch_one(db)
            .await?;
    let shelved = if force_reshelve || shelved_now == 0 {
        Some(reshelve(db).await.map_err(|e| match e {
            ShelveError::Db(e) => anyhow::Error::from(e),
            full => anyhow::anyhow!(full.to_string()),
        })?)
    } else {
        None
    };
    Ok(Stocked {
        texts: records.len(),
        added,
        shelved,
    })
}

/// Keeps the Library stocked from Gutenberg while the server runs: at once
/// if it's empty, then weekly. Off with `LIBRARY_AUTO_STOCK=false`.
pub fn spawn(db: PgPool) {
    if !config::env_or("LIBRARY_AUTO_STOCK", true) {
        return;
    }
    tokio::spawn(async move {
        loop {
            let empty = sqlx::query_scalar::<_, bool>("SELECT NOT EXISTS (SELECT 1 FROM books)")
                .fetch_one(&db)
                .await
                .unwrap_or(false);
            if !empty {
                tokio::time::sleep(EVERY).await;
            }
            tracing::info!("stocking the library from Project Gutenberg");
            let result = match download().await {
                Ok(csv) => stock(&db, &csv, false).await,
                Err(e) => Err(e),
            };
            match result {
                Ok(s) => tracing::info!(
                    texts = s.texts,
                    added = s.added,
                    shelved = s.shelved.is_some(),
                    "library stocked"
                ),
                Err(e) => {
                    tracing::warn!(error = %e, "stocking the library failed; trying again later");
                    tokio::time::sleep(RETRY).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_texts_only() {
        let csv = "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n\
                   1,Text,1971-12-01,\"The Declaration\nOf Independence\",en,\"Jefferson, Thomas\",History,E201; JK,Politics\n\
                   2,Sound,2003-01-01,An Audio Book,en,,,,\n\
                   3,Text,,Kalevala,fi,,,PH,\n";
        let r = parse(csv.as_bytes()).unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].title, "The Declaration Of Independence");
        assert_eq!(r[0].locc, "E201; JK");
        assert_eq!(r[1].issued, "");
    }
}
