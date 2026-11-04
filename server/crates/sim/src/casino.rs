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

// ---- the big machine: twenty symbols ---------------------------------------------

/// The big machine: five reels four high (twenty symbols, read left to right
/// a row at a time), each drawn on its own. Enough of one symbol anywhere pays.
pub const MEGA_SYMBOLS: [&str; 7] = ["cherry", "lemon", "grape", "bell", "star", "gem", "seven"];
pub const MEGA_WEIGHTS: [u32; 7] = [10, 8, 7, 6, 4, 3, 2];
pub const MEGA_TOTAL: u32 = 40;
pub const MEGA_CELLS: usize = 20;
pub const MEGA_BET: (i32, i32) = (1, 20);
/// How many of a symbol it takes to pay (the rarer, the fewer).
pub const MEGA_MIN: [usize; 7] = [8, 8, 7, 7, 6, 5, 4];
/// What it pays, in tenths of the bet: the fewest that pay (and one more),
/// two more than that (and three), four more or better.
pub const MEGA_PAYS: [[i32; 3]; 7] = [
    [23, 80, 300],
    [30, 100, 400],
    [25, 100, 400],
    [40, 120, 500],
    [50, 150, 600],
    [50, 200, 1000],
    [60, 300, 1500],
];

/// The big machine's symbol for a roll.
pub fn mega_symbol(roll: u32) -> usize {
    let mut r = roll % MEGA_TOTAL;
    for (i, w) in MEGA_WEIGHTS.iter().enumerate() {
        if r < *w {
            return i;
        }
        r -= w;
    }
    MEGA_WEIGHTS.len() - 1
}

/// What `n` of symbol `s` pays (tenths of the bet).
pub fn mega_pays_for(s: usize, n: usize) -> i32 {
    let min = MEGA_MIN[s];
    match n {
        _ if n < min => 0,
        _ if n < min + 2 => MEGA_PAYS[s][0],
        _ if n < min + 4 => MEGA_PAYS[s][1],
        _ => MEGA_PAYS[s][2],
    }
}

/// A spin of the big machine: the twenty symbols and what they pay (tenths of the bet).
pub fn mega_spin(rolls: [u32; MEGA_CELLS]) -> ([usize; MEGA_CELLS], i32) {
    let cells = rolls.map(mega_symbol);
    let pays = (0..MEGA_SYMBOLS.len())
        .map(|s| mega_pays_for(s, cells.iter().filter(|c| **c == s).count()))
        .sum();
    (cells, pays)
}

// ---- the horse races -------------------------------------------------------------

/// Six horses: how often each wins (out of 100) and what a win pays (tenths
/// of the bet); every horse returns about 94 %.
pub const HORSES: [&str; 6] = [
    "Thunder",
    "Biscuit",
    "Lady Luck",
    "Old Rusty",
    "Comet",
    "Pickles",
];
pub const HORSE_CHANCE: [u32; 6] = [30, 22, 17, 13, 10, 8];
pub const HORSE_PAYS: [i32; 6] = [31, 43, 55, 73, 95, 118];
pub const RACE_BET: (i32, i32) = (1, 30);

/// The winner from a roll; then the rest in the order the other rolls put them.
pub fn race(win: u32, rest: [u32; 5]) -> [usize; 6] {
    let mut r = win % 100;
    let mut first = HORSES.len() - 1;
    for (i, c) in HORSE_CHANCE.iter().enumerate() {
        if r < *c {
            first = i;
            break;
        }
        r -= c;
    }
    let mut others: Vec<(u32, usize)> = (0..HORSES.len())
        .filter(|&i| i != first)
        .zip(rest)
        .map(|(i, k)| (k, i))
        .collect();
    others.sort();
    let mut order = [first; 6];
    for (k, (_, i)) in others.into_iter().enumerate() {
        order[k + 1] = i;
    }
    order
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
    #[test]
    fn the_big_machine_returns_about_ninety_five_percent() {
        // Each symbol's count is binomial (twenty draws), so it's exact.
        let choose = |n: u64, k: u64| (1..=k).fold(1f64, |r, i| r * (n - k + i) as f64 / i as f64);
        let mut back = 0f64;
        for (s, w) in MEGA_WEIGHTS.iter().enumerate() {
            let p = *w as f64 / MEGA_TOTAL as f64;
            for n in 0..=MEGA_CELLS {
                let pr = choose(20, n as u64) * p.powi(n as i32) * (1.0 - p).powi(20 - n as i32);
                back += pr * mega_pays_for(s, n) as f64 / 10.0;
            }
        }
        assert!((0.93..0.97).contains(&back), "returns {back:.4}");
        assert_eq!(MEGA_WEIGHTS.iter().sum::<u32>(), MEGA_TOTAL);
        let (cells, pays) = mega_spin([0; MEGA_CELLS]);
        assert_eq!(cells, [0; MEGA_CELLS]);
        assert_eq!(pays, MEGA_PAYS[0][2]);
    }

    #[test]
    fn horses_return_about_ninety_four_percent_and_all_finish() {
        assert_eq!(HORSE_CHANCE.iter().sum::<u32>(), 100);
        for i in 0..6 {
            let back = HORSE_CHANCE[i] as f64 / 100.0 * HORSE_PAYS[i] as f64 / 10.0;
            assert!((0.92..0.96).contains(&back), "horse {i}: {back}");
        }
        let order = race(99, [5, 1, 4, 2, 3]);
        assert_eq!(order[0], 5);
        let mut all = order.to_vec();
        all.sort();
        assert_eq!(all, vec![0, 1, 2, 3, 4, 5]);
    }
}
