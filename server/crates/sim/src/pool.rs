//! Pool (8-ball) for the bar's table: deterministic physics and the rules.
//!
//! The same step function is mirrored in `client/src/activities/pool.ts`, so
//! every client animates a shot exactly as the server played it. To keep the
//! two bit-for-bit equal, shots are integer velocities, positions are rounded
//! to whole units once the balls stop, and the arithmetic sticks to + − × ÷
//! and `sqrt` (no trig) in a fixed order.
//!
//! Units: the playing surface is `W` × `H` (2:1), ball radius `R`, speeds in
//! units per second. Ball 0 is the cue ball, 1–7 solids, 8 the eight, 9–15
//! stripes.

/// The cloth, inside the cushions.
pub const W: f64 = 1000.0;
pub const H: f64 = 500.0;
pub const R: f64 = 12.0;
/// A ball whose centre comes this close to a pocket's centre drops.
pub const POCKET_R: f64 = 26.0;
/// The cushions stop this far from each corner (the corner pockets' mouths)…
pub const MOUTH: f64 = 34.0;
/// …and this far either side of the middle of the long sides.
pub const SIDE_MOUTH: f64 = 22.0;
/// Corner pockets at the corners; side pockets a little behind the long cushions.
pub const POCKETS: [(f64, f64); 6] = [
    (0.0, 0.0),
    (W / 2.0, -8.0),
    (W, 0.0),
    (0.0, H),
    (W / 2.0, H + 8.0),
    (W, H),
];
/// Physics step, seconds (240 Hz).
pub const DT: f64 = 1.0 / 240.0;
/// Rolling friction: speed lost per second. Low, so balls glide on the
/// cloth almost like ice, and a hard hit takes a long while to settle.
pub const FRICTION: f64 = 95.0;
/// Below this speed the cloth lets go even more (`SLOW_FRICTION`): a
/// slowing ball keeps gliding a good while longer before it stops, as on ice.
pub const SLOW_SPEED: f64 = 120.0;
pub const SLOW_FRICTION: f64 = 40.0;
/// Speed kept after bouncing off a cushion.
pub const CUSHION: f64 = 0.86;
/// Ball-on-ball: (1 + restitution) / 2 of the closing speed is exchanged.
pub const BALL_E: f64 = 0.975;
/// The hardest ordinary shot, units per second.
pub const MAX_SPEED: f64 = 1600.0;
/// Power (thousandths) from which a shot is a power shot…
pub const POWER_SHOT_FROM: u16 = 970;
/// …which goes off at this: nearly three times a 95% shot.
pub const POWER_SHOT_SPEED: f64 = 4400.0;

/// The cue ball's speed for a shot at `power` thousandths: in proportion,
/// until the very top of the meter, where it's a power shot.
pub fn shot_speed(power: u16) -> f64 {
    if power >= POWER_SHOT_FROM {
        POWER_SHOT_SPEED
    } else {
        power as f64 / 1000.0 * MAX_SPEED
    }
}
/// A shot ends after this many steps (30 s) whatever happens.
pub const MAX_STEPS: u32 = 240 * 30;
/// Where the cue ball starts, and comes back to after a scratch.
pub const HEAD_SPOT: (f64, f64) = (250.0, 250.0);
/// The apex of the rack.
pub const FOOT_SPOT: (f64, f64) = (700.0, 250.0);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ball {
    pub n: u8,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    /// Still on the table.
    pub on: bool,
}

/// What a shot did.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shot {
    /// Balls that dropped, in order…
    pub pocketed: Vec<u8>,
    /// …and the pocket each went in (an index into `POCKETS`).
    pub holes: Vec<u8>,
    /// The first ball the cue ball touched.
    pub first_hit: Option<u8>,
    /// Physics steps until everything stopped.
    pub steps: u32,
}

