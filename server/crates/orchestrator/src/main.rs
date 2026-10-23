//! Router / orchestrator (spec §4.1): `POST /api/join` → which zone server and
//! instance to connect to, plus a short-lived join token.
//!
//! Requests name a zone, or a friend to join (`friend`), or a home to visit
//! (`zone_id: "home"` with `owner`). Friends and visits are checked with the
//! social gateway, which knows friendships, presence and invitations. Instance
//! choice is still "instance 1"; M5 adds load-based routing.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use commons_common::token::{self, AccessClaims, JOIN_TTL_SECS, JoinClaims, ServiceClaims};
use commons_common::{config, telemetry};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

struct AppState {
    secret: Vec<u8>,
    /// Public WebSocket URL of the zone server, e.g. `ws://localhost:8082/ws`.
    zone_server_url: String,
    zones: Vec<String>,
    social_url: String,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct JoinReq {
    #[serde(default)]
    zone_id: Option<String>,
    /// Join this friend wherever they are.
    #[serde(default, alias = "prefer_friend_id")]
    friend: Option<String>,
    /// For `zone_id: "home"`: whose home (default: your own).
    #[serde(default)]
    owner: Option<String>,
    /// Leaving through a door: `place:<name>` (a public building), a home's
    /// owner, or `"home"` (your own), to come out of that door.
    #[serde(default)]
    arrive: Option<String>,
}

#[derive(Serialize)]
struct JoinResp {
    server_url: String,
    zone_id: String,
    instance_id: u16,
    owner: Option<String>,
    /// e.g. "Ana's home"; empty for public zones.
    label: String,
    join_token: String,
}

type Err = (StatusCode, Json<serde_json::Value>);

fn err(status: StatusCode, code: &str, message: &str) -> Err {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
}

#[derive(Deserialize)]
struct Located {
    zone: String,
    instance: u16,
    owner: Option<String>,
}

/// Public buildings with a door onto the city (a `door:<name>` spot there).
const PUBLIC_DOORS: &[&str] = &[
    "mall",
    "bar",
    "arcade",
    "library",
    "club_hall",
    "bowling",
    "concert_hall",
];

/// Zones served unless `COMMONS_ZONES` says otherwise: the city, homes, the
/// public buildings, and the Library's hall and wings (ADR 0012).
const ZONES: &str = "city,home,mall,bar,arcade,library,library_children,library_lit,library_world,library_history,library_society,library_science,library_arts,library_reference,club_hall,clubroom,bowling,concert_hall";

/// A metro station, `metro_<key>` (ADR 0016): you come up its stairs.
fn is_station(place: &str) -> bool {
    place
        .strip_prefix("metro_")
        .is_some_and(|k| (1..=16).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_lowercase()))
}

/// A club lot's id, `lot:<bx>_<by>` (ADR 0014, C3).
fn is_club_lot(place: &str) -> bool {
    place.strip_prefix("lot:").is_some_and(|r| {
        r.split_once('_').is_some_and(|(x, y)| {
            [x, y]
                .iter()
                .all(|n| !n.is_empty() && n.len() <= 2 && n.bytes().all(|b| b.is_ascii_digit()))
        })
    })
}

#[derive(Deserialize)]
struct Lot {
    lot: String,
}

#[derive(Deserialize)]
struct SocialErr {
    #[serde(default)]
    error: String,
    #[serde(default)]
    message: String,
}

/// Asks the social gateway; passes its refusals through to the player.
async fn ask_social<T: serde::de::DeserializeOwned>(
    state: &AppState,
    path: &str,
) -> Result<T, Err> {
    let auth = token::sign(
        &state.secret,
        &ServiceClaims {
            svc: "orchestrator".into(),
        },
        60,
    );
    let resp = state
        .http
        .get(format!("{}{path}", state.social_url))
        .bearer_auth(auth)
        .send()
        .await
        .map_err(|_| {
            err(
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
                "Friends are unavailable right now.",
            )
        })?;
    let status = resp.status();
    if status.is_success() {
        return resp
            .json()
            .await
            .map_err(|_| err(StatusCode::BAD_GATEWAY, "bad_gateway", "Unexpected reply."));
    }
    let body: SocialErr = resp.json().await.unwrap_or(SocialErr {
        error: "error".into(),
        message: "That didn't work.".into(),
    });
    Err((
        status,
        Json(serde_json::json!({ "error": body.error, "message": body.message })),
    ))
}

