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
pub const HP: f64 = 150.0;
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
pub const LIGHT_COST: f64 = 11.0;
/// A heavy blow: charged for at least `HEAVY_MIN_MS`, full at `HEAVY_FULL_MS`;
/// then a short wind-up, the lunge (the blow), recovery.
pub const HEAVY_MIN_MS: u32 = 220;
pub const HEAVY_FULL_MS: u32 = 1000;
/// The spearman's lunge takes twice as long to fill.
pub const SPEAR_FULL_MS: u32 = 2 * HEAVY_FULL_MS;
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
/// A guard catches an arrow or a bomb's blast: this share gets through, at a
/// good price in stamina (out of stamina, it stops nothing).
pub const BLOCK_SHOT_TAKEN: f64 = 0.25;
pub const BLOCK_ARROW_COST: f64 = 20.0;
pub const BLOCK_BOMB_COST: f64 = 35.0;
/// An arrow storm's are tiny, and come in dozens: a share of an arrow's price.
pub const BLOCK_STORM_ARROW: f64 = 0.25;
/// What a blocked blast's knockback comes to.
pub const BLOCK_BOMB_KB: f64 = 0.35;
/// A round's disaster: spectators vote till `VOTE_UNTIL_MS` into it, the
/// stone wheel in the middle of the sand grinds round (a clear winner, it
/// stops on that; a draw, or nobody voting: on one of those level), the wedge
/// it stops on lights up, and it strikes at `DISASTER_AT_MS`.
pub const DISASTER_AT_MS: u32 = 20_000;
pub const VOTE_UNTIL_MS: u32 = 14_000;
pub const DISASTER_SPIN_MS: u32 = 4600;
/// The lava: flowing in like the fire, a touch slower, all but instantly deadly.
pub const LAVA_CLOSE_MS: u32 = 26_000;
pub const LAVA_DPS: f64 = 150.0;
/// The meteors: so long a shower, one every so often (a few at people,
/// most anywhere on the sand), each shown where it'll land this long before
/// it does; how wide a hit, how hard.
pub const METEOR_RAIN_MS: u32 = 26_000;
/// A shower swelling and dying away: meteors a second at either end of it,
/// and at its height, halfway through.
pub const METEOR_RATE: (f64, f64) = (1.0, 13.0);
pub const METEOR_WARN_MS: u32 = 1500;
pub const METEOR_R: f64 = 1.5;
pub const METEOR_DMG: f64 = 22.0;
pub const METEOR_KB: f64 = 7.5;
/// The lions: one each, in by the gates, a roar before they run.
pub const LION_HP: f64 = 24.0;
pub const LION_R: f64 = 0.34;
pub const LION_SPEED: f64 = 4.9;
pub const LION_EMERGE_MS: u32 = 1200;
/// Its pounce: from this far, crouching a moment (time to see it and get
/// clear), then through the air.
pub const LION_POUNCE_R: f64 = 3.6;
pub const LION_LEAP: f64 = 4.4;
pub const LION_CROUCH_MS: u32 = 480;
pub const LION_LEAP_MS: u32 = 260;
pub const LION_RECOVER_MS: u32 = 1300;
pub const LION_BITE_R: f64 = 1.05;
/// Anyone this close to it in the air, it hits there and then.
pub const LION_CONTACT_R: f64 = 0.7;
/// It settles on where it'll land this long before it springs.
pub const LION_LOCK_MS: u32 = 120;
pub const LION_DMG: f64 = 10.0;
pub const LION_KB: f64 = 6.0;
pub const LION_STUN_MS: u32 = 320;
/// Staggered by a heavy enough blow in its crouch.
pub const LION_STAGGER_MS: u32 = 520;
/// What the disasters do to the Goliath, against what they do to a gladiator
/// (tuned on bot matches so that neither side's handed the round).
pub const GIANT_METEOR_X: f64 = 1.3;
pub const GIANT_LION_X: f64 = 8.0;
pub const GIANT_STING_X: f64 = 3.2;
/// The lava burns the Goliath this much quicker than anyone else.
pub const GIANT_LAVA_X: f64 = 1.5;
pub const GIANT_LAVA_REACH: f64 = 0.1;
/// The lion that comes out for the Goliath: a great brown brute of a thing,
/// tougher and harder hitting, and a bigger target, but a lion in all else.
pub const BIG_LION_HP: f64 = 56.0;
pub const BIG_LION_R: f64 = 0.52;
pub const BIG_LION_X: f64 = 1.35;
/// The scorpion: what comes up with the wheel. It's a long way from a lion:
/// slow, huge, armoured. The wheel sinks, waits, and rises with it on board.
pub const SCORPION_HP: f64 = 100.0;
pub const SCORPION_R: f64 = 0.95;
pub const SCORPION_SPEED: f64 = 3.9;
/// It rushes whoever's in range, faster than anyone runs, every so often.
pub const SCORPION_RUSH_X: f64 = 2.1;
pub const SCORPION_RUSH_MS: u32 = 900;
pub const SCORPION_RUSH_EVERY_MS: u32 = 3000;
pub const SCORPION_RUSH_FROM: f64 = 3.0;
pub const SCORPION_RUSH_TO: f64 = 10.0;
/// (The wheel going down, the wait, coming back up, its roar.)
pub const SCORPION_SINK_MS: u32 = 1700;
pub const SCORPION_WAIT_MS: u32 = 700;
pub const SCORPION_RISE_MS: u32 = 2300;
pub const SCORPION_ROAR_MS: u32 = 1000;
pub const SCORPION_EMERGE_MS: u32 =
    SCORPION_SINK_MS + SCORPION_WAIT_MS + SCORPION_RISE_MS + SCORPION_ROAR_MS;
/// How far off the middle everyone's kept while the wheel's moving.
pub const PIT_R: f64 = 3.0;
/// Its sting: from this far, the tail drawn back, then the strike, and a rest.
pub const STING_REACH: f64 = 1.75;
pub const STING_WIND_MS: u32 = 460;
/// (Out of a rush, it barely draws back.)
pub const STING_QUICK_WIND_MS: u32 = 300;
pub const STING_LOCK_MS: u32 = 130;
pub const STING_STRIKE_MS: u32 = 170;
/// Two stings, one straight after the other, then its breath.
pub const STING_CHAIN_MS: u32 = 220;
pub const STING_REST_MS: u32 = 680;
pub const STING_HIT_R: f64 = 1.05;
/// Its dart, at anyone a long way off: spat every so often, a guard stops it dead.
pub const DART_FROM: f64 = 6.5;
pub const DART_EVERY_MS: u32 = 2300;
pub const DART_WIND_MS: u32 = 440;
pub const DART_SPEED: f64 = 13.0;
pub const DART_RANGE: f64 = 24.0;
pub const DART_DMG: f64 = 3.0;
pub const DART_BLOCK_COST: f64 = 12.0;
/// Its poison: so long, so much health a second, so much of your speed left.
pub const POISON_MS: u32 = 3000;
pub const POISON_DPS: f64 = 2.5;
pub const POISON_SLOW: f64 = 0.9;
/// The acid rain: little clouds drifting across, each burning what's under it.
/// The clouds come in waves, a few, then a sky full, then a few: each wave's
/// size, and how long till the next. They cross one way, then the other, in
/// `ACID_LANES` lanes (never all at once: there's always a way through).
pub const ACID_WAVES: [usize; 8] = [2, 3, 5, 6, 6, 5, 3, 2];
pub const ACID_WAVE_GAP_MS: u32 = 3500;
pub const ACID_LANES: usize = 7;
/// (Those of a wave don't come in a line.)
pub const ACID_JITTER_MS: u32 = 1300;
pub const ACID_SPEED: f64 = 1.9;
/// How far off the sand they start and finish.
pub const ACID_OFF: f64 = 6.0;
pub const ACID_RX: f64 = 2.5;
pub const ACID_RY: f64 = 1.5;
/// How much later the last sets out than the first.
pub const ACID_TICK_MS: u32 = 500;
pub const ACID_DMG: f64 = 9.0;
pub const GIANT_ACID_X: f64 = 3.0;
/// (What the scorpion signs its darts with.)
pub const SCORPION_BY: u32 = 0xffff_ee00;
/// `strike`-less shove off the wheel: a `HIT` of nothing, just the knock.
pub const SHOVE_BIT: u16 = 4096;
/// How long it lies there, dead, before it goes.
pub const LION_GONE_MS: u32 = 1800;
/// A little scorpion, after whatever's lain about too long: left this long
/// (and a bit, by chance), one creeps out from behind it, comes round and
/// hooks it, and drags it about the sand. Tread on it and it stings; hit it,
/// with anything at all, and it's done for and drops what it's got.
pub const THIEF_AFTER_MS: u32 = 13_000;
pub const THIEF_AFTER_JITTER_MS: u32 = 9000;
pub const THIEF_MAX: usize = 2;
pub const THIEF_HP: f64 = 1.0;
pub const THIEF_R: f64 = 0.3;
/// Peeking out, then round to the front; then the hook, and a tug.
pub const THIEF_PEEK_MS: u32 = 800;
pub const THIEF_ROUND_MS: u32 = 800;
pub const THIEF_SNATCH_MS: u32 = 650;
pub const THIEF_SPEED: f64 = 2.0;
/// Anyone this close and it bolts (nobody's outrun by it).
pub const THIEF_SHY_R: f64 = 3.2;
pub const THIEF_BOLT_SPEED: f64 = 3.5;
/// It won't start with anyone this close.
pub const THIEF_WARY_R: f64 = 2.6;
/// How close counts as treading on it (beyond their body), what it costs, and
/// how long before it can sting again.
pub const THIEF_STEP_R: f64 = 0.22;
pub const THIEF_DMG: f64 = 15.0;
pub const THIEF_KB: f64 = 2.5;
pub const THIEF_STUN_MS: u32 = 150;
pub const THIEF_STING_EVERY_MS: u32 = 1500;
pub const GIANT_THIEF_X: f64 = 2.0;
/// Robbed of what it came for, it runs a little, then digs itself in.
pub const THIEF_GIVE_UP_MS: u32 = 2200;
pub const THIEF_BURROW_MS: u32 = 500;
pub const THIEF_ID: u8 = 200;
/// `Flight::Hit`'s index for a lion: this, plus which one.
const LION_HIT: usize = 1000;
/// `hit_list`'s id for a lion: this, plus its id.
const LION_KEY: u32 = 0xffff_f000;
/// A blast this close (a bomb at their feet) is blocked whichever way they face.
pub const BLOCK_BOMB_CLOSE: f64 = 0.6;
/// The tank's shield (and the Goliath's guard) knocks a bomb back into whoever threw it, at
/// over twice the stamina the throw took, so a bomber can wear them down, and a
/// big enough bomb can't be sent back at all (a found bomb, as a quick lob's).
pub const BOUNCE_COST_X: f64 = 2.2;
pub const GIANT_BOUNCE_COST_X: f64 = 2.7;
pub const BOUNCE_SPEED: f64 = BOMB_SPEED * 2.0;
/// What kind of shot a blow is (`strike`'s bits, past those the client's told).
const SHOT_ARROW: u16 = 512;
const SHOT_BOMB: u16 = 1024;
const SHOT_STORM: u16 = 2048;
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
/// A charge held down through a blow still finishing waits as long as this:
/// it's held, not a press to forget (a tank's swing alone outlasts the buffer).
pub const HELD_CHARGE_BUFFER_MS: u32 = 2000;
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
pub const FIRE_AFTER_MS: u32 = 50_000;
pub const FIRE_CLOSE_MS: u32 = 22_000;
/// How far it closes (as a fraction of the ring, middle to side), and how hot it is.
pub const FIRE_MIN: f64 = 0.28;
pub const FIRE_DPS: f64 = 12.0;
/// The crowd throws a gift in this often (ms, plus up to `GIFT_JITTER_MS`).
pub const GIFT_EVERY_MS: u32 = 5300;
pub const GIFT_JITTER_MS: u32 = 3300;
pub const GIFT_FALL_MS: u32 = 900;
/// At most this many on the sand at once (each lies there till it's taken).
pub const GIFT_MAX: usize = 3;
pub const FURY_MS: u32 = 8000;
pub const HEAL: f64 = 53.0;
/// Hermes' boots: this much faster, for this long.
pub const SPEED_GIFT_X: f64 = 1.5;
pub const SPEED_GIFT_MS: u32 = 6000;
/// The potion of regeneration: half as much again as a roast leg (`HEAL`),
/// but slowly, over this long.
pub const REGEN_HEAL: f64 = 1.5;
pub const REGEN_MS: u32 = 15_000;
/// What the Goliath gets of them. It eats twice as much (`GIANT_GIFT_HEAL`,
/// the potion too), its fury and its boots last longer, its shield takes
/// two blows, and a bomb in its hands is one big bomb.
pub const GIANT_FURY_MS: u32 = 14_000;
pub const GIANT_SPEED_GIFT_MS: u32 = 11_000;
pub const GIANT_SHIELDS: u8 = 2;
pub const GIANT_BOMB_DMG: f64 = 48.0;
/// Each spike plate's cycle, its warning and how long the spikes are up.
/// Each plate pokes once in every `SPIKE_EVERY_MS`, at no set moment: a
/// quick rattle, then up and straight back down.
pub const SPIKE_EVERY_MS: u32 = 4000;
pub const SPIKE_WARN_MS: u32 = 450;
pub const SPIKE_UP_MS: u32 = 350;
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
pub const KIT_HP: [f64; 5] = [162.0, 157.0, 143.0, 166.0, 226.0];
pub const KIT_SPEED: [f64; 5] = [1.0, 1.176, 1.0, 1.0, 0.84];
pub const KIT_LIGHT_REACH: [f64; 5] = [1.35, 1.3, 1.3, 1.95, 2.05];
pub const KIT_LIGHT_ARC: [f64; 5] = [1.0, 0.6, 0.6, 0.8, 1.35];
pub const KIT_LIGHT_DMG: [f64; 5] = [1.0, 0.6, 0.65, 1.08, 1.5];
pub const KIT_LIGHT_TIME: [f64; 5] = [1.0, 0.45, 0.45, 1.08, 1.3];
/// The wind-up on top of that: the tank hauls its hammer back before it comes round.
pub const KIT_LIGHT_WINDUP: [f64; 5] = [1.0, 1.0, 1.0, 1.0, 1.5];
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
pub const WHEEL_MS: u32 = 8000;
/// Firing: the bow drawn back (the archer's charged blow) or a bomb lobbed
/// (the bomber's): the moment it goes, and the recovery after.
pub const SHOOT: (u32, u32) = (90, 260);
pub const ARROW_SPEED: f64 = 22.0;
/// Arrows no heavier than this (the storm's) don't reel whoever they hit.
pub const QUICK_ARROW_DMG: f64 = 6.0;
/// The archer's and the bomber's quick blow, a short blade: wind-up, thrust,
/// recovery. Not much alone, but five a second for very little stamina; a
/// tiny shove, no reel (it's far too quick to be allowed to lock anyone down),
/// and a guard shrugs it off (`STAB_BLOCK_COST`).
pub const STAB: (u32, u32, u32) = (40, 50, 90);
pub const STAB_DMG: f64 = 6.0;
pub const STAB_KB: f64 = 1.3;
pub const STAB_COST: f64 = 4.5;
pub const STAB_BLOCK_COST: f64 = 3.0;
/// (`Event.m`:) a stab.
const STAB_BIT: u16 = 8192;
/// The archer's charged shot: an arrow, barely held; two, half drawn; three
/// fully drawn, one after another, flying on till they hit something, 1.7× as
/// fast as the storm's. It costs more the further it's drawn.
pub const BURST_ARROWS: u8 = 3;
pub const BURST_GAP_MS: u32 = 110;
pub const BURST_DMG: f64 = 6.5;
pub const DRAWN_DMG: f64 = 5.5;
pub const BURST_SPEED: f64 = ARROW_SPEED * 1.7;
pub const BURST_COST: f64 = 26.0;
pub const BURST_MIN_COST: f64 = 10.0;
/// (As far as "till they hit something" goes.)
pub const BURST_RANGE: f64 = 1000.0;
/// (The storm's arrows fly this far.)
pub const ARROW_RANGE: f64 = 14.0;
/// The bomber's bombs: lobbed to the mouse (from `LOB_MIN` to `LOB_RANGE`).
pub const LOB_MIN: f64 = 2.2;
pub const LOB_RANGE: f64 = 7.0;
/// A bomb knocked back costs at least this (times the shield's `BOUNCE_COST_X`).
pub const BOUNCE_MIN_COST: f64 = 20.0;
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
pub const TANK_LEAP: f64 = 4.2;
pub const TANK_STOMP_R: f64 = 1.6;
pub const TANK_STOMP_DMG: f64 = 20.0;
pub const TANK_STOMP_KB: f64 = 11.0;
pub const TANK_STOMP_DAZE_MS: u32 = 600;
/// How tall a body stands (tiles above its feet): a blow or a missile
/// anywhere on it counts, not just at its feet.
pub const BODY_H: f64 = 0.9;
pub const GIANT_H: f64 = 2.5;
/// The archer's, the bomber's and the tank's ultimates: a wind-up (they
/// can't be touched), then the rest of it.
pub const CAST: (u32, u32) = (320, 260);
/// The archer's: three rings of arrows all round (and a few more at the
/// mouse), half a second apart.
pub const VOLLEY_WAVES: u8 = 3;
pub const VOLLEY_GAP_MS: u32 = 500;
pub const VOLLEY_ARROWS: usize = 16;
pub const VOLLEY_DMG: f64 = 1.65;
pub const VOLLEY_AIMED: usize = 3;
pub const VOLLEY_AIMED_DMG: f64 = 2.475;
pub const VOLLEY_SPREAD: f64 = 0.12;
/// The bomber's: a great blast all round them (they're unharmed).
pub const BLAST_R: f64 = 3.3;
pub const BLAST_DMG: f64 = 44.0;
/// The tank's: an earthquake, a stomp throwing everyone near away, dazed.
pub const QUAKE_R: f64 = 3.7;
pub const QUAKE_DMG: f64 = 24.0;
pub const QUAKE_KB: f64 = 14.0;
pub const QUAKE_DAZE_MS: u32 = 800;
/// What's flying besides the crowd's gifts (`Missile::kind`).
pub mod missile {
    pub const ARROW: u8 = 5;
    /// The bomber's big bomb.
    pub const BIG_BOMB: u8 = 6;
    /// The scorpion's dart.
    pub const DART: u8 = 7;
}

/// The kinds of match (`Match::mode`): everyone for themselves, or the
/// Goliath against the rest.
pub mod mode {
    pub const CLASSIC: u8 = 0;
    pub const GOLIATH: u8 = 1;
    /// Two against two: places 0 and 1 against 2 and 3. Friends' blows pass
    /// them by, the last team up takes a crown each, and three crowns wins it.
    pub const TEAMS: u8 = 2;
}
/// How often the bots' own matches have the disaster wheel on.
pub const EXHIBIT_DISASTERS: f64 = 0.8;
/// What a spectator stakes on a round, and how long after it's begun they have
/// to make up their mind (and all the countdown before it).
pub const BET_STAKE: i32 = 10;
pub const BET_OPEN_MS: u32 = 5000;
/// What comes back for a good bet, for each thing there was to bet on (so a
/// little under the fair price: 18 on a side, 36 on one of four).
pub const BET_PAY_PER_SIDE: i32 = 9;
/// The Goliath: a giant, much tougher and slower, too heavy to roll; bigger to hit.
pub const GIANT_HP: f64 = 600.0;
pub const GIANT_SPEED: f64 = 0.95;
pub const GIANT_R: f64 = 0.63;
/// Its stamina comes back slower than a gladiator's used to (a share of `STAMINA_REGEN`).
pub const GIANT_REGEN: f64 = 0.5;
/// A gladiator's stamina comes back at this share of `STAMINA_REGEN` (40% slower).
pub const GLADIATOR_REGEN: f64 = 0.52;
/// Standing still this long (doing nothing), it heals, very slowly (health a second).
pub const GIANT_REST_MS: u32 = 1500;
pub const GIANT_REST_HPS: f64 = 1.5;
/// And a gladiator the same, slower still.
pub const REST_MS: u32 = 2000;
pub const REST_HPS: f64 = 0.6;
/// How long healing shows after a roast leg.
pub const FED_SHOW_MS: u32 = 1000;
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
pub const SMASH_DMG: f64 = 12.5;
pub const SMASH_REACH: f64 = 4.3;
pub const SMASH_ARC: f64 = 0.9;
pub const SMASH_COST: f64 = 14.0;
/// Out of stamina, the Goliath still smashes, only slower (its wind-up and
/// recovery this many times as long) and softer (this much of the blow).
pub const TIRED_SMASH: f64 = 1.8;
pub const TIRED_SMASH_DMG: f64 = 0.7;
/// Its charged blow, the stomp: a crouch, a leap forward, and a shockwave
/// where it lands; then recovery. Everything about it grows with how long
/// it was charged (full at `GIANT_CHARGE_MS`): from a hop of
/// `STOMP_LEAP_MIN` to a leap of `STOMP_LEAP`; its damage, its fling, the
/// daze it leaves, from a share (`STOMP_MIN`) of the most up to it.
pub const GIANT_CHARGE_MS: u32 = 1800;
pub const STOMP: (u32, u32, u32) = (200, 520, 460);
pub const STOMP_LEAP_MIN: f64 = 1.0;
pub const STOMP_LEAP: f64 = 8.5;
pub const STOMP_R: f64 = 2.3;
pub const STOMP_DMG: f64 = 19.0;
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
/// Whirling them, a click throws them at once (not in the very first
/// moment of the grab, so the click that was still going doesn't).
pub const GRAB_THROW_AFTER_MS: u32 = 250;
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
    /// Hermes' boots: quicker for a while.
    pub const SPEED: u8 = 5;
    /// A potion of regeneration: health coming back slowly.
    pub const REGEN: u8 = 6;
    /// A shield: a bubble round you that takes the next blow.
    pub const SHIELD: u8 = 7;
    pub const ALL: [u8; 7] = [HEALTH, SPEAR, BOMB, FURY, SPEED, REGEN, SHIELD];

    /// Used the moment it's picked up (the rest are carried, to throw).
    pub fn instant(kind: u8) -> bool {
        !matches!(kind, SPEAR | BOMB)
    }
}

/// What a gift's done for a fighter (protocol `ArenaFighter.buffs`).
pub mod buff {
    pub const SPEED: u8 = 1;
    pub const REGEN: u8 = 2;
    pub const SHIELD: u8 = 4;
    /// A second blow's worth of shield (the Goliath's).
    pub const SHIELD2: u8 = 8;
    /// Their wounds closing, standing still or just fed.
    pub const HEAL: u8 = 16;
    /// The scorpion's poison in them.
    pub const POISON: u8 = 32;
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
    /// `a`'s blow burst `b`'s shield (`n` blows of it left): no harm done.
    pub const SHIELD: u8 = 26;
    /// `b`'s shield knocked `a`'s bomb back at them.
    pub const BOUNCE: u8 = 27;
    /// The round's disaster is settled (`n`: which), though not here yet.
    pub const DISASTER_PICKED: u8 = 28;
    /// It strikes (`n`: which).
    pub const DISASTER: u8 = 29;
    /// A meteor's coming down at (x, y) in `n` ms (`m`: its blast, ×100).
    pub const METEOR_WARN: u8 = 30;
    /// It lands.
    pub const METEOR: u8 = 31;
    /// A lion comes out at (x, y) (`b`: which).
    pub const LION_OUT: u8 = 32;
    /// `b`'s poisoned.
    pub const POISONED: u8 = 38;
    /// The scorpion draws its tail back, at `b` (`a`: its id; `n`: 1 for a dart).
    pub const SCORPION_WIND: u8 = 39;
    /// It strikes at (x, y).
    pub const SCORPION_STING: u8 = 40;
    /// A dart reached `b` (`n`: 1 if a guard stopped it).
    pub const DART_HIT: u8 = 41;
    /// The acid burnt `b` for `n`.
    pub const ACID_BURN: u8 = 42;
    /// Lion `b` crouches to pounce.
    pub const LION_CROUCH: u8 = 33;
    /// It leaps.
    pub const LION_LEAP: u8 = 34;
    /// It comes down.
    pub const LION_LAND: u8 = 35;
    /// `a` hit lion `b` for `n`.
    pub const LION_HIT: u8 = 36;
    /// `a` killed lion `b`.
    pub const LION_DOWN: u8 = 37;
    /// A little scorpion, `b`, creeps out for the gift at (x, y).
    pub const THIEF_OUT: u8 = 43;
    /// It has it (`n`).
    pub const THIEF_GRAB: u8 = 44;
    /// `b` trod on one.
    pub const THIEF_STING: u8 = 45;
}

/// A round's disasters.
pub mod disaster {
    pub const NONE: u8 = 0;
    pub const LAVA: u8 = 1;
    pub const METEORS: u8 = 2;
    pub const LIONS: u8 = 3;
    pub const SCORPION: u8 = 4;
    pub const ACID: u8 = 5;
    pub const COUNT: u8 = 5;
    /// How far along it is: spectators voting; the wheel between those level;
    /// settled, on its way; striking.
    pub const VOTING: u8 = 0;
    pub const SPIN: u8 = 1;
    pub const DECIDED: u8 = 2;
    pub const ON: u8 = 3;
}

/// What a lion's doing.
pub mod lion {
    pub const EMERGE: u8 = 0;
    pub const PROWL: u8 = 1;
    pub const CROUCH: u8 = 2;
    pub const LEAP: u8 = 3;
    pub const RECOVER: u8 = 4;
    pub const DEAD: u8 = 5;
    /// (The scorpion:) drawing its tail back to spit a dart.
    pub const SPIT: u8 = 6;
    /// (The little scorpion:) creeping round what it's after.
    pub const SNEAK: u8 = 7;
    /// Hooking it.
    pub const SNATCH: u8 = 8;
    /// (Either:) going flat out: a rush, or bolting.
    pub const RUSH: u8 = 9;
    /// (The little one:) digging itself in, and gone.
    pub const BURROW: u8 = 10;
}

/// A lion, let loose on the sand: not a fighter (it plays no part in who's won).
#[derive(Debug, Clone)]
pub struct Lion {
    pub id: u8,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    pub hp: f64,
    pub act: u8,
    pub act_at: u32,
    /// Till then, it's busy with `act`.
    pub act_until: u32,
    /// Whom it's after.
    pub target: u32,
    /// Its pounce: where it comes down, and how far of the way it's gone.
    pub to: (f64, f64),
    pub from: (f64, f64),
    /// It's pounced once: from now on it goes for whoever's nearest.
    pub pounced: bool,
    /// Knocked back by a blow.
    pub kvx: f64,
    pub kvy: f64,
    /// It's the scorpion (`act`s as a lion's: `CROUCH` its tail drawn back,
    /// `LEAP` the sting), and when it can spit again.
    pub scorpion: bool,
    pub next_dart: u32,
    /// When it can rush again.
    pub next_rush: u32,
    /// It's a thief (`next_dart`: when it can sting again), and what it's dragging.
    pub thief: bool,
    pub item: u8,
    /// (A lion:) the Goliath's own, the big brown one. (The scorpion:) still
    /// after whoever it first went for, till it's stung.
    pub big: bool,
}

impl Lion {
    /// How big a target it is.
    pub fn r(&self) -> f64 {
        if self.scorpion {
            SCORPION_R
        } else if self.thief {
            THIEF_R
        } else if self.big {
            BIG_LION_R
        } else {
            LION_R
        }
    }

    /// Whether it can be hurt (nothing touches the scorpion till it's up).
    fn exposed(&self) -> bool {
        self.act != lion::DEAD
            && self.act != lion::BURROW
            && !(self.scorpion && self.act == lion::EMERGE)
    }
}

/// An acid cloud, crossing the sand at a steady pace.
#[derive(Debug, Clone, Copy)]
pub struct Cloud {
    /// Where it started, at `delay` (when it sets out), and which way it's going.
    pub x0: f64,
    pub y: f64,
    pub dir: f64,
    pub delay: u32,
    pub id: u8,
}

impl Cloud {
    pub fn x(&self, now: u32) -> f64 {
        self.x0 + self.dir * ACID_SPEED * now.saturating_sub(self.delay) as f64 / 1000.0
    }
}