/// The standard rack: the 8 in the middle of the third row, a solid and a
/// stripe in the back corners.
pub fn rack() -> Vec<Ball> {
    const ORDER: [u8; 15] = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
    let mut balls = vec![ball(0, HEAD_SPOT.0, HEAD_SPOT.1)];
    let mut k = 0;
    // Rows of 1–5 balls, each row a ball's width further back.
    let dx = (R * 2.0 + 0.5) * 0.866;
    for row in 0..5 {
        for i in 0..=row {
            let x = FOOT_SPOT.0 + row as f64 * dx;
            let y = FOOT_SPOT.1 + (i as f64 - row as f64 / 2.0) * (R * 2.0 + 0.5);
            balls.push(ball(ORDER[k], x.round(), y.round()));
            k += 1;
        }
    }
    balls
}

fn ball(n: u8, x: f64, y: f64) -> Ball {
    Ball {
        n,
        x,
        y,
        vx: 0.0,
        vy: 0.0,
        on: true,
    }
}

/// Plays a shot: the cue ball (balls[0]) leaves at (`vx`, `vy`) and
/// everything rolls until it stops. Positions end rounded to whole units.
pub fn simulate(balls: &mut [Ball], vx: i32, vy: i32) -> Shot {
    let mut shot = Shot::default();
    balls[0].vx = vx as f64;
    balls[0].vy = vy as f64;
    let mut steps = 0;
    while steps < MAX_STEPS {
        steps += 1;
        if !step(balls, &mut shot) {
            break;
        }
    }
    for b in balls.iter_mut() {
        b.vx = 0.0;
        b.vy = 0.0;
        b.x = b.x.round();
        b.y = b.y.round();
    }
    shot.steps = steps;
    shot
}

/// One physics step; returns whether anything is still moving.
///
/// A ball going faster than any ordinary shot (a power shot, or what it hits)
/// would cover most of its own width in a step, enough to skip clean past a
/// cushion; while one does, the step is played as 2 or 4 shorter ones.
pub fn step(balls: &mut [Ball], shot: &mut Shot) -> bool {
    let mut fastest: f64 = 0.0;
    for b in balls.iter() {
        if b.on {
            fastest = fastest.max((b.vx * b.vx + b.vy * b.vy).sqrt());
        }
    }
    let parts = if fastest > 2.0 * SUBSTEP_OVER {
        4
    } else if fastest > SUBSTEP_OVER {
        2
    } else {
        1
    };
    let dt = DT / parts as f64;
    let mut moving = false;
    for _ in 0..parts {
        moving |= sub_step(balls, shot, dt);
    }
    moving
}

/// The pocket nearest (x, y): the one a ball dropping there went in.
pub fn nearest_pocket(x: f64, y: f64) -> u8 {
    let mut best = 0;
    let mut best_d = f64::MAX;
    for (i, &(px, py)) in POCKETS.iter().enumerate() {
        let d = (x - px) * (x - px) + (y - py) * (y - py);
        if d < best_d {
            best_d = d;
            best = i as u8;
        }
    }
    best
}

/// No pocket (`Game::eight_hole`).
pub const NO_HOLE: u8 = 255;

/// Above this speed a step is split (see `step`); ordinary shots never reach it.
pub const SUBSTEP_OVER: f64 = 1700.0;

