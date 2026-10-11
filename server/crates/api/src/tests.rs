//! Integration tests against a real Postgres (`TEST_DATABASE_URL`, default
//! the local `commons_test` database). Skipped with a note when unreachable.

use crate::economy::{Catalog, EconError, Op, WELCOME, apply, apply_tx};
use crate::{AppState, internal, store};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use commons_common::token::{self, ServiceClaims};
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

async fn db() -> Option<PgPool> {
    let url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://commons:commons@localhost:5432/commons_test".into());
    let pool = match PgPool::connect(&url).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("skipping database test: {e}");
            return None;
        }
    };
    sqlx::migrate!("../../migrations")
        .run(&pool)
        .await
        .expect("migrations");
    Some(pool)
}

async fn state(db: PgPool, stage_ms: i64) -> Arc<AppState> {
    let catalog = Arc::new(Catalog::load(&db).await.unwrap());
    Arc::new(AppState {
        secret: b"test-secret".to_vec(),
        dev: true,
        client_url: String::new(),
        store: store::Store::new(db.clone()),
        db,
        catalog,
        stage_ms,
    })
}

/// A fresh player with the welcome package.
async fn player(state: &AppState) -> Uuid {
    let name = format!("t{}", &Uuid::new_v4().simple().to_string()[..12]);
    let catalog = state.catalog.clone();
    let p = state
        .store
        .create_player(
            &format!("{name}@test.local"),
            &name,
            1990,
            7,
            move |conn, id| {
                Box::pin(async move {
                    let ops: Vec<Op> = WELCOME
                        .iter()
                        .map(|&(item, delta)| Op { item, delta })
                        .collect();
                    apply(
                        conn,
                        &catalog,
                        id,
                        &ops,
                        "welcome",
                        &format!("welcome:{id}"),
                    )
                    .await?;
                    Ok(())
                })
            },
        )
        .await
        .unwrap()
        .unwrap();
    Uuid::parse_str(&p.id).unwrap()
}

