//! The Library (ADR 0012): every Project Gutenberg book on a shelf. Which
//! wing a book belongs in, the order books stand in (the wing's shelf list,
//! like call numbers), and how big each wing is. Shared by the importer, the
//! API and the map generator.

use std::cmp::Ordering;

/// Books on one shelf of a bookcase.
pub const PER_SHELF: usize = 20;
/// Shelves in a bookcase.
pub const SHELVES: usize = 5;
/// Books in a bookcase.
pub const PER_CASE: usize = PER_SHELF * SHELVES;

/// A wing of the library: its own zone off the entrance hall, `rows` rows
/// of `cols` bookcases.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Wing {
    pub key: &'static str,
    pub name: &'static str,
    pub rows: u16,
    pub cols: u16,
}

impl Wing {
    /// The wing's zone.
    pub fn zone(&self) -> String {
        format!("library_{}", self.key)
    }
    pub fn cases(&self) -> usize {
        self.rows as usize * self.cols as usize
    }
    /// How many books the wing can shelve.
    pub fn capacity(&self) -> usize {
        self.cases() * PER_CASE
    }
}

/// The wings, in the order their doors stand along the hall. Sized with
/// about a third to spare for new books.
pub const WINGS: [Wing; 8] = [
    Wing {
        key: "children",
        name: "Children's Library",
        rows: 8,
        cols: 12,
    },
    Wing {
        key: "lit",
        name: "Literature",
        rows: 14,
        cols: 24,
    },
    Wing {
        key: "world",
        name: "World Languages",
        rows: 12,
        cols: 18,
    },
    Wing {
        key: "history",
        name: "History & Geography",
        rows: 10,
        cols: 16,
    },
    Wing {
        key: "society",
        name: "Philosophy, Religion & Society",
        rows: 7,
        cols: 12,
    },
    Wing {
        key: "science",
        name: "Science & Technology",
        rows: 6,
        cols: 12,
    },
    Wing {
        key: "arts",
        name: "Arts & Music",
        rows: 4,
        cols: 6,
    },
    Wing {
        key: "reference",
        name: "Periodicals & Reference",
        rows: 5,
        cols: 10,
    },
];

pub fn wing(key: &str) -> Option<&'static Wing> {
    WINGS.iter().find(|w| w.key == key)
}

/// The wing of a zone (`library_lit` → Literature).
pub fn wing_of_zone(zone: &str) -> Option<&'static Wing> {
    zone.strip_prefix("library_").and_then(wing)
}

/// The codes in a semicolon-separated catalogue field ("PR; PZ").
pub fn codes(field: &str) -> impl Iterator<Item = &str> {
    field.split(';').map(str::trim).filter(|s| !s.is_empty())
}

/// A book's first language ("en; fr" → "en").
pub fn first_language(languages: &str) -> &str {
    codes(languages).next().unwrap_or("")
}

/// Which wing a book is shelved in, from its languages and Library of
/// Congress classes: books in other languages go to World Languages; in
/// English, juvenile fiction (PZ) to the Children's Library, other
/// literature (P) to Literature, and the rest by class.
pub fn wing_for(languages: &str, locc: &str) -> &'static str {
    if first_language(languages) != "en" {
        return "world";
    }
    if codes(locc).any(|c| c.starts_with("PZ")) {
        return "children";
    }
    match codes(locc).next().and_then(|c| c.chars().next()) {
        Some('P') => "lit",
        Some('C' | 'D' | 'E' | 'F' | 'G') => "history",
        Some('B' | 'H' | 'J' | 'K' | 'L') => "society",
        Some('Q' | 'R' | 'S' | 'T' | 'U' | 'V') => "science",
        Some('M' | 'N') => "arts",
        _ => "reference",
    }
}

/// World Languages is shelved by language: the biggest collections first,
/// then the rest by name.
const WORLD_ORDER: &[&str] = &["fr", "fi", "de", "nl", "it", "es", "hu", "pt", "zh"];

/// Names of the languages in the collection, by ISO code.
pub const LANGUAGES: &[(&str, &str)] = &[
    ("af", "Afrikaans"),
    ("ang", "Old English"),
    ("ar", "Arabic"),
    ("arp", "Arapaho"),
    ("bg", "Bulgarian"),
    ("bo", "Tibetan"),
    ("br", "Breton"),
    ("ca", "Catalan"),
    ("ceb", "Cebuano"),
    ("cs", "Czech"),
    ("cy", "Welsh"),
    ("da", "Danish"),
    ("de", "German"),
    ("el", "Greek"),
    ("en", "English"),
    ("enm", "Middle English"),
    ("eo", "Esperanto"),
    ("es", "Spanish"),
    ("et", "Estonian"),
    ("fa", "Persian"),
    ("fi", "Finnish"),
    ("fr", "French"),
    ("fur", "Friulian"),
    ("fy", "Frisian"),
    ("ga", "Irish"),
    ("gl", "Galician"),
    ("gla", "Scottish Gaelic"),
    ("grc", "Ancient Greek"),
    ("he", "Hebrew"),
    ("hu", "Hungarian"),
    ("ia", "Interlingua"),
    ("ilo", "Ilocano"),
    ("is", "Icelandic"),
    ("it", "Italian"),
    ("iu", "Inuktitut"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("la", "Latin"),
    ("lt", "Lithuanian"),
    ("mi", "Māori"),
    ("myn", "Mayan"),
    ("nah", "Nahuatl"),
    ("nap", "Neapolitan"),
    ("nl", "Dutch"),
    ("no", "Norwegian"),
    ("oc", "Occitan"),
    ("oji", "Ojibwe"),
    ("pl", "Polish"),
    ("pt", "Portuguese"),
    ("rmq", "Caló"),
    ("ro", "Romanian"),
    ("ru", "Russian"),
    ("sa", "Sanskrit"),
    ("sco", "Scots"),
    ("sl", "Slovenian"),
    ("sr", "Serbian"),
    ("sv", "Swedish"),
    ("te", "Telugu"),
    ("tl", "Tagalog"),
    ("yi", "Yiddish"),
];

/// A language's name, or its code if we don't know it.
pub fn language_name(code: &str) -> &str {
    LANGUAGES
        .iter()
        .find(|(c, _)| *c == code)
        .map_or(code, |(_, n)| n)
}

/// What decides where a book stands.
#[derive(Debug, Clone)]
pub struct Shelving<'a> {
    pub id: i32,
    pub title: &'a str,
    pub authors: &'a str,
    pub languages: &'a str,
    pub locc: &'a str,
}

