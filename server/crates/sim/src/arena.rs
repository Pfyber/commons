//! The gladiator arena in the park: Crown of the Colosseum. Up to four
//! gladiators (bots fill the empty places), every one for themselves, on
//! the sand inside the arena's walls. Last one standing takes the round's
//! crown; three crowns and you're champion.
//!
//! Everything is in arena tiles (the sand's top-left corner is 0,0). People
//! move themselves (the client says where it is; `claim_move` checks it
//! could have got there), except while they're knocked flying; everything
//! else is decided here, ten times a second: the swings and what they hit,
//! blocks and parries, knockback (and slamming into walls and pillars), the
//! spikes, the crowd's gifts and what's thrown, the ring of fire, the bots.
//!
//! The moves: quick slashes that chain into a three-hit combo; a heavy
//! blow, charged up, that lunges and breaks a guard; a shield to block (and
//! raised just as a blow lands, a parry that leaves them reeling); a roll
//! that nothing touches; and, once your rage is full, the whirlwind. The
//! arena: two pillars to hide behind (or be slammed into), spike plates that
//! rise in turn, gifts the crowd throws in (a roast leg, a spear or a bomb to
//! throw, a fury helmet), and after a while a ring of fire closing in.

use std::f64::consts::{FRAC_PI_2, PI, TAU};

pub const SLOTS: usize = 4;
/// `Match::status`.
pub const LOBBY: u8 = 0;
/// A round about to begin (the fighters at their gates).
pub const COUNTDOWN: u8 = 1;
pub const FIGHTING: u8 = 2;
/// A round won: a moment to see who's standing.
pub const ROUND_END: u8 = 3;
/// The champion crowned.
pub const OVER: u8 = 4;
/// The bots, as player ids (one per place).
pub const BOT_BASE: u32 = 0xffff_ff20;

pub const TO_WIN: u8 = 3;
pub const HP: f64 = 100.0;
pub const STAMINA: f64 = 100.0;
pub const RAGE: f64 = 100.0;
pub const SPEED: f64 = 4.2;
pub const BODY_R: f64 = 0.32;
/// How long each part of a slash lasts (ms): wind-up, the blow, recovery.
pub const LIGHT: [(u32, u32, u32); 3] = [(110, 90, 200), (110, 90, 200), (170, 110, 320)];
pub const LIGHT_DMG: [f64; 3] = [8.0, 9.0, 16.0];
pub const LIGHT_KB: [f64; 3] = [2.5, 2.5, 7.0];
pub const LIGHT_REACH: f64 = 1.35;
pub const LIGHT_ARC: f64 = 1.0;
pub const LIGHT_COST: f64 = 9.0;
/// A heavy blow: charged for at least `HEAVY_MIN_MS`, full at `HEAVY_FULL_MS`;
/// then a short wind-up, the lunge (the blow), recovery.
pub const HEAVY_MIN_MS: u32 = 220;
pub const HEAVY_FULL_MS: u32 = 1000;
pub const HEAVY: (u32, u32, u32) = (70, 190, 360);
pub const HEAVY_REACH: f64 = 1.55;
pub const HEAVY_ARC: f64 = 1.25;
/// How near the line of a heavy blow's lunge a foe is struck (and their body).
pub const HEAVY_SWEEP: f64 = 0.85;
/// The heavy blow's lunge: further the longer it was charged (from
/// `HEAVY_LUNGE` barely held to `HEAVY_LUNGE_MAX` held full).
pub const HEAVY_LUNGE: f64 = 1.3;
pub const HEAVY_LUNGE_MAX: f64 = 4.0;
pub const HEAVY_COST: f64 = 28.0;
pub const BLOCK_ARC: f64 = 1.35;
/// Blocking this soon before a blow lands is a parry.
pub const PARRY_MS: u32 = 190;
pub const PARRIED_STUN_MS: u32 = 750;
/// A heavy blow parried: the attacker's left wide open, and winded.
pub const HEAVY_PARRIED_STUN_MS: u32 = 1300;
pub const HEAVY_PARRIED_COST: f64 = 30.0;
/// Stamina: it comes back this fast (a second), this long after it's used,
/// at this share while blocking; run it right out and you're winded a while.
pub const STAMINA_REGEN: f64 = 28.0;
pub const STAMINA_DELAY_MS: u32 = 700;
pub const BLOCK_REGEN: f64 = 0.35;
pub const BLOCK_HIT_COST: f64 = 13.0;
pub const WINDED_MS: u32 = 1200;
/// A whirlwind asked for while busy (rolling, reeling, mid-blow) goes off
/// as soon as it can, if that's within this long.
pub const SPECIAL_BUFFER_MS: u32 = 700;
pub const GIANT_SPECIAL_BUFFER_MS: u32 = 1600;
/// A slash or a charge asked for while busy (finishing a blow, reeling,
/// knocked about): kept this long, and done the moment they're free.
pub const INPUT_BUFFER_MS: u32 = 400;
/// The Goliath's smash or stomp asked for while it's busy: kept this long.
pub const GIANT_INPUT_BUFFER_MS: u32 = 700;
pub const ROLL_MS: u32 = 260;
pub const ROLL_DIST: f64 = 2.3;
pub const ROLL_COST: f64 = 24.0;
pub const ROLL_CD_MS: u32 = 450;
/// The whirlwind: how long, how often it hits each one in reach, how far.
pub const SPIN_MS: u32 = 750;
pub const SPIN_EVERY_MS: u32 = 140;
pub const SPIN_REACH: f64 = 1.75;
pub const SPIN_DMG: f64 = 9.0;
/// Throwing: wind-up, recovery.
pub const THROW: (u32, u32) = (130, 220);
pub const SPEAR_SPEED: f64 = 15.0;
pub const SPEAR_RANGE: f64 = 11.0;
pub const SPEAR_DMG: f64 = 26.0;
pub const BOMB_SPEED: f64 = 9.0;
pub const BOMB_RANGE: f64 = 6.5;
pub const BOMB_R: f64 = 1.9;
pub const BOMB_DMG: f64 = 34.0;
pub const WALL_SLAM_SPEED: f64 = 4.6;
pub const WALL_SLAM_DMG: f64 = 10.0;
/// Knockback dies away at this rate (per second).
pub const KB_FRICTION: f64 = 5.0;
pub const COUNTDOWN_MS: u32 = 3200;
pub const ROUND_END_MS: u32 = 3800;
/// The champion's parade: out of the ring through the south gate, down the
/// red carpet, the rest trailing behind (see `parade_end`).
pub const OVER_MS: u32 = 15_000;
/// Where the parade ends: this far below the sand's top edge (arena tiles),
/// down the carpet; those who lost this far behind, one after another.
pub const PARADE_END: f64 = 11.9;
/// How square an amphitheatre's sand (and stands) are: a superellipse's
/// power (2 an ellipse; the higher, the squarer). Mirrored client side and
/// in mapgen.
pub const ROUNDNESS: f64 = 3.3;
pub const PARADE_GAP: f64 = 1.4;
pub const PARADE_FIRST_GAP: f64 = 2.0;
/// The ring of fire starts closing this long into a round, and takes this long to close.
pub const FIRE_AFTER_MS: u32 = 45_000;
pub const FIRE_CLOSE_MS: u32 = 22_000;
/// How far it closes (as a fraction of the ring, middle to side), and how hot it is.
pub const FIRE_MIN: f64 = 0.28;
pub const FIRE_DPS: f64 = 12.0;
/// The crowd throws a gift in this often (ms, plus up to `GIFT_JITTER_MS`).
pub const GIFT_EVERY_MS: u32 = 5300;
pub const GIFT_JITTER_MS: u32 = 3300;
pub const GIFT_FALL_MS: u32 = 900;
/// At most this many on the sand at once (each lies there till it's taken).
pub const GIFT_MAX: usize = 2;
pub const FURY_MS: u32 = 8000;
pub const HEAL: f64 = 35.0;
/// Each spike plate's cycle, its warning and how long the spikes are up.
pub const SPIKE_CYCLE_MS: u32 = 6000;
pub const SPIKE_WARN_MS: u32 = 900;
pub const SPIKE_UP_MS: u32 = 800;
pub const SPIKE_DMG: f64 = 15.0;

/// The classes (`Fighter::kit`), with classes on (`Match::kits`): each
/// gladiator picks one before every round (the Goliath's the Goliath).
pub mod kit {
    /// Sword and shield: as everyone always fought.
    pub const KNIGHT: u8 = 0;
    /// A dagger close in; the bow (charged) far off; a storm of arrows.
    pub const ARCHER: u8 = 1;
    /// A dagger close in; a lobbed bomb (charged); a great blast all round.
    pub const BOMBER: u8 = 2;
    /// As the knight, with a long spear: further, a little lighter.
    pub const SPEARMAN: u8 = 3;
    /// As the knight, but slower and harder: twice the health; an earthquake.
    pub const TANK: u8 = 4;
    pub const COUNT: u8 = 5;
    /// (In `ArenaFighter.kit`: picked, this round.)
    pub const PICKED: u8 = 0x80;
}
/// Each class (by `kit`): its health, its pace (of a knight's), its quick
/// blow's reach, sweep, damage and timing (of a knight's), its heavy blow's
/// reach and damage (and the lunge's, barely and fully charged), its
/// whirlwind's reach and damage, and how far blows knock it.
pub const KIT_HP: [f64; 5] = [108.0, 105.0, 95.0, 110.0, 150.0];
pub const KIT_SPEED: [f64; 5] = [1.0, 1.12, 1.0, 1.0, 0.84];
pub const KIT_LIGHT_REACH: [f64; 5] = [1.35, 1.15, 1.15, 1.95, 1.4];
pub const KIT_LIGHT_ARC: [f64; 5] = [1.0, 0.85, 0.85, 0.8, 1.05];
pub const KIT_LIGHT_DMG: [f64; 5] = [1.0, 0.6, 0.65, 1.08, 1.25];
pub const KIT_LIGHT_TIME: [f64; 5] = [1.0, 0.8, 0.8, 1.08, 1.15];
pub const KIT_HEAVY_REACH: [f64; 5] = [1.55, 1.15, 1.15, 2.2, 1.6];
pub const KIT_HEAVY_DMG: [f64; 5] = [1.0, 0.6, 0.65, 0.57, 1.1];
pub const KIT_LUNGE: [f64; 5] = [1.3, 1.3, 1.3, 1.7, 1.0];
pub const KIT_LUNGE_MAX: [f64; 5] = [4.0, 4.0, 4.0, 5.2, 3.0];
pub const KIT_SPIN_REACH: [f64; 5] = [1.75, 1.75, 1.75, 2.5, 1.75];
pub const KIT_SPIN_DMG: [f64; 5] = [1.0, 1.0, 1.0, 0.8, 1.0];
pub const KIT_KB_TAKEN: [f64; 5] = [1.0, 1.1, 1.0, 1.0, 0.75];
/// What arrows, thrown spears and bombs do to each class (the tank's armour turns some).
pub const KIT_RANGED_TAKEN: [f64; 5] = [1.0, 1.0, 1.0, 1.0, 0.8];
/// What each move costs it in stamina (of a knight's).
pub const KIT_COST: [f64; 5] = [1.0, 1.0, 1.0, 1.0, 1.35];
/// With classes on, each round begins with this long to pick one (cut
/// short once everyone has).
pub const CHOOSE_MS: u32 = 7000;
/// With the wheel on, how long it spins (and shows what it gave) instead.
pub const WHEEL_MS: u32 = 6000;
/// Firing: the bow drawn back (the archer's charged blow) or a bomb lobbed
/// (the bomber's): the moment it goes, and the recovery after.
pub const SHOOT: (u32, u32) = (90, 260);
/// The archer's quick shot: a light arrow at the aim, flying as far as a
/// thrown spear; one every third of a second (the shot, then the rest of it).
pub const ARROW_SPEED: f64 = 22.0;
pub const QUICK_SHOT: (u32, u32) = (60, 690);
pub const QUICK_ARROW_DMG: f64 = 6.0;
pub const QUICK_ARROW_COST: f64 = 9.0;
/// The archer's charged shot: three arrows, one after another, flying on
/// till they hit something, twice the quick one's damage, 1.7× as fast.
pub const BURST_ARROWS: u8 = 3;
pub const BURST_GAP_MS: u32 = 110;
pub const BURST_DMG: f64 = 8.5;
pub const BURST_SPEED: f64 = ARROW_SPEED * 1.7;
pub const BURST_COST: f64 = 26.0;
/// (As far as "till they hit something" goes.)
pub const BURST_RANGE: f64 = 1000.0;
/// (The storm's arrows fly this far.)
pub const ARROW_RANGE: f64 = 14.0;
/// The bomber's bombs: lobbed to the mouse (from `LOB_MIN` to `LOB_RANGE`).
pub const LOB_MIN: f64 = 2.2;
pub const LOB_RANGE: f64 = 7.0;
/// Its quick throw: a small bomb.
pub const QUICK_LOB: (u32, u32) = (120, 480);
pub const QUICK_LOB_DMG: f64 = 9.5;
pub const QUICK_LOB_R: f64 = 1.5;
pub const QUICK_LOB_COST: f64 = 20.0;
/// Its charged throw: a big bomb, the blast (and the damage, and what it
/// costs) growing with the charge, from barely held to full.
pub const BIG_BOMB_DMG: (f64, f64) = (22.0, 42.0);
pub const BIG_BOMB_R: (f64, f64) = (1.7, 2.7);
/// (It takes four times a heavy blow's charge to fill.)
pub const BIG_BOMB_FULL_MS: u32 = HEAVY_MIN_MS + 4 * (HEAVY_FULL_MS - HEAVY_MIN_MS);
pub const BIG_BOMB_COST: (f64, f64) = (28.0, 56.0);
/// Picking up the crowd's bomb, the bomber throws three, fanned out.
pub const BOMBER_GIFT_BOMBS: usize = 3;
pub const BOMBER_GIFT_SPREAD: f64 = 0.35;
/// What each class's heavy blow costs (of a knight's): the spearman's long thrust, twice.
pub const KIT_HEAVY_COST: [f64; 5] = [1.0, 1.0, 1.0, 2.0, 1.0];
/// The tank's charged blow: the Goliath's stomp, smaller: a hop (as far as
/// the charge and the mouse allow), a shockwave where it lands.
pub const TANK_LEAP_MIN: f64 = 1.0;
pub const TANK_LEAP: f64 = 3.4;
pub const TANK_STOMP_R: f64 = 1.6;
pub const TANK_STOMP_DMG: f64 = 20.0;
pub const TANK_STOMP_KB: f64 = 11.0;
pub const TANK_STOMP_DAZE_MS: u32 = 600;
/// How tall a body stands (tiles above its feet): a blow or a missile
/// anywhere on it counts, not just at its feet.
pub const BODY_H: f64 = 0.9;
pub const GIANT_H: f64 = 2.2;
/// The archer's, the bomber's and the tank's ultimates: a wind-up (they
/// can't be touched), then the rest of it.
pub const CAST: (u32, u32) = (320, 260);
/// The archer's: three rings of arrows all round (and a few more at the
/// mouse), half a second apart.
pub const VOLLEY_WAVES: u8 = 3;
pub const VOLLEY_GAP_MS: u32 = 500;
pub const VOLLEY_ARROWS: usize = 16;
pub const VOLLEY_DMG: f64 = 3.0;
pub const VOLLEY_AIMED: usize = 3;
pub const VOLLEY_AIMED_DMG: f64 = 4.5;
pub const VOLLEY_SPREAD: f64 = 0.12;
/// The bomber's: a great blast all round them (they're unharmed).
pub const BLAST_R: f64 = 3.3;
pub const BLAST_DMG: f64 = 44.0;
/// The tank's: an earthquake, a stomp throwing everyone near away, dazed.
pub const QUAKE_R: f64 = 2.9;
pub const QUAKE_DMG: f64 = 24.0;
pub const QUAKE_KB: f64 = 14.0;
pub const QUAKE_DAZE_MS: u32 = 800;
/// What's flying besides the crowd's gifts (`Missile::kind`).
pub mod missile {
    pub const ARROW: u8 = 5;
    /// The bomber's big bomb.
    pub const BIG_BOMB: u8 = 6;
}

/// The kinds of match (`Match::mode`): everyone for themselves, or the
/// Goliath against the rest.
pub mod mode {
    pub const CLASSIC: u8 = 0;
    pub const GOLIATH: u8 = 1;
}
/// The Goliath: a giant, much tougher and slower, too heavy to roll; bigger to hit.
pub const GIANT_HP: f64 = 500.0;
pub const GIANT_SPEED: f64 = 0.95;
pub const GIANT_R: f64 = 0.55;
/// Its stamina comes back slower than a gladiator's used to (a share of `STAMINA_REGEN`).
pub const GIANT_REGEN: f64 = 0.5;
/// A gladiator's stamina comes back at this share of `STAMINA_REGEN` (40% slower).
pub const GLADIATOR_REGEN: f64 = 0.6;
/// Standing still this long (doing nothing), it heals, very slowly (health a second).
pub const GIANT_REST_MS: u32 = 1500;
pub const GIANT_REST_HPS: f64 = 1.5;
/// Too heavy to roll, it dashes instead: a long charge across the sand (its
/// way), costing most of its wind (it needs all of it to hand).
pub const GIANT_DASH_MS: u32 = 380;
pub const GIANT_DASH_DIST: f64 = 5.0;
pub const GIANT_DASH_COST: f64 = 60.0;
/// The crowd's gifts, in its hands: a roast leg heals it twice as much; its
/// bomb's blast covers twice the ground (√2 the reach); it throws spears three at a time.
pub const GIANT_GIFT_HEAL: f64 = 2.0;
pub const GIANT_BOMB_R: f64 = 1.414;
pub const GIANT_SPEARS: usize = 3;
pub const GIANT_SPEAR_SPREAD: f64 = 0.22;
/// Any gladiator in its way is bowled aside.
pub const DASH_HIT_DMG: f64 = 8.0;
pub const DASH_HIT_KB: f64 = 10.0;
/// Its smash: a crushing sweep of its club, catching all in front of it:
/// wind-up, the blow, recovery (ms).
pub const SMASH: (u32, u32, u32) = (210, 110, 280);
pub const SMASH_DMG: f64 = 12.0;
pub const SMASH_REACH: f64 = 4.3;
pub const SMASH_ARC: f64 = 0.9;
pub const SMASH_COST: f64 = 14.0;
/// Its charged blow, the stomp: a crouch, a leap forward, and a shockwave
/// where it lands; then recovery. Everything about it grows with how long
/// it was charged (full at `GIANT_CHARGE_MS`): from a hop of
/// `STOMP_LEAP_MIN` to a leap of `STOMP_LEAP`; its damage, its fling, the
/// daze it leaves, from a share (`STOMP_MIN`) of the most up to it.
pub const GIANT_CHARGE_MS: u32 = 1800;
pub const STOMP: (u32, u32, u32) = (200, 520, 460);
pub const STOMP_LEAP_MIN: f64 = 1.0;
pub const STOMP_LEAP: f64 = 5.7;
pub const STOMP_R: f64 = 2.3;
pub const STOMP_DMG: f64 = 18.0;
/// The share of its damage a barely-charged stomp does.
pub const STOMP_DMG_MIN: f64 = 0.3;
/// A stomp held all the way to full: half as much damage again.
pub const STOMP_FULL_BONUS: f64 = 1.5;
pub const STOMP_MIN: f64 = 0.4;
pub const STOMP_COST: f64 = 30.0;
/// Its shockwave flings those it catches and leaves them dazed, reeling,
/// stars round their heads.
pub const STOMP_KB: f64 = 16.0;
pub const STOMP_DAZE_MS: u32 = 1000;
/// Staggered by a heavy blow, it's steady this long after (no stun-lock).
pub const GIANT_POISE_MS: u32 = 1200;
/// A bomb's blast catching it mid-attack breaks the attack off: it reels.
pub const CHARGE_BREAK_STUN_MS: u32 = 600;
/// A gladiator's quick blows hardly dent it (a share of their damage); and
/// one landing as it attacks glances off, the one who struck reeling.
pub const LIGHT_VS_GIANT: f64 = 0.9;
/// Their heavy blows, though, tell: more than on another gladiator.
pub const HEAVY_VS_GIANT: f64 = 1.6;
/// How much rage the Goliath gains from the damage it takes (a gladiator: 0.9).
pub const GIANT_RAGE_HURT: f64 = 0.25;
/// And from the damage it deals (a gladiator: 0.6).
pub const GIANT_RAGE_DEAL: f64 = 0.2;
pub const DEFLECT_STUN_MS: u32 = 380;
/// Its rage: the grab. It seizes a gladiator in reach (the one nearest
/// where it's aiming), whirls them round (bowling over any others they're
/// swung into), then hurls them the way it's aiming.
pub const GRAB_REACH: f64 = 2.4;
pub const GRAB_SPIN_MS: u32 = 3000;
/// None in reach: it lunges at one this far off (and seizes them).
pub const GRAB_LUNGE: f64 = 4.5;
/// How many times round it whirls them, and how far out (and how near, to be swung into).
pub const GRAB_TURNS: f64 = 5.0;
pub const GRAB_ORBIT: f64 = 1.9;
pub const GRAB_HIT_R: f64 = 1.2;
pub const GRAB_SWING_DMG: f64 = 15.0;
pub const GRAB_SWING_KB: f64 = 7.5;
pub const GRAB_SWING_EVERY_MS: u32 = 600;
/// The hurl: as far as the mouse (no nearer than `HURL_MIN`, no further than
/// `HURL_DIST`, a dash's length); into a wall, it hurts the more.
pub const HURL_MIN: f64 = 3.0;
pub const HURL_DIST: f64 = 9.0;
/// Crashing (into a wall, or into another gladiator), the one hurled, and
/// whoever they crash into, reel this long, dazed: stars round their heads.
pub const HURL_CRASH_DAZE_MS: u32 = 1100;
pub const HURL_WALL_DMG: f64 = 28.0;
/// (The match steps this often, in seconds.)
pub const TICK_S: f64 = 0.1;
pub const HURL_DMG: f64 = 26.0;
/// The one hurled, flying into another gladiator: bowls them over.
pub const HURL_HIT_DMG: f64 = 16.0;
pub const HURL_HIT_KB: f64 = 9.0;

/// What a fighter is doing (`Fighter::act`, protocol `ArenaFighter.act`).
pub mod act {
    pub const NONE: u8 = 0;
    pub const LIGHT1: u8 = 1;
    pub const LIGHT2: u8 = 2;
    pub const LIGHT3: u8 = 3;
    /// Charging a heavy blow.
    pub const CHARGE: u8 = 4;
    pub const HEAVY: u8 = 5;
    pub const BLOCK: u8 = 6;
    pub const ROLL: u8 = 7;
    /// Reeling (hit, parried, slammed).
    pub const STUN: u8 = 8;
    pub const THROW: u8 = 9;
    pub const SPIN: u8 = 10;
    pub const DOWN: u8 = 11;
    /// The Goliath: smashing its club down; leaping for a stomp; whirling a
    /// gladiator it's grabbed (who's `HELD`).
    pub const SMASH: u8 = 12;
    pub const STOMP: u8 = 13;
    pub const GRAB: u8 = 14;
    pub const HELD: u8 = 15;
    /// Firing the bow, lobbing a bomb (the archer's, the bomber's charged blow).
    pub const SHOOT: u8 = 16;
    /// The archer's, the bomber's, the tank's ultimate (by its class).
    pub const CAST: u8 = 17;
}

/// What a client asks for (protocol `ArenaAct.act`).
pub mod input {
    pub const LIGHT: u8 = 1;
    pub const HEAVY_START: u8 = 2;
    pub const HEAVY_RELEASE: u8 = 3;
    pub const BLOCK_ON: u8 = 4;
    pub const BLOCK_OFF: u8 = 5;
    /// A roll, the way `aim` says.
    pub const ROLL: u8 = 6;
    pub const THROW: u8 = 7;
    pub const SPECIAL: u8 = 8;
}

/// The crowd's gifts (`Gift::kind`, `Fighter::holding`).
pub mod gift {
    pub const HEALTH: u8 = 1;
    pub const SPEAR: u8 = 2;
    pub const BOMB: u8 = 3;
    pub const FURY: u8 = 4;
    pub const ALL: [u8; 4] = [HEALTH, SPEAR, BOMB, FURY];
}

/// What happened (protocol `ArenaEvent`).
pub mod ev {
    /// `a` hit `b` for `n`; `m`: bits (1 blocked, 2 heavy, 4 combo finisher,
    /// 8 thrown, 16 whirlwind, 32 bomb); knocked (`vx`, `vy`).
    pub const HIT: u8 = 1;
    /// `a` parried `b`.
    pub const PARRY: u8 = 2;
    /// `a` broke `b`'s guard.
    pub const GUARD_BREAK: u8 = 3;
    /// `b` slammed into a wall (by `a`'s blow) for `n`.
    pub const WALL_SLAM: u8 = 4;
    /// `b` is down (`a` did it, or 0).
    pub const DOWN: u8 = 5;
    /// `a` swings (`n` the act).
    pub const SWING: u8 = 6;
    /// `a` rolled.
    pub const ROLL: u8 = 7;
    /// A gift (`n` its kind) is on its way to (x, y).
    pub const GIFT_INCOMING: u8 = 8;
    /// `a` picked up a gift (`n` its kind).
    pub const PICKUP: u8 = 10;
    /// `a` threw (`n` the kind) from (x, y) toward `m` (the aim).
    pub const THROW: u8 = 11;
    /// A bomb went off at (x, y) (`a` threw it).
    pub const BOOM: u8 = 12;
    /// Spikes hit `b` for `n`.
    pub const SPIKED: u8 = 14;
    /// Round `n` is about to begin.
    pub const ROUND_START: u8 = 15;
    pub const FIGHT: u8 = 16;
    /// `a` won round `n` (0: nobody standing).
    pub const ROUND_WON: u8 = 17;
    /// `a` is champion.
    pub const CHAMPION: u8 = 18;
    /// `a` unleashed the whirlwind.
    pub const SPECIAL: u8 = 19;
    /// The ring of fire starts closing.
    pub const FIRE: u8 = 20;
    /// A thrown spear stuck in a wall at (x, y) (`a` threw it, `m` its aim).
    pub const STUCK: u8 = 21;
    /// `a`'s rage is full: the whirlwind's ready.
    pub const RAGE_FULL: u8 = 22;
    /// The Goliath (`a`) landed a stomp at (x, y), its shockwave `n`/100 across.
    pub const STOMP: u8 = 23;
    /// The Goliath (`a`) grabbed `b`.
    pub const GRAB: u8 = 24;
    /// The Goliath (`a`) hurled `b` (flying (`vx`, `vy`)).
    pub const HURL: u8 = 25;
}

/// `Fighter::flags` (protocol `ArenaFighter.flags`).
pub mod flag {
    pub const DOWN: u8 = 1;
    pub const FURY: u8 = 2;
    pub const KNOCKED: u8 = 4;
    pub const IFRAMES: u8 = 8;
    pub const QUEUED: u8 = 16;
    /// Out of breath: no rolls or heavy blows till it passes.
    pub const WINDED: u8 = 32;
    /// The Goliath.
    pub const GIANT: u8 = 64;
    /// Dazed by the Goliath's stomp (reeling, stars round their head).
    pub const DAZED: u8 = 128;
}

/// A pillar or a spike plate, in arena tiles.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64, pad: f64) -> bool {
        x > self.x - pad
            && x < self.x + self.w + pad
            && y > self.y - pad
            && y < self.y + self.h + pad
    }
    fn hits(&self, x: f64, y: f64, r: f64) -> bool {
        let nx = x.clamp(self.x, self.x + self.w);
        let ny = y.clamp(self.y, self.y + self.h);
        (x - nx).powi(2) + (y - ny).powi(2) < r * r
    }
}

/// The sand: its size, its pillars and spike plates; in an amphitheatre
/// (`oval`), the rounded square (a superellipse) inside that rectangle.
#[derive(Debug, Clone)]
pub struct Ring {
    pub w: f64,
    pub h: f64,
    pub pillars: Vec<Rect>,
    pub spikes: Vec<Rect>,
    pub oval: bool,
}

impl Ring {
    /// The ring laid out by a map's objects: the `arena` marker's inside
    /// (its walls are its edge tiles), `arena_pillar`s and `arena_spikes`;
    /// oval when it stands in an amphitheatre (an `arena_bowl`). Returns it
    /// and where its corner is (map tiles).
    pub fn from_map(objects: &[crate::map::MapObject]) -> Option<(Ring, (u16, u16))> {
        let a = objects.iter().find(|o| o.kind == "arena")?;
        let (ox, oy) = (a.x + 1, a.y + 1);
        let rect = |o: &crate::map::MapObject| Rect {
            x: o.x as f64 - ox as f64,
            y: o.y as f64 - oy as f64,
            w: o.w as f64,
            h: o.h as f64,
        };
        Some((
            Ring {
                w: a.w.saturating_sub(2) as f64,
                h: a.h.saturating_sub(2) as f64,
                pillars: objects
                    .iter()
                    .filter(|o| o.kind == "arena_pillar")
                    .map(rect)
                    // (A pillar's a tile thick, in the middle of its place: two
                    // wide, so it stands square on the ring's middle line.)
                    .map(|mut r| {
                        if r.w > 1.0 {
                            r.x += (r.w - 1.0) / 2.0;
                            r.w = 1.0;
                        }
                        r
                    })
                    .collect(),
                spikes: objects
                    .iter()
                    .filter(|o| o.kind == "arena_spikes")
                    .map(rect)
                    .collect(),
                oval: objects.iter().any(|o| o.kind == "arena_bowl"),
            },
            (ox, oy),
        ))
    }

    pub fn free(&self, x: f64, y: f64, r: f64) -> bool {
        x >= r
            && y >= r
            && x <= self.w - r
            && y <= self.h - r
            && (!self.oval || self.in_oval(x, y, r))
            && !self.pillars.iter().any(|p| p.hits(x, y, r))
    }

    /// Whether (x, y) is on the sand (inside the wall, rounded or not), give or take `pad`.
    pub fn on_sand(&self, x: f64, y: f64, pad: f64) -> bool {
        x >= -pad
            && y >= -pad
            && x <= self.w + pad
            && y <= self.h + pad
            && (!self.oval || self.in_oval(x, y, -pad))
    }

    /// Whether a body (radius `r`) at (x, y) is inside the rounded wall.
    fn in_oval(&self, x: f64, y: f64, r: f64) -> bool {
        let (cx, cy) = (self.w / 2.0, self.h / 2.0);
        ((x - cx).abs() / (cx - r)).powf(ROUNDNESS) + ((y - cy).abs() / (cy - r)).powf(ROUNDNESS)
            <= 1.0
    }

    /// Moving a body by (dx, dy), sliding along what it runs into; and whether it ran into anything.
    pub fn slide(&self, x: f64, y: f64, dx: f64, dy: f64, r: f64) -> (f64, f64, bool) {
        let n = (dx.hypot(dy) / 0.12).ceil().max(1.0);
        let (sx, sy) = (dx / n, dy / n);
        let (mut x, mut y, mut bumped) = (x, y, false);
        for _ in 0..n as usize {
            if self.free(x + sx, y, r) {
                x += sx;
            } else {
                bumped = true;
            }
            if self.free(x, y + sy, r) {
                y += sy;
            } else {
                bumped = true;
            }
        }
        (x, y, bumped)
    }