async fn ledger_rows(db: &PgPool, key: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM economy_ledger WHERE idempotency_key LIKE $1")
        .bind(format!("{key}#%"))
        .fetch_one(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn trades_are_idempotent_and_atomic() {
    let Some(db) = db().await else { return };
    let s = state(db.clone(), 1000).await;
    let p = player(&s).await;
    let buy_chair = [
        Op {
            item: 1,
            delta: -60,
        },
        Op {
            item: 400,
            delta: 1,
        },
    ];

    let first = apply_tx(
        &s.db,
        &s.catalog,
        p,
        &buy_chair,
        "test",
        &format!("t:{p}:a"),
    )
    .await
    .unwrap();
    assert!(!first.duplicate);
    assert_eq!(first.totals, vec![(1, 40), (400, 1)]);
    let again = apply_tx(
        &s.db,
        &s.catalog,
        p,
        &buy_chair,
        "test",
        &format!("t:{p}:a"),
    )
    .await
    .unwrap();
    assert!(again.duplicate);
    assert_eq!(
        again.totals,
        vec![(1, 40), (400, 1)],
        "a retry changes nothing"
    );

    // 40 coins can't buy another chair; nothing of the attempt remains.
    let poor = apply_tx(
        &s.db,
        &s.catalog,
        p,
        &buy_chair,
        "test",
        &format!("t:{p}:b"),
    )
    .await;
    assert!(matches!(poor, Err(EconError::Insufficient(1))));
    assert_eq!(ledger_rows(&db, &format!("t:{p}:b")).await, 0);

    // Album: first catch is "first", the second isn't.
    let c1 = apply_tx(
        &s.db,
        &s.catalog,
        p,
        &[Op {
            item: 105,
            delta: 1,
        }],
        "test",
        &format!("t:{p}:c"),
    )
    .await
    .unwrap();
    let c2 = apply_tx(
        &s.db,
        &s.catalog,
        p,
        &[Op {
            item: 105,
            delta: 1,
        }],
        "test",
        &format!("t:{p}:d"),
    )
    .await
    .unwrap();
    assert_eq!((c1.firsts, c2.firsts), (vec![105], vec![]));
}

#[tokio::test]
async fn concurrent_duplicates_grant_once() {
    let Some(db) = db().await else { return };
    let s = state(db.clone(), 1000).await;
    let p = player(&s).await;
    let key = format!("t:{p}:race");
    let tasks: Vec<_> = (0..8)
        .map(|_| {
            let (s, key) = (s.clone(), key.clone());
            tokio::spawn(async move {
                apply_tx(
                    &s.db,
                    &s.catalog,
                    p,
                    &[Op { item: 1, delta: 10 }],
                    "test",
                    &key,
                )
                .await
            })
        })
        .collect();
    let mut fresh = 0;
    for t in tasks {
        if !t.await.unwrap().unwrap().duplicate {
            fresh += 1;
        }
    }
    assert_eq!(fresh, 1);
    let coins: i32 =
        sqlx::query_scalar("SELECT qty FROM inventory WHERE player_id = $1 AND item_id = 1")
            .bind(p)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(coins, 110);
}

async fn call(
    s: &Arc<AppState>,
    path: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let auth = token::sign(&s.secret, &ServiceClaims { svc: "test".into() }, 60);
    let req = Request::post(path)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {auth}"))
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = internal::routes()
        .with_state(s.clone())
        .oneshot(req)
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn garden_plant_water_harvest() {
    let Some(db) = db().await else { return };
    let s = state(db.clone(), 20).await; // 20 ms per stage
    let p = player(&s).await;
    let space = format!("test:{p}");
    let plot = |extra: serde_json::Value| {
        let mut v = serde_json::json!({ "space": space, "x": 1, "y": 1, "player": p.to_string() });
        v.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        v
    };

    let (st, r) = call(
        &s,
        "/plots/plant",
        plot(serde_json::json!({ "seed": 200, "key": format!("{p}:plant") })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(
        r["applied"]["totals"][0],
        serde_json::json!([200, 2]),
        "one of three seeds used"
    );
    let (st, _) = call(
        &s,
        "/plots/plant",
        plot(serde_json::json!({ "seed": 200, "key": format!("{p}:plant2") })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "plot is occupied");

    let (st, _) = call(
        &s,
        "/plots/harvest",
        plot(serde_json::json!({ "key": format!("{p}:h0") })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "not ripe yet");
    // Three stages, each needing water.
    for _ in 0..3 {
        let (st, r) = call(&s, "/plots/water", plot(serde_json::json!({}))).await;
        assert_eq!(st, StatusCode::OK, "{r}");
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
    let key = format!("{p}:h1");
    let (st, r) = call(
        &s,
        "/plots/harvest",
        plot(serde_json::json!({ "key": key })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let tulips = r["applied"]["added"][0].clone();
    assert_eq!(tulips[0], 300);
    assert!((2..=3).contains(&tulips[1].as_i64().unwrap()));
    assert_eq!(r["applied"]["firsts"][0], 300, "a new album entry");
    let (st, r) = call(
        &s,
        "/plots/harvest",
        plot(serde_json::json!({ "key": key })),
    )
    .await;
    assert_eq!(
        (st, r["applied"]["duplicate"].clone()),
        (StatusCode::OK, serde_json::json!(true))
    );
}

#[tokio::test]
async fn home_place_and_pickup() {
    let Some(db) = db().await else { return };
    let s = state(db.clone(), 1000).await;
    let p = player(&s).await;
    let owner = p.to_string();
    let (st, _) = call(&s, "/home/place", serde_json::json!({ "owner": owner, "item": 400, "x": 3, "y": 3, "key": format!("{p}:p0") })).await;
    assert_eq!(st, StatusCode::CONFLICT, "no chair owned yet");
    apply_tx(
        &s.db,
        &s.catalog,
        p,
        &[Op {
            item: 400,
            delta: 1,
        }],
        "test",
        &format!("{p}:give"),
    )
    .await
    .unwrap();
    let (st, r) = call(&s, "/home/place", serde_json::json!({ "owner": owner, "item": 400, "x": 3, "y": 3, "key": format!("{p}:p1") })).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["totals"][0], serde_json::json!([400, 0]));
    let (st, r) = call(
        &s,
        "/home/pickup",
        serde_json::json!({ "owner": owner, "x": 3, "y": 3, "key": format!("{p}:u1") }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["totals"][0], serde_json::json!([400, 1]));
}