/// `step`'s work for `dt` seconds.
fn sub_step(balls: &mut [Ball], shot: &mut Shot, dt: f64) -> bool {
    let n = balls.len();
    let mut moving = false;
    for b in balls.iter_mut() {
        if !b.on {
            continue;
        }
        let speed = (b.vx * b.vx + b.vy * b.vy).sqrt();
        let friction = if speed < SLOW_SPEED {
            SLOW_FRICTION
        } else {
            FRICTION
        };
        if speed <= friction * dt {
            b.vx = 0.0;
            b.vy = 0.0;
            continue;
        }
        moving = true;
        let k = (speed - friction * dt) / speed;
        b.vx *= k;
        b.vy *= k;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        // Into a pocket: near its centre, or through its mouth off the cloth.
        let off = b.x < 0.0 || b.x > W || b.y < 0.0 || b.y > H;
        if off
            || POCKETS.iter().any(|&(px, py)| {
                let (dx, dy) = (b.x - px, b.y - py);
                dx * dx + dy * dy < POCKET_R * POCKET_R
            })
        {
            b.on = false;
            b.vx = 0.0;
            b.vy = 0.0;
            shot.pocketed.push(b.n);
            shot.holes.push(nearest_pocket(b.x, b.y));
            continue;
        }
        // Off the cushions, which stop short of the pocket mouths.
        let corner_x = b.x < MOUTH || b.x > W - MOUTH;
        let corner_y = b.y < MOUTH || b.y > H - MOUTH;
        let side = (b.x - W / 2.0) * (b.x - W / 2.0) < SIDE_MOUTH * SIDE_MOUTH;
        if !corner_y {
            if b.x < R {
                b.x = R + (R - b.x);
                b.vx = -b.vx * CUSHION;
            } else if b.x > W - R {
                b.x = (W - R) - (b.x - (W - R));
                b.vx = -b.vx * CUSHION;
            }
        }
        if !corner_x && !side {
            if b.y < R {
                b.y = R + (R - b.y);
                b.vy = -b.vy * CUSHION;
            } else if b.y > H - R {
                b.y = (H - R) - (b.y - (H - R));
                b.vy = -b.vy * CUSHION;
            }
        }
    }
    // Balls on balls.
    for i in 0..n {
        for j in i + 1..n {
            if !balls[i].on || !balls[j].on {
                continue;
            }
            let dx = balls[j].x - balls[i].x;
            let dy = balls[j].y - balls[i].y;
            let d2 = dx * dx + dy * dy;
            if d2 >= 4.0 * R * R {
                continue;
            }
            // Rewind both to the moment they touched (they overlap by up to a
            // step's travel), so the bounce goes off the true contact point.
            let (ux, uy) = (balls[j].vx - balls[i].vx, balls[j].vy - balls[i].vy);
            let uu = ux * ux + uy * uy;
            let du = dx * ux + dy * uy;
            let mut back = 0.0;
            if uu > 0.0 && du < 0.0 {
                let c = d2 - 4.0 * R * R;
                back = ((du + (du * du - uu * c).sqrt()) / uu).clamp(0.0, dt);
            }
            for k in [i, j] {
                balls[k].x -= balls[k].vx * back;
                balls[k].y -= balls[k].vy * back;
            }
            let dx = balls[j].x - balls[i].x;
            let dy = balls[j].y - balls[i].y;
            let d = (dx * dx + dy * dy).sqrt();
            let (nx, ny) = if d > 0.0 {
                (dx / d, dy / d)
            } else {
                (1.0, 0.0)
            };
            let closing = (balls[i].vx - balls[j].vx) * nx + (balls[i].vy - balls[j].vy) * ny;
            if closing > 0.0 {
                let k = closing * (1.0 + BALL_E) / 2.0;
                balls[i].vx -= k * nx;
                balls[i].vy -= k * ny;
                balls[j].vx += k * nx;
                balls[j].vy += k * ny;
                moving = true;
            }
            // Roll on for the rewound time with the new speeds…
            for k in [i, j] {
                balls[k].x += balls[k].vx * back;
                balls[k].y += balls[k].vy * back;
            }
            // …and never leave them overlapping (resting contact).
            let dx = balls[j].x - balls[i].x;
            let dy = balls[j].y - balls[i].y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < 2.0 * R {
                let (nx, ny) = if d > 0.0 {
                    (dx / d, dy / d)
                } else {
                    (1.0, 0.0)
                };
                let push = (2.0 * R - d) / 2.0;
                balls[i].x -= nx * push;
                balls[i].y -= ny * push;
                balls[j].x += nx * push;
                balls[j].y += ny * push;
            }
            if shot.first_hit.is_none() {
                if balls[i].n == 0 {
                    shot.first_hit = Some(balls[j].n);
                } else if balls[j].n == 0 {
                    shot.first_hit = Some(balls[i].n);
                }
            }
        }
    }
    moving
}