    pub fn clear_line(&self, ax: f64, ay: f64, bx: f64, by: f64) -> bool {
        let n = ((bx - ax).hypot(by - ay) / 0.25).ceil().max(1.0) as usize;
        (1..n).all(|i| {
            let t = i as f64 / n as f64;
            !self
                .pillars
                .iter()
                .any(|p| p.contains(ax + (bx - ax) * t, ay + (by - ay) * t, 0.0))
        })
    }

    /// The corners the gladiators start from (in an oval, round it on the diagonals).
    pub fn gate(&self, k: usize) -> (f64, f64) {
        let (l, r, t, b) = if self.oval {
            let (cx, cy) = (self.w / 2.0, self.h / 2.0);
            let (dx, dy) = ((cx - 2.0) * 0.68, (cy - 2.0) * 0.68);
            (cx - dx, cx + dx, cy - dy, cy + dy)
        } else {
            (2.0, self.w - 2.0, 2.0, self.h - 2.0)
        };
        [(l, t), (r, b), (r, t), (l, b)][k % 4]
    }

    /// In an amphitheatre, the gladiators' gate each place comes in by: the
    /// west one for the places that start on the left, the east for the
    /// right (two coming in by one gate a step apart). None in a plain ring.
    pub fn entrance(&self, k: usize) -> Option<(f64, f64)> {
        if !self.oval {
            return None;
        }
        let (start, _) = self.gate(k);
        let x = if start < self.w / 2.0 {
            0.9
        } else {
            self.w - 0.9
        };
        let y = self.h / 2.0 + if k >= 2 { 0.6 } else { -0.6 };
        Some((x, y))
    }

    /// How far out (x, y) is, as a fraction of the ring (1 at its edge, middle
    /// to side; in an amphitheatre, rounded square like its wall).
    pub fn reach(&self, x: f64, y: f64) -> f64 {
        let (cx, cy) = (self.w / 2.0, self.h / 2.0);
        let (u, v) = (((x - cx) / cx).abs(), ((y - cy) / cy).abs());
        if self.oval {
            (u.powf(ROUNDNESS) + v.powf(ROUNDNESS)).powf(1.0 / ROUNDNESS)
        } else {
            (u * u + v * v).sqrt()
        }
    }
}

/// Something thrown: a spear or a bomb.
#[derive(Debug, Clone)]
pub struct Missile {
    pub by: u32,
    pub kind: u8,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub left: f64,
    /// What it does: its damage (before fury), and a bomb's blast.
    pub dmg: f64,
    pub r: f64,
}

/// What a missile did this step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Flight {
    Flying,
    /// Into a wall or pillar (or as far as it goes) at x, y.
    Stopped(f64, f64),
    /// Reached fighter `i` at x, y.
    Hit(usize, f64, f64),
}

impl Missile {
    pub fn new(by: u32, kind: u8, x: f64, y: f64, aim: f64) -> Missile {
        let (speed, left, dmg) = match kind {
            gift::BOMB => (BOMB_SPEED, BOMB_RANGE, BOMB_DMG),
            missile::ARROW => (ARROW_SPEED, ARROW_RANGE, QUICK_ARROW_DMG),
            _ => (SPEAR_SPEED, SPEAR_RANGE, SPEAR_DMG),
        };
        let (c, s) = (aim.cos(), aim.sin());
        Missile {
            by,
            kind,
            x: x + c * 0.5,
            y: y + s * 0.5,
            vx: c * speed,
            vy: s * speed,
            left,
            dmg,
            r: BOMB_R,
        }
    }

    /// Flies on for `dt` seconds, in small steps; `hit` says whether a body is at a point.
    pub fn advance(
        &mut self,
        ring: &Ring,
        dt: f64,
        mut hit: impl FnMut(f64, f64) -> Option<usize>,
    ) -> Flight {
        let speed = self.vx.hypot(self.vy);
        let mut todo = speed * dt;
        while todo > 1e-9 {
            if self.left <= 1e-9 {
                return Flight::Stopped(self.x, self.y);
            }
            let step = todo.min(0.15).min(self.left);
            todo -= step;
            self.left -= step;
            let (nx, ny) = (
                self.x + self.vx / speed * step,
                self.y + self.vy / speed * step,
            );
            if !ring.free(nx, ny, 0.05) {
                return Flight::Stopped(self.x, self.y);
            }
            self.x = nx;
            self.y = ny;
            if let Some(i) = hit(nx, ny) {
                return Flight::Hit(i, nx, ny);
            }
        }
        Flight::Flying
    }
}

/// A gift from the crowd: on its way down, then lying on the sand.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Gift {
    pub kind: u8,
    pub x: f64,
    pub y: f64,
    /// When it lands (and when it's gone).
    pub lands: u32,
    pub gone: u32,
}

/// How a bot fights, by level (`crate::level`). They play like people do:
/// they see a move a human beat after it starts (no faster: nobody dodges a
/// leap the instant it begins), they make up their minds every so often
/// rather than every moment, they read a wind-up long enough to see coming,
/// and they don't all pile in at once: they take turns pressing, wait for
/// an opening, back off to get their breath back, and go for what's worth it.
struct Skill {
    /// Aim drift, at most (radians).
    wobble: f64,
    /// Its chances of rolling from or blocking a blow, scaled.
    defend: f64,
    /// How long after a move begins it sees it and acts (ms: base, plus up
    /// to): a person's reaction, not a machine's.
    react: (f64, f64),
    /// Between one decision and the next (ms: base, plus up to).
    think: (f64, f64),
    /// Its chance of reading a wind-up (the Goliath crouching to leap,
    /// someone charging a heavy blow) and getting out of its way in time.
    read: f64,
    /// Between one flurry and the next (ms: base, plus up to).
    gap: (f64, f64),
    /// Up to this many more slashes in a combo.
    combo: f64,
    /// Its chance of a heavy blow at someone blocking or reeling.
    punish: f64,
    /// Its chance (each think) of a lunging heavy from a little way off.
    lunge: f64,
    /// Of full walking speed.
    speed: f64,
    /// How far ahead it minds the spikes (ms).
    spike_ms: u32,
    /// How far it goes for a gift (tiles).
    gift_r: f64,
    /// Its chance (each think) to throw what it holds.
    throw: f64,
    /// How many of the Goliath's foes press it at once (the rest wait their
    /// moment at its flanks).
    press: usize,
    /// How canny: flanking behind, keeping out of the Goliath's line, saving
    /// a bomb for when it'd break an attack off, catching its breath.
    cunning: f64,
    /// Against the Goliath, between its blows (a share of `gap`): a pack
    /// that took turns at it as often as at one of its own would be too much for it.
    vs_giant: f64,
    /// The Goliath (a bot): between its blows (a share of `gap`).
    giant_gap: f64,
}

const VS_GIANT_EASY: f64 = 0.55;
const VS_GIANT_MEDIUM: f64 = 1.6;
const VS_GIANT_HARD: f64 = 3.0;
const VS_GIANT_EXTREME: f64 = 4.0;

fn skill(level: u8) -> Skill {
    match level {
        crate::level::EASY => Skill {
            wobble: 0.4,
            defend: 0.6,
            react: (340.0, 200.0),
            think: (300.0, 180.0),
            read: 0.25,
            gap: (900.0, 1000.0),
            combo: 1.6,
            punish: 0.2,
            lunge: 0.015,
            speed: 0.78,
            spike_ms: 0,
            gift_r: 3.5,
            throw: 0.12,
            press: 3,
            cunning: 0.1,
            vs_giant: VS_GIANT_EASY,
            giant_gap: 2.4,
        },
        crate::level::HARD => Skill {
            wobble: 0.12,
            defend: 1.3,
            react: (235.0, 120.0),
            think: (160.0, 100.0),
            read: 0.8,
            gap: (380.0, 520.0),
            combo: 3.0,
            punish: 0.85,
            lunge: 0.07,
            speed: 1.0,
            spike_ms: 500,
            gift_r: 8.0,
            throw: 0.6,
            press: 1,
            cunning: 0.8,
            vs_giant: VS_GIANT_HARD,
            giant_gap: 0.9,
        },
        crate::level::EXTREME => Skill {
            wobble: 0.06,
            defend: 1.3,
            react: (225.0, 105.0),
            think: (140.0, 80.0),
            read: 0.88,
            gap: (360.0, 480.0),
            combo: 3.0,
            punish: 0.9,
            lunge: 0.09,
            speed: 1.0,
            spike_ms: 700,
            gift_r: 8.0,
            throw: 0.6,
            press: 1,
            cunning: 1.0,
            vs_giant: VS_GIANT_EXTREME,
            giant_gap: 0.9,
        },
        _ => Skill {
            wobble: 0.3,
            defend: 1.0,
            react: (260.0, 160.0),
            think: (200.0, 140.0),
            read: 0.55,
            gap: (450.0, 700.0),
            combo: 3.0,
            punish: 0.55,
            lunge: 0.04,
            speed: 0.95,
            spike_ms: 300,
            gift_r: 6.0,
            throw: 0.4,
            press: 1,
            cunning: 0.5,
            vs_giant: VS_GIANT_MEDIUM,
            giant_gap: 1.3,
        },
    }
}

/// What a bot means to do about a move it's seen (`Ai::plan`).
const PLAN_NONE: u8 = 0;
const PLAN_BLOCK: u8 = 1;
const PLAN_ROLL: u8 = 2;
const PLAN_SIDESTEP: u8 = 3;
const PLAN_SPIN: u8 = 4;
/// Seen, not yet made its mind up about.
const PLAN_UNDECIDED: u8 = 255;

/// What a bot means to do (`Ai::intent`).
mod intent {
    /// In close, fighting.
    pub const PRESS: u8 = 0;
    /// Waiting its moment a little way off (at the Goliath's flank).
    pub const HOVER: u8 = 1;
    /// Backing off to get its breath back.
    pub const RECOVER: u8 = 2;
}

/// What a bot is up to.
#[derive(Debug, Clone, Default)]
pub struct Ai {
    next_attack: u32,
    /// The move it last saw (whose, and when it began), and when it'll have
    /// taken it in (a human beat after it began).
    seen_swing: (u32, u32),
    noticed_at: u32,
    /// What it chose to do about it (`plan`), and whether it's done it.
    plan: u8,
    plan_at: u32,
    /// Out of a wind-up's line: this way, till then.
    sidestep: f64,
    sidestep_until: u32,
    strafe: f64,
    strafe_until: u32,
    charge_for: u32,
    combo_left: u8,
    wobble: f64,
    /// When it next makes up its mind, whom it's after, and what it means to do.
    think_at: u32,
    target: u32,
    intent: u8,
    /// Its angle round the Goliath (from its back), as one of a pack.
    flank: f64,
    /// A guard put up ahead of a blow it expects (till then).
    guard_until: u32,
    /// Since when the one it's watching has faced it (0: it hasn't), and how long it takes to see that.
    faced_at: u32,
    faced_react: u32,
}

#[derive(Debug, Clone)]
pub struct Fighter {
    pub id: u32,
    pub slot: usize,
    pub bot: bool,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    pub hp: f64,
    pub stamina: f64,
    pub rage: f64,
    pub act: u8,
    pub act_at: u32,
    pub act_until: u32,
    /// A slash asked for during the last one (the next in the combo follows on).
    pub queued: bool,
    /// Whether the current swing's blow has been dealt (each lands once).
    pub struck: bool,
    /// Who the current lunge or whirlwind has already hit (and when).
    pub hit_list: Vec<(u32, u32)>,
    /// Where the current move began (a heavy blow's lunge sweeps from here).
    pub act_from: (f64, f64),
    /// The Goliath, staggered: it can't be again till then.
    pub poise_until: u32,
    /// When the shield went up (for parries).
    pub block_at: u32,
    pub roll_dir: f64,
    pub roll_ready: u32,
    /// How charged the heavy blow under way is (0..1).
    pub charge: f64,
    /// Knocked flying: velocity, until when (the server moves them then),
    /// whether they've slammed into a wall this time, and who did it.
    pub kvx: f64,
    pub kvy: f64,
    pub knocked_until: u32,
    pub slammed: bool,
    pub knocked_by: u32,
    pub down: bool,
    pub holding: u8,
    pub fury_until: u32,
    pub stamina_used: u32,
    /// Out of breath till then (stamina ran right out).
    pub winded_until: u32,
    /// A whirlwind asked for while busy, and when (0: none).
    pub special_at: u32,
    /// The Goliath: a smash or a stomp's charge asked for while it was still
    /// busy (finishing a blow, landing), and when: it goes as soon as it's free.
    pub pending: (u8, u32, f64),
    /// The spike rising that last hit them (once each).
    pub spiked: u32,
    /// Bumped whenever the server puts them somewhere (the client then takes its word).
    pub fix: u8,
    pub moved_at: u32,
    pub vx: f64,
    pub vy: f64,
    pub dealt: f64,
    pub downs: u8,
    pub ai: Ai,
    /// In the countdown, where they're marching to (from their gate).
    pub march: Option<(f64, f64)>,
    /// The Goliath.
    pub giant: bool,
    /// Grabbed by the Goliath (its id), being whirled round: 0 if not.
    pub held_by: u32,
    /// Dazed by a stomp till then.
    pub dazed_until: u32,
    /// Hurled by the Goliath, flying till then; and those they've bowled over on the way.
    pub hurled_until: u32,
    pub hurl_hits: Vec<u32>,
    /// How far off its mouse is (0: unknown): the furthest its stomp will leap; and how far this one will.
    pub reach: f64,
    pub leap: f64,
    pub leapt: f64,
    /// Dashing: where it was last tick (whoever's between there and here is bowled over).
    pub dash_from: (f64, f64),
    /// The Goliath: where it was last tick, and since when it's stood still (resting, it heals).
    pub last_pos: (f64, f64),
    pub still_since: u32,
    /// Its class (`kit`), and its health in full (by it; the Goliath's its own).
    pub kit: u8,
    pub max_hp: f64,
    /// Firing (or casting): how many it's let go so far, and whether it's the quick shot.
    pub shots: u8,
    pub quick: bool,
}

impl Fighter {
    fn new(id: u32, slot: usize, at: (f64, f64), w: f64) -> Fighter {
        Fighter {
            id,
            slot,
            bot: is_bot(id),
            x: at.0,
            y: at.1,
            aim: if at.0 < w / 2.0 { 0.0 } else { PI },
            hp: HP,
            stamina: STAMINA,
            rage: 0.0,
            act: act::NONE,
            act_at: 0,
            act_until: 0,
            queued: false,
            struck: false,
            hit_list: Vec::new(),
            act_from: (0.0, 0.0),
            poise_until: 0,
            block_at: 0,
            roll_dir: 0.0,
            roll_ready: 0,
            charge: 0.0,
            kvx: 0.0,
            kvy: 0.0,
            knocked_until: 0,
            slammed: false,
            knocked_by: 0,
            down: false,
            holding: 0,
            fury_until: 0,
            stamina_used: 0,
            winded_until: 0,
            special_at: 0,
            pending: (0, 0, 0.0),
            spiked: 0,
            fix: 0,
            moved_at: 0,
            vx: 0.0,
            vy: 0.0,
            dealt: 0.0,
            downs: 0,
            ai: Ai::default(),
            march: None,
            giant: false,
            held_by: 0,
            dazed_until: 0,
            hurled_until: 0,
            hurl_hits: Vec::new(),
            reach: 0.0,
            leap: 0.0,
            leapt: 0.0,
            dash_from: (0.0, 0.0),
            last_pos: (0.0, 0.0),
            still_since: 0,
            kit: kit::KNIGHT,
            max_hp: HP,
            shots: 0,
            quick: false,
        }
    }

    /// How long its charged attack takes to fill (the bomber's big bomb, longer).
    pub fn full_ms(&self) -> u32 {
        if self.kit == kit::BOMBER && !self.giant {
            BIG_BOMB_FULL_MS
        } else {
            HEAVY_FULL_MS
        }
    }

    /// How much of a missile's harm it takes.
    pub fn ranged_taken(&self) -> f64 {
        if self.giant {
            1.0
        } else {
            KIT_RANGED_TAKEN[self.k()]
        }
    }

    /// How tall it stands.
    pub fn height(&self) -> f64 {
        if self.giant { GIANT_H } else { BODY_H }
    }

    /// The point of it nearest (x, y): anywhere from its feet up to its head.
    pub fn nearest(&self, _x: f64, y: f64) -> (f64, f64) {
        (self.x, y.clamp(self.y - self.height(), self.y))
    }

    /// How far (x, y) is from it (the nearest of it).
    pub fn reach_to(&self, x: f64, y: f64) -> f64 {
        let (px, py) = self.nearest(x, y);
        (px - x).hypot(py - y)
    }

    /// The archer's arrow, the bomber's bomb, quickly (no charge): the
    /// shot, or (busy) kept for when it's free.
    fn quick_fire(&mut self, aim: f64, now: u32, evs: &mut Vec<Event>) {
        if !self.free(now) {
            self.pending = (input::LIGHT, now, aim);
            return;
        }
        let (cost, (w, r)) = if self.kit == kit::ARCHER {
            (QUICK_ARROW_COST, QUICK_SHOT)
        } else {
            (QUICK_LOB_COST, QUICK_LOB)
        };
        if self.spend(cost, now) {
            self.aim = aim;
            self.charge = 0.0;
            self.set(act::SHOOT, now, w + r);
            self.quick = true;
            evs.push(Event::new(
                ev::SWING,
                self.id,
                0,
                self.x,
                self.y,
                act::SHOOT as u16,
            ));
        }
    }

    /// Its class: its health in full (and now).
    pub fn take_kit(&mut self, k: u8) {
        let k = k.min(kit::COUNT - 1);
        self.kit = k;
        self.max_hp = KIT_HP[k as usize];
        self.hp = self.max_hp;
    }

    fn k(&self) -> usize {
        self.kit as usize
    }

    /// Slash `n` of a combo (wind-up, blow, recovery), at its class's pace.
    pub fn light(&self, n: usize) -> (u32, u32, u32) {
        let (w, a, r) = LIGHT[n];
        let t = KIT_LIGHT_TIME[self.k()];
        let s = |v: u32| (v as f64 * t).round() as u32;
        (s(w), s(a), s(r))
    }

    /// Whether its charged blow's fired (the bow, a bomb), not a lunge.
    pub fn shoots(&self) -> bool {
        !self.giant && matches!(self.kit, kit::ARCHER | kit::BOMBER)
    }

    /// Mid-ultimate (the Goliath whirling someone round, a gladiator's
    /// whirlwind): nothing can hurt them.
    pub fn immune(&self) -> bool {
        (self.giant && self.act == act::GRAB) || self.act == act::SPIN || self.act == act::CAST
    }

    /// How big they are, to bump into walls and be hit.
    pub fn body(&self) -> f64 {
        if self.giant { GIANT_R } else { BODY_R }
    }

    /// Free to start something new.
    pub fn free(&self, now: u32) -> bool {
        !self.down
            && (self.act == act::NONE
                || self.act == act::BLOCK
                || (self.act_until <= now && self.act != act::STUN && self.act != act::CHARGE))
            && now >= self.knocked_until
    }

    pub fn flags(&self, now: u32) -> u8 {
        let mut f = 0;
        if self.down {
            f |= flag::DOWN;
        }
        if now < self.fury_until {
            f |= flag::FURY;
        }
        if now < self.knocked_until {
            f |= flag::KNOCKED;
        }
        if self.act == act::ROLL && now < self.act_at + ROLL_MS - 60 {
            f |= flag::IFRAMES;
        }
        if self.queued {
            f |= flag::QUEUED;
        }
        if now < self.winded_until {
            f |= flag::WINDED;
        }
        if self.giant {
            f |= flag::GIANT;
        }
        if now < self.dazed_until && self.act == act::STUN && !self.down {
            f |= flag::DAZED;
        }
        f
    }

    fn spend(&mut self, cost: f64, now: u32) -> bool {
        // (The tank, in all that armour, tires the quicker.)
        let cost = if self.giant {
            cost
        } else {
            cost * KIT_COST[self.kit as usize]
        };
        if self.stamina < cost * 0.5 {
            return false;
        }
        self.drain(cost, now);
        true
    }

    /// Stamina used up (run right out: winded).
    fn drain(&mut self, cost: f64, now: u32) {
        self.stamina = (self.stamina - cost).max(0.0);
        self.stamina_used = now;
        if self.stamina <= 0.0 && now >= self.winded_until {
            self.winded_until = now + WINDED_MS;
        }
    }

    pub fn winded(&self, now: u32) -> bool {
        now < self.winded_until
    }

    /// Rage gained (full once it's all but there, so "full" means full).
    fn gain_rage(&mut self, amount: f64) {
        self.rage = (self.rage + amount).min(RAGE);
        if self.rage > RAGE - 1.0 {
            self.rage = RAGE;
        }
    }

    /// Its ultimate (rage spent): the whirlwind (a knight's, a spearman's), or its class's own.
    fn ultimate(&mut self, now: u32, evs: &mut Vec<Event>) {
        if matches!(self.kit, kit::ARCHER | kit::BOMBER | kit::TANK) && !self.giant {
            self.rage = 0.0;
            self.queued = false;
            self.special_at = 0;
            let waves = if self.kit == kit::ARCHER {
                VOLLEY_GAP_MS * (VOLLEY_WAVES as u32 - 1)
            } else {
                0
            };
            self.set(act::CAST, now, CAST.0 + waves + CAST.1);
            evs.push(Event::new(
                ev::SPECIAL,
                self.id,
                0,
                self.x,
                self.y,
                self.kit as u16,
            ));
            return;
        }
        self.whirl(now, evs);
    }

    /// Into the whirlwind (rage spent).
    fn whirl(&mut self, now: u32, evs: &mut Vec<Event>) {
        self.rage = 0.0;
        self.queued = false;
        self.special_at = 0;
        self.set(act::SPIN, now, SPIN_MS);
        evs.push(Event::new(ev::SPECIAL, self.id, 0, self.x, self.y, 0));
    }

    /// Free to roll or whirl: free, or in the tail of a slash, or charging (both cut short).
    pub fn can_cancel(&self, now: u32) -> bool {
        if self.down || now < self.knocked_until {
            return false;
        }
        if self.free(now) || self.act == act::CHARGE {
            return true;
        }
        match self.act {
            act::LIGHT1 | act::LIGHT2 | act::LIGHT3 => {
                let (w, a, _) = self.light((self.act - act::LIGHT1) as usize);
                now >= self.act_at + w + a
            }
            _ => false,
        }
    }

    fn set(&mut self, a: u8, now: u32, len: u32) {
        self.act = a;
        self.act_at = now;
        self.act_until = now.saturating_add(len);
        self.struck = false;
        self.hit_list.clear();
        self.act_from = (self.x, self.y);
        self.shots = 0;
        self.quick = false;
    }

    fn fury(&self, now: u32) -> f64 {
        if now < self.fury_until { 1.5 } else { 1.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Event {
    pub kind: u8,
    pub a: u32,
    pub b: u32,
    pub x: f64,
    pub y: f64,
    pub n: u16,
    pub m: u16,
    pub vx: f64,
    pub vy: f64,
}

impl Event {
    fn new(kind: u8, a: u32, b: u32, x: f64, y: f64, n: u16) -> Event {
        Event {
            kind,
            a,
            b,
            x,
            y,
            n,
            m: 0,
            vx: 0.0,
            vy: 0.0,
        }
    }
}

pub fn is_bot(id: u32) -> bool {
    (BOT_BASE..BOT_BASE + SLOTS as u32).contains(&id)
}

/// Angles on the wire: a fraction of a full turn.
pub fn aim_to_u16(a: f64) -> u16 {
    ((a.rem_euclid(TAU) / TAU) * 65536.0).round() as u32 as u16
}
pub fn aim_from_u16(v: u16) -> f64 {
    v as f64 / 65536.0 * TAU
}

/// The turn from angle `a` to `b`, -π..π.
/// A heavy blow's damage and knock, the more for its charge (and fury).
fn heavy_blow(f: &Fighter, now: u32) -> (f64, f64) {
    let k = f.kit as usize;
    (
        (20.0 + 18.0 * f.charge) * KIT_HEAVY_DMG[k] * f.fury(now),
        7.0 + 6.0 * f.charge,
    )
}

fn turn(a: f64, b: f64) -> f64 {
    (b - a + PI).rem_euclid(TAU) - PI
}

#[derive(Debug, Clone)]
pub struct Match {
    pub ring: Ring,
    pub status: u8,
    pub phase_end: u32,
    pub round: u8,
    pub round_at: u32,
    /// Who has which place (0: free; bots are `BOT_BASE + place`), and their crowns.
    pub slots: [u32; SLOTS],
    pub crowns: [u8; SLOTS],
    pub fighters: Vec<Fighter>,
    pub missiles: Vec<Missile>,
    pub gifts: Vec<Gift>,
    pub next_gift: u32,
    /// The round's (and in the end the match's) winner: a player id, or 0.
    pub winner: u32,
    /// How good the bots are (`crate::level`), picked in the lobby.
    pub level: u8,
    fire_announced: bool,
    /// Classic, or the Goliath against the rest (`mode`), and which place
    /// is the Goliath's.
    pub mode: u8,
    pub goliath: usize,
    /// Classes on (picked in the lobby): each round begins with a choice of
    /// class, till `choose_end`; each place's pick (`kit`, with
    /// `kit::PICKED` once picked this round).
    pub kits: bool,
    pub choose_end: u32,
    pub picks: [u8; SLOTS],
    /// The bots' own match, put on while nobody's playing (for anyone
    /// to watch); called off the moment someone comes to play.
    pub exhibition: bool,
    /// The wheel of classes (with classes on): at the match's start it
    /// spins for everyone, and each keeps what it gave them all match.
    pub wheel: bool,
}

impl Match {
    pub fn new(ring: Ring) -> Match {
        Match {
            ring,
            status: LOBBY,
            phase_end: 0,
            round: 0,
            round_at: 0,
            slots: [0; SLOTS],
            crowns: [0; SLOTS],
            fighters: Vec::new(),
            missiles: Vec::new(),
            gifts: Vec::new(),
            next_gift: 0,
            winner: 0,
            level: crate::level::MEDIUM,
            fire_announced: false,
            mode: mode::CLASSIC,
            goliath: 0,
            kits: false,
            choose_end: 0,
            picks: [0; SLOTS],
            exhibition: false,
            wheel: false,
        }
    }

    /// In the lobby, someone with a place turns the wheel of classes on or
    /// off. Returns whether it changed.
    pub fn set_wheel(&mut self, by: u32, on: bool) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || self.wheel == on {
            return false;
        }
        self.wheel = on;
        true
    }

    /// Nobody's playing: the bots put on a match of their own (a duel, a
    /// brawl or the Goliath; classes or not; good bots). False if anyone has
    /// a place, or a match is on.
    pub fn exhibit(&mut self, now: u32, rng: &mut impl FnMut() -> f64) -> bool {
        if self.status != LOBBY || self.slots.iter().any(|&s| s != 0) {
            return false;
        }
        let n = if rng() < 0.3 { 2 } else { SLOTS };
        for s in 0..n {
            self.slots[s] = BOT_BASE + s as u32;
        }
        self.mode = if n == SLOTS && rng() < 0.25 {
            mode::GOLIATH
        } else {
            mode::CLASSIC
        };
        self.goliath = (rng() * n as f64) as usize % n;
        self.kits = rng() < 0.65;
        self.wheel = self.kits && rng() < 0.4;
        self.level = if rng() < 0.5 {
            crate::level::HARD
        } else {
            crate::level::EXTREME
        };
        self.exhibition = true;
        self.begin_match(now);
        true
    }

    /// The bots' match called off (someone's come to play): back to an
    /// empty lobby. False if there wasn't one.
    pub fn call_off(&mut self) -> bool {
        if !self.exhibition {
            return false;
        }
        self.slots = [0; SLOTS];
        self.back_to_lobby();
        true
    }

    /// In the lobby, someone with a place turns classes on or off. Returns
    /// whether it changed.
    pub fn set_kits(&mut self, by: u32, on: bool) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || self.kits == on {
            return false;
        }
        self.kits = on;
        true
    }

    /// Whether the round's still picking classes.
    pub fn choosing(&self, now: u32) -> bool {
        self.kits && self.status == COUNTDOWN && now < self.choose_end
    }

    /// `id` picks a class for the round (classes on, while they're chosen;
    /// not the Goliath). Once everyone has, the countdown begins. Returns
    /// whether it took.
    pub fn choose_kit(&mut self, id: u32, k: u8, now: u32) -> bool {
        // (With the wheel, it chooses.)
        if !self.choosing(now) || k >= kit::COUNT || self.wheel {
            return false;
        }
        let Some(i) = self.index(id) else {
            return false;
        };
        if self.fighters[i].giant {
            return false;
        }
        let slot = self.fighters[i].slot;
        self.picks[slot] = k | kit::PICKED;
        self.fighters[i].take_kit(k);
        // Everyone's picked: on with it.
        if self
            .fighters
            .iter()
            .all(|f| f.giant || self.picks[f.slot] & kit::PICKED != 0)
        {
            self.choose_end = now;
            self.phase_end = now + COUNTDOWN_MS;
            for f in self.fighters.iter_mut() {
                f.ai.next_attack = now + COUNTDOWN_MS + 400;
            }
        }
        true
    }

    pub fn slot_of(&self, id: u32) -> Option<usize> {
        self.slots.iter().position(|&s| s == id && id != 0)
    }

    pub fn fighter(&self, id: u32) -> Option<&Fighter> {
        self.fighters.iter().find(|f| f.id == id)
    }

    fn index(&self, id: u32) -> Option<usize> {
        self.fighters.iter().position(|f| f.id == id)
    }

    pub fn running(&self) -> bool {
        matches!(self.status, COUNTDOWN | FIGHTING | ROUND_END)
    }

    /// Whether `id` is in a match now (on the sand: they don't walk about).
    pub fn playing(&self, id: u32) -> bool {
        (self.running() || self.status == OVER) && self.index(id).is_some()
    }

    /// Where each fighter's parade ends (arena tiles): the champion at the
    /// foot of the carpet, the others in a line behind (most crowns first).
    pub fn parade_end(&self) -> Vec<(u32, f64, f64)> {
        let x = self.ring.w / 2.0;
        let y = self.ring.h + PARADE_END;
        let mut rest: Vec<&Fighter> = self
            .fighters
            .iter()
            .filter(|f| f.id != self.winner)
            .collect();
        rest.sort_by_key(|f| (std::cmp::Reverse(self.crowns[f.slot]), f.slot));
        let mut out = Vec::new();
        if self.winner != 0 {
            out.push((self.winner, x, y));
        }
        for (k, f) in rest.iter().enumerate() {
            let side = if k % 2 == 0 { -0.55 } else { 0.55 };
            out.push((f.id, x + side, y - PARADE_FIRST_GAP - PARADE_GAP * k as f64));
        }
        out
    }

    pub fn humans(&self) -> usize {
        self.slots.iter().filter(|&&s| s != 0 && !is_bot(s)).count()
    }

    /// How far the ring of fire has closed: 1.15 (not at all) … `FIRE_MIN`.
    pub fn fire(&self, now: u32) -> f64 {
        if self.status != FIGHTING || now < self.round_at + FIRE_AFTER_MS {
            return 1.15;
        }
        let t = (now - self.round_at - FIRE_AFTER_MS) as f64 / FIRE_CLOSE_MS as f64;
        1.15 - (1.15 - FIRE_MIN) * t.min(1.0)
    }

    /// Spike plate `k` now: 0 down, 1 rattling (about to rise), 2 up; and which rising it is.
    pub fn spike_phase(&self, k: usize, now: u32) -> (u8, u32) {
        if self.status != FIGHTING {
            return (0, 0);
        }
        let n = self.ring.spikes.len().max(1) as u32;
        let t = now.saturating_sub(self.round_at) + 2000 + (k as u32) * (SPIKE_CYCLE_MS / n);
        let cycle = t / SPIKE_CYCLE_MS;
        let into = t % SPIKE_CYCLE_MS;
        let up_at = SPIKE_CYCLE_MS - SPIKE_UP_MS;
        let phase = if into >= up_at {
            2
        } else if into >= up_at - SPIKE_WARN_MS {
            1
        } else {
            0
        };
        (phase, cycle * 16 + k as u32 + 1)
    }

    /// `id` takes a place: a free one, or a bot's (the bot steps aside). The
    /// first to sign up in the lobby gets bots in all the other places (to
    /// take out, or put back, with `set_bot`).
    pub fn join(&mut self, id: u32, now: u32) -> bool {
        if self.slot_of(id).is_some() {
            return true;
        }
        // (The bots were only filling in: off they go.)
        self.call_off();
        let s = if self.running() {
            (0..SLOTS)
                .find(|&k| is_bot(self.slots[k]))
                .or_else(|| (0..SLOTS).find(|&k| self.slots[k] == 0))
        } else {
            (0..SLOTS)
                .find(|&k| self.slots[k] == 0)
                .or_else(|| (0..SLOTS).find(|&k| is_bot(self.slots[k])))
        };
        let Some(s) = s else { return false };
        let old = self.slots[s];
        self.slots[s] = id;
        if !self.running() && self.humans() == 1 {
            for k in 0..SLOTS {
                if self.slots[k] == 0 {
                    self.slots[k] = BOT_BASE + k as u32;
                }
            }
        }
        if self.running() {
            if let Some(i) = self.index(old) {
                // Into the bot's sandals: where it stood, as hurt as it was.
                let b = &mut self.fighters[i];
                b.id = id;
                b.bot = false;
                b.ai = Ai::default();
                b.moved_at = now;
                b.fix = b.fix.wrapping_add(1);
                if !b.down {
                    b.act = act::NONE;
                }
            } else {
                // Arriving into an empty place mid-round: in from the next one.
                let mut f = Fighter::new(id, s, self.ring.gate(s), self.ring.w);
                if self.status == FIGHTING {
                    f.down = true;
                    f.hp = 0.0;
                    f.act = act::DOWN;
                }
                self.fighters.push(f);
            }
        }
        true
    }

    /// In the lobby, someone with a place puts a bot in place `slot` (`on`) or
    /// takes it out. Returns whether anything changed.
    pub fn set_bot(&mut self, by: u32, slot: usize, on: bool) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || slot >= SLOTS {
            return false;
        }
        match (on, self.slots[slot]) {
            (true, 0) => self.slots[slot] = BOT_BASE + slot as u32,
            (false, s) if is_bot(s) => self.slots[slot] = 0,
            _ => return false,
        }
        true
    }

