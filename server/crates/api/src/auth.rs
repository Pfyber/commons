//! Auth service (spec §4.1, §12): email magic links, signup with age gate,
//! short-lived access JWT plus rotating refresh tokens.
//!
//! Flow: `POST /auth/magic-link` → user opens link → `POST /auth/verify`
//! returns a session, or a `signup_token` for new emails → `POST /auth/signup`.

use crate::AppState;
use crate::error::{ApiError, ApiResult};
use crate::store::{CreateError, Player};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Datelike;
use commons_common::filter::clean_chat;
use commons_common::now_unix;
use commons_common::token::{self, ACCESS_TTL_SECS, AccessClaims, Claims};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const MAGIC_TTL_SECS: u64 = 15 * 60;
const SIGNUP_TTL_SECS: u64 = 30 * 60;
const REFRESH_TTL_SECS: u64 = 30 * 24 * 3600;
const LINK_MIN_GAP_SECS: u64 = 30;
pub const MIN_AGE: i32 = 13;
pub const ADULT_FEATURES_AGE: i32 = 16;

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/magic-link", post(magic_link))
        .route("/auth/verify", post(verify))
        .route("/auth/signup", post(signup))
        .route("/auth/refresh", post(refresh))
        .route("/auth/dev-login", post(dev_login))
        .route("/me", get(me))
}

#[derive(Serialize, Deserialize)]
struct SignupClaims {
    email: String,
}

impl Claims for SignupClaims {
    const TYP: &'static str = "signup";
}

#[derive(Serialize)]
pub struct PlayerView {
    id: String,
    display_name: String,
    look: u32,
    trust_tier: token::TrustTier,
    minor: bool,
}

#[derive(Serialize)]
pub struct Session {
    access_token: String,
    access_expires_in: u64,
    refresh_token: String,
    player: PlayerView,
}

fn random_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn new_player_id() -> String {
    let mut b: [u8; 16] = rand::rng().random();
    b[6] = (b[6] & 0x0f) | 0x40; // UUID v4
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn current_year() -> i32 {
    chrono::Utc::now().year()
}

/// Youngest age the person can be given only their birth year.
fn min_age(birth_year: i32) -> i32 {
    current_year() - birth_year - 1
}

fn is_minor(p: &Player) -> bool {
    min_age(p.birth_year) < ADULT_FEATURES_AGE
}

fn normalize_email(raw: &str) -> ApiResult<String> {
    let email = raw.trim().to_lowercase();
    let valid = email.len() <= 254
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        })
        && !email.contains(char::is_whitespace);
    if valid {
        Ok(email)
    } else {
        Err(ApiError::bad_request(
            "invalid_email",
            "That doesn't look like an email address.",
        ))
    }
}

fn validate_name(raw: &str) -> ApiResult<String> {
    let name = raw.trim().to_string();
    let len = name.chars().count();
    if !(3..=20).contains(&len) {
        return Err(ApiError::bad_request(
            "invalid_name",
            "Names are 3 to 20 characters.",
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-')
        || name.contains("  ")
    {
        return Err(ApiError::bad_request(
            "invalid_name",
            "Use letters, numbers, spaces, - and _.",
        ));
    }
    if clean_chat(&name).as_deref() != Some(name.as_str()) {
        return Err(ApiError::bad_request(
            "invalid_name",
            "Please pick a different name.",
        ));
    }
    Ok(name)
}

fn issue_session(state: &AppState, p: &Player) -> Session {
    let claims = AccessClaims {
        sub: p.id.clone(),
        name: p.display_name.clone(),
        look: p.look,
        tier: p.trust_tier,
        minor: is_minor(p),
    };
    let refresh_token = random_token();
    state
        .store
        .put_refresh(&refresh_token, &p.id, now_unix() + REFRESH_TTL_SECS);
    Session {
        access_token: token::sign(&state.secret, &claims, ACCESS_TTL_SECS),
        access_expires_in: ACCESS_TTL_SECS,
        refresh_token,
        player: PlayerView {
            id: p.id.clone(),
            display_name: p.display_name.clone(),
            look: p.look,
            trust_tier: p.trust_tier,
            minor: is_minor(p),
        },
    }
}

fn create(
    state: &AppState,
    email: String,
    display_name: String,
    birth_year: i32,
) -> ApiResult<Player> {
    let p = Player {
        id: new_player_id(),
        email,
        display_name,
        birth_year,
        look: rand::rng().random(),
        trust_tier: token::TrustTier::Visitor,
        created_at: now_unix(),
    };
    state.store.create_player(p).map_err(|e| match e {
        CreateError::NameTaken => {
            ApiError::new(StatusCode::CONFLICT, "name_taken", "That name is taken.")
        }
        CreateError::EmailTaken => ApiError::new(
            StatusCode::CONFLICT,
            "email_taken",
            "That email already has an account.",
        ),
    })
}

/// Validates the access token in `Authorization: Bearer …`.
pub fn bearer(state: &AppState, headers: &HeaderMap) -> ApiResult<AccessClaims> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;
    token::verify(&state.secret, raw).map_err(|e| ApiError::unauthorized(e.to_string()))
}

// ---- handlers -------------------------------------------------------------

#[derive(Deserialize)]
struct MagicLinkReq {
    email: String,
}

async fn magic_link(
    State(state): S,
    Json(req): Json<MagicLinkReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let email = normalize_email(&req.email)?;
    let now = now_unix();
    if !state.store.allow_link(&email, now, LINK_MIN_GAP_SECS) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "A link was just sent; check your inbox.",
        ));
    }
    let token = random_token();
    state.store.put_magic(&token, &email, now + MAGIC_TTL_SECS);
    let link = format!("{}/?login={token}", state.client_url);
    if state.dev {
        tracing::info!(%email, %link, "magic link (dev)");
        return Ok(Json(serde_json::json!({ "sent": true, "dev_link": link })));
    }
    // No mail provider is wired up yet; production deployments must add one here.
    tracing::warn!(%email, "magic link requested but no mailer is configured");
    Ok(Json(serde_json::json!({ "sent": true })))
}

