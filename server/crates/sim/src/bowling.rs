//! Bowling for the alley's lanes: which pins a roll knocks down, and a short
//! game of five frames scored like ten-pin (strikes and spares count the
//! next rolls; the last frame gives the bonus rolls).
//!
//! A roll is where the ball meets the pins (`aim`, -1 left gutter to 1 right,
//! 0 dead centre) and how hard it goes (`power`, 0–1). The nearer the middle
//! and the harder, the more pins fall; the server rolls the dice for the
//! scatter and tells everyone which pins went, so all screens agree.

/// Pins 0–9: the head pin, then rows of two, three and four.
pub const PINS: usize = 10;
pub const ALL: u16 = (1 << PINS) - 1;
/// A short game: five frames.
pub const FRAMES: usize = 5;
/// Past this far from the middle (of 1) the ball's in the gutter.
pub const GUTTER: f64 = 0.92;
/// The lane's half-width at the pins, in pin spacings (12 in).
const LANE_HALF: f64 = 2.3;
/// Ball and pin touch when their centres are this close (pin spacings):
/// ball radius 0.36 + pin radius 0.2.
const CONTACT: f64 = 0.56;
/** How surely a falling pin takes down one behind it: a base, more with power, more from the pocket. */
const SCATTER_BASE: f64 = 0.1;
const SCATTER_POWER: f64 = 0.38;
const SCATTER_POCKET: f64 = 0.06;
/// A strike takes the very top of the power bar (the top 3%) and a ball
/// within a hair of dead centre: then it's certain. Nothing else strikes
/// (a full rack knocked flat any other way leaves a back corner pin up).
pub const POWER_STRIKE: f64 = 0.97;
pub const STRIKE_AIM: f64 = 0.07;

/// Where pin `i` stands: (across, back) in pin spacings from the head pin.
pub fn pin_pos(i: usize) -> (f64, f64) {
    let (row, k) = match i {
        0 => (0, 0),
        1..=2 => (1, i - 1),
        3..=5 => (2, i - 3),
        _ => (3, i - 6),
    };
    (k as f64 - row as f64 / 2.0, row as f64 * 0.866)
}

/// The pins knocked down (a mask) by a roll at `aim` with `power` into the
/// `standing` ones; `rng` gives numbers in [0, 1).
pub fn roll(standing: u16, aim: f64, power: f64, rng: &mut impl FnMut() -> f64) -> u16 {
    let power = power.clamp(0.0, 1.0);
    if aim.abs() >= GUTTER || standing == 0 {
        return 0;
    }
    let full = standing == ALL;
    if full && power >= POWER_STRIKE && aim.abs() <= STRIKE_AIM {
        return ALL;
    }
    let bx = aim * LANE_HALF;
    let mut down = 0u16;
    // The ball goes straight through: anything in its path falls.
    for i in 0..PINS {
        let (px, _) = pin_pos(i);
        if standing & (1 << i) != 0 && (px - bx).abs() < CONTACT + 0.1 * power {
            down |= 1 << i;
        }
    }
    // Falling pins (and the ball, hitting the pocket by the head pin) take
    // others down with them, the more surely the harder it was rolled.
    let pocket = (bx.abs() < 0.45 && standing & 1 != 0) as u8 as f64;
    let scatter = SCATTER_BASE + SCATTER_POWER * power + SCATTER_POCKET * pocket;
    // Front to back, so a pin knocked by one that fell can knock others in turn.
    {
        for i in 0..PINS {
            if down & (1 << i) == 0 {
                continue;
            }
            let (ix, iy) = pin_pos(i);
            for j in 0..PINS {
                if standing & (1 << j) == 0 || down & (1 << j) != 0 {
                    continue;
                }
                let (jx, jy) = pin_pos(j);
                let (dx, dy) = ((jx - ix).abs(), jy - iy);
                // Pins behind it (or beside it), not too far across.
                if dy < -0.1 || dy > 1.8 || dx > 1.1 {
                    continue;
                }
                let p = scatter * (1.0 - dx * 0.35) * (1.0 - dy * 0.15);
                if rng() < p {
                    down |= 1 << j;
                }
            }
        }
    }
    let down = down & standing;
    // Not the perfect ball: a corner pin at the back stays up.
    if full && down == ALL {
        return down & !(1 << if rng() < 0.5 { 6 } else { 9 });
    }
    down
}