    /// In the lobby, someone with a place picks how good the bots are.
    /// Returns whether it changed.
    pub fn set_level(&mut self, by: u32, level: u8) -> bool {
        let level = crate::level::clamp(level);
        if self.status != LOBBY || self.slot_of(by).is_none() || self.level == level {
            return false;
        }
        self.level = level;
        true
    }

    /// In the lobby, someone with a place picks the kind of match, and (in
    /// Goliath mode) whose place is the Goliath's. Returns whether it changed.
    pub fn set_mode(&mut self, by: u32, m: u8, goliath: usize) -> bool {
        let m = if m == mode::GOLIATH {
            mode::GOLIATH
        } else {
            mode::CLASSIC
        };
        if self.status != LOBBY || self.slot_of(by).is_none() || goliath >= SLOTS {
            return false;
        }
        if (self.mode, self.goliath) == (m, goliath) {
            return false;
        }
        self.mode = m;
        self.goliath = goliath;
        true
    }

    /// Whether `i` and `j` are on opposite sides (everyone is, but in Goliath mode).
    fn foes(&self, i: usize, j: usize) -> bool {
        self.mode != mode::GOLIATH || self.fighters[i].giant != self.fighters[j].giant
    }

    /// In Goliath mode, which of the gladiators place `slot` is (0, 1, 2), by place.
    fn gladiator_index(&self, slot: usize) -> usize {
        (0..slot)
            .filter(|&s| s != self.goliath && self.slots[s] != 0)
            .count()
    }

    /// Where place `slot` starts a round: classic, round the ring; in Goliath
    /// mode, the Goliath on the east side, the gladiators on the west.
    fn place(&self, slot: usize) -> (f64, f64) {
        if self.mode != mode::GOLIATH {
            return self.ring.gate(slot);
        }
        let (w, h) = (self.ring.w, self.ring.h);
        // (Each the first of its spots that's open: clear of the pillars.)
        let open = |spots: &[(f64, f64)], r: f64| {
            spots
                .iter()
                .copied()
                .find(|&(x, y)| self.ring.free(x, y, r + 0.1))
                .unwrap_or(spots[0])
        };
        if slot == self.goliath {
            return open(
                &[(w - 5.5, h / 2.0), (w - 3.2, h / 2.0), (w - 2.0, h / 2.0)],
                GIANT_R,
            );
        }
        let k = self.gladiator_index(slot).min(2) as f64;
        let dy = (k - 1.0) * 3.2;
        open(
            &[
                (5.5 - (1.0 - (k - 1.0).abs()), h / 2.0 + dy),
                (3.0, h / 2.0 + dy),
                (2.0, h / 2.0 + dy * 0.7),
            ],
            BODY_R,
        )
    }

    /// The gate place `slot` comes in by (in an amphitheatre): in Goliath
    /// mode, the Goliath by the east gate and the gladiators by the west.
    fn door(&self, slot: usize) -> Option<(f64, f64)> {
        if self.mode != mode::GOLIATH {
            return self.ring.entrance(slot);
        }
        if !self.ring.oval {
            return None;
        }
        let (w, h) = (self.ring.w, self.ring.h);
        if slot == self.goliath {
            return Some((w - 1.0, h / 2.0));
        }
        Some((
            0.9,
            h / 2.0 + (self.gladiator_index(slot) as f64 - 1.0) * 0.7,
        ))
    }

    /// A fighter for place `slot`, at `at`: the Goliath, if it's theirs.
    fn make(&self, id: u32, slot: usize, at: (f64, f64)) -> Fighter {
        let mut f = Fighter::new(id, slot, at, self.ring.w);
        if self.mode == mode::GOLIATH && slot == self.goliath {
            f.giant = true;
            f.hp = GIANT_HP;
            f.max_hp = GIANT_HP;
        } else if self.kits {
            f.take_kit(self.picks[slot] & !kit::PICKED);
        }
        f
    }

    /// `id` leaves: mid-match, a bot takes their place (or, with nobody left, it's called off).
    pub fn leave(&mut self, id: u32) {
        let Some(s) = self.slot_of(id) else { return };
        self.slots[s] = 0;
        if !self.running() {
            // Nobody left in the lobby: the bots go too (and the level's back to medium).
            if self.humans() == 0 {
                for s in self.slots.iter_mut() {
                    if is_bot(*s) {
                        *s = 0;
                    }
                }
                self.level = crate::level::MEDIUM;
                self.mode = mode::CLASSIC;
            }
            return;
        }
        if self.humans() == 0 {
            self.back_to_lobby();
            return;
        }
        let bot = BOT_BASE + s as u32;
        self.slots[s] = bot;
        if let Some(i) = self.index(id) {
            let f = &mut self.fighters[i];
            f.id = bot;
            f.bot = true;
            f.ai = Ai::default();
            if !f.down {
                f.act = act::NONE;
            }
        }
    }

    /// Back to the lobby: the same places (bots and all) for another, unless nobody's left.
    fn back_to_lobby(&mut self) {
        self.status = LOBBY;
        if self.exhibition {
            // (The lobby as it was: empty, the usual settings.)
            self.exhibition = false;
            self.slots = [0; SLOTS];
            self.mode = mode::CLASSIC;
            self.kits = false;
            self.wheel = false;
            self.level = crate::level::MEDIUM;
        }
        self.fighters.clear();
        self.missiles.clear();
        self.gifts.clear();
        self.round = 0;
        self.crowns = [0; SLOTS];
        if self.humans() == 0 {
            for s in self.slots.iter_mut() {
                if is_bot(*s) {
                    *s = 0;
                }
            }
        }
    }

