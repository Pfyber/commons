//! Blackjack at the Casino (ADR 0017, K2), as pure functions: what a hand
//! is worth, when the dealer draws, and what a finished hand pays. The social
//! gateway shuffles the shoe (the OS's random numbers) and runs the table.
//!
//! The rules: six decks; the dealer stands on all 17s and peeks for
//! blackjack; blackjack pays 3:2; double on any first two cards; no
//! splitting or insurance (yet).

/// A card, 0..52: `rank()` 0 = ace, 1..=9 = two to ten, 10..=12 = J Q K;
/// `suit()` 0..4 = ♠ ♥ ♦ ♣.
pub type Card = u8;

/// Decks in the shoe, and how low it runs before it's shuffled again.
pub const DECKS: usize = 6;
pub const RESHUFFLE_BELOW: usize = 60;
/// The smallest and largest bet at a blackjack table.
pub const BET: (i32, i32) = (1, 50);
/// Seats at each table.
pub const SEATS: usize = 5;

pub fn rank(c: Card) -> u8 {
    c % 13
}

pub fn suit(c: Card) -> u8 {
    (c / 13) % 4
}

/// A fresh, unshuffled shoe.
pub fn shoe() -> Vec<Card> {
    (0..DECKS).flat_map(|_| 0..52u8).collect()
}

/// A card's face: "A", "7", "K"…
pub fn face(c: Card) -> &'static str {
    [
        "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
    ][rank(c) as usize]
}

/// A hand's best total, and whether an ace is counting as 11 in it (soft).
pub fn total(cards: &[Card]) -> (u8, bool) {
    let mut sum = 0u8;
    let mut aces = 0;
    for &c in cards {
        let r = rank(c);
        sum += match r {
            0 => {
                aces += 1;
                1
            }
            1..=9 => r + 1,
            _ => 10,
        };
    }
    if aces > 0 && sum + 10 <= 21 {
        (sum + 10, true)
    } else {
        (sum, false)
    }
}

/// Two cards making 21.
pub fn is_blackjack(cards: &[Card]) -> bool {
    cards.len() == 2 && total(cards).0 == 21
}

pub fn bust(cards: &[Card]) -> bool {
    total(cards).0 > 21
}

/// Whether the dealer draws another: below 17 (standing on soft 17 too).
pub fn dealer_draws(cards: &[Card]) -> bool {
    total(cards).0 < 17
}

/// How a finished hand came out against the dealer's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Blackjack,
    Win,
    Push,
    Lose,
    Bust,
}

impl Outcome {
    pub fn name(self) -> &'static str {
        match self {
            Outcome::Blackjack => "blackjack",
            Outcome::Win => "win",
            Outcome::Push => "push",
            Outcome::Lose => "lose",
            Outcome::Bust => "bust",
        }
    }

    /// What it pays back on `stake` (the stake included): 3:2 for
    /// blackjack (rounded down), even money for a win, the stake on a push.
    pub fn pays(self, stake: i32) -> i32 {
        match self {
            Outcome::Blackjack => stake + stake * 3 / 2,
            Outcome::Win => stake * 2,
            Outcome::Push => stake,
            Outcome::Lose | Outcome::Bust => 0,
        }
    }
}

/// A player's finished hand against the dealer's finished hand.
pub fn settle(player: &[Card], dealer: &[Card]) -> Outcome {
    if bust(player) {
        return Outcome::Bust;
    }
    match (is_blackjack(player), is_blackjack(dealer)) {
        (true, true) => return Outcome::Push,
        (true, false) => return Outcome::Blackjack,
        (false, true) => return Outcome::Lose,
        _ => {}
    }
    if bust(dealer) {
        return Outcome::Win;
    }
    let (p, d) = (total(player).0, total(dealer).0);
    match p.cmp(&d) {
        std::cmp::Ordering::Greater => Outcome::Win,
        std::cmp::Ordering::Equal => Outcome::Push,
        std::cmp::Ordering::Less => Outcome::Lose,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Cards by rank in spades: A=0, 2=1 … 10=9, J=10, Q=11, K=12.
    const A: Card = 0;
    const FIVE: Card = 4;
    const SIX: Card = 5;
    const SEVEN: Card = 6;
    const NINE: Card = 8;
    const TEN: Card = 9;
    const K: Card = 12;

    #[test]
    fn totals_count_aces_high_when_they_can() {
        assert_eq!(total(&[A, SIX]), (17, true));
        assert_eq!(total(&[A, SIX, TEN]), (17, false));
        assert_eq!(total(&[A, A, NINE]), (21, true));
        assert_eq!(total(&[K, SEVEN, FIVE]), (22, false));
        assert!(is_blackjack(&[A, K]));
        assert!(!is_blackjack(&[SEVEN, FIVE, NINE]), "21, but three cards");
        assert_eq!(shoe().len(), 52 * DECKS);
        assert_eq!((face(A), face(TEN), face(K + 13)), ("A", "10", "K"));
        assert_eq!(suit(K + 13), 1);
    }

    #[test]
    fn the_dealer_stands_on_seventeen_soft_or_hard() {
        assert!(dealer_draws(&[TEN, SIX]));
        assert!(!dealer_draws(&[TEN, SEVEN]));
        assert!(!dealer_draws(&[A, SIX]), "soft 17 stands");
        assert!(dealer_draws(&[A, FIVE]));
    }

    #[test]
    fn hands_settle_and_pay_as_the_table_says() {
        assert_eq!(settle(&[A, K], &[TEN, NINE]), Outcome::Blackjack);
        assert_eq!(Outcome::Blackjack.pays(10), 25);
        assert_eq!(Outcome::Blackjack.pays(5), 12, "3:2 rounded down");
        assert_eq!(settle(&[A, K], &[A, TEN]), Outcome::Push);
        assert_eq!(
            settle(&[TEN, NINE, A], &[A, TEN]),
            Outcome::Lose,
            "21 loses to blackjack"
        );
        assert_eq!(
            settle(&[TEN, NINE], &[TEN, SIX, NINE]),
            Outcome::Win,
            "the dealer busts"
        );
        assert_eq!(
            settle(&[TEN, SIX, NINE], &[TEN, SIX, NINE]),
            Outcome::Bust,
            "you bust first"
        );
        assert_eq!(settle(&[TEN, SEVEN], &[TEN, SEVEN]), Outcome::Push);
        assert_eq!(settle(&[TEN, SIX], &[TEN, SEVEN]), Outcome::Lose);
        assert_eq!(
            (
                Outcome::Win.pays(10),
                Outcome::Push.pays(10),
                Outcome::Lose.pays(10)
            ),
            (20, 10, 0)
        );
    }
}