/// Solids or stripes.
pub const SOLIDS: u8 = 1;
pub const STRIPES: u8 = 2;

pub fn group_of(n: u8) -> u8 {
    match n {
        1..=7 => SOLIDS,
        9..=15 => STRIPES,
        _ => 0,
    }
}

/// Game status.
pub const PLAYING: u8 = 1;
/// Player 0 (`a`) or player 1 (`b`) won.
pub const A_WON: u8 = 2;
pub const B_WON: u8 = 3;

/// A game of 8-ball between players 0 and 1.
#[derive(Debug, Clone)]
pub struct Game {
    pub balls: Vec<Ball>,
    /// Whose shot: 0 or 1.
    pub turn: u8,
    /// 0 until someone pockets a ball; then which group player 0 has.
    pub groups: u8,
    pub status: u8,
    /// The pocket the last solid (`[SOLIDS]`) and the last stripe
    /// (`[STRIPES]`) went in, `NO_HOLE` before any did. Once your group's
    /// cleared, the 8 must go in the pocket your last ball did.
    pub last_hole: [u8; 3],
}

impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}

impl Game {
    pub fn new() -> Self {
        Game {
            balls: rack(),
            turn: 0,
            groups: 0,
            status: PLAYING,
            last_hole: [NO_HOLE; 3],
        }
    }

    /// Player `p`'s group (0 while open).
    pub fn group(&self, p: u8) -> u8 {
        match self.groups {
            0 => 0,
            g if p == 0 => g,
            g => 3 - g,
        }
    }

    /// Whether player `p` has cleared their group (and so may play the 8).
    pub fn cleared(&self, p: u8) -> bool {
        let g = self.group(p);
        g != 0 && !self.balls.iter().any(|b| b.on && group_of(b.n) == g)
    }

    /// The pocket player `p` must sink the 8 in: where their group's last
    /// ball went, once they've cleared it (`NO_HOLE` until then).
    pub fn eight_hole(&self, p: u8) -> u8 {
        if self.cleared(p) {
            self.last_hole[self.group(p) as usize]
        } else {
            NO_HOLE
        }
    }

    /// The current player shoots; applies the rules and returns the shot.
    pub fn shoot(&mut self, vx: i32, vy: i32) -> Shot {
        let p = self.turn;
        let mine = self.group(p);
        let cleared = self.cleared(p);
        let hole = self.eight_hole(p);
        let shot = simulate(&mut self.balls, vx, vy);
        for (&n, &h) in shot.pocketed.iter().zip(&shot.holes) {
            let g = group_of(n);
            if g != 0 {
                self.last_hole[g as usize] = h;
            }
        }
        let scratch = shot.pocketed.contains(&0);
        let foul = scratch
            || match shot.first_hit {
                None => true,
                Some(8) => !cleared,
                Some(n) => mine != 0 && group_of(n) != mine,
            };
        if let Some(i) = shot.pocketed.iter().position(|&n| n == 8) {
            // The 8 wins only after your group, cleanly, in the pocket your last ball went in.
            let right_hole = hole == NO_HOLE || shot.holes[i] == hole;
            let won = cleared && !foul && right_hole;
            self.status = if won == (p == 0) { A_WON } else { B_WON };
            return shot;
        }
        if self.groups == 0
            && !foul
            && let Some(&first) = shot.pocketed.iter().find(|&&n| group_of(n) != 0)
        {
            let g = group_of(first);
            self.groups = if p == 0 { g } else { 3 - g };
        }
        let mine = self.group(p);
        let potted_own = shot
            .pocketed
            .iter()
            .any(|&n| group_of(n) != 0 && (mine == 0 || group_of(n) == mine));
        if foul || !potted_own {
            self.turn = 1 - p;
        }
        if scratch {
            self.respot_cue();
        }
        shot
    }

