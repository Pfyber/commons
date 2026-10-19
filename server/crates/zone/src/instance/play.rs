//! Corner activities on the instance actor: the bandstand jam, the shared
//! easels and the pitch's ball.
//!
//! - **Jam:** notes from people at the bandstand are relayed to everyone
//!   nearby with the beat the player chose, so everyone hears them in time.
//! - **Easels:** painted cells are relayed live to people nearby; the canvas
//!   itself is saved through the API by the painter's client.
//! - **Ball:** simulated here. Walking into it kicks it the way you're going;
//!   standing in its way blocks it. It bounces off the touchlines and scores
//!   at the goal mouths. Clients evaluate the same friction formula from the
//!   last `Ball` message, so it's only sent on kicks, bounces and goals.

use super::Instance;
use commons_protocol::{
    BALL_FRICTION, BALL_UNITS, BALL_V_OFFSET, BEAT_MS, EASEL_COLORS, EASEL_SIZE, ServerMsg,
    error_code, instrument,
};
use commons_sim::map::MapFile;

/// How close (tiles, Chebyshev) to the bandstand or easels you must stand.
const JAM_RANGE: i32 = 4;
const EASEL_RANGE: i32 = 3;
/// A kick's speed in tiles per second.
const KICK_SPEED: f64 = 7.5;
/// Centre-to-centre distance at which an avatar touches the ball.
const REACH: f64 = 0.7;
const KICK_COOLDOWN_MS: u32 = 400;
/// Fraction of speed kept when bouncing off a touchline.
const BOUNCE: f64 = 0.7;
/// The ball rests in the net this long before going back to the centre spot.
const GOAL_PAUSE_MS: u32 = 1500;
const BALL_R: f64 = 0.25;

/// The playing area, from the map: the bounding box of `pitch` ground, with
/// goals (`goal` objects) at the left and right ends.
#[derive(Debug, Clone)]
pub(crate) struct Pitch {
    pub x0: f64,
    pub x1: f64,
    pub y0: f64,
    pub y1: f64,
    /// Goal mouth, the same span at both ends.
    pub mouth: (f64, f64),
    pub cells: Vec<(u16, u16)>,
}

impl Pitch {
    pub fn from_map(map: &MapFile) -> Option<Pitch> {
        let pitch = map.ground_legend.iter().position(|g| g == "pitch")? as u8;
        let (mut x0, mut y0, mut x1, mut y1) = (u16::MAX, u16::MAX, 0u16, 0u16);
        for (i, &g) in map.ground.iter().enumerate() {
            if g == pitch {
                let (x, y) = (
                    (i % map.width as usize) as u16,
                    (i / map.width as usize) as u16,
                );
                (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
            }
        }
        let mut goals: Vec<_> = map.objects.iter().filter(|o| o.kind == "goal").collect();
        if goals.len() != 2 || x0 > x1 {
            return None;
        }
        goals.sort_by_key(|o| o.x);
        let (l, r) = (goals[0], goals[1]);
        let cells = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]
            .iter()
            .map(|&(x, y)| {
                (
                    x / commons_protocol::CELL_TILES,
                    y / commons_protocol::CELL_TILES,
                )
            })
            .collect();
        Some(Pitch {
            // The ball plays between the goals' inner faces.
            x0: l.x as f64 + l.w as f64,
            x1: r.x as f64,
            y0: y0 as f64,
            y1: y1 as f64 + 1.0,
            mouth: (l.y as f64, l.y as f64 + l.h as f64),
            cells,
        })
    }

    fn centre(&self) -> (f64, f64) {
        ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)
    }
}

/// The ball's kinematic state: at `pos` at `t0` with velocity `vel`, slowing
/// at `BALL_FRICTION` (same formula on clients).
#[derive(Debug, Clone)]
pub(crate) struct Ball {
    pub pos: (f64, f64),
    pub vel: (f64, f64),
    pub t0: u32,
    /// Goals scored by the side attacking the left / right goal.
    pub left: u8,
    pub right: u8,
    reset_at: Option<u32>,
    last_touch: std::collections::HashMap<u32, u32>,
}