/// Frame-by-frame running totals for `rolls` (pins per roll): `None` for a
/// frame not played yet, or waiting for the rolls its strike or spare counts.
pub fn frame_scores(rolls: &[u8]) -> Vec<Option<u16>> {
    let mut out = Vec::with_capacity(FRAMES);
    let mut total = 0u16;
    let mut i = 0;
    let at = |k: usize| rolls.get(k).map(|&r| r as u16);
    for f in 0..FRAMES {
        let Some(first) = at(i) else {
            out.push(None);
            continue;
        };
        let last = f == FRAMES - 1;
        let score = if first == 10 {
            let s = at(i + 1).zip(at(i + 2)).map(|(a, b)| 10 + a + b);
            i += if last { 3 } else { 1 };
            s
        } else if let Some(second) = at(i + 1) {
            if first + second == 10 {
                let s = at(i + 2).map(|b| 10 + b);
                i += if last { 3 } else { 2 };
                s
            } else {
                i += 2;
                Some(first + second)
            }
        } else {
            i += 2;
            None
        };
        match score {
            Some(s) => {
                total += s;
                out.push(Some(total));
            }
            None => out.push(None),
        }
        if score.is_none() {
            // Later frames can't have totals before this one does.
            while out.len() < FRAMES {
                out.push(None);
            }
            break;
        }
    }
    out
}

/// The final score of a finished game (or the score so far).
pub fn total(rolls: &[u8]) -> u16 {
    frame_scores(rolls)
        .iter()
        .flatten()
        .copied()
        .max()
        .unwrap_or(0)
}

/// Game status, as protocol `bowl::*`.
pub const PLAYING: u8 = 1;
pub const A_WON: u8 = 2;
pub const B_WON: u8 = 3;
pub const DRAW: u8 = 5;

/// A game between players 0 and 1, who take a frame each in turn.
#[derive(Debug, Clone)]
pub struct Game {
    /// Pins per roll, each player's.
    pub rolls: [Vec<u8>; 2],
    /// Whose frame it is, which frame (0-based), and which roll in it.
    pub turn: u8,
    pub frame: u8,
    pub ball: u8,
    /// The pins still up for the next roll.
    pub standing: u16,
    pub status: u8,
}

impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}

impl Game {
    pub fn new() -> Self {
        Game {
            rolls: [Vec::new(), Vec::new()],
            turn: 0,
            frame: 0,
            ball: 0,
            standing: ALL,
            status: PLAYING,
        }
    }

    /// The pins in `knocked` (a mask) went down: on to the next roll, frame or player.
    pub fn bowled(&mut self, knocked: u16) {
        if self.status != PLAYING {
            return;
        }
        let knocked = knocked & self.standing;
        let k = knocked.count_ones() as u8;
        let p = self.turn as usize;
        self.rolls[p].push(k);
        let last = self.frame as usize == FRAMES - 1;
        let left = self.standing & !knocked;
        let done = if !last {
            self.ball == 1 || left == 0
        } else {
            match self.ball {
                // A strike: two more balls, at a fresh rack.
                0 => false,
                // A second ball after a strike, or a spare: a third.
                1 => {
                    let n = self.rolls[p].len();
                    let first = self.rolls[p][n - 2];
                    !(first == 10 || left == 0)
                }
                _ => true,
            }
        };
        if done {
            self.ball = 0;
            self.standing = ALL;
            if self.turn == 0 {
                self.turn = 1;
            } else {
                self.turn = 0;
                self.frame += 1;
            }
            if self.frame as usize >= FRAMES {
                let (a, b) = (total(&self.rolls[0]), total(&self.rolls[1]));
                self.status = if a > b {
                    A_WON
                } else if b > a {
                    B_WON
                } else {
                    DRAW
                };
            }
        } else {
            self.ball += 1;
            // Cleared (a strike or spare in the last frame): a fresh rack.
            self.standing = if left == 0 { ALL } else { left };
        }
    }