async fn join(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<JoinReq>,
) -> Result<Json<JoinResp>, Err> {
    let bearer = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| {
            err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing bearer token",
            )
        })?;
    let who: AccessClaims = token::verify(&state.secret, bearer)
        .map_err(|e| err(StatusCode::UNAUTHORIZED, "unauthorized", &e.to_string()))?;

    let (zone, instance, owner, label) = if let Some(friend) = &req.friend {
        let loc: Located = ask_social(
            &state,
            &format!("/internal/locate?player={}&friend={friend}", who.sub),
        )
        .await?;
        (loc.zone, loc.instance, loc.owner, String::new())
    } else {
        let zone = req.zone_id.clone().unwrap_or_else(|| "city".into());
        if zone == "home" {
            let owner = req.owner.clone().unwrap_or_else(|| who.sub.clone());
            let mut label = "Your home".to_string();
            if owner == who.sub {
                // Homes are houses in the city now: no house, no home (ADR 0010).
                let _: Lot =
                    ask_social(&state, &format!("/internal/home?player={}", who.sub)).await?;
            } else {
                #[derive(Deserialize)]
                struct Visit {
                    owner_name: String,
                }
                let v: Visit = ask_social(
                    &state,
                    &format!("/internal/can_visit?guest={}&owner={owner}", who.sub),
                )
                .await?;
                label = format!("{}'s home", v.owner_name);
            }
            (zone, 1, Some(owner), label)
        } else if zone == "clubroom" {
            // A club's own room (ADR 0014): its members only, while it has one.
            let club = req
                .owner
                .clone()
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "no_club", "Which club's room?"))?;
            #[derive(Deserialize)]
            struct Room {
                name: String,
            }
            let room: Room = ask_social(
                &state,
                &format!("/internal/club_room?player={}&club={club}", who.sub),
            )
            .await?;
            (zone, 1, Some(club), room.name)
        } else {
            (zone, 1, None, String::new())
        }
    };
    // Leaving somewhere through a door: step out of that door (best effort).
    // `arrive` is a public place (`place:mall`; a library wing, back into the
    // hall; a club room, back into the Club Hall, or out of a clubhouse's door
    // on its lot, `place:lot:3_1`; up a metro station's stairs,
    // `place:metro_lake`), a home's owner, or "home" for your own.
    let arrive = match req.arrive.as_deref() {
        Some(a) if zone == "library" => a
            .strip_prefix("place:")
            .filter(|w| w.starts_with("library_") && state.zones.iter().any(|z| z == w))
            .map(String::from),
        Some("place:clubroom") if zone == "club_hall" => Some("clubroom".to_string()),
        Some(a) if zone == "city" => match a.strip_prefix("place:") {
            Some(place) => {
                (PUBLIC_DOORS.contains(&place) || is_club_lot(place) || is_station(place))
                    .then(|| place.to_string())
            }
            None => {
                let owner = if a == "home" { who.sub.as_str() } else { a };
                ask_social::<Lot>(&state, &format!("/internal/home?player={owner}"))
                    .await
                    .ok()
                    .map(|l| l.lot)
            }
        },
        _ => None,
    };
    if !state.zones.contains(&zone) {
        return Err(err(StatusCode::NOT_FOUND, "unknown_zone", "no such zone"));
    }
    let claims = JoinClaims {
        sub: who.sub,
        name: who.name,
        look: who.look,
        style: who.style,
        tier: who.tier,
        minor: who.minor,
        zone: zone.clone(),
        instance,
        owner: owner.clone(),
        muted_until: who.muted_until,
        arrive,
    };
    Ok(Json(JoinResp {
        server_url: state.zone_server_url.clone(),
        zone_id: zone,
        instance_id: instance,
        owner,
        label,
        join_token: token::sign(&state.secret, &claims, JOIN_TTL_SECS),
    }))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let prom = telemetry::init("orchestrator");
    let bind = config::env_str("ORCHESTRATOR_BIND", "0.0.0.0:8081");
    let state = Arc::new(AppState {
        secret: config::secret(),
        zone_server_url: config::env_str("ZONE_PUBLIC_URL", "ws://localhost:8082/ws"),
        zones: config::env_str("COMMONS_ZONES", ZONES)
            .split(',')
            .map(|s| s.trim().to_string())
            .collect(),
        social_url: config::env_str("COMMONS_SOCIAL_INTERNAL_URL", "http://127.0.0.1:8083"),
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()?,
    });
    let app = Router::new()
        .route("/api/join", post(join))
        .with_state(state)
        .merge(telemetry::routes(prom));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "orchestrator listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_club_lot, is_station};

    #[test]
    fn metro_stations_are_stations_only() {
        assert!(is_station("metro_lake"));
        for bad in ["metro_", "metro_Lake", "metro_a1", "lake", "metro_../x"] {
            assert!(!is_station(bad), "{bad}");
        }
    }

    #[test]
    fn club_lot_doors_are_lots_only() {
        assert!(is_club_lot("lot:4_1"));
        assert!(is_club_lot("lot:12_3"));
        for bad in [
            "lot:",
            "lot:4",
            "lot:a_1",
            "lot:4_1_2",
            "lot:123_1",
            "home",
            "lot:4_",
        ] {
            assert!(!is_club_lot(bad), "{bad}");
        }
    }
}