impl Ball {
    pub fn new(pitch: &Pitch) -> Ball {
        Ball {
            pos: pitch.centre(),
            vel: (0.0, 0.0),
            t0: 0,
            left: 0,
            right: 0,
            reset_at: None,
            last_touch: Default::default(),
        }
    }

    /// Position and velocity at time `t` (no walls).
    pub fn at(&self, t: u32) -> ((f64, f64), (f64, f64)) {
        let speed = self.vel.0.hypot(self.vel.1);
        if speed <= 0.0 {
            return (self.pos, (0.0, 0.0));
        }
        let dt = (t.saturating_sub(self.t0) as f64 / 1000.0).min(speed / BALL_FRICTION);
        let d = speed * dt - BALL_FRICTION * dt * dt / 2.0;
        let (ux, uy) = (self.vel.0 / speed, self.vel.1 / speed);
        let s = speed - BALL_FRICTION * dt;
        ((self.pos.0 + ux * d, self.pos.1 + uy * d), (ux * s, uy * s))
    }

    fn rebase(&mut self, t: u32, pos: (f64, f64), vel: (f64, f64)) {
        self.pos = pos;
        self.vel = vel;
        self.t0 = t;
    }

    pub fn msg(&self) -> ServerMsg {
        let p = |v: f64| (v * BALL_UNITS).round().clamp(0.0, u16::MAX as f64) as u16;
        let v = |v: f64| {
            (v * BALL_UNITS + BALL_V_OFFSET as f64)
                .round()
                .clamp(0.0, u16::MAX as f64) as u16
        };
        ServerMsg::Ball {
            x: p(self.pos.0),
            y: p(self.pos.1),
            vx: v(self.vel.0),
            vy: v(self.vel.1),
            t0: self.t0,
            left: self.left,
            right: self.right,
        }
    }
}

fn near_object(map: &MapFile, kind: &str, tile: (u16, u16), range: i32) -> Option<usize> {
    map.objects.iter().position(|o| {
        o.kind == kind && {
            let (x, y) = (tile.0 as i32, tile.1 as i32);
            let dx = (o.x as i32 - x)
                .max(x - (o.x as i32 + o.w as i32 - 1))
                .max(0);
            let dy = (o.y as i32 - y)
                .max(y - (o.y as i32 + o.h as i32 - 1))
                .max(0);
            dx.max(dy) <= range
        }
    })
}

impl Instance {
    // ---- jam -------------------------------------------------------------------

    pub(super) fn jam_note(&mut self, id: u32, instrument: u8, pitch: u8, beat: u32, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.play_rl.try_take(now as u64) {
            return;
        }
        let tile = a.tile;
        if instrument > instrument::MAX || pitch > 7 {
            return self.error(id, error_code::BAD_MESSAGE, "no such note");
        }
        if near_object(&self.zone.map, "bandstand", tile, JAM_RANGE).is_none() {
            return self.error(id, error_code::TOO_FAR, "walk up to the bandstand to play");
        }
        // Keep the beat close to now so nobody can schedule notes far ahead.
        let cur = now / BEAT_MS;
        let beat = beat.clamp(cur.saturating_sub(4), cur + 16);
        let msg = ServerMsg::JamNote {
            id,
            instrument,
            pitch,
            beat,
        };
        self.broadcast(self.cell_of(tile), &msg, Some(id));
    }

    // ---- easels ------------------------------------------------------------------

    pub(super) fn paint(&mut self, id: u32, easel: u8, cell: u16, color: u8, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.play_rl.try_take(now as u64) {
            return;
        }
        let tile = a.tile;
        let Some(obj) = near_object(&self.zone.map, "easels", tile, EASEL_RANGE) else {
            return self.error(id, error_code::TOO_FAR, "walk up to the easels to paint");
        };
        let easels = self.zone.map.objects[obj].w as u8;
        if easel >= easels || cell >= EASEL_SIZE * EASEL_SIZE || color >= EASEL_COLORS {
            return self.error(id, error_code::BAD_MESSAGE, "no such cell");
        }
        let msg = ServerMsg::Painted {
            id,
            easel,
            cell,
            color,
        };
        self.broadcast(self.cell_of(tile), &msg, Some(id));
    }

    // ---- ball --------------------------------------------------------------------

