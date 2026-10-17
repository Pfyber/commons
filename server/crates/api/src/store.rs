//! Account storage in Postgres (`accounts`, `players`, `magic_links`,
//! `refresh_tokens`). Tokens are stored as SHA-256 hashes only.

use crate::error::{ApiError, ApiResult};
use commons_common::token::TrustTier;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Player {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub birth_year: i32,
    pub look: u32,
    /// What they wear from the mall (outfit, hat, accessory, skin codes).
    pub style: u32,
    pub trust_tier: TrustTier,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CreateError {
    NameTaken,
    EmailTaken,
}

pub fn hash_token(t: &str) -> String {
    Sha256::digest(t.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn tier_from(s: &str) -> TrustTier {
    match s {
        "newcomer" => TrustTier::Newcomer,
        "resident" => TrustTier::Resident,
        "steward" => TrustTier::Steward,
        _ => TrustTier::Visitor,
    }
}

pub fn db_err(e: sqlx::Error) -> ApiError {
    tracing::error!(error = %e, "database error");
    ApiError::new(
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal",
        "Something went wrong on our side.",
    )
}

const PLAYER_COLS: &str = "p.id, a.email, p.display_name, a.birth_year, \
    COALESCE((p.avatar->>'look')::bigint, 0) AS look, \
    COALESCE((p.avatar->>'style')::bigint, 0) AS style, p.trust_tier::text AS tier";

fn player_from(row: &sqlx::postgres::PgRow) -> Player {
    Player {
        id: row.get::<Uuid, _>("id").to_string(),
        email: row.get("email"),
        display_name: row.get("display_name"),
        birth_year: row.get::<i16, _>("birth_year") as i32,
        look: row.get::<i64, _>("look") as u32,
        style: row.get::<i64, _>("style") as u32,
        trust_tier: tier_from(row.get::<&str, _>("tier")),
    }
}

pub struct Store {
    pub db: PgPool,
    /// Per-email cooldown for magic links; in memory is fine for a rate limit.
    last_link_sent: Mutex<HashMap<String, u64>>,
}

impl Store {
    pub fn new(db: PgPool) -> Self {
        Store {
            db,
            last_link_sent: Mutex::new(HashMap::new()),
        }
    }

    /// Records a link request; returns false if one was sent too recently.
    pub fn allow_link(&self, email: &str, now: u64, min_gap: u64) -> bool {
        let mut s = self.last_link_sent.lock().unwrap();
        match s.get(email) {
            Some(&t) if now < t + min_gap => false,
            _ => {
                s.insert(email.to_string(), now);
                true
            }
        }
    }

    pub async fn put_magic(&self, token: &str, email: &str, expires_unix: u64) -> ApiResult<()> {
        sqlx::query("DELETE FROM magic_links WHERE expires_at < now() - interval '1 day'")
            .execute(&self.db)
            .await
            .map_err(db_err)?;
        sqlx::query("INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, to_timestamp($3))")
            .bind(hash_token(token))
            .bind(email)
            .bind(expires_unix as f64)
            .execute(&self.db)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    /// Single use: the link is consumed whether or not it has expired.
    pub async fn take_magic(&self, token: &str) -> ApiResult<Option<String>> {
        let row = sqlx::query(
            "DELETE FROM magic_links WHERE token_hash = $1 RETURNING email, expires_at > now() AS valid",
        )
        .bind(hash_token(token))
        .fetch_optional(&self.db)
        .await
        .map_err(db_err)?;
        Ok(row
            .filter(|r| r.get::<bool, _>("valid"))
            .map(|r| r.get("email")))
    }

    async fn player_where(&self, cond: &str, arg: &str) -> ApiResult<Option<Player>> {
        let sql = format!(
            "SELECT {PLAYER_COLS} FROM players p JOIN accounts a ON a.id = p.account_id WHERE {cond}"
        );
        let row = sqlx::query(&sql)
            .bind(arg)
            .fetch_optional(&self.db)
            .await
            .map_err(db_err)?;
        Ok(row.as_ref().map(player_from))
    }

    pub async fn player_by_email(&self, email: &str) -> ApiResult<Option<Player>> {
        self.player_where("a.email = $1", email).await
    }

    pub async fn player_by_name(&self, name: &str) -> ApiResult<Option<Player>> {
        self.player_where("lower(p.display_name) = lower($1)", name)
            .await
    }

    pub async fn player(&self, id: &str) -> ApiResult<Option<Player>> {
        if Uuid::parse_str(id).is_err() {
            return Ok(None);
        }
        self.player_where("p.id = $1::uuid", id).await
    }

    /// Creates the account and player in one transaction; `welcome` runs in
    /// the same transaction (starting coins and seeds).
    pub async fn create_player<F>(
        &self,
        email: &str,
        name: &str,
        birth_year: i32,
        look: u32,
        welcome: F,
    ) -> ApiResult<Result<Player, CreateError>>
    where
        F: for<'c> FnOnce(
            &'c mut sqlx::PgConnection,
            Uuid,
        ) -> futures_util::future::BoxFuture<'c, ApiResult<()>>,
    {
        let mut tx = self.db.begin().await.map_err(db_err)?;
        let account: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
            "INSERT INTO accounts (email, birth_year) VALUES ($1, $2) RETURNING id",
        )
        .bind(email)
        .bind(birth_year as i16)
        .fetch_one(&mut *tx)
        .await;
        let account = match account {
            Ok(id) => id,
            Err(e) if is_unique_violation(&e) => return Ok(Err(CreateError::EmailTaken)),
            Err(e) => return Err(db_err(e)),
        };
        let player: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
            "INSERT INTO players (account_id, display_name, avatar) VALUES ($1, $2, jsonb_build_object('look', $3::bigint)) RETURNING id",
        )
        .bind(account)
        .bind(name)
        .bind(look as i64)
        .fetch_one(&mut *tx)
        .await;
        let player = match player {
            Ok(id) => id,
            Err(e) if is_unique_violation(&e) => return Ok(Err(CreateError::NameTaken)),
            Err(e) => return Err(db_err(e)),
        };
        welcome(&mut tx, player).await?;
        tx.commit().await.map_err(db_err)?;
        Ok(Ok(Player {
            id: player.to_string(),
            email: email.to_string(),
            display_name: name.to_string(),
            birth_year,
            look,
            style: 0,
            trust_tier: TrustTier::Visitor,
        }))
    }

    pub async fn put_refresh(
        &self,
        token: &str,
        player_id: &str,
        expires_unix: u64,
    ) -> ApiResult<()> {
        sqlx::query("INSERT INTO refresh_tokens (token_hash, player_id, expires_at) VALUES ($1, $2::uuid, to_timestamp($3))")
            .bind(hash_token(token))
            .bind(player_id)
            .bind(expires_unix as f64)
            .execute(&self.db)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    /// Consumes a refresh token (rotation): each one works exactly once.
    pub async fn take_refresh(&self, token: &str) -> ApiResult<Option<String>> {
        let row = sqlx::query(
            "DELETE FROM refresh_tokens WHERE token_hash = $1 RETURNING player_id, expires_at > now() AS valid",
        )
        .bind(hash_token(token))
        .fetch_optional(&self.db)
        .await
        .map_err(db_err)?;
        Ok(row
            .filter(|r| r.get::<bool, _>("valid"))
            .map(|r| r.get::<Uuid, _>("player_id").to_string()))
    }
}

pub fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23505")
}
