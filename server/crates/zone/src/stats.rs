//! Lock-light per-instance statistics, readable from outside the actor.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

/// Ticks kept for percentiles: one minute at 10 Hz.
const WINDOW: usize = 600;

#[derive(Default)]
pub struct InstanceStats {
    pub population: AtomicU32,
    pub bytes_out: AtomicU64,
    pub frames_out: AtomicU64,
    ticks_us: Mutex<VecDeque<u32>>,
}

#[derive(Serialize)]
pub struct InstanceSnapshot {
    pub zone: String,
    pub instance: u16,
    pub population: u32,
    pub bytes_out: u64,
    pub frames_out: u64,
    pub tick_p50_us: u32,
    pub tick_p99_us: u32,
    pub tick_max_us: u32,
    pub ticks_sampled: usize,
}

impl InstanceStats {
    pub fn record_tick(&self, d: Duration) {
        let mut t = self.ticks_us.lock().unwrap();
        if t.len() == WINDOW {
            t.pop_front();
        }
        t.push_back(d.as_micros().min(u32::MAX as u128) as u32);
    }

    pub fn snapshot(&self, zone: &str, instance: u16) -> InstanceSnapshot {
        let mut ticks: Vec<u32> = self.ticks_us.lock().unwrap().iter().copied().collect();
        ticks.sort_unstable();
        let pct = |q: f64| -> u32 {
            if ticks.is_empty() {
                0
            } else {
                ticks[((ticks.len() - 1) as f64 * q).round() as usize]
            }
        };
        InstanceSnapshot {
            zone: zone.to_string(),
            instance,
            population: self.population.load(Ordering::Relaxed),
            bytes_out: self.bytes_out.load(Ordering::Relaxed),
            frames_out: self.frames_out.load(Ordering::Relaxed),
            tick_p50_us: pct(0.5),
            tick_p99_us: pct(0.99),
            tick_max_us: ticks.last().copied().unwrap_or(0),
            ticks_sampled: ticks.len(),
        }
    }
}
