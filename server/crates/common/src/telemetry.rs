//! Structured logs (tracing) and Prometheus metrics, wired the same way in
//! every service. `COMMONS_LOG_JSON=1` switches logs to JSON for production.

use axum::{Router, routing::get};
use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};
use tracing_subscriber::EnvFilter;

pub fn init(service: &str) -> PrometheusHandle {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    if crate::config::env_or("COMMONS_LOG_JSON", false) {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
    let handle = PrometheusBuilder::new()
        .add_global_label("service", service)
        .set_buckets_for_metric(
            Matcher::Suffix("_seconds".into()),
            &[
                0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 1.0,
            ],
        )
        .expect("valid buckets")
        .install_recorder()
        .expect("metrics recorder installs once");
    tracing::info!(service, "telemetry initialised");
    handle
}

/// `/metrics` and `/healthz`, merged into each service's router.
pub fn routes<S: Clone + Send + Sync + 'static>(handle: PrometheusHandle) -> Router<S> {
    Router::new()
        .route("/metrics", get(move || std::future::ready(handle.render())))
        .route("/healthz", get(|| async { "ok" }))
}