/// A meteor on its way down.
#[derive(Debug, Clone, Copy)]
pub struct Meteor {
    pub x: f64,
    pub y: f64,
    pub at: u32,
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

/// The smash's wind-up, blow and recovery (ms): slower when tired.
pub fn smash_times(tired: bool) -> (u32, u32, u32) {
    let (w, a, r) = SMASH;
    if tired {
        (
            (w as f64 * TIRED_SMASH) as u32,
            a,
            (r as f64 * TIRED_SMASH) as u32,
        )
    } else {
        (w, a, r)
    }
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
    /// The stamina it took to throw (a bomb's).
    pub cost: f64,
    /// Knocked back by a shield: who it's after (0: nobody; it goes off wherever it stops).
    pub chase: u32,
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
            cost: 0.0,
            chase: 0,
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
    /// When a thief may come for it.
    pub stale: u32,
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
    /// How hard it hunts (Extreme): the Goliath leaping at any range and
    /// cutting people off against the walls, gladiators staying on someone,
    /// finishing the hurt, pinning them and getting out from under bombs.
    hunt: f64,
}

const VS_GIANT_EASY: f64 = 0.55;
const VS_GIANT_MEDIUM: f64 = 1.6;
const VS_GIANT_HARD: f64 = 3.0;
const VS_GIANT_EXTREME: f64 = 4.0;
/// An Extreme bot Goliath is built tougher: this share of each blow gets
/// through (the pack on Extreme dodge and punish well enough to need it).
const EXTREME_GIANT_TAKEN: f64 = 0.6;

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
            hunt: 0.0,
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
            hunt: 0.0,
        },
        crate::level::EXTREME => Skill {
            wobble: 0.04,
            defend: 1.3,
            react: (225.0, 105.0),
            think: (90.0, 60.0),
            read: 0.88,
            gap: (220.0, 300.0),
            combo: 3.0,
            punish: 1.0,
            lunge: 0.16,
            speed: 1.0,
            spike_ms: 800,
            gift_r: 11.0,
            throw: 0.9,
            press: 1,
            cunning: 1.0,
            vs_giant: VS_GIANT_EXTREME,
            giant_gap: 0.55,
            hunt: 1.0,
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
            hunt: 0.0,
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
    /// Hermes' boots till then; the potion till then, at so many health a second; blows the shield will take.
    pub speed_until: u32,
    pub regen_until: u32,
    pub regen_hps: f64,
    pub shields: u8,
    pub stamina_used: u32,
    /// Out of breath till then (stamina ran right out).
    pub winded_until: u32,
    /// A whirlwind asked for while busy, and when (0: none).
    pub special_at: u32,
    /// The Goliath: a smash or a stomp's charge asked for while it was still
    /// busy (finishing a blow, landing), and when: it goes as soon as it's free.
    pub pending: (u8, u32, f64),
    /// That charge's been let go already: it goes as soon as it's begun.
    pub release_wanted: bool,
    /// Which side they're on (in a free-for-all, each their own).
    pub team: u8,
    /// A roll asked for while they couldn't (when, which way).
    pub roll_wanted: (u32, f64),
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
    /// Where they were last tick, and since when they've stood still (resting, they heal).
    pub last_pos: (f64, f64),
    pub still_since: u32,
    /// Till when they show healing (`buff::HEAL`).
    pub healing_until: u32,
    /// Till when they're poisoned.
    pub poison_until: u32,
    /// Its class (`kit`), and its health in full (by it; the Goliath's its own).
    pub kit: u8,
    pub max_hp: f64,
    /// Firing (or casting): how many it's let go so far, and whether it's the quick shot.
    pub shots: u8,
    /// The Goliath's smash, swung with no stamina left for it: slower (`TIRED_SMASH`).
    pub tired: bool,
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
            speed_until: 0,
            regen_until: 0,
            regen_hps: 0.0,
            shields: 0,
            stamina_used: 0,
            winded_until: 0,
            special_at: 0,
            pending: (0, 0, 0.0),
            release_wanted: false,
            team: 0,
            roll_wanted: (0, 0.0),
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
            healing_until: 0,
            poison_until: 0,
            kit: kit::KNIGHT,
            max_hp: HP,
            shots: 0,
            tired: false,
        }
    }

    /// How long its charged attack takes to fill (the bomber's big bomb and the spearman's lunge, longer).
    pub fn full_ms(&self) -> u32 {
        match self.kit {
            kit::BOMBER if !self.giant => BIG_BOMB_FULL_MS,
            kit::SPEARMAN if !self.giant => SPEAR_FULL_MS,
            _ => HEAVY_FULL_MS,
        }
    }

    /// What knocking a bomb back costs them.
    fn bounce_cost(&self, m: &Missile) -> f64 {
        m.cost.max(BOUNCE_MIN_COST)
            * if self.giant {
                GIANT_BOUNCE_COST_X
            } else {
                BOUNCE_COST_X
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
        if self.shoots() {
            return STAB;
        }
        let (w, a, r) = LIGHT[n];
        let t = KIT_LIGHT_TIME[self.k()];
        let s = |v: u32| (v as f64 * t).round() as u32;
        let w = (w as f64 * KIT_LIGHT_WINDUP[self.k()]).round() as u32;
        (s(w), s(a), s(r))
    }

    /// How many arrows that draw of the bow lets go.
    fn arrows(&self) -> u8 {
        1 + (self.charge * (BURST_ARROWS - 1) as f64) as u8
    }

    /// What its quick blow costs.
    pub fn light_cost(&self) -> f64 {
        if self.shoots() { STAB_COST } else { LIGHT_COST }
    }

    /// Whether a roll would go, right now.
    fn can_roll(&self, now: u32) -> bool {
        self.can_cancel(now) && now >= self.roll_ready && !self.winded(now)
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

    /// Whether they've the wind for their charged attack: short of it, it
    /// doesn't even start (at its cheapest: the bomber's grows with the fuse).
    pub fn can_charge(&self, now: u32) -> bool {
        let cost = if self.giant {
            STOMP_COST
        } else {
            KIT_COST[self.kit as usize]
                * match self.kit {
                    kit::ARCHER => BURST_MIN_COST,
                    kit::BOMBER => BIG_BOMB_COST.0,
                    _ => HEAVY_COST * KIT_HEAVY_COST[self.k()],
                }
        };
        !self.winded(now) && self.stamina >= cost * 0.5
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

    /// The Goliath's smash: with the stamina for it, or (out of breath) a
    /// slower one (`TIRED_SMASH`: the swing's event says so, `m` 1).
    fn start_smash(&mut self, now: u32, evs: &mut Vec<Event>) {
        let tired = !self.spend(SMASH_COST, now);
        let (w, a, r) = smash_times(tired);
        self.set(act::SMASH, now, w + a + r);
        self.tired = tired;
        let mut e = Event::new(ev::SWING, self.id, 0, self.x, self.y, act::SMASH as u16);
        e.m = tired as u16;
        evs.push(e);
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

    /// Let go of a charge that's still waiting for them to be free: held long
    /// enough, it's a charged blow all the same, as soon as it can be; else a slash.
    fn let_go(&mut self, now: u32, aim: f64) {
        if now.saturating_sub(self.pending.1) >= HEAVY_MIN_MS {
            self.release_wanted = true;
            // (Time enough left to go, however long they've waited.)
            let left = now.saturating_sub(HELD_CHARGE_BUFFER_MS - INPUT_BUFFER_MS);
            self.pending = (input::HEAVY_START, self.pending.1.max(left), aim);
        } else {
            self.pending = (input::LIGHT, now, aim);
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
    }

    /// What the gifts are doing for them (`buff`).
    pub fn buffs(&self, now: u32) -> u8 {
        let mut b = 0;
        if now < self.speed_until {
            b |= buff::SPEED;
        }
        if now < self.regen_until {
            b |= buff::REGEN;
        }
        if self.shields > 0 {
            b |= buff::SHIELD;
        }
        if self.shields > 1 {
            b |= buff::SHIELD2;
        }
        if now < self.healing_until {
            b |= buff::HEAL;
        }
        if now < self.poison_until {
            b |= buff::POISON;
        }
        b
    }

    /// How much quicker the gifts make them.
    fn speed_x(&self, now: u32) -> f64 {
        (if now < self.speed_until {
            SPEED_GIFT_X
        } else {
            1.0
        }) * if now < self.poison_until {
            POISON_SLOW
        } else {
            1.0
        }
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

/// Whether (x, y) is under a cloud at (cx, cy).
fn in_cloud(cx: f64, cy: f64, x: f64, y: f64) -> bool {
    ((x - cx) / ACID_RX).powi(2) + ((y - cy) / ACID_RY).powi(2) < 1.0
}

/// How far a shooter's quick shot's any use.
/// Sameness for what needn't be random, or can't be: 0..1, always the same
/// for the same (a, b).
fn noise(a: u32, b: u32) -> f64 {
    let mut h = a.wrapping_mul(0x9e37_79b1) ^ b.wrapping_mul(0x85eb_ca77).rotate_left(13);
    h ^= h >> 15;
    h = h.wrapping_mul(0xc2b2_ae3d);
    h ^= h >> 13;
    (h & 0xffff) as f64 / 65_536.0
}

fn quick_range(k: u8) -> f64 {
    if k == kit::ARCHER {
        SPEAR_RANGE - 1.5
    } else {
        LOB_RANGE
    }
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
    /// The round's disaster (`disaster`), how far along (and till when), the
    /// spectators' votes, and those level on the wheel (bits: 1 << kind).
    pub disaster_kind: u8,
    pub disaster_stage: u8,
    pub disaster_end: u32,
    pub disaster_pool: u8,
    votes: Vec<(u32, u8)>,
    /// When the lava began (0: none).
    lava_at: u32,
    pub lions: Vec<Lion>,
    pub meteors: Vec<Meteor>,
    /// The shower: the next one, and when it ends.
    next_meteor: u32,
    meteors_end: u32,
    pub clouds: Vec<Cloud>,
    next_acid: u32,
    /// How many it's dropped: it works its way all over the sand by this.
    meteors_dropped: u32,
    /// Thieves sent so far (for their ids).
    thieves: u32,
    /// The round's disasters on at all (set in the lobby).
    pub disasters: bool,
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
    /// The wheel of classes (with classes on): before every round it spins
    /// for everyone, and gives each a class other than the one they just had.
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
            disaster_kind: disaster::NONE,
            disaster_stage: disaster::VOTING,
            disaster_end: 0,
            disaster_pool: 0,
            votes: Vec::new(),
            lava_at: 0,
            lions: Vec::new(),
            meteors: Vec::new(),
            next_meteor: 0,
            meteors_end: 0,
            clouds: Vec::new(),
            next_acid: 0,
            meteors_dropped: 0,
            thieves: 0,
            disasters: false,
            mode: mode::CLASSIC,
            goliath: 0,
            kits: false,
            choose_end: 0,
            picks: [0; SLOTS],
            exhibition: false,
            wheel: false,
        }
    }

    /// In the lobby, someone with a place turns the disasters on or off.
    /// Returns whether it changed.
    pub fn set_disasters(&mut self, by: u32, on: bool) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || self.disasters == on {
            return false;
        }
        self.disasters = on;
        true
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
        let pick = rng();
        self.mode = if n == SLOTS && pick < 0.25 {
            mode::GOLIATH
        } else if n == SLOTS && pick < 0.5 {
            mode::TEAMS
        } else {
            mode::CLASSIC
        };
        self.goliath = (rng() * n as f64) as usize % n;
        self.kits = rng() < 0.65;
        self.wheel = self.kits && rng() < 0.4;
        self.disasters = rng() < EXHIBIT_DISASTERS;
        self.level = if rng() < 0.5 {
            crate::level::HARD
        } else {
            crate::level::EXTREME
        };
        self.exhibition = true;
        self.begin_match(now);
        true
    }

    /// Nobody's left in the lobby but bots: them gone too, and the usual settings.
    pub fn clear_lobby(&mut self) {
        if self.status == LOBBY && self.humans() == 0 {
            self.slots = [0; SLOTS];
            self.mode = mode::CLASSIC;
            self.kits = false;
            self.wheel = false;
            self.disasters = false;
            self.level = crate::level::MEDIUM;
        }
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
        let t = now.saturating_sub(self.round_at);
        let beat = t / SPIKE_EVERY_MS;
        let into = t % SPIKE_EVERY_MS;
        let room = SPIKE_EVERY_MS - SPIKE_WARN_MS - SPIKE_UP_MS;
        let at = (noise(self.round_at ^ (k as u32 + 1) << 20, beat) * room as f64) as u32;
        // (Not in the first moments of a round.)
        let phase = if beat == 0 || into < at {
            0
        } else if into < at + SPIKE_WARN_MS {
            1
        } else if into < at + SPIKE_WARN_MS + SPIKE_UP_MS {
            2
        } else {
            0
        };
        (phase, beat * 16 + k as u32 + 1)
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
        let m = if m == mode::GOLIATH || m == mode::TEAMS {
            m
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
        self.mode == mode::CLASSIC || self.fighters[i].team != self.fighters[j].team
    }

    /// Which side place `slot` is on: the gladiators 0 and the Goliath 1;
    /// one team or the other; or (a free-for-all) each their own.
    pub fn side_of(&self, slot: usize) -> u8 {
        match self.mode {
            mode::GOLIATH => (slot == self.goliath) as u8,
            mode::TEAMS => (slot / 2) as u8,
            _ => slot as u8,
        }
    }

    /// How long bets are still being taken (ms): all the way to the fight, and
    /// the first moments of it.
    pub fn bet_ms(&self, now: u32) -> u32 {
        match self.status {
            COUNTDOWN => self.phase_end.saturating_sub(now) + BET_OPEN_MS,
            FIGHTING => (self.round_at + BET_OPEN_MS).saturating_sub(now),
            _ => 0,
        }
    }

    /// Whether `pick` is something to bet on (see `side_of`).
    pub fn bet_ok(&self, pick: u8) -> bool {
        if self.mode == mode::CLASSIC {
            self.fighters.iter().any(|f| f.team == pick)
        } else {
            pick < 2
        }
    }

    /// What a good bet pays.
    pub fn bet_pay(&self) -> i32 {
        let sides = if self.mode == mode::CLASSIC {
            self.fighters.len()
        } else {
            2
        };
        BET_PAY_PER_SIDE * sides as i32
    }

    /// The side that took the round `winner` won (none if nobody did).
    pub fn won_by(&self, winner: u32) -> Option<u8> {
        self.fighter(winner).map(|f| f.team)
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
        if self.mode == mode::CLASSIC {
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
        // Two against two, a side each, west and east.
        if self.mode == mode::TEAMS {
            let dy = if slot % 2 == 0 { -2.4 } else { 2.4 };
            let x = |d: f64| if slot < 2 { d } else { w - d };
            return open(
                &[
                    (x(5.5), h / 2.0 + dy),
                    (x(3.2), h / 2.0 + dy),
                    (x(2.0), h / 2.0 + dy * 0.7),
                ],
                BODY_R,
            );
        }
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
        if self.mode == mode::CLASSIC {
            return self.ring.entrance(slot);
        }
        if !self.ring.oval {
            return None;
        }
        let (w, h) = (self.ring.w, self.ring.h);
        if self.mode == mode::TEAMS {
            let dy = if slot % 2 == 0 { -0.7 } else { 0.7 };
            return Some((if slot < 2 { 0.9 } else { w - 0.9 }, h / 2.0 + dy));
        }
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
        f.team = self.side_of(slot);
        if self.mode == mode::GOLIATH && slot == self.goliath {
            f.giant = true;
            f.hp = GIANT_HP;
            f.max_hp = GIANT_HP;
        } else if self.kits {
            f.take_kit(self.picks[slot] & !kit::PICKED);
        }
        f
    }

    /// In the lobby, `id` moves to place `slot`, if it's empty or a bot's
    /// (who takes theirs).
    pub fn switch_place(&mut self, id: u32, slot: usize) -> bool {
        let Some(from) = self.slot_of(id) else {
            return false;
        };
        if self.status != LOBBY
            || slot >= SLOTS
            || (self.slots[slot] != 0 && !is_bot(self.slots[slot]))
        {
            return false;
        }
        self.slots.swap(from, slot);
        if self.goliath == from {
            self.goliath = slot;
        } else if self.goliath == slot {
            self.goliath = from;
        }
        true
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
        // (However the match ended: nothing left loose on the sand.)
        self.lions.clear();
        self.meteors.clear();
        self.clouds.clear();
        if self.exhibition {
            // (The lobby as it was: empty, the usual settings.)
            self.exhibition = false;
            self.slots = [0; SLOTS];
            self.mode = mode::CLASSIC;
            self.kits = false;
            self.wheel = false;
            self.disasters = false;
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
        // Two against two: someone on each side.
        if self.mode == mode::TEAMS
            && (self.slots[..2].iter().all(|&s| s == 0) || self.slots[2..].iter().all(|&s| s == 0))
        {
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
            // The wheel: it spins again every round (a new class each time).
            (true, true) => WHEEL_MS,
        };
        self.choose_end = now + choose;
        self.phase_end = now + choose + COUNTDOWN_MS;
        for s in 0..SLOTS {
            if spin {
                let giant = self.mode == mode::GOLIATH && s == self.goliath;
                self.picks[s] = if giant {
                    kit::PICKED
                } else {
                    // (Where the wheel stops: anyone's guess, but never last
                    // round's class again: someone new every round.)
                    let mut h =
                        now.wrapping_mul(2_654_435_761) ^ (s as u32 + 1).wrapping_mul(0x9e37_79b9);
                    h ^= h >> 15;
                    h = h.wrapping_mul(0x85eb_ca6b);
                    h ^= h >> 13;
                    let last = self.picks[s] & kit::PICKED != 0 && self.round > 1;
                    let was = self.picks[s] & !kit::PICKED;
                    let k = if last {
                        // One of the others, evenly.
                        let k = (h % (kit::COUNT as u32 - 1)) as u8;
                        if k >= was { k + 1 } else { k }
                    } else {
                        (h % kit::COUNT as u32) as u8
                    };
                    k | kit::PICKED
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
            && !self.wheel
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
        } * f.speed_x(now);
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
        // (Nudged mid-charge, an arrow say: letting go still counts.)
        let letting_go = what == input::HEAVY_RELEASE && f.act == act::CHARGE;
        if f.down || (now < f.knocked_until && !letting_go) || f.act == act::STUN {
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
                        f.let_go(now, aim);
                    }
                    input::ROLL => f.roll_wanted = (now.max(1), aim),
                    _ => {}
                }
            }
            return evs;
        }
        match what {
            input::LIGHT => {
                if matches!(f.act, act::LIGHT1 | act::LIGHT2) {
                    // Mid-combo: the next slash follows on.
                    f.queued = true;
                } else if f.free(now) {
                    if f.spend(f.light_cost(), now) {
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
                if !f.free(now) {
                    f.pending = (input::HEAVY_START, now, aim);
                } else if f.can_charge(now) {
                    f.pending = (0, 0, 0.0);
                    f.aim = aim;
                    f.set(act::CHARGE, now, u32::MAX - now);
                }
            }
            input::HEAVY_RELEASE => {
                if f.act != act::CHARGE && f.pending.0 == input::HEAVY_START {
                    // Let go before they were ever free to charge.
                    f.let_go(now, aim);
                }
                if f.act == act::CHARGE {
                    let held = now.saturating_sub(f.act_at);
                    f.aim = aim;
                    if held < HEAVY_MIN_MS {
                        // Let go too soon: just a slash.
                        if f.spend(f.light_cost(), now) {
                            let (w, a, r) = f.light(0);
                            f.set(act::LIGHT1, now, w + a + r);
                            evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::LIGHT1 as u16));
                        } else {
                            f.act = act::NONE;
                        }
                    } else if f.shoots() && !f.winded(now) && {
                        let mut c = ((held - HEAVY_MIN_MS) as f64
                            / (f.full_ms() - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        let (lo, hi) = BIG_BOMB_COST;
                        let cost = if f.kit == kit::ARCHER {
                            BURST_MIN_COST + (BURST_COST - BURST_MIN_COST) * c
                        } else {
                            // (No bigger than they've the wind for.)
                            c = c.min(((f.stamina * 2.0 - lo) / (hi - lo)).max(0.0));
                            lo + (hi - lo) * c
                        };
                        f.charge = c;
                        f.spend(cost, now)
                    } {
                        // The bow's three arrows, or a big bomb lobbed.
                        let more = if f.kit == kit::ARCHER {
                            BURST_GAP_MS * (f.arrows() as u32 - 1)
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
                            / (f.full_ms() - HEAVY_MIN_MS) as f64)
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
                if f.can_roll(now) && f.spend(ROLL_COST, now) {
                    f.queued = false;
                    if f.pending.0 == input::HEAVY_START {
                        f.pending = (0, 0, 0.0);
                    }
                    f.roll_wanted = (0, 0.0);
                    f.roll_dir = aim;
                    f.set(act::ROLL, now, ROLL_MS);
                    f.roll_ready = now + ROLL_MS + ROLL_CD_MS;
                    evs.push(Event::new(ev::ROLL, f.id, 0, f.x, f.y, 0));
                } else if f.roll_wanted.0 == 0 {
                    // Not this instant: it goes the moment it can.
                    f.roll_wanted = (now.max(1), aim);
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
                self.reset_disaster(now);
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
        self.disaster_tick(now, rng, &mut evs);
        self.lions_tick(now, dt, &mut evs);
        // The fire (and any lava).
        let fire = self.fire(now);
        let lava = self.lava(now);
        if fire < 1.15 && !self.fire_announced {
            self.fire_announced = true;
            evs.push(Event::new(ev::FIRE, 0, 0, 0.0, 0.0, 0));
        }
        // The poison, working.
        for i in 0..self.fighters.len() {
            let f = &mut self.fighters[i];
            if f.down || now >= f.poison_until {
                continue;
            }
            let k = if f.giant { f.max_hp / HP } else { 1.0 };
            f.hp -= POISON_DPS * k * dt;
            if f.hp <= 0.0 {
                self.knock_down(i, 0, now, &mut evs);
            }
        }
        for i in 0..self.fighters.len() {
            let f = &self.fighters[i];
            // (Up in the Goliath's grip, they're clear of the fire.)
            let out = self.ring.reach(f.x, f.y);
            // (The lava reaches the Goliath first: it's a lot of giant to keep out of it.)
            let lava = if f.giant && lava < 1.15 {
                lava - GIANT_LAVA_REACH
            } else {
                lava
            };
            if !f.down && !f.immune() && f.act != act::HELD && out > fire.min(lava) {
                // (It burns everyone alike, the Goliath as much of its health as anyone.)
                let k = if self.fighters[i].giant || self.fighters[i].max_hp != HP {
                    self.fighters[i].max_hp / HP
                } else {
                    1.0
                };
                let dps = if out <= lava {
                    FIRE_DPS
                } else if self.fighters[i].giant {
                    LAVA_DPS * GIANT_LAVA_X
                } else {
                    LAVA_DPS
                };
                self.fighters[i].hp -= dps * k * dt;
                if self.fighters[i].hp <= 0.0 {
                    self.knock_down(i, 0, now, &mut evs);
                }
            }
        }
        // Who's left? (In Goliath mode, a side: the Goliath, or the
        // gladiators, whose best fighter is named.)
        if let Some(winner) = self.round_winner() {
            self.winner = winner;
            // (A side's win crowns all of it.)
            if self.mode != mode::CLASSIC && winner != 0 {
                let team = self.fighter(winner).map(|f| f.team);
                for f in self.fighters.iter().filter(|f| Some(f.team) == team) {
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
            self.lions.clear();
            self.meteors.clear();
            self.clouds.clear();
        }
        evs
    }

    // ---- the round's disaster ------------------------------------------------

    fn reset_disaster(&mut self, now: u32) {
        self.disaster_kind = disaster::NONE;
        // (Turned off: as if it had been and gone.)
        self.disaster_stage = if self.disasters {
            disaster::VOTING
        } else {
            disaster::ON
        };
        self.disaster_end = if self.disasters {
            now + VOTE_UNTIL_MS
        } else {
            u32::MAX
        };
        self.disaster_pool = 0;
        self.votes.clear();
        self.lava_at = 0;
        self.lions.clear();
        self.meteors.clear();
        self.meteors_end = 0;
        self.meteors_dropped = 0;
        self.clouds.clear();
    }

    /// A vote for the round's disaster, from anyone not (or no longer)
    /// fighting: once each, and they can change their mind while it's open.
    pub fn vote(&mut self, id: u32, kind: u8) -> bool {
        if self.status != FIGHTING
            || self.disaster_stage != disaster::VOTING
            || !(1..=disaster::COUNT).contains(&kind)
            || self.fighters.iter().any(|f| f.id == id && !f.down)
        {
            return false;
        }
        self.votes.retain(|(who, _)| *who != id);
        self.votes.push((id, kind));
        true
    }

    /// The votes so far, by disaster (lava, meteors, lions, scorpion, acid).
    pub fn disaster_tally(&self) -> [u8; 5] {
        let mut n = [0u8; 5];
        for (_, k) in &self.votes {
            n[*k as usize - 1] = n[*k as usize - 1].saturating_add(1);
        }
        n
    }

    /// Which disaster to show (none till it's settled: the wheel's is shown
    /// to it, to stop on).
    pub fn disaster_shown(&self) -> u8 {
        if self.status == FIGHTING {
            self.disaster_kind
        } else {
            disaster::NONE
        }
    }

    /// How far the lava's flowed in, like `fire`: 1.15 (not at all, or no lava).
    pub fn lava(&self, now: u32) -> f64 {
        if self.status != FIGHTING || self.lava_at == 0 {
            return 1.15;
        }
        let t = (now - self.lava_at) as f64 / LAVA_CLOSE_MS as f64;
        1.15 - (1.15 - FIRE_MIN) * t.min(1.0)
    }

    /// Where it stops being safe: the nearer of the fire and the lava.
    pub fn safe_to(&self, now: u32) -> f64 {
        self.fire(now).min(self.lava(now))
    }

    fn disaster_tick(&mut self, now: u32, rng: &mut impl FnMut() -> f64, evs: &mut Vec<Event>) {
        if self.disaster_stage != disaster::ON && now >= self.disaster_end {
            match self.disaster_stage {
                disaster::VOTING => {
                    let tally = self.disaster_tally();
                    let most = tally.iter().copied().max().unwrap_or(0);
                    let level: Vec<u8> = (1..=disaster::COUNT)
                        .filter(|k| tally[*k as usize - 1] == most)
                        .collect();
                    // (Level, or nobody voted: any of those, as the wheel falls.)
                    let k = level[((rng() * level.len() as f64) as usize).min(level.len() - 1)];
                    self.disaster_kind = k;
                    self.disaster_pool = level.iter().fold(0, |p, k| p | 1 << k);
                    self.disaster_stage = disaster::SPIN;
                    self.disaster_end = now + DISASTER_SPIN_MS;
                }
                disaster::SPIN => {
                    self.disaster_stage = disaster::DECIDED;
                    self.disaster_end = self.round_at + DISASTER_AT_MS;
                    evs.push(Event::new(
                        ev::DISASTER_PICKED,
                        0,
                        0,
                        0.0,
                        0.0,
                        self.disaster_kind as u16,
                    ));
                }
                _ => self.strike_disaster(now, rng, evs),
            }
        }
        // (A shower swelling, and dying away.)
        while self.meteors_end != 0 && now < self.meteors_end && now >= self.next_meteor {
            let left = (self.meteors_end - now) as f64 / METEOR_RAIN_MS as f64;
            let swell = (left * PI).sin().powi(2);
            let rate = METEOR_RATE.0 + (METEOR_RATE.1 - METEOR_RATE.0) * swell;
            self.next_meteor += (1000.0 / rate) as u32;
            self.drop_meteor(now, rng, evs);
        }
        self.meteors_land(now, evs);
        self.acid_tick(now, evs);
    }

    /// The acid clouds drift on, and burn whoever's under one.
    fn acid_tick(&mut self, now: u32, evs: &mut Vec<Event>) {
        let w = self.ring.w;
        self.clouds
            .retain(|c| now < c.delay || (-ACID_OFF..=w + ACID_OFF).contains(&c.x(now)));
        if self.clouds.is_empty() || now < self.next_acid {
            return;
        }
        self.next_acid = now + ACID_TICK_MS;
        let clouds = self.clouds.clone();
        for j in 0..self.fighters.len() {
            let f = &self.fighters[j];
            let under = clouds
                .iter()
                .any(|c| c.delay <= now && in_cloud(c.x(now), c.y, f.x, f.y));
            if !under || f.down || f.immune() || f.act == act::HELD {
                continue;
            }
            let dmg = ACID_DMG * if f.giant { GIANT_ACID_X } else { 1.0 };
            let f = &mut self.fighters[j];
            f.hp -= dmg;
            let (id, x, y) = (f.id, f.x, f.y);
            evs.push(Event::new(ev::ACID_BURN, 0, id, x, y, dmg.round() as u16));
            if f.hp <= 0.0 {
                self.knock_down(j, 0, now, evs);
            }
        }
    }

    /// Caesar's disaster strikes.
    fn strike_disaster(&mut self, now: u32, rng: &mut impl FnMut() -> f64, evs: &mut Vec<Event>) {
        self.disaster_stage = disaster::ON;
        self.disaster_end = u32::MAX;
        evs.push(Event::new(
            ev::DISASTER,
            0,
            0,
            0.0,
            0.0,
            self.disaster_kind as u16,
        ));
        match self.disaster_kind {
            disaster::LAVA => self.lava_at = now.max(1),
            disaster::METEORS => {
                self.next_meteor = now;
                self.meteors_end = now + METEOR_RAIN_MS;
            }
            disaster::SCORPION => {
                let (x, y) = (self.ring.w / 2.0, self.ring.h / 2.0);
                // The Goliath first, if there is one (it's the one with the most to lose).
                let giant = self
                    .fighters
                    .iter()
                    .find(|f| f.giant && !f.down)
                    .map(|f| f.id);
                let target = giant
                    .or(self.nearest_fighter(x, y).map(|f| f.id))
                    .unwrap_or(0);
                self.lions.push(Lion {
                    id: 1,
                    x,
                    y,
                    aim: 0.0,
                    hp: SCORPION_HP,
                    act: lion::EMERGE,
                    act_at: now,
                    act_until: now + SCORPION_EMERGE_MS,
                    target,
                    to: (x, y),
                    from: (x, y),
                    pounced: false,
                    kvx: 0.0,
                    kvy: 0.0,
                    scorpion: true,
                    next_dart: now + SCORPION_EMERGE_MS + DART_EVERY_MS,
                    next_rush: now + SCORPION_EMERGE_MS + 800,
                    thief: false,
                    item: 0,
                    big: giant.is_some(),
                });
            }
            disaster::ACID => {
                // Wave on wave, this way then that, each in its own lanes.
                let mut dir = if rng() < 0.5 { 1.0 } else { -1.0 };
                let (w, h) = (self.ring.w, self.ring.h);
                let mut id = 0;
                for (wave, &size) in ACID_WAVES.iter().enumerate() {
                    let mut lanes: Vec<usize> = (0..ACID_LANES).collect();
                    for k in (1..ACID_LANES).rev() {
                        let r = ((rng() * (k + 1) as f64) as usize).min(k);
                        lanes.swap(k, r);
                    }
                    for &lane in lanes.iter().take(size) {
                        let y = (lane as f64 + 0.5) / ACID_LANES as f64 * h + (rng() - 0.5) * 0.6;
                        let late = wave as u32 * ACID_WAVE_GAP_MS
                            + if wave == 0 {
                                0
                            } else {
                                (rng() * ACID_JITTER_MS as f64) as u32
                            };
                        self.clouds.push(Cloud {
                            x0: if dir > 0.0 { -ACID_OFF } else { w + ACID_OFF },
                            y,
                            dir,
                            delay: now + late,
                            id,
                        });
                        id += 1;
                    }
                    dir = -dir;
                }
                self.next_acid = now;
            }
            _ => {
                // A lion for everyone still standing, out of their own corner.
                let alive: Vec<u32> = self
                    .fighters
                    .iter()
                    .filter(|f| !f.down)
                    .map(|f| f.id)
                    .collect();
                for (k, &target) in alive.iter().enumerate() {
                    let (x, y) = self.ring.entrance(k).unwrap_or(self.ring.gate(k));
                    let big = self.fighter(target).is_some_and(|f| f.giant);
                    let l = Lion {
                        id: k as u8 + 1,
                        x,
                        y,
                        aim: (self.ring.h / 2.0 - y).atan2(self.ring.w / 2.0 - x),
                        hp: if big { BIG_LION_HP } else { LION_HP },
                        act: lion::EMERGE,
                        act_at: now,
                        act_until: now + LION_EMERGE_MS,
                        target,
                        to: (x, y),
                        from: (x, y),
                        pounced: false,
                        kvx: 0.0,
                        kvy: 0.0,
                        scorpion: false,
                        next_dart: 0,
                        next_rush: 0,
                        thief: false,
                        item: 0,
                        big,
                    };
                    evs.push(Event::new(ev::LION_OUT, 0, l.id as u32, x, y, 0));
                    self.lions.push(l);
                }
            }
        }
    }

    /// Picks where the next meteor lands (one in four near someone, a beat
    /// ahead of where they're going; the rest spread evenly over all the sand,
    /// so there's nowhere safe to stand) and shows it.
    fn drop_meteor(&mut self, now: u32, rng: &mut impl FnMut() -> f64, evs: &mut Vec<Event>) {
        let alive: Vec<&Fighter> = self.fighters.iter().filter(|f| !f.down).collect();
        let (w, h) = (self.ring.w, self.ring.h);
        for _ in 0..12 {
            self.meteors_dropped += 1;
            let n = self.meteors_dropped as f64;
            let (x, y) = if !alive.is_empty() && rng() < 0.25 {
                let f = alive[((rng() * alive.len() as f64) as usize).min(alive.len() - 1)];
                let lead = METEOR_WARN_MS as f64 / 1000.0 * 0.5;
                (
                    f.x + f.vx * lead + (rng() - 0.5) * 2.4,
                    f.y + f.vy * lead + (rng() - 0.5) * 2.4,
                )
            } else {
                // (Each a step on from the last across the sand: no clumps, no gaps.)
                let spread = |step: f64, jitter: f64| (n * step + jitter * 0.14).fract();
                (spread(0.754_877, rng()) * w, spread(0.569_84, rng()) * h)
            };
            if self.ring.free(x, y, 0.5) {
                self.meteors.push(Meteor {
                    x,
                    y,
                    at: now + METEOR_WARN_MS,
                });
                let mut e = Event::new(ev::METEOR_WARN, 0, 0, x, y, METEOR_WARN_MS as u16);
                e.m = (METEOR_R * 100.0) as u16;
                evs.push(e);
                return;
            }
        }
    }

    fn meteors_land(&mut self, now: u32, evs: &mut Vec<Event>) {
        let mut k = 0;
        while k < self.meteors.len() {
            let m = self.meteors[k];
            if now < m.at {
                k += 1;
                continue;
            }
            self.meteors.remove(k);
            evs.push(Event::new(ev::METEOR, 0, 0, m.x, m.y, 0));
            for j in 0..self.fighters.len() {
                let f = &self.fighters[j];
                let d = f.reach_to(m.x, m.y);
                if d > METEOR_R + f.body() {
                    continue;
                }
                let near = 1.0 - (d / METEOR_R).min(1.0) * 0.45;
                // (The Goliath: its own share, it's far the bigger target.)
                let k = if f.giant { GIANT_METEOR_X } else { 1.0 };
                let from = if (f.x - m.x).hypot(f.y - m.y) < 0.05 {
                    (m.x - 0.05, m.y)
                } else {
                    (m.x, m.y)
                };
                self.hazard(
                    j,
                    from,
                    METEOR_DMG * near * k,
                    METEOR_KB * near,
                    380,
                    false,
                    now,
                    evs,
                );
            }
            self.blast_lions(None, m.x, m.y, METEOR_R, METEOR_DMG, now, evs);
        }
    }

    /// Something that isn't a fighter (a meteor, a lion) hits `j`: a roll
    /// clears it, a shield bursts on it; a guard, if it's one a guard can
    /// stop (`blockable`), takes the worst of it at a price in stamina.
    #[allow(clippy::too_many_arguments)]
    fn hazard(
        &mut self,
        j: usize,
        from: (f64, f64),
        dmg: f64,
        kb: f64,
        stun: u32,
        blockable: bool,
        now: u32,
        evs: &mut Vec<Event>,
    ) -> bool {
        let v = &self.fighters[j];
        if v.down || v.immune() || v.act == act::HELD || v.flags(now) & flag::IFRAMES != 0 {
            return false;
        }
        if v.shields > 0 {
            self.burst_shield(0, j, evs);
            return false;
        }
        let dir = (v.y - from.1).atan2(v.x - from.0);
        let (mut dmg, mut kb, mut stun, mut bits) = (dmg, kb, stun, 0u16);
        let guard = blockable
            && v.act == act::BLOCK
            && v.stamina > 0.0
            && turn(v.aim, dir + PI).abs() <= BLOCK_ARC;
        let v = &mut self.fighters[j];
        if guard {
            v.drain(BLOCK_ARROW_COST, now);
            dmg *= BLOCK_SHOT_TAKEN;
            kb *= 0.35;
            stun = 0;
            bits |= 1;
        }
        if v.giant {
            kb *= 0.2;
            stun = 0;
        } else {
            kb *= KIT_KB_TAKEN[v.kit as usize];
        }
        let rage = v.rage;
        v.hp -= dmg;
        v.gain_rage(dmg * if v.giant { GIANT_RAGE_HURT } else { 0.9 });
        if kb > 0.0 {
            v.kvx = dir.cos() * kb;
            v.kvy = dir.sin() * kb;
            v.knocked_until = now + (kb * 45.0) as u32;
            v.slammed = false;
            v.knocked_by = 0;
        }
        if stun > 0 && v.act != act::SPIN {
            // Knocked right out of whatever they were doing: the swing, the
            // charge, and anything they'd pressed to follow it.
            v.set(act::STUN, now, stun);
            v.queued = false;
            v.pending = (0, 0, 0.0);
        }
        let mut e = Event::new(ev::HIT, 0, v.id, v.x, v.y, dmg.round() as u16);
        e.m = bits;
        e.vx = v.kvx;
        e.vy = v.kvy;
        evs.push(e);
        if rage < RAGE && v.rage >= RAGE {
            evs.push(Event::new(ev::RAGE_FULL, v.id, 0, v.x, v.y, 0));
        }
        if self.fighters[j].hp <= 0.0 {
            self.knock_down(j, 0, now, evs);
        }
        !guard
    }

    /// Poison in `j`, for a while (again from the start, if it's there already).
    fn poison(&mut self, j: usize, now: u32, evs: &mut Vec<Event>) {
        let v = &mut self.fighters[j];
        if v.down {
            return;
        }
        v.poison_until = now + POISON_MS;
        evs.push(Event::new(ev::POISONED, 0, v.id, v.x, v.y, 0));
    }

    // ---- the lions -----------------------------------------------------------

    fn nearest_fighter(&self, x: f64, y: f64) -> Option<&Fighter> {
        self.fighters
            .iter()
            .filter(|f| !f.down && f.act != act::HELD)
            .min_by(|a, b| {
                let d = |f: &Fighter| (f.x - x).hypot(f.y - y);
                d(a).total_cmp(&d(b))
            })
    }

    fn lions_tick(&mut self, now: u32, dt: f64, evs: &mut Vec<Event>) {
        let fire = self.safe_to(now);
        let mut k = 0;
        while k < self.lions.len() {
            let l = self.lions[k].clone();
            if l.act == lion::DEAD || l.act == lion::BURROW {
                if now >= l.act_until {
                    self.lions.remove(k);
                } else {
                    k += 1;
                }
                continue;
            }
            // Knocked back a step by a blow.
            if l.kvx != 0.0 || l.kvy != 0.0 {
                let (nx, ny, _) = self.ring.slide(l.x, l.y, l.kvx * dt, l.kvy * dt, l.r());
                let g = &mut self.lions[k];
                g.x = nx;
                g.y = ny;
                let fade = (-KB_FRICTION * dt).exp();
                g.kvx *= fade;
                g.kvy *= fade;
                if g.kvx.hypot(g.kvy) < 0.3 {
                    g.kvx = 0.0;
                    g.kvy = 0.0;
                }
            }
            // The fire closing in on it too.
            if self.ring.reach(l.x, l.y) > fire {
                self.lions[k].hp -= FIRE_DPS * dt;
                if self.lions[k].hp <= 0.0 {
                    self.lion_dies(k, 0, now, evs);
                    k += 1;
                    continue;
                }
            }
            if l.scorpion {
                self.scorpion_tick(k, now, dt, evs);
                k += 1;
                continue;
            }
            if l.thief {
                self.thief_tick(k, now, dt, evs);
                k += 1;
                continue;
            }
            match l.act {
                lion::EMERGE | lion::RECOVER => {
                    if now >= l.act_until {
                        self.lion_set(k, lion::PROWL, now, u32::MAX);
                    }
                }
                lion::PROWL => self.lion_prowl(k, now, dt, evs),
                lion::CROUCH => {
                    // It watches them, up to the moment it settles on its spring.
                    let locked = now + LION_LOCK_MS >= l.act_until;
                    if let Some(t) = self.fighter(l.target).filter(|t| !t.down && !locked) {
                        let aim = (t.y - l.y).atan2(t.x - l.x);
                        let d = (t.x - l.x).hypot(t.y - l.y).min(LION_LEAP);
                        // (A little ahead of them, as anything hunting does.)
                        let lead = (LION_LOCK_MS + LION_LEAP_MS) as f64 / 1000.0 * 0.6;
                        let (tx, ty) = (t.vx * lead, t.vy * lead);
                        self.lions[k].aim = aim;
                        self.lions[k].to = (l.x + aim.cos() * d + tx, l.y + aim.sin() * d + ty);
                    }
                    if now >= l.act_until {
                        self.lions[k].from = (l.x, l.y);
                        self.lion_set(k, lion::LEAP, now, now + LION_LEAP_MS);
                        evs.push(Event::new(
                            ev::LION_LEAP,
                            l.target,
                            l.id as u32,
                            l.x,
                            l.y,
                            0,
                        ));
                    }
                }
                lion::LEAP => {
                    let u = (now - l.act_at) as f64 / LION_LEAP_MS as f64;
                    let u = u.min(1.0);
                    let (px, py) = (
                        l.from.0 + (l.to.0 - l.from.0) * u,
                        l.from.1 + (l.to.1 - l.from.1) * u,
                    );
                    let (nx, ny, _) = self.ring.slide(l.x, l.y, px - l.x, py - l.y, l.r());
                    self.lions[k].x = nx;
                    self.lions[k].y = ny;
                    // (It hits whoever it meets on the way, not just where it's headed.)
                    let met = self.fighters.iter().any(|f| {
                        !f.down
                            && f.act != act::HELD
                            && f.flags(now) & flag::IFRAMES == 0
                            && f.reach_to(nx, ny) < LION_CONTACT_R + f.body()
                    });
                    if met || now >= l.act_until {
                        self.lion_land(k, nx, ny, now, evs);
                    }
                }
                _ => {}
            }
            k += 1;
        }
    }

    fn lion_set(&mut self, k: usize, act: u8, now: u32, until: u32) {
        let l = &mut self.lions[k];
        l.act = act;
        l.act_at = now;
        l.act_until = until;
    }

    /// The scorpion's turn: up with the wheel; then after whoever's nearest,
    /// slow and sure, stinging what it reaches and spitting at what it can't.
    fn scorpion_tick(&mut self, k: usize, now: u32, dt: f64, evs: &mut Vec<Event>) {
        let l = self.lions[k].clone();
        match l.act {
            lion::EMERGE => {
                self.clear_the_wheel(l.act_at, now, evs);
                if now >= l.act_until {
                    self.lion_set(k, lion::PROWL, now, u32::MAX);
                }
            }
            lion::RECOVER => {
                if now >= l.act_until {
                    self.lion_set(k, lion::PROWL, now, u32::MAX);
                }
            }
            lion::PROWL | lion::RUSH => {
                // Whoever's nearest (a little loyal: no dithering between two).
                let mine = self
                    .fighter(l.target)
                    .filter(|t| !t.down && t.act != act::HELD);
                let near = self.nearest_fighter(l.x, l.y);
                let d = |f: &Fighter| (f.x - l.x).hypot(f.y - l.y);
                // (Its first sting's for the one it came for, whoever's in the way.)
                let t = match (mine, near) {
                    (Some(m), _) if l.big => m,
                    (Some(m), Some(n)) => {
                        if d(n) + 0.5 < d(m) {
                            n
                        } else {
                            m
                        }
                    }
                    (None, Some(n)) => n,
                    (m, _) => match m {
                        Some(m) => m,
                        None => return,
                    },
                };
                let (tid, tx, ty, body, tvx, tvy) = (t.id, t.x, t.y, t.body(), t.vx, t.vy);
                let (dx, dy) = (tx - l.x, ty - l.y);
                let dist = dx.hypot(dy).max(0.01);
                let clear = self.ring.clear_line(l.x, l.y, tx, ty);
                let g = &mut self.lions[k];
                g.target = tid;
                g.aim = dy.atan2(dx);
                let rushing = l.act == lion::RUSH && now < l.act_until;
                if dist < SCORPION_R + STING_REACH + body && clear {
                    self.lions[k].to = (tx, ty);
                    let wind = if rushing {
                        STING_QUICK_WIND_MS
                    } else {
                        STING_WIND_MS
                    };
                    self.lion_set(k, lion::CROUCH, now, now + wind);
                    evs.push(Event::new(ev::SCORPION_WIND, l.id as u32, tid, l.x, l.y, 0));
                } else if dist > DART_FROM && now >= l.next_dart && clear && !l.big {
                    let lead = dist / DART_SPEED * 0.6;
                    self.lions[k].to = (tx + tvx * lead, ty + tvy * lead);
                    self.lions[k].next_dart = now + DART_EVERY_MS;
                    self.lion_set(k, lion::SPIT, now, now + DART_WIND_MS);
                    evs.push(Event::new(ev::SCORPION_WIND, l.id as u32, tid, l.x, l.y, 1));
                } else if !rushing
                    && now >= l.next_rush
                    && clear
                    && (SCORPION_RUSH_FROM..SCORPION_RUSH_TO).contains(&dist)
                {
                    self.lions[k].next_rush = now + SCORPION_RUSH_EVERY_MS;
                    self.lion_set(k, lion::RUSH, now, now + SCORPION_RUSH_MS);
                    evs.push(Event::new(ev::SCORPION_WIND, l.id as u32, tid, l.x, l.y, 2));
                } else {
                    if l.act == lion::RUSH && !rushing {
                        self.lion_set(k, lion::PROWL, now, u32::MAX);
                    }
                    let step = SCORPION_SPEED * if rushing { SCORPION_RUSH_X } else { 1.0 } * dt;
                    let (nx, ny, _) =
                        self.ring
                            .slide(l.x, l.y, dx / dist * step, dy / dist * step, SCORPION_R);
                    self.lions[k].x = nx;
                    self.lions[k].y = ny;
                }
            }
            lion::CROUCH => {
                // Watching them, till it's committed.
                if now + STING_LOCK_MS < l.act_until
                    && let Some(t) = self.fighter(l.target).filter(|t| !t.down)
                {
                    let (tx, ty) = (t.x, t.y);
                    self.lions[k].aim = (ty - l.y).atan2(tx - l.x);
                    self.lions[k].to = (tx, ty);
                }
                if now >= l.act_until {
                    self.lion_set(k, lion::LEAP, now, now + STING_STRIKE_MS);
                }
            }
            lion::LEAP => {
                if now >= l.act_until {
                    let (x, y) = l.to;
                    evs.push(Event::new(ev::SCORPION_STING, l.id as u32, 0, x, y, 0));
                    // (`pounced`: the first of the two.)
                    let first = !l.pounced;
                    self.lions[k].pounced = first;
                    self.lions[k].big = false;
                    let rest = if first { STING_CHAIN_MS } else { STING_REST_MS };
                    self.lion_set(k, lion::RECOVER, now, now + rest);
                    for j in 0..self.fighters.len() {
                        let f = &self.fighters[j];
                        if f.reach_to(x, y) < STING_HIT_R + f.body() {
                            let m = if f.giant { GIANT_STING_X } else { 1.0 };
                            let from = (l.x, l.y);
                            if self.hazard(
                                j,
                                from,
                                LION_DMG * m,
                                LION_KB,
                                LION_STUN_MS,
                                true,
                                now,
                                evs,
                            ) {
                                self.poison(j, now, evs);
                            }
                        }
                    }
                }
            }
            lion::SPIT => {
                if now >= l.act_until {
                    let aim = (l.to.1 - l.y).atan2(l.to.0 - l.x);
                    let mut m = Missile::new(SCORPION_BY, missile::DART, l.x, l.y, aim);
                    m.vx = aim.cos() * DART_SPEED;
                    m.vy = aim.sin() * DART_SPEED;
                    m.left = DART_RANGE;
                    m.dmg = DART_DMG;
                    let mut e =
                        Event::new(ev::THROW, SCORPION_BY, 0, l.x, l.y, missile::DART as u16);
                    e.m = aim_to_u16(aim);
                    e.vx = m.left;
                    e.vy = DART_SPEED;
                    evs.push(e);
                    self.missiles.push(m);
                    self.lions[k].aim = aim;
                    self.lion_set(k, lion::RECOVER, now, now + 500);
                }
            }
            _ => {}
        }
    }

    /// Somewhere for a thief to head next: open sand, off the spikes, clear of the fire.
    fn thief_goal(&self, id: u8, now: u32) -> (f64, f64) {
        let (w, h) = (self.ring.w, self.ring.h);
        let fire = self.safe_to(now);
        for n in 0..10 {
            let x = 1.5 + noise(now ^ id as u32, n) * (w - 3.0);
            let y = 1.5 + noise(now ^ id as u32, n + 64) * (h - 3.0);
            if self.ring.free(x, y, 0.45)
                && self.ring.reach(x, y) < fire - 0.5
                && !self.ring.spikes.iter().any(|s| s.contains(x, y, 0.4))
            {
                return (x, y);
            }
        }
        (w / 2.0, h / 2.0)
    }

    /// Off with it: what it's got (if anything), somewhere else.
    fn thief_away(&mut self, k: usize, now: u32) {
        let id = self.lions[k].id;
        self.lions[k].to = self.thief_goal(id, now);
        self.lion_set(k, lion::PROWL, now, u32::MAX);
    }

    /// A little scorpion's turn: creeping up on a gift, then away with it.
    fn thief_tick(&mut self, k: usize, now: u32, dt: f64, evs: &mut Vec<Event>) {
        let l = self.lions[k].clone();
        // Trodden on: it stings, and it's off.
        if now >= l.next_dart {
            let by = self.fighters.iter().position(|f| {
                !f.down
                    && f.act != act::HELD
                    && f.flags(now) & flag::IFRAMES == 0
                    && (f.x - l.x).hypot(f.y - l.y) < f.body() + THIEF_STEP_R
            });
            if let Some(j) = by {
                let f = &self.fighters[j];
                let m = if f.giant { GIANT_THIEF_X } else { 1.0 };
                let from = (l.x - (f.x - l.x) - 0.01, l.y - (f.y - l.y));
                evs.push(Event::new(ev::THIEF_STING, l.id as u32, f.id, l.x, l.y, 0));
                self.lions[k].next_dart = now + THIEF_STING_EVERY_MS;
                if self.hazard(
                    j,
                    from,
                    THIEF_DMG * m,
                    THIEF_KB,
                    THIEF_STUN_MS,
                    false,
                    now,
                    evs,
                ) {
                    self.poison(j, now, evs);
                }
            }
        }
        let gift = self.gifts.iter().position(|g| (g.x, g.y) == l.to);
        match l.act {
            lion::SNEAK | lion::SNATCH if gift.is_none() => {
                // (`next_rush`: when it gives up.)
                self.lions[k].next_rush = now + THIEF_GIVE_UP_MS;
                self.thief_away(k, now);
            }
            lion::SNEAK => {
                // Out from behind it, and round to the front.
                let since = now.saturating_sub(l.act_at).saturating_sub(THIEF_PEEK_MS);
                let u = (since as f64 / THIEF_ROUND_MS as f64).min(1.0);
                let g = &mut self.lions[k];
                let side = if l.id % 2 == 0 { 1.0 } else { -1.0 };
                g.x = l.from.0 + (u * PI).sin() * 0.6 * side;
                g.y = l.from.1 + (l.to.1 + 0.42 - l.from.1) * u;
                if now >= l.act_until {
                    self.lion_set(k, lion::SNATCH, now, now + THIEF_SNATCH_MS);
                }
            }
            lion::SNATCH => {
                if now >= l.act_until
                    && let Some(i) = gift
                {
                    let kind = self.gifts.remove(i).kind;
                    self.lions[k].item = kind;
                    evs.push(Event::new(
                        ev::THIEF_GRAB,
                        0,
                        l.id as u32,
                        l.x,
                        l.y,
                        kind as u16,
                    ));
                    self.thief_away(k, now);
                }
            }
            lion::RECOVER | lion::PROWL | lion::RUSH => {
                // Nothing to show for it, a while on: it digs itself in.
                if l.item == 0 && now >= l.next_rush {
                    self.lion_set(k, lion::BURROW, now, now + THIEF_BURROW_MS);
                    return;
                }
                // Anyone near, and it bolts, directly away.
                let near = self.nearest_fighter(l.x, l.y).map(|f| (f.x, f.y));
                let shy = near
                    .map(|(x, y)| (x, y, (x - l.x).hypot(y - l.y)))
                    .filter(|(_, _, d)| *d < THIEF_SHY_R);
                if let Some((x, y, d)) = shy {
                    let away = ((l.x - x) / d.max(0.01), (l.y - y) / d.max(0.01));
                    let to = (l.x + away.0 * 4.0, l.y + away.1 * 4.0);
                    self.lions[k].to = if self.ring.free(to.0, to.1, 0.45) {
                        to
                    } else {
                        self.thief_goal(l.id, now)
                    };
                    if l.act != lion::RUSH {
                        self.lion_set(k, lion::RUSH, now, u32::MAX);
                    }
                } else if l.act == lion::RECOVER {
                    if now >= l.act_until {
                        self.thief_away(k, now);
                    }
                    return;
                } else if l.act == lion::RUSH {
                    self.lion_set(k, lion::PROWL, now, u32::MAX);
                }
                let l = self.lions[k].clone();
                // Scuttling round in a curve, not on rails.
                let want = (l.to.1 - l.y).atan2(l.to.0 - l.x);
                let bolt = l.act == lion::RUSH;
                let swing = turn(l.aim, want).clamp(-7.0 * dt, 7.0 * dt);
                let aim = l.aim + if bolt { turn(l.aim, want) } else { swing };
                let step = if bolt { THIEF_BOLT_SPEED } else { THIEF_SPEED } * dt;
                let (nx, ny, bumped) =
                    self.ring
                        .slide(l.x, l.y, aim.cos() * step, aim.sin() * step, THIEF_R);
                let g = &mut self.lions[k];
                g.x = nx;
                g.y = ny;
                g.aim = aim;
                if (l.to.0 - nx).hypot(l.to.1 - ny) < 0.5 || bumped {
                    // Far enough: it stops and looks about, as often as not.
                    if !bolt && noise(now, l.id as u32) < 0.5 {
                        let wait = 500 + (noise(l.id as u32, now) * 700.0) as u32;
                        self.lions[k].to = self.thief_goal(l.id, now);
                        self.lion_set(k, lion::RECOVER, now, now + wait);
                    } else {
                        self.lions[k].to = self.thief_goal(l.id, now);
                    }
                }
            }
            _ => {}
        }
    }

    /// While the wheel's on the move: anyone on it's bundled off to the side.
    fn clear_the_wheel(&mut self, from: u32, now: u32, evs: &mut Vec<Event>) {
        if now >= from + SCORPION_SINK_MS + SCORPION_WAIT_MS + SCORPION_RISE_MS {
            return;
        }
        let (cx, cy) = (self.ring.w / 2.0, self.ring.h / 2.0);
        for f in self.fighters.iter_mut() {
            let (dx, dy) = (f.x - cx, f.y - cy);
            let d = dx.hypot(dy);
            if f.down || f.act == act::HELD || d > PIT_R + f.body() || now < f.knocked_until {
                continue;
            }
            // Pushed out past the rim (off any way, from dead centre).
            let a = if d < 0.05 { 1.0_f64 } else { dy.atan2(dx) };
            let kb = ((PIT_R + f.body() + 0.5 - d) * KB_FRICTION).clamp(4.0, 18.0);
            f.kvx = a.cos() * kb;
            f.kvy = a.sin() * kb;
            f.knocked_until = now + (kb * 45.0) as u32;
            // (A shove, not a blow: nobody gets hurt on a pillar for it.)
            f.slammed = true;
            f.knocked_by = 0;
            let mut e = Event::new(ev::HIT, 0, f.id, f.x, f.y, 0);
            e.m = SHOVE_BIT;
            e.vx = f.kvx;
            e.vy = f.kvy;
            evs.push(e);
        }
    }

    /// After its prey (the one it came for; once it's pounced, whoever's
    /// nearest), and from close enough, it crouches to spring.
    fn lion_prowl(&mut self, k: usize, now: u32, dt: f64, evs: &mut Vec<Event>) {
        let l = self.lions[k].clone();
        let mine = self
            .fighter(l.target)
            .filter(|t| !t.down && t.act != act::HELD);
        let near = self.nearest_fighter(l.x, l.y);
        let t = match (mine, near) {
            (Some(m), Some(n)) if l.pounced => {
                let d = |f: &Fighter| (f.x - l.x).hypot(f.y - l.y);
                if d(n) + 0.5 < d(m) { n } else { m }
            }
            (Some(m), _) => m,
            (None, Some(n)) => n,
            (None, None) => return,
        };
        let (tid, tx, ty, body) = (t.id, t.x, t.y, t.body());
        let (dx, dy) = (tx - l.x, ty - l.y);
        let d = dx.hypot(dy).max(0.01);
        let g = &mut self.lions[k];
        g.target = tid;
        g.aim = dy.atan2(dx);
        if d < LION_POUNCE_R + body && self.ring.clear_line(l.x, l.y, tx, ty) {
            self.lions[k].to = (tx, ty);
            self.lion_set(k, lion::CROUCH, now, now + LION_CROUCH_MS);
            evs.push(Event::new(ev::LION_CROUCH, tid, l.id as u32, l.x, l.y, 0));
            return;
        }
        let step = LION_SPEED * dt;
        let (nx, ny, _) = self
            .ring
            .slide(l.x, l.y, dx / d * step, dy / d * step, l.r());
        self.lions[k].x = nx;
        self.lions[k].y = ny;
    }

    /// Comes down, claws out, on whoever's there.
    fn lion_land(&mut self, k: usize, x: f64, y: f64, now: u32, evs: &mut Vec<Event>) {
        let id = self.lions[k].id as u32;
        evs.push(Event::new(ev::LION_LAND, 0, id, x, y, 0));
        self.lions[k].pounced = true;
        self.lion_set(k, lion::RECOVER, now, now + LION_RECOVER_MS);
        for j in 0..self.fighters.len() {
            let f = &self.fighters[j];
            if f.reach_to(x, y) < LION_BITE_R + f.body() {
                let m = if f.giant { GIANT_LION_X } else { 1.0 }
                    * if self.lions[k].big { BIG_LION_X } else { 1.0 };
                let from = if (f.x - x).hypot(f.y - y) < 0.05 {
                    (x - 0.05, y)
                } else {
                    (x, y)
                };
                self.hazard(j, from, LION_DMG * m, LION_KB, LION_STUN_MS, true, now, evs);
            }
        }
    }

    /// A blow lands on lion `k`, from `from`.
    fn lion_struck(
        &mut self,
        k: usize,
        by: Option<usize>,
        from: (f64, f64),
        dmg: f64,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let l = &mut self.lions[k];
        if !l.exposed() {
            return;
        }
        l.hp -= dmg;
        // (The merest tap, for a thief.)
        if l.thief {
            l.hp = 0.0;
        }
        // (The scorpion's far too heavy to be knocked about, or put off its sting.)
        if !l.scorpion && !l.thief {
            let dir = (l.y - from.1).atan2(l.x - from.0);
            l.kvx = dir.cos() * 4.0;
            l.kvy = dir.sin() * 4.0;
        }
        let (id, x, y, crouched) = (l.id as u32, l.x, l.y, l.act == lion::CROUCH && !l.scorpion);
        let who = by.map(|i| self.fighters[i].id).unwrap_or(0);
        evs.push(Event::new(ev::LION_HIT, who, id, x, y, dmg.round() as u16));
        if let Some(i) = by {
            self.fighters[i].gain_rage(dmg * 0.6);
        }
        if self.lions[k].hp <= 0.0 {
            self.lion_dies(k, who, now, evs);
        } else if crouched && dmg >= 12.0 {
            // A good blow, right as it crouches: put off its spring.
            self.lion_set(k, lion::RECOVER, now, now + LION_STAGGER_MS);
        }
    }

    fn lion_dies(&mut self, k: usize, by: u32, now: u32, evs: &mut Vec<Event>) {
        self.lions[k].hp = 0.0;
        self.lion_set(k, lion::DEAD, now, now + LION_GONE_MS);
        let l = &self.lions[k];
        evs.push(Event::new(ev::LION_DOWN, by, l.id as u32, l.x, l.y, 0));
        // A thief lets go of what it had, for whoever wants it.
        if l.item != 0 {
            let (kind, x, y) = (l.item, l.x, l.y);
            self.lions[k].item = 0;
            self.gifts.push(Gift {
                kind,
                x,
                y,
                lands: now,
                gone: u32::MAX,
                stale: now + THIEF_AFTER_MS,
            });
        }
    }

    /// A blast from (x, y) reaching any lions.
    #[allow(clippy::too_many_arguments)]
    fn blast_lions(
        &mut self,
        by: Option<usize>,
        x: f64,
        y: f64,
        r: f64,
        dmg: f64,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        for k in 0..self.lions.len() {
            let l = &self.lions[k];
            let d = (l.x - x).hypot(l.y - y);
            if l.exposed() && d < r + l.r() {
                let near = 1.0 - (d / r).min(1.0) * 0.6;
                self.lion_struck(k, by, (x, y), dmg * near, now, evs);
            }
        }
    }

    /// Fighter `i`'s swing through the arc in front of them, at any lions in it.
    #[allow(clippy::too_many_arguments)]
    fn swing_at_lions(
        &mut self,
        i: usize,
        reach: f64,
        arc: f64,
        dmg: f64,
        again_ms: u32,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let a = self.fighters[i].clone();
        for k in 0..self.lions.len() {
            let l = &self.lions[k];
            let d = (l.x - a.x).hypot(l.y - a.y);
            if !l.exposed()
                || d >= reach + l.r()
                || (d >= 0.05 && turn(a.aim, (l.y - a.y).atan2(l.x - a.x)).abs() > arc)
                || !self.ring.clear_line(a.x, a.y, l.x, l.y)
            {
                continue;
            }
            let key = LION_KEY + l.id as u32;
            if let Some(&(_, at)) = a.hit_list.iter().find(|(id, _)| *id == key)
                && (again_ms == 0 || now < at + again_ms)
            {
                continue;
            }
            let f = &mut self.fighters[i];
            f.hit_list.retain(|(id, _)| *id != key);
            f.hit_list.push((key, now));
            self.lion_struck(k, Some(i), (a.x, a.y), dmg, now, evs);
        }
    }

    /// One fighter's tick: stamina, their swing playing out (its blow
    /// landing), being knocked flying.
    fn tick_fighter(&mut self, i: usize, now: u32, dt: f64, evs: &mut Vec<Event>) {
        if self.fighters[i].down {
            return;
        }
        {
            let f = &mut self.fighters[i];
            // The potion, working slowly.
            if now < f.regen_until {
                f.hp = (f.hp + f.regen_hps * dt).min(f.max_hp);
            }
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
            // Standing still (and doing nothing) a while: their wounds slowly close.
            let moved = (f.x - f.last_pos.0).hypot(f.y - f.last_pos.1) > 0.01;
            if moved || !matches!(f.act, act::NONE | act::BLOCK) || now < f.knocked_until {
                f.still_since = now;
            }
            f.last_pos = (f.x, f.y);
            let (wait, hps) = if f.giant {
                (GIANT_REST_MS, GIANT_REST_HPS)
            } else {
                (REST_MS, REST_HPS)
            };
            if now >= f.still_since + wait && f.hp < f.max_hp {
                f.hp = (f.hp + hps * dt).min(f.max_hp);
                f.healing_until = f.healing_until.max(now + 300);
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
            // A roll asked for just too soon: as soon as it can.
            if f.roll_wanted.0 != 0 {
                let (at, aim) = f.roll_wanted;
                let wind = if f.giant {
                    GIANT_DASH_COST
                } else {
                    ROLL_COST * 0.5 * KIT_COST[f.k()]
                };
                if now > at + INPUT_BUFFER_MS {
                    f.roll_wanted = (0, 0.0);
                } else if f.can_roll(now) && f.stamina >= wind {
                    let id = f.id;
                    f.roll_wanted = (0, 0.0);
                    evs.extend(self.input(id, input::ROLL, aim, now));
                }
            }
            let f = &mut self.fighters[i];
            // A blow (or a charge) asked for while busy: now it's free, it goes.
            if f.pending.0 != 0 {
                let (what, at, aim) = f.pending;
                let keep = if what == input::HEAVY_START {
                    HELD_CHARGE_BUFFER_MS
                } else if f.giant {
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
                    f.release_wanted = false;
                } else if f.free(now) {
                    f.pending = (0, 0, 0.0);
                    let id = f.id;
                    let more = if f.giant {
                        self.giant_input(i, what, aim, now).unwrap_or_default()
                    } else {
                        self.input(id, what, aim, now)
                    };
                    evs.extend(more);
                    let f = &mut self.fighters[i];
                    let let_go = std::mem::take(&mut f.release_wanted);
                    if what == input::HEAVY_START && f.act == act::CHARGE {
                        // Held while they were busy: it counts, as far as a
                        // proper charge (not a slash for having had to wait).
                        f.act_at = now - now.saturating_sub(at).min(HEAVY_MIN_MS);
                        if let_go {
                            evs.extend(self.input(id, input::HEAVY_RELEASE, aim, now));
                        }
                    }
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
                    let stab = f.shoots();
                    let dmg = f.fury(now)
                        * if stab {
                            STAB_DMG
                        } else {
                            LIGHT_DMG[k] * KIT_LIGHT_DMG[f.k()]
                        };
                    let (bits, stun) = if stab {
                        (STAB_BIT, 0)
                    } else if k == 2 {
                        (4, 380)
                    } else {
                        (0, 230)
                    };
                    self.cleave(
                        i,
                        KIT_LIGHT_REACH[f.k()],
                        KIT_LIGHT_ARC[f.k()],
                        dmg,
                        if stab { STAB_KB } else { LIGHT_KB[k] },
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
                    if g.queued && k < 2 && g.spend(g.light_cost(), now) {
                        g.queued = false;
                        // (Stabs go left, right, left: no third, heavier blow.)
                        let n = if g.shoots() { 1 - k } else { k + 1 };
                        let next = act::LIGHT1 + n as u8;
                        let (w, a, r) = g.light(n);
                        g.set(next, now, w + a + r);
                        evs.push(Event::new(ev::SWING, g.id, 0, g.x, g.y, next as u16));
                    } else {
                        g.queued = false;
                        g.act = act::NONE;
                    }
                } else if since >= w + a && g.queued && k < 2 && !g.shoots() {
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
                // (The bow's three, one after another; or one big bomb.)
                let n = if f.kit == kit::ARCHER { f.arrows() } else { 1 };
                while self.fighters[i].shots < n
                    && since >= SHOOT.0 + self.fighters[i].shots as u32 * BURST_GAP_MS
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
                        let mut m = Missile::new(f.id, kind, f.x, f.y, a);
                        // (A bomb in the Goliath's hands: one great big one.)
                        if kind == gift::BOMB && f.giant {
                            m.kind = missile::BIG_BOMB;
                            m.dmg = GIANT_BOMB_DMG;
                            m.r = BIG_BOMB_R.1;
                        }
                        let mut e = Event::new(ev::THROW, f.id, 0, f.x, f.y, m.kind as u16);
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
            // Whirling someone round: a click throws them now, at the mouse
            // (the whirl skips to its end; the hurl's the next tick's).
            // (A player's throw: a bot Goliath, clicking away, whirls them the whole way round.)
            input::LIGHT
                if self.fighters[i].act == act::GRAB
                    && !self.fighters[i].bot
                    && now.saturating_sub(self.fighters[i].act_at) >= GRAB_THROW_AFTER_MS
                    && now.saturating_sub(self.fighters[i].act_at) < GRAB_SPIN_MS =>
            {
                let f = &mut self.fighters[i];
                f.aim = aim;
                f.pending = (0, 0, 0.0);
                f.act_at = now - GRAB_SPIN_MS;
                f.act_until = now + 250;
            }
            input::LIGHT => {
                let f = &mut self.fighters[i];
                if f.free(now) {
                    f.aim = aim;
                    f.start_smash(now, &mut evs);
                } else {
                    // Still busy: it swings the moment it's free.
                    f.pending = (input::LIGHT, now, aim);
                }
            }
            input::HEAVY_START => {
                let f = &mut self.fighters[i];
                if !f.free(now) {
                    // Still busy: it crouches to leap the moment it's free.
                    f.pending = (input::HEAVY_START, now, aim);
                } else if f.can_charge(now) {
                    f.pending = (0, 0, 0.0);
                    f.aim = aim;
                    f.set(act::CHARGE, now, u32::MAX - now);
                }
            }
            input::HEAVY_RELEASE => {
                let f = &mut self.fighters[i];
                if f.act != act::CHARGE && f.pending.0 == input::HEAVY_START {
                    // Let go before it was ever free to crouch.
                    f.let_go(now, aim);
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
                    } else if f.stamina >= SMASH_COST * 0.5 {
                        // Let go too soon: a smash. (Too tired to leap: nothing; a click still smashes, slower.)
                        f.start_smash(now, &mut evs);
                    } else {
                        f.act = act::NONE;
                    }
                }
            }
            input::ROLL => {
                let f = &mut self.fighters[i];
                if f.can_roll(now) && f.stamina >= GIANT_DASH_COST {
                    f.roll_wanted = (0, 0.0);
                    f.drain(GIANT_DASH_COST, now);
                    f.queued = false;
                    if f.pending.0 == input::HEAVY_START {
                        f.pending = (0, 0, 0.0);
                    }
                    f.roll_dir = aim;
                    f.set(act::ROLL, now, GIANT_DASH_MS);
                    f.dash_from = (f.x, f.y);
                    f.hit_list.clear();
                    f.roll_ready = now + GIANT_DASH_MS + ROLL_CD_MS;
                    evs.push(Event::new(ev::ROLL, f.id, 0, f.x, f.y, 1));
                } else if f.roll_wanted.0 == 0 {
                    f.roll_wanted = (now.max(1), aim);
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
                    && !v.immune()
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
                        && !v.immune()
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
        // A shield bursts in its grasp: they slip free (its rage is spent all the same).
        if self.fighters[j].shields > 0 {
            return self.burst_shield(g.id, j, evs);
        }
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
        let (w, _, _) = smash_times(f.tired);
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
                    SMASH_DMG * f.fury(now) * if f.tired { TIRED_SMASH_DMG } else { 1.0 },
                    8.5,
                    2,
                    520,
                    now,
                    evs,
                );
            }
            let dmg = SMASH_DMG * f.fury(now) * if f.tired { TIRED_SMASH_DMG } else { 1.0 };
            self.swing_at_lions(i, SMASH_REACH, SMASH_ARC, dmg, 0, now, evs);
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
            self.blast_lions(Some(i), x, y, r, dmg, now, evs);
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
        // Two against two: the last team up; its best fighter's named.
        if self.mode == mode::TEAMS {
            let mut up = self.fighters.iter().filter(|f| !f.down);
            let first = up.next().map(|f| f.team);
            if up.any(|f| Some(f.team) != first) {
                return None;
            }
            return Some(
                self.fighters
                    .iter()
                    .filter(|f| Some(f.team) == first)
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
                // (Whoever's nearest a wall, to pin there.)
                + self.ring.reach(f.x, f.y) * 1.5 * sk.hunt
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
        // A lion at it: swatted aside first.
        if me.free(now) && now >= me.ai.next_attack {
            let lion_near = self
                .lions
                .iter()
                .filter(|l| l.exposed())
                .find(|l| (l.x - me.x).hypot(l.y - me.y) < SMASH_REACH * 0.8 + l.r());
            if let Some(l) = lion_near {
                let a = (l.y - me.y).atan2(l.x - me.x);
                self.fighters[i].aim = a;
                evs.extend(self.input(me.id, input::LIGHT, a, now));
                self.fighters[i].ai.next_attack =
                    now + (sk.gap.0 * sk.giant_gap + rng() * sk.gap.1) as u32;
                return evs;
            }
        }
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
        // (Hunting, it holds a charge longer: the same leap, a harder landing.)
        let charge_for = (charge_for + (350.0 * sk.hunt) as u32).min(GIANT_CHARGE_MS);
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
            // (Hunting, its stamina's for leaping: it only dashes past a leap's reach.)
            && (SMASH_REACH + 0.3 + (STOMP_LEAP - SMASH_REACH) * sk.hunt..9.5).contains(&d)
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
            if me.rage >= RAGE && d < GRAB_REACH + (GRAB_LUNGE - GRAB_REACH) * sk.hunt + GIANT_R {
                evs.extend(self.input(me.id, input::SPECIAL, toward, now));
            } else if (crowd >= 2
                || (d < 6.3 + (STOMP_LEAP + 1.0 - 6.3) * sk.hunt
                    && d > 3.0 - 2.0 * sk.hunt
                    // (Hunting, right on top of someone it's as likely to smash.)
                    && rng()
                        < sk.lunge * 1.5
                            + if !thinking {
                                0.0
                            } else if sk.hunt > 0.0 && d < 3.0 {
                                0.6
                            } else {
                                0.12 + 0.3 * sk.cunning + 0.35 * sk.hunt
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
                // (Hunting, it doesn't flail itself out of breath: it gets its
                // wind back for a leap, stamina only returning between blows.)
                if sk.hunt > 0.0 && me.stamina < STOMP_COST + 5.0 {
                    self.fighters[i].ai.next_attack = now + 400;
                } else if let Some(a) = best {
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
                    gift::HEALTH | gift::REGEN => f.hp < GIANT_HP * 0.75,
                    gift::SPEAR | gift::BOMB => f.holding == 0,
                    _ => true,
                })
                .map(|g| (g.x, g.y, (g.x - f.x).hypot(g.y - f.y)))
                .filter(|g| g.2 < sk.gift_r * 0.8 && !foes.iter().any(|o| dist(o) < 1.8))
                .min_by(|a, b| a.2.total_cmp(&b.2));
            let safe = self.safe_to(now);
            let (hx, hy) = (self.ring.w / 2.0 - f.x, self.ring.h / 2.0 - f.y);
            let (mx, my) = if self.ring.reach(f.x, f.y) > safe - 0.14 {
                // The fire or the lava at its heels: inwards, whatever else.
                let hd = hx.hypot(hy).max(0.01);
                (hx / hd, hy / hd)
            } else if let (Some((gx, gy, gd)), act::NONE | act::BLOCK) = (gift, f.act) {
                ((gx - f.x) / gd.max(0.01), (gy - f.y) / gd.max(0.01))
            } else {
                let radial = ((d - 1.6) / 0.8).clamp(-1.0, 1.0);
                let (ox, oy) = (t.x - self.ring.w / 2.0, t.y - self.ring.h / 2.0);
                let out = ox.hypot(oy);
                if sk.hunt > 0.0 && out > 1.0 && d > 1.2 {
                    // Hunting: not at them but between them and the open sand,
                    // a step ahead of where they're running, so there's only
                    // the wall left behind them (and its blows drive them into it).
                    let px = t.x + t.vx * 0.35 - ox / out * 1.8;
                    let py = t.y + t.vy * 0.35 - oy / out * 1.8;
                    let (vx, vy) = (px - f.x, py - f.y);
                    let vd = vx.hypot(vy).max(0.01);
                    let k = (vd / 0.6).min(1.0) / vd;
                    (vx * k, vy * k)
                } else {
                    (dx / d * radial, dy / d * radial)
                }
            };
            let slow = match f.act {
                act::CHARGE => 0.5,
                act::GRAB => 0.35,
                act::BLOCK => 0.45,
                _ => 1.0,
            } * GIANT_SPEED
                * f.speed_x(now)
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
        // (Lions in its way, as anyone.)
        for k in 0..self.lions.len() {
            let l = &self.lions[k];
            let key = LION_KEY + l.id as u32;
            let t = if len2 < 1e-9 {
                0.0
            } else {
                (((l.x - x0) * dx + (l.y - y0) * dy) / len2).clamp(0.0, 1.0)
            };
            let (px, py) = (x0 + dx * t, y0 + dy * t);
            if l.exposed()
                && (l.x - px).hypot(l.y - py) < r + l.r()
                && !self.fighters[i].hit_list.iter().any(|(id, _)| *id == key)
            {
                self.fighters[i].hit_list.push((key, now));
                self.lion_struck(k, Some(i), (a.x, a.y), dmg, now, evs);
            }
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
        let again = if a.act == act::SPIN { SPIN_EVERY_MS } else { 0 };
        self.swing_at_lions(i, reach, arc, dmg, again, now, evs);
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
        // A shield takes the blow, whatever it was, and bursts.
        if v.shields > 0 {
            return self.burst_shield(aid, j, evs);
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
        // The shield: facing the blow (of blasts, it only stops a bomb's; and
        // with no stamina left, it stops no arrow or bomb at all).
        let bomb = bits & SHOT_BOMB != 0;
        let shot = bomb || bits & SHOT_ARROW != 0;
        let faced = turn(v.aim, dir + PI).abs() <= BLOCK_ARC
            || (bomb && (v.x - ax).hypot(v.y - ay) < BLOCK_BOMB_CLOSE);
        if v.act == act::BLOCK && (bits & 32 == 0 || bomb) && faced && !(shot && v.stamina <= 0.0) {
            if now.saturating_sub(v.block_at) <= PARRY_MS && !thrown && !bomb && bits & 16 == 0 {
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
                let (cost, taken) = if bits & STAB_BIT != 0 {
                    (STAB_BLOCK_COST, 0.15)
                } else if bomb {
                    (BLOCK_BOMB_COST, BLOCK_SHOT_TAKEN)
                } else if bits & SHOT_STORM != 0 {
                    (BLOCK_ARROW_COST * BLOCK_STORM_ARROW, BLOCK_SHOT_TAKEN)
                } else if shot {
                    (BLOCK_ARROW_COST, BLOCK_SHOT_TAKEN)
                } else {
                    (BLOCK_HIT_COST, 0.15)
                };
                v.drain(cost, now);
                dmg *= taken;
                kb *= if bomb { BLOCK_BOMB_KB } else { 0.35 };
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
        } else if v.bot && self.level == crate::level::EXTREME {
            dmg *= EXTREME_GIANT_TAKEN;
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
        e.m = bits & !(SHOT_ARROW | SHOT_BOMB | SHOT_STORM);
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
        let lions = &self.lions;
        missiles.retain_mut(|m| {
            let fighters = &self.fighters;
            let by = m.by;
            // (Unless it's every one for themselves, it flies on past the thrower's own side.)
            let side = fighters.iter().find(|f| f.id == by).map(|f| f.team);
            let sides = self.mode != mode::CLASSIC;
            // Knocked back: it homes in on them, wherever they run.
            if m.chase != 0 {
                if let Some(t) = fighters.iter().find(|f| f.id == m.chase && !f.down) {
                    let (dx, dy) = (t.x - m.x, t.y - m.y);
                    let d = dx.hypot(dy).max(0.01);
                    m.vx = dx / d * BOUNCE_SPEED;
                    m.vy = dy / d * BOUNCE_SPEED;
                    m.left = d + 0.3;
                } else {
                    m.chase = 0;
                }
            }
            let m_kind = m.kind;
            let flight = m.advance(&self.ring, dt, |x, y| {
                fighters
                    .iter()
                    .position(|f| {
                        f.id != by
                            && !(sides && side == Some(f.team))
                            && !f.down
                            && f.flags(now) & flag::IFRAMES == 0
                            && f.reach_to(x, y) < f.body() + 0.2
                    })
                    .or_else(|| {
                        lions
                            .iter()
                            .position(|l| {
                                m_kind != missile::DART
                                    && l.exposed()
                                    && (l.x - x).hypot(l.y - y) < l.r() + 0.2
                            })
                            .map(|k| LION_HIT + k)
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
                // (The Goliath's bombs blast twice the ground; one sent back's as it came.)
                let r = if m.chase == 0 && shooter.is_some_and(|i| self.fighters[i].giant) {
                    m.r * GIANT_BOMB_R
                } else {
                    m.r
                };
                if let Some(i) = shooter
                    && let Some(j) = self.bouncer(i, &m, x, y, r)
                {
                    self.bounce(i, j, &m, x, y, r, now, evs);
                    continue;
                }
                evs.push(Event::new(ev::BOOM, m.by, 0, x, y, (r * 100.0) as u16));
                self.blast_lions(shooter, x, y, r, m.dmg, now, evs);
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
                            // (Not one your shield sent back: that's theirs.)
                            let f = &mut self.fighters[j];
                            if f.immune() || m.chase != 0 {
                                continue;
                            }
                            f.hp -= dmg * 0.6;
                            if f.hp <= 0.0 {
                                self.knock_down(j, 0, now, evs);
                            }
                        }
                    }
                }
            } else if m.kind == missile::DART {
                self.dart_lands(&m, flight, now, evs);
            } else if let Flight::Hit(k, _, _) = flight
                && k >= LION_HIT
            {
                let dmg = m.dmg * shooter.map_or(1.0, |i| self.fighters[i].fury(now));
                self.lion_struck(k - LION_HIT, shooter, (x - m.vx, y - m.vy), dmg, now, evs);
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
                    let bits = match m.kind {
                        missile::ARROW if m.dmg <= VOLLEY_AIMED_DMG => 8 | SHOT_ARROW | SHOT_STORM,
                        missile::ARROW => 8 | SHOT_ARROW,
                        _ => 8,
                    };
                    self.strike(i, j, from, dmg, kb, bits, stun, now, evs);
                }
            } else {
                let mut e = Event::new(ev::STUCK, m.by, 0, x, y, m.kind as u16);
                e.m = aim_to_u16(m.vy.atan2(m.vx));
                evs.push(e);
            }
        }
    }

    /// The scorpion's dart comes to rest: in someone (a guard turns it, and
    /// that's that), or in the wall.
    fn dart_lands(&mut self, m: &Missile, flight: Flight, now: u32, evs: &mut Vec<Event>) {
        let Flight::Hit(j, x, y) = flight else {
            if let Flight::Stopped(x, y) = flight {
                let mut e = Event::new(ev::STUCK, m.by, 0, x, y, m.kind as u16);
                e.m = aim_to_u16(m.vy.atan2(m.vx));
                evs.push(e);
            }
            return;
        };
        let from = (-m.vy).atan2(-m.vx);
        let v = &mut self.fighters[j];
        let id = v.id;
        if v.act == act::BLOCK && v.stamina > 0.0 && turn(v.aim, from).abs() <= BLOCK_ARC {
            v.drain(DART_BLOCK_COST, now);
            evs.push(Event::new(ev::DART_HIT, m.by, id, x, y, 1));
            return;
        }
        evs.push(Event::new(ev::DART_HIT, m.by, id, x, y, 0));
        let back = (x - m.vx, y - m.vy);
        if self.hazard(j, back, DART_DMG, 1.2, 0, false, now, evs) {
            self.poison(j, now, evs);
        }
    }

    /// The tank (or the Goliath) whose guard catches a bomb coming down at (x, y) (the
    /// `r` of its blast would reach them), facing the way it came, with the
    /// stamina to knock it back. (Knocked back once, it's for keeps.)
    fn bouncer(&self, i: usize, m: &Missile, x: f64, y: f64, r: f64) -> Option<usize> {
        if m.chase != 0 || self.fighters[i].down {
            return None;
        }
        let from = (-m.vy).atan2(-m.vx);
        (0..self.fighters.len()).find(|&j| {
            let v = &self.fighters[j];
            j != i
                && self.foes(i, j)
                && (v.giant || v.kit == kit::TANK)
                && !v.down
                && v.act == act::BLOCK
                && v.stamina >= v.bounce_cost(m)
                && v.reach_to(x, y) <= r
                && turn(v.aim, from).abs() <= BLOCK_ARC
        })
    }

    /// `j`'s guard sends `i`'s bomb straight back at them, theirs now.
    #[allow(clippy::too_many_arguments)]
    fn bounce(
        &mut self,
        i: usize,
        j: usize,
        m: &Missile,
        x: f64,
        y: f64,
        r: f64,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let target = (self.fighters[i].id, self.fighters[i].x, self.fighters[i].y);
        let v = &mut self.fighters[j];
        v.drain(v.bounce_cost(m), now);
        let aim = (target.2 - y).atan2(target.1 - x);
        let mut back = Missile::new(v.id, m.kind, x, y, aim);
        back.x = x;
        back.y = y;
        back.vx = aim.cos() * BOUNCE_SPEED;
        back.vy = aim.sin() * BOUNCE_SPEED;
        back.left = (target.1 - x).hypot(target.2 - y) + 0.3;
        back.dmg = m.dmg;
        back.r = r;
        back.chase = target.0;
        evs.push(Event::new(ev::BOUNCE, m.by, v.id, x, y, m.kind as u16));
        let mut e = Event::new(ev::THROW, v.id, 0, x, y, m.kind as u16);
        e.m = aim_to_u16(aim);
        e.vx = back.left;
        e.vy = BOUNCE_SPEED;
        evs.push(e);
        self.missiles.push(back);
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
        let mut m = match f.kit {
            kit::ARCHER => {
                let mut m = Missile::new(f.id, missile::ARROW, f.x, f.y, f.aim);
                // (Only a full draw has the weight to stop anyone.)
                m.dmg = if f.charge >= 1.0 {
                    BURST_DMG
                } else {
                    DRAWN_DMG
                };
                m.left = BURST_RANGE;
                m.vx = f.aim.cos() * BURST_SPEED;
                m.vy = f.aim.sin() * BURST_SPEED;
                m
            }
            _ => {
                let mut m = Missile::new(f.id, missile::BIG_BOMB, f.x, f.y, f.aim);
                m.left = to_mouse;
                m.dmg = BIG_BOMB_DMG.0 + (BIG_BOMB_DMG.1 - BIG_BOMB_DMG.0) * f.charge;
                m.r = BIG_BOMB_R.0 + (BIG_BOMB_R.1 - BIG_BOMB_R.0) * f.charge;
                m.cost = BIG_BOMB_COST.0 + (BIG_BOMB_COST.1 - BIG_BOMB_COST.0) * f.charge;
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
                self.blast_lions(
                    Some(i),
                    f.x,
                    f.y,
                    BLAST_R,
                    BLAST_DMG * f.fury(now),
                    now,
                    evs,
                );
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
                self.blast_lions(
                    Some(i),
                    f.x,
                    f.y,
                    QUAKE_R,
                    QUAKE_DMG * f.fury(now),
                    now,
                    evs,
                );
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

    /// A bomb's blast from (x, y) reaching `j` (thrown by `i`): a block takes the worst of it.
    #[allow(clippy::too_many_arguments)]
    /// `j`'s shield takes a blow from `by`, and bursts.
    fn burst_shield(&mut self, by: u32, j: usize, evs: &mut Vec<Event>) {
        let v = &mut self.fighters[j];
        v.shields -= 1;
        evs.push(Event::new(ev::SHIELD, by, v.id, v.x, v.y, v.shields as u16));
    }

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
        self.strike(i, j, from, dmg, 9.0, 32 | SHOT_BOMB, 450, now, evs);
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
                    gift::ALL[(rng() * gift::ALL.len() as f64) as usize % gift::ALL.len()]
                };
                self.gifts.push(Gift {
                    kind,
                    x,
                    y,
                    lands: now + GIFT_FALL_MS,
                    gone: u32::MAX,
                    stale: now
                        + GIFT_FALL_MS
                        + THIEF_AFTER_MS
                        + (rng() * THIEF_AFTER_JITTER_MS as f64) as u32,
                });
                evs.push(Event::new(ev::GIFT_INCOMING, 0, 0, x, y, kind as u16));
                break;
            }
        }
        self.send_thieves(now, evs);
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
                    && (gift::instant(g.kind) || f.holding == 0)
            });
            if let Some(j) = taker {
                let f = &mut self.fighters[j];
                match g.kind {
                    // (The Goliath eats twice as much.)
                    gift::HEALTH if f.giant => {
                        f.hp = (f.hp + HEAL * GIANT_GIFT_HEAL).min(GIANT_HP);
                        f.healing_until = now + FED_SHOW_MS;
                    }
                    gift::HEALTH => {
                        f.hp = (f.hp + HEAL).min(f.max_hp);
                        f.healing_until = now + FED_SHOW_MS;
                    }
                    gift::FURY => {
                        f.fury_until = now + if f.giant { GIANT_FURY_MS } else { FURY_MS };
                    }
                    gift::SPEED => {
                        f.speed_until = now
                            + if f.giant {
                                GIANT_SPEED_GIFT_MS
                            } else {
                                SPEED_GIFT_MS
                            };
                    }
                    gift::REGEN => {
                        let all = HEAL * REGEN_HEAL * if f.giant { GIANT_GIFT_HEAL } else { 1.0 };
                        f.regen_until = now + REGEN_MS;
                        f.regen_hps = all / (REGEN_MS as f64 / 1000.0);
                    }
                    gift::SHIELD => f.shields = if f.giant { GIANT_SHIELDS } else { 1 },
                    kind => f.holding = kind,
                }
                evs.push(Event::new(ev::PICKUP, f.id, 0, g.x, g.y, g.kind as u16));
                self.gifts.remove(k);
            } else {
                k += 1;
            }
        }
    }

    /// Whatever's lain untouched long enough, with nobody about: a thief comes for it.
    fn send_thieves(&mut self, now: u32, evs: &mut Vec<Event>) {
        for k in 0..self.gifts.len() {
            let out = self
                .lions
                .iter()
                .filter(|l| l.thief && l.act != lion::DEAD)
                .count();
            if out >= THIEF_MAX {
                return;
            }
            let g = self.gifts[k];
            if now < g.stale {
                continue;
            }
            let watched = self
                .fighters
                .iter()
                .any(|f| !f.down && (f.x - g.x).hypot(f.y - g.y) < THIEF_WARY_R);
            if watched {
                // (Another look in a moment.)
                self.gifts[k].stale = now + 1500;
                continue;
            }
            self.gifts[k].stale = u32::MAX;
            self.thieves += 1;
            let id = THIEF_ID + (self.thieves % 50) as u8;
            let (x, y) = (g.x, g.y - 0.42);
            self.lions.push(Lion {
                id,
                x,
                y,
                aim: if id % 2 == 0 { 0.0 } else { PI },
                hp: THIEF_HP,
                act: lion::SNEAK,
                act_at: now,
                act_until: now + THIEF_PEEK_MS + THIEF_ROUND_MS,
                target: 0,
                to: (g.x, g.y),
                from: (x, y),
                pounced: false,
                kvx: 0.0,
                kvy: 0.0,
                scorpion: false,
                next_dart: now + 300,
                next_rush: 0,
                thief: true,
                item: 0,
                big: false,
            });
            evs.push(Event::new(
                ev::THIEF_OUT,
                0,
                id as u32,
                g.x,
                g.y,
                g.kind as u16,
            ));
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
    /// A gladiator bot with a lion on it: it gets clear of the pounce if it
    /// can (the more it reads, the likelier), and turns on the beast. Whether
    /// it took the turn.
    #[allow(clippy::too_many_arguments)]
    fn bot_lion(
        &mut self,
        i: usize,
        sk: &Skill,
        now: u32,
        dt: f64,
        rng: &mut impl FnMut() -> f64,
        safe: f64,
        evs: &mut Vec<Event>,
    ) -> bool {
        let me = self.fighters[i].clone();
        if self.ring.reach(me.x, me.y) > safe - 0.14 {
            return false;
        }
        let shooter = me.shoots();
        let Some(l) = self
            .lions
            .iter()
            .filter(|l| l.exposed())
            .min_by(|a, b| {
                let d = |l: &Lion| (l.x - me.x).hypot(l.y - me.y);
                d(a).total_cmp(&d(b))
            })
            .cloned()
        else {
            return false;
        };
        let (dx, dy) = (l.x - me.x, l.y - me.y);
        let d = dx.hypot(dy).max(0.01);
        // (Only one that's on it, or close.)
        if d > if l.target == me.id { 7.0 } else { 2.6 } {
            return false;
        }
        let aim = dy.atan2(dx) + me.ai.wobble * 0.5;
        // Its crouch seen, a beat late: a roll out of its line.
        let springing = l.target == me.id
            && l.act == lion::CROUCH
            && now >= l.act_at + (sk.react.0 + sk.react.1 * 0.5) as u32;
        if springing
            && me.can_cancel(now)
            && now >= me.roll_ready
            && me.stamina > ROLL_COST + 2.0
            && rng() < sk.read * 0.35
        {
            let side = if rng() < 0.5 { FRAC_PI_2 } else { -FRAC_PI_2 };
            evs.extend(self.input(me.id, input::ROLL, aim + side, now));
            return true;
        }
        let reach = KIT_LIGHT_REACH[me.k()] + l.r() - 0.1;
        // (Its bow or bomb, drawn a moment: let go.)
        if me.act == act::CHARGE && now >= me.act_at + me.ai.charge_for {
            if shooter {
                self.fighters[i].reach = d;
            }
            evs.extend(self.input(me.id, input::HEAVY_RELEASE, aim, now));
            self.fighters[i].ai.next_attack =
                now + (sk.gap.0 * 0.6 + rng() * sk.gap.1 * 0.6) as u32;
            return true;
        }
        if me.free(now) && now >= me.ai.next_attack {
            if d < reach && me.stamina > me.light_cost() {
                evs.extend(self.input(me.id, input::LIGHT, aim, now));
                self.fighters[i].ai.next_attack = now
                    + ((sk.gap.0 * 0.6 + rng() * sk.gap.1 * 0.6) * KIT_LIGHT_TIME[me.k()]) as u32;
            } else if shooter
                && d < quick_range(me.kit)
                && self.ring.clear_line(me.x, me.y, l.x, l.y)
                && me.can_charge(now)
            {
                evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                self.fighters[i].ai.charge_for = HEAVY_MIN_MS + 40;
            }
        }
        if !self.fighters[i].free(now) {
            self.fighters[i].aim = aim;
            return true;
        }
        // In on it with a blade; a bow or bomb keeps its distance.
        let want = if shooter {
            4.0 + l.r()
        } else {
            KIT_LIGHT_REACH[me.k()] * 0.8 + l.r() - LION_R
        };
        let radial = ((d - want) / 0.8).clamp(-1.0, 1.0);
        let slow = sk.speed * KIT_SPEED[me.k()] * me.speed_x(now);
        let (nx, ny, _) = self.ring.slide(
            me.x,
            me.y,
            dx / d * radial * SPEED * slow * dt,
            dy / d * radial * SPEED * slow * dt,
            BODY_R,
        );
        let f = &mut self.fighters[i];
        f.vx = (nx - f.x) / dt;
        f.vy = (ny - f.y) / dt;
        f.x = nx;
        f.y = ny;
        f.aim = aim;
        true
    }

    fn bot(&mut self, i: usize, now: u32, dt: f64, rng: &mut impl FnMut() -> f64) -> Vec<Event> {
        let mut evs = Vec::new();
        let me = self.fighters[i].clone();
        if me.down || now < me.knocked_until {
            return evs;
        }
        if me.giant {
            return self.giant_bot(i, now, dt, rng);
        }
        let fire = self.safe_to(now);
        let sk = skill(self.level);
        if self.bot_lion(i, &sk, now, dt, rng, fire, &mut evs) {
            return evs;
        }
        let goliath = self.mode == mode::GOLIATH;
        let sides = self.mode != mode::CLASSIC;
        let foe_of = |a: &Fighter, b: &Fighter| a.id != b.id && (!sides || a.team != b.team);
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
                // (Hunting: finish off the hurt.)
                w += (1.0 - f.hp / f.max_hp) * 3.0 * sk.hunt;
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
            // (Hunting, it's soon back in.)
            let mut intent = if me.ai.intent == intent::RECOVER
                && me.stamina < 55.0 - 20.0 * sk.hunt
                || me.stamina < 22.0 - 8.0 * sk.hunt
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
            HEAVY_MIN_MS + ((lunge - lo) / (hi - lo) * (me.full_ms() - HEAVY_MIN_MS) as f64) as u32
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
                // The bow or a bomb: held a moment, longer the cannier (and
                // a big one for a crowd or a giant).
                let archer = f.kit == kit::ARCHER;
                let cost = if archer {
                    BURST_MIN_COST
                } else {
                    BIG_BOMB_COST.0
                };
                let (range, more) = if archer {
                    (BURST_RANGE, 1.0)
                } else if t.giant || rng() < 0.2 + 0.2 * sk.cunning {
                    (LOB_RANGE, 1.0)
                } else {
                    (LOB_RANGE, 0.0)
                };
                if dist < range && f.stamina > cost + 6.0 {
                    evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                    let fill =
                        (f.full_ms() - HEAVY_MIN_MS) as f64 / (HEAVY_FULL_MS - HEAVY_MIN_MS) as f64;
                    self.fighters[i].ai.charge_for = HEAVY_MIN_MS
                        + (30.0
                            + more * (150.0 + 400.0 * sk.cunning.min(1.0) + rng() * 150.0) * fill)
                            as u32;
                }
            } else if (intent == intent::PRESS || f.shoots())
                && dist < KIT_LIGHT_REACH[f.k()] + t.body() - BODY_R + 0.15
                && now >= f.ai.next_attack
                && f.stamina > f.light_cost()
            {
                // (Against the Goliath, the heavy blow's the one that tells,
                // best when it's open; quick ones glance off it while it attacks.)
                let vs_giant = t.giant
                    && !f.shoots()
                    && f.stamina > HEAVY_COST + 5.0
                    && rng() < if open { 0.2 + 0.3 * sk.punish } else { 0.05 };
                if vs_giant
                    || ((t.act == act::BLOCK
                        || t.act == act::STUN
                        || (sk.hunt > 0.0 && t.winded(now)))
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
            .filter(|g| now + 400 >= g.lands && (gift::instant(g.kind) || f.holding == 0))
            .filter(|g| !matches!(g.kind, gift::HEALTH | gift::REGEN) || f.hp < HP - HEAL * 0.6)
            .filter(|g| !t.giant || open || (g.x - t.x).hypot(g.y - t.y) > SMASH_REACH * sk.cunning)
            .map(|g| (g.x, g.y, (g.x - f.x).hypot(g.y - f.y)))
            .filter(|g| {
                g.2 < sk.gift_r && (g.2 < dist + 1.5 || intent != intent::PRESS || f.hp < HP * 0.45)
            })
            .min_by(|a, b| a.2.total_cmp(&b.2));
        // A bomb coming down on it (hunting: it gets out from under).
        let bomb_near = self
            .missiles
            .iter()
            .filter(|_| sk.hunt > 0.0)
            .filter(|m| m.kind == gift::BOMB || m.kind == missile::BIG_BOMB)
            .filter(|m| self.fighters.iter().any(|o| o.id == m.by && foe_of(&f, o)))
            .map(|m| {
                let sp = m.vx.hypot(m.vy).max(0.01);
                (m.x + m.vx / sp * m.left, m.y + m.vy / sp * m.left, m.r)
            })
            .find(|b| (b.0 - f.x).hypot(b.1 - f.y) < b.2 + 0.4);
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
        // A meteor's mark under it: the more it reads, the likelier it's noticed.
        let meteor_near = self
            .meteors
            .iter()
            .filter(|m| (m.x * 137.0 + m.y * 59.0 + f.slot as f64).rem_euclid(1.0) < sk.read)
            .find(|m| (m.x - f.x).hypot(m.y - f.y) < METEOR_R + 0.6)
            .map(|m| (m.x, m.y, METEOR_R));
        // A cloud overhead, or about to be: out from under, across its path.
        let acid_near = self
            .clouds
            .iter()
            .filter(|c| c.delay <= now)
            .find(|c| {
                let x = c.x(now);
                in_cloud(x, c.y, f.x, f.y) || in_cloud(x + c.dir * ACID_SPEED * 0.8, c.y, f.x, f.y)
            })
            .map(|c| (f.x, c.y, 0.0));
        let (mut mx, mut my) = if self.ring.reach(f.x, f.y) > fire - 0.14 {
            (cx - f.x, cy - f.y)
        } else if let Some(s) = danger_spike {
            (f.x - (s.x + s.w / 2.0), f.y - (s.y + s.h / 2.0))
        } else if let Some((bx, by, _)) = bomb_near.or(meteor_near).or(acid_near) {
            (f.x - bx, f.y - by)
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
                intent::RECOVER => 3.6 - 1.2 * sk.hunt,
                _ if now < f.ai.next_attack && sk.cunning > 0.4 => 1.7 - 0.45 * sk.hunt,
                _ => 1.05,
            };
            let radial = ((dist - want) / 0.8).clamp(-1.0, 1.0);
            let (ux, uy) = (dx / dist, dy / dist);
            let strafe = self.fighters[i].ai.strafe;
            let (ox, oy) = (t.x - cx, t.y - cy);
            let out = ox.hypot(oy);
            if sk.hunt > 0.0 && intent == intent::PRESS && !f.shoots() && out > 1.0 {
                // Hunting: working round to the open side of them, to pin them to the wall.
                let (vx, vy) = toward_pt(t.x - ox / out * want, t.y - oy / out * want);
                (vx + ux * radial * 0.4, vy + uy * radial * 0.4)
            } else {
                (ux * radial - uy * strafe, uy * radial + ux * strafe)
            }
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
        } * KIT_SPEED[f.k()]
            * f.speed_x(now);
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
        let (easy, medium, hard, extreme) = (
            down_in(crate::level::EASY),
            down_in(crate::level::MEDIUM),
            down_in(crate::level::HARD),
            down_in(crate::level::EXTREME),
        );
        eprintln!(
            "ARENA LEVELS (ms to down someone): easy {easy}, medium {medium}, hard {hard}, extreme {extreme}"
        );
        assert!(
            easy > medium && medium > hard && hard > extreme,
            "easy {easy}, medium {medium}, hard {hard}, extreme {extreme}"
        );
    }

    /// A bot Goliath hunting a person who keeps to the middle of the sand, walking
    /// away from it: its leaps, and how close to a wall they've been driven on average.
    fn hunted(level: u8) -> (u32, f64) {
        let (mut stomps, mut out, mut n) = (0, 0.0, 0u32);
        for seed in 0..6u64 {
            let mut m = Match::new(ring());
            m.join(1, 0);
            m.set_level(1, level);
            m.set_mode(1, mode::GOLIATH, 1);
            assert!(m.start(1, false, 0));
            let mut r = rng(seed + 40);
            let mut now = 0;
            while m.status != FIGHTING {
                now += 100;
                m.step(now, 100, &mut r);
            }
            // (Just the two of them, the person's the only one to chase.)
            let giant = m.fighters.iter().find(|f| f.giant).unwrap().id;
            m.fighters
                .iter_mut()
                .filter(|f| !f.giant && f.id != 1)
                .for_each(|f| f.down = true);
            for f in m.fighters.iter_mut().filter(|f| f.giant) {
                f.bot = true;
            }
            for _ in 0..200 {
                now += 100;
                // Away from it, as anyone would.
                let (gx, gy) = m.fighter(giant).map(|g| (g.x, g.y)).unwrap();
                if let Some(p) = m.fighters.iter_mut().find(|f| f.id == 1) {
                    p.hp = p.max_hp;
                    p.down = false;
                    let (dx, dy) = (p.x - gx, p.y - gy);
                    let d = dx.hypot(dy).max(0.01);
                    p.x = (p.x + dx / d * SPEED * 0.1).clamp(0.5, 19.5);
                    p.y = (p.y + dy / d * SPEED * 0.1).clamp(0.5, 12.5);
                    p.vx = dx / d * SPEED;
                    p.vy = dy / d * SPEED;
                }
                stomps += m
                    .step(now, 100, &mut r)
                    .iter()
                    .filter(|e| e.kind == ev::STOMP && e.a == giant)
                    .count() as u32;
                if m.status != FIGHTING {
                    break;
                }
                let p = m.fighter(1).unwrap();
                out += m.ring.reach(p.x, p.y);
                n += 1;
            }
        }
        (stomps, out / n.max(1) as f64)
    }

    #[test]
    fn the_extreme_goliath_leaps_at_you_and_runs_you_into_the_walls() {
        let (hard, extreme) = (hunted(crate::level::HARD), hunted(crate::level::EXTREME));
        eprintln!("HUNTED hard {hard:?} extreme {extreme:?}");
        assert!(extreme.0 > hard.0, "leaps: {extreme:?} against {hard:?}");
        // Someone by the wall, the Goliath coming along it: Hard makes straight
        // for them, along the wall; Extreme goes round them, on the open side.
        let inner = |level: u8| {
            let mut m = Match::new(ring());
            m.join(1, 0);
            m.set_level(1, level);
            m.set_mode(1, mode::GOLIATH, 1);
            assert!(m.start(1, false, 0));
            let mut r = rng(4);
            let mut now = 0;
            while m.status != FIGHTING {
                now += 100;
                m.step(now, 100, &mut r);
            }
            for f in m.fighters.iter_mut() {
                f.bot = f.giant;
                if !f.giant && f.id != 1 {
                    f.down = true;
                }
                if f.giant {
                    f.x = 18.6;
                    f.y = 3.0;
                    f.stamina = 0.0;
                } else if f.id == 1 {
                    f.x = 18.6;
                    f.y = 9.5;
                }
            }
            for _ in 0..12 {
                now += 100;
                m.step(now, 100, &mut r);
            }
            let g = m.fighters.iter().find(|f| f.giant).unwrap();
            18.6 - g.x
        };
        let (h, e) = (inner(crate::level::HARD), inner(crate::level::EXTREME));
        assert!(e > h + 0.5, "off the wall: extreme {e}, hard {h}");
    }

    #[test]
    fn only_a_bot_goliath_on_extreme_is_built_tougher() {
        let taken = |level: u8, bot: bool| {
            let mut m = goliath_match(0);
            m.level = level;
            let now = m.round_at + 100;
            at(&mut m, 0, 10.0, 6.5);
            at(&mut m, 1, 8.5, 6.5);
            m.fighters[0].bot = bot;
            let hp = m.fighters[0].hp;
            m.strike(1, 0, (8.5, 6.5), 30.0, 0.0, 2, 0, now, &mut vec![]);
            hp - m.fighters[0].hp
        };
        let full = taken(crate::level::HARD, true);
        assert_eq!(taken(crate::level::EXTREME, false), full);
        assert!((taken(crate::level::EXTREME, true) - full * EXTREME_GIANT_TAKEN).abs() < 1e-6);
    }

    /// A classic match under way, four people (no bots) stood clear of each
    /// other, and when its round began.
    fn disaster_match() -> (Match, u32) {
        let (mut m, now) = goliath_free();
        for (k, f) in m.fighters.iter_mut().enumerate() {
            f.x = 6.0 + k as f64 * 2.5;
            f.y = 6.5;
            f.vx = 0.0;
            f.vy = 0.0;
        }
        (m, now)
    }

    fn goliath_free() -> (Match, u32) {
        let mut m = Match::new(ring());
        for id in 1..=4 {
            m.join(id, 0);
        }
        assert!(m.set_disasters(1, true));
        assert!(m.start(1, false, 0));
        let mut now = 0;
        let mut r = rng(1);
        while m.status != FIGHTING {
            now += 100;
            m.step(now, 100, &mut r);
        }
        (m, now)
    }

    /// Steps on to `to`, keeping everyone topped up and the events.
    fn run_to(m: &mut Match, from: u32, to: u32, seed: u64) -> (Vec<Event>, u32) {
        let mut r = rng(seed);
        let mut evs = Vec::new();
        let mut t = from;
        while t < to {
            t += 100;
            evs.extend(m.step(t, 100, &mut r));
        }
        (evs, t)
    }

    #[test]
    fn a_disaster_strikes_at_20_seconds_and_the_fire_still_comes_at_50() {
        let (mut m, now) = disaster_match();
        assert_eq!(m.disaster_stage, disaster::VOTING);
        let (evs, t) = run_to(&mut m, now, now + DISASTER_AT_MS - 100, 3);
        assert!(!evs.iter().any(|e| e.kind == ev::DISASTER));
        assert_ne!(m.disaster_kind, disaster::NONE, "settled before it strikes");
        let (evs, t) = run_to(&mut m, t, t + 200, 3);
        assert!(evs.iter().any(|e| e.kind == ev::DISASTER));
        assert_eq!(m.disaster_stage, disaster::ON);
        assert_eq!(m.fire(t), 1.15, "no fire yet");
        assert_eq!(FIRE_AFTER_MS, 50_000);
    }

    #[test]
    fn spectators_vote_and_the_fallen_can_too_but_not_those_still_fighting() {
        let (mut m, _) = disaster_match();
        assert!(!m.vote(2, disaster::LIONS), "still fighting");
        assert!(m.vote(50, disaster::LIONS));
        assert!(m.vote(51, disaster::METEORS));
        assert!(m.vote(50, disaster::METEORS), "changed their mind");
        assert_eq!(m.disaster_tally(), [0, 2, 0, 0, 0]);
        assert!(!m.vote(52, 9), "no such disaster");
        m.fighters[1].down = true;
        assert!(m.vote(m.fighters[1].id, disaster::METEORS));
        assert_eq!(m.disaster_tally(), [0, 3, 0, 0, 0]);
        // A clear winner: the wheel still turns, and stops on it.
        let t = m.disaster_end;
        run_to(&mut m, t - 100, t + 100, 4);
        assert_eq!(m.disaster_kind, disaster::METEORS);
        assert_eq!(m.disaster_stage, disaster::SPIN);
        assert_eq!(m.disaster_pool, 1 << disaster::METEORS);
        assert!(!m.vote(53, disaster::LAVA), "closed");
        let t = m.disaster_end;
        let (evs, _) = run_to(&mut m, t - 100, t + 100, 4);
        assert_eq!(m.disaster_stage, disaster::DECIDED);
        assert!(evs.iter().any(|e| e.kind == ev::DISASTER_PICKED));
    }

    #[test]
    fn a_draw_or_no_votes_spins_the_wheel_between_those_level() {
        // Two level: just those two on it, and it lands on one.
        for seed in 0..12 {
            let (mut m, _) = disaster_match();
            m.vote(50, disaster::LAVA);
            m.vote(51, disaster::LIONS);
            let t = m.disaster_end;
            run_to(&mut m, t - 100, t + 100, seed);
            assert_eq!(m.disaster_stage, disaster::SPIN);
            assert_eq!(m.disaster_pool, 1 << disaster::LAVA | 1 << disaster::LIONS);
            assert_ne!(m.disaster_kind, disaster::METEORS);
        }
        // Nobody: all three, every one of them coming up.
        let mut seen = [false; 6];
        for seed in 0..60 {
            let (mut m, _) = disaster_match();
            let t = m.disaster_end;
            run_to(&mut m, t - 100, t + 100, seed);
            assert_eq!(m.disaster_stage, disaster::SPIN);
            assert_eq!(m.disaster_pool.count_ones(), disaster::COUNT as u32);
            seen[m.disaster_kind as usize] = true;
        }
        assert!(seen[1..].iter().all(|s| *s), "{seen:?}");
        // And it's done spinning before it strikes.
        assert!(VOTE_UNTIL_MS + DISASTER_SPIN_MS < DISASTER_AT_MS);
    }

    /// Set to strike `kind`, right at `DISASTER_AT_MS`.
    fn fixed_disaster(kind: u8) -> (Match, u32) {
        let (mut m, now) = disaster_match();
        for id in 50..53 {
            m.vote(id, kind);
        }
        let t = now + DISASTER_AT_MS;
        let (_, t) = run_to(&mut m, now, t + 100, 6);
        assert_eq!(m.disaster_stage, disaster::ON);
        (m, t)
    }

    #[test]
    fn lava_flows_in_a_touch_slower_than_fire_and_all_but_kills_at_once() {
        assert!(LAVA_CLOSE_MS > FIRE_CLOSE_MS && LAVA_CLOSE_MS < FIRE_CLOSE_MS * 13 / 10);
        let (mut m, t) = fixed_disaster(disaster::LAVA);
        assert!(m.lava(t) < 1.15);
        // Out at the edge when it gets there: no time at all.
        let id = m.fighters[0].id;
        let (x, y) = (1.0, 6.5);
        m.fighters[0].x = x;
        m.fighters[0].y = y;
        let late = t + LAVA_CLOSE_MS / 2;
        assert!(m.ring.reach(x, y) > m.lava(late));
        let mut r = rng(2);
        m.fighters[0].x = 10.0;
        m.fighters[0].y = 6.5;
        let (_, t2) = run_to(&mut m, t, late, 2);
        m.fighters[0].x = x;
        m.fighters[0].y = y;
        let hp = m.fighter(id).unwrap().hp;
        m.step(t2 + 100, 100, &mut r);
        assert!(
            hp - m.fighter(id).unwrap().hp >= LAVA_DPS * 0.09,
            "a tenth of a second"
        );
        let mut t3 = t2 + 100;
        for _ in 0..12 {
            t3 += 100;
            m.step(t3, 100, &mut r);
        }
        assert!(
            m.fighter(id).unwrap().down,
            "gone inside a second and a bit"
        );
        // The fire's no faster for it: nothing's changed there.
        assert!(FIRE_DPS * 5.0 < LAVA_DPS);
    }

    #[test]
    fn meteors_are_marked_before_they_land_for_a_few_seconds_and_can_be_dodged() {
        let (mut m, t) = fixed_disaster(disaster::METEORS);
        // (Nobody's beaten: the round runs its length.)
        let mut r = rng(7);
        let (mut evs, mut end) = (vec![], t);
        while end < t + METEOR_RAIN_MS + METEOR_WARN_MS + 400 {
            end += 100;
            for f in m.fighters.iter_mut() {
                f.hp = f.max_hp;
            }
            evs.extend(m.step(end, 100, &mut r));
        }
        let warned = evs.iter().filter(|e| e.kind == ev::METEOR_WARN).count();
        let landed = evs.iter().filter(|e| e.kind == ev::METEOR).count();
        assert!(warned >= 100, "{warned}");
        assert!(landed >= warned.saturating_sub(1), "{landed} of {warned}");
        // Done with: no more after the shower.
        let (evs, _) = run_to(&mut m, end, end + 3000, 7);
        assert!(!evs.iter().any(|e| e.kind == ev::METEOR_WARN));
        // One on someone's mark hurts; a step off it doesn't.
        let (mut m, t) = fixed_disaster(disaster::METEORS);
        m.meteors_end = 0;
        m.meteors.clear();
        let (hit, clear) = (0, 3);
        let (hx, hy) = (m.fighters[hit].x, m.fighters[hit].y);
        let cid = m.fighters[clear].id;
        let chp = m.fighters[clear].hp;
        m.fighters[clear].x = hx + METEOR_R + 2.0;
        m.meteors.push(Meteor {
            x: hx,
            y: hy,
            at: t + 100,
        });
        let hp = m.fighters[hit].hp;
        let (evs, _) = run_to(&mut m, t, t + 200, 8);
        assert!(evs.iter().any(|e| e.kind == ev::METEOR));
        assert!(m.fighters[hit].hp <= hp - METEOR_DMG + 0.01);
        assert_eq!(m.fighter(cid).unwrap().hp, chp);
    }

    #[test]
    fn the_disasters_can_be_turned_off_in_the_lobby() {
        let mut m = Match::new(ring());
        assert!(!m.disasters, "off to begin with");
        for id in 1..=4 {
            m.join(id, 0);
        }
        assert!(!m.set_disasters(9, true), "only those in");
        assert!(m.set_disasters(1, true));
        assert!(!m.set_disasters(1, true), "no change");
        assert!(m.set_disasters(1, false));
        assert!(m.start(1, false, 0));
        assert!(!m.set_disasters(1, true), "not mid-match");
        let mut r = rng(14);
        let mut now = 0;
        while m.status != FIGHTING {
            now += 100;
            m.step(now, 100, &mut r);
        }
        let from = now;
        assert!(!m.vote(50, disaster::LIONS), "nothing to vote on");
        for f in m.fighters.iter_mut() {
            f.y = 6.5;
        }
        let (evs, t) = run_to(&mut m, from, from + DISASTER_AT_MS + 1000, 14);
        assert!(
            !evs.iter()
                .any(|e| matches!(e.kind, ev::DISASTER | ev::DISASTER_PICKED))
        );
        assert_eq!(m.disaster_shown(), disaster::NONE);
        // (Thieves are nothing to do with Caesar.)
        assert!(m.lions.iter().all(|l| l.thief) && m.meteors.is_empty() && m.lava(t) >= 1.15);
    }

    #[test]
    fn meteors_swell_to_a_storm_all_over_the_sand_and_die_away() {
        let mut r0 = ring();
        r0.w = 28.0;
        r0.h = 18.0;
        r0.oval = true;
        r0.pillars.clear();
        r0.spikes.clear();
        let mut m = Match::new(r0);
        for id in 1..=4 {
            m.join(id, 0);
        }
        m.set_disasters(1, true);
        assert!(m.start(1, false, 0));
        let mut r = rng(15);
        let mut now = 0;
        while m.status != FIGHTING {
            now += 100;
            m.step(now, 100, &mut r);
        }
        let from = now;
        for id in 50..53 {
            m.vote(id, disaster::METEORS);
        }
        let (mut quads, mut count, mut last) = ([0u32; 4], 0, 0);
        let mut when = vec![];
        let mut t = from;
        while t < from + DISASTER_AT_MS + METEOR_RAIN_MS + 3000 {
            t += 100;
            for f in m.fighters.iter_mut() {
                // (All huddled in the middle, out of it.)
                f.x = 14.0;
                f.y = 9.0;
                f.hp = f.max_hp;
                f.down = false;
            }
            for e in m.step(t, 100, &mut r) {
                if e.kind == ev::METEOR_WARN {
                    count += 1;
                    last = t;
                    when.push(t);
                    quads[(e.x > 14.0) as usize + 2 * (e.y > 9.0) as usize] += 1;
                }
            }
        }
        assert!(count >= 150, "{count}");
        assert!(last >= from + DISASTER_AT_MS + METEOR_RAIN_MS - 1500);
        assert!(quads.iter().all(|&n| n >= count / 8), "{quads:?}");
        // A few, a storm, a few.
        let start = from + DISASTER_AT_MS;
        let in_span = |a: u32, b: u32| {
            when.iter()
                .filter(|&&w| w >= start + a && w < start + b)
                .count()
        };
        let third = METEOR_RAIN_MS / 6;
        let (first, height, end) = (
            in_span(0, third),
            in_span(third * 3 - third / 2, third * 3 + third / 2),
            in_span(METEOR_RAIN_MS - third, METEOR_RAIN_MS),
        );
        assert!(
            first * 3 < height && end * 3 < height,
            "{first} {height} {end}"
        );
        assert!(first >= 3 && end >= 3, "still a few: {first} {end}");
    }

    #[test]
    fn a_lion_for_everyone_standing_each_going_for_their_own() {
        let (mut m, now) = disaster_match();
        m.fighters[3].down = true;
        for id in 50..53 {
            m.vote(id, disaster::LIONS);
        }
        let (evs, _) = run_to(&mut m, now, now + DISASTER_AT_MS + 100, 9);
        assert_eq!(m.lions.len(), 3, "one each, for the three still up");
        assert_eq!(evs.iter().filter(|e| e.kind == ev::LION_OUT).count(), 3);
        let mut prey: Vec<u32> = m.lions.iter().map(|l| l.target).collect();
        prey.sort_unstable();
        prey.dedup();
        assert_eq!(prey.len(), 3, "a different one each");
        assert!(m.lions.iter().all(|l| l.hp == LION_HP));
    }

    /// One lion crouched, about to pounce on place 0, the others out of it.
    fn lion_at_someone() -> (Match, u32, u32) {
        let (mut m, t) = fixed_disaster(disaster::LIONS);
        m.lions.truncate(1);
        let id = m.fighters[0].id;
        // (Clear of the pillars, and of the spikes when they dodge.)
        m.fighters[0].x = 10.0;
        m.fighters[0].y = 5.2;
        // (The others well out of its path: it hits whoever it meets.)
        for f in m.fighters.iter_mut().skip(1) {
            f.y = 9.5;
        }
        m.lions[0].target = id;
        m.lions[0].x = m.fighters[0].x - 2.5;
        m.lions[0].y = m.fighters[0].y;
        m.lions[0].act = lion::PROWL;
        m.lions[0].act_until = u32::MAX;
        m.gifts.clear();
        (m, t, id)
    }

    #[test]
    fn a_lion_shows_its_spring_then_lands_on_you_unless_you_get_clear() {
        let (mut m, t, id) = lion_at_someone();
        let hp = m.fighter(id).unwrap().hp;
        let (evs, t2) = run_to(&mut m, t, t + 200, 10);
        assert!(evs.iter().any(|e| e.kind == ev::LION_CROUCH));
        assert_eq!(m.fighter(id).unwrap().hp, hp, "a tell first");
        let (evs, _) = run_to(&mut m, t2, t2 + LION_CROUCH_MS + LION_LEAP_MS + 300, 10);
        assert!(evs.iter().any(|e| e.kind == ev::LION_LAND));
        let took = hp - m.fighter(id).unwrap().hp;
        assert!(took > LION_DMG * 0.9 && took < HP / 4.0, "{took}");
        // Stepping clear in the crouch's time: it misses.
        let (mut m, t, id) = lion_at_someone();
        // (Off the moment it's settled on its spring: walking pace does it.)
        let (_, t2) = run_to(&mut m, t, t + 200 + LION_CROUCH_MS - LION_LOCK_MS, 10);
        let hp = m.fighter(id).unwrap().hp;
        let walked = SPEED * (LION_LOCK_MS + LION_LEAP_MS) as f64 / 1000.0;
        assert!(walked > LION_BITE_R * 0.8, "{walked}");
        // (Up the screen: a body stands above its feet, so that way it has to go furthest.)
        m.fighters[0].y -= LION_BITE_R + BODY_R + 0.2;
        let (_, _) = run_to(&mut m, t2, t2 + LION_LOCK_MS + LION_LEAP_MS + 300, 10);
        assert_eq!(m.fighter(id).unwrap().hp, hp, "nothing but air");
    }

    #[test]
    fn a_lions_hit_knocks_you_out_of_your_attack() {
        for start in [input::LIGHT, input::HEAVY_START] {
            let (mut m, t, id) = lion_at_someone();
            m.lions.clear();
            let foe = m.fighters[1].id;
            let (x, y) = (m.fighters[0].x, m.fighters[0].y);
            m.fighters[1].x = x + 1.0;
            m.fighters[1].y = y;
            let hp = m.fighter(foe).unwrap().hp;
            m.input(id, start, 0.0, t);
            assert_ne!(m.fighter(id).unwrap().act, act::NONE);
            // And another press to follow it.
            m.input(id, input::LIGHT, 0.0, t);
            let mut evs = Vec::new();
            m.hazard(
                0,
                (x - 1.0, y),
                LION_DMG,
                LION_KB,
                LION_STUN_MS,
                true,
                t + 20,
                &mut evs,
            );
            let f = m.fighter(id).unwrap();
            assert_eq!(f.act, act::STUN);
            assert_eq!(f.pending.0, 0, "nothing left to follow it");
            assert!(!f.queued);
            // Their blow never lands, and nothing comes out after the stun.
            let (_, t2) = run_to(&mut m, t + 20, t + 20 + LION_STUN_MS + 300, 16);
            assert_eq!(m.fighter(foe).unwrap().hp, hp);
            assert_eq!(m.fighter(id).unwrap().act, act::NONE, "at {t2}");
        }
        // A guard held in time takes it: no stagger.
        let (mut m, t, id) = lion_at_someone();
        let (x, y) = (m.fighters[0].x, m.fighters[0].y);
        m.fighters[0].act = act::BLOCK;
        m.fighters[0].aim = PI;
        m.hazard(
            0,
            (x - 1.0, y),
            LION_DMG,
            LION_KB,
            LION_STUN_MS,
            true,
            t,
            &mut Vec::new(),
        );
        assert_eq!(m.fighter(id).unwrap().act, act::BLOCK);
    }

    #[test]
    fn a_lion_can_be_killed_by_a_blade_an_arrow_or_a_blast() {
        // A blade: its health takes a few honest blows.
        let (mut m, t, _) = lion_at_someone();
        let mut evs = Vec::new();
        m.fighters[0].aim = PI;
        m.lions[0].x = m.fighters[0].x - 1.0;
        m.lions[0].act = lion::RECOVER;
        m.lions[0].act_until = u32::MAX;
        // (A tough one, to see each of them tell.)
        m.lions[0].hp = 60.0;
        m.cleave(0, 1.35, 1.0, 16.0, 2.5, 0, 200, t, &mut evs);
        assert_eq!(m.lions[0].hp, 60.0 - 16.0);
        assert!(evs.iter().any(|e| e.kind == ev::LION_HIT));
        // (Once a swing.)
        m.cleave(0, 1.35, 1.0, 16.0, 2.5, 0, 200, t, &mut evs);
        assert_eq!(m.lions[0].hp, 60.0 - 16.0);
        // A blast.
        m.blast_lions(None, m.lions[0].x, m.lions[0].y, 2.0, 30.0, t, &mut evs);
        assert_eq!(m.lions[0].hp, 60.0 - 46.0);
        m.lions[0].hp = 14.0;
        // An arrow.
        let (lx, ly) = (m.lions[0].x, m.lions[0].y);
        let mut arrow = Missile::new(m.fighters[1].id, missile::ARROW, lx - 2.0, ly, 0.0);
        arrow.dmg = 20.0;
        m.missiles.push(arrow);
        let (evs, _) = run_to(&mut m, t, t + 400, 11);
        assert!(evs.iter().any(|e| e.kind == ev::LION_DOWN), "dead");
        assert_eq!(m.lions[0].act, lion::DEAD);
        // And it's gone in the end.
        let (_, _) = run_to(&mut m, t + 400, t + 400 + LION_GONE_MS + 200, 11);
        assert!(m.lions.is_empty());
    }

    #[test]
    fn after_its_first_pounce_a_lion_turns_on_whoever_is_nearest() {
        let (mut m, t, id) = lion_at_someone();
        // Someone else right by it, from the start: it still goes for its own…
        let other = m.fighters[1].id;
        m.fighters[1].x = m.lions[0].x + 0.5;
        m.fighters[1].y = m.lions[0].y + 1.5;
        m.fighters[0].x = m.lions[0].x + 6.0;
        let (_, t2) = run_to(&mut m, t, t + 150, 12);
        assert_eq!(m.lions[0].target, id, "the one it came for");
        // …till it's pounced once.
        m.lions[0].pounced = true;
        m.lions[0].act = lion::PROWL;
        let (_, _) = run_to(&mut m, t2, t2 + 150, 12);
        assert_eq!(m.lions[0].target, other);
    }

    #[test]
    fn the_scorpion_comes_up_with_the_wheel_and_clears_it_first() {
        let (mut m, now) = disaster_match();
        for id in 50..53 {
            m.vote(id, disaster::SCORPION);
        }
        let (cx, cy) = (m.ring.w / 2.0, m.ring.h / 2.0);
        // Someone standing on the wheel.
        let (evs, t) = run_to(&mut m, now, now + DISASTER_AT_MS - 100, 20);
        assert!(!evs.iter().any(|e| e.kind == ev::DISASTER));
        m.fighters[0].x = cx + 0.5;
        m.fighters[0].y = cy;
        let id = m.fighters[0].id;
        let (evs, t) = run_to(&mut m, t, t + 400, 20);
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::DISASTER && e.n == disaster::SCORPION as u16)
        );
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::HIT && e.b == id && e.m & SHOVE_BIT != 0)
        );
        let l = &m.lions[0];
        assert!(l.scorpion && l.hp == SCORPION_HP && (l.x, l.y) == (cx, cy));
        assert_eq!(
            m.fighter(id).unwrap().hp,
            m.fighter(id).unwrap().max_hp,
            "a shove, no harm"
        );
        // Pushed clear of the rim, and nothing touches it till it's up.
        let (_, t) = run_to(&mut m, t, t + 900, 20);
        let f = m.fighter(id).unwrap();
        assert!(
            (f.x - cx).hypot(f.y - cy) > PIT_R - 0.2,
            "at {} {}",
            f.x,
            f.y
        );
        m.blast_lions(None, cx, cy, 3.0, 50.0, t, &mut vec![]);
        assert_eq!(m.lions[0].hp, SCORPION_HP, "out of reach in its shaft");
        // Then it's up, and hurt like anything else.
        let (_, t) = run_to(
            &mut m,
            t,
            now + DISASTER_AT_MS + SCORPION_EMERGE_MS + 200,
            20,
        );
        assert_ne!(m.lions[0].act, lion::EMERGE);
        m.blast_lions(None, m.lions[0].x, m.lions[0].y, 3.0, 50.0, t, &mut vec![]);
        assert!(m.lions[0].hp < SCORPION_HP);
    }

    /// The scorpion up and hunting, at (x, y), everyone clear of it.
    fn scorpion_at(x: f64, y: f64) -> (Match, u32) {
        let (mut m, t) = fixed_disaster(disaster::SCORPION);
        // (The rest far off, still in it: the round plays on.)
        for f in m.fighters.iter_mut() {
            f.x = 19.5;
            f.y = 2.0;
        }
        let l = &mut m.lions[0];
        l.x = x;
        l.y = y;
        l.act = lion::PROWL;
        l.act_until = u32::MAX;
        l.next_dart = t;
        m.gifts.clear();
        (m, t)
    }

    #[test]
    fn the_scorpions_sting_poisons_slows_and_wears_off() {
        let (mut m, t) = scorpion_at(9.0, 4.5);
        m.fighters[0].x = 10.8;
        m.fighters[0].y = 4.5;
        let id = m.fighters[0].id;
        let hp = m.fighters[0].hp;
        let (evs, t2) = run_to(&mut m, t, t + 200, 21);
        assert!(
            evs.iter().any(|e| e.kind == ev::SCORPION_WIND),
            "a tell first"
        );
        assert_eq!(m.fighter(id).unwrap().hp, hp);
        let mut tt = t2;
        let mut hit = false;
        let mut r = rng(21);
        while tt < t2 + 1500 && !hit {
            tt += 100;
            m.fighters[0].x = 10.8;
            hit = m
                .step(tt, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::POISONED);
        }
        assert!(hit, "stung");
        let f = m.fighter(id).unwrap();
        assert!(hp - f.hp >= LION_DMG, "{}", hp - f.hp);
        assert!(f.buffs(tt) & buff::POISON != 0);
        assert!((f.speed_x(tt) - POISON_SLOW).abs() < 1e-9);
        // It keeps on burning, a little, then stops.
        let was = f.hp;
        m.lions.clear();
        let (_, t3) = run_to(&mut m, tt, tt + POISON_MS + 200, 21);
        let f = m.fighter(id).unwrap();
        let took = was - f.hp;
        assert!(took > 5.0 && took < 10.0, "{took}");
        assert_eq!(f.speed_x(t3), 1.0);
        assert_eq!(f.buffs(t3) & buff::POISON, 0);
    }

    #[test]
    fn the_scorpion_spits_at_the_far_off_and_a_guard_stops_it_dead() {
        for (block, aim) in [(false, 0.0), (true, PI)] {
            let (mut m, t) = scorpion_at(2.5, 11.5);
            let id = m.fighters[0].id;
            let (x, y) = (2.5 + DART_FROM + 3.0, 11.5);
            m.fighters[0].x = x;
            m.fighters[0].y = y;
            m.fighters[0].aim = aim;
            if block {
                m.fighters[0].act = act::BLOCK;
                m.fighters[0].act_until = u32::MAX;
            }
            let hp = m.fighters[0].hp;
            let mut r = rng(22);
            let mut tt = t;
            let mut evs = Vec::new();
            for _ in 0..30 {
                tt += 100;
                m.fighters[0].x = x;
                evs.extend(m.step(tt, 100, &mut r));
                if evs.iter().any(|e| e.kind == ev::DART_HIT) {
                    break;
                }
            }
            let hit = evs
                .iter()
                .find(|e| e.kind == ev::DART_HIT)
                .expect("it spat");
            let f = m.fighter(id).unwrap();
            if block {
                assert_eq!(hit.n, 1);
                assert_eq!(f.hp, hp, "not a scratch");
                assert_eq!(f.buffs(tt) & buff::POISON, 0);
            } else {
                assert_eq!(hit.n, 0);
                assert!(f.hp < hp);
                assert!(f.buffs(tt) & buff::POISON != 0);
            }
        }
        // Up close, no darts.
        let (mut m, t) = scorpion_at(7.0, 8.5);
        m.fighters[0].x = 11.0;
        m.fighters[0].y = 8.5;
        let (evs, _) = run_to(&mut m, t, t + 300, 22);
        assert!(!evs.iter().any(|e| e.kind == ev::SCORPION_WIND && e.n == 1));
    }

    #[test]
    fn the_scorpion_goes_for_whoever_is_nearest() {
        let (m, _) = fixed_disaster(disaster::SCORPION);
        let nearest = m
            .fighters
            .iter()
            .min_by(|a, b| {
                let d = |f: &Fighter| (f.x - m.ring.w / 2.0).hypot(f.y - m.ring.h / 2.0);
                d(a).total_cmp(&d(b))
            })
            .unwrap()
            .id;
        assert_eq!(m.lions[0].target, nearest);
        let (mut m, t) = scorpion_at(7.0, 8.5);
        for f in m.fighters.iter_mut() {
            f.down = false;
            f.x = 18.0;
            f.y = 11.0;
        }
        m.fighters[2].x = 8.0;
        m.fighters[2].y = 11.5;
        let near = m.fighters[2].id;
        run_to(&mut m, t, t + 100, 23);
        assert_eq!(m.lions[0].target, near);
    }

    #[test]
    fn acid_burns_only_under_a_cloud_and_they_cross_and_are_gone() {
        let (mut m, t) = fixed_disaster(disaster::ACID);
        assert_eq!(m.clouds.len(), ACID_WAVES.iter().sum::<usize>());
        let (cloud_y, cloud) = (m.clouds[0].y, m.clouds[0]);
        // One stood right in a cloud's way, one standing off where nothing's passing.
        let (a, b) = (m.fighters[0].id, m.fighters[1].id);
        let (a0, b0) = (m.fighter(a).unwrap().hp, m.fighter(b).unwrap().hp);
        // (Only that cloud: the others would cross where the second one's stood.)
        m.clouds.truncate(1);
        let mut r = rng(24);
        let mut tt = t;
        let mut burnt = false;
        while tt < t + 26_000 {
            tt += 100;
            m.fighters[0].x = 10.0;
            m.fighters[0].y = cloud_y;
            m.fighters[1].x = 10.0;
            m.fighters[1].y = cloud_y + ACID_RY + 0.4;
            for f in m.fighters.iter_mut().skip(2) {
                f.x = 18.0;
                f.y = 2.0;
            }
            m.gifts.clear();
            let evs = m.step(tt, 100, &mut r);
            burnt |= evs.iter().any(|e| e.kind == ev::ACID_BURN && e.b == a);
            assert!(
                !evs.iter().any(|e| e.kind == ev::ACID_BURN && e.b == b),
                "beside its path"
            );
            if m.status != FIGHTING {
                break;
            }
        }
        assert!(burnt);
        assert!(m.fighter(a).unwrap().hp < a0);
        assert_eq!(m.fighter(b).unwrap().hp, b0);
        assert!(m.clouds.is_empty() || m.status != FIGHTING, "all across");
        assert!(
            cloud.x(cloud.delay + 24_000).abs() > m.ring.w,
            "{}",
            cloud.x(cloud.delay + 24_000)
        );
    }

    #[test]
    fn acid_comes_in_waves_this_way_and_that_with_a_way_through_each() {
        let (mut m, t) = fixed_disaster(disaster::ACID);
        let overhead = |m: &Match, at: u32| {
            m.clouds
                .iter()
                .filter(|c| c.delay <= at && (0.0..=m.ring.w).contains(&c.x(at)))
                .count()
        };
        // It swells, and it fades.
        let early = overhead(&m, t + 5000);
        let height = overhead(&m, t + 20_000);
        let late = overhead(&m, t + 43_000);
        assert!(
            height > early * 2 && height > late * 2,
            "{early} {height} {late}"
        );
        assert!(height >= 10, "a sky full: {height}");
        // This way, that way, and never a wall of them.
        let mut waves = vec![vec![]; ACID_WAVES.len()];
        let first = m.clouds.iter().map(|c| c.delay).min().unwrap();
        for c in &m.clouds {
            let w = (c.delay - first) / ACID_WAVE_GAP_MS;
            waves[w as usize].push(*c);
        }
        for (w, cs) in waves.iter().enumerate() {
            assert_eq!(cs.len(), ACID_WAVES[w], "wave {w}");
            assert!(cs.len() < ACID_LANES, "wave {w}");
            assert!(cs.iter().all(|c| c.dir == cs[0].dir));
            if w > 0 {
                assert_eq!(cs[0].dir, -waves[w - 1][0].dir);
            }
        }
        // And it does let up.
        let mut r = rng(61);
        let end = t + ACID_WAVE_GAP_MS * ACID_WAVES.len() as u32 + ACID_JITTER_MS + 26_000;
        let mut tt = t;
        while tt < end && !m.clouds.is_empty() {
            tt += 100;
            for f in m.fighters.iter_mut() {
                f.hp = f.max_hp;
                f.down = false;
            }
            m.gifts.clear();
            m.step(tt, 100, &mut r);
        }
        assert!(m.clouds.is_empty());
    }

    #[test]
    fn the_scorpion_rushes_and_stings_twice_before_it_rests() {
        let (mut m, t) = scorpion_at(4.0, 11.5);
        m.lions[0].next_rush = t;
        m.lions[0].next_dart = u32::MAX;
        m.fighters[0].x = 12.5;
        m.fighters[0].y = 11.5;
        let x0 = m.lions[0].x;
        let mut r = rng(62);
        let mut tt = t;
        let mut rushed = false;
        for _ in 0..8 {
            tt += 100;
            m.fighters[0].x = 12.5;
            let evs = m.step(tt, 100, &mut r);
            rushed |= evs.iter().any(|e| e.kind == ev::SCORPION_WIND && e.n == 2);
        }
        assert!(rushed);
        let gone = m.lions[0].x - x0;
        assert!(gone > 4.0, "faster than it walks: {gone}");
        // Two, close together; then a breath.
        let (mut m, t) = scorpion_at(9.0, 4.5);
        let mut r = rng(63);
        let mut stings = vec![];
        for k in 1..40 {
            let tt = t + k * 100;
            m.fighters[0].x = 10.8;
            m.fighters[0].y = 4.5;
            m.fighters[0].hp = m.fighters[0].max_hp;
            for e in m.step(tt, 100, &mut r) {
                if e.kind == ev::SCORPION_STING {
                    stings.push(tt);
                }
            }
        }
        assert!(stings.len() >= 3, "{stings:?}");
        let (a, b) = (stings[1] - stings[0], stings[2] - stings[1]);
        assert!(a < b, "{stings:?}");
    }

    /// A gift left lying far from everyone, ready for a thief; and everyone off to one side.
    fn stale_gift() -> (Match, u32) {
        let (mut m, t) = disaster_match();
        m.set_disasters(1, false);
        for f in m.fighters.iter_mut() {
            f.x = 2.0;
            f.y = 2.0;
        }
        m.gifts.clear();
        m.next_gift = u32::MAX;
        m.gifts.push(Gift {
            kind: gift::HEALTH,
            x: 12.0,
            y: 12.0,
            lands: t,
            gone: u32::MAX,
            stale: t,
        });
        (m, t)
    }

    /// Runs on, keeping everyone where they are.
    fn hold_still(m: &mut Match, from: u32, to: u32, seed: u64) -> (Vec<Event>, u32) {
        let places: Vec<(f64, f64)> = m.fighters.iter().map(|f| (f.x, f.y)).collect();
        let mut r = rng(seed);
        let mut t = from;
        let mut evs = vec![];
        while t < to {
            t += 100;
            for (f, p) in m.fighters.iter_mut().zip(&places) {
                (f.x, f.y) = *p;
                f.hp = f.max_hp;
            }
            evs.extend(m.step(t, 100, &mut r));
        }
        (evs, t)
    }

    fn thief(m: &Match) -> &Lion {
        m.lions.iter().find(|l| l.thief).expect("a thief")
    }

    #[test]
    fn a_gift_left_too_long_is_stolen_and_dragged_about() {
        let (mut m, t) = stale_gift();
        let (evs, t) = hold_still(&mut m, t, t + 200, 70);
        assert!(evs.iter().any(|e| e.kind == ev::THIEF_OUT));
        let l = thief(&m);
        assert_eq!(l.act, lion::SNEAK);
        assert!(l.y < 12.0, "behind it");
        assert_eq!(m.gifts.len(), 1, "not yet");
        let (_, t) = hold_still(&mut m, t, t + THIEF_PEEK_MS + THIEF_ROUND_MS - 100, 70);
        assert!(thief(&m).y > 12.0, "round in front of it");
        let (evs, t) = hold_still(&mut m, t, t + THIEF_SNATCH_MS + 300, 70);
        let got = evs
            .iter()
            .find(|e| e.kind == ev::THIEF_GRAB)
            .expect("hooked it");
        assert_eq!(got.n, gift::HEALTH as u16);
        assert!(m.gifts.is_empty());
        assert_eq!(thief(&m).item, gift::HEALTH);
        // Off about the sand with it, wherever it pleases.
        let (x, y) = (thief(&m).x, thief(&m).y);
        let (_, t) = hold_still(&mut m, t, t + 8000, 70);
        let l = thief(&m);
        assert!((l.x - x).hypot(l.y - y) > 1.0, "still moving about");
        assert!(m.ring.on_sand(l.x, l.y, 0.0));
        let _ = t;
    }

    #[test]
    fn only_a_gift_left_alone_gets_stolen_and_only_so_many() {
        let (mut m, t) = stale_gift();
        m.fighters[0].x = 12.5;
        m.fighters[0].y = 12.5;
        let (evs, t) = hold_still(&mut m, t, t + 2000, 71);
        assert!(
            !evs.iter().any(|e| e.kind == ev::THIEF_OUT),
            "someone's right there"
        );
        m.fighters[0].x = 2.0;
        m.fighters[0].y = 2.0;
        for k in 0..5 {
            m.gifts.push(Gift {
                kind: gift::SPEED,
                x: 8.0 + k as f64 * 2.0,
                y: 5.0,
                lands: t,
                gone: u32::MAX,
                stale: t,
            });
        }
        hold_still(&mut m, t, t + 2500, 71);
        assert_eq!(m.lions.iter().filter(|l| l.thief).count(), THIEF_MAX);
    }

    #[test]
    fn tread_on_a_thief_and_it_stings_and_poisons_you() {
        let (mut m, t) = stale_gift();
        let (_, t) = hold_still(&mut m, t, t + 2800, 72);
        let (x, y) = (thief(&m).x, thief(&m).y);
        let id = m.fighters[0].id;
        m.fighters[0].x = x + 0.1;
        m.fighters[0].y = y;
        let hp = m.fighters[0].hp;
        let mut r = rng(72);
        let evs = m.step(t + 100, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::THIEF_STING && e.b == id));
        let f = m.fighter(id).unwrap();
        assert!((hp - f.hp - THIEF_DMG).abs() < 1.0, "{}", hp - f.hp);
        assert!(f.buffs(t + 100) & buff::POISON != 0);
        assert_eq!(f.poison_until, t + 100 + POISON_MS);
        assert!(
            m.lions.iter().any(|l| l.thief && l.act != lion::DEAD),
            "it's fine"
        );
        // Once, not every tick; a roll goes over it.
        let evs = m.step(t + 200, 100, &mut r);
        assert!(!evs.iter().any(|e| e.kind == ev::THIEF_STING));
    }

    #[test]
    fn anything_at_all_kills_a_thief_and_it_lets_go() {
        // A blade.
        let (mut m, t) = stale_gift();
        let (_, t) = hold_still(&mut m, t, t + 3000, 73);
        let (x, y) = (thief(&m).x, thief(&m).y);
        let id = m.fighters[0].id;
        m.lions.iter_mut().find(|l| l.thief).unwrap().next_dart = u32::MAX;
        m.fighters[0].x = x - 0.9;
        m.fighters[0].y = y;
        let mut r = rng(73);
        m.input(id, input::LIGHT, 0.0, t);
        let mut down = false;
        for k in 1..6 {
            down |= m
                .step(t + k * 100, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::LION_DOWN);
        }
        assert!(down, "one blow");
        let l = thief(&m);
        assert_eq!(l.act, lion::DEAD);
        assert_eq!(l.item, 0);
        assert_eq!(m.gifts.len(), 1, "it dropped it");
        assert!((m.gifts[0].x - l.x).abs() < 0.01);
        // There for the taking.
        let (gx, gy) = (m.gifts[0].x, m.gifts[0].y);
        m.fighters[0].x = gx;
        m.fighters[0].y = gy;
        m.fighters[0].hp = 10.0;
        let evs = m.step(t + 700, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::PICKUP), "taken");
        // A blast, however far out it's reached; a stray arrow of the storm.
        let (mut m, t) = stale_gift();
        let (_, t) = hold_still(&mut m, t, t + 3000, 74);
        let (x, y) = (thief(&m).x, thief(&m).y);
        m.blast_lions(None, x + 2.0, y, 2.2, 0.5, t, &mut vec![]);
        assert_eq!(thief(&m).act, lion::DEAD);
    }

    #[test]
    fn beaten_to_the_gift_a_thief_slinks_off_and_digs_in() {
        let (mut m, t) = stale_gift();
        let (_, t) = hold_still(&mut m, t, t + 600, 75);
        m.gifts.clear();
        let (_, t) = hold_still(&mut m, t, t + 300, 75);
        assert_eq!(thief(&m).item, 0);
        assert_ne!(thief(&m).act, lion::SNEAK);
        let (_, t) = hold_still(&mut m, t, t + THIEF_GIVE_UP_MS, 75);
        assert_eq!(thief(&m).act, lion::BURROW);
        hold_still(&mut m, t, t + THIEF_BURROW_MS + 300, 75);
        assert!(m.lions.is_empty());
    }

    #[test]
    fn a_thief_bolts_from_anyone_who_comes_near_but_can_be_caught() {
        let (mut m, t) = stale_gift();
        let (_, t) = hold_still(&mut m, t, t + 3000, 76);
        let (x, y) = (thief(&m).x, thief(&m).y);
        m.lions.iter_mut().find(|l| l.thief).unwrap().next_dart = u32::MAX;
        m.fighters[0].x = x - 2.0;
        m.fighters[0].y = y;
        let (_, _) = hold_still(&mut m, t, t + 300, 76);
        assert_eq!(thief(&m).act, lion::RUSH);
        assert!(THIEF_BOLT_SPEED < SPEED, "it can be run down");
        let (a, b) = (thief(&m).x - m.fighters[0].x, thief(&m).y - m.fighters[0].y);
        assert!(a.hypot(b) > 2.0, "further off");
    }

    /// Two against two, in the middle of the first round.
    fn teams() -> (Match, u32) {
        let mut m = Match::new(ring());
        m.join(1, 0);
        assert!(m.set_mode(1, mode::TEAMS, 0));
        assert!(m.start(1, true, 0));
        m.fighters.iter_mut().for_each(|f| f.bot = false);
        let mut r = rng(80);
        let mut now = 0;
        while m.status != FIGHTING {
            now += 100;
            m.step(now, 100, &mut r);
        }
        (m, now)
    }

    #[test]
    fn two_against_two_friends_cant_hurt_each_other_and_a_team_wins_together() {
        let (mut m, t) = teams();
        assert_eq!(
            m.fighters.iter().map(|f| f.team).collect::<Vec<_>>(),
            [0, 0, 1, 1]
        );
        // A side each, west and east.
        assert!(m.fighters[0].x < m.ring.w / 2.0 && m.fighters[3].x > m.ring.w / 2.0);
        // A friend's blade passes them by.
        let (a, b) = (m.fighters[0].id, m.fighters[1].id);
        m.fighters[1].x = m.fighters[0].x + 1.0;
        m.fighters[1].y = m.fighters[0].y;
        let hp = m.fighters[1].hp;
        m.fighters[0].aim = 0.0;
        m.input(a, input::LIGHT, 0.0, t);
        let mut r = rng(81);
        for k in 1..5 {
            m.step(t + k * 100, 100, &mut r);
            m.fighters[1].x = m.fighters[0].x + 1.0;
        }
        assert_eq!(m.fighter(b).unwrap().hp, hp, "not a scratch");
        // One down isn't the end; both are, and both winners are crowned.
        let t = t + 600;
        m.fighters[2].down = true;
        m.step(t + 100, 100, &mut r);
        assert_eq!(m.status, FIGHTING, "their friend's still up");
        m.fighters[0].down = true;
        m.fighters[3].down = true;
        m.step(t + 200, 100, &mut r);
        assert_eq!(m.status, ROUND_END);
        assert_eq!(m.crowns, [1, 1, 0, 0], "one lost, and it's still a win");
        assert_eq!(m.won_by(m.winner), Some(0));
    }

    #[test]
    fn two_against_two_needs_someone_on_each_side() {
        let mut m = Match::new(ring());
        m.join(1, 0);
        m.join(2, 0);
        m.set_mode(1, mode::TEAMS, 0);
        // (Both on the same side.)
        assert_eq!(m.slot_of(1), Some(0));
        assert_eq!(m.slot_of(2), Some(1));
        for s in 2..SLOTS {
            m.slots[s] = 0;
        }
        assert!(!m.start(1, false, 0));
        assert!(m.switch_place(2, 3), "across to the other side");
        assert_eq!(m.slot_of(2), Some(3));
        assert!(!m.switch_place(2, 0), "that place is taken");
        assert!(m.start(1, false, 0));
    }

    #[test]
    fn bots_on_a_team_go_for_the_other_team_and_play_it_out() {
        for seed in 0..6u64 {
            let mut m = Match::new(ring());
            m.join(1, 0);
            m.set_mode(1, mode::TEAMS, 0);
            assert!(m.start(1, true, 0));
            m.fighters.iter_mut().for_each(|f| f.bot = true);
            let team = |m: &Match, id: u32| m.fighter(id).map(|f| f.team);
            let mut r = rng(seed + 90);
            let mut now = 0;
            while m.status != OVER && now < 900_000 {
                now += 100;
                for e in m.step(now, 100, &mut r) {
                    if e.kind == ev::HIT && e.a != 0 && e.n > 0 {
                        assert_ne!(team(&m, e.a), team(&m, e.b), "a friend, hit");
                    }
                }
            }
            assert_eq!(m.status, OVER);
            let top = m.crowns.iter().copied().max().unwrap();
            assert_eq!(top, TO_WIN);
            let w = m.side_of(m.crowns.iter().position(|&c| c == top).unwrap());
            for s in 0..SLOTS {
                assert_eq!(m.crowns[s] == top, m.side_of(s) == w, "{:?}", m.crowns);
            }
        }
    }

    #[test]
    fn bets_are_taken_up_to_five_seconds_in_and_pay_by_how_long_the_odds() {
        let (m, t) = duel();
        assert!(m.bet_ms(t) <= BET_OPEN_MS);
        assert!(m.bet_ms(t + BET_OPEN_MS) == 0);
        // A free-for-all of four: on one of them.
        let mut m = Match::new(ring());
        m.join(1, 0);
        assert_eq!(m.bet_ms(0), 0, "nothing on yet");
        assert!(m.start(1, true, 0));
        assert_eq!(m.status, COUNTDOWN);
        assert!(m.bet_ms(0) > BET_OPEN_MS, "all the countdown");
        assert_eq!(m.bet_pay(), 36);
        assert!(m.bet_ok(3) && !m.bet_ok(4));
        // The teams', the Goliath's: a side.
        let (m, _) = teams();
        assert_eq!(m.bet_pay(), 18);
        assert!(m.bet_ok(1) && !m.bet_ok(2));
        let m = goliath_match(2);
        assert_eq!(m.bet_pay(), 18);
        let g = m.fighters.iter().find(|f| f.giant).unwrap();
        assert_eq!(m.won_by(g.id), Some(1));
        let n = m.fighters.iter().find(|f| !f.giant).unwrap();
        assert_eq!(m.won_by(n.id), Some(0));
        assert_eq!(m.won_by(0), None, "nobody left: bets back");
    }

    /// A Goliath match, with this disaster just struck.
    fn goliath_disaster(kind: u8) -> (Match, u32) {
        let mut m = goliath_match(0);
        m.disasters = true;
        let now = m.round_at;
        m.reset_disaster(now);
        for id in 50..53 {
            m.vote(id, kind);
        }
        let mut r = rng(95);
        let mut t = now;
        while m.disaster_stage != disaster::ON {
            t += 100;
            m.fighters.iter_mut().for_each(|f| f.hp = f.max_hp);
            m.step(t, 100, &mut r);
        }
        (m, t)
    }

    #[test]
    fn the_scorpion_goes_for_the_goliath_first_then_for_whoever_is_nearest() {
        let (mut m, t) = goliath_disaster(disaster::SCORPION);
        let gid = m.fighters.iter().find(|f| f.giant).unwrap().id;
        assert_eq!(m.lions[0].target, gid);
        assert!(m.lions[0].big, "after it");
        // Someone right beside it: it pays them no mind.
        let l = &mut m.lions[0];
        l.act = lion::PROWL;
        l.act_until = u32::MAX;
        (l.x, l.y) = (4.0, 11.5);
        l.next_rush = u32::MAX;
        let (giant, other) = (
            m.fighters.iter().position(|f| f.giant).unwrap(),
            m.fighters.iter().position(|f| !f.giant).unwrap(),
        );
        let oid = m.fighters[other].id;
        let mut r = rng(96);
        let mut tt = t;
        let hold = |m: &mut Match| {
            (m.fighters[other].x, m.fighters[other].y) = (m.lions[0].x + 2.0, m.lions[0].y);
            (m.fighters[giant].x, m.fighters[giant].y) = (m.lions[0].x + 8.0, m.lions[0].y);
            m.fighters.iter_mut().for_each(|f| f.hp = f.max_hp);
        };
        for _ in 0..10 {
            tt += 100;
            hold(&mut m);
            m.step(tt, 100, &mut r);
        }
        assert_eq!(m.lions[0].target, gid, "not distracted");
        assert_eq!(m.lions[0].act, lion::PROWL);
        // Stung: from now on, whoever's nearest.
        m.lions[0].big = false;
        for _ in 0..3 {
            tt += 100;
            hold(&mut m);
            m.step(tt, 100, &mut r);
        }
        assert_eq!(m.lions[0].target, oid);
    }

    #[test]
    fn the_goliaths_lion_is_bigger_tougher_and_bites_harder() {
        let (mut m, t) = goliath_disaster(disaster::LIONS);
        let gid = m.fighters.iter().find(|f| f.giant).unwrap().id;
        let l = m.lions.iter().find(|l| l.target == gid).unwrap();
        assert!(l.big && l.hp == BIG_LION_HP && l.r() > LION_R);
        assert_eq!(m.lions.iter().filter(|l| l.big).count(), 1, "only its own");
        assert!(m.lions.iter().filter(|l| !l.big).all(|l| l.hp == LION_HP));
        // Its bite.
        let k = m.lions.iter().position(|l| l.big).unwrap();
        let g = m.fighters.iter().position(|f| f.giant).unwrap();
        let (x, y) = (m.fighters[g].x + 0.3, m.fighters[g].y);
        let hp = m.fighters[g].hp;
        m.lion_land(k, x, y, t, &mut vec![]);
        let bite = hp - m.fighters[g].hp;
        assert!(
            (bite - LION_DMG * GIANT_LION_X * BIG_LION_X).abs() < 0.01,
            "{bite}"
        );
    }

    #[test]
    fn disasters_hurt_the_goliath_by_a_good_share_of_its_health() {
        // The lava: very fast, not instant.
        let (mut m, t) = goliath_disaster(disaster::LAVA);
        let g = m.fighters.iter().position(|f| f.giant).unwrap();
        let mut r = rng(97);
        let tt = t + LAVA_CLOSE_MS;
        m.fighters[g].x = 1.0;
        let hp = m.fighters[g].hp;
        for f in m.fighters.iter_mut().filter(|f| !f.giant) {
            (f.x, f.y) = (14.0, 9.0);
        }
        m.step(tt, 100, &mut r);
        let lost = hp - m.fighters[g].hp;
        assert!(lost > 0.1 * GIANT_HP && lost < 0.25 * GIANT_HP, "{lost}");
        // A meteor, a tick of acid: a good bite out of it.
        assert!(METEOR_DMG * GIANT_METEOR_X / GIANT_HP > 0.04);
        assert!(ACID_DMG * GIANT_ACID_X / GIANT_HP > 0.04);
    }

    #[test]
    fn the_lions_are_gone_with_the_round_and_decide_nothing() {
        let (mut m, t) = fixed_disaster(disaster::LIONS);
        assert!(!m.lions.is_empty());
        for k in 1..m.fighters.len() {
            m.fighters[k].down = true;
        }
        let winner = m.fighters[0].id;
        let (evs, _) = run_to(&mut m, t, t + 100, 13);
        assert!(evs.iter().any(|e| e.kind == ev::ROUND_WON && e.a == winner));
        assert!(m.lions.is_empty() && m.meteors.is_empty());
        assert_eq!(m.status, ROUND_END);
    }

    #[test]
    fn bots_keep_out_of_the_lava_and_fight_the_lions_off() {
        for (kind, seed) in [
            (disaster::LAVA, 30),
            (disaster::LIONS, 31),
            (disaster::METEORS, 32),
        ] {
            for giant in [false, true] {
                let mut m = Match::new(ring());
                m.join(1, 0);
                m.set_disasters(1, true);
                if giant {
                    m.set_mode(1, mode::GOLIATH, 1);
                }
                assert!(m.start(1, false, 0));
                m.fighters.iter_mut().for_each(|f| f.bot = true);
                let mut r = rng(seed);
                let mut now = 0;
                while m.status != FIGHTING {
                    now += 100;
                    m.step(now, 100, &mut r);
                }
                let round = m.round;
                for id in 50..53 {
                    m.vote(id, kind);
                }
                let mut lions_hit = 0;
                let mut lava_deaths = 0;
                while m.status == FIGHTING && m.round == round && now < 200_000 {
                    now += 100;
                    let lava = m.lava(now);
                    for e in m.step(now, 100, &mut r) {
                        lions_hit += (e.kind == ev::LION_HIT) as u32;
                        if e.kind == ev::DOWN && e.a == 0 && lava < 1.0 {
                            lava_deaths += 1;
                        }
                    }
                }
                assert!(
                    m.status != FIGHTING,
                    "the round ended (kind {kind}, giant {giant})"
                );
                if kind == disaster::LIONS && now > 45_000 {
                    assert!(lions_hit > 0, "they fought back");
                }
                // (Not one walking straight in with lots of room left.)
                if kind == disaster::LAVA {
                    eprintln!("LAVA deaths {lava_deaths} giant {giant} at {}", now / 1000);
                }
            }
        }
    }

    #[test]
    fn extreme_bots_get_out_from_under_a_bomb() {
        let mut m = goliath_match(0);
        m.level = crate::level::EXTREME;
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 11.0);
        at(&mut m, 1, 17.0, 2.0);
        at(&mut m, 2, 10.0, 6.5);
        at(&mut m, 3, 3.0, 2.0);
        let (bot, giant) = (
            m.fighters.iter().find(|f| f.slot == 2).unwrap().id,
            m.fighters[0].id,
        );
        m.fighters.iter_mut().for_each(|f| f.bot = f.slot == 2);
        let mut b = Missile::new(giant, gift::BOMB, 10.0, 8.0, -FRAC_PI_2);
        b.left = 1.5;
        b.vx = 0.0;
        b.vy = -1.0;
        m.missiles.push(b);
        let mut r = rng(5);
        let mut t = now;
        for _ in 0..4 {
            t += 100;
            m.step(t, 100, &mut r);
        }
        let f = m.fighter(bot).unwrap();
        assert!(
            (f.x - 10.0).hypot(f.y - 6.5) > 0.5,
            "it moved off: {} {}",
            f.x,
            f.y
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
            stale: u32::MAX,
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
            // (Till it lands: then, while they're still reeling, a look.)
            for _ in 0..12 {
                t += 100;
                evs.extend(m.step(t, 100, &mut rng(3)));
                if evs.iter().any(|e| e.kind == ev::STOMP && e.a == 1) {
                    break;
                }
            }
            assert!(evs.iter().any(|e| e.kind == ev::STOMP && e.a == 1));
            assert!(t <= now + held + STOMP.0 + STOMP.1 + 100, "landed late");
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
    fn the_goliath_throws_the_one_it_whirls_on_a_click() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 6.5);
        at(&mut m, 1, 11.6, 6.5);
        at(&mut m, 2, 6.0, 6.5);
        at(&mut m, 3, 3.0, 2.0);
        m.fighters[0].rage = RAGE;
        let gid = m.fighters[0].id;
        let evs = m.input(gid, input::SPECIAL, 0.0, now);
        let victim = evs.iter().find(|e| e.kind == ev::GRAB).expect("grabbed").b;
        // The click still going as it grabbed: no throw yet.
        m.input(gid, input::LIGHT, PI, now + 100);
        let mut t = now;
        let mut evs = Vec::new();
        while t < now + 900 {
            t += 100;
            evs.extend(m.step(t, 100, &mut rng(4)));
        }
        assert!(!evs.iter().any(|e| e.kind == ev::HURL), "still whirling");
        assert_eq!(m.fighters[0].act, act::GRAB);
        // A click a second in: hurled at once, long before the whirl's end.
        m.input(gid, input::LIGHT, PI, t);
        let clicked = t;
        let mut evs = Vec::new();
        while t < clicked + 300 {
            t += 100;
            evs.extend(m.step(t, 100, &mut rng(4)));
        }
        assert!(
            evs.iter().any(|e| e.kind == ev::HURL && e.b == victim),
            "thrown on the click"
        );
        let hurl = evs.iter().find(|e| e.kind == ev::HURL).unwrap();
        assert!(hurl.vx < -1.0, "flung the way it aimed (west): {}", hurl.vx);
        assert_eq!(m.fighter(victim).unwrap().held_by, 0);
        // (And no smash queued up after.)
        assert_ne!(m.fighters[0].act, act::SMASH);
    }

    #[test]
    fn gladiators_mid_ultimate_take_nothing_from_the_goliath() {
        // Classes off (the whirlwind), and on (an archer's volley, a tank's quake).
        for (kits, k, ult) in [
            (false, kit::KNIGHT, act::SPIN),
            (true, kit::ARCHER, act::CAST),
            (true, kit::TANK, act::CAST),
        ] {
            let mut m = goliath_match(0);
            m.kits = kits;
            let gid = m.fighters.iter().find(|f| f.slot == 0).unwrap().id;
            let vid = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
            at(&mut m, 0, 10.0, 6.5);
            at(&mut m, 1, 11.8, 6.5);
            at(&mut m, 2, 3.0, 2.0);
            at(&mut m, 3, 3.0, 11.0);
            let mut now = m.round_at + 100;
            let mut r = rng(9);
            let ulting = |m: &mut Match, now: u32| {
                let v = m.fighters.iter_mut().find(|f| f.id == vid).unwrap();
                v.kit = k;
                v.set(ult, now, 5_000);
            };
            let hp = m.fighter(vid).unwrap().hp;
            let mut all = Vec::new();
            // A smash.
            ulting(&mut m, now);
            all.extend(m.input(gid, input::LIGHT, 0.0, now));
            for _ in 0..8 {
                now += 100;
                all.extend(m.step(now, 100, &mut r));
            }
            // A stomp, full.
            ulting(&mut m, now);
            m.fighters.iter_mut().find(|f| f.id == gid).unwrap().stamina = 100.0;
            all.extend(m.input(gid, input::HEAVY_START, 0.0, now));
            for _ in 0..12 {
                now += 100;
                all.extend(m.step(now, 100, &mut r));
            }
            m.fighters.iter_mut().find(|f| f.id == gid).unwrap().reach = 1.8;
            all.extend(m.input(gid, input::HEAVY_RELEASE, 0.0, now));
            for _ in 0..12 {
                now += 100;
                all.extend(m.step(now, 100, &mut r));
            }
            // The grab.
            ulting(&mut m, now);
            m.fighters.iter_mut().find(|f| f.id == gid).unwrap().rage = RAGE;
            all.extend(m.input(gid, input::SPECIAL, 0.0, now));
            assert!(
                !all.iter().any(|e| e.kind == ev::GRAB && e.b == vid),
                "kits {kits}: never grabbed mid-ultimate"
            );
            let v = m.fighter(vid).unwrap();
            assert_eq!(v.hp, hp, "kits {kits} kit {k}: unhurt mid-ultimate");
            assert!(
                all.iter()
                    .any(|e| e.kind == ev::HIT && e.b == vid && e.m & 256 != 0),
                "kits {kits}: shown glancing off"
            );
        }
    }

    #[test]
    fn the_goliath_smashes_out_of_breath_only_slower() {
        let mut m = goliath_match(0);
        let gid = m.fighters.iter().find(|f| f.slot == 0).unwrap().id;
        at(&mut m, 0, 10.0, 6.5);
        at(&mut m, 1, 12.5, 6.5);
        at(&mut m, 2, 3.0, 2.0);
        at(&mut m, 3, 3.0, 11.0);
        let now = m.round_at + 100;
        m.fighters.iter_mut().find(|f| f.id == gid).unwrap().stamina = 0.0;
        let evs = m.input(gid, input::LIGHT, 0.0, now);
        let swing = evs
            .iter()
            .find(|e| e.kind == ev::SWING)
            .expect("it still smashes");
        assert_eq!(swing.m, 1, "a tired one");
        let g = m.fighter(gid).unwrap();
        assert_eq!(g.act, act::SMASH);
        let (w, a, r) = smash_times(true);
        assert_eq!(g.act_until - g.act_at, w + a + r);
        assert!(w + a + r > SMASH.0 + SMASH.1 + SMASH.2, "slower");
        // It lands, later than a fresh one would.
        let vid = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
        let mut t = now;
        let mut rr = rng(3);
        let mut hit_at = 0;
        while t < now + 1500 && hit_at == 0 {
            t += 50;
            if m.step(t, 50, &mut rr)
                .iter()
                .any(|e| e.kind == ev::HIT && e.b == vid)
            {
                hit_at = t;
            }
        }
        assert!(hit_at >= now + w, "the blow comes after the slower wind-up");
    }

    /// A gift of `kind` at the feet of whoever's in `slot`, taken up.
    fn gift_to(m: &mut Match, slot: usize, kind: u8, now: u32) -> Vec<Event> {
        let f = m.fighters.iter().find(|f| f.slot == slot).unwrap();
        let (x, y) = (f.x, f.y);
        m.gifts.push(Gift {
            kind,
            x,
            y,
            lands: 0,
            gone: u32::MAX,
            stale: u32::MAX,
        });
        m.step(now, 100, &mut rng(2))
    }

    #[test]
    fn the_crowds_new_gifts_boots_a_potion_and_a_shield() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 2.0);
        at(&mut m, 1, 10.0, 6.5);
        at(&mut m, 2, 15.0, 11.0);
        at(&mut m, 3, 3.0, 11.0);
        let id = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
        // The boots: half as fast again, a while.
        gift_to(&mut m, 1, gift::SPEED, now);
        let f = m.fighter(id).unwrap();
        assert_eq!(f.speed_until, now + SPEED_GIFT_MS);
        assert!(f.buffs(now) & buff::SPEED != 0);
        assert_eq!(f.speed_x(now), 1.5);
        assert_eq!(f.speed_x(now + SPEED_GIFT_MS), 1.0);
        // The potion: half as much again as a roast leg, over fifteen seconds.
        let hurt = 10.0;
        m.fighters.iter_mut().find(|f| f.id == id).unwrap().hp = hurt;
        gift_to(&mut m, 1, gift::REGEN, now + 100);
        let early = m.fighter(id).unwrap().hp;
        assert!(early < hurt + 2.0, "slowly: {early}");
        let mut t = now + 100;
        let mut r = rng(3);
        while t < now + 100 + REGEN_MS + 2000 {
            t += 100;
            // (On the move: only the potion's healing them.)
            at(&mut m, 1, 10.0 + (t % 400) as f64 / 1000.0, 6.5);
            m.step(t, 100, &mut r);
        }
        let healed = m.fighter(id).unwrap().hp - hurt;
        assert!((healed - HEAL * REGEN_HEAL).abs() < 3.0, "healed {healed}");
    }

    #[test]
    fn a_gladiator_standing_still_heals_very_slowly_and_shows_it() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 2.0);
        at(&mut m, 1, 10.0, 6.5);
        at(&mut m, 2, 15.0, 11.0);
        at(&mut m, 3, 3.0, 11.0);
        let id = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
        m.fighters.iter_mut().find(|f| f.id == id).unwrap().hp = 50.0;
        let mut r = rng(3);
        let mut t = now;
        // Not at once.
        while t < now + REST_MS - 200 {
            t += 100;
            m.step(t, 100, &mut r);
        }
        assert_eq!(m.fighter(id).unwrap().hp, 50.0);
        assert_eq!(m.fighter(id).unwrap().buffs(t) & buff::HEAL, 0);
        // Then a little a second, the green crosses showing.
        while t < now + REST_MS + 5000 {
            t += 100;
            m.step(t, 100, &mut r);
        }
        let hp = m.fighter(id).unwrap().hp;
        assert!((52.0..54.0).contains(&hp), "healed to {hp}");
        assert!(m.fighter(id).unwrap().buffs(t) & buff::HEAL != 0);
        // On the move, it stops.
        for _ in 0..10 {
            t += 100;
            at(&mut m, 1, 10.0 + (t % 400) as f64 / 1000.0, 6.5);
            m.step(t, 100, &mut r);
        }
        assert!(m.fighter(id).unwrap().hp <= hp + 0.7);
        assert_eq!(m.fighter(id).unwrap().buffs(t) & buff::HEAL, 0);
        // A roast leg shows for a second, moving or not.
        m.fighters.iter_mut().find(|f| f.id == id).unwrap().hp = 20.0;
        t += 100;
        at(&mut m, 1, 10.0, 6.5);
        gift_to(&mut m, 1, gift::HEALTH, t);
        let f = m.fighter(id).unwrap();
        assert_eq!(f.hp, 20.0 + HEAL);
        assert!(f.buffs(t + FED_SHOW_MS - 100) & buff::HEAL != 0);
        assert_eq!(f.buffs(t + FED_SHOW_MS) & buff::HEAL, 0);
    }

    #[test]
    fn a_tank_hauls_its_hammer_back_before_a_longer_wider_harder_blow() {
        let mut tank = Fighter::new(1, 0, (0.0, 0.0), 20.0);
        tank.take_kit(kit::TANK);
        let mut knight = Fighter::new(2, 1, (0.0, 0.0), 20.0);
        knight.take_kit(kit::KNIGHT);
        let (t, k) = (tank.light(0), knight.light(0));
        assert!(t.0 >= k.0 * 19 / 10, "the wind-up: {} and {}", t.0, k.0);
        assert!(t.0 + t.1 + t.2 > k.0 + k.1 + k.2);
        let tk = kit::TANK as usize;
        assert!(KIT_LIGHT_REACH[tk] > KIT_LIGHT_REACH[0] && KIT_LIGHT_ARC[tk] > KIT_LIGHT_ARC[0]);
        assert!(KIT_LIGHT_DMG[tk] > 1.25);
    }

    #[test]
    fn a_block_takes_the_worst_of_arrows_and_bombs_while_there_is_stamina() {
        let setup = |stamina: f64, aim: f64| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 1, 10.0, 6.5);
            let v = m.fighters.iter_mut().find(|f| f.slot == 1).unwrap();
            v.hp = 100.0;
            v.stamina = stamina;
            v.aim = aim;
            v.act = act::BLOCK;
            v.act_until = u32::MAX;
            (m, now)
        };
        let v = |m: &Match| m.fighters.iter().find(|f| f.slot == 1).unwrap().clone();
        // An arrow, faced: a quarter of it, and it costs them, with no parry however fresh.
        let (mut m, now) = setup(100.0, PI);
        m.fighters
            .iter_mut()
            .find(|f| f.slot == 1)
            .unwrap()
            .block_at = now;
        m.strike(
            0,
            1,
            (9.0, 6.5),
            20.0,
            3.0,
            8 | SHOT_ARROW,
            180,
            now,
            &mut vec![],
        );
        assert_eq!(v(&m).hp, 95.0);
        assert_eq!(v(&m).stamina, 100.0 - BLOCK_ARROW_COST);
        assert_eq!(v(&m).act, act::BLOCK);
        // Out of stamina: all of it.
        let (mut m, now) = setup(0.0, PI);
        m.strike(
            0,
            1,
            (9.0, 6.5),
            20.0,
            3.0,
            8 | SHOT_ARROW,
            180,
            now,
            &mut vec![],
        );
        assert_eq!(v(&m).hp, 80.0);
        // From behind: all of it.
        let (mut m, now) = setup(100.0, 0.0);
        m.strike(
            0,
            1,
            (9.0, 6.5),
            20.0,
            3.0,
            8 | SHOT_ARROW,
            180,
            now,
            &mut vec![],
        );
        assert_eq!(v(&m).hp, 80.0);
        // An arrow storm's cost less apiece.
        let (mut m, now) = setup(100.0, PI);
        let storm = 8 | SHOT_ARROW | SHOT_STORM;
        m.strike(0, 1, (9.0, 6.5), 2.0, 1.2, storm, 0, now, &mut vec![]);
        assert_eq!(v(&m).stamina, 100.0 - BLOCK_ARROW_COST * BLOCK_STORM_ARROW);
        // A bomb: a quarter of it, a dearer price, and far less of a shove.
        let (mut m, now) = setup(100.0, PI);
        m.blast(0, 1, 8.0, 6.5, 40.0, now, &mut vec![]);
        let blocked = v(&m);
        assert_eq!(blocked.hp, 90.0);
        assert_eq!(blocked.stamina, 100.0 - BLOCK_BOMB_COST);
        assert_ne!(blocked.act, act::STUN);
        let (mut m, now) = setup(0.0, PI);
        m.blast(0, 1, 8.0, 6.5, 40.0, now, &mut vec![]);
        let open = v(&m);
        assert_eq!(open.hp, 60.0);
        assert_eq!(open.act, act::STUN);
        assert!(
            blocked.kvx.abs() < open.kvx.abs() * 0.4,
            "{} and {}",
            blocked.kvx,
            open.kvx
        );
        // Right at their feet: blocked whichever way they face.
        let (mut m, now) = setup(100.0, 0.0);
        m.blast(0, 1, 10.0, 6.5, 40.0, now, &mut vec![]);
        assert_eq!(v(&m).hp, 90.0);
    }

    #[test]
    fn a_charged_attack_held_through_a_swing_still_goes_and_needs_the_wind() {
        let tank = |stamina: f64| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 1, 10.0, 6.5);
            let v = m.fighters.iter_mut().find(|f| f.slot == 1).unwrap();
            v.take_kit(kit::TANK);
            v.stamina = stamina;
            let id = v.id;
            (m, now, id)
        };
        let act_of = |m: &Match, id: u32| m.fighter(id).unwrap().act;
        // Pressed early in a slow swing: it waits, however long the swing, and goes.
        let (mut m, now, id) = tank(100.0);
        m.input(id, input::LIGHT, 0.0, now);
        assert_eq!(act_of(&m, id), act::LIGHT1);
        m.input(id, input::HEAVY_START, 0.0, now + 100);
        let mut r = rng(3);
        let mut t = now + 100;
        while act_of(&m, id) != act::CHARGE && t < now + 1500 {
            t += 100;
            m.step(t, 100, &mut r);
        }
        assert_eq!(act_of(&m, id), act::CHARGE, "still waiting at {}", t - now);
        m.input(id, input::HEAVY_RELEASE, 0.0, t + 500);
        assert_eq!(act_of(&m, id), act::STOMP);
        // Nudged just as they let go: it still goes.
        let (mut m, now, id) = tank(100.0);
        m.input(id, input::HEAVY_START, 0.0, now);
        m.fighters
            .iter_mut()
            .find(|f| f.id == id)
            .unwrap()
            .knocked_until = now + 600;
        m.input(id, input::HEAVY_RELEASE, 0.0, now + 500);
        assert_eq!(act_of(&m, id), act::STOMP);
        // Too tired, any class: it doesn't even start; winded, nor then.
        for k in [
            kit::KNIGHT,
            kit::ARCHER,
            kit::BOMBER,
            kit::SPEARMAN,
            kit::TANK,
        ] {
            let (mut m, now, id) = tank(100.0);
            let v = m.fighters.iter_mut().find(|f| f.id == id).unwrap();
            v.take_kit(k);
            v.stamina = 4.0;
            m.input(id, input::HEAVY_START, 0.0, now);
            assert_ne!(act_of(&m, id), act::CHARGE, "class {k}");
            let v = m.fighters.iter_mut().find(|f| f.id == id).unwrap();
            v.stamina = 100.0;
            v.winded_until = now + 500;
            m.input(id, input::HEAVY_START, 0.0, now);
            assert_ne!(act_of(&m, id), act::CHARGE, "class {k}");
            m.input(id, input::HEAVY_START, 0.0, now + 500);
            assert_eq!(act_of(&m, id), act::CHARGE, "class {k}");
        }
        // The Goliath too.
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        let gid = m.fighters.iter().find(|f| f.giant).unwrap().id;
        m.fighters.iter_mut().find(|f| f.id == gid).unwrap().stamina = 5.0;
        m.input(gid, input::HEAVY_START, 0.0, now);
        assert_ne!(act_of(&m, gid), act::CHARGE);
        // A bomber who can start a big bomb can always finish one, smaller.
        let (mut m, now, id) = tank(100.0);
        let v = m.fighters.iter_mut().find(|f| f.id == id).unwrap();
        v.take_kit(kit::BOMBER);
        v.stamina = 20.0;
        m.input(id, input::HEAVY_START, 0.0, now);
        m.input(id, input::HEAVY_RELEASE, 0.0, now + BIG_BOMB_FULL_MS);
        assert_eq!(act_of(&m, id), act::SHOOT);
        assert!(m.fighter(id).unwrap().charge < 0.5);
    }

    #[test]
    fn a_spearmans_lunge_takes_twice_as_long_to_fill() {
        let lunge = |k: u8, held: u32| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 1, 10.0, 6.5);
            let v = m.fighters.iter_mut().find(|f| f.slot == 1).unwrap();
            v.take_kit(k);
            let id = v.id;
            m.input(id, input::HEAVY_START, 0.0, now);
            m.input(id, input::HEAVY_RELEASE, 0.0, now + held);
            m.fighter(id).unwrap().charge
        };
        assert_eq!(lunge(kit::KNIGHT, HEAVY_FULL_MS), 1.0);
        assert!(lunge(kit::SPEARMAN, HEAVY_FULL_MS) < 0.5);
        assert_eq!(lunge(kit::SPEARMAN, SPEAR_FULL_MS), 1.0);
    }

    #[test]
    fn the_goliath_knocks_a_bomb_back_just_the_same() {
        let setup = |stamina: f64, aim: f64| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 0, 10.0, 6.5);
            at(&mut m, 1, 7.0, 6.5);
            at(&mut m, 2, 15.0, 11.0);
            at(&mut m, 3, 15.0, 2.0);
            let g = &mut m.fighters[0];
            g.stamina = stamina;
            g.aim = aim;
            g.act = act::BLOCK;
            g.act_until = u32::MAX;
            let gid = g.id;
            let thrower = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
            let mut b = Missile::new(thrower, gift::BOMB, 8.0, 6.5, 0.0);
            b.left = 1.2;
            b.dmg = 30.0;
            b.cost = 20.0;
            m.missiles.push(b);
            (m, now, gid, thrower)
        };
        let (mut m, now, gid, thrower) = setup(100.0, PI);
        let (giant, hp) = (m.fighter(gid).unwrap().hp, m.fighter(thrower).unwrap().hp);
        let mut evs = Vec::new();
        let mut paid = None;
        let mut t = now;
        for _ in 0..12 {
            t += 100;
            evs.extend(m.step(t, 100, &mut rng(3)));
            if paid.is_none() && evs.iter().any(|e| e.kind == ev::BOUNCE) {
                paid = Some(100.0 - m.fighter(gid).unwrap().stamina);
            }
        }
        assert!((paid.expect("bounced") - 20.0 * GIANT_BOUNCE_COST_X).abs() < 0.01);
        assert!(evs.iter().any(|e| e.kind == ev::BOOM && e.a == gid));
        // (It went off the size it came, not grown by being the Goliath's.)
        let boom = evs.iter().find(|e| e.kind == ev::BOOM).unwrap();
        assert_eq!(boom.n, (BOMB_R * 100.0) as u16);
        assert_eq!(m.fighter(gid).unwrap().hp, giant);
        assert!(m.fighter(thrower).unwrap().hp < hp, "into the thrower");
        // Short of stamina, or caught from behind: no.
        for (stamina, aim) in [(20.0, PI), (100.0, 0.0)] {
            let (mut m, now, ..) = setup(stamina, aim);
            let evs = m.step(now + 100, 100, &mut rng(3));
            let more = m.step(now + 200, 100, &mut rng(3));
            assert!(!evs.iter().chain(&more).any(|e| e.kind == ev::BOUNCE));
        }
    }

    #[test]
    fn a_tanks_shield_knocks_a_bomb_back_into_whoever_threw_it() {
        // The Goliath's bomb coming at slot 1 from the west, close enough that
        // its own blast reaches the tank too, and clear of the pillar.
        let setup = |k: u8, stamina: f64, aim: f64, cost: f64| {
            let mut m = goliath_match(0);
            let now = m.round_at + 100;
            at(&mut m, 0, 7.0, 6.5);
            at(&mut m, 1, 10.0, 6.5);
            at(&mut m, 2, 15.0, 11.0);
            at(&mut m, 3, 15.0, 2.0);
            let gid = m.fighters[0].id;
            let v = m.fighters.iter_mut().find(|f| f.slot == 1).unwrap();
            v.take_kit(k);
            v.stamina = stamina;
            v.aim = aim;
            v.act = act::BLOCK;
            v.act_until = u32::MAX;
            let id = v.id;
            let mut b = Missile::new(gid, gift::BOMB, 8.0, 6.5, 0.0);
            b.left = 1.2;
            b.dmg = 30.0;
            b.cost = cost;
            m.missiles.push(b);
            (m, now, gid, id)
        };
        let run = |m: &mut Match, now: u32| {
            let mut evs = Vec::new();
            let mut t = now;
            for _ in 0..12 {
                t += 100;
                evs.extend(m.step(t, 100, &mut rng(3)));
            }
            evs
        };
        // Faced, with the stamina: back it goes, a bit dearer than the throw, right into them.
        let (mut m, now, gid, id) = setup(kit::TANK, 100.0, PI, 40.0);
        let hp = m.fighter(id).unwrap().hp;
        let giant_hp = m.fighter(gid).unwrap().hp;
        let evs = run(&mut m, now);
        let bounced = evs.iter().find(|e| e.kind == ev::BOUNCE).expect("bounced");
        assert_eq!((bounced.a, bounced.b), (gid, id));
        assert!(evs.iter().any(|e| e.kind == ev::THROW && e.a == id));
        assert!(
            evs.iter().any(|e| e.kind == ev::BOOM && e.a == id),
            "went off, the tank's"
        );
        assert_eq!(m.fighter(id).unwrap().hp, hp, "no harm to the tank");
        assert!(m.fighter(gid).unwrap().hp < giant_hp, "into the thrower");
        assert!(m.missiles.is_empty());
        // A little more than the throw took (a found bomb, as a quick lob's).
        for (cost, paid) in [(40.0, 88.0), (0.0, BOUNCE_MIN_COST * BOUNCE_COST_X)] {
            let (mut m, now, _, id) = setup(kit::TANK, 100.0, PI, cost);
            m.step(now + 100, 100, &mut rng(3));
            m.step(now + 200, 100, &mut rng(3));
            let spent = 100.0 - m.fighter(id).unwrap().stamina;
            assert!((spent - paid).abs() < 0.01, "spent {spent}");
        }
        // Not enough stamina, the wrong way round, or not a tank: it just goes off.
        for (k, stamina, aim) in [
            (kit::TANK, 30.0, PI),
            (kit::TANK, 100.0, 0.0),
            (kit::KNIGHT, 100.0, PI),
        ] {
            let (mut m, now, gid, id) = setup(k, stamina, aim, 40.0);
            let evs = run(&mut m, now);
            assert!(!evs.iter().any(|e| e.kind == ev::BOUNCE), "class {k}");
            assert!(evs.iter().any(|e| e.kind == ev::BOOM && e.a == gid));
            assert!(m.fighter(id).unwrap().hp < m.fighter(id).unwrap().max_hp);
        }
    }

    #[test]
    fn a_shield_takes_one_blow_and_bursts() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 3.0, 2.0);
        at(&mut m, 1, 10.0, 6.5);
        at(&mut m, 2, 15.0, 11.0);
        at(&mut m, 3, 3.0, 11.0);
        let id = m.fighters.iter().find(|f| f.slot == 1).unwrap().id;
        gift_to(&mut m, 1, gift::SHIELD, now);
        assert!(m.fighter(id).unwrap().buffs(now) & buff::SHIELD != 0);
        let hp = m.fighter(id).unwrap().hp;
        let j = m.fighters.iter().position(|f| f.id == id).unwrap();
        let mut evs = Vec::new();
        m.strike(0, j, (9.0, 6.5), 30.0, 5.0, 2, 300, now, &mut evs);
        assert_eq!(m.fighter(id).unwrap().hp, hp, "no harm done");
        assert!(evs.iter().any(|e| e.kind == ev::SHIELD && e.b == id));
        assert_eq!(m.fighter(id).unwrap().shields, 0);
        // The next one lands.
        m.strike(0, j, (9.0, 6.5), 30.0, 5.0, 2, 300, now, &mut evs);
        assert!(m.fighter(id).unwrap().hp < hp);
        // The Goliath's shield takes two; its grasp bursts a gladiator's.
        gift_to(&mut m, 0, gift::SHIELD, now + 100);
        let g = m.fighters.iter().find(|f| f.giant).unwrap();
        assert_eq!(g.shields, GIANT_SHIELDS);
        assert!(g.buffs(now) & buff::SHIELD2 != 0);
        gift_to(&mut m, 2, gift::SHIELD, now + 200);
        at(&mut m, 0, 10.0, 6.5);
        at(&mut m, 2, 11.6, 6.5);
        at(&mut m, 1, 3.0, 2.0);
        let g = m.fighters.iter().find(|f| f.giant).unwrap().id;
        m.fighters.iter_mut().find(|f| f.id == g).unwrap().rage = RAGE;
        let evs = m.input(g, input::SPECIAL, 0.0, now + 300);
        assert!(
            evs.iter().any(|e| e.kind == ev::SHIELD),
            "burst in its grasp"
        );
        assert!(!evs.iter().any(|e| e.kind == ev::GRAB));
    }

    #[test]
    fn the_goliath_gets_more_of_every_gift() {
        let mut m = goliath_match(0);
        let now = m.round_at + 100;
        at(&mut m, 0, 10.0, 6.5);
        at(&mut m, 1, 3.0, 2.0);
        at(&mut m, 2, 15.0, 11.0);
        at(&mut m, 3, 3.0, 11.0);
        let g = m.fighters.iter().find(|f| f.giant).unwrap().id;
        gift_to(&mut m, 0, gift::FURY, now);
        assert_eq!(m.fighter(g).unwrap().fury_until, now + GIANT_FURY_MS);
        gift_to(&mut m, 0, gift::SPEED, now + 100);
        assert_eq!(
            m.fighter(g).unwrap().speed_until,
            now + 100 + GIANT_SPEED_GIFT_MS
        );
        gift_to(&mut m, 0, gift::REGEN, now + 200);
        let hps = m.fighter(g).unwrap().regen_hps;
        assert!((hps * 15.0 - HEAL * REGEN_HEAL * GIANT_GIFT_HEAL).abs() < 0.01);
        // A bomb in its hands: one big one.
        m.fighters.iter_mut().find(|f| f.id == g).unwrap().holding = gift::BOMB;
        m.input(g, input::THROW, 0.0, now + 300);
        let mut t = now + 300;
        let mut r = rng(5);
        while t < now + 700 && m.missiles.is_empty() {
            t += 50;
            m.step(t, 50, &mut r);
        }
        assert_eq!(m.missiles.len(), 1, "just the one");
        assert_eq!(m.missiles[0].kind, missile::BIG_BOMB);
        assert_eq!(m.missiles[0].dmg, GIANT_BOMB_DMG);
        assert_eq!(m.missiles[0].r, BIG_BOMB_R.1);
    }

    #[test]
    fn bots_play_a_goliath_match_to_a_champion() {
        // (Enough that a lucky run of seeds does not read as a lopsided fight.)
        const GAMES: u64 = 16;
        let mut giant_wins = 0;
        for seed in 0..GAMES {
            let mut m = Match::new(ring());
            m.join(1, 0);
            // (Hard: the level the two sides are matched at, disasters and all.)
            m.set_level(1, crate::level::HARD);
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
            (1..GAMES as u32).contains(&giant_wins),
            "the Goliath won {giant_wins} of {GAMES}"
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
    fn spikes_poke_up_now_and_then_and_hurt_whoever_stands_on_them() {
        let (mut m, t) = duel();
        let mut r = rng(7);
        let mut spiked = 0;
        for k in 0..200 {
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
        assert!(
            (3..=5).contains(&spiked),
            "about one every four seconds: {spiked}"
        );
        // At no set moment: no two gaps alike, and no plate in step with another.
        let (m, t) = duel();
        let starts = |k: usize| -> Vec<u32> {
            let mut was = 0;
            let mut at = vec![];
            for ms in (0..60_000).step_by(10) {
                let (p, _) = m.spike_phase(k, t + ms);
                if p == 1 && was != 1 {
                    at.push(ms);
                }
                was = p;
            }
            at
        };
        let (a, b) = (starts(0), starts(1));
        assert!((12..=15).contains(&a.len()), "{a:?}");
        let gaps: Vec<u32> = a.windows(2).map(|w| w[1] - w[0]).collect();
        assert!(
            gaps.iter().max().unwrap() - gaps.iter().min().unwrap() > 1500,
            "{gaps:?}"
        );
        assert_ne!(a, b);
        // Quickly up, quickly down: a rattle first, and nothing for ages after.
        let up = (0..60_000)
            .step_by(10)
            .filter(|ms| m.spike_phase(0, t + ms).0 == 2)
            .count();
        assert!((a.len() * 34..=a.len() * 36).contains(&up), "{up}");
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
        // Barely held, one, for less.
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 9.0);
        let wind = m.fighters[0].stamina;
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + HEAVY_MIN_MS);
        let mut one = 0;
        for k in 1..12 {
            one += m
                .step(t + HEAVY_MIN_MS + k * 50, 50, &mut r)
                .iter()
                .filter(|e| e.kind == ev::THROW)
                .count();
        }
        assert_eq!(one, 1);
        assert!(m.fighters[0].stamina > wind - BURST_COST * 0.5);
        assert_eq!(hits.len(), 3, "all three struck, from far off: {hits:?}");
        assert!(
            hits.iter().all(|&n| (n - BURST_DMG).abs() <= 1.0),
            "{hits:?}"
        );
    }

    /// How a stab goes for `k`, a step from a knight: stabs in 3 seconds, the
    /// damage, the stamina it cost.
    fn stabbing(k: u8) -> (u32, f64, f64, Match) {
        let (mut m, t) = duel(k, kit::KNIGHT, 1.0);
        let mut r = rng(5);
        let (hp, wind) = (m.fighters[1].hp, m.fighters[0].stamina);
        let mut stabs = 0;
        let mut now = t;
        for _ in 0..60 {
            m.input(1, input::LIGHT, 0.0, now);
            now += 50;
            m.fighters[1].x = m.fighters[0].x + 1.0;
            for e in m.step(now, 50, &mut r) {
                stabs += (e.kind == ev::HIT && e.a == 1) as u32;
                assert_ne!(e.kind, ev::THROW, "no arrow, no bomb");
            }
        }
        (
            stabs,
            hp - m.fighters[1].hp,
            wind - m.fighters[0].stamina,
            m,
        )
    }

    #[test]
    fn the_archers_and_the_bombers_quick_blow_is_a_fast_weak_stab() {
        for k in [kit::ARCHER, kit::BOMBER] {
            let (stabs, dmg, wind, m) = stabbing(k);
            assert!(stabs >= 12, "really fast: {stabs} in 3 s");
            assert!(
                (dmg / stabs as f64 - STAB_DMG).abs() < 0.2,
                "{dmg} from {stabs}"
            );
            assert!(
                wind / (stabs as f64) < STAB_COST + 1.0,
                "next to no wind: {wind}"
            );
            // (Dealt in the time a knight lands a combo or two.)
            assert!(dmg < 130.0, "{dmg}");
            assert_ne!(m.fighters[1].act, act::STUN, "no stun-lock");
        }
        // A tiny shove, not a reel.
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 1.0);
        let mut r = rng(6);
        let x = m.fighters[1].x;
        m.input(1, input::LIGHT, 0.0, t);
        let mut knocked = 0.0f64;
        for k in 1..4 {
            m.step(t + k * 100, 100, &mut r);
            knocked = knocked.max(m.fighters[1].x - x);
        }
        assert!(knocked > 0.02 && knocked < 0.5, "{knocked}");
        // A guard all but shrugs it off.
        let (mut m, t) = duel(kit::ARCHER, kit::KNIGHT, 1.0);
        m.fighters[1].aim = PI;
        m.fighters[1].act = act::BLOCK;
        m.fighters[1].act_until = u32::MAX;
        m.fighters[1].block_at = 0;
        let (hp, wind) = (m.fighters[1].hp, m.fighters[1].stamina);
        let mut r = rng(6);
        m.input(1, input::LIGHT, 0.0, t);
        for k in 1..4 {
            m.step(t + k * 100, 100, &mut r);
        }
        assert!(hp - m.fighters[1].hp < 1.0);
        assert!(wind - m.fighters[1].stamina <= STAB_BLOCK_COST + 0.01);
        // The bow and the bomb are held for, as ever.
        let (mut m, t) = duel(kit::BOMBER, kit::KNIGHT, 4.0);
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + HEAVY_MIN_MS);
        assert_eq!(m.fighters[0].act, act::SHOOT);
    }

    #[test]
    fn a_roll_or_a_charge_pressed_a_moment_too_soon_still_goes() {
        // Mid wind-up of a blow, a roll waits for the blow to land.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 3.0);
        let mut r = rng(8);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(1, input::ROLL, 1.0, t + 20);
        assert_ne!(m.fighters[0].act, act::ROLL);
        let mut rolled = false;
        for k in 1..5 {
            for e in m.step(t + k * 100, 100, &mut r) {
                rolled |= e.kind == ev::ROLL;
            }
        }
        assert!(rolled, "within the buffer");
        // Right after the last roll, too: as soon as it's cooled down.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 3.0);
        let mut r = rng(8);
        m.input(1, input::ROLL, 1.0, t);
        assert_eq!(m.fighters[0].act, act::ROLL);
        let again = t + ROLL_MS + ROLL_CD_MS - 200;
        m.input(1, input::ROLL, 2.0, again);
        let mut rolled = 0;
        let mut now = t;
        while now < again + 500 {
            now += 100;
            for e in m.step(now, 100, &mut r) {
                rolled += (e.kind == ev::ROLL) as u32;
            }
        }
        assert_eq!(rolled, 1, "the second one, once");
        // Reeling, it waits for that too.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 3.0);
        let mut r = rng(8);
        m.fighters[0].act = act::STUN;
        m.fighters[0].act_until = t + 200;
        m.input(1, input::ROLL, 2.0, t);
        let mut rolled = false;
        for k in 1..4 {
            for e in m.step(t + k * 100, 100, &mut r) {
                rolled |= e.kind == ev::ROLL;
            }
        }
        assert!(rolled);
        // Not for ever: pressed long ago, it's forgotten.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 3.0);
        let mut r = rng(8);
        m.fighters[0].act = act::STUN;
        m.fighters[0].act_until = t + 1500;
        m.input(1, input::ROLL, 2.0, t);
        for k in 1..20 {
            for e in m.step(t + k * 100, 100, &mut r) {
                assert_ne!(e.kind, ev::ROLL);
            }
        }
        // Held all through someone's blow, let go just as it ends: the heavy
        // blow, not a slash for having had to wait.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 3.0);
        let mut r = rng(8);
        m.fighters[0].act = act::STUN;
        m.fighters[0].act_until = t + 700;
        m.input(1, input::HEAVY_START, 0.0, t);
        m.input(1, input::HEAVY_RELEASE, 0.0, t + 650);
        let mut heavy = false;
        for k in 1..10 {
            m.step(t + k * 100, 100, &mut r);
            heavy |= m.fighters[0].act == act::HEAVY;
        }
        assert!(heavy, "{}", m.fighters[0].act);
        // Let go right after a wait: it's a charged blow already.
        let (mut m, t) = duel(kit::KNIGHT, kit::KNIGHT, 3.0);
        let mut r = rng(8);
        m.fighters[0].act = act::STUN;
        m.fighters[0].act_until = t + 500;
        m.input(1, input::HEAVY_START, 0.0, t);
        let mut now = t;
        while m.fighters[0].act != act::CHARGE {
            now += 100;
            m.step(now, 100, &mut r);
        }
        m.input(1, input::HEAVY_RELEASE, 0.0, now + 10);
        assert_eq!(m.fighters[0].act, act::HEAVY);
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
        m.input(1, input::HEAVY_START, 0.0, t);
        let t = t + HEAVY_MIN_MS;
        m.input(1, input::HEAVY_RELEASE, 0.0, t);
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
        // Four in five of them have the disasters on, and it doesn't stick.
        let on = (0..400)
            .filter(|_| {
                let mut m = Match::new(sand());
                m.exhibit(0, &mut r);
                let on = m.disasters;
                m.call_off();
                assert!(!m.disasters, "the lobby's as it was");
                on
            })
            .count();
        assert!((280..=360).contains(&on), "{on} of 400");
        // Called off by the sign: an empty lobby.
        let mut m = Match::new(sand());
        m.exhibit(0, &mut r);
        assert!(m.call_off());
        assert!(m.slots.iter().all(|&s| s == 0) && m.status == LOBBY);
        assert!(!m.call_off());
    }
    #[test]
    fn the_wheel_spins_every_round_for_a_new_class() {
        let mut m = Match::new(sand());
        m.join(1, 0);
        assert!(m.set_kits(1, true));
        assert!(m.set_wheel(1, true));
        assert!(m.start(1, true, 0));
        assert!(m.choosing(10), "the wheel spins");
        assert!(!m.choose_kit(1, kit::TANK, 10), "it chooses, not you");
        assert!(m.picks.iter().all(|p| p & kit::PICKED != 0));
        assert_eq!(m.choose_end, WHEEL_MS);
        // Every round after: it spins again, and never lands on the class you just had.
        for round in 0..40u32 {
            let before: Vec<u8> = m
                .fighters
                .iter()
                .map(|f| m.picks[f.slot] & !kit::PICKED)
                .collect();
            let at = 50_000 + round * 17_011;
            m.begin_round(at);
            assert!(m.choosing(at + 1), "it spins every round");
            assert_eq!(m.choose_end, at + WHEEL_MS);
            for (f, was) in m.fighters.iter().zip(before) {
                let now = m.picks[f.slot];
                assert!(now & kit::PICKED != 0);
                assert_ne!(now & !kit::PICKED, was, "a new class each round");
                assert!((now & !kit::PICKED) < kit::COUNT);
            }
        }
    }
}
