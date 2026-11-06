//! Rate limiting.
//!
//! VRChat doesn't publish its limits, so ordinary requests aren't paced at all. Instead:
//! - at most 10 requests to the API are in flight at once (see `api::MAX_CONNECTIONS`);
//! - a read that's already on its way is shared, and one VRChat answered with "not found" or
//!   "forbidden" isn't repeated for 15 minutes (see `api.rs`);
//! - jobs that make many requests in a row go through a sliding-window limiter: the friends
//!   list at 60 pages a minute, bulk lookups at 5 a second;
//! - those jobs retry a 429 after 1×, 2×, 4×… a base delay. Anything else that gets a 429 just
//!   says so;
//! - the group-instance poll is left alone for two minutes after a 429 (see `commands.rs`).
//!
//! Nexus' own upkeep (bio checks, names and pictures for people in the game log, prints…) is
//! a bulk job: wrap it in [`bulk`].

use std::collections::VecDeque;
use std::future::Future;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

/// At most `limit` requests start in any `interval`.
pub struct RateLimiter {
    limit: usize,
    interval: Duration,
    /// When recent and booked requests start, earliest first.
    starts: Mutex<VecDeque<Instant>>,
}

impl RateLimiter {
    pub const fn new(limit: usize, interval: Duration) -> Self {
        Self { limit, interval, starts: Mutex::new(VecDeque::new()) }
    }

    /// Wait for a turn.
    pub async fn wait(&self) {
        let at = self.reserve(Instant::now());
        tokio::time::sleep_until(at.into()).await;
    }

    /// Book the earliest start that keeps every window within the limit. Booking (rather than
    /// just checking) means requests waiting together don't all go the moment the window opens.
    fn reserve(&self, now: Instant) -> Instant {
        let mut starts = self.starts.lock();
        while starts.front().is_some_and(|t| now.saturating_duration_since(*t) >= self.interval) {
            starts.pop_front();
        }
        let at = match starts.len().checked_sub(self.limit) {
            Some(i) => (starts[i] + self.interval).max(now),
            None => now,
        };
        starts.push_back(at);
        at
    }
}

/// How a job's requests are paced, and how they retry a 429.
pub struct Job {
    /// Reads are only shared within the same job (see `Api::get`).
    pub name: &'static str,
    pub limiter: RateLimiter,
    /// How many times a 429 is retried…
    pub retries: u32,
    /// …after this, then twice this, four times this…
    pub backoff: Duration,
}

impl Job {
    /// The wait before retry number `attempt`, counting from 0.
    pub fn delay(&self, attempt: u32) -> Duration {
        self.backoff * 2u32.saturating_pow(attempt.min(16))
    }
}

/// The friends list: 60 pages a minute, a 429 retried up to 5 times from 1 second.
pub static FRIEND_PAGES: Job = Job {
    name: "friends",
    limiter: RateLimiter::new(60, Duration::from_secs(60)),
    retries: 5,
    backoff: Duration::from_secs(1),
};

/// Bulk lookups: 5 a second, a 429 retried up to 4 times from half a second.
pub static BULK: Job = Job {
    name: "bulk",
    limiter: RateLimiter::new(5, Duration::from_secs(1)),
    retries: 4,
    backoff: Duration::from_millis(500),
};

tokio::task_local! {
    static JOB: &'static Job;
}

/// Run `fut` with its VRChat requests paced and retried as part of `job`. The innermost job wins.
pub async fn run_as<F: Future>(job: &'static Job, fut: F) -> F::Output {
    JOB.scope(job, fut).await
}

/// Run Nexus' own upkeep as a bulk job.
pub async fn bulk<F: Future>(fut: F) -> F::Output {
    run_as(&BULK, fut).await
}

/// The job the current task's requests belong to, if any.
pub fn current() -> Option<&'static Job> {
    JOB.try_with(|j| *j).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: Duration = Duration::from_millis(1);

    #[test]
    fn lets_a_burst_through_then_waits_for_the_window() {
        let l = RateLimiter::new(3, Duration::from_secs(1));
        let t0 = Instant::now();
        for _ in 0..3 {
            assert_eq!(l.reserve(t0), t0);
        }
        // The fourth waits until the first is a full window old, the fifth for the second.
        assert_eq!(l.reserve(t0 + 100 * MS), t0 + Duration::from_secs(1));
        assert_eq!(l.reserve(t0 + 200 * MS), t0 + Duration::from_secs(1));
        // Once the window has moved on, there's room again.
        let later = t0 + Duration::from_secs(5);
        assert_eq!(l.reserve(later), later);
    }

    #[test]
    fn never_lets_more_than_the_limit_start_in_one_window() {
        let l = RateLimiter::new(5, Duration::from_secs(1));
        let t0 = Instant::now();
        let starts: Vec<Instant> = (0..23).map(|i| l.reserve(t0 + i * 7 * MS)).collect();
        for (i, a) in starts.iter().enumerate() {
            let in_window = starts[i..].iter().filter(|b| b.saturating_duration_since(*a) < Duration::from_secs(1)).count();
            assert!(in_window <= 5, "{in_window} starts within a second of start {i}");
        }
    }

    #[test]
    fn backs_off_exponentially() {
        let secs = |a| FRIEND_PAGES.delay(a).as_secs();
        assert_eq!((secs(0), secs(1), secs(2), secs(3), secs(4)), (1, 2, 4, 8, 16));
        assert_eq!(BULK.delay(0), Duration::from_millis(500));
        assert_eq!(BULK.delay(3), Duration::from_secs(4));
    }

    #[tokio::test]
    async fn the_innermost_job_wins() {
        assert!(current().is_none());
        bulk(async {
            assert!(std::ptr::eq(current().unwrap(), &BULK));
            run_as(&FRIEND_PAGES, async { assert!(std::ptr::eq(current().unwrap(), &FRIEND_PAGES)) }).await;
            assert!(std::ptr::eq(current().unwrap(), &BULK));
        })
        .await;
    }
}
