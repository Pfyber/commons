//! The Casino's games (ADR 0017), as pure functions: what a spin or a bet
//! comes to, given the random numbers. The social gateway draws those from
//! the OS and records every round; clients only show what happened.
//!
//! The house edge is small and known, and the tests below work it out
//! exactly: slots return about 95 % of what's bet, roulette (one zero) 97.3 %.

use serde::{Deserialize, Serialize};

// ---- slots -------------------------------------------------------------------------

/// The symbols on a reel, and how often each comes up (out of `REEL_TOTAL`).
pub const SYMBOLS: [&str; 6] = ["cherry", "lemon", "bell", "star", "gem", "seven"];
pub const WEIGHTS: [u32; 6] = [9, 8, 6, 5, 3, 2];
pub const REEL_TOTAL: u32 = 33;
/// The smallest and largest bet on a slot machine.
pub const SLOT_BET: (i32, i32) = (1, 20);

/// The symbol a number in 0..REEL_TOTAL lands on.
pub fn symbol(roll: u32) -> usize {
    let mut r = roll % REEL_TOTAL;
    for (i, w) in WEIGHTS.iter().enumerate() {
        if r < *w {
            return i;
        }
        r -= w;
    }
    WEIGHTS.len() - 1
}

/// Three alike pay, by symbol (as a multiple of the bet).
pub const THREE: [i32; 6] = [5, 10, 20, 40, 90, 250];

/// What a line of three pays, as a multiple of the bet (0: nothing).
pub fn slot_pays(line: [usize; 3]) -> i32 {
    let [a, b, c] = line;
    if a == b && b == c {
        return THREE[a];
    }
    // Two cherries pay double.
    if line.iter().filter(|s| **s == 0).count() == 2 {
        2
    } else {
        0
    }
}

/// A spin from three rolls (each any u32).
pub fn spin(rolls: [u32; 3]) -> ([usize; 3], i32) {
    let line = rolls.map(symbol);
    (line, slot_pays(line))
}

// ---- roulette ------------------------------------------------------------------------

/// The red numbers on a European wheel.
pub const RED: [u8; 18] = [
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];
/// The smallest and largest bet at the roulette table.
pub const ROULETTE_BET: (i32, i32) = (1, 50);

/// A roulette bet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "on", rename_all = "snake_case")]
pub enum Bet {
    Red,
    Black,
    Odd,
    Even,
    Low,
    High,
    /// 1 (1–12), 2 (13–24) or 3 (25–36).
    Dozen {
        n: u8,
    },
    /// One number, 0–36.
    Number {
        n: u8,
    },
}

impl Bet {
    pub fn valid(self) -> bool {
        match self {
            Bet::Dozen { n } => (1..=3).contains(&n),
            Bet::Number { n } => n <= 36,
            _ => true,
        }
    }

    /// What it pays back on `n` (the stake included), as a multiple of the bet.
    pub fn pays(self, n: u8) -> i32 {
        let red = RED.contains(&n);
        let win = match self {
            Bet::Red => red,
            Bet::Black => n != 0 && !red,
            Bet::Odd => n != 0 && n % 2 == 1,
            Bet::Even => n != 0 && n.is_multiple_of(2),
            Bet::Low => (1..=18).contains(&n),
            Bet::High => (19..=36).contains(&n),
            Bet::Dozen { n: d } => n != 0 && (n - 1) / 12 + 1 == d,
            Bet::Number { n: m } => n == m,
        };
        if !win {
            return 0;
        }
        match self {
            Bet::Dozen { .. } => 3,
            Bet::Number { .. } => 36,
            _ => 2,
        }
    }
}

/// The number a roll lands on.
pub fn wheel(roll: u32) -> u8 {
    (roll % 37) as u8
}

/// Is `n` red (false for 0 and black)?
pub fn is_red(n: u8) -> bool {
    RED.contains(&n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_return_about_ninety_five_percent() {
        // Every line, weighted by how often it comes up.
        let mut back = 0f64;
        let total = (REEL_TOTAL as f64).powi(3);
        for (a, wa) in WEIGHTS.iter().enumerate() {
            for (b, wb) in WEIGHTS.iter().enumerate() {
                for (c, wc) in WEIGHTS.iter().enumerate() {
                    let p = (wa * wb * wc) as f64 / total;
                    back += p * slot_pays([a, b, c]) as f64;
                }
            }
        }
        assert!((0.93..0.97).contains(&back), "slots return {back:.4}");
        assert_eq!(WEIGHTS.iter().sum::<u32>(), REEL_TOTAL);
    }

    #[test]
    fn slot_lines_pay_as_the_card_says() {
        assert_eq!(slot_pays([5, 5, 5]), 250);
        assert_eq!(slot_pays([0, 0, 0]), 5);
        assert_eq!(slot_pays([0, 3, 0]), 2);
        assert_eq!(slot_pays([4, 0, 2]), 0);
        assert_eq!(slot_pays([1, 2, 3]), 0);
        // Every roll lands on a symbol.
        assert_eq!(symbol(0), 0);
        assert_eq!(symbol(REEL_TOTAL - 1), 5);
        assert_eq!(symbol(u32::MAX), symbol(u32::MAX % REEL_TOTAL));
    }

    #[test]
    fn roulette_returns_ninety_seven_point_three_percent_on_every_bet() {
        let bets = [
            Bet::Red,
            Bet::Black,
            Bet::Odd,
            Bet::Even,
            Bet::Low,
            Bet::High,
            Bet::Dozen { n: 2 },
            Bet::Number { n: 17 },
            Bet::Number { n: 0 },
        ];
        for bet in bets {
            let back: i32 = (0..37).map(|n| bet.pays(n)).sum();
            // 36 back over 37 numbers: 97.3 % for every bet.
            assert_eq!(back, 36, "{bet:?}");
        }
        assert!(!Bet::Dozen { n: 4 }.valid() && !Bet::Number { n: 37 }.valid());
        assert_eq!(Bet::Red.pays(0), 0, "zero is neither");
        assert!(is_red(1) && !is_red(2));
    }
}