#[derive(Deserialize)]
struct VerifyReq {
    token: String,
}

async fn verify(State(state): S, Json(req): Json<VerifyReq>) -> ApiResult<Json<serde_json::Value>> {
    let email = state
        .store
        .take_magic(&req.token, now_unix())
        .ok_or_else(|| {
            ApiError::unauthorized("This sign-in link has expired or was already used.")
        })?;
    match state.store.player_by_email(&email) {
        Some(p) => Ok(Json(
            serde_json::to_value(issue_session(&state, &p)).unwrap(),
        )),
        None => {
            let signup_token = token::sign(
                &state.secret,
                &SignupClaims {
                    email: email.clone(),
                },
                SIGNUP_TTL_SECS,
            );
            Ok(Json(
                serde_json::json!({ "signup_required": true, "signup_token": signup_token, "email": email }),
            ))
        }
    }
}

#[derive(Deserialize)]
struct SignupReq {
    signup_token: String,
    display_name: String,
    birth_year: i32,
}

async fn signup(State(state): S, Json(req): Json<SignupReq>) -> ApiResult<Json<Session>> {
    let claims: SignupClaims = token::verify(&state.secret, &req.signup_token)
        .map_err(|_| ApiError::unauthorized("Sign-up expired; request a new link."))?;
    let year = current_year();
    if !(year - 120..=year).contains(&req.birth_year) {
        return Err(ApiError::bad_request(
            "invalid_birth_year",
            "Please enter your birth year.",
        ));
    }
    if min_age(req.birth_year) < MIN_AGE {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "too_young",
            "Commons is for people aged 13 and over.",
        ));
    }
    let name = validate_name(&req.display_name)?;
    let p = create(&state, claims.email, name, req.birth_year)?;
    tracing::info!(player = %p.id, "account created");
    Ok(Json(issue_session(&state, &p)))
}

#[derive(Deserialize)]
struct RefreshReq {
    refresh_token: String,
}

async fn refresh(State(state): S, Json(req): Json<RefreshReq>) -> ApiResult<Json<Session>> {
    let id = state
        .store
        .take_refresh(&req.refresh_token, now_unix())
        .ok_or_else(|| ApiError::unauthorized("session expired"))?;
    let p = state
        .store
        .player(&id)
        .ok_or_else(|| ApiError::unauthorized("account not found"))?;
    Ok(Json(issue_session(&state, &p)))
}

#[derive(Deserialize)]
struct DevLoginReq {
    display_name: String,
}

/// Dev-only shortcut: sign in by name, creating the account if needed.
async fn dev_login(State(state): S, Json(req): Json<DevLoginReq>) -> ApiResult<Json<Session>> {
    if !state.dev {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "not found",
        ));
    }
    let name = validate_name(&req.display_name)?;
    let p = match state.store.player_by_name(&name) {
        Some(p) => p,
        None => {
            let email = format!(
                "{}@dev.commons.local",
                name.to_lowercase().replace(' ', "_")
            );
            create(&state, email, name, current_year() - 30)?
        }
    };
    Ok(Json(issue_session(&state, &p)))
}

async fn me(State(state): S, headers: HeaderMap) -> ApiResult<Json<AccessClaims>> {
    Ok(Json(bearer(&state, &headers)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails() {
        assert_eq!(
            normalize_email("  Ana@Example.org ").unwrap(),
            "ana@example.org"
        );
        for bad in [
            "",
            "ana",
            "ana@",
            "@x.org",
            "ana@org",
            "ana@.org",
            "a na@x.org",
        ] {
            assert!(normalize_email(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn names() {
        assert_eq!(validate_name(" Ana B ").unwrap(), "Ana B");
        assert_eq!(validate_name("Čiril_9").unwrap(), "Čiril_9");
        for bad in [
            "ab",
            "a".repeat(21).as_str(),
            "ana<script>",
            "two  spaces",
            "shithead",
        ] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn age_gate_is_conservative() {
        let y = current_year();
        assert!(min_age(y - 13) < MIN_AGE); // might still be 12
        assert!(min_age(y - 14) >= MIN_AGE);
    }
}
