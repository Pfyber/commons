//! Auth service (spec §4.1, §12): email magic links, signup with age gate,
//! short-lived access JWT plus rotating refresh tokens.
//!
//! Flow: `POST /auth/magic-link` → user opens link → `POST /auth/verify`
//! returns a session, or a `signup_token` for new emails → `POST /auth/signup`.

use crate::AppState;
use crate::economy::{Op, WELCOME, apply};
use crate::error::{ApiError, ApiResult};
use crate::store::{CreateError, Player, db_err};
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

async fn issue_session(state: &AppState, p: &Player) -> ApiResult<Session> {
    // Trust tier and any mute come from activity and moderation (spec §10.6).
    let uid = uuid::Uuid::parse_str(&p.id).map_err(|_| ApiError::unauthorized("bad player id"))?;
    let tier = crate::gov::refresh_tier(&state.db, uid)
        .await
        .map_err(db_err)?;
    let muted_until = crate::gov::muted_until(&state.db, uid)
        .await
        .map_err(db_err)?;
    let p = &Player {
        trust_tier: tier,
        ..p.clone()
    };
    let claims = AccessClaims {
        sub: p.id.clone(),
        name: p.display_name.clone(),
        look: p.look,
        tier: p.trust_tier,
        minor: is_minor(p),
        muted_until,
    };
    let refresh_token = random_token();
    state
        .store
        .put_refresh(&refresh_token, &p.id, now_unix() + REFRESH_TTL_SECS)
        .await?;
    Ok(Session {
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
    })
}

async fn create(
    state: &AppState,
    email: String,
    display_name: String,
    birth_year: i32,
) -> ApiResult<Player> {
    let look: u32 = rand::rng().random();
    let catalog = state.catalog.clone();
    let created = state
        .store
        .create_player(
            &email,
            &display_name,
            birth_year,
            look,
            move |conn, player| {
                Box::pin(async move {
                    let ops: Vec<Op> = WELCOME
                        .iter()
                        .map(|&(item, delta)| Op { item, delta })
                        .collect();
                    apply(
                        conn,
                        &catalog,
                        player,
                        &ops,
                        "welcome",
                        &format!("welcome:{player}"),
                    )
                    .await?;
                    Ok(())
                })
            },
        )
        .await?;
    created.map_err(|e| match e {
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
    bearer_with(&state.secret, headers)
}

/// `bearer` for services that don't share the API's state (social gateway).
pub fn bearer_with(secret: &[u8], headers: &HeaderMap) -> ApiResult<AccessClaims> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;
    token::verify(secret, raw).map_err(|e| ApiError::unauthorized(e.to_string()))
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
    state
        .store
        .put_magic(&token, &email, now + MAGIC_TTL_SECS)
        .await?;
    let link = format!("{}/?login={token}", state.client_url);
    if let Some(mailer) = &state.mailer {
        if let Err(e) = mailer.send_link(&email, &link).await {
            tracing::error!(error = %e, "sending a sign-in email failed");
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "mail_failed",
                "We couldn't send the email just now. Try again in a minute.",
            ));
        }
        if !state.dev {
            return Ok(Json(serde_json::json!({ "sent": true })));
        }
    }
    if state.dev {
        tracing::info!(%email, %link, "magic link (dev)");
        return Ok(Json(serde_json::json!({ "sent": true, "dev_link": link })));
    }
    tracing::error!(%email, "magic link requested but SMTP_URL is not set");
    Err(ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "mail_unavailable",
        "Sign-in emails aren't set up yet.",
    ))
}

#[derive(Deserialize)]
struct VerifyReq {
    token: String,
}

async fn verify(State(state): S, Json(req): Json<VerifyReq>) -> ApiResult<Json<serde_json::Value>> {
    let email = state.store.take_magic(&req.token).await?.ok_or_else(|| {
        ApiError::unauthorized("This sign-in link has expired or was already used.")
    })?;
    match state.store.player_by_email(&email).await? {
        Some(p) => Ok(Json(
            serde_json::to_value(issue_session(&state, &p).await?).unwrap(),
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
    let p = create(&state, claims.email, name, req.birth_year).await?;
    tracing::info!(player = %p.id, "account created");
    Ok(Json(issue_session(&state, &p).await?))
}

#[derive(Deserialize)]
struct RefreshReq {
    refresh_token: String,
}

async fn refresh(State(state): S, Json(req): Json<RefreshReq>) -> ApiResult<Json<Session>> {
    let id = state
        .store
        .take_refresh(&req.refresh_token)
        .await?
        .ok_or_else(|| ApiError::unauthorized("session expired"))?;
    let p = state
        .store
        .player(&id)
        .await?
        .ok_or_else(|| ApiError::unauthorized("account not found"))?;
    Ok(Json(issue_session(&state, &p).await?))
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
    let p = match state.store.player_by_name(&name).await? {
        Some(p) => p,
        None => {
            let email = format!(
                "{}@dev.commons.local",
                name.to_lowercase().replace(' ', "_")
            );
            create(&state, email, name, current_year() - 30).await?
        }
    };
    Ok(Json(issue_session(&state, &p).await?))
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