    fn broadcast_ball(&mut self) {
        let (Some(pitch), Some(ball)) = (self.zone.pitch.as_ref(), self.ball.as_ref()) else {
            return;
        };
        let msg = ball.msg();
        let mut cells: Vec<u16> = pitch
            .cells
            .iter()
            .map(|&(cx, cy)| cy * self.zone.cells_w + cx)
            .collect();
        cells.sort_unstable();
        cells.dedup();
        for c in cells {
            self.broadcast(c, &msg, None);
        }
    }

    /// The ball's state for a client that starts watching `cell`.
    pub(super) fn ball_in_cell(&self, cell: u16) -> Option<ServerMsg> {
        let pitch = self.zone.pitch.as_ref()?;
        let ball = self.ball.as_ref()?;
        let watched = pitch
            .cells
            .iter()
            .any(|&(cx, cy)| cy * self.zone.cells_w + cx == cell);
        watched.then(|| ball.msg())
    }

    /// Moves the ball on: touches, bounces, goals (called every tick).
    pub(super) fn ball_tick(&mut self, now: u32) {
        let Some(pitch) = self.zone.pitch.clone() else {
            return;
        };
        let Some(mut ball) = self.ball.take() else {
            return;
        };
        let mut changed = false;

        if let Some(at) = ball.reset_at {
            if now >= at {
                ball.reset_at = None;
                ball.rebase(now, pitch.centre(), (0.0, 0.0));
                changed = true;
            }
        } else {
            let (mut pos, mut vel) = ball.at(now);

            // Touches: anyone whose body reaches the ball.
            for a in self.avatars.values() {
                let (ax, ay) = match &a.motion {
                    Some(m) => m.pos_at(now),
                    None => (a.tile.0 as f64, a.tile.1 as f64),
                };
                let (ax, ay) = (ax + 0.5, ay + 0.5);
                let (dx, dy) = (pos.0 - ax, pos.1 - ay);
                let dist = dx.hypot(dy);
                if dist > REACH
                    || ball
                        .last_touch
                        .get(&a.id)
                        .is_some_and(|&t| now < t + KICK_COOLDOWN_MS)
                {
                    continue;
                }
                let walking = a.motion.as_ref().map(|m| {
                    let (px, py) = m.pos_at(now.saturating_sub(100));
                    (ax - 0.5 - px, ay - 0.5 - py)
                });
                vel = match walking {
                    // Walking into it: kick it the way you're going.
                    Some((wx, wy)) if wx.hypot(wy) > 1e-3 => {
                        let l = wx.hypot(wy);
                        (wx / l * KICK_SPEED, wy / l * KICK_SPEED)
                    }
                    // Standing in its way: it bounces off you.
                    _ => {
                        let l = dist.max(1e-3);
                        let s = (vel.0.hypot(vel.1) * 0.5).max(1.5);
                        (dx / l * s, dy / l * s)
                    }
                };
                ball.last_touch.insert(a.id, now);
                changed = true;
                break;
            }

            // Touchlines and goal lines.
            let in_mouth = pos.1 > pitch.mouth.0 && pos.1 < pitch.mouth.1;
            if pos.0 < pitch.x0 + BALL_R {
                if in_mouth {
                    ball.right += 1; // into the left goal: a point for the side attacking it
                    ball.reset_at = Some(now + GOAL_PAUSE_MS);
                    pos.0 = pitch.x0 - 0.4;
                    vel = (0.0, 0.0);
                } else {
                    pos.0 = pitch.x0 + BALL_R;
                    vel.0 = -vel.0 * BOUNCE;
                }
                changed = true;
            } else if pos.0 > pitch.x1 - BALL_R {
                if in_mouth {
                    ball.left += 1;
                    ball.reset_at = Some(now + GOAL_PAUSE_MS);
                    pos.0 = pitch.x1 + 0.4;
                    vel = (0.0, 0.0);
                } else {
                    pos.0 = pitch.x1 - BALL_R;
                    vel.0 = -vel.0 * BOUNCE;
                }
                changed = true;
            }
            if pos.1 < pitch.y0 + BALL_R {
                pos.1 = pitch.y0 + BALL_R;
                vel.1 = -vel.1 * BOUNCE;
                changed = true;
            } else if pos.1 > pitch.y1 - BALL_R {
                pos.1 = pitch.y1 - BALL_R;
                vel.1 = -vel.1 * BOUNCE;
                changed = true;
            }
            if changed {
                ball.rebase(now, pos, vel);
            }
            ball.last_touch
                .retain(|_, &mut t| now < t + KICK_COOLDOWN_MS);
        }
        self.ball = Some(ball);
        if changed {
            self.broadcast_ball();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::tests::*;
    use crate::instance::*;
    use commons_protocol::{ClientMsg, ServerMsg};

    #[test]
    fn walking_into_the_ball_kicks_it_and_goals_count() {
        let mut inst = pitch_instance();
        let mut c = connect(&mut inst, 1, "striker", (20, 12));
        let pitch = inst.zone.pitch.clone().unwrap();
        let (cx, cy) = pitch.centre();
        assert_eq!(inst.ball.as_ref().unwrap().pos, (cx, cy));

        // Stand just left of the ball and walk right through it.
        let start = ((cx - 2.5) as u16, (cy - 0.5) as u16);
        place(&mut inst, 1, start);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo {
                x: start.0 + 3,
                y: start.1, sprint: false },
        });
        let t0 = inst.clock.now_ms();
        let mut kicked = None;
        for k in 0..30 {
            let now = t0 + k * 100;
            inst.step(now);
            inst.ball_tick(now);
            if inst.ball.as_ref().unwrap().vel.0 > 1.0 {
                kicked = Some(now);
                break;
            }
        }
        assert!(kicked.is_some(), "the ball was kicked");
        // It rolls right, into the right-hand goal mouth, and counts.
        let mut now = kicked.unwrap();
        for _ in 0..40 {
            now += 100;
            inst.ball_tick(now);
        }
        let b = inst.ball.as_ref().unwrap();
        assert_eq!((b.left, b.right), (1, 0), "a goal at the right end");
        inst.ball_tick(now + 2000);
        assert_eq!(
            inst.ball.as_ref().unwrap().pos,
            (cx, cy),
            "back on the spot"
        );
        inst.flush();
        c.pump();
        assert!(
            c.log
                .iter()
                .any(|m| matches!(m, ServerMsg::Ball { left: 1, .. }))
        );
    }

