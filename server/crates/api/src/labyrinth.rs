//! The Glowroot Labyrinth's map for a day (`commons_sim::labyrinth`): the
//! client draws the same maze the zone server walks people through.

use crate::AppState;
use crate::error::{ApiError, ApiResult};
use axum::Router;
use axum::extract::Path;
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use commons_sim::labyrinth;
use std::sync::Arc;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/labyrinth/{day}", get(map))
}

async fn map(Path(day): Path<String>) -> ApiResult<impl IntoResponse> {
    let day = labyrinth::parse_day(&day)
        .filter(|&d| labyrinth::open(d))
        .ok_or_else(|| {
            ApiError::new(StatusCode::NOT_FOUND, "closed", "that labyrinth isn't open")
        })?;
    let json = serde_json::to_string(&labyrinth::generate(day)).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "couldn't draw the labyrinth",
        )
    })?;
    // Always asked again (it's small): after an update that changes how
    // labyrinths are made, a cached copy would no longer match the walls
    // the zone server walks people into.
    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        json,
    ))
}