    /// The cue ball back on the head spot (or the nearest free place behind it).
    fn respot_cue(&mut self) {
        let (mut x, y) = HEAD_SPOT;
        while self
            .balls
            .iter()
            .skip(1)
            .any(|b| b.on && (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) < 4.0 * R * R)
        {
            x -= R * 2.0;
        }
        let cue = &mut self.balls[0];
        *cue = ball(0, x.max(R), y);
    }

    /// The bot's shot: tries cutting each ball it may play into each pocket
    /// at a few speeds and keeps the best outcome. `wobble` (radians) spoils
    /// its aim a little so it can be beaten.
    pub fn ai_shot(&self, wobble: f64) -> (i32, i32) {
        let p = self.turn;
        let mine = self.group(p);
        let cleared = self.cleared(p);
        let cue = self.balls[0];
        let targets: Vec<Ball> = self
            .balls
            .iter()
            .filter(|b| {
                b.on && b.n != 0
                    && if cleared {
                        b.n == 8
                    } else {
                        b.n != 8 && (mine == 0 || group_of(b.n) == mine)
                    }
            })
            .copied()
            .collect();
        let hole = self.eight_hole(p);
        let mut best: Option<(i32, (f64, f64))> = None;
        for t in &targets {
            for (i, &(px, py)) in POCKETS.iter().enumerate() {
                if t.n == 8 && hole != NO_HOLE && i as u8 != hole {
                    continue;
                }
                // Where the cue ball must be at contact (the "ghost ball").
                let (tx, ty) = (px - t.x, py - t.y);
                let tl = (tx * tx + ty * ty).sqrt();
                let gx = t.x - tx / tl * 2.0 * R;
                let gy = t.y - ty / tl * 2.0 * R;
                let (ax, ay) = (gx - cue.x, gy - cue.y);
                let al = (ax * ax + ay * ay).sqrt();
                if al < 1.0 || (ax * tx + ay * ty) / (al * tl) < 0.25 {
                    continue; // too thin a cut
                }
                for speed in [450.0, 750.0, 1100.0] {
                    let dir = (ax / al, ay / al);
                    let mut g = self.clone();
                    g.shoot((dir.0 * speed) as i32, (dir.1 * speed) as i32);
                    let score = self.score(&g, p);
                    if best.is_none_or(|(s, _)| score > s) {
                        best = Some((score, (dir.0 * speed, dir.1 * speed)));
                    }
                }
            }
        }
        // Nothing promising: a firm shot at the nearest ball it may play.
        let (vx, vy) = best.map(|(_, v)| v).unwrap_or_else(|| {
            let t = targets
                .iter()
                .min_by(|a, b| {
                    let da = (a.x - cue.x).powi(2) + (a.y - cue.y).powi(2);
                    let db = (b.x - cue.x).powi(2) + (b.y - cue.y).powi(2);
                    da.total_cmp(&db)
                })
                .copied()
                .unwrap_or(ball(8, FOOT_SPOT.0, FOOT_SPOT.1));
            let (ax, ay) = (t.x - cue.x, t.y - cue.y);
            let al = (ax * ax + ay * ay).sqrt().max(1.0);
            (ax / al * 1000.0, ay / al * 1000.0)
        });
        // A human hand: turn the shot by `wobble`.
        let (c, s) = (wobble.cos(), wobble.sin());
        ((vx * c - vy * s) as i32, (vx * s + vy * c) as i32)
    }

