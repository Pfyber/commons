//! Token bucket, driven by caller-supplied millisecond timestamps so it works
//! with instance clocks and is trivially testable.

#[derive(Debug, Clone)]
pub struct Bucket {
    capacity: f32,
    per_ms: f32,
    tokens: f32,
    last_ms: u64,
}

impl Bucket {
    /// `capacity` burst, refilling `per_sec` tokens per second.
    pub fn new(capacity: f32, per_sec: f32) -> Self {
        Bucket {
            capacity,
            per_ms: per_sec / 1000.0,
            tokens: capacity,
            last_ms: 0,
        }
    }

    pub fn try_take(&mut self, now_ms: u64) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_ms) as f32;
        self.last_ms = self.last_ms.max(now_ms);
        self.tokens = (self.tokens + elapsed * self.per_ms).min(self.capacity);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bursts_then_refills() {
        let mut b = Bucket::new(2.0, 1.0);
        assert!(b.try_take(0));
        assert!(b.try_take(0));
        assert!(!b.try_take(500));
        assert!(b.try_take(1000));
        assert!(!b.try_take(1000));
    }
}