    /// The match begins, with whoever (and whichever bots) have the places;
    /// with `bots`, any empty places filled with bots too. Two at least.
    pub fn start(&mut self, by: u32, bots: bool, now: u32) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() {
            return false;
        }
        if bots {
            for s in 0..SLOTS {
                if self.slots[s] == 0 {
                    self.slots[s] = BOT_BASE + s as u32;
                }
            }
        }
        if self.slots.iter().filter(|&&s| s != 0).count() < 2 {
            return false;
        }
        // Goliath mode: someone to be the Goliath.
        if self.mode == mode::GOLIATH && self.slots[self.goliath] == 0 {
            return false;
        }
        self.begin_match(now);
        true
    }

    fn begin_match(&mut self, now: u32) {
        self.crowns = [0; SLOTS];
        self.round = 0;
        self.fighters = (0..SLOTS)
            .filter(|&s| self.slots[s] != 0)
            .map(|s| self.make(self.slots[s], s, self.place(s)))
            .collect();
        self.begin_round(now);
    }

    fn begin_round(&mut self, now: u32) {
        self.round += 1;
        self.status = COUNTDOWN;
        // With classes on: a while to pick one first (the bots pick at once,
        // and the Goliath's the Goliath); each keeps last round's meanwhile.
        let spin = self.kits && self.wheel;
        let choose = match (self.kits, spin) {
            (false, _) => 0,
            (true, false) => CHOOSE_MS,
            // The wheel: it spins at the start; after, everyone keeps theirs.
            (true, true) if self.round == 1 => WHEEL_MS,
            (true, true) => 0,
        };
        self.choose_end = now + choose;
        self.phase_end = now + choose + COUNTDOWN_MS;
        for s in 0..SLOTS {
            if spin {
                let giant = self.mode == mode::GOLIATH && s == self.goliath;
                self.picks[s] = if giant {
                    kit::PICKED
                } else if self.round == 1 {
                    // (Where the wheel stops: anyone's guess.)
                    let mut h =
                        now.wrapping_mul(2_654_435_761) ^ (s as u32 + 1).wrapping_mul(0x9e37_79b9);
                    h ^= h >> 15;
                    h = h.wrapping_mul(0x85eb_ca6b);
                    h ^= h >> 13;
                    (h % kit::COUNT as u32) as u8 | kit::PICKED
                } else {
                    self.picks[s] | kit::PICKED
                };
                continue;
            }
            let k = self.picks[s] & !kit::PICKED;
            self.picks[s] = if !self.kits {
                0
            } else if self.mode == mode::GOLIATH && s == self.goliath {
                kit::PICKED
            } else if is_bot(self.slots[s]) {
                // (A bot's pick: a mix, round by round.)
                let h = (s as u32 * 7 + self.round as u32 * 3 + now / 997) % kit::COUNT as u32;
                h as u8 | kit::PICKED
            } else {
                k
            };
        }
        self.missiles.clear();
        self.gifts.clear();
        self.winner = 0;
        self.fire_announced = false;
        let fresh: Vec<Fighter> = self
            .fighters
            .iter()
            .map(|f| {
                // In an amphitheatre, in by their gate, marching out to their place in the countdown.
                let mut n = match self.door(f.slot) {
                    Some(door) => {
                        let mut n = self.make(f.id, f.slot, door);
                        n.march = Some(self.place(f.slot));
                        n
                    }
                    None => self.make(f.id, f.slot, self.place(f.slot)),
                };
                n.fix = f.fix.wrapping_add(1);
                n.bot = f.bot;
                n.dealt = f.dealt;
                n.downs = f.downs;
                n.moved_at = now;
                n.ai.next_attack = now + choose + COUNTDOWN_MS + 400;
                n
            })
            .collect();
        self.fighters = fresh;
        // (Nobody left to pick: straight on. Not while the wheel spins.)
        if self.kits
            && !(self.wheel && self.round == 1)
            && self
                .fighters
                .iter()
                .all(|f| f.giant || self.picks[f.slot] & kit::PICKED != 0)
        {
            self.choose_end = now;
            self.phase_end = now + COUNTDOWN_MS;
        }
    }

    /// The client says where it is (and aims): taken if it could have got
    /// there (rolls and lunges included), else as far as it could (and
    /// it's told). Not while knocked flying or reeling: then the server has them.
    pub fn claim_move(&mut self, id: u32, x: f64, y: f64, aim: f64, now: u32) -> Vec<Event> {
        let mut evs = Vec::new();
        let Some(i) = self.index(id) else { return evs };
        let ring = &self.ring;
        let f = &mut self.fighters[i];
        if f.down || self.status != FIGHTING {
            return evs;
        }
        let from = (f.x, f.y);
        if !matches!(f.act, act::ROLL | act::STUN | act::HEAVY | act::SPIN) {
            f.aim = aim;
        }
        if now < f.knocked_until || matches!(f.act, act::STUN | act::STOMP | act::HELD) {
            f.moved_at = now;
            return evs;
        }
        // (At least 50 ms: moves that reach us in the same tick are still fair.)
        let dt = now.saturating_sub(f.moved_at).clamp(50, 500) as f64 / 1000.0;
        let fast = matches!(f.act, act::ROLL | act::HEAVY)
            || now < f.roll_ready.saturating_sub(ROLL_CD_MS) + 250;
        let speed = if fast && f.giant {
            GIANT_DASH_DIST / (GIANT_DASH_MS as f64 / 1000.0)
        } else if f.act == act::HEAVY {
            // (A full lunge covers ground fast.)
            KIT_LUNGE_MAX[f.k()] / (HEAVY.1 as f64 / 1000.0)
        } else if fast {
            10.0
        } else if f.giant {
            SPEED * GIANT_SPEED
        } else {
            SPEED * KIT_SPEED[f.k()]
        };
        let allowed = speed * dt * 1.4 + 0.4;
        let (dx, dy) = (x - f.x, y - f.y);
        let d = dx.hypot(dy);
        let body = f.body();
        if d <= allowed && ring.free(x, y, body - 0.06) {
            f.vx = dx / dt;
            f.vy = dy / dt;
            f.x = x;
            f.y = y;
        } else {
            let k = (allowed / d.max(1e-9)).min(1.0);
            let (nx, ny, _) = ring.slide(f.x, f.y, dx * k, dy * k, body);
            f.x = nx;
            f.y = ny;
            f.fix = f.fix.wrapping_add(1);
        }
        f.moved_at = now;
        // A heavy blow's lunge, as it goes: whoever it passes through or
        // touches on the way is struck (unless they block it), however
        // the moves happen to fall between the ticks.
        let f = &self.fighters[i];
        if f.act == act::HEAVY && now >= f.act_at + HEAVY.0 {
            let (dmg, kb) = heavy_blow(f, now);
            let to = (f.x, f.y);
            self.sweep(i, from, to, HEAVY_SWEEP, dmg, kb, 2, 520, now, &mut evs);
        }
        evs
    }

    /// How far off their mouse is (tiles; 0: unknown), told with each move
    /// they ask for: the Goliath's stomp leaps no further.
    pub fn reach(&mut self, id: u32, reach: f64) {
        if let Some(i) = self.index(id) {
            self.fighters[i].reach = reach.max(0.0);
        }
    }

    /// A move asked for: a slash, charging and loosing a heavy blow, the
    /// shield up or down, a roll, a throw, the whirlwind.
    pub fn input(&mut self, id: u32, what: u8, aim: f64, now: u32) -> Vec<Event> {
        let mut evs = Vec::new();
        let Some(i) = self.index(id) else { return evs };
        if self.status != FIGHTING {
            return evs;
        }
        {
            let g = &self.fighters[i];
            // (Reeling or rocked, its presses wait for it rather than going astray.)
            if g.giant
                && !g.down
                && let Some(evs) = self.giant_input(i, what, aim, now)
            {
                return evs;
            }
        }
        let f = &mut self.fighters[i];
        if f.down || now < f.knocked_until || f.act == act::STUN {
            if what == input::BLOCK_OFF && f.act == act::BLOCK {
                f.act = act::NONE;
            }
            if what == input::SPECIAL && !f.down && f.rage >= RAGE {
                f.special_at = now.max(1);
            }
            // (A blow asked for now waits for them, rather than going astray.)
            if !f.down {
                match what {
                    input::LIGHT | input::HEAVY_START => f.pending = (what, now, aim),
                    input::HEAVY_RELEASE if f.pending.0 == input::HEAVY_START => {
                        f.pending = (input::LIGHT, now, aim);
                    }
                    _ => {}
                }
            }
            return evs;
        }
        match what {
            input::LIGHT if f.shoots() => f.quick_fire(aim, now, &mut evs),
            input::LIGHT => {
                if matches!(f.act, act::LIGHT1 | act::LIGHT2) {
                    // Mid-combo: the next slash follows on.
                    f.queued = true;
                } else if f.free(now) {
                    if f.spend(LIGHT_COST, now) {
                        f.aim = aim;
                        let (w, a, r) = f.light(0);
                        f.set(act::LIGHT1, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::LIGHT1 as u16));
                    }
                } else {
                    // Still finishing a blow (a combo's last, a heavy one, a
                    // throw, a roll): it follows on as soon as they're free.
                    f.pending = (input::LIGHT, now, aim);
                }
            }
            input::HEAVY_START => {
                if f.free(now) {
                    f.pending = (0, 0, 0.0);
                    f.aim = aim;
                    f.set(act::CHARGE, now, u32::MAX - now);
                } else {
                    f.pending = (input::HEAVY_START, now, aim);
                }
            }
            input::HEAVY_RELEASE => {
                if f.act != act::CHARGE && f.pending.0 == input::HEAVY_START {
                    // Let go before they were ever free to charge: a slash, then.
                    f.pending = (input::LIGHT, now, aim);
                }
                if f.act == act::CHARGE {
                    let held = now.saturating_sub(f.act_at);
                    f.aim = aim;
                    if held < HEAVY_MIN_MS && f.shoots() {
                        // Let go too soon: the quick shot.
                        f.act = act::NONE;
                        f.act_until = now;
                        f.quick_fire(aim, now, &mut evs);
                    } else if held < HEAVY_MIN_MS {
                        // Let go too soon: just a slash.
                        if f.spend(LIGHT_COST, now) {
                            let (w, a, r) = f.light(0);
                            f.set(act::LIGHT1, now, w + a + r);
                            evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::LIGHT1 as u16));
                        } else {
                            f.act = act::NONE;
                        }
                    } else if f.shoots() && !f.winded(now) && {
                        let c = ((held - HEAVY_MIN_MS) as f64
                            / (f.full_ms() - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        let cost = if f.kit == kit::ARCHER {
                            BURST_COST
                        } else {
                            BIG_BOMB_COST.0 + (BIG_BOMB_COST.1 - BIG_BOMB_COST.0) * c
                        };
                        f.spend(cost, now)
                    } {
                        // The bow's three arrows, or a big bomb lobbed.
                        f.charge = ((held - HEAVY_MIN_MS) as f64
                            / (f.full_ms() - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        let more = if f.kit == kit::ARCHER {
                            BURST_GAP_MS * (BURST_ARROWS as u32 - 1)
                        } else {
                            0
                        };
                        f.set(act::SHOOT, now, SHOOT.0 + more + SHOOT.1);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::SHOOT as u16));
                    } else if f.kit == kit::TANK
                        && !f.giant
                        && !f.winded(now)
                        && f.spend(HEAVY_COST, now)
                    {
                        // The tank's stomp: a hop, as far as the charge and the
                        // mouse allow, and a shockwave where it lands.
                        f.charge = ((held - HEAVY_MIN_MS) as f64
                            / (HEAVY_FULL_MS - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        f.leap = TANK_LEAP_MIN + (TANK_LEAP - TANK_LEAP_MIN) * f.charge;
                        f.leapt = 0.0;
                        if f.reach > 0.0 {
                            f.leap = f.leap.min(f.reach.max(TANK_LEAP_MIN));
                        }
                        let (w, a, r) = STOMP;
                        f.set(act::STOMP, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::STOMP as u16));
                    } else if !f.shoots()
                        && f.kit != kit::TANK
                        && !f.winded(now)
                        && f.spend(HEAVY_COST * KIT_HEAVY_COST[f.k()], now)
                    {
                        f.charge = ((held - HEAVY_MIN_MS) as f64
                            / (HEAVY_FULL_MS - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        let (w, a, r) = HEAVY;
                        f.set(act::HEAVY, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::HEAVY as u16));
                    } else {
                        f.act = act::NONE;
                    }
                }
            }
            input::BLOCK_ON => {
                if f.free(now) && f.act != act::BLOCK {
                    f.act = act::BLOCK;
                    f.act_at = now;
                    f.block_at = now;
                    f.act_until = u32::MAX;
                }
            }
            input::BLOCK_OFF => {
                if f.act == act::BLOCK {
                    f.act = act::NONE;
                    f.act_until = now;
                }
            }
            input::ROLL => {
                if f.can_cancel(now)
                    && now >= f.roll_ready
                    && !f.winded(now)
                    && f.spend(ROLL_COST, now)
                {
                    f.queued = false;
                    f.roll_dir = aim;
                    f.set(act::ROLL, now, ROLL_MS);
                    f.roll_ready = now + ROLL_MS + ROLL_CD_MS;
                    evs.push(Event::new(ev::ROLL, f.id, 0, f.x, f.y, 0));
                }
            }
            input::THROW => {
                if f.holding != 0 && f.free(now) {
                    f.aim = aim;
                    f.set(act::THROW, now, THROW.0 + THROW.1);
                }
            }
            input::SPECIAL if f.rage >= RAGE => {
                if f.can_cancel(now) {
                    f.ultimate(now, &mut evs);
                } else {
                    // Busy: it goes off the moment they're free.
                    f.special_at = now.max(1);
                }
            }
            _ => {}
        }
        evs
    }

    /// A tick: the round's phases, the bots, every swing's blow, knockback,
    /// missiles, spikes, gifts, the fire, and who's still standing.
    pub fn step(&mut self, now: u32, dt_ms: u32, rng: &mut impl FnMut() -> f64) -> Vec<Event> {
        let mut evs = Vec::new();
        match self.status {
            COUNTDOWN if now >= self.phase_end => {
                self.status = FIGHTING;
                self.round_at = now;
                self.next_gift = now + 3300 + (rng() * GIFT_JITTER_MS as f64) as u32;
                for f in self.fighters.iter_mut() {
                    f.moved_at = now;
                    // (Anyone still on their way: there now.)
                    if let Some((x, y)) = f.march.take() {
                        f.x = x;
                        f.y = y;
                        f.vx = 0.0;
                        f.vy = 0.0;
                        f.fix = f.fix.wrapping_add(1);
                    }
                }
                evs.push(Event::new(ev::FIGHT, 0, 0, 0.0, 0.0, self.round as u16));
            }
            ROUND_END if now >= self.phase_end => {
                self.begin_round(now);
                evs.push(Event::new(
                    ev::ROUND_START,
                    0,
                    0,
                    0.0,
                    0.0,
                    self.round as u16,
                ));
            }
            OVER if now >= self.phase_end => self.back_to_lobby(),
            _ => {}
        }
        if self.status == COUNTDOWN && now >= self.choose_end {
            self.march(dt_ms as f64 / 1000.0);
        }
        if self.status != FIGHTING {
            return evs;
        }
        let dt = dt_ms as f64 / 1000.0;
        for i in 0..self.fighters.len() {
            if self.fighters[i].bot {
                let more = self.bot(i, now, dt, rng);
                evs.extend(more);
            }
        }
        for i in 0..self.fighters.len() {
            self.tick_fighter(i, now, dt, &mut evs);
        }
        self.hurled(now, &mut evs);
        self.fly(now, dt, &mut evs);
        self.spikes(now, &mut evs);
        self.gifts(now, rng, &mut evs);
        // The fire.
        let fire = self.fire(now);
        if fire < 1.15 && !self.fire_announced {
            self.fire_announced = true;
            evs.push(Event::new(ev::FIRE, 0, 0, 0.0, 0.0, 0));
        }
        for i in 0..self.fighters.len() {
            let f = &self.fighters[i];
            // (Up in the Goliath's grip, they're clear of the fire.)
            if !f.down && !f.immune() && f.act != act::HELD && self.ring.reach(f.x, f.y) > fire {
                // (It burns everyone alike, the Goliath as much of its health as anyone.)
                let k = if self.fighters[i].giant || self.fighters[i].max_hp != HP {
                    self.fighters[i].max_hp / HP
                } else {
                    1.0
                };
                self.fighters[i].hp -= FIRE_DPS * k * dt;
                if self.fighters[i].hp <= 0.0 {
                    self.knock_down(i, 0, now, &mut evs);
                }
            }
        }
        // Who's left? (In Goliath mode, a side: the Goliath, or the
        // gladiators, whose best fighter is named.)
        if let Some(winner) = self.round_winner() {
            self.winner = winner;
            if self.mode == mode::GOLIATH
                && winner != 0
                && self.fighter(winner).is_some_and(|f| !f.giant)
            {
                for f in self.fighters.iter().filter(|f| !f.giant) {
                    self.crowns[f.slot] += 1;
                }
            } else if let Some(s) = self.slot_of(winner) {
                self.crowns[s] += 1;
            }
            evs.push(Event::new(
                ev::ROUND_WON,
                winner,
                0,
                0.0,
                0.0,
                self.round as u16,
            ));
            if self.crowns.iter().any(|&c| c >= TO_WIN) {
                self.status = OVER;
                self.phase_end = now + OVER_MS;
                evs.push(Event::new(ev::CHAMPION, winner, 0, 0.0, 0.0, 0));
            } else {
                self.status = ROUND_END;
                self.phase_end = now + ROUND_END_MS;
            }
            self.missiles.clear();
        }
        evs
    }

    /// One fighter's tick: stamina, their swing playing out (its blow
    /// landing), being knocked flying.
    fn tick_fighter(&mut self, i: usize, now: u32, dt: f64, evs: &mut Vec<Event>) {
        if self.fighters[i].down {
            return;
        }
        {
            let f = &mut self.fighters[i];
            if now >= f.stamina_used + STAMINA_DELAY_MS && !f.winded(now) && f.act != act::CHARGE {
                let rate = if f.act == act::BLOCK {
                    STAMINA_REGEN * BLOCK_REGEN
                } else {
                    STAMINA_REGEN
                } * if f.giant {
                    GIANT_REGEN
                } else {
                    GLADIATOR_REGEN
                };
                f.stamina = (f.stamina + rate * dt).min(STAMINA);
            }
            // The Goliath standing still (and doing nothing) a while: its wounds slowly close.
            if f.giant {
                let moved = (f.x - f.last_pos.0).hypot(f.y - f.last_pos.1) > 0.01;
                if moved || !matches!(f.act, act::NONE | act::BLOCK) || now < f.knocked_until {
                    f.still_since = now;
                }
                f.last_pos = (f.x, f.y);
                if now >= f.still_since + GIANT_REST_MS {
                    f.hp = (f.hp + GIANT_REST_HPS * dt).min(GIANT_HP);
                }
            }
        }
        // A whirlwind asked for while busy: now, if it can.
        {
            let f = &mut self.fighters[i];
            // (The Goliath's grab waits longer: its blows and leaps are long.)
            let buffer = if f.giant {
                GIANT_SPECIAL_BUFFER_MS
            } else {
                SPECIAL_BUFFER_MS
            };
            // A blow (or a charge) asked for while busy: now it's free, it goes.
            if f.pending.0 != 0 {
                let (what, at, aim) = f.pending;
                let keep = if f.giant {
                    GIANT_INPUT_BUFFER_MS
                } else {
                    INPUT_BUFFER_MS
                };
                // (A reel that's just run out counts as free: no tick lost.)
                if f.act == act::STUN && now >= f.act_until && now >= f.knocked_until {
                    f.act = act::NONE;
                }
                if now > at + keep {
                    f.pending = (0, 0, 0.0);
                } else if f.free(now) {
                    f.pending = (0, 0, 0.0);
                    let id = f.id;
                    let more = if f.giant {
                        self.giant_input(i, what, aim, now).unwrap_or_default()
                    } else {
                        self.input(id, what, aim, now)
                    };
                    evs.extend(more);
                }
            }
            let f = &mut self.fighters[i];
            if f.special_at != 0 {
                if now > f.special_at + buffer || f.rage < RAGE {
                    f.special_at = 0;
                } else if f.can_cancel(now) {
                    if f.giant {
                        let aim = f.aim;
                        f.special_at = 0;
                        self.grab(i, aim, now, evs);
                    } else {
                        f.ultimate(now, evs);
                    }
                }
            }
        }
        // Knocked flying.
        let (kvx, kvy) = (self.fighters[i].kvx, self.fighters[i].kvy);
        if kvx.hypot(kvy) > 0.3 {
            let f = &self.fighters[i];
            let speed = kvx.hypot(kvy);
            let (nx, ny, bumped) = self.ring.slide(f.x, f.y, kvx * dt, kvy * dt, f.body());
            let decay = (-KB_FRICTION * dt).exp();
            let f = &mut self.fighters[i];
            f.x = nx;
            f.y = ny;
            f.kvx *= decay;
            f.kvy *= decay;
            if bumped && speed > WALL_SLAM_SPEED && !f.slammed {
                f.slammed = true;
                f.kvx = 0.0;
                f.kvy = 0.0;
                let by = f.knocked_by;
                // (Hurled by the Goliath into the wall: it hurts the more, and they reel the longer.)
                let hurled = now < f.hurled_until;
                let dmg = if hurled { HURL_WALL_DMG } else { WALL_SLAM_DMG };
                f.hp -= dmg;
                f.hurled_until = 0;
                f.set(
                    act::STUN,
                    now,
                    if hurled { HURL_CRASH_DAZE_MS } else { 500 },
                );
                if hurled {
                    f.dazed_until = now + HURL_CRASH_DAZE_MS;
                }
                f.knocked_until = now;
                evs.push(Event::new(ev::WALL_SLAM, by, f.id, f.x, f.y, dmg as u16));
                if f.hp <= 0.0 {
                    self.knock_down(i, by, now, evs);
                    return;
                }
            } else if bumped {
                f.kvx *= 0.3;
                f.kvy *= 0.3;
            }
            let f = &mut self.fighters[i];
            if f.kvx.hypot(f.kvy) < 0.3 {
                f.kvx = 0.0;
                f.kvy = 0.0;
            }
        }
        let f = self.fighters[i].clone();
        let since = now.saturating_sub(f.act_at);
        match f.act {
            act::LIGHT1 | act::LIGHT2 | act::LIGHT3 => {
                let k = (f.act - act::LIGHT1) as usize;
                let (w, a, _) = f.light(k);
                if !f.struck && since >= w {
                    self.fighters[i].struck = true;
                    let dmg = LIGHT_DMG[k] * KIT_LIGHT_DMG[f.k()] * f.fury(now);
                    let (bits, stun) = if k == 2 { (4, 380) } else { (0, 230) };
                    self.cleave(
                        i,
                        KIT_LIGHT_REACH[f.k()],
                        KIT_LIGHT_ARC[f.k()],
                        dmg,
                        LIGHT_KB[k],
                        bits,
                        stun,
                        now,
                        evs,
                    );
                }
                let g = &self.fighters[i];
                if g.act != f.act {
                    // (Parried mid-swing: it's over.)
                } else if now >= g.act_until {
                    let g = &mut self.fighters[i];
                    if g.queued && k < 2 && g.spend(LIGHT_COST, now) {
                        g.queued = false;
                        let next = act::LIGHT1 + k as u8 + 1;
                        let (w, a, r) = g.light(k + 1);
                        g.set(next, now, w + a + r);
                        evs.push(Event::new(ev::SWING, g.id, 0, g.x, g.y, next as u16));
                    } else {
                        g.queued = false;
                        g.act = act::NONE;
                    }
                } else if since >= w + a && g.queued && k < 2 {
                    // Chained in: no need to wait out the recovery.
                    self.fighters[i].act_until = now;
                }
            }
            act::HEAVY => {
                let (w, a, _) = HEAVY;
                // (People lunge on their own screens and tell us where they
                // are a little after: a little longer to catch up.)
                let late = if f.bot { 100 } else { 240 };
                if since >= w && since < w + a + late {
                    // The lunge: forward (the bots, by the server; people, by their clients).
                    if f.bot {
                        let lunge =
                            KIT_LUNGE[f.k()] + (KIT_LUNGE_MAX[f.k()] - KIT_LUNGE[f.k()]) * f.charge;
                        let step = lunge / (a as f64 / 1000.0) * dt;
                        let (nx, ny, _) = self.ring.slide(
                            f.x,
                            f.y,
                            f.aim.cos() * step,
                            f.aim.sin() * step,
                            BODY_R,
                        );
                        self.fighters[i].x = nx;
                        self.fighters[i].y = ny;
                    }
                    let (dmg, kb) = heavy_blow(&f, now);
                    self.cleave(
                        i,
                        KIT_HEAVY_REACH[f.k()],
                        HEAVY_ARC,
                        dmg,
                        kb,
                        2,
                        520,
                        now,
                        evs,
                    );
                    // And anyone the lunge went through on the way (unless it was
                    // just parried).
                    if self.fighters[i].act == act::HEAVY {
                        let g = &self.fighters[i];
                        let ahead = (
                            g.x + g.aim.cos() * HEAVY_SWEEP,
                            g.y + g.aim.sin() * HEAVY_SWEEP,
                        );
                        self.sweep(i, g.act_from, ahead, HEAVY_SWEEP, dmg, kb, 2, 520, now, evs);
                    }
                }
                if self.fighters[i].act == act::HEAVY && now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::ROLL => {
                let (dist, ms) = if f.giant {
                    (GIANT_DASH_DIST, GIANT_DASH_MS)
                } else {
                    (ROLL_DIST, ROLL_MS)
                };
                if f.bot && since < ms {
                    let step = dist / (ms as f64 / 1000.0) * dt;
                    let (nx, ny, _) = self.ring.slide(
                        f.x,
                        f.y,
                        f.roll_dir.cos() * step,
                        f.roll_dir.sin() * step,
                        f.body(),
                    );
                    self.fighters[i].x = nx;
                    self.fighters[i].y = ny;
                }
                if f.giant {
                    self.dash_through(i, now, evs);
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::SHOOT => {
                // (Quick: one, a beat in. Charged: the bow's three, one after
                // another; or one big bomb.)
                let w = if !f.quick {
                    SHOOT.0
                } else if f.kit == kit::ARCHER {
                    QUICK_SHOT.0
                } else {
                    QUICK_LOB.0
                };
                let n = if f.kit == kit::ARCHER && !f.quick {
                    BURST_ARROWS
                } else {
                    1
                };
                while self.fighters[i].shots < n
                    && since >= w + self.fighters[i].shots as u32 * BURST_GAP_MS
                {
                    self.fighters[i].shots += 1;
                    self.shoot(i, evs);
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::CAST if f.kit == kit::ARCHER => {
                // The storm: ring after ring, half a second apart.
                while self.fighters[i].shots < VOLLEY_WAVES
                    && since >= CAST.0 + self.fighters[i].shots as u32 * VOLLEY_GAP_MS
                {
                    self.fighters[i].shots += 1;
                    self.cast(i, now, evs);
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::CAST => {
                if !f.struck && since >= CAST.0 {
                    self.fighters[i].struck = true;
                    self.cast(i, now, evs);
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::THROW => {
                if !f.struck && since >= THROW.0 {
                    self.fighters[i].struck = true;
                    let kind = f.holding;
                    self.fighters[i].holding = 0;
                    // (The Goliath throws spears three at a time, fanned out.)
                    let fan = if kind == 0 {
                        0
                    } else if kind == gift::SPEAR && f.giant {
                        GIANT_SPEARS
                    } else if kind == gift::BOMB && f.kit == kit::BOMBER && !f.giant {
                        BOMBER_GIFT_BOMBS
                    } else {
                        1
                    };
                    let spread = if kind == gift::BOMB {
                        BOMBER_GIFT_SPREAD
                    } else {
                        GIANT_SPEAR_SPREAD
                    };
                    for k in 0..fan {
                        let a = f.aim + (k as f64 - (fan - 1) as f64 / 2.0) * spread;
                        let m = Missile::new(f.id, kind, f.x, f.y, a);
                        let mut e = Event::new(ev::THROW, f.id, 0, f.x, f.y, kind as u16);
                        e.m = aim_to_u16(a);
                        e.vx = m.left;
                        e.vy = m.vx.hypot(m.vy);
                        evs.push(e);
                        self.missiles.push(m);
                    }
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::SPIN => {
                self.cleave(
                    i,
                    KIT_SPIN_REACH[f.k()],
                    PI + 0.01,
                    SPIN_DMG * KIT_SPIN_DMG[f.k()] * f.fury(now),
                    4.5,
                    16,
                    200,
                    now,
                    evs,
                );
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::SMASH => self.tick_smash(i, &f, since, now, evs),
            act::STOMP => self.tick_stomp(i, &f, since, now, evs),
            act::GRAB => self.tick_grab(i, &f, since, now, evs),
            act::HELD => {
                // Let go of if whoever had them can't hold them any more.
                let by = f.held_by;
                if !self
                    .fighters
                    .iter()
                    .any(|g| g.id == by && !g.down && g.act == act::GRAB)
                {
                    let v = &mut self.fighters[i];
                    v.held_by = 0;
                    v.act = act::NONE;
                    v.knocked_until = now;
                }
            }
            act::STUN if now >= f.act_until => {
                self.fighters[i].act = act::NONE;
            }
            _ => {}
        }
    }

    // ---- the Goliath ---------------------------------------------------------

    /// The Goliath's own moves: the smash, the stomp, the grab (rolling's
    /// beyond it). None: as anyone else's (blocking, charging, throwing).
    fn giant_input(&mut self, i: usize, what: u8, aim: f64, now: u32) -> Option<Vec<Event>> {
        let mut evs = Vec::new();
        match what {
            input::LIGHT => {
                let f = &mut self.fighters[i];
                if f.free(now) {
                    if f.spend(SMASH_COST, now) {
                        f.aim = aim;
                        let (w, a, r) = SMASH;
                        f.set(act::SMASH, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::SMASH as u16));
                    }
                } else {
                    // Still busy: it swings the moment it's free.
                    f.pending = (input::LIGHT, now, aim);
                }
            }
            input::HEAVY_START => {
                let f = &mut self.fighters[i];
                if f.free(now) {
                    f.pending = (0, 0, 0.0);
                    f.aim = aim;
                    f.set(act::CHARGE, now, u32::MAX - now);
                } else {
                    // Still busy: it crouches to leap the moment it's free.
                    f.pending = (input::HEAVY_START, now, aim);
                }
            }
            input::HEAVY_RELEASE => {
                let f = &mut self.fighters[i];
                if f.act != act::CHARGE && f.pending.0 == input::HEAVY_START {
                    // Let go before it was ever free to crouch: a smash, then.
                    f.pending = (input::LIGHT, now, aim);
                }
                if f.act == act::CHARGE {
                    let held = now.saturating_sub(f.act_at);
                    f.aim = aim;
                    if held >= HEAVY_MIN_MS && !f.winded(now) && f.spend(STOMP_COST, now) {
                        f.charge = ((held - HEAVY_MIN_MS) as f64
                            / (GIANT_CHARGE_MS - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        // As far as the charge carries it, but never past the mouse.
                        f.leap = STOMP_LEAP_MIN + (STOMP_LEAP - STOMP_LEAP_MIN) * f.charge;
                        f.leapt = 0.0;
                        if f.reach > 0.0 {
                            f.leap = f.leap.min(f.reach);
                        }
                        let (w, a, r) = STOMP;
                        f.set(act::STOMP, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::STOMP as u16));
                    } else if f.spend(SMASH_COST, now) {
                        // Let go too soon: a smash.
                        let (w, a, r) = SMASH;
                        f.set(act::SMASH, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::SMASH as u16));
                    } else {
                        f.act = act::NONE;
                    }
                }
            }
            input::ROLL => {
                let f = &mut self.fighters[i];
                if f.can_cancel(now)
                    && now >= f.roll_ready
                    && !f.winded(now)
                    && f.stamina >= GIANT_DASH_COST
                {
                    f.drain(GIANT_DASH_COST, now);
                    f.queued = false;
                    f.roll_dir = aim;
                    f.set(act::ROLL, now, GIANT_DASH_MS);
                    f.dash_from = (f.x, f.y);
                    f.hit_list.clear();
                    f.roll_ready = now + GIANT_DASH_MS + ROLL_CD_MS;
                    evs.push(Event::new(ev::ROLL, f.id, 0, f.x, f.y, 1));
                }
            }
            input::SPECIAL => {
                let f = &mut self.fighters[i];
                if f.rage >= RAGE && f.can_cancel(now) {
                    self.grab(i, aim, now, &mut evs);
                } else if f.rage >= RAGE {
                    // Busy (mid-blow, mid-leap, reeling): it seizes someone the moment it's free.
                    f.special_at = now.max(1);
                    f.aim = aim;
                }
            }
            _ => return None,
        }
        Some(evs)
    }

    /// The Goliath's rage: it grabs the gladiator in reach nearest where it's aiming.
    fn grab(&mut self, i: usize, aim: f64, now: u32, evs: &mut Vec<Event>) {
        let g = self.fighters[i].clone();
        let (px, py) = (g.x + aim.cos() * 1.6, g.y + aim.sin() * 1.6);
        let pick = (0..self.fighters.len())
            .filter(|&j| j != i && self.foes(i, j))
            .filter(|&j| {
                let v = &self.fighters[j];
                !v.down
                    && v.held_by == 0
                    && v.flags(now) & flag::IFRAMES == 0
                    && (v.x - g.x).hypot(v.y - g.y) < GRAB_REACH + GIANT_R
            })
            .min_by(|&a, &b| {
                let d = |k: usize| (self.fighters[k].x - px).hypot(self.fighters[k].y - py);
                d(a).total_cmp(&d(b))
            });
        // None in reach: it lunges at the nearest within a bound or two (the
        // way it's aiming, if one's that way), and seizes them.
        let pick = pick.or_else(|| {
            let j = (0..self.fighters.len())
                .filter(|&j| j != i && self.foes(i, j))
                .filter(|&j| {
                    let v = &self.fighters[j];
                    !v.down
                        && v.held_by == 0
                        && v.flags(now) & flag::IFRAMES == 0
                        && (v.x - g.x).hypot(v.y - g.y) < GRAB_LUNGE + GIANT_R
                        && self.ring.clear_line(g.x, g.y, v.x, v.y)
                })
                .min_by(|&a, &b| {
                    let cost = |k: usize| {
                        let v = &self.fighters[k];
                        (v.x - g.x).hypot(v.y - g.y)
                            + turn(aim, (v.y - g.y).atan2(v.x - g.x)).abs() * 2.0
                    };
                    cost(a).total_cmp(&cost(b))
                })?;
            let v = &self.fighters[j];
            let d = (v.x - g.x).hypot(v.y - g.y);
            let go = (d - 1.3).max(0.0);
            let (ux, uy) = ((v.x - g.x) / d, (v.y - g.y) / d);
            evs.push(Event::new(ev::ROLL, g.id, 0, g.x, g.y, 1));
            let (nx, ny, _) = self.ring.slide(g.x, g.y, ux * go, uy * go, GIANT_R);
            let f = &mut self.fighters[i];
            f.x = nx;
            f.y = ny;
            f.fix = f.fix.wrapping_add(1);
            Some(j)
        });
        let Some(j) = pick else { return };
        let g = self.fighters[i].clone();
        let from = (self.fighters[j].y - g.y).atan2(self.fighters[j].x - g.x);
        let f = &mut self.fighters[i];
        f.rage = 0.0;
        f.special_at = 0;
        f.queued = false;
        f.aim = aim;
        // (The whirl goes round from where they were grabbed.)
        f.roll_dir = from;
        self.fighters[i].set(act::GRAB, now, GRAB_SPIN_MS + 250);
        let v = &mut self.fighters[j];
        v.held_by = g.id;
        v.set(act::HELD, now, u32::MAX - now);
        v.knocked_until = u32::MAX;
        v.kvx = 0.0;
        v.kvy = 0.0;
        v.queued = false;
        evs.push(Event::new(ev::GRAB, g.id, v.id, g.x, g.y, 0));
    }

    /// The smash: when the club comes down, all in front of it within its reach take it.
    fn tick_smash(&mut self, i: usize, f: &Fighter, since: u32, now: u32, evs: &mut Vec<Event>) {
        let (w, _, _) = SMASH;
        if !f.struck && since >= w {
            self.fighters[i].struck = true;
            let victims: Vec<usize> = (0..self.fighters.len())
                .filter(|&j| j != i && self.foes(i, j))
                .filter(|&j| {
                    let v = &self.fighters[j];
                    !v.down
                        && v.act != act::HELD
                        && v.reach_to(f.x, f.y) < SMASH_REACH + v.body()
                        && {
                            let (px, py) = v.nearest(f.x, f.y);
                            turn(f.aim, (py - f.y).atan2(px - f.x)).abs() <= SMASH_ARC
                        }
                        && self.ring.clear_line(f.x, f.y, v.x, v.y)
                })
                .collect();
            for j in victims {
                self.strike(
                    i,
                    j,
                    (f.x, f.y),
                    SMASH_DMG * f.fury(now),
                    8.5,
                    2,
                    520,
                    now,
                    evs,
                );
            }
        }
        if self.fighters[i].act == act::SMASH && now >= f.act_until {
            self.fighters[i].act = act::NONE;
        }
    }

    /// The stomp: a crouch, the leap (forward), and where it lands, a
    /// shockwave, round its shield or no (bigger, harder, the longer it was charged).
    fn tick_stomp(&mut self, i: usize, f: &Fighter, since: u32, now: u32, evs: &mut Vec<Event>) {
        let (w, a, _) = STOMP;
        if since >= w && !f.struck {
            // (Just as far as it's leaping, however the ticks fall.)
            let frac = ((since - w) as f64 / a as f64).min(1.0);
            let step = (f.leap * frac - f.leapt).max(0.0);
            self.fighters[i].leapt += step;
            let g = &self.fighters[i];
            let (nx, ny, _) =
                self.ring
                    .slide(g.x, g.y, f.aim.cos() * step, f.aim.sin() * step, f.body());
            self.fighters[i].x = nx;
            self.fighters[i].y = ny;
        }
        if !f.struck && since >= w + a {
            self.fighters[i].struck = true;
            let (x, y) = (self.fighters[i].x, self.fighters[i].y);
            let giant = f.giant;
            let r = if giant { STOMP_R } else { TANK_STOMP_R } * (1.0 + f.charge * 0.3);
            // (A share of the most, the rest coming with the charge.)
            let grow = STOMP_MIN + (1.0 - STOMP_MIN) * f.charge;
            // (Its damage climbs steeply as the charge nears full: a near-full
            // stomp hits far harder than a half one.)
            // (Held all the way: half as much again.)
            let full = if f.charge >= 1.0 {
                STOMP_FULL_BONUS
            } else {
                1.0
            };
            let dmg = if giant {
                STOMP_DMG * (STOMP_DMG_MIN + (1.0 - STOMP_DMG_MIN) * f.charge.powf(2.5)) * full
            } else {
                TANK_STOMP_DMG * (0.35 + 0.65 * f.charge.powf(1.5))
            } * f.fury(now);
            let daze = (if giant {
                STOMP_DAZE_MS
            } else {
                TANK_STOMP_DAZE_MS
            } as f64
                * grow) as u32;
            let (kb, bits) = if giant {
                (STOMP_KB * grow, 2 | 32)
            } else {
                (TANK_STOMP_KB * grow, 2)
            };
            evs.push(Event::new(ev::STOMP, f.id, 0, x, y, (r * 100.0) as u16));
            let victims: Vec<usize> = (0..self.fighters.len())
                .filter(|&j| j != i && self.foes(i, j))
                .filter(|&j| {
                    let v = &self.fighters[j];
                    !v.down && v.act != act::HELD && v.reach_to(x, y) < r + v.body()
                })
                .collect();
            for j in victims {
                self.strike(i, j, (x, y), dmg, kb, bits, daze, now, evs);
                let v = &mut self.fighters[j];
                if v.act == act::STUN {
                    v.dazed_until = now + daze;
                }
            }
        }
        if self.fighters[i].act == act::STOMP && now >= f.act_until {
            self.fighters[i].act = act::NONE;
        }
    }

    /// The grab: the one held whirled round (bowling over any others
    /// they're swung into), then hurled the way the Goliath's aiming.
    fn tick_grab(&mut self, i: usize, f: &Fighter, since: u32, now: u32, evs: &mut Vec<Event>) {
        let Some(j) = self
            .fighters
            .iter()
            .position(|v| v.held_by == f.id && !v.down)
        else {
            self.fighters[i].act = act::NONE;
            return;
        };
        if since < GRAB_SPIN_MS {
            let ang = f.roll_dir + since as f64 / GRAB_SPIN_MS as f64 * PI * 2.0 * GRAB_TURNS;
            let mut at = (f.x + ang.cos() * GRAB_ORBIT, f.y + ang.sin() * GRAB_ORBIT);
            if !self.ring.free(at.0, at.1, BODY_R) {
                at = (f.x + ang.cos() * 0.5, f.y + ang.sin() * 0.5);
            }
            {
                let v = &mut self.fighters[j];
                v.x = at.0;
                v.y = at.1;
                v.aim = ang;
                v.vx = 0.0;
                v.vy = 0.0;
            }
            let others: Vec<usize> = (0..self.fighters.len())
                .filter(|&k| k != i && k != j && self.foes(i, k))
                .filter(|&k| {
                    let o = &self.fighters[k];
                    !o.down && (o.x - at.0).hypot(o.y - at.1) < GRAB_HIT_R
                })
                .collect();
            for k in others {
                let oid = self.fighters[k].id;
                if let Some(&(_, t)) = self.fighters[i].hit_list.iter().find(|(id, _)| *id == oid)
                    && now < t + GRAB_SWING_EVERY_MS
                {
                    continue;
                }
                self.fighters[i].hit_list.retain(|(id, _)| *id != oid);
                self.fighters[i].hit_list.push((oid, now));
                // (Knocked away from the one swung into them.)
                self.strike(
                    i,
                    k,
                    at,
                    GRAB_SWING_DMG * f.fury(now),
                    GRAB_SWING_KB,
                    16,
                    350,
                    now,
                    evs,
                );
            }
        } else if !f.struck {
            // The hurl.
            self.fighters[i].struck = true;
            // Where it's aiming (the mouse), as far off as that (up to a dash's
            // length): flung fast, slowing to land there.
            // (The spot's the mouse's, from the Goliath, a dash off at most; they're
            // flung at it from wherever they've swung round to.)
            let g = &self.fighters[i];
            let off = if g.reach > 0.0 { g.reach } else { HURL_DIST }.clamp(HURL_MIN, HURL_DIST);
            let spot = (g.x + g.aim.cos() * off, g.y + g.aim.sin() * off);
            let held = &self.fighters[j];
            let (dx, dy) = (spot.0 - held.x, spot.1 - held.y);
            let dir = if dx.hypot(dy) > 0.05 {
                dy.atan2(dx)
            } else {
                g.aim
            };
            let far = dx.hypot(dy).clamp(1.0, HURL_DIST + GRAB_ORBIT);
            // (Flown a tick at a time, slowing each: so far, at this speed.)
            let speed = far * (1.0 - (-KB_FRICTION * TICK_S).exp()) / TICK_S;
            let gid = f.id;
            let v = &mut self.fighters[j];
            v.held_by = 0;
            v.set(act::STUN, now, 650);
            v.kvx = dir.cos() * speed;
            v.kvy = dir.sin() * speed;
            v.knocked_until = now + ((speed / 0.3).ln() / KB_FRICTION * 1000.0) as u32;
            v.slammed = false;
            v.knocked_by = gid;
            v.hurled_until = v.knocked_until;
            v.hurl_hits.clear();
            v.hp -= HURL_DMG;
            let mut e = Event::new(ev::HIT, gid, v.id, v.x, v.y, HURL_DMG as u16);
            e.m = 8 | 2;
            e.vx = v.kvx;
            e.vy = v.kvy;
            evs.push(e);
            let mut h = Event::new(ev::HURL, gid, v.id, v.x, v.y, 0);
            h.vx = v.kvx;
            h.vy = v.kvy;
            evs.push(h);
            self.fighters[i].dealt += HURL_DMG;
            if self.fighters[j].hp <= 0.0 {
                self.knock_down(j, gid, now, evs);
            }
        }
        if self.fighters[i].act == act::GRAB && now >= f.act_until {
            self.fighters[i].act = act::NONE;
        }
    }

    /// The Goliath dashing: any gladiator in its way (between where it was
    /// last tick and where it is now) is bowled aside (once a dash): hurt,
    /// flung off its path and onward, reeling.
    fn dash_through(&mut self, i: usize, now: u32, evs: &mut Vec<Event>) {
        let g = &self.fighters[i];
        let (ax, ay) = g.dash_from;
        let (bx, by) = (g.x, g.y);
        let (dx, dy) = (bx - ax, by - ay);
        let len2 = (dx * dx + dy * dy).max(1e-9);
        let dir = g.roll_dir;
        let hit: Vec<(usize, (f64, f64))> = (0..self.fighters.len())
            .filter(|&j| j != i && self.foes(i, j))
            .filter_map(|j| {
                let v = &self.fighters[j];
                if v.down
                    || v.act == act::HELD
                    || self.fighters[i].hit_list.iter().any(|(id, _)| *id == v.id)
                {
                    return None;
                }
                // The nearest point of its path to them.
                let t = (((v.x - ax) * dx + (v.y - ay) * dy) / len2).clamp(0.0, 1.0);
                let (px, py) = (ax + dx * t, ay + dy * t);
                ((v.x - px).hypot(v.y - py) < GIANT_R + BODY_R + 0.25).then_some((j, (px, py)))
            })
            .collect();
        for (j, (px, py)) in hit {
            let vid = self.fighters[j].id;
            self.fighters[i].hit_list.push((vid, now));
            // (Knocked from a little behind where its path passed them: aside, and on the way it's going.)
            let from = (px - dir.cos() * 0.7, py - dir.sin() * 0.7);
            let dmg = DASH_HIT_DMG * self.fighters[i].fury(now);
            self.strike(i, j, from, dmg, DASH_HIT_KB, 2 | 32, 420, now, evs);
        }
        self.fighters[i].dash_from = (bx, by);
    }

    /// Whoever the Goliath hurled, flying into another gladiator, bowls
    /// them over (once each): hurt, and knocked on the way they were flying.
    fn hurled(&mut self, now: u32, evs: &mut Vec<Event>) {
        for j in 0..self.fighters.len() {
            let v = &self.fighters[j];
            if v.down || now >= v.hurled_until {
                continue;
            }
            let Some(g) = self.index(v.knocked_by) else {
                continue;
            };
            let (vx, vy) = (v.x, v.y);
            let hit: Vec<usize> = (0..self.fighters.len())
                .filter(|&k| k != j && k != g && self.foes(g, k))
                .filter(|&k| {
                    let o = &self.fighters[k];
                    !o.down
                        && !self.fighters[j].hurl_hits.contains(&o.id)
                        && (o.x - vx).hypot(o.y - vy) < BODY_R * 2.0 + 0.2
                })
                .collect();
            for k in hit {
                let oid = self.fighters[k].id;
                self.fighters[j].hurl_hits.push(oid);
                // (From a little behind the flier, so they're knocked the way it flew.)
                let f = &self.fighters[j];
                let sp = f.kvx.hypot(f.kvy).max(0.01);
                let from = (vx - f.kvx / sp * 0.6, vy - f.kvy / sp * 0.6);
                let dmg = HURL_HIT_DMG * self.fighters[g].fury(now);
                self.strike(
                    g,
                    k,
                    from,
                    dmg,
                    HURL_HIT_KB,
                    2 | 8 | 32,
                    HURL_CRASH_DAZE_MS,
                    now,
                    evs,
                );
                // (Bowled over, dazed: stars round their head.)
                if !self.fighters[k].down && self.fighters[k].act == act::STUN {
                    self.fighters[k].dazed_until = now + HURL_CRASH_DAZE_MS;
                }
                // The one flung takes it too, and the crash slows them; dazed as well.
                let gid = self.fighters[g].id;
                let f = &mut self.fighters[j];
                if f.down {
                    continue;
                }
                f.hp -= HURL_HIT_DMG;
                f.kvx *= 0.35;
                f.kvy *= 0.35;
                f.set(act::STUN, now, HURL_CRASH_DAZE_MS);
                f.dazed_until = now + HURL_CRASH_DAZE_MS;
                let mut e = Event::new(ev::HIT, gid, f.id, f.x, f.y, HURL_HIT_DMG as u16);
                e.m = 2 | 8;
                evs.push(e);
                if f.hp <= 0.0 {
                    self.knock_down(j, gid, now, evs);
                }
            }
        }
    }

    /// Whether the round's done, and who won it: the last one standing
    /// (0: nobody); in Goliath mode, the Goliath, or, if it's down, the
    /// gladiators (named by whoever's done the most).
    fn round_winner(&self) -> Option<u32> {
        if self.mode == mode::GOLIATH {
            let giant = self.fighters.iter().find(|f| f.giant);
            let giant_up = giant.is_some_and(|g| !g.down);
            let men_up = self.fighters.iter().any(|f| !f.giant && !f.down);
            if giant_up && men_up {
                return None;
            }
            if giant_up {
                return giant.map(|g| g.id);
            }
            return Some(
                self.fighters
                    .iter()
                    .filter(|f| !f.giant)
                    .max_by(|a, b| a.dealt.total_cmp(&b.dealt))
                    .map(|f| f.id)
                    .unwrap_or(0),
            );
        }
        let standing: Vec<u32> = self
            .fighters
            .iter()
            .filter(|f| !f.down)
            .map(|f| f.id)
            .collect();
        (standing.len() <= 1).then(|| standing.first().copied().unwrap_or(0))
    }

    /// The Goliath, played by a bot: after the nearest gladiator; it smashes
    /// whoever's in reach, stomps when they crowd it (or now and then from a
    /// little way off), and grabs one when its rage is full.
    fn giant_bot(
        &mut self,
        i: usize,
        now: u32,
        dt: f64,
        rng: &mut impl FnMut() -> f64,
    ) -> Vec<Event> {
        let mut evs = Vec::new();
        let me = self.fighters[i].clone();
        let sk = skill(self.level);
        let foes: Vec<Fighter> = self
            .fighters
            .iter()
            .filter(|f| !f.giant && !f.down && f.held_by == 0)
            .cloned()
            .collect();
        let dist = |f: &Fighter| (f.x - me.x).hypot(f.y - me.y);
        // It makes up its mind every so often, as a person would.
        let thinking = now >= me.ai.think_at;
        if thinking {
            self.fighters[i].ai.think_at = now + (sk.think.0 + rng() * sk.think.1) as u32;
        }
        // Whom it's after: near, hurt and on their own (picked off), kept a
        // while once chosen.
        let worth = |f: &Fighter| -> f64 {
            let alone = !foes
                .iter()
                .any(|o| o.id != f.id && (o.x - f.x).hypot(o.y - f.y) < 3.0);
            // (The canny finish off the hurt: one down's a third of the pack.)
            -dist(f) * 1.1 - f.hp / 60.0 + (HP - f.hp) / 25.0 * sk.cunning
                + if alone && dist(f) < 7.0 { 0.7 * sk.cunning } else { 0.0 }
                + if f.winded(now) || f.act == act::STUN { 1.0 } else { 0.0 }
                + if f.id == me.ai.target { 0.9 } else { 0.0 }
                // (Whoever's at it, up close: it turns on them.)
                + if dist(f) < 2.2 { 1.6 } else { 0.0 }
        };
        let kept = foes.iter().find(|f| f.id == me.ai.target).cloned();
        let chosen = if thinking || kept.is_none() {
            foes.iter()
                .max_by(|a, b| worth(a).total_cmp(&worth(b)))
                .cloned()
        } else {
            kept
        };
        let Some(t) = chosen else {
            return evs;
        };
        self.fighters[i].ai.target = t.id;
        let (dx, dy) = (t.x - me.x, t.y - me.y);
        let d = dx.hypot(dy).max(0.01);
        let toward = dy.atan2(dx);
        {
            let ai = &mut self.fighters[i].ai;
            ai.wobble =
                (ai.wobble * 0.6 + (rng() - 0.5) * sk.wobble * 0.85).clamp(-sk.wobble, sk.wobble);
        }
        let aim = toward + self.fighters[i].ai.wobble * 0.5;
        // (Its leap: charged just long enough to land by the one it's after;
        // a crowd round where it'll land.)
        let leap = (d - 0.6).clamp(STOMP_LEAP_MIN, STOMP_LEAP);
        let charge_for = HEAVY_MIN_MS
            + ((leap - STOMP_LEAP_MIN) / (STOMP_LEAP - STOMP_LEAP_MIN)
                * (GIANT_CHARGE_MS - HEAVY_MIN_MS) as f64) as u32;
        let land = (
            me.x + (t.x - me.x) / d * leap,
            me.y + (t.y - me.y) / d * leap,
        );
        let crowd = foes
            .iter()
            .filter(|f| (f.x - land.0).hypot(f.y - land.1) < STOMP_R + 0.4)
            .count();
        if me.act == act::CHARGE && now >= me.act_at + me.ai.charge_for {
            // (It "aims" its leap at just short of the one it's after; the
            // canny where they're headed, by the time it comes down.)
            let ahead = (STOMP.0 + STOMP.1) as f64 / 1000.0 * sk.cunning;
            let (px, py) = (t.x + t.vx * ahead, t.y + t.vy * ahead);
            let pd = (px - me.x).hypot(py - me.y);
            let pa = (py - me.y).atan2(px - me.x) + self.fighters[i].ai.wobble * 0.5;
            self.fighters[i].reach = (pd - 0.6).max(STOMP_LEAP_MIN);
            evs.extend(self.input(me.id, input::HEAVY_RELEASE, pa, now));
            self.fighters[i].ai.next_attack = now + (sk.gap.0 + rng() * sk.gap.1) as u32;
        } else if me.act == act::GRAB {
            // Hurl them at another, if there's one about.
            let other = foes
                .iter()
                .filter(|f| f.id != t.id)
                .min_by(|a, b| dist(a).total_cmp(&dist(b)));
            let to = other
                .map(|o| (o.y - me.y).atan2(o.x - me.x))
                .unwrap_or(toward);
            self.fighters[i].aim = to;
            // (Far enough to reach them, and through.)
            self.fighters[i].reach = other.map(|o| dist(o) + 1.0).unwrap_or(HURL_DIST);
        } else if me.free(now)
            && me.hp < GIANT_HP * 0.4
            && foes.iter().filter(|f| dist(f) < 2.2).count() >= 2
            && me.stamina >= GIANT_DASH_COST
            && now >= me.roll_ready
            && rng() < 0.05
        {
            // Hurt and hemmed in: it dashes clear, away from them.
            let (sx, sy) = foes
                .iter()
                .filter(|f| dist(f) < 2.2)
                .fold((0.0, 0.0), |(x, y), f| (x + f.x - me.x, y + f.y - me.y));
            let away = sy.atan2(sx) + PI;
            evs.extend(self.input(me.id, input::ROLL, away, now));
        } else if let Some(c) = foes
            .iter()
            .filter(|f| {
                // Someone winding a heavy blow up at it, in reach: once it's
                // seen it (a beat after), it turns and smashes them first.
                f.act == act::CHARGE
                    && dist(f) < SMASH_REACH + BODY_R - 0.2
                    && now >= f.act_at + (sk.react.0 + sk.react.1 * 0.5) as u32
            })
            .min_by(|a, b| dist(a).total_cmp(&dist(b)))
            .filter(|_| {
                thinking
                    && me.free(now)
                    && me.stamina > SMASH_COST
                    && rng() < 0.3 + 0.6 * sk.cunning
            })
        {
            let a = (c.y - me.y).atan2(c.x - me.x);
            self.fighters[i].aim = a;
            evs.extend(self.input(me.id, input::LIGHT, a, now));
            self.fighters[i].ai.next_attack =
                now + (sk.gap.0 * sk.giant_gap + rng() * sk.gap.1) as u32;
        } else if thinking
            && me.free(now)
            && now >= me.ai.next_attack
            && foes.iter().filter(|f| dist(f) < STOMP_R + 0.2).count() >= 2
            && me.stamina > STOMP_COST + 5.0
            && rng() < 0.35 + 0.4 * sk.cunning
        {
            // Hemmed in: a short hop and a stomp, catching them all round it.
            let (sx, sy) = foes
                .iter()
                .filter(|f| dist(f) < STOMP_R + 0.2)
                .fold((0.0, 0.0), |(x, y), f| (x + f.x - me.x, y + f.y - me.y));
            self.fighters[i].aim = sy.atan2(sx);
            evs.extend(self.input(me.id, input::HEAVY_START, sy.atan2(sx), now));
            self.fighters[i].ai.charge_for = HEAVY_MIN_MS + (rng() * 80.0) as u32;
        } else if thinking
            && me.free(now)
            && (SMASH_REACH + 0.3..9.5).contains(&d)
            && me.stamina >= GIANT_DASH_COST + SMASH_COST
            && now >= me.roll_ready
            && self.ring.clear_line(me.x, me.y, t.x, t.y)
            && rng() < 0.08 + 0.3 * sk.cunning
        {
            // One keeping just out of its reach (or off on their own): it
            // charges across at them, bowling over anyone in the way, and
            // smashes as it comes out of it.
            evs.extend(self.input(me.id, input::ROLL, toward, now));
            self.fighters[i].ai.next_attack = now;
        } else if thinking
            && me.free(now)
            && me.holding != 0
            && (2.0..if me.holding == gift::BOMB {
                BOMB_RANGE
            } else {
                SPEAR_RANGE - 2.0
            })
                .contains(&d)
            && self.ring.clear_line(me.x, me.y, t.x, t.y)
            && rng() < sk.throw
        {
            // What it picked up, at them (leading them a little).
            let lead = d / if me.holding == gift::BOMB {
                BOMB_SPEED
            } else {
                SPEAR_SPEED
            };
            let a = (t.y + t.vy * lead - me.y).atan2(t.x + t.vx * lead - me.x);
            evs.extend(self.input(me.id, input::THROW, a, now));
        } else if me.free(now) && now >= me.ai.next_attack {
            if me.rage >= RAGE && d < GRAB_REACH + GIANT_R {
                evs.extend(self.input(me.id, input::SPECIAL, toward, now));
            } else if (crowd >= 2
                || (d < 6.3
                    && d > 3.0
                    && rng()
                        < sk.lunge * 1.5
                            + if thinking {
                                0.12 + 0.3 * sk.cunning
                            } else {
                                0.0
                            }))
                && me.stamina > STOMP_COST + 5.0
            {
                evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                self.fighters[i].ai.charge_for = charge_for + (rng() * 150.0) as u32;
            } else {
                // Its smash: at whoever's in reach (not only the one it's
                // after), swung the way that catches the most of them.
                let near: Vec<&Fighter> = foes
                    .iter()
                    .filter(|f| dist(f) < SMASH_REACH + BODY_R - 0.1)
                    .collect();
                let caught = |a: f64| {
                    near.iter()
                        .filter(|f| turn(a, (f.y - me.y).atan2(f.x - me.x)).abs() < SMASH_ARC)
                        .count()
                };
                let best = near
                    .iter()
                    .map(|f| (f.y - me.y).atan2(f.x - me.x))
                    .max_by_key(|&a| caught(a));
                if let Some(a) = best {
                    let a = a + self.fighters[i].ai.wobble * 0.5;
                    self.fighters[i].aim = a;
                    evs.extend(self.input(me.id, input::LIGHT, a, now));
                    self.fighters[i].ai.next_attack =
                        now + (sk.gap.0 * sk.giant_gap + rng() * sk.gap.1) as u32;
                }
            }
        }
        // Lumbering after them.
        let f = self.fighters[i].clone();
        if f.free(now) || matches!(f.act, act::CHARGE | act::GRAB | act::BLOCK) {
            // A gift worth it nearby, and nobody right on it: it goes for it
            // first (a roast leg heals it twice over; a bomb's twice the blast).
            let gift = self
                .gifts
                .iter()
                .filter(|g| now + 400 >= g.lands)
                .filter(|g| match g.kind {
                    gift::HEALTH => f.hp < GIANT_HP * 0.75,
                    gift::FURY => true,
                    _ => f.holding == 0,
                })
                .map(|g| (g.x, g.y, (g.x - f.x).hypot(g.y - f.y)))
                .filter(|g| g.2 < sk.gift_r * 0.8 && !foes.iter().any(|o| dist(o) < 1.8))
                .min_by(|a, b| a.2.total_cmp(&b.2));
            let (mx, my) = if let (Some((gx, gy, gd)), act::NONE | act::BLOCK) = (gift, f.act) {
                ((gx - f.x) / gd.max(0.01), (gy - f.y) / gd.max(0.01))
            } else {
                let radial = ((d - 1.6) / 0.8).clamp(-1.0, 1.0);
                (dx / d * radial, dy / d * radial)
            };
            let slow = match f.act {
                act::CHARGE => 0.5,
                act::GRAB => 0.35,
                act::BLOCK => 0.45,
                _ => 1.0,
            } * GIANT_SPEED
                * sk.speed;
            let (nx, ny, _) = self.ring.slide(
                f.x,
                f.y,
                mx * SPEED * slow * dt,
                my * SPEED * slow * dt,
                GIANT_R,
            );
            let g = &mut self.fighters[i];
            g.vx = (nx - g.x) / dt;
            g.vy = (ny - g.y) / dt;
            g.x = nx;
            g.y = ny;
            if !matches!(g.act, act::SMASH | act::STOMP | act::GRAB) {
                g.aim = aim;
            }
        }
        evs
    }

    /// Attacker `i`'s lunge sweeping through everyone in its way: anyone
    /// within `r` (and their body) of the line from `from` to `to` (each
    /// struck once a blow).
    #[allow(clippy::too_many_arguments)]
    fn sweep(
        &mut self,
        i: usize,
        from: (f64, f64),
        to: (f64, f64),
        r: f64,
        dmg: f64,
        kb: f64,
        bits: u16,
        stun: u32,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let a = self.fighters[i].clone();
        let ((x0, y0), (x1, y1)) = (from, to);
        let (dx, dy) = (x1 - x0, y1 - y0);
        let len2 = dx * dx + dy * dy;
        let victims: Vec<usize> = (0..self.fighters.len())
            .filter(|&j| j != i)
            .filter(|&j| {
                let v = &self.fighters[j];
                if v.down || a.hit_list.iter().any(|(id, _)| *id == v.id) {
                    return false;
                }
                let t = if len2 < 1e-9 {
                    0.0
                } else {
                    (((v.x - x0) * dx + (v.y - y0) * dy) / len2).clamp(0.0, 1.0)
                };
                let (px, py) = (x0 + dx * t, y0 + dy * t);
                v.reach_to(px, py) < r + v.body() && self.ring.clear_line(px, py, v.x, v.y)
            })
            .collect();
        for j in victims {
            let vid = self.fighters[j].id;
            self.fighters[i].hit_list.push((vid, now));
            // (Struck from behind them along the line, so they're knocked on the way it went.)
            let from = (
                self.fighters[j].x - a.aim.cos(),
                self.fighters[j].y - a.aim.sin(),
            );
            self.strike(i, j, from, dmg, kb, bits, stun, now, evs);
        }
    }

    /// Fighter `i`'s blade sweeps the arc in front of them (`arc` either side
    /// of their aim, `reach` far): each one in it is struck (once per swing;
    /// a whirlwind's, every `SPIN_EVERY_MS`).
    #[allow(clippy::too_many_arguments)]
    fn cleave(
        &mut self,
        i: usize,
        reach: f64,
        arc: f64,
        dmg: f64,
        kb: f64,
        bits: u16,
        stun: u32,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let a = self.fighters[i].clone();
        let victims: Vec<usize> = (0..self.fighters.len())
            .filter(|&j| j != i)
            .filter(|&j| {
                let v = &self.fighters[j];
                if v.down {
                    return false;
                }
                // (Anywhere on them, feet to head.)
                let (px, py) = v.nearest(a.x, a.y);
                let d = (px - a.x).hypot(py - a.y);
                d < reach + v.body()
                    && (d < 0.05 || turn(a.aim, (py - a.y).atan2(px - a.x)).abs() <= arc)
                    && self.ring.clear_line(a.x, a.y, v.x, v.y)
            })
            .collect();
        for j in victims {
            let vid = self.fighters[j].id;
            let spin = a.act == act::SPIN;
            if let Some(&(_, at)) = self.fighters[i].hit_list.iter().find(|(id, _)| *id == vid)
                && (!spin || now < at + SPIN_EVERY_MS)
            {
                continue;
            }
            self.fighters[i].hit_list.retain(|(id, _)| *id != vid);
            self.fighters[i].hit_list.push((vid, now));
            self.strike(i, j, (a.x, a.y), dmg, kb, bits, stun, now, evs);
        }
    }

    /// Attacker `i`'s blow, coming from `from`, lands on `j` (unless they've
    /// rolled clear, blocked or parried it).
    #[allow(clippy::too_many_arguments)]
    fn strike(
        &mut self,
        i: usize,
        j: usize,
        from: (f64, f64),
        dmg: f64,
        kb: f64,
        bits: u16,
        stun: u32,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let ((ax, ay), aid) = (from, self.fighters[i].id);
        if !self.foes(i, j) {
            return;
        }
        let v = &self.fighters[j];
        if v.down || v.flags(now) & flag::IFRAMES != 0 {
            return;
        }
        // Mid-ultimate (the Goliath whirling someone round, a gladiator's whirlwind): it all glances off.
        if v.immune() {
            let mut e = Event::new(ev::HIT, aid, v.id, v.x, v.y, 0);
            e.m = 1 | 256;
            evs.push(e);
            return;
        }
        let dir = (v.y - ay).atan2(v.x - ax);
        let rage_before = (self.fighters[i].rage, v.rage);
        let (mut dmg, mut kb, mut stun, mut bits) = (dmg, kb, stun, bits);
        let heavy = bits & 2 != 0;
        let thrown = bits & 8 != 0;
        // Winding up its stomp or its smash, the Goliath shrugs off any blow;
        // nothing a gladiator swings stops any of its attacks. Only a bomb's
        // blast breaks one off (its wind-up, its blow, its leap, its dash).
        let charging =
            v.giant && matches!(v.act, act::CHARGE | act::SMASH | act::STOMP | act::ROLL);
        // (A bomb rocks the Goliath, breaks its attack off; but not the
        // bomber's: it'd never get to finish one.)
        let rocks = bits & 32 != 0 && self.fighters[i].kit != kit::BOMBER;
        let breaks = v.giant
            && rocks
            && !heavy
            && !thrown
            && !self.fighters[i].giant
            && matches!(v.act, act::CHARGE | act::SMASH | act::STOMP | act::ROLL);
        // A gladiator's quick blow (a slash: not a heavy one, nor thrown, nor
        // whirled, nor a blast).
        let quick = !heavy && !thrown && bits & (16 | 32) == 0 && !self.fighters[i].giant;
        let glad_heavy = heavy && !thrown && !self.fighters[i].giant;
        // The Goliath attacking (winding up, swinging, leaping, whirling,
        // dashing): a quick blow glances off it, and whoever struck reels.
        if quick
            && v.giant
            && matches!(
                v.act,
                act::CHARGE | act::SMASH | act::STOMP | act::GRAB | act::ROLL
            )
        {
            let (gid, gx, gy) = (v.id, v.x, v.y);
            let a = &mut self.fighters[i];
            a.set(act::STUN, now, DEFLECT_STUN_MS);
            a.queued = false;
            let mut e = Event::new(ev::HIT, aid, gid, gx, gy, 0);
            e.m = 1 | 128;
            evs.push(e);
            return;
        }
        // The shield: facing the blow (a bomb's blast goes round it).
        if v.act == act::BLOCK && bits & 32 == 0 && turn(v.aim, dir + PI).abs() <= BLOCK_ARC {
            if now.saturating_sub(v.block_at) <= PARRY_MS && !thrown && bits & 16 == 0 {
                // A parry! The attacker reels.
                let vid = v.id;
                let a = &mut self.fighters[i];
                let reel = if a.giant {
                    800
                } else if heavy {
                    HEAVY_PARRIED_STUN_MS
                } else {
                    PARRIED_STUN_MS
                };
                a.set(act::STUN, now, reel);
                a.queued = false;
                if heavy {
                    a.drain(HEAVY_PARRIED_COST, now);
                }
                let v = &mut self.fighters[j];
                v.gain_rage(if heavy { 35.0 } else { 25.0 });
                v.block_at = 0;
                evs.push(Event::new(ev::PARRY, vid, aid, v.x, v.y, heavy as u16));
                if rage_before.1 < RAGE && v.rage >= RAGE {
                    evs.push(Event::new(ev::RAGE_FULL, vid, 0, v.x, v.y, 0));
                }
                return;
            }
            let v = &mut self.fighters[j];
            if heavy {
                v.drain(40.0, now);
                v.act = act::NONE;
                dmg *= 0.5;
                kb *= 0.7;
                stun = 600;
                evs.push(Event::new(ev::GUARD_BREAK, aid, v.id, v.x, v.y, 0));
            } else {
                v.drain(BLOCK_HIT_COST, now);
                dmg *= 0.15;
                kb *= 0.35;
                stun = 0;
                bits |= 1;
                if v.stamina <= 0.0 {
                    v.act = act::NONE;
                    stun = 500;
                    evs.push(Event::new(ev::GUARD_BREAK, aid, v.id, v.x, v.y, 0));
                }
            }
        }
        let v = &mut self.fighters[j];
        // A gladiator already swinging (or charging, or throwing): a quick
        // slash hurts, but doesn't knock them out of it (blow for blow).
        if quick
            && !v.giant
            && matches!(
                v.act,
                act::LIGHT1 | act::LIGHT2 | act::LIGHT3 | act::CHARGE | act::HEAVY | act::THROW
            )
        {
            kb = 0.0;
            stun = 0;
        }
        // The Goliath mid-stomp can't be stopped, nor whoever it's whirling;
        // and it's hardly knocked about.
        if matches!(v.act, act::STOMP | act::GRAB | act::HELD) {
            kb = 0.0;
            stun = 0;
        }
        if v.giant {
            // Nothing a gladiator swings moves it or stops it: only a bomb's
            // blast (breaking an attack off, or rocking it a moment).
            kb = if rocks { kb * 0.2 } else { 0.0 };
            // (A slash hardly dents it.)
            if quick {
                dmg *= LIGHT_VS_GIANT;
            } else if glad_heavy {
                dmg *= HEAVY_VS_GIANT;
            }
            stun = if breaks {
                bits |= 64;
                CHARGE_BREAK_STUN_MS
            } else if charging {
                kb = 0.0;
                0
            } else if !rocks || now < v.poise_until {
                // (Slashes don't stagger it; and once staggered, it's steady a
                // while: it can't be held reeling by a crowd at it.)
                0
            } else {
                v.poise_until = now + GIANT_POISE_MS;
                stun * 35 / 100
            };
        }
        if !v.giant {
            kb *= KIT_KB_TAKEN[v.kit as usize];
        }
        v.hp -= dmg;
        // (The Goliath's rage builds slower from its wounds: it takes so many.)
        v.gain_rage(dmg * if v.giant { GIANT_RAGE_HURT } else { 0.9 });
        if kb > 0.0 {
            v.kvx = dir.cos() * kb;
            v.kvy = dir.sin() * kb;
            v.knocked_until = now + (kb * 45.0) as u32;
            v.slammed = false;
            v.knocked_by = aid;
        }
        if stun > 0 && v.act != act::SPIN {
            v.set(act::STUN, now, stun);
            v.queued = false;
        }
        let mut e = Event::new(ev::HIT, aid, v.id, v.x, v.y, dmg.round() as u16);
        e.m = bits;
        e.vx = v.kvx;
        e.vy = v.kvy;
        evs.push(e);
        let a = &mut self.fighters[i];
        // (The Goliath's rage builds slower from the blows it deals too: its ultimate's a rare thing.)
        a.gain_rage(dmg * if a.giant { GIANT_RAGE_DEAL } else { 0.6 });
        a.dealt += dmg;
        for (k, before) in [(i, rage_before.0), (j, rage_before.1)] {
            let f = &self.fighters[k];
            if before < RAGE && f.rage >= RAGE && !f.down {
                evs.push(Event::new(ev::RAGE_FULL, f.id, 0, f.x, f.y, 0));
            }
        }
        if self.fighters[j].hp <= 0.0 {
            self.knock_down(j, aid, now, evs);
        }
    }

    fn knock_down(&mut self, i: usize, by: u32, now: u32, evs: &mut Vec<Event>) {
        let f = &mut self.fighters[i];
        if f.down {
            return;
        }
        f.down = true;
        f.hp = 0.0;
        f.act = act::DOWN;
        f.act_at = now;
        f.kvx *= 0.5;
        f.kvy *= 0.5;
        f.holding = 0;
        let (id, x, y) = (f.id, f.x, f.y);
        evs.push(Event::new(ev::DOWN, by, id, x, y, 0));
        if let Some(k) = self.fighters.iter_mut().find(|k| k.id == by && k.id != id) {
            k.downs += 1;
        }
    }

    fn fly(&mut self, now: u32, dt: f64, evs: &mut Vec<Event>) {
        let mut missiles = std::mem::take(&mut self.missiles);
        let mut landed: Vec<(Missile, Flight)> = Vec::new();
        missiles.retain_mut(|m| {
            let fighters = &self.fighters;
            let by = m.by;
            // (In Goliath mode, it flies on past those on the thrower's own side.)
            let side = fighters.iter().find(|f| f.id == by).map(|f| f.giant);
            let goliath = self.mode == mode::GOLIATH;
            let flight = m.advance(&self.ring, dt, |x, y| {
                fighters.iter().position(|f| {
                    f.id != by
                        && !(goliath && side == Some(f.giant))
                        && !f.down
                        && f.flags(now) & flag::IFRAMES == 0
                        && f.reach_to(x, y) < f.body() + 0.2
                })
            });
            if flight == Flight::Flying {
                true
            } else {
                landed.push((m.clone(), flight));
                false
            }
        });
        self.missiles = missiles;
        for (m, flight) in landed {
            let shooter = self.index(m.by);
            let (x, y) = match flight {
                Flight::Stopped(x, y) | Flight::Hit(_, x, y) => (x, y),
                Flight::Flying => continue,
            };
            if m.kind == gift::BOMB || m.kind == missile::BIG_BOMB {
                // (The Goliath's bombs blast twice the ground.)
                let r = if shooter.is_some_and(|i| self.fighters[i].giant) {
                    m.r * GIANT_BOMB_R
                } else {
                    m.r
                };
                evs.push(Event::new(ev::BOOM, m.by, 0, x, y, (r * 100.0) as u16));
                for j in 0..self.fighters.len() {
                    let f = &self.fighters[j];
                    let d = f.reach_to(x, y);
                    if f.down || d > r {
                        continue;
                    }
                    let dmg = m.dmg * (1.0 - d / r * 0.6) * f.ranged_taken();
                    match shooter {
                        Some(i) if i != j => self.blast(i, j, x, y, dmg, now, evs),
                        _ => {
                            // Caught in your own blast: it still hurts.
                            let f = &mut self.fighters[j];
                            if f.immune() {
                                continue;
                            }
                            f.hp -= dmg * 0.6;
                            if f.hp <= 0.0 {
                                self.knock_down(j, 0, now, evs);
                            }
                        }
                    }
                }
            } else if let Flight::Hit(j, _, _) = flight {
                if let Some(i) = shooter {
                    // As if struck from the way it came.
                    let sp = m.vx.hypot(m.vy).max(0.01);
                    let from = (x - m.vx / sp, y - m.vy / sp);
                    let dmg = m.dmg * self.fighters[i].fury(now) * self.fighters[j].ranged_taken();
                    // (An arrow pricks (the quick one barely makes them
                    // flinch); a spear knocks them flying.)
                    let (kb, stun) = if m.kind == missile::ARROW && m.dmg <= QUICK_ARROW_DMG {
                        (1.2, 0)
                    } else if m.kind == missile::ARROW {
                        (3.0, 180)
                    } else {
                        (6.5, 400)
                    };
                    self.strike(i, j, from, dmg, kb, 8, stun, now, evs);
                }
            } else {
                let mut e = Event::new(ev::STUCK, m.by, 0, x, y, m.kind as u16);
                e.m = aim_to_u16(m.vy.atan2(m.vx));
                evs.push(e);
            }
        }
    }

    /// The archer looses an arrow (stronger the further it was drawn); the
    /// bomber lobs a bomb (as far as the mouse, no further than the charge
    /// carries it).
    fn shoot(&mut self, i: usize, evs: &mut Vec<Event>) {
        let f = self.fighters[i].clone();
        // (A bomb lands by the mouse.)
        let to_mouse = if f.reach > 0.0 {
            f.reach.clamp(LOB_MIN, LOB_RANGE)
        } else {
            LOB_RANGE * 0.7
        };
        let mut m = match (f.kit, f.quick) {
            (kit::ARCHER, true) => {
                let mut m = Missile::new(f.id, missile::ARROW, f.x, f.y, f.aim);
                m.dmg = QUICK_ARROW_DMG;
                m.left = SPEAR_RANGE;
                m
            }
            (kit::ARCHER, false) => {
                let mut m = Missile::new(f.id, missile::ARROW, f.x, f.y, f.aim);
                m.dmg = BURST_DMG;
                m.left = BURST_RANGE;
                m.vx = f.aim.cos() * BURST_SPEED;
                m.vy = f.aim.sin() * BURST_SPEED;
                m
            }
            (_, true) => {
                let mut m = Missile::new(f.id, gift::BOMB, f.x, f.y, f.aim);
                m.left = to_mouse;
                m.dmg = QUICK_LOB_DMG;
                m.r = QUICK_LOB_R;
                m
            }
            _ => {
                let mut m = Missile::new(f.id, missile::BIG_BOMB, f.x, f.y, f.aim);
                m.left = to_mouse;
                m.dmg = BIG_BOMB_DMG.0 + (BIG_BOMB_DMG.1 - BIG_BOMB_DMG.0) * f.charge;
                m.r = BIG_BOMB_R.0 + (BIG_BOMB_R.1 - BIG_BOMB_R.0) * f.charge;
                m
            }
        };
        m.left = m.left.max(0.5);
        let mut e = Event::new(ev::THROW, f.id, 0, f.x, f.y, m.kind as u16);
        e.m = aim_to_u16(f.aim);
        e.vx = m.left;
        e.vy = m.vx.hypot(m.vy);
        evs.push(e);
        self.missiles.push(m);
    }

    /// A class's ultimate, wound up: the archer's storm of arrows, the
    /// bomber's great blast, the tank's earthquake.
    fn cast(&mut self, i: usize, now: u32, evs: &mut Vec<Event>) {
        let f = self.fighters[i].clone();
        match f.kit {
            kit::ARCHER => {
                // A ring of arrows all round, and a few more at the mouse.
                let mut fire = |a: f64, dmg: f64, evs: &mut Vec<Event>| {
                    let mut m = Missile::new(f.id, missile::ARROW, f.x, f.y, a);
                    m.dmg = dmg;
                    let mut e = Event::new(ev::THROW, f.id, 0, f.x, f.y, missile::ARROW as u16);
                    e.m = aim_to_u16(a);
                    e.vx = m.left;
                    e.vy = ARROW_SPEED;
                    evs.push(e);
                    self.missiles.push(m);
                };
                for k in 0..VOLLEY_ARROWS {
                    let a =
                        f.aim + PI / VOLLEY_ARROWS as f64 + k as f64 * TAU / VOLLEY_ARROWS as f64;
                    fire(a, VOLLEY_DMG, evs);
                }
                for k in 0..VOLLEY_AIMED {
                    let a = f.aim + (k as f64 - (VOLLEY_AIMED - 1) as f64 / 2.0) * VOLLEY_SPREAD;
                    fire(a, VOLLEY_AIMED_DMG, evs);
                }
            }
            kit::BOMBER => {
                // The great blast, all round them (they're unharmed).
                evs.push(Event::new(
                    ev::BOOM,
                    f.id,
                    0,
                    f.x,
                    f.y,
                    (BLAST_R * 100.0) as u16,
                ));
                let hit: Vec<usize> = (0..self.fighters.len())
                    .filter(|&j| j != i && self.foes(i, j))
                    .filter(|&j| {
                        let v = &self.fighters[j];
                        !v.down && v.act != act::HELD && v.reach_to(f.x, f.y) < BLAST_R + v.body()
                    })
                    .collect();
                for j in hit {
                    let d = (self.fighters[j].x - f.x).hypot(self.fighters[j].y - f.y);
                    let dmg = BLAST_DMG * (1.0 - (d / BLAST_R).min(1.0) * 0.5) * f.fury(now);
                    self.blast(i, j, f.x, f.y, dmg, now, evs);
                }
            }
            _ => {
                // The earthquake: everyone near thrown away from them, dazed.
                evs.push(Event::new(
                    ev::STOMP,
                    f.id,
                    0,
                    f.x,
                    f.y,
                    (QUAKE_R * 100.0) as u16,
                ));
                let hit: Vec<usize> = (0..self.fighters.len())
                    .filter(|&j| j != i && self.foes(i, j))
                    .filter(|&j| {
                        let v = &self.fighters[j];
                        !v.down && v.act != act::HELD && v.reach_to(f.x, f.y) < QUAKE_R + v.body()
                    })
                    .collect();
                for j in hit {
                    let d = (self.fighters[j].x - f.x).hypot(self.fighters[j].y - f.y);
                    let near = 1.0 - (d / QUAKE_R).min(1.0) * 0.4;
                    let from = if d < 0.05 {
                        (f.x - 0.05, f.y)
                    } else {
                        (f.x, f.y)
                    };
                    self.strike(
                        i,
                        j,
                        from,
                        QUAKE_DMG * near * f.fury(now),
                        QUAKE_KB * near,
                        2,
                        QUAKE_DAZE_MS,
                        now,
                        evs,
                    );
                    let v = &mut self.fighters[j];
                    if v.act == act::STUN {
                        v.dazed_until = now + QUAKE_DAZE_MS;
                    }
                }
            }
        }
    }

    /// A bomb's blast from (x, y) reaching `j` (thrown by `i`): no shield holds it.
    #[allow(clippy::too_many_arguments)]
    fn blast(
        &mut self,
        i: usize,
        j: usize,
        x: f64,
        y: f64,
        dmg: f64,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let v = &self.fighters[j];
        // Right on top of it: blown whichever way.
        let from = if (v.x - x).hypot(v.y - y) < 0.05 {
            (x - 0.05, y)
        } else {
            (x, y)
        };
        self.strike(i, j, from, dmg, 9.0, 32, 450, now, evs);
    }

    fn spikes(&mut self, now: u32, evs: &mut Vec<Event>) {
        for k in 0..self.ring.spikes.len() {
            let (phase, rising) = self.spike_phase(k, now);
            if phase != 2 {
                continue;
            }
            let plate = self.ring.spikes[k];
            for j in 0..self.fighters.len() {
                let f = &self.fighters[j];
                if f.down
                    || f.immune()
                    || f.act == act::HELD
                    || f.spiked == rising
                    || f.flags(now) & flag::IFRAMES != 0
                    || !plate.contains(f.x, f.y, -0.1)
                {
                    continue;
                }
                let f = &mut self.fighters[j];
                f.spiked = rising;
                f.hp -= SPIKE_DMG;
                // (The Goliath's too big to be stopped by them: they only hurt.)
                if f.act != act::SPIN && !f.giant {
                    f.set(act::STUN, now, 350);
                }
                let (id, x, y) = (f.id, f.x, f.y);
                evs.push(Event::new(ev::SPIKED, 0, id, x, y, SPIKE_DMG as u16));
                if self.fighters[j].hp <= 0.0 {
                    let by = self.fighters[j].knocked_by;
                    self.knock_down(j, by, now, evs);
                }
            }
        }
    }

    fn gifts(&mut self, now: u32, rng: &mut impl FnMut() -> f64, evs: &mut Vec<Event>) {
        self.gifts.retain(|g| now < g.gone);
        // (No more than `GIFT_MAX` on the sand at once: they lie there till taken.)
        if now >= self.next_gift && self.gifts.len() < GIFT_MAX {
            self.next_gift = now + GIFT_EVERY_MS + (rng() * GIFT_JITTER_MS as f64) as u32;
            // Somewhere open, inside the fire.
            let fire = self.fire(now + GIFT_FALL_MS);
            for _ in 0..20 {
                let x = 1.5 + rng() * (self.ring.w - 3.0);
                let y = 1.5 + rng() * (self.ring.h - 3.0);
                if !self.ring.free(x, y, 0.5)
                    || self.ring.spikes.iter().any(|s| s.contains(x, y, 0.4))
                    || self.ring.reach(x, y) > fire - 0.1
                {
                    continue;
                }
                // The crowd favours whoever's hurting: more roast legs when somebody's low.
                let hurt = self.fighters.iter().any(|f| !f.down && f.hp < HP * 0.45);
                let kind = if hurt && rng() < 0.45 {
                    gift::HEALTH
                } else {
                    gift::ALL[(rng() * 4.0) as usize % 4]
                };
                self.gifts.push(Gift {
                    kind,
                    x,
                    y,
                    lands: now + GIFT_FALL_MS,
                    gone: u32::MAX,
                });
                evs.push(Event::new(ev::GIFT_INCOMING, 0, 0, x, y, kind as u16));
                break;
            }
        }
        let mut k = 0;
        while k < self.gifts.len() {
            let g = self.gifts[k];
            if now < g.lands {
                k += 1;
                continue;
            }
            let taker = self.fighters.iter().position(|f| {
                !f.down
                    && (f.x - g.x).hypot(f.y - g.y) < 0.75
                    && (matches!(g.kind, gift::HEALTH | gift::FURY) || f.holding == 0)
            });
            if let Some(j) = taker {
                let f = &mut self.fighters[j];
                match g.kind {
                    // (The Goliath eats twice as much.)
                    gift::HEALTH if f.giant => f.hp = (f.hp + HEAL * GIANT_GIFT_HEAL).min(GIANT_HP),
                    gift::HEALTH => f.hp = (f.hp + HEAL).min(f.max_hp),
                    gift::FURY => f.fury_until = now + FURY_MS,
                    kind => f.holding = kind,
                }
                evs.push(Event::new(ev::PICKUP, f.id, 0, g.x, g.y, g.kind as u16));
                self.gifts.remove(k);
            } else {
                k += 1;
            }
        }
    }

    /// The countdown: out of their gates the gladiators march to their places
    /// (a steady walk, facing where they go; there, facing the middle).
    fn march(&mut self, dt: f64) {
        let (cx, cy) = (self.ring.w / 2.0, self.ring.h / 2.0);
        for f in self.fighters.iter_mut() {
            let Some((tx, ty)) = f.march else { continue };
            let (dx, dy) = (tx - f.x, ty - f.y);
            let d = dx.hypot(dy);
            let step = SPEED * 0.8 * dt;
            if d <= step {
                f.x = tx;
                f.y = ty;
                f.vx = 0.0;
                f.vy = 0.0;
                f.march = None;
                f.aim = (cy - f.y).atan2(cx - f.x);
                continue;
            }
            let (nx, ny, _) = self
                .ring
                .slide(f.x, f.y, dx / d * step, dy / d * step, f.body());
            f.vx = (nx - f.x) / dt;
            f.vy = (ny - f.y) / dt;
            f.x = nx;
            f.y = ny;
            f.aim = dy.atan2(dx);
        }
    }

    // ---- the bots ----------------------------------------------------------

    /// A bot thinks (what's dangerous, whom to fight, how) and moves, as a
    /// person would: it sees a move a beat after it starts, makes up its mind
    /// every so often, reads wind-ups, and plays with the others on its side
    /// (taking turns at the Goliath, waiting for its openings) rather than
    /// everyone throwing themselves in at once.
    fn bot(&mut self, i: usize, now: u32, dt: f64, rng: &mut impl FnMut() -> f64) -> Vec<Event> {
        let mut evs = Vec::new();
        let me = self.fighters[i].clone();
        if me.down || now < me.knocked_until {
            return evs;
        }
        if me.giant {
            return self.giant_bot(i, now, dt, rng);
        }
        let fire = self.fire(now);
        let sk = skill(self.level);
        let goliath = self.mode == mode::GOLIATH;
        let foe_of = |a: &Fighter, b: &Fighter| a.id != b.id && (!goliath || a.giant != b.giant);
        let foes: Vec<Fighter> = self
            .fighters
            .iter()
            .filter(|f| !f.down && foe_of(&me, f))
            .cloned()
            .collect();
        if foes.is_empty() {
            return evs;
        }
        let gap_to = |f: &Fighter| (f.x - me.x).hypot(f.y - me.y);
        let thinking = now >= me.ai.think_at;
        if thinking {
            self.fighters[i].ai.think_at = now + (sk.think.0 + rng() * sk.think.1) as u32;
        }
        // Whom it's after: weighed up when it thinks (near, hurt, busy with
        // someone else, out of breath), and stuck with a while.
        let mut target = foes.iter().find(|f| f.id == me.ai.target).cloned();
        if thinking || target.is_none() {
            let worth = |f: &Fighter| -> f64 {
                let mut w = -gap_to(f) * 0.55 - f.hp / 45.0;
                let busy = self.fighters.iter().any(|o| {
                    o.id != me.id && !o.down && foe_of(o, f) && (o.x - f.x).hypot(o.y - f.y) < 1.8
                });
                if busy {
                    w += 1.4 * sk.cunning;
                }
                if f.winded(now) || f.act == act::STUN {
                    w += 1.2;
                }
                // (A whirlwind about to go off: give it room.)
                if f.rage >= RAGE {
                    w -= 1.5 * sk.cunning;
                }
                if f.id == me.ai.target {
                    w += 0.8;
                }
                w
            };
            target = foes
                .iter()
                .max_by(|a, b| worth(a).total_cmp(&worth(b)))
                .cloned();
        }
        let Some(t) = target else { return evs };
        self.fighters[i].ai.target = t.id;
        let (dx, dy) = (t.x - me.x, t.y - me.y);
        let dist = dx.hypot(dy).max(0.01);
        let toward = dy.atan2(dx);
        {
            let ai = &mut self.fighters[i].ai;
            ai.wobble =
                (ai.wobble * 0.6 + (rng() - 0.5) * sk.wobble * 0.85).clamp(-sk.wobble, sk.wobble);
        }
        let aim = toward + self.fighters[i].ai.wobble;
        // How square it faces us (0: right at us).
        let at_us = turn(t.aim, toward + PI).abs();
        let since = now.saturating_sub(t.act_at);
        // Its turning to face us is seen a beat late too.
        if at_us < 1.2 {
            if me.ai.faced_at == 0 {
                let ai = &mut self.fighters[i].ai;
                ai.faced_at = now;
                ai.faced_react = (sk.react.0 + rng() * sk.react.1) as u32;
            }
        } else {
            self.fighters[i].ai.faced_at = 0;
        }

        // ---- seeing what it's doing, a beat late ----
        let key = (t.id, t.act_at);
        if self.fighters[i].ai.seen_swing != key && !matches!(t.act, act::NONE | act::BLOCK) {
            let react = (sk.react.0 + rng() * sk.react.1) as u32;
            let ai = &mut self.fighters[i].ai;
            ai.seen_swing = key;
            ai.noticed_at = (t.act_at + react).max(now);
            ai.plan = PLAN_UNDECIDED;
        }
        let seen = self.fighters[i].ai.seen_swing == key && now >= self.fighters[i].ai.noticed_at;
        // Where the Goliath's leap comes down, and whether we're under it.
        let landing = (
            t.x + t.aim.cos() * (t.leap - t.leapt),
            t.y + t.aim.sin() * (t.leap - t.leapt),
        );
        let under = (me.x - landing.0).hypot(me.y - landing.1) < STOMP_R * 1.15 + 0.4;
        // Its dash coming our way: how near its line we stand.
        let off_line = {
            let (ux, uy) = (t.aim.cos(), t.aim.sin());
            let ahead = (me.x - t.x) * ux + (me.y - t.y) * uy;
            if ahead > 0.0 {
                ((me.x - t.x) * uy - (me.y - t.y) * ux).abs()
            } else {
                f64::MAX
            }
        };
        if seen && self.fighters[i].ai.plan == PLAN_UNDECIDED {
            let r = rng();
            let can_roll = me.stamina > ROLL_COST + 2.0 && now >= me.roll_ready;
            let plan = if t.giant {
                match t.act {
                    // Crouching to leap at us: read it, and get out of its line.
                    act::CHARGE
                        if at_us < 0.75 && dist < STOMP_LEAP + STOMP_R + 1.0 && r < sk.read =>
                    {
                        PLAN_SIDESTEP
                    }
                    // In the air: out from under where it lands, if there's time.
                    act::STOMP if under => {
                        if me.rage >= RAGE && r < sk.cunning {
                            PLAN_SPIN
                        } else if can_roll && r < 0.35 + 0.35 * sk.defend.min(1.5) {
                            PLAN_ROLL
                        } else {
                            PLAN_NONE
                        }
                    }
                    act::SMASH if dist < SMASH_REACH + 0.5 && at_us < SMASH_ARC + 0.25 => {
                        // (Its wind-up's short: a parry's a gamble, even for the quick.)
                        if can_roll && r < 0.2 * sk.defend {
                            PLAN_ROLL
                        } else if r < 0.2 * sk.defend + 0.12 {
                            PLAN_BLOCK
                        } else {
                            PLAN_NONE
                        }
                    }
                    act::ROLL if off_line < 1.4 && dist < GIANT_DASH_DIST + 1.0 => {
                        if can_roll && r < 0.6 * sk.defend {
                            PLAN_ROLL
                        } else {
                            PLAN_NONE
                        }
                    }
                    _ => PLAN_NONE,
                }
            } else {
                match t.act {
                    act::LIGHT1 | act::LIGHT2 | act::LIGHT3 if dist < 2.0 && at_us < 0.9 => {
                        if can_roll && me.stamina > 30.0 && r < 0.2 * sk.defend {
                            PLAN_ROLL
                        } else if r < 0.68 * sk.defend {
                            PLAN_BLOCK
                        } else {
                            PLAN_NONE
                        }
                    }
                    // An archer drawing on us: out of the arrow's line.
                    act::CHARGE if t.shoots() && at_us < 0.35 => {
                        if r < sk.read * 0.8 {
                            PLAN_SIDESTEP
                        } else {
                            PLAN_NONE
                        }
                    }
                    // A heavy blow charging our way: step out of its line, or set to parry it.
                    act::CHARGE if dist < HEAVY_LUNGE_MAX + 1.5 && at_us < 0.8 => {
                        if r < sk.read * 0.6 {
                            PLAN_SIDESTEP
                        } else if r < sk.read * 0.6 + 0.5 * sk.defend {
                            PLAN_BLOCK
                        } else {
                            PLAN_NONE
                        }
                    }
                    act::HEAVY if dist < HEAVY_LUNGE_MAX + 0.5 && at_us < 0.8 => {
                        if can_roll && r < 0.45 * sk.defend {
                            PLAN_ROLL
                        } else if r < 0.65 * sk.defend {
                            PLAN_BLOCK
                        } else {
                            PLAN_NONE
                        }
                    }
                    _ => PLAN_NONE,
                }
            };
            self.fighters[i].ai.plan = plan;
            self.fighters[i].ai.plan_at = now;
        }
        // Carrying it out.
        let threat = match t.act {
            act::LIGHT1 | act::LIGHT2 | act::LIGHT3 => dist < 2.0 && at_us < 0.9,
            act::CHARGE | act::HEAVY => dist < HEAVY_LUNGE_MAX + 1.5 && at_us < 0.9,
            act::SMASH => dist < SMASH_REACH + 0.6 && at_us < SMASH_ARC + 0.3,
            act::STOMP => under,
            act::ROLL => t.giant && off_line < 1.6,
            _ => false,
        };
        let mut want_block = now < self.fighters[i].ai.guard_until && !t.giant;
        match self.fighters[i].ai.plan {
            PLAN_BLOCK if threat => want_block = true,
            PLAN_ROLL => {
                // Away, aslant (from where it lands, out of a dash's path square to it).
                let swerve = if t.act == act::ROLL { 1.5 } else { 0.8 };
                let side = if rng() < 0.5 { swerve } else { -swerve };
                let away = if t.act == act::STOMP {
                    (me.y - landing.1).atan2(me.x - landing.0) + side * 0.4
                } else {
                    toward + PI + side
                };
                evs.extend(self.input(me.id, input::ROLL, away, now));
                self.fighters[i].ai.plan = PLAN_NONE;
            }
            PLAN_SPIN => {
                evs.extend(self.input(me.id, input::SPECIAL, aim, now));
                self.fighters[i].ai.plan = PLAN_NONE;
            }
            PLAN_SIDESTEP => {
                // Square to its line, the shorter way out.
                let side = if turn(t.aim, toward + PI) > 0.0 {
                    1.0
                } else {
                    -1.0
                };
                let ai = &mut self.fighters[i].ai;
                ai.sidestep = t.aim + side * FRAC_PI_2;
                ai.sidestep_until = now + 650;
                ai.plan = PLAN_NONE;
            }
            _ => {}
        }
        let f = self.fighters[i].clone();
        if want_block && f.act != act::BLOCK && f.free(now) {
            evs.extend(self.input(me.id, input::BLOCK_ON, toward, now));
        } else if !want_block && f.act == act::BLOCK && (now > f.block_at + 450 || !threat) {
            evs.extend(self.input(me.id, input::BLOCK_OFF, toward, now));
        }

        // ---- what it means to do ----
        // The Goliath's openings: reeling, out of breath, landing from a
        // leap or swinging back from a smash, or its back to us.
        let open = t.giant
            && (t.act == act::STUN
                || t.winded(now)
                || (t.act == act::STOMP && since > STOMP.0 + STOMP.1)
                || (t.act == act::SMASH && since > SMASH.0 + SMASH.1)
                // (Its back to us counts once it's committed to a blow at
                // someone else: free, it turns on us as quick as we close.)
                || (at_us > 1.7 && matches!(t.act, act::SMASH | act::CHARGE | act::STOMP)));
        if thinking {
            let mut intent = if me.ai.intent == intent::RECOVER && me.stamina < 55.0
                || me.stamina < 22.0
                || me.winded(now)
            {
                intent::RECOVER
            } else {
                intent::PRESS
            };
            if goliath && intent == intent::PRESS {
                // Taking turns: those best placed (near, off its front, with
                // breath to spare) press it; the rest wait at its flanks, unless
                // it's open.
                let score = |f: &Fighter| {
                    let d = (f.x - t.x).hypot(f.y - t.y);
                    let front = turn(t.aim, (f.y - t.y).atan2(f.x - t.x)).abs() < 1.0;
                    d + if front && d < SMASH_REACH + 1.0 {
                        2.0
                    } else {
                        0.0
                    } + if f.stamina < 35.0 { 3.0 } else { 0.0 }
                };
                let mine = score(&me);
                let ahead = self
                    .fighters
                    .iter()
                    .filter(|f| !f.giant && !f.down && f.id != me.id && f.held_by == 0)
                    .filter(|f| score(f) < mine)
                    .count();
                // (Whirling someone round, it can't be touched: wait.)
                if t.act == act::GRAB || (ahead >= sk.press && !open) {
                    intent = intent::HOVER;
                }
            }
            // Its place round the Goliath, as one of the pack: behind it, or
            // to a side, spread out (a stomp catches a bunch).
            let pack: Vec<u32> = self
                .fighters
                .iter()
                .filter(|f| !f.giant && !f.down)
                .map(|f| f.id)
                .collect();
            let k = pack.iter().position(|&id| id == me.id).unwrap_or(0);
            let ai = &mut self.fighters[i].ai;
            ai.intent = intent;
            ai.flank = [0.0, 1.15, -1.15, 2.2][k % 4] * (0.5 + 0.5 * sk.cunning);
            // Up close to someone (not the Goliath) facing it and set to swing:
            // a guard up ahead of it now and then.
            if !t.giant
                && dist < 1.9
                && at_us < 0.8
                && t.free(now)
                && me.stamina > 40.0
                && now < me.ai.next_attack
                && rng() < 0.22 * sk.defend
            {
                ai.guard_until = now + 300 + (rng() * 300.0) as u32;
            }
        }
        let intent = self.fighters[i].ai.intent;

        // ---- moves ----
        // (A heavy blow charged just long enough that its lunge carries it into reach.)
        let (lo, hi) = (KIT_LUNGE[me.k()], KIT_LUNGE_MAX[me.k()]);
        let charge_to = |d: f64| -> u32 {
            let lunge = (d - KIT_HEAVY_REACH[me.k()] * 0.5).clamp(lo, hi);
            HEAVY_MIN_MS + ((lunge - lo) / (hi - lo) * (HEAVY_FULL_MS - HEAVY_MIN_MS) as f64) as u32
        };
        let f = self.fighters[i].clone();
        if thinking && f.free(now) && f.act != act::BLOCK {
            let crowd = self
                .fighters
                .iter()
                .filter(|o| foe_of(&f, o) && !o.down && (o.x - f.x).hypot(o.y - f.y) < 2.2)
                .count();
            // A bomb's worth most breaking the Goliath's attack off: the canny keep it for that.
            let breaking = t.giant && matches!(t.act, act::CHARGE | act::SMASH);
            let save_bomb = t.giant && f.holding == gift::BOMB && !breaking && rng() < sk.cunning;
            let reach_for = if f.holding == gift::BOMB {
                BOMB_RANGE
            } else {
                SPEAR_RANGE - 2.0
            };
            let near = self
                .fighters
                .iter()
                .filter(|o| foe_of(&f, o) && !o.down && (o.x - f.x).hypot(o.y - f.y) < QUAKE_R)
                .count();
            if f.rage >= RAGE
                && match f.kit {
                    // A storm of arrows: someone in sight.
                    kit::ARCHER => dist < 8.0 && self.ring.clear_line(f.x, f.y, t.x, t.y),
                    // The blast, the earthquake: someone close (the more the better).
                    kit::BOMBER | kit::TANK => near >= 2 || (near >= 1 && (dist < 2.0 || t.giant)),
                    _ if t.giant => {
                        dist < KIT_SPIN_REACH[f.k()] + GIANT_R && (open || t.act == act::CHARGE)
                    }
                    _ => dist < KIT_SPIN_REACH[f.k()] + 0.2 || crowd >= 2,
                }
            {
                evs.extend(self.input(me.id, input::SPECIAL, aim, now));
            } else if f.holding != 0
                && !save_bomb
                && (2.0..reach_for).contains(&dist)
                && self.ring.clear_line(f.x, f.y, t.x, t.y)
                && (rng() < sk.throw || (breaking && rng() < sk.cunning))
            {
                let lead = dist
                    / if f.holding == gift::BOMB {
                        BOMB_SPEED
                    } else {
                        SPEAR_SPEED
                    };
                let a =
                    (t.y + t.vy * lead - f.y).atan2(t.x + t.vx * lead - f.x) + f.ai.wobble * 0.5;
                evs.extend(self.input(me.id, input::THROW, a, now));
            } else if f.shoots()
                && now >= f.ai.next_attack
                && dist > 1.2 + t.body()
                && self.ring.clear_line(f.x, f.y, t.x, t.y)
                && rng() < 0.45 + 0.45 * sk.cunning
            {
                let archer = f.kit == kit::ARCHER;
                let quick_range = if archer { SPEAR_RANGE - 1.5 } else { LOB_RANGE };
                // (The charged shot now and then, or whenever they're out of
                // the quick one's reach; the big bomb at a crowd or a giant.)
                let big = if archer {
                    dist > quick_range || rng() < 0.25 * sk.cunning
                } else {
                    dist < LOB_RANGE && (t.giant || rng() < 0.2 + 0.2 * sk.cunning)
                };
                let big_cost = if archer { BURST_COST } else { BIG_BOMB_COST.1 };
                let quick_cost = if archer {
                    QUICK_ARROW_COST
                } else {
                    QUICK_LOB_COST
                };
                if big && f.stamina > big_cost + 6.0 {
                    evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                    let fill =
                        (f.full_ms() - HEAVY_MIN_MS) as f64 / (HEAVY_FULL_MS - HEAVY_MIN_MS) as f64;
                    self.fighters[i].ai.charge_for = HEAVY_MIN_MS
                        + ((150.0 + 400.0 * sk.cunning.min(1.0) + rng() * 150.0) * fill) as u32;
                } else if dist < quick_range && f.stamina > quick_cost + 6.0 {
                    // The quick shot, leading them.
                    let speed = if archer { ARROW_SPEED } else { BOMB_SPEED };
                    let lead = dist / speed * sk.cunning;
                    let (px, py) = (t.x + t.vx * lead, t.y + t.vy * lead);
                    self.fighters[i].reach = (px - f.x).hypot(py - f.y);
                    let a = (py - f.y).atan2(px - f.x) + f.ai.wobble * 0.5;
                    evs.extend(self.input(me.id, input::LIGHT, a, now));
                    let pace = KIT_LIGHT_TIME[me.k()] * if t.giant { sk.vs_giant } else { 1.0 };
                    self.fighters[i].ai.next_attack = now
                        + ((QUICK_SHOT.0 + QUICK_SHOT.1) as f64
                            + (sk.gap.0 * 0.5 + rng() * sk.gap.1 * 0.5) * pace)
                            as u32;
                }
            } else if intent == intent::PRESS
                && dist < KIT_LIGHT_REACH[f.k()] + t.body() - BODY_R + 0.15
                && now >= f.ai.next_attack
                && f.stamina > LIGHT_COST
            {
                // (Against the Goliath, the heavy blow's the one that tells,
                // best when it's open; quick ones glance off it while it attacks.)
                let vs_giant = t.giant
                    && !f.shoots()
                    && f.stamina > HEAVY_COST + 5.0
                    && rng() < if open { 0.2 + 0.3 * sk.punish } else { 0.05 };
                if vs_giant
                    || ((t.act == act::BLOCK || t.act == act::STUN)
                        && !f.shoots()
                        && f.stamina > HEAVY_COST + 5.0
                        && rng() < sk.punish)
                {
                    evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                    self.fighters[i].ai.charge_for = charge_to(dist) + (rng() * 120.0) as u32;
                } else if !(t.giant
                    && matches!(
                        t.act,
                        act::CHARGE | act::SMASH | act::STOMP | act::GRAB | act::ROLL
                    )
                    && rng() < sk.defend.min(1.0))
                {
                    evs.extend(self.input(me.id, input::LIGHT, aim, now));
                    self.fighters[i].ai.combo_left = (rng() * sk.combo) as u8;
                }
            } else if intent == intent::PRESS
                && !f.shoots()
                && dist < KIT_HEAVY_REACH[f.k()] * 0.5 + KIT_LUNGE_MAX[f.k()]
                && dist > 1.6
                && now >= f.ai.next_attack
                && f.stamina > HEAVY_COST + 10.0
                && (!t.giant || open)
                && rng() < sk.lunge * if open { 2.0 } else { 1.0 }
            {
                evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                self.fighters[i].ai.charge_for = charge_to(dist) + (rng() * 120.0) as u32;
            }
        }
        // Combos and charges play out.
        // (A heavier weapon, a slower rhythm: as for anyone wielding it.)
        let pace = if t.giant { sk.vs_giant } else { 1.0 } * KIT_LIGHT_TIME[me.k()];
        let f = self.fighters[i].clone();
        if matches!(f.act, act::LIGHT1 | act::LIGHT2)
            && f.ai.combo_left > 0
            && !f.queued
            && now >= f.act_at + 100
        {
            self.fighters[i].ai.combo_left -= 1;
            evs.extend(self.input(me.id, input::LIGHT, aim, now));
        }
        if f.act == act::CHARGE && now >= f.act_at + f.ai.charge_for {
            let aim = if f.shoots() {
                let lead =
                    dist / if f.kit == kit::ARCHER {
                        BURST_SPEED
                    } else {
                        BOMB_SPEED
                    } * sk.cunning;
                let (px, py) = (t.x + t.vx * lead, t.y + t.vy * lead);
                self.fighters[i].reach = (px - f.x).hypot(py - f.y);
                (py - f.y).atan2(px - f.x) + f.ai.wobble * 0.5
            } else if f.kit == kit::TANK && !f.giant {
                // (The tank's stomp lands on them.)
                self.fighters[i].reach = (dist - 0.4).max(TANK_LEAP_MIN);
                aim
            } else {
                aim
            };
            evs.extend(self.input(me.id, input::HEAVY_RELEASE, aim, now));
            self.fighters[i].ai.next_attack =
                now + ((sk.gap.0 * 1.4 + rng() * sk.gap.1) * pace) as u32;
        }
        if f.act == act::LIGHT3
            || (matches!(f.act, act::LIGHT1 | act::LIGHT2) && f.ai.combo_left == 0 && !f.queued)
        {
            let ai = &mut self.fighters[i].ai;
            if ai.next_attack <= now {
                ai.next_attack = now + ((sk.gap.0 + rng() * sk.gap.1) * pace) as u32;
            }
        }

        // ---- walking ----
        // Off the spikes and out of the fire first; out of a wind-up's line;
        // to a gift worth having; then where it means to be.
        let f = self.fighters[i].clone();
        if !f.free(now) && f.act != act::BLOCK && f.act != act::CHARGE {
            if !matches!(f.act, act::ROLL | act::HEAVY | act::STUN | act::SPIN) {
                self.fighters[i].aim = aim;
            }
            return evs;
        }
        let (cx, cy) = (self.ring.w / 2.0, self.ring.h / 2.0);
        let danger_spike = self
            .ring
            .spikes
            .iter()
            .enumerate()
            .find(|(k, s)| {
                self.spike_phase(*k, now + sk.spike_ms).0 >= 1 && s.contains(f.x, f.y, 0.4)
            })
            .map(|(_, s)| *s);
        // (Not one at the Goliath's feet, unless it's open.)
        let gift_near = self
            .gifts
            .iter()
            .filter(|g| {
                now + 400 >= g.lands
                    && (matches!(g.kind, gift::HEALTH | gift::FURY) || f.holding == 0)
            })
            .filter(|g| g.kind != gift::HEALTH || f.hp < HP - HEAL * 0.6)
            .filter(|g| !t.giant || open || (g.x - t.x).hypot(g.y - t.y) > SMASH_REACH * sk.cunning)
            .map(|g| (g.x, g.y, (g.x - f.x).hypot(g.y - f.y)))
            .filter(|g| {
                g.2 < sk.gift_r && (g.2 < dist + 1.5 || intent != intent::PRESS || f.hp < HP * 0.45)
            })
            .min_by(|a, b| a.2.total_cmp(&b.2));
        let toward_pt = |px: f64, py: f64| {
            let (vx, vy) = (px - f.x, py - f.y);
            let d = vx.hypot(vy);
            if d < 0.15 {
                (0.0, 0.0)
            } else {
                let k = (d / 0.6).min(1.0) / d;
                (vx * k, vy * k)
            }
        };
        let (mut mx, mut my) = if self.ring.reach(f.x, f.y) > fire - 0.12 {
            (cx - f.x, cy - f.y)
        } else if let Some(s) = danger_spike {
            (f.x - (s.x + s.w / 2.0), f.y - (s.y + s.h / 2.0))
        } else if now < f.ai.sidestep_until {
            (f.ai.sidestep.cos(), f.ai.sidestep.sin())
        } else if let Some((gx, gy, _)) = gift_near {
            (gx - f.x, gy - f.y)
        } else if t.giant {
            // Round the Goliath: in close at its back or flank to press it;
            // a few steps off at a flank to wait; well back to get a breath.
            let ring_at = match intent {
                _ if f.kit == kit::ARCHER => SMASH_REACH + 2.2,
                _ if f.kit == kit::BOMBER => SMASH_REACH + 1.0,
                intent::PRESS => GIANT_R + BODY_R + 0.75,
                intent::HOVER => SMASH_REACH + 1.0,
                _ => SMASH_REACH + 2.4,
            };
            // (The one it's turned on can't get round behind it, not as quick
            // as it turns: it backs off out of reach, drawing it, while the
            // rest go in from behind.)
            let faced = now >= f.ai.faced_at + f.ai.faced_react
                && f.ai.faced_at > 0
                && dist < SMASH_REACH + 2.0
                && !open;
            let (a, ring_at) = if faced {
                (toward + PI, SMASH_REACH + 0.9)
            } else {
                (t.aim + PI + f.ai.flank, ring_at)
            };
            let (px, py) = (t.x + a.cos() * ring_at, t.y + a.sin() * ring_at);
            let (mut vx, mut vy) = toward_pt(px, py);
            // (Going round, not across its front: out of its line as we go.)
            if at_us < 1.1 && dist < SMASH_REACH + 1.5 && sk.cunning > 0.3 {
                let side = if turn(t.aim, toward + PI) > 0.0 {
                    1.0
                } else {
                    -1.0
                };
                let s = t.aim + side * FRAC_PI_2;
                vx += s.cos() * sk.cunning;
                vy += s.sin() * sk.cunning;
            }
            (vx, vy)
        } else {
            if now >= f.ai.strafe_until {
                let ai = &mut self.fighters[i].ai;
                ai.strafe = if rng() < 0.5 { -1.0 } else { 1.0 } * (0.3 + rng() * 0.5);
                ai.strafe_until = now + 600 + (rng() * 900.0) as u32;
            }
            let want = match intent {
                _ if f.kit == kit::ARCHER && !f.giant => 5.5,
                _ if f.kit == kit::BOMBER && !f.giant => 4.3,
                intent::RECOVER => 3.6,
                _ if now < f.ai.next_attack && sk.cunning > 0.4 => 1.7,
                _ => 1.05,
            };
            let radial = ((dist - want) / 0.8).clamp(-1.0, 1.0);
            let (ux, uy) = (dx / dist, dy / dist);
            let strafe = self.fighters[i].ai.strafe;
            (ux * radial - uy * strafe, uy * radial + ux * strafe)
        };
        // Not bunched up with its own side (one stomp, all of them).
        if goliath && sk.cunning > 0.3 {
            for o in self.fighters.iter() {
                if o.id == f.id || o.giant || o.down {
                    continue;
                }
                let (ox, oy) = (f.x - o.x, f.y - o.y);
                let d = ox.hypot(oy);
                if d < 1.6 && d > 0.01 {
                    let push = (1.6 - d) / 1.6 * sk.cunning;
                    mx += ox / d * push;
                    my += oy / d * push;
                }
            }
        }
        let len = mx.hypot(my);
        if len > 1.0 {
            mx /= len;
            my /= len;
        }
        let slow = match f.act {
            act::BLOCK => 0.45,
            act::CHARGE => 0.55,
            _ => sk.speed,
        } * KIT_SPEED[f.k()];
        let (nx, ny, _) = self.ring.slide(
            f.x,
            f.y,
            mx * SPEED * slow * dt,
            my * SPEED * slow * dt,
            BODY_R,
        );
        let f = &mut self.fighters[i];
        f.vx = (nx - f.x) / dt;
        f.vy = (ny - f.y) / dt;
        f.x = nx;
        f.y = ny;
        f.aim = aim;
        evs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Ring {
        Ring {
            w: 20.0,
            h: 13.0,
            pillars: vec![
                Rect {
                    x: 4.0,
                    y: 5.0,
                    w: 2.0,
                    h: 2.0,
                },
                Rect {
                    x: 14.0,
                    y: 5.0,
                    w: 2.0,
                    h: 2.0,
                },
            ],
            spikes: vec![
                Rect {
                    x: 9.0,
                    y: 1.0,
                    w: 2.0,
                    h: 2.0,
                },
                Rect {
                    x: 9.0,
                    y: 10.0,
                    w: 2.0,
                    h: 2.0,
                },
            ],
            oval: false,
        }
    }

    fn rng(seed: u64) -> impl FnMut() -> f64 {
        let mut s = seed.wrapping_mul(2654435761).wrapping_add(1);
        move || {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// Two people facing off in the open, the round under way.
    fn duel() -> (Match, u32) {
        let mut m = Match::new(ring());
        m.join(1, 0);
        m.join(2, 0);
        // Just the two of them: the bots out.
        m.set_bot(1, 2, false);
        m.set_bot(1, 3, false);
        assert!(m.start(1, false, 0));
        assert_eq!(m.fighters.len(), 2);
        let mut r = rng(1);
        m.step(COUNTDOWN_MS, 100, &mut r);
        assert_eq!(m.status, FIGHTING);
        let t = COUNTDOWN_MS + 100;
        m.fighters[0].x = 9.0;
        m.fighters[0].y = 6.5;
        m.fighters[0].aim = 0.0;
        m.fighters[1].x = 10.0;
        m.fighters[1].y = 6.5;
        m.fighters[1].aim = PI;
        (m, t)
    }

    #[test]
    fn a_heavy_lunge_strikes_whoever_it_goes_through_however_the_moves_fall() {
        let (mut m, t) = duel();
        m.fighters[0].x = 8.0;
        m.fighters[1].x = 10.5;
        m.fighters[1].y = 6.7;
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + 900);
        // Our client lunges and tells us where it got to, a step at a time,
        // straight through b (no tick in between to catch it).
        let mut hit = false;
        for (k, x) in [9.0, 10.2, 11.4, 12.4].iter().enumerate() {
            let evs = m.claim_move(1, *x, 6.5, 0.0, t + 900 + HEAVY.0 + 50 * (k as u32 + 1));
            hit |= evs
                .iter()
                .any(|e| e.kind == ev::HIT && e.a == 1 && e.b == 2);
        }
        assert!(hit, "went through them: struck");
        assert!(m.fighters[1].hp < HP);
    }

    #[test]
    fn the_bots_can_be_put_on_extreme_in_the_arena() {
        let mut m = Match::new(ring());
        m.join(1, 0);
        assert!(m.set_level(1, crate::level::EXTREME));
        assert_eq!(m.level, crate::level::EXTREME);
        // (Anything past it off the wire is it.)
        assert!(!m.set_level(1, 9));
    }

    #[test]
    fn the_level_is_picked_in_the_lobby_and_harder_bots_fight_better() {
        let mut m = Match::new(ring());
        m.join(1, 0);
        assert!(m.set_level(1, crate::level::HARD));
        assert!(!m.set_level(1, crate::level::HARD), "no change");
        assert!(!m.set_level(2, crate::level::EASY), "only those in");
        assert_eq!(m.level, crate::level::HARD);
        m.leave(1);
        assert_eq!(
            m.level,
            crate::level::MEDIUM,
            "back to medium with nobody left"
        );
        // One bot against someone who just stands there: how long it takes to put them down.
        let down_in = |level: u8| {
            let mut total = 0;
            for seed in 0..6u64 {
                let mut m = Match::new(ring());
                m.join(1, 0);
                for k in 2..SLOTS {
                    m.set_bot(1, k, false);
                }
                m.set_level(1, level);
                assert!(m.start(1, false, 0));
                let mut r = rng(seed + 11);
                let mut now = 0;
                let from = loop {
                    now += 100;
                    m.step(now, 100, &mut r);
                    if m.status == FIGHTING {
                        break now;
                    }
                };
                while now < from + 60_000 {
                    now += 100;
                    m.step(now, 100, &mut r);
                    if m.fighter(1).is_none_or(|f| f.down) {
                        break;
                    }
                }
                total += now - from;
            }
            total / 6
        };
        let (easy, medium, hard) = (
            down_in(crate::level::EASY),
            down_in(crate::level::MEDIUM),
            down_in(crate::level::HARD),
        );
        eprintln!("ARENA LEVELS (ms to down someone): easy {easy}, medium {medium}, hard {hard}");
        assert!(
            easy > medium && medium > hard,
            "easy {easy}, medium {medium}, hard {hard}"
        );
    }

    /// A Goliath match under way: the person (1) in place 0, bots in the
    /// rest; `giant` the Goliath's place. Fighting, everyone stood still.
    fn goliath_match(giant: usize) -> Match {
        let mut m = Match::new(ring());
        m.join(1, 0);
        assert!(m.set_mode(1, mode::GOLIATH, giant));
        assert!(m.start(1, false, 0));
        let mut r = rng(1);
        let mut now = 0;
        while m.status != FIGHTING {
            now += 100;
            m.step(now, 100, &mut r);
        }
        for f in m.fighters.iter_mut() {
            f.bot = false;
        }
        m
    }

    fn at(m: &mut Match, slot: usize, x: f64, y: f64) {
        let f = m.fighters.iter_mut().find(|f| f.slot == slot).unwrap();
        f.x = x;
        f.y = y;
    }

    #[test]
    fn a_slash_doesnt_cut_a_swing_short_and_presses_while_reeling_wait() {
        let (mut m, t) = duel();
        let mut r = rng(9);
        // Both swing at once: each is hurt, neither knocked out of their swing.
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(2, input::LIGHT, PI, t);
        m.step(t + 100, 100, &mut r);
        m.step(t + 200, 100, &mut r);
        assert!(m.fighters[0].hp < HP, "the slash landed");
        assert_eq!(m.fighters[0].act, act::CHARGE, "still charging");
        // Reeling, a slash pressed waits, and goes the moment they're free.
        let now = t + 1000;
        m.fighters[1].set(act::STUN, now, 250);
        m.fighters[1].stamina = STAMINA;
        m.input(2, input::LIGHT, PI, now + 50);
        assert_eq!(m.fighters[1].act, act::STUN);
        m.step(now + 300, 100, &mut r);
        assert!(
            matches!(m.fighters[1].act, act::LIGHT1 | act::LIGHT2 | act::LIGHT3),
            "the slash went once free"
        );
    }

    #[test]
    fn nothing_a_gladiator_does_stops_the_goliath_and_its_presses_wait_for_it() {
        let mut m = goliath_match(0);
        let mut r = rng(5);
        at(&mut m, 0, 8.0, 6.5);
        at(&mut m, 1, 9.3, 6.5);
        let gid = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
        let t = 20_000;
        // It crouches to leap; a gladiator slashes at it, then lands a heavy blow.
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(gid, input::LIGHT, PI, t + 20);
        let mut now = t;
        for _ in 0..3 {
            now += 100;
            m.step(now, 100, &mut r);
        }
        m.fighters.iter_mut().find(|f| f.id == gid).unwrap().act = act::NONE;
        m.input(gid, input::HEAVY_START, PI, now);
        m.input(gid, input::HEAVY_RELEASE, PI, now + 400);
        let hp = m.fighters[0].hp;
        for _ in 0..6 {
            now += 100;
            m.step(now, 100, &mut r);
        }
        let g = &m.fighters[0];
        assert!(g.hp < hp, "the heavy blow hurt it");
        assert_eq!(g.act, act::CHARGE, "but it's still crouching to leap");
        assert!(now >= g.knocked_until, "not knocked about");
        // It leaps; a smash pressed mid-leap goes the moment it lands and recovers.
        m.input(1, input::HEAVY_RELEASE, 0.0, now);
        assert_eq!(m.fighters[0].act, act::STOMP);
        m.input(1, input::LIGHT, 0.0, now + 800);
        let mut smashed = false;
        for _ in 0..14 {
            now += 100;
            m.step(now, 100, &mut r);
            smashed |= m.fighters[0].act == act::SMASH;
        }
        assert!(smashed, "the smash asked for mid-leap went off");
    }

    #[test]
    fn goliath_mode_makes_a_giant_and_its_side_can_t_hurt_itself() {
        let m = goliath_match(2);
        let g = m.fighters.iter().find(|f| f.slot == 2).unwrap();
        assert!(g.giant && g.hp == GIANT_HP);
        assert_eq!(m.fighters.iter().filter(|f| f.giant).count(), 1);
        // The Goliath starts east, the gladiators west.
        assert!(g.x > m.ring.w / 2.0);
        assert!(
            m.fighters
                .iter()
                .filter(|f| !f.giant)
                .all(|f| f.x < m.ring.w / 2.0)
        );
        // Gladiators' blows don't land on each other.
        let mut m = m;
        at(&mut m, 0, 5.0, 6.0);
        at(&mut m, 1, 5.8, 6.0);
        let now = m.round_at + 100;
        m.input(1, input::LIGHT, 0.0, now);
        let evs = m.step(now + 200, 100, &mut rng(2));
        assert!(!evs.iter().any(|e| e.kind == ev::HIT));
        assert_eq!(m.fighters.iter().find(|f| f.slot == 1).unwrap().hp, HP);
        // Nor without a Goliath can it start.
        let mut m = Match::new(ring());
        m.join(1, 0);
        m.set_bot(1, 3, false);
        m.set_mode(1, mode::GOLIATH, 3);
        assert!(!m.start(1, false, 0));
    }

    #[test]
    fn nothing_stops_the_stomp_once_it_s_winding_up() {
        // The person's the Goliath (place 0), winding up a stomp; a gladiator slashes it.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 6.5);
        at(&mut m, 1, 8.9, 6.5);
        at(&mut m, 2, 3.0, 2.0);
        at(&mut m, 3, 3.0, 9.0);
        let glad = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
        m.input(1, input::HEAVY_START, PI, now);
        assert_eq!(m.fighters[0].act, act::CHARGE);
        m.input(glad, input::LIGHT, 0.0, now + 300);
        let t = now + 300 + LIGHT[0].0 + 50;
        let evs = m.step(t, 100, &mut rng(5));
        let hit = evs
            .iter()
            .find(|e| e.kind == ev::HIT && e.b == 1)
            .expect("the slash landed");
        // It glanced off: no harm done, and the gladiator reels.
        assert!(hit.m & 128 != 0 && hit.n == 0, "deflected");
        assert_eq!(m.fighters[0].hp, GIANT_HP);
        assert_eq!(m.fighter(glad).unwrap().act, act::STUN);
        // Still winding up; and letting go, it stomps.
        assert_eq!(m.fighters[0].act, act::CHARGE);
        let evs = m.input(1, input::HEAVY_RELEASE, PI, t + 400);
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::SWING && e.n == act::STOMP as u16)
        );
        // Again, but a gladiator's heavy blow lands, charged `held` ms:
        // whether it broke the Goliath's wind-up off.
        let heavy = |held: u32| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 0, 10.0, 6.5);
            at(&mut m, 1, 8.6, 6.5);
            at(&mut m, 2, 3.0, 2.0);
            at(&mut m, 3, 3.0, 9.0);
            m.input(1, input::HEAVY_START, PI, now);
            m.input(glad, input::HEAVY_START, 0.0, now);
            m.input(glad, input::HEAVY_RELEASE, 0.0, now + held);
            let mut evs = Vec::new();
            let mut t = now;
            while t < now + held + HEAVY.0 + HEAVY.1 {
                t += 50;
                evs.extend(m.step(t, 50, &mut rng(6)));
            }
            let hit = *evs
                .iter()
                .find(|e| e.kind == ev::HIT && e.b == 1)
                .expect("the heavy blow landed");
            (hit, m, t)
        };
        // Not fully charged: it hurts, but the wind-up goes on.
        let (hit, m, _) = heavy(HEAVY_MIN_MS + 50);
        assert!(hit.m & 64 == 0 && hit.n > 0);
        assert_eq!(m.fighters[0].act, act::CHARGE);
        // Held all the way: it hurts the more, but nothing stops the stomp.
        let (full, mut m, t) = heavy(HEAVY_FULL_MS);
        assert!(full.m & 64 == 0 && full.n > hit.n);
        assert_eq!(m.fighters[0].act, act::CHARGE);
        let evs = m.input(1, input::HEAVY_RELEASE, PI, t + 50);
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::SWING && e.n == act::STOMP as u16)
        );
    }

    #[test]
    fn the_smash_sweeps_all_in_front_and_shrugs_off_a_quick_blow() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 10.0);
        // Two in front (one well out), one behind.
        at(&mut m, 1, 12.6, 10.0);
        at(&mut m, 2, 11.8, 11.0);
        at(&mut m, 3, 8.9, 10.0);
        let behind = m.fighters.iter().find(|f| f.slot == 3).unwrap().id;
        m.input(1, input::LIGHT, 0.0, now);
        // The one behind slashes it as it winds up: it doesn't stop.
        m.input(behind, input::LIGHT, 0.0, now + 20);
        let mut evs = Vec::new();
        let mut t = now;
        while t < now + SMASH.0 + 100 {
            t += 50;
            evs.extend(m.step(t, 50, &mut rng(7)));
        }
        assert!(
            evs.iter().any(|e| e.kind == ev::HIT && e.b == 1),
            "the slash landed"
        );
        let hit: Vec<u32> = evs
            .iter()
            .filter(|e| e.kind == ev::HIT && e.a == 1)
            .map(|e| e.b)
            .collect();
        assert_eq!(hit.len(), 2, "both in front: {hit:?}");
        assert!(!hit.contains(&behind));
    }

    #[test]
    fn the_grab_always_takes_someone_lunging_or_waiting_if_it_must() {
        // None in reach: it lunges at the one a few tiles off, and has them.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 10.0);
        at(&mut m, 1, 7.0, 10.0);
        at(&mut m, 2, 18.0, 2.0);
        at(&mut m, 3, 18.0, 11.0);
        m.fighters[0].rage = RAGE;
        let evs = m.input(1, input::SPECIAL, 0.0, now);
        assert!(evs.iter().any(|e| e.kind == ev::GRAB), "lunged and grabbed");
        assert!(m.fighters[0].x > 5.0, "lunged at them");
        assert_eq!(m.fighters[0].act, act::GRAB);
        // Busy mid-smash: it seizes them the moment it's free.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 10.0);
        at(&mut m, 1, 4.5, 10.0);
        at(&mut m, 2, 18.0, 2.0);
        at(&mut m, 3, 18.0, 11.0);
        m.fighters[0].rage = RAGE;
        m.input(1, input::LIGHT, PI, now);
        assert_eq!(m.fighters[0].act, act::SMASH);
        let evs = m.input(1, input::SPECIAL, 0.0, now + 50);
        assert!(!evs.iter().any(|e| e.kind == ev::GRAB));
        let mut evs = Vec::new();
        let mut t = now;
        while t < now + SMASH.0 + SMASH.1 + SMASH.2 + 200 {
            t += 100;
            evs.extend(m.step(t, 100, &mut rng(12)));
        }
        assert!(evs.iter().any(|e| e.kind == ev::GRAB), "grabbed once free");
    }

    #[test]
    fn the_hurl_goes_as_far_as_the_mouse_and_a_wall_hurts_more() {
        // Whirled, then hurled `reach` west from (10, 10): where they end up, their health.
        let hurl = |reach: f64, x: f64| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 0, x, 10.0);
            at(&mut m, 1, x + 1.6, 10.0);
            at(&mut m, 2, 18.0, 2.0);
            at(&mut m, 3, 18.0, 2.5);
            m.fighters[0].rage = RAGE;
            let victim = m.fighters[1].id;
            m.input(1, input::SPECIAL, 0.0, now);
            let mut t = now;
            let mut from = (0.0, 0.0);
            while t < now + GRAB_SPIN_MS + 1600 {
                t += 100;
                m.fighters[0].aim = PI;
                m.reach(1, reach);
                if t <= now + GRAB_SPIN_MS {
                    let v = m.fighter(victim).unwrap();
                    from = (v.x, v.y);
                }
                m.step(t, 100, &mut rng(14));
            }
            let v = m.fighter(victim).unwrap();
            (from.0 - v.x, v.hp)
        };
        // Out in the open: as far as the mouse.
        let (went, hp) = hurl(3.0, 12.0);
        assert!((went - 3.0).abs() < 1.0, "flew {went}");
        // Mouse well off: no further than a dash.
        let (went, _) = hurl(12.0, 12.0);
        assert!(
            went < HURL_DIST + 1.0 && went > HURL_DIST - 1.5,
            "flew {went}"
        );
        // Into the wall, near it: it hurts the more.
        let (_, walled) = hurl(5.0, 3.0);
        assert!(walled <= hp - HURL_WALL_DMG + 0.5, "{walled} vs {hp}");
    }

    #[test]
    fn a_heavy_blow_lunges_further_the_longer_it_s_held_and_the_whirlwind_can_t_be_hurt() {
        // A bot's lunge (the server moves it): barely held, then held full.
        let lunge = |held: u32| {
            let mut m = Match::new(ring());
            m.join(1, 0);
            assert!(m.start(1, false, 0));
            let mut r = rng(15);
            let mut now = 0;
            while m.status != FIGHTING {
                now += 100;
                m.step(now, 100, &mut r);
            }
            for f in m.fighters.iter_mut() {
                f.bot = false;
            }
            at(&mut m, 0, 3.0, 10.0);
            at(&mut m, 1, 18.0, 2.0);
            at(&mut m, 2, 18.0, 4.0);
            at(&mut m, 3, 18.0, 11.0);
            m.fighters[0].bot = true;
            m.fighters[0].ai.next_attack = u32::MAX;
            let now = m.round_at + 100;
            m.input(1, input::HEAVY_START, 0.0, now);
            m.input(1, input::HEAVY_RELEASE, 0.0, now + held);
            let mut t = now + held;
            for _ in 0..6 {
                t += 50;
                m.step(t, 50, &mut rng(15));
            }
            m.fighters[0].x - 3.0
        };
        let (short, long) = (lunge(HEAVY_MIN_MS), lunge(HEAVY_FULL_MS));
        assert!(short < HEAVY_LUNGE + 0.5, "short {short}");
        assert!(long > HEAVY_LUNGE_MAX - 0.8, "long {long}");
        // Whirling, a gladiator can't be hurt.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        m.fighters[1].set(act::SPIN, now, SPIN_MS);
        let hp = m.fighters[1].hp;
        let mut evs = Vec::new();
        m.strike(0, 1, (0.0, 0.0), 30.0, 5.0, 2, 300, now, &mut evs);
        assert_eq!(m.fighters[1].hp, hp);
        assert!(evs.iter().any(|e| e.kind == ev::HIT && e.m & 256 != 0));
    }

    #[test]
    fn only_a_bomb_breaks_the_goliath_s_attacks_and_its_gifts_are_bigger() {
        // Winding up its stomp, a gladiator's bomb goes off on it: broken off.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 10.0);
        at(&mut m, 1, 18.0, 2.0);
        at(&mut m, 2, 18.0, 4.0);
        at(&mut m, 3, 18.0, 11.0);
        m.input(1, input::HEAVY_START, 0.0, now);
        assert_eq!(m.fighters[0].act, act::CHARGE);
        let mut evs = Vec::new();
        m.blast(1, 0, 10.5, 10.0, 20.0, now + 200, &mut evs);
        assert_eq!(m.fighters[0].act, act::STUN);
        assert!(evs.iter().any(|e| e.kind == ev::HIT && e.m & 64 != 0));
        // Holding a spear, it throws three.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        m.fighters[0].holding = gift::SPEAR;
        m.input(1, input::THROW, 0.0, now);
        let evs = m.step(now + THROW.0 + 50, 100, &mut rng(16));
        assert_eq!(
            evs.iter().filter(|e| e.kind == ev::THROW).count(),
            GIANT_SPEARS
        );
        // A roast leg heals it twice as much.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 10.0);
        m.fighters[0].hp = 100.0;
        m.gifts.push(Gift {
            kind: gift::HEALTH,
            x: 10.0,
            y: 10.0,
            lands: now,
            gone: u32::MAX,
        });
        m.step(now + 100, 100, &mut rng(17));
        assert!(m.fighters[0].hp >= 100.0 + HEAL * GIANT_GIFT_HEAL - 0.01);
    }

    #[test]
    fn the_goliath_heals_slowly_standing_still() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 10.0);
        at(&mut m, 1, 18.0, 2.0);
        at(&mut m, 2, 18.0, 4.0);
        at(&mut m, 3, 18.0, 11.0);
        m.fighters[0].hp = 200.0;
        // Moving about: nothing.
        let mut t = now;
        for k in 0..20 {
            t += 100;
            m.fighters[0].x = 10.0 + k as f64 * 0.05;
            m.step(t, 100, &mut rng(13));
        }
        assert_eq!(m.fighters[0].hp, 200.0);
        // Standing still: after a moment, a little back, slowly.
        for _ in 0..50 {
            t += 100;
            m.step(t, 100, &mut rng(13));
        }
        let hp = m.fighters[0].hp;
        assert!(
            hp > 200.0 && hp < 200.0 + GIANT_REST_HPS * 5.0,
            "healed to {hp}"
        );
    }

    #[test]
    fn the_goliath_dashes_far_for_most_of_its_wind() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 10.0);
        at(&mut m, 1, 18.0, 2.0);
        at(&mut m, 2, 18.0, 4.0);
        at(&mut m, 3, 18.0, 11.0);
        // (Moved by the server, as a bot's would be.)
        m.fighters[0].bot = true;
        m.fighters[0].ai.next_attack = u32::MAX;
        let evs = m.input(1, input::ROLL, 0.0, now);
        assert!(evs.iter().any(|e| e.kind == ev::ROLL));
        assert_eq!(m.fighters[0].stamina, STAMINA - GIANT_DASH_COST);
        let mut t = now;
        while t < now + GIANT_DASH_MS + 100 {
            t += 50;
            m.step(t, 50, &mut rng(9));
        }
        let gone = m.fighters[0].x - 3.0;
        assert!(gone > GIANT_DASH_DIST - 0.6, "dashed {gone}");
        // Not again till it's got the wind for it.
        let evs = m.input(1, input::ROLL, 0.0, t + ROLL_CD_MS + 10);
        assert!(!evs.iter().any(|e| e.kind == ev::ROLL));
    }

    #[test]
    fn the_goliath_s_dash_bowls_aside_whoever_s_in_its_way() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 10.0);
        // One right in its path (well along it: passed between ticks), one well clear.
        at(&mut m, 1, 5.5, 10.2);
        at(&mut m, 2, 5.5, 2.0);
        at(&mut m, 3, 18.0, 11.0);
        m.fighters[0].bot = true;
        m.fighters[0].ai.next_attack = u32::MAX;
        let (inway, clear) = (m.fighters[1].id, m.fighters[2].id);
        m.input(1, input::ROLL, 0.0, now);
        let mut evs = Vec::new();
        let mut t = now;
        while t < now + GIANT_DASH_MS + 100 {
            t += 100;
            evs.extend(m.step(t, 100, &mut rng(10)));
        }
        let hits: Vec<&Event> = evs
            .iter()
            .filter(|e| e.kind == ev::HIT && e.a == 1)
            .collect();
        assert_eq!(hits.len(), 1, "once, just the one in its way");
        assert_eq!(hits[0].b, inway);
        assert!(m.fighter(clear).unwrap().hp == HP);
    }

    #[test]
    fn the_stomp_leaps_no_further_than_the_mouse() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 10.0);
        at(&mut m, 1, 18.0, 2.0);
        at(&mut m, 2, 18.0, 4.0);
        at(&mut m, 3, 18.0, 11.0);
        // Fully charged, but the mouse just 2 tiles off.
        m.reach(1, 2.0);
        m.input(1, input::HEAVY_START, 0.0, now);
        m.input(1, input::HEAVY_RELEASE, 0.0, now + GIANT_CHARGE_MS);
        let mut t = now + GIANT_CHARGE_MS;
        for _ in 0..12 {
            t += 100;
            m.step(t, 100, &mut rng(11));
        }
        let went = m.fighters[0].x - 3.0;
        assert!((went - 2.0).abs() < 0.3, "leapt {went}");
    }

    #[test]
    fn whoever_s_hurled_bowls_over_another() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 10.0);
        at(&mut m, 1, 11.6, 10.0);
        at(&mut m, 2, 18.0, 2.0);
        at(&mut m, 3, 18.0, 11.0);
        m.fighters[0].rage = RAGE;
        let evs = m.input(1, input::SPECIAL, 0.0, now);
        let victim = evs.iter().find(|e| e.kind == ev::GRAB).expect("grabbed").b;
        let other = m
            .fighters
            .iter()
            .find(|f| !f.giant && f.id != victim && f.slot != 2)
            .unwrap()
            .id;
        // Whirled, then hurled west at the one standing there.
        let mut evs = Vec::new();
        let mut t = now;
        while t < now + GRAB_SPIN_MS + 900 {
            t += 50;
            m.fighters[0].aim = PI;
            if t < now + GRAB_SPIN_MS {
                let o = m.fighters.iter_mut().find(|f| f.id == other).unwrap();
                o.x = 7.5;
                o.y = 10.0;
            }
            evs.extend(m.step(t, 50, &mut rng(8)));
        }
        let bowled = evs
            .iter()
            .find(|e| e.kind == ev::HIT && e.a == 1 && e.b == other && e.m & 8 != 0)
            .expect("bowled over");
        assert_eq!(bowled.n, HURL_HIT_DMG as u16);
        assert!(m.fighter(other).unwrap().x < 7.5, "knocked on west");
    }

    #[test]
    fn the_goliath_stomps_and_grabs_and_hurls() {
        // The person's the Goliath (place 0).
        // A stomp charged `held` ms, from (3, 10) east, with two standing at
        // `x` (along its way): how far it went, and the blows it dealt.
        let stomp = |held: u32, x: f64| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 0, 3.0, 10.0);
            at(&mut m, 1, x, 10.0);
            at(&mut m, 2, x + 0.2, 11.4);
            at(&mut m, 3, 18.0, 2.0);
            m.input(1, input::HEAVY_START, 0.0, now);
            m.input(1, input::HEAVY_RELEASE, 0.0, now + held);
            let mut evs = Vec::new();
            let mut t = now + held;
            for _ in 0..12 {
                t += 100;
                evs.extend(m.step(t, 100, &mut rng(3)));
            }
            assert!(evs.iter().any(|e| e.kind == ev::STOMP && e.a == 1));
            let hits: Vec<Event> = evs
                .into_iter()
                .filter(|e| e.kind == ev::HIT && e.a == 1)
                .collect();
            (m.fighters[0].x - 3.0, hits, m, t)
        };
        // Held all the way: a long leap, landing on the two far off.
        let (far, hits, m, t) = stomp(GIANT_CHARGE_MS, 8.6);
        assert!(far > STOMP_LEAP - 0.3, "leapt {far}");
        assert!(hits.len() >= 2, "the shockwave caught those near");
        // Flung, and dazed (reeling, stars round their heads).
        for e in &hits {
            let v = m.fighter(e.b).unwrap();
            assert!(v.flags(t) & flag::DAZED != 0, "{} dazed", e.b);
            assert!(v.act == act::STUN);
        }
        let full = hits[0].n;
        // Barely held: a hop, and a softer blow.
        let (near, hits, ..) = stomp(HEAVY_MIN_MS, 4.2);
        assert!(near < STOMP_LEAP_MIN + 0.3, "hopped {near}");
        assert!(!hits.is_empty());
        assert!(hits[0].n < full, "softer: {} vs {full}", hits[0].n);
        // The grab: rage full, a gladiator in reach where it's aiming.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 6.5);
        at(&mut m, 1, 11.6, 6.5);
        at(&mut m, 2, 6.0, 6.5);
        at(&mut m, 3, 3.0, 2.0);
        m.fighters[0].rage = RAGE;
        let evs = m.input(1, input::SPECIAL, 0.0, now);
        let victim = evs.iter().find(|e| e.kind == ev::GRAB).expect("grabbed").b;
        assert_eq!(m.fighter(victim).unwrap().act, act::HELD);
        let hp = m.fighter(victim).unwrap().hp;
        // Whirling them, it can't be hurt: a heavy blow just glances off.
        let mut evs = Vec::new();
        m.strike(2, 0, (6.0, 6.5), 30.0, 5.0, 2, 300, now, &mut evs);
        assert_eq!(m.fighters[0].hp, GIANT_HP);
        assert!(evs.iter().any(|e| e.kind == ev::HIT && e.m & 256 != 0));
        assert_eq!(m.fighters[0].act, act::GRAB);
        // Whirled round, then hurled (west, at the other).
        let mut evs = Vec::new();
        let mut t = now;
        while t < now + GRAB_SPIN_MS + 400 {
            t += 100;
            m.fighters[0].aim = PI;
            evs.extend(m.step(t, 100, &mut rng(4)));
        }
        assert!(evs.iter().any(|e| e.kind == ev::HURL && e.b == victim));
        let v = m.fighter(victim).unwrap();
        assert!(v.hp <= hp - HURL_DMG + 0.01, "the hurl hurt");
        assert_eq!(v.held_by, 0);
    }

    #[test]
    fn bots_play_a_goliath_match_to_a_champion() {
        let mut giant_wins = 0;
        for seed in 0..8u64 {
            let mut m = Match::new(ring());
            m.join(1, 0);
            m.set_mode(1, mode::GOLIATH, 1 + seed as usize % 3);
            assert!(m.start(1, false, 0));
            m.fighters.iter_mut().for_each(|f| f.bot = true);
            let mut r = rng(seed + 20);
            let mut now = 0;
            let mut rounds = 0;
            while m.status != OVER && now < 900_000 {
                now += 100;
                for e in m.step(now, 100, &mut r) {
                    rounds += (e.kind == ev::ROUND_WON) as u32;
                }
            }
            assert_eq!(m.status, OVER, "seed {seed}: a champion in the end");
            eprintln!(
                "GOLIATH seed {seed}: {rounds} rounds, {}s, crowns {:?}",
                now / 1000,
                m.crowns
            );
            giant_wins += m.fighters.iter().any(|f| f.giant && f.id == m.winner) as u32;
        }
        // A fair fight: either side can win it.
        assert!(
            (1..=7).contains(&giant_wins),
            "the Goliath won {giant_wins} of 8"
        );
    }

    #[test]
    fn in_an_amphitheatre_they_march_in_from_the_side_gates() {
        let mut r = ring();
        r.oval = true;
        let mut m = Match::new(r.clone());
        m.join(1, 0);
        assert!(m.start(1, false, 0));
        // Each in their side's gate (left places west, right places east)...
        for f in &m.fighters {
            let (gx, _) = r.gate(f.slot);
            let door = r.entrance(f.slot).unwrap();
            assert_eq!((f.x, f.y), door);
            assert_eq!(
                door.0 < r.w / 2.0,
                gx < r.w / 2.0,
                "{} by its own side",
                f.slot
            );
        }
        // ...marching out to their places in the countdown, there when the fight starts.
        let mut rr = rng(3);
        let mut now = 0;
        while now + 100 < m.phase_end {
            now += 100;
            m.step(now, 100, &mut rr);
        }
        assert_eq!(m.status, COUNTDOWN);
        for f in &m.fighters {
            assert_eq!(
                (f.x, f.y),
                r.gate(f.slot),
                "{} in place before the fight",
                f.slot
            );
            assert!(f.march.is_none());
        }
        // (A plain ring: straight to their places, as ever.)
        let mut m = Match::new(ring());
        m.join(1, 0);
        m.start(1, false, 0);
        assert!(m.fighters.iter().all(|f| (f.x, f.y) == ring().gate(f.slot)));
    }

    #[test]
    fn in_an_amphitheatre_the_sand_is_oval() {
        let mut r = ring();
        r.oval = true;
        // The middle and the starts are on the sand; the corners aren't.
        assert!(r.free(r.w / 2.0, r.h / 2.0, BODY_R));
        for k in 0..4 {
            let (x, y) = r.gate(k);
            assert!(r.free(x, y, BODY_R), "start {k} at ({x}, {y})");
        }
        assert!(!r.free(1.0, 1.0, BODY_R));
        assert!(!r.free(r.w - 1.0, r.h - 1.0, BODY_R));
        // Running at the curved wall: stopped at it, and told so (a wall slam can happen).
        let (x, y, bumped) = r.slide(r.w / 2.0, r.h / 2.0, 30.0, 30.0, BODY_R);
        assert!(bumped);
        assert!(r.reach(x, y) <= 1.0, "still inside ({x}, {y})");
        // Bots fight a whole match in it, nobody ever outside it.
        let mut m = Match::new(r.clone());
        m.join(1, 0);
        assert!(m.start(1, false, 0));
        let i = m.fighters.iter().position(|f| f.id == 1).unwrap();
        m.fighters[i].bot = true;
        let mut rr = rng(5);
        let mut now = 0;
        while m.status != OVER && now < 600_000 {
            now += 100;
            m.step(now, 100, &mut rr);
            for f in &m.fighters {
                assert!(
                    r.reach(f.x, f.y) <= 1.0,
                    "{} out at ({}, {})",
                    f.id,
                    f.x,
                    f.y
                );
            }
        }
        assert_eq!(m.status, OVER, "a champion in the end");
    }

    #[test]
    fn bots_fill_the_places_and_can_be_taken_out_or_put_back() {
        let mut m = Match::new(ring());
        assert!(m.join(1, 0));
        // By default, bots in all the other places.
        assert!(m.slots[1..].iter().all(|&s| is_bot(s)));
        // Out with two of them: a one-on-one with a bot.
        assert!(m.set_bot(1, 2, false));
        assert!(m.set_bot(1, 3, false));
        assert!(!m.set_bot(7, 1, false), "only those with a place");
        assert!(m.start(1, false, 0));
        assert_eq!(m.fighters.len(), 2);
        assert!(m.fighters.iter().any(|f| f.bot));
        // Alone, with no bots: no match.
        let mut m = Match::new(ring());
        m.join(1, 0);
        for k in 1..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(!m.start(1, false, 0));
        // A bot put back, then someone else joins: they take an empty place first, then a bot's.
        m.set_bot(1, 2, true);
        m.join(2, 0);
        assert_eq!(m.slots[1], 2);
        m.join(3, 0);
        m.join(4, 0);
        assert_eq!(
            m.slots.iter().filter(|&&s| s != 0 && !is_bot(s)).count(),
            4,
            "{:?}",
            m.slots
        );
    }

    #[test]
    fn the_parade_ends_down_the_carpet_champion_first() {
        let (mut m, _) = duel();
        m.winner = 2;
        m.crowns = [1, 3, 0, 0];
        let end = m.parade_end();
        assert_eq!(end[0].0, 2, "the champion leads");
        assert_eq!(end[0].2, m.ring.h + PARADE_END);
        assert!(end[1].2 < end[0].2, "the others behind");
    }

    #[test]
    fn a_combo_lands_three_slashes() {
        let (mut m, mut t) = duel();
        let mut r = rng(2);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(1, input::LIGHT, 0.0, t + 50);
        let mut hits = 0;
        for _ in 0..12 {
            t += 100;
            let evs = m.step(t, 100, &mut r);
            hits += evs.iter().filter(|e| e.kind == ev::HIT && e.a == 1).count();
            if m.fighters[0].act == act::LIGHT2 && !m.fighters[0].queued {
                m.input(1, input::LIGHT, 0.0, t);
            }
            // b stands its ground (back where it was, so every slash reaches).
            let b = &mut m.fighters[1];
            b.x = 10.0;
            b.kvx = 0.0;
            b.knocked_until = 0;
            if b.act == act::STUN {
                b.act = act::NONE;
            }
        }
        assert_eq!(hits, 3, "all three slashes");
        assert!(m.fighters[1].hp < HP - 30.0, "{}", m.fighters[1].hp);
    }

    #[test]
    fn a_parry_staggers_the_attacker_and_an_early_block_just_blocks() {
        let (mut m, t) = duel();
        let mut r = rng(3);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(2, input::BLOCK_ON, PI, t + 60);
        let evs = m.step(t + 150, 100, &mut r);
        assert!(
            evs.iter().any(|e| e.kind == ev::PARRY && e.a == 2),
            "{evs:?}"
        );
        assert_eq!(m.fighters[0].act, act::STUN);
        assert_eq!(m.fighters[1].hp, HP);
        let (mut m, t) = duel();
        m.input(2, input::BLOCK_ON, PI, t - 500);
        m.input(1, input::LIGHT, 0.0, t);
        let evs = m.step(t + 150, 100, &mut r);
        let hit = evs
            .iter()
            .find(|e| e.kind == ev::HIT)
            .expect("a blocked hit");
        assert!(hit.m & 1 == 1 && hit.n <= 2, "{hit:?}");
    }

    #[test]
    fn a_heavy_blow_breaks_a_guard_and_slams_them_into_the_wall() {
        let (mut m, mut t) = duel();
        let mut r = rng(4);
        m.fighters[0].x = 17.3;
        m.fighters[1].x = 18.5;
        m.input(2, input::BLOCK_ON, PI, t - 500);
        m.input(1, input::HEAVY_START, 0.0, t);
        t += 900;
        m.input(1, input::HEAVY_RELEASE, 0.0, t);
        let mut seen = Vec::new();
        for _ in 0..10 {
            t += 100;
            seen.extend(m.step(t, 100, &mut r));
        }
        assert!(
            seen.iter().any(|e| e.kind == ev::GUARD_BREAK),
            "guard broken: {seen:?}"
        );
        assert!(
            seen.iter().any(|e| e.kind == ev::WALL_SLAM),
            "slammed: {seen:?}"
        );
    }

    #[test]
    fn a_parried_heavy_blow_leaves_the_attacker_open_and_winded() {
        let (mut m, mut t) = duel();
        let mut r = rng(11);
        m.input(1, input::HEAVY_START, 0.0, t);
        t += 600;
        m.input(1, input::HEAVY_RELEASE, 0.0, t);
        // b raises the shield just as the lunge lands.
        m.input(2, input::BLOCK_ON, PI, t + 60);
        let evs = m.step(t + 100, 100, &mut r);
        let p = evs.iter().find(|e| e.kind == ev::PARRY).expect("parried");
        assert_eq!(p.n, 1, "a heavy one");
        let a = &m.fighters[0];
        assert_eq!(a.act, act::STUN);
        assert!(a.act_until >= t + 100 + HEAVY_PARRIED_STUN_MS - 1);
        assert_eq!(m.fighters[1].hp, HP);
    }

    #[test]
    fn the_whirlwind_goes_off_when_rage_is_full_even_mid_swing() {
        let (mut m, t) = duel();
        let mut r = rng(12);
        // Rage that's all but full is full.
        m.fighters[0].gain_rage(99.4);
        assert_eq!(m.fighters[0].rage, RAGE);
        // Mid-slash (its tail): still goes.
        m.input(1, input::LIGHT, 0.0, t);
        m.step(t + 100, 100, &mut r);
        m.step(t + 200, 100, &mut r);
        let evs = m.input(1, input::SPECIAL, 0.0, t + 210);
        assert!(evs.iter().any(|e| e.kind == ev::SPECIAL), "whirled");
        assert_eq!(m.fighters[0].act, act::SPIN);
        let mut hits = 0;
        for k in 1..9 {
            m.fighters[1].x = 10.0;
            m.fighters[1].kvx = 0.0;
            hits += m
                .step(t + 210 + k * 100, 100, &mut r)
                .iter()
                .filter(|e| e.kind == ev::HIT && e.a == 1 && e.m & 16 != 0)
                .count();
        }
        assert!(hits >= 3, "the whirlwind keeps hitting: {hits}");
    }

    #[test]
    fn a_whirlwind_asked_for_mid_roll_goes_off_when_the_roll_ends() {
        let (mut m, t) = duel();
        let mut r = rng(13);
        m.fighters[0].gain_rage(100.0);
        m.input(1, input::ROLL, PI, t);
        assert_eq!(m.fighters[0].act, act::ROLL);
        assert!(
            m.input(1, input::SPECIAL, 0.0, t + 50).is_empty(),
            "not mid-roll"
        );
        let mut whirled = false;
        for k in 1..=6 {
            whirled |= m
                .step(t + k * 100, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::SPECIAL && e.a == 1);
        }
        assert!(whirled, "as soon as the roll was done");
    }

    #[test]
    fn running_out_of_stamina_leaves_you_winded() {
        let (mut m, t) = duel();
        m.fighters[0].stamina = 20.0;
        assert!(
            m.input(1, input::ROLL, 1.0, t)
                .iter()
                .any(|e| e.kind == ev::ROLL)
        );
        assert!(m.fighters[0].winded(t + 10));
        // No more rolls till it passes.
        m.fighters[0].act = act::NONE;
        m.fighters[0].stamina = 80.0;
        assert!(
            m.input(1, input::ROLL, 1.0, t + ROLL_MS + ROLL_CD_MS + 10)
                .is_empty()
        );
    }

    #[test]
    fn rolling_dodges_the_blow() {
        let (mut m, t) = duel();
        let mut r = rng(5);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(2, input::ROLL, PI / 2.0, t + 50);
        let evs = m.step(t + 150, 100, &mut r);
        assert!(!evs.iter().any(|e| e.kind == ev::HIT), "{evs:?}");
    }

    #[test]
    fn last_standing_takes_the_crown_and_the_next_round_begins() {
        let (mut m, t) = duel();
        let mut r = rng(6);
        m.fighters[1].hp = 5.0;
        m.input(1, input::LIGHT, 0.0, t);
        let evs = m.step(t + 150, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::DOWN && e.b == 2));
        assert!(evs.iter().any(|e| e.kind == ev::ROUND_WON && e.a == 1));
        assert_eq!(m.crowns[0], 1);
        assert_eq!(m.status, ROUND_END);
        let evs = m.step(t + 150 + ROUND_END_MS, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::ROUND_START && e.n == 2));
        assert_eq!(m.fighters[1].hp, HP);
        assert!(!m.fighters[1].down);
    }

    #[test]
    fn spikes_rise_in_turn_and_hurt_whoever_stands_on_them() {
        let (mut m, t) = duel();
        let mut r = rng(7);
        let mut spiked = 0;
        for k in 0..80 {
            let now = t + k * 100;
            let f = &mut m.fighters[0];
            f.x = 10.0;
            f.y = 2.0;
            f.act = act::NONE;
            f.hp = HP;
            spiked += m
                .step(now, 100, &mut r)
                .iter()
                .filter(|e| e.kind == ev::SPIKED && e.b == 1)
                .count();
        }
        assert!((1..=2).contains(&spiked), "{spiked}");
    }

    #[test]
    fn the_fire_closes_in_and_burns() {
        let (mut m, t) = duel();
        let mut r = rng(8);
        m.fighters[0].x = 1.0;
        m.fighters[0].y = 1.0;
        let late = t + FIRE_AFTER_MS + FIRE_CLOSE_MS / 2;
        assert!(m.fire(late) < 1.0);
        let hp = m.fighters[0].hp;
        m.step(late, 100, &mut r);
        assert!(m.fighters[0].hp < hp);
        assert_eq!(m.fighters[1].hp, HP, "the one in the middle is safe");
    }

    #[test]
    fn spears_fly_and_bombs_blow_up() {
        let (mut m, mut t) = duel();
        let mut r = rng(9);
        m.fighters[0].x = 3.0;
        m.fighters[0].y = 9.5;
        m.fighters[1].x = 9.0;
        m.fighters[1].y = 9.5;
        m.fighters[0].holding = gift::SPEAR;
        m.input(1, input::THROW, 0.0, t);
        let mut seen = Vec::new();
        for _ in 0..8 {
            t += 100;
            seen.extend(m.step(t, 100, &mut r));
        }
        assert!(
            seen.iter().any(|e| e.kind == ev::HIT && e.m & 8 != 0),
            "spear hit: {seen:?}"
        );
        let f = &mut m.fighters[0];
        f.holding = gift::BOMB;
        f.act = act::NONE;
        f.knocked_until = 0;
        let b = &mut m.fighters[1];
        b.x = 6.0;
        b.y = 9.5;
        b.knocked_until = 0;
        b.kvx = 0.0;
        m.input(1, input::THROW, 0.0, t);
        let mut seen = Vec::new();
        for _ in 0..12 {
            t += 100;
            seen.extend(m.step(t, 100, &mut r));
        }
        assert!(seen.iter().any(|e| e.kind == ev::BOOM), "boom: {seen:?}");
    }

    #[test]
    fn bots_fight_a_whole_match_to_a_champion() {
        let mut lengths = Vec::new();
        for seed in 0..4 {
            let mut m = Match::new(ring());
            m.join(1, 0);
            m.start(1, true, 0);
            // The person leaves: with nobody left, it's called off.
            m.leave(1);
            assert_eq!(m.status, LOBBY);
            m.join(1, 0);
            m.start(1, true, 0);
            let i = m.fighters.iter().position(|f| f.id == 1).unwrap();
            m.fighters[i].bot = true;
            let mut r = rng(100 + seed);
            let mut now = 0;
            let mut rounds = 0;
            while m.status != OVER && now < 20 * 60_000 {
                now += 100;
                rounds += m
                    .step(now, 100, &mut r)
                    .iter()
                    .filter(|e| e.kind == ev::ROUND_WON)
                    .count();
            }
            assert_eq!(m.status, OVER, "seed {seed}");
            eprintln!(
                "ARENA: {}s, {rounds} rounds, crowns {:?} downs {:?} dealt {:?}",
                now / 1000,
                m.crowns,
                m.fighters
                    .iter()
                    .map(|f| (f.slot, f.downs))
                    .collect::<Vec<_>>(),
                m.fighters
                    .iter()
                    .map(|f| f.dealt as u32)
                    .collect::<Vec<_>>()
            );
            lengths.push(now / rounds.max(1) as u32);
        }
        let avg = lengths.iter().sum::<u32>() / lengths.len() as u32 / 1000;
        assert!((15..=80).contains(&avg), "a round takes {avg}s on average");
    }
}