    /// How good the game `after` a shot is for player `p`.
    fn score(&self, after: &Game, p: u8) -> i32 {
        let won = if p == 0 { A_WON } else { B_WON };
        if after.status == won {
            return 10_000;
        }
        if after.status != PLAYING {
            return -10_000;
        }
        let mine = |g: &Game| {
            let grp = g.group(p);
            g.balls
                .iter()
                .filter(|b| !b.on && b.n != 0 && b.n != 8 && (grp == 0 || group_of(b.n) == grp))
                .count() as i32
        };
        let keeps_turn = if after.turn == p { 50 } else { 0 };
        (mine(after) - mine(self)) * 100 + keeps_turn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_break_scatters_the_rack_and_everything_stops() {
        let mut g = Game::new();
        let shot = g.shoot(MAX_SPEED as i32, 0);
        assert_eq!(shot.first_hit, Some(1), "the apex ball is hit first");
        assert!(shot.steps < MAX_STEPS, "everything comes to rest");
        let moved = g
            .balls
            .iter()
            .filter(|b| b.n != 0 && (b.x - FOOT_SPOT.0).abs() > 200.0)
            .count();
        assert!(moved > 0, "balls spread out");
        for b in &g.balls {
            assert_eq!(b.x, b.x.round());
            if b.on {
                assert!(
                    (R..=W - R).contains(&b.x) && (R..=H - R).contains(&b.y),
                    "{b:?} on the cloth"
                );
            }
        }
    }

    #[test]
    fn the_same_shot_plays_the_same_every_time() {
        let (mut a, mut b) = (Game::new(), Game::new());
        a.shoot(1500, 37);
        b.shoot(1500, 37);
        assert_eq!(a.balls, b.balls);
    }

    #[test]
    fn potting_a_ball_takes_the_group_and_keeps_the_turn() {
        let mut g = Game::new();
        // Just the cue ball and the 3, lined up with the top-right corner.
        g.balls = vec![
            ball(0, 700.0, 300.0),
            ball(3, 850.0, 150.0),
            ball(8, 200.0, 400.0),
            ball(12, 100.0, 100.0),
        ];
        let shot = g.shoot(900, -900);
        assert_eq!(shot.pocketed, vec![3]);
        assert_eq!(g.group(0), SOLIDS);
        assert_eq!(g.group(1), STRIPES);
        assert_eq!(g.turn, 0, "potting your own keeps the table");
    }

    #[test]
    fn a_scratch_passes_the_turn_and_respots_the_cue() {
        let mut g = Game::new();
        g.balls = vec![
            ball(0, 100.0, 100.0),
            ball(5, 600.0, 300.0),
            ball(8, 800.0, 400.0),
        ];
        let shot = g.shoot(-800, -800);
        assert!(shot.pocketed.contains(&0));
        assert_eq!(g.turn, 1);
        assert!(g.balls[0].on);
        assert_eq!((g.balls[0].x, g.balls[0].y), HEAD_SPOT);
    }

    #[test]
    fn the_eight_too_early_loses() {
        let mut g = Game::new();
        g.balls = vec![
            ball(0, 700.0, 300.0),
            ball(8, 850.0, 150.0),
            ball(2, 100.0, 400.0),
        ];
        g.shoot(900, -900);
        assert_eq!(g.status, B_WON);
    }

    /// The client replays shots with its own copy of the physics
    /// (client/src/activities/pool.ts); these shots must end the same there.
    /// After changing the physics, run with UPDATE_POOL_VECTORS=1.
    #[test]
    fn client_vectors_match() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../client/src/activities/pool.vectors.json"
        );
        let to_json = |b: &[Ball]| -> Vec<serde_json::Value> {
            b.iter()
                .map(|b| serde_json::json!({ "n": b.n, "x": b.x, "y": b.y, "on": b.on }))
                .collect()
        };
        let cases: Vec<serde_json::Value> = [
            (1600, 0),
            (1400, 120),
            (500, -40),
            (-900, 700),
            (4400, 0),
            (-3100, 3100),
        ]
        .iter()
        .map(|&(vx, vy)| {
            let mut b = rack();
            let before = to_json(&b);
            simulate(&mut b, vx, vy);
            serde_json::json!({ "vx": vx, "vy": vy, "before": before, "after": to_json(&b) })
        })
        .collect();
        let json = serde_json::to_string_pretty(&cases).unwrap() + "\n";
        if std::env::var("UPDATE_POOL_VECTORS").is_ok() {
            std::fs::write(path, &json).unwrap();
        }
        // A Windows checkout may have CRLF line endings.
        let have = std::fs::read_to_string(path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert_eq!(
            have, json,
            "pool vectors are stale: run with UPDATE_POOL_VECTORS=1"
        );
    }

