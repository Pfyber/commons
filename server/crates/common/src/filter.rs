//! Minimal chat text sanitising (spec §12). This is a first line of defence,
//! not moderation: it strips control characters, collapses whitespace and
//! masks a small word list. Juries and staff handle the rest.

pub const MAX_CHAT_CHARS: usize = 140;

const BLOCKED: &[&str] = &[
    "fuck", "shit", "cunt", "bitch", "asshole", "dick", "faggot", "nigger", "retard", "whore",
    "slut",
];

/// Returns `None` if nothing printable remains.
pub fn clean_chat(text: &str) -> Option<String> {
    let collapsed: String = text
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !c.is_control())
        .take(MAX_CHAT_CHARS)
        .collect::<String>()
        .split(' ')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if collapsed.is_empty() {
        return None;
    }
    Some(mask(&collapsed))
}

fn mask(text: &str) -> String {
    let lower: Vec<char> = text.to_lowercase().chars().collect();
    let mut out: Vec<char> = text.chars().collect();
    if lower.len() != out.len() {
        // Lowercasing changed the length (rare scripts); fall back to word matching only.
        return text
            .split(' ')
            .map(|w| {
                if BLOCKED.iter().any(|b| w.to_lowercase().contains(b)) {
                    "*".repeat(w.chars().count())
                } else {
                    w.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    for bad in BLOCKED {
        let bad: Vec<char> = bad.chars().collect();
        let mut i = 0;
        while i + bad.len() <= lower.len() {
            // Only match at word starts, so "Scunthorpe" survives.
            let at_word_start = i == 0 || !lower[i - 1].is_alphanumeric();
            if at_word_start && lower[i..i + bad.len()] == bad[..] {
                for c in &mut out[i..i + bad.len()] {
                    *c = '*';
                }
                i += bad.len();
            } else {
                i += 1;
            }
        }
    }
    out.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans() {
        assert_eq!(
            clean_chat("  hi \n there\u{0007} "),
            Some("hi there".into())
        );
        assert_eq!(clean_chat("   "), None);
        assert_eq!(clean_chat("oh SHIT ok"), Some("oh **** ok".into()));
        assert_eq!(clean_chat("Scunthorpe"), Some("Scunthorpe".into()));
        assert_eq!(clean_chat(&"a".repeat(500)).unwrap().len(), MAX_CHAT_CHARS);
    }
}