#[cfg(test)]
mod kit_tests {
    use super::*;

    fn rng(seed: u64) -> impl FnMut() -> f64 {
        let mut s = 0x9e37_79b9u64.wrapping_mul(seed + 1) | 1;
        move || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    fn sand() -> Ring {
        Ring {
            w: 20.0,
            h: 13.0,
            pillars: vec![],
            spikes: vec![],
            oval: false,
        }
    }

    /// Two people, classes on, picked and fighting; a stood at (6, 6.5)
    /// facing b at `gap` east.
    fn duel(a: u8, b: u8, gap: f64) -> (Match, u32) {
        let mut m = Match::new(sand());
        m.join(1, 0);
        m.join(2, 0);
        m.set_bot(1, 2, false);
        m.set_bot(1, 3, false);
        assert!(m.set_kits(1, true));
        assert!(m.start(1, false, 0));
        assert!(m.choosing(10));
        assert!(m.choose_kit(1, a, 10));
        assert!(m.choosing(20), "still waiting on the other");
        assert!(m.choose_kit(2, b, 20));
        assert!(!m.choosing(30), "both picked: on with it");
        let mut r = rng(1);
        let mut now = 30;
        while m.status != FIGHTING {
            now += 100;
            m.step(now, 100, &mut r);
        }
        let (x, y) = (6.0, 6.5);
        m.fighters[0].x = x;
        m.fighters[0].y = y;
        m.fighters[0].aim = 0.0;
        m.fighters[1].x = x + gap;
        m.fighters[1].y = y;
        m.fighters[1].aim = PI;
        (m, now)
    }

    #[test]
    fn with_classes_on_each_picks_one_and_has_its_health() {
        let (m, _) = duel(kit::ARCHER, kit::TANK, 2.0);
        assert_eq!(m.fighters[0].kit, kit::ARCHER);
        assert_eq!(m.fighters[0].max_hp, KIT_HP[kit::ARCHER as usize]);
        assert_eq!(m.fighters[1].hp, KIT_HP[kit::TANK as usize]);
        // Without classes: everyone the knight.
        let mut m = Match::new(sand());
        m.join(1, 0);
        assert!(m.start(1, true, 0));
        assert!(!m.choosing(10));
        assert!(
            m.fighters
                .iter()
                .all(|f| f.kit == kit::KNIGHT && f.max_hp == HP)
        );
    }

    #[test]
    fn the_bots_pick_at_once_and_time_runs_out_for_the_slow() {
        let mut m = Match::new(sand());
        m.join(1, 0);
        m.set_kits(1, true);
        assert!(m.start(1, true, 0));
        assert!(m.choosing(100));
        assert!(
            m.fighters
                .iter()
                .filter(|f| f.bot)
                .all(|f| m.picks[f.slot] & kit::PICKED != 0)
        );
        let mut r = rng(2);
        let mut now = 0;
        while m.status == COUNTDOWN {
            now += 100;
            m.step(now, 100, &mut r);
        }
        assert!(
            now >= CHOOSE_MS + COUNTDOWN_MS,
            "waited the choosing out: {now}"
        );
        assert!(!m.choose_kit(1, kit::TANK, now), "too late");
    }

    #[test]
    fn the_archer_looses_an_arrow_that_flies_far_and_hurts() {
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 9.0);
        let mut r = rng(3);
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + 1100);
        assert_eq!(m.fighters[0].act, act::SHOOT);
        let mut hit = None;
        let mut now = t + 1100;
        for _ in 0..12 {
            now += 100;
            for e in m.step(now, 100, &mut r) {
                if e.kind == ev::HIT && e.a == 1 && e.b == 2 {
                    hit = Some(e.n);
                }
            }
        }
        hit.expect("the arrow struck");
        // Charged: three arrows, one after another, twice the quick one's damage each.
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 1.0);
        m.fighters[0].x = 1.5;
        m.fighters[1].x = 1.5 + SPEAR_RANGE + 5.0;
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + 1100);
        let mut hits = vec![];
        let mut shot = 0;
        let mut now = t + 1100;
        for _ in 0..20 {
            now += 50;
            for e in m.step(now, 50, &mut r) {
                if e.kind == ev::THROW {
                    shot += 1;
                    assert!((e.vy - BURST_SPEED).abs() < 0.01, "fast");
                }
                if e.kind == ev::HIT && e.a == 1 && e.b == 2 {
                    hits.push(e.n as f64);
                }
            }
        }
        assert_eq!(shot, BURST_ARROWS as usize);
        assert_eq!(hits.len(), 3, "all three struck, from far off: {hits:?}");
        assert!(
            hits.iter().all(|&n| (n - BURST_DMG).abs() <= 1.0),
            "{hits:?}"
        );
        // Quick: an arrow at the mouse, three a second, as far as a spear flies.
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 9.0);
        let mut shot = 0;
        let mut hit = 0;
        let mut now = t;
        for _ in 0..20 {
            m.input(1, input::LIGHT, 0.0, now);
            now += 50;
            for e in m.step(now, 50, &mut r) {
                shot += (e.kind == ev::THROW) as usize;
                hit += (e.kind == ev::HIT && e.a == 1 && e.b == 2) as usize;
            }
        }
        assert_eq!(shot, 2, "no more than one every 0.75 s");
        assert!(hit >= 1, "struck: {hit}");
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 1.0);
        m.fighters[0].x = 1.5;
        m.fighters[1].x = 1.5 + SPEAR_RANGE + 3.0;
        m.input(1, input::LIGHT, 0.0, t);
        let mut hit = false;
        for k in 1..20 {
            hit |= m
                .step(t + k * 100, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::HIT && e.a == 1);
        }
        assert!(!hit, "out of the quick shot's reach");
    }

    #[test]
    fn blows_land_anywhere_on_the_body() {
        // Straight up from the feet, at head height: the slash still lands.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 1.0);
        let mut r = rng(11);
        // (They stand below; their head's within reach, their feet aren't.)
        m.fighters[0].y = 4.0;
        m.fighters[1].x = m.fighters[0].x;
        m.fighters[1].y = 4.0 + 1.8;
        m.fighters[0].aim = PI / 2.0;
        m.input(1, input::LIGHT, PI / 2.0, t);
        let mut hit = false;
        for s in 1..6 {
            hit |= m
                .step(t + s * 100, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::HIT && e.a == 1);
        }
        assert!(hit, "reached their body, not just their feet");
    }

    #[test]
    fn the_tank_stomps_and_the_spearman_thrusts_dearly() {
        let (mut m, t) = duel(kit::TANK, kit::KNIGHT, 3.0);
        let mut r = rng(12);
        m.reach(1, 2.6);
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + 1100);
        assert_eq!(m.fighters[0].act, act::STOMP);
        let x0 = m.fighters[0].x;
        let mut stomp = false;
        for k in 1..14 {
            stomp |= m
                .step(t + 1100 + k * 100, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::STOMP);
        }
        assert!(stomp);
        assert!(m.fighters[0].x - x0 > 1.5, "hopped toward the mouse");
        let v = &m.fighters[1];
        let lost = v.max_hp - v.hp;
        assert!(lost > 5.0 && lost <= TANK_STOMP_DMG + 1.0, "{lost}");
        // The spearman's charged thrust: twice the stamina.
        let (mut m, t) = duel(kit::SPEARMAN, kit::KNIGHT, 6.0);
        let s0 = m.fighters[0].stamina;
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + 600);
        assert!(
            s0 - m.fighters[0].stamina >= HEAVY_COST * 2.0 * KIT_COST[kit::SPEARMAN as usize] - 1.0
        );
    }

    #[test]
    fn the_bomber_lobs_a_bomb_to_the_mouse() {
        let (mut m, t) = duel(kit::BOMBER, kit::KNIGHT, 4.0);
        let mut r = rng(4);
        m.reach(1, 4.0);
        m.input(1, input::LIGHT, 0.0, t);
        let mut boom = None;
        let mut now = t;
        for _ in 0..12 {
            now += 100;
            for e in m.step(now, 100, &mut r) {
                if e.kind == ev::BOOM {
                    boom = Some(e.x);
                }
            }
        }
        let x = boom.expect("it went off");
        assert!((x - 10.0).abs() < 0.6, "landed by the mouse: {x}");
        assert!(m.fighters[1].hp < m.fighters[1].max_hp, "and hurt them");
    }

    #[test]
    fn the_class_ultimates_do_their_thing() {
        // The tank's earthquake: thrown away, dazed.
        let (mut m, t) = duel(kit::TANK, kit::KNIGHT, 1.5);
        let mut r = rng(5);
        m.fighters[0].rage = RAGE;
        m.input(1, input::SPECIAL, 0.0, t);
        assert_eq!(m.fighters[0].act, act::CAST);
        assert!(m.fighters[0].immune());
        for k in 1..5 {
            m.step(t + k * 100, 100, &mut r);
        }
        let v = &m.fighters[1];
        assert!(
            v.hp < HP && v.x > 7.6,
            "hurt and thrown: {} at {}",
            v.hp,
            v.x
        );
        assert!(v.flags(t + 400) & flag::DAZED != 0, "dazed");
        // The bomber's blast: hurt all round, not them.
        let (mut m, t) = duel(kit::BOMBER, kit::KNIGHT, 2.0);
        m.fighters[0].rage = RAGE;
        m.input(1, input::SPECIAL, 0.0, t);
        for k in 1..5 {
            m.step(t + k * 100, 100, &mut r);
        }
        assert!(
            m.fighters[1].hp < m.fighters[1].max_hp - 25.0,
            "blasted: {}",
            m.fighters[1].hp
        );
        assert_eq!(m.fighters[0].hp, m.fighters[0].max_hp, "unharmed");
        // The archer's storm: a ring of arrows, and three at the mouse.
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 5.0);
        m.fighters[0].rage = RAGE;
        m.input(1, input::SPECIAL, 0.0, t);
        let mut shot = 0;
        for k in 1..20 {
            shot += m
                .step(t + k * 100, 100, &mut r)
                .iter()
                .filter(|e| e.kind == ev::THROW)
                .count();
            assert!(
                m.fighters[0].immune() || t + k * 100 >= m.fighters[0].act_until,
                "immune throughout"
            );
            if k == 4 {
                assert_eq!(shot, VOLLEY_ARROWS + VOLLEY_AIMED, "one wave so far");
            }
        }
        assert_eq!(
            shot,
            (VOLLEY_ARROWS + VOLLEY_AIMED) * VOLLEY_WAVES as usize,
            "three waves"
        );
    }

    #[test]
    fn the_bomber_throws_the_crowds_bomb_thrice_and_a_big_one_charged() {
        let (mut m, t) = duel(kit::BOMBER, kit::KNIGHT, 6.0);
        let mut r = rng(13);
        m.fighters[0].holding = gift::BOMB;
        m.input(1, input::THROW, 0.0, t);
        let mut thrown = 0;
        for k in 1..5 {
            thrown += m
                .step(t + k * 100, 100, &mut r)
                .iter()
                .filter(|e| e.kind == ev::THROW)
                .count();
        }
        assert_eq!(thrown, BOMBER_GIFT_BOMBS);
        // Charged longer: a bigger blast.
        let blast = |hold: u32| {
            let (mut m, t) = duel(kit::BOMBER, kit::KNIGHT, 4.0);
            let mut r = rng(14);
            m.reach(1, 4.0);
            m.input(1, input::HEAVY_START, 0.0, t);
            m.input(1, input::HEAVY_RELEASE, 0.0, t + hold);
            let mut n = 0;
            for k in 1..14 {
                for e in m.step(t + hold + k * 100, 100, &mut r) {
                    if e.kind == ev::BOOM {
                        n = e.n;
                    }
                }
            }
            (n, m.fighters[1].max_hp - m.fighters[1].hp)
        };
        let (small, d0) = blast(HEAVY_MIN_MS + 10);
        let (big, d1) = blast(BIG_BOMB_FULL_MS + 100);
        assert!(big > small && d1 > d0, "{small}/{d0} vs {big}/{d1}");
    }

    #[test]
    fn the_spearman_reaches_further_and_the_tank_hits_harder() {
        // A slash from 1.7 away: the spear reaches, the sword doesn't.
        for (k, lands) in [(kit::SPEARMAN, true), (kit::KNIGHT, false)] {
            let (mut m, t) = duel(k, kit::KNIGHT, 1.7);
            let mut r = rng(6);
            m.input(1, input::LIGHT, 0.0, t);
            let mut hit = false;
            for s in 1..6 {
                hit |= m
                    .step(t + s * 100, 100, &mut r)
                    .iter()
                    .any(|e| e.kind == ev::HIT && e.a == 1);
            }
            assert_eq!(hit, lands, "kit {k}");
        }
        let blow = |k: u8| {
            let (mut m, t) = duel(k, kit::KNIGHT, 1.0);
            let mut r = rng(7);
            m.input(1, input::LIGHT, 0.0, t);
            for s in 1..6 {
                m.step(t + s * 100, 100, &mut r);
            }
            HP - m.fighters[1].hp
        };
        assert!(blow(kit::TANK) > blow(kit::KNIGHT) * 1.2);
    }
    #[test]
    fn the_bots_put_on_a_match_while_nobody_plays_and_make_way() {
        let mut m = Match::new(sand());
        let mut r = rng(21);
        assert!(m.exhibit(0, &mut r));
        assert!(m.exhibition && m.running());
        assert!(m.slots.iter().filter(|&&s| s != 0).all(|&s| is_bot(s)));
        assert!(!m.exhibit(0, &mut r), "one at a time");
        let mut now = 0;
        for _ in 0..50 {
            now += 100;
            m.step(now, 100, &mut r);
        }
        // Someone comes to play: the bots' match is off, they're in the lobby.
        assert!(m.join(1, now));
        assert_eq!(m.status, LOBBY);
        assert!(!m.exhibition && m.fighters.is_empty());
        assert_eq!(m.slot_of(1), Some(0));
        assert_eq!(
            (m.mode, m.kits, m.level),
            (mode::CLASSIC, false, crate::level::MEDIUM)
        );
        // And with someone in the lobby, no exhibition.
        assert!(!m.exhibit(now, &mut r));
        // Called off by the sign: an empty lobby.
        let mut m = Match::new(sand());
        m.exhibit(0, &mut r);
        assert!(m.call_off());
        assert!(m.slots.iter().all(|&s| s == 0) && m.status == LOBBY);
        assert!(!m.call_off());
    }
    #[test]
    fn the_wheel_picks_everyones_class_and_they_keep_it() {
        let mut m = Match::new(sand());
        m.join(1, 0);
        assert!(m.set_kits(1, true));
        assert!(m.set_wheel(1, true));
        assert!(m.start(1, true, 0));
        assert!(m.choosing(10), "the wheel spins");
        assert!(!m.choose_kit(1, kit::TANK, 10), "it chooses, not you");
        assert!(m.picks.iter().all(|p| p & kit::PICKED != 0));
        assert_eq!(m.choose_end, WHEEL_MS);
        let kits: Vec<u8> = m.fighters.iter().map(|f| f.kit).collect();
        let picks = m.picks;
        // The next round: the same classes, no spin.
        m.begin_round(50_000);
        assert!(!m.choosing(50_001));
        assert_eq!(
            m.picks.map(|p| p & !kit::PICKED),
            picks.map(|p| p & !kit::PICKED)
        );
        assert_eq!(m.fighters.iter().map(|f| f.kit).collect::<Vec<_>>(), kits);
    }
}