    #[test]
    fn a_power_shot_bounces_off_the_cushions_and_settles() {
        assert_eq!(shot_speed(950), 0.95 * MAX_SPEED);
        assert!(
            shot_speed(970) > 2.8 * shot_speed(950),
            "a power shot is nearly three times a 95% one"
        );
        // Straight into the long cushion from just off it: fast enough to
        // skip clean past it in one whole step, so it must be split.
        let mut b = vec![ball(0, 300.0, 14.0)];
        let shot = simulate(&mut b, 0, -(POWER_SHOT_SPEED as i32));
        assert!(
            b[0].on,
            "bounced off the cushion, not lost through it: {shot:?}"
        );
        assert!(shot.steps < MAX_STEPS, "comes to rest");
        let mut g = Game::new();
        let shot = g.shoot(POWER_SHOT_SPEED as i32, 0);
        assert!(shot.steps < MAX_STEPS, "a power break settles too");
    }

    #[test]
    fn the_eight_goes_in_the_pocket_of_your_last_ball() {
        // Solids cleared, the last one went in the top-right corner (2).
        let setup = || {
            let mut g = Game::new();
            g.balls = vec![
                ball(0, 500.0, 250.0),
                ball(8, 700.0, 250.0),
                ball(9, 300.0, 100.0),
            ];
            g.groups = SOLIDS;
            g.last_hole[SOLIDS as usize] = 2;
            g
        };
        assert_eq!(setup().eight_hole(0), 2);
        assert_eq!(setup().eight_hole(1), NO_HOLE, "stripes aren't cleared");
        // Cut it into the bottom-right corner (5): the wrong pocket.
        let mut g = setup();
        let (cx, cy) = (500.0, 250.0);
        let aim = |g: &Game, hole: usize| {
            let (px, py) = POCKETS[hole];
            let (tx, ty) = (px - 700.0, py - 250.0);
            let tl = (tx * tx + ty * ty).sqrt();
            let (gx, gy) = (700.0 - tx / tl * 2.0 * R, 250.0 - ty / tl * 2.0 * R);
            let (ax, ay) = (gx - cx, gy - cy);
            let al = (ax * ax + ay * ay).sqrt();
            let _ = g;
            ((ax / al * 900.0) as i32, (ay / al * 900.0) as i32)
        };
        let (vx, vy) = aim(&g, 5);
        let shot = g.shoot(vx, vy);
        assert_eq!(
            shot.holes[shot
                .pocketed
                .iter()
                .position(|&n| n == 8)
                .expect("the 8 dropped")],
            5,
            "{shot:?}"
        );
        assert_eq!(g.status, B_WON, "the 8 in the wrong pocket loses: {shot:?}");
        // The right one wins.
        let mut g = setup();
        let (vx, vy) = aim(&g, 2);
        let shot = g.shoot(vx, vy);
        assert_eq!(
            shot.holes[shot
                .pocketed
                .iter()
                .position(|&n| n == 8)
                .expect("the 8 dropped")],
            2,
            "{shot:?}"
        );
        assert_eq!(g.status, A_WON, "the 8 in your pocket wins: {shot:?}");
        // And the bot only plays for its pocket.
        let g = setup();
        let (vx, vy) = g.ai_shot(0.0);
        let mut after = g.clone();
        let shot = after.shoot(vx, vy);
        assert_ne!(
            after.status, B_WON,
            "the bot doesn't throw it away: {shot:?}"
        );
    }

    #[test]
    fn the_bot_pots_an_easy_ball() {
        let mut g = Game::new();
        g.balls = vec![
            ball(0, 600.0, 250.0),
            ball(4, 800.0, 250.0),
            ball(8, 300.0, 100.0),
        ];
        g.groups = SOLIDS;
        let (vx, vy) = g.ai_shot(0.0);
        let shot = g.shoot(vx, vy);
        assert!(shot.pocketed.contains(&4), "{shot:?}");
    }
}
