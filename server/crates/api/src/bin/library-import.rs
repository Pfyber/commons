//! Fills the Library's catalogue (ADR 0012) from Project Gutenberg's
//! machine-readable catalogue, every text in every language. Run it weekly:
//! new books join the New Arrivals case in the hall; `--reshelve` files
//! everything into the wings (done automatically on the first import).
//!
//! ```text
//! library-import [--csv pg_catalog.csv] [--reshelve]
//! ```
//!
//! Without `--csv` it downloads the catalogue (about 20 MB) from
//! `LIBRARY_CATALOG_URL`, Gutenberg's own feed by default.

use anyhow::{Context, bail};
use commons_api::library::{Record, reshelve, upsert};
use commons_common::config;

const CATALOG_URL: &str = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv";

/// Reads the catalogue: texts only (not the audio books), the columns we keep.
fn parse(csv: &[u8]) -> anyhow::Result<Vec<Record>> {
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

async fn download(url: &str) -> anyhow::Result<Vec<u8>> {
    let contact = config::env_str("LIBRARY_CONTACT", "");
    let agent = format!("Commons-library-import/0.1 ({contact})");
    let res = reqwest::Client::builder()
        .user_agent(agent)
        .build()?
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    Ok(res.bytes().await?.to_vec())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut csv_path = None;
    let mut force_reshelve = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--csv" => csv_path = Some(it.next().context("--csv needs a path")?.clone()),
            "--reshelve" => force_reshelve = true,
            _ => bail!("usage: library-import [--csv pg_catalog.csv] [--reshelve]"),
        }
    }
    let bytes = match &csv_path {
        Some(p) => std::fs::read(p).with_context(|| format!("reading {p}"))?,
        None => {
            let url = config::env_str("LIBRARY_CATALOG_URL", CATALOG_URL);
            println!("downloading {url}");
            download(&url).await?
        }
    };
    let records = parse(&bytes)?;
    println!("{} texts in the catalogue", records.len());

    let db_url = config::env_str(
        "DATABASE_URL",
        "postgres://commons:commons@localhost:5432/commons",
    );
    let db = commons_api::connect(&db_url, 4).await?;
    let added = upsert(&db, &records).await?;
    println!("{added} new books");
    let (shelved,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM books WHERE shelf_index IS NOT NULL")
            .fetch_one(&db)
            .await?;
    if force_reshelve || shelved == 0 {
        let counts = reshelve(&db).await?;
        for (wing, n) in counts {
            println!("  {wing:>10}: {n}");
        }
        println!("re-shelved");
    } else if added > 0 {
        println!("new books wait on the New Arrivals case until --reshelve");
    }
    Ok(())
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
