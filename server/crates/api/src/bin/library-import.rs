//! Stocks the Library's catalogue (ADR 0012) from Project Gutenberg's
//! machine-readable catalogue, every text in every language, by hand. (The
//! API server also does this itself: when it starts with an empty library,
//! and weekly; see `commons_api::stocking`.) New books join the New Arrivals
//! case in the hall; `--reshelve` files everything into the wings (done
//! automatically on the first import).
//!
//! ```text
//! library-import [--csv pg_catalog.csv] [--reshelve]
//! ```
//!
//! Without `--csv` it downloads the catalogue (about 20 MB) from
//! `LIBRARY_CATALOG_URL`, Gutenberg's own feed by default.

use anyhow::{Context, bail};
use commons_api::stocking::{download, stock};
use commons_common::config;

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
            println!("downloading Gutenberg's catalogue");
            download().await?
        }
    };
    let db_url = config::env_str(
        "DATABASE_URL",
        "postgres://commons:commons@localhost:5432/commons",
    );
    let db = commons_api::connect(&db_url, 4).await?;
    let s = stock(&db, &bytes, force_reshelve).await?;
    println!("{} texts in the catalogue, {} new", s.texts, s.added);
    match s.shelved {
        Some(counts) => {
            for (wing, n) in counts {
                println!("  {wing:>10}: {n}");
            }
            println!("re-shelved");
        }
        None if s.added > 0 => println!("new books wait on the New Arrivals case until --reshelve"),
        None => {}
    }
    Ok(())
}