    #[test]
    fn the_ball_slows_down_and_bounces_off_touchlines() {
        let inst = pitch_instance();
        let pitch = inst.zone.pitch.clone().unwrap();
        let mut b = Ball::new(&pitch);
        b.rebase(0, (pitch.centre().0, pitch.y0 + 1.0), (0.0, -4.0));
        let (_, v) = b.at(500);
        assert!((v.1 + 4.0 - BALL_FRICTION * 0.5).abs() < 1e-9, "friction");
        let (p, v) = b.at(60_000);
        assert_eq!(v, (0.0, 0.0), "it stops");
        assert!(p.1 < pitch.y0, "without walls it would leave the pitch");
        let mut inst = inst;
        inst.ball = Some(b);
        inst.ball_tick(400);
        let b = inst.ball.as_ref().unwrap();
        assert!(b.vel.1 > 0.0 && b.pos.1 >= pitch.y0, "bounced back in");
    }

    #[test]
    fn jam_and_paint_need_the_right_place() {
        let mut inst = pitch_instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        place(&mut inst, 1, (2, 2));
        place(&mut inst, 2, (3, 2));
        let now = inst.clock.now_ms();
        let beat = now / BEAT_MS + 1;
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::JamNote {
                instrument: 0,
                pitch: 3,
                beat,
            },
        });
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Paint {
                easel: 0,
                cell: 17,
                color: 4,
            },
        });
        inst.flush();
        b.pump();
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::JamNote {
                id: 1,
                pitch: 3,
                ..
            }
        )));
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::Painted {
                id: 1,
                cell: 17,
                color: 4,
                ..
            }
        )));

        // Far from the bandstand and easels: nothing is relayed.
        place(&mut inst, 1, (30, 30));
        b.log.clear();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::JamNote {
                instrument: 0,
                pitch: 3,
                beat,
            },
        });
        inst.flush();
        b.pump();
        a.pump();
        assert!(!b.log.iter().any(|m| matches!(m, ServerMsg::JamNote { .. })));
        assert!(a.log.iter().any(|m| matches!(m, ServerMsg::Error { .. })));
    }
}