    /// The bot's roll: aiming for the middle, with a human hand's wobble
    /// (`noise` from the caller: two numbers in [0, 1)).
    pub fn ai_roll(&self, a: f64, b: f64) -> (f64, f64) {
        // Aim at the middle of what's standing.
        let (mut sum, mut n) = (0.0, 0.0);
        for i in 0..PINS {
            if self.standing & (1 << i) != 0 {
                sum += pin_pos(i).0;
                n += 1.0;
            }
        }
        let target = if n > 0.0 { sum / n / LANE_HALF } else { 0.0 };
        let aim = (target + (a - 0.5) * 0.34).clamp(-0.95, 0.95);
        // Now and then right at the top of the bar: with luck, dead centre too.
        let power = 0.7 + b * 0.29;
        (aim, power)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rng(seed: u64) -> impl FnMut() -> f64 {
        let mut s = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        move || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    fn average(aim: f64, power: f64) -> (f64, f64) {
        let mut r = rng(7);
        let (mut pins, mut strikes) = (0, 0);
        for _ in 0..2000 {
            let k = roll(ALL, aim, power, &mut r).count_ones();
            pins += k;
            strikes += (k == 10) as u32;
        }
        (pins as f64 / 2000.0, strikes as f64 / 2000.0)
    }

    #[test]
    #[ignore]
    fn sweep() {
        for aim in [0.0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85] {
            for power in [0.3, 0.6, 0.8, 0.95, 1.0] {
                let (a, s) = average(aim, power);
                println!(
                    "aim {aim:.2} power {power:.1}: {a:.2} pins, {:.0}% strikes",
                    s * 100.0
                );
            }
        }
    }

    #[test]
    fn the_middle_knocks_the_most_and_the_gutter_none() {
        let (centre, _) = average(0.0, 0.9);
        let (off, _) = average(0.35, 0.9);
        let (wide, _) = average(0.7, 0.9);
        let (soft, _) = average(0.0, 0.3);
        assert!(centre > 8.0, "centre {centre}");
        assert!(
            centre > off && off > wide && wide > 0.0,
            "{centre} > {off} > {wide}"
        );
        assert!(soft < centre, "a soft roll knocks fewer: {soft}");
        assert_eq!(roll(ALL, 0.95, 1.0, &mut rng(1)), 0, "gutter");
    }

    #[test]
    fn only_the_perfect_ball_strikes() {
        let mut r = rng(5);
        // Top power, dead centre: a strike, every time.
        for aim in [0.0, 0.05, -STRIKE_AIM] {
            assert_eq!(
                roll(ALL, aim, POWER_STRIKE, &mut r),
                ALL,
                "a strike at aim {aim}"
            );
        }
        // Anything less never is: not top power in the middle, nor top power off it.
        for _ in 0..2000 {
            assert_ne!(roll(ALL, 0.0, 0.96, &mut r), ALL);
            assert_ne!(roll(ALL, 0.1, 1.0, &mut r), ALL);
        }
        // Spares still happen.
        assert!(
            (0..500).any(|_| roll(0b11, 0.0, 0.9, &mut r) == 0b11),
            "a spare"
        );
        assert_eq!(roll(ALL, 0.95, 1.0, &mut r), 0, "the gutter");
    }

    #[test]
    fn scores_like_ten_pin() {
        // Five frames: strike, spare (7/3), 5-2, strike, then 10 10 10 in the last.
        let rolls = [10, 7, 3, 5, 2, 10, 10, 10, 10];
        let s = frame_scores(&rolls);
        assert_eq!(s, vec![Some(20), Some(35), Some(42), Some(72), Some(102)]);
        // A perfect short game.
        assert_eq!(total(&[10; 7]), 150);
        // An open game, and a strike waiting for its bonus.
        assert_eq!(total(&[1, 2, 3, 4, 5, 4, 0, 0, 9, 0]), 28);
        assert_eq!(frame_scores(&[10, 3]), vec![None, None, None, None, None]);
        assert_eq!(
            frame_scores(&[3, 4, 10]),
            vec![Some(7), None, None, None, None]
        );
    }

    #[test]
    fn turns_frames_and_the_last_frame_bonus() {
        let mut g = Game::new();
        // A strikes, B leaves pins then spares.
        g.bowled(ALL);
        assert_eq!((g.turn, g.frame), (1, 0));
        g.bowled(0b1);
        assert_eq!(g.standing, ALL & !1);
        g.bowled(ALL);
        assert_eq!((g.turn, g.frame, g.standing), (0, 1, ALL));
        // Through to the last frame with open frames.
        for _ in 0..(FRAMES - 2) * 2 {
            g.bowled(0b11);
            g.bowled(0b100);
        }
        assert_eq!(g.frame as usize, FRAMES - 1);
        // A: strike, strike, strike: three balls. B: open: two.
        g.bowled(ALL);
        assert_eq!((g.turn, g.ball, g.standing), (0, 1, ALL));
        g.bowled(ALL);
        g.bowled(ALL);
        assert_eq!(g.turn, 1);
        g.bowled(0b1);
        g.bowled(0b10);
        assert_ne!(g.status, PLAYING);
        assert_eq!(g.status, A_WON, "{:?}", g.rolls);
    }

    #[test]
    fn the_bot_bowls_a_decent_game() {
        let mut r = rng(3);
        let mut total_pins = 0u32;
        let g = Game::new();
        for _ in 0..500 {
            let (aim, power) = g.ai_roll(r(), r());
            total_pins += roll(ALL, aim, power, &mut r).count_ones();
        }
        let avg = total_pins as f64 / 500.0;
        assert!(
            avg > 6.0 && avg < 9.6,
            "the bot's first ball averages {avg}"
        );
    }
}