/// Lowercased, with an English leading article dropped (titles are filed
/// that way: "The Time Machine" under T for Time).
fn filing_title(title: &str, english: bool) -> String {
    let t = title.trim().to_lowercase();
    if english {
        for article in ["the ", "a ", "an "] {
            if let Some(rest) = t.strip_prefix(article) {
                return rest.to_string();
            }
        }
    }
    t
}

/// Where a book files within a wing, like a call number: (in World
/// Languages, by language first) class, then author, then title.
pub type ShelfKey = (usize, String, String, String, String, i32);

pub fn shelf_key(s: &Shelving) -> ShelfKey {
    let lang = first_language(s.languages);
    let rank = WORLD_ORDER
        .iter()
        .position(|l| *l == lang)
        .unwrap_or(WORLD_ORDER.len());
    (
        rank,
        if rank == WORLD_ORDER.len() {
            language_name(lang).to_lowercase()
        } else {
            String::new()
        },
        codes(s.locc).next().unwrap_or("~").to_string(),
        s.authors.trim().to_lowercase(),
        filing_title(s.title, lang == "en"),
        s.id,
    )
}

/// The order books stand in within a wing (see [`shelf_key`]).
pub fn shelf_order(a: &Shelving, b: &Shelving) -> Ordering {
    shelf_key(a).cmp(&shelf_key(b))
}

/// The surname of a book's first author ("Austen, Jane, 1775-1817; …" →
/// "Austen"), for the signs at the ends of the rows.
pub fn surname(authors: &str) -> &str {
    let first = authors.split(';').next().unwrap_or("").trim();
    first.split(',').next().unwrap_or("").trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wings_by_language_and_class() {
        assert_eq!(wing_for("en", "PR"), "lit");
        assert_eq!(wing_for("en", "PR; PZ"), "children");
        assert_eq!(wing_for("en", "PZ"), "children");
        assert_eq!(wing_for("fr", "PQ"), "world");
        assert_eq!(wing_for("en; fr", "PQ"), "lit");
        assert_eq!(wing_for("en", "E201; JK"), "history");
        assert_eq!(wing_for("en", "BS"), "society");
        assert_eq!(wing_for("en", "QA"), "science");
        assert_eq!(wing_for("en", "ML"), "arts");
        assert_eq!(wing_for("en", "AP"), "reference");
        assert_eq!(wing_for("en", ""), "reference");
        assert!(WINGS.iter().all(|w| wing(w.key) == Some(w)));
        assert_eq!(
            wing_of_zone("library_lit").map(|w| w.name),
            Some("Literature")
        );
    }

    #[test]
    fn shelved_like_call_numbers() {
        let b = |id, title, authors, languages, locc| Shelving {
            id,
            title,
            authors,
            languages,
            locc,
        };
        let mut books = [
            b(5, "Zuleika Dobson", "Beerbohm, Max", "en", "PR"),
            b(4, "The Time Machine", "Wells, H. G.", "en", "PR"),
            b(3, "Emma", "Austen, Jane", "en", "PR"),
            b(2, "A Tramp Abroad", "Twain, Mark", "en", "PS"),
            b(1, "Pride and Prejudice", "Austen, Jane", "en", "PR"),
            b(6, "Ancient Wonders", "Wells, H. G.", "en", "PR"),
        ];
        books.sort_by(shelf_order);
        let ids: Vec<i32> = books.iter().map(|b| b.id).collect();
        assert_eq!(ids, [3, 1, 5, 6, 4, 2]);
        // World Languages: French, then Finnish, …, then the rest by name.
        let mut world = [
            b(1, "Kalevala", "", "fi", "PH"),
            b(2, "Le Rouge et le Noir", "Stendhal", "fr", "PQ"),
            b(3, "Odyssey", "Homer", "grc", "PA"),
            b(4, "Fables", "Aesop", "af", "PA"),
        ];
        world.sort_by(shelf_order);
        let ids: Vec<i32> = world.iter().map(|b| b.id).collect();
        assert_eq!(ids, [2, 1, 4, 3]);
        assert_eq!(surname("Austen, Jane, 1775-1817; Smith, J."), "Austen");
        assert_eq!(surname(""), "");
    }
}
