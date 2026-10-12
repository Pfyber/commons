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

// ---- town life ------------------------------------------------------------------

mod town_life {
    use super::*;
    use crate::town::{self, STREET_AUTHORS};
    use axum::Router;
    use serde_json::{Value, json};

    fn app(s: Arc<AppState>) -> Router {
        Router::new().nest("/api", town::routes()).with_state(s)
    }

    fn bearer_for(s: &AppState, id: Uuid, name: &str) -> String {
        let claims = token::AccessClaims {
            sub: id.to_string(),
            name: name.into(),
            look: 1,
            tier: token::TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        format!(
            "Bearer {}",
            token::sign(&s.secret, &claims, token::ACCESS_TTL_SECS)
        )
    }

    async fn call(
        app: &Router,
        auth: &str,
        method: &str,
        uri: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", auth)
            .header("content-type", "application/json")
            .body(if method == "GET" {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[test]
    fn hashtags_are_normalised_and_capped() {
        assert_eq!(
            town::hashtags("Ride on Sunday? #Cycling #gravel, #cycling #x #mtb-trails #four"),
            vec!["cycling", "gravel", "mtb-trails"]
        );
        assert!(town::hashtags("no tags # here").is_empty());
        assert_eq!(
            town::clean_post("  hello\n\n  park  ").as_deref(),
            Some("hello park")
        );
        assert_eq!(town::clean_post("   "), None);
    }

    #[tokio::test]
    async fn quarters_boards_and_streets() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        let p = player(&s).await;
        let me = bearer_for(&s, p, "Ada");

        // Join two quarters at once; leave one.
        for q in ["sports", "art"] {
            let uri = format!("/api/town/quarters/{q}/join");
            let (st, _) = call(&app, &me, "POST", &uri, json!({})).await;
            assert_eq!(st, StatusCode::OK);
        }
        call(&app, &me, "POST", "/api/town/quarters/art/leave", json!({})).await;
        let (_, qs) = call(&app, &me, "GET", "/api/town/quarters", Value::Null).await;
        let joined: Vec<&str> = qs
            .as_array()
            .unwrap()
            .iter()
            .filter(|q| q["joined"] == true)
            .map(|q| q["slug"].as_str().unwrap())
            .collect();
        assert_eq!(joined, vec!["sports"]);
        let (st, _) = call(&app, &me, "POST", "/api/town/quarters/nope/join", json!({})).await;
        assert_eq!(st, StatusCode::NOT_FOUND);

        // Posting picks up tags and joins the quarter; posting again at once
        // is too soon.
        let tag = format!("t{}", &Uuid::new_v4().simple().to_string()[..8]);
        let board = "/api/town/quarters/music/board";
        let (st, r) = call(
            &app,
            &me,
            "POST",
            board,
            json!({ "body": format!("open mic tonight? #{tag}") }),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{r}");
        assert_eq!(r["tags"], json!([tag]));
        let (st, _) = call(&app, &me, "POST", board, json!({ "body": "again" })).await;
        assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);

        // Enough different people using the tag: a street is forming.
        for i in 1..STREET_AUTHORS {
            let other = player(&s).await;
            let auth = bearer_for(&s, other, &format!("P{i}"));
            let (st, _) = call(
                &app,
                &auth,
                "POST",
                board,
                json!({ "body": format!("me too #{tag}") }),
            )
            .await;
            assert_eq!(st, StatusCode::OK);
        }
        let (_, b) = call(&app, &me, "GET", &format!("{board}?tag={tag}"), Value::Null).await;
        assert_eq!(b["posts"].as_array().unwrap().len() as i64, STREET_AUTHORS);
        let t = b["tags"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["tag"] == tag.as_str())
            .unwrap();
        assert_eq!(t["authors"], STREET_AUTHORS);
        assert_eq!(t["forming"], true);
    }

    #[tokio::test]
    async fn donations_fill_a_goal_exactly_once() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let p = player(&s).await; // 100 coins
        let key = format!("test_{}", Uuid::new_v4().simple());
        let goal: i32 = sqlx::query_scalar(
            "INSERT INTO town_goals (key, title, blurb, target, seq)
             VALUES ($1, 'Test', 'Test', 50, (SELECT coalesce(max(seq), 0) + 100 FROM town_goals)) RETURNING id",
        )
        .bind(&key)
        .fetch_one(&db)
        .await
        .unwrap();

        let d = town::donate_to(&s, goal, p, 30, "a").await.unwrap();
        assert_eq!(
            d,
            town::Donated {
                accepted: 30,
                completed: false
            }
        );
        // A retry of the same press changes nothing.
        let again = town::donate_to(&s, goal, p, 30, "a").await.unwrap();
        assert_eq!(again.accepted, 0);
        // Only the 20 still needed are taken, and the goal completes.
        let d = town::donate_to(&s, goal, p, 40, "b").await.unwrap();
        assert_eq!(
            d,
            town::Donated {
                accepted: 20,
                completed: true
            }
        );
        let mut conn = db.acquire().await.unwrap();
        let coins = crate::economy::totals(&mut conn, p, &[1]).await.unwrap();
        assert_eq!(coins, vec![(1, 50)]);
        assert!(
            town::donate_to(&s, goal, p, 5, "c").await.is_err(),
            "a reached goal takes nothing"
        );
        sqlx::query("DELETE FROM town_goals WHERE id = $1")
            .bind(goal)
            .execute(&db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn daily_requests_are_stable_and_done_once() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let a = town::requests_for(&s.catalog, "2026-10-12");
        assert_eq!(a.len(), town::REQUESTS_PER_DAY);
        assert_eq!(
            a,
            town::requests_for(&s.catalog, "2026-10-12"),
            "same day, same requests"
        );
        assert_ne!(a, town::requests_for(&s.catalog, "2026-10-13"));
        let mut items: Vec<i32> = a.iter().map(|r| r.item).collect();
        items.sort();
        items.dedup();
        assert_eq!(items.len(), a.len(), "no repeats within a day");

        // Delivering: without the goods it fails; with them it pays, once.
        let app = app(s.clone());
        let p = player(&s).await;
        let me = bearer_for(&s, p, "Bo");
        let (_, list) = call(&app, &me, "GET", "/api/town/requests", Value::Null).await;
        let r = list["requests"][0].clone();
        assert_eq!(r["done"], false);
        let deliver = "/api/town/requests/0/deliver";
        let (st, _) = call(&app, &me, "POST", deliver, json!({})).await;
        assert_eq!(st, StatusCode::CONFLICT, "nothing to deliver yet");
        let item = r["item"].as_i64().unwrap() as i32;
        let qty = r["qty"].as_i64().unwrap() as i32;
        apply_tx(
            &s.db,
            &s.catalog,
            p,
            &[Op { item, delta: qty }],
            "test",
            &format!("t:{p}:goods"),
        )
        .await
        .unwrap();
        let (st, applied) = call(&app, &me, "POST", deliver, json!({})).await;
        assert_eq!(st, StatusCode::OK);
        let coins = applied["totals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t[0] == 1)
            .unwrap()[1]
            .as_i64()
            .unwrap();
        assert_eq!(coins, 100 + r["reward"].as_i64().unwrap());
        let (st, _) = call(&app, &me, "POST", deliver, json!({})).await;
        assert_eq!(st, StatusCode::CONFLICT, "only once a day");
        let (_, list) = call(&app, &me, "GET", "/api/town/requests", Value::Null).await;
        assert_eq!(list["requests"][0]["done"], true);
    }
}

// ---- corner activities: easels, gallery, town word ----------------------------------

mod corner_play {
    use super::*;
    use crate::play;
    use axum::Router;
    use serde_json::{Value, json};

    fn app(s: Arc<AppState>) -> Router {
        Router::new().nest("/api", play::routes()).with_state(s)
    }

    fn bearer_for(s: &AppState, id: Uuid, name: &str) -> String {
        let claims = token::AccessClaims {
            sub: id.to_string(),
            name: name.into(),
            look: 1,
            tier: token::TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        format!(
            "Bearer {}",
            token::sign(&s.secret, &claims, token::ACCESS_TTL_SECS)
        )
    }

    async fn call(
        app: &Router,
        auth: &str,
        method: &str,
        uri: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", auth)
            .header("content-type", "application/json")
            .body(if method == "GET" {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[test]
    fn word_marks_follow_the_classic_rules() {
        assert_eq!(play::marks("bench", "bench"), "ggggg");
        assert_eq!(play::marks("bench", "chess"), "yyy..");
        // A repeated letter only counts as often as it's in the word.
        assert_eq!(play::marks("apple", "paper"), "yygy.");
        assert_eq!(play::marks("lemon", "level"), "gg...");
        for w in play::WORDS {
            assert!(
                w.len() == 5 && w.bytes().all(|b| b.is_ascii_lowercase()),
                "{w}"
            );
        }
        assert_eq!(play::word_for("2026-10-12"), play::word_for("2026-10-12"));
    }

    #[tokio::test]
    async fn painting_together_and_hanging_it() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        let (a, b) = (player(&s).await, player(&s).await);
        let (ta, tb) = (bearer_for(&s, a, "Ana"), bearer_for(&s, b, "Ben"));
        let easel = "/api/play/easels/2";
        // Start from a clean easel (other tests and people share it).
        sqlx::query("UPDATE easels SET cells = decode(repeat('00', 256), 'hex') WHERE id = 2")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("DELETE FROM easel_painters WHERE easel = 2")
            .execute(&db)
            .await
            .unwrap();

        let stroke = |from: u16, color: u8| json!({ "cells": (from..from + 16).map(|c| (c, color)).collect::<Vec<_>>() });
        let (st, _) = call(&app, &ta, "POST", &format!("{easel}/paint"), stroke(0, 3)).await;
        assert_eq!(st, StatusCode::OK);
        let (st, _) = call(
            &app,
            &ta,
            "POST",
            "/api/play/easels/2/hang",
            json!({ "title": "Too soon" }),
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT, "16 cells aren't enough to hang");
        call(&app, &tb, "POST", &format!("{easel}/paint"), stroke(16, 5)).await;
        let (st, _) = call(
            &app,
            &tb,
            "POST",
            &format!("{easel}/paint"),
            json!({ "cells": [[300, 1]] }),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST);

        let (_, e) = call(&app, &ta, "GET", easel, Value::Null).await;
        assert_eq!(e["cells"][0], 3);
        assert_eq!(e["cells"][16], 5);
        assert_eq!(e["painters"], json!(["Ana", "Ben"]));

        let title = format!("Sunrise {}", &Uuid::new_v4().simple().to_string()[..6]);
        let (st, r) = call(
            &app,
            &tb,
            "POST",
            &format!("{easel}/hang"),
            json!({ "title": title }),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{r}");
        assert_eq!(r["painters"], json!(["Ana", "Ben"]));
        let (_, e) = call(&app, &ta, "GET", easel, Value::Null).await;
        assert!(
            e["cells"].as_array().unwrap().iter().all(|c| c == 0),
            "wiped for the next painting"
        );
        let (_, g) = call(&app, &ta, "GET", "/api/play/gallery", Value::Null).await;
        let hung = g
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["title"] == title.as_str())
            .unwrap();
        assert_eq!(hung["hung_by"], "Ben");
        assert_eq!(hung["cells"][16], 5);
    }

    #[tokio::test]
    async fn the_town_solves_the_word_together() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        sqlx::query("DELETE FROM word_guesses WHERE day = (now() AT TIME ZONE 'utc')::date")
            .execute(&db)
            .await
            .unwrap();
        let answer = play::word_for(&chrono::Utc::now().date_naive().to_string());
        let wrong = if answer == "zebra" { "apple" } else { "zebra" };
        let (a, b) = (player(&s).await, player(&s).await);
        let (ta, tb) = (bearer_for(&s, a, "Ana"), bearer_for(&s, b, "Ben"));

        let (st, r) = call(
            &app,
            &ta,
            "POST",
            "/api/play/word/guess",
            json!({ "guess": wrong }),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{r}");
        assert_eq!(r["won"], false);
        assert_eq!(r["marks"], json!(play::marks(answer, wrong)));
        let (st, _) = call(
            &app,
            &ta,
            "POST",
            "/api/play/word/guess",
            json!({ "guess": "abcd" }),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (st, _) = call(
            &app,
            &ta,
            "POST",
            "/api/play/word/guess",
            json!({ "guess": wrong }),
        )
        .await;
        assert_eq!(
            st,
            StatusCode::TOO_MANY_REQUESTS,
            "a moment between guesses"
        );

        // Ben sees Ana's guess, then solves it: both are rewarded.
        let (_, v) = call(&app, &tb, "GET", "/api/play/word", Value::Null).await;
        assert_eq!(v["guesses"][0]["name"], "Ana");
        assert_eq!(v["answer"], Value::Null, "not revealed while unsolved");
        let (st, r) = call(
            &app,
            &tb,
            "POST",
            "/api/play/word/guess",
            json!({ "guess": answer.to_uppercase() }),
        )
        .await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(r["won"], true);
        assert_eq!(r["solved_by"], "Ben");
        assert_eq!(r["answer"], answer);
        let mut conn = db.acquire().await.unwrap();
        let ana = crate::economy::totals(&mut conn, a, &[1]).await.unwrap();
        assert_eq!(ana, vec![(1, 100 + play::HELPER_REWARD)]);
        let ben = crate::economy::totals(&mut conn, b, &[1]).await.unwrap();
        assert_eq!(
            ben,
            vec![(1, 100 + play::HELPER_REWARD + play::SOLVER_REWARD)]
        );
        let (st, _) = call(
            &app,
            &ta,
            "POST",
            "/api/play/word/guess",
            json!({ "guess": "zzzzz" }),
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT, "solved for today");
    }
}

// ---- governance -------------------------------------------------------------------------

mod governance {
    use super::*;
    use crate::gov;
    use axum::Router;
    use serde_json::{Value, json};

    fn app(s: Arc<AppState>) -> Router {
        Router::new()
            .nest("/api", gov::routes())
            .nest("/internal", internal::routes())
            .with_state(s)
    }

    fn bearer_for(s: &AppState, id: Uuid, name: &str) -> String {
        let claims = token::AccessClaims {
            sub: id.to_string(),
            name: name.into(),
            look: 1,
            tier: token::TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        format!(
            "Bearer {}",
            token::sign(&s.secret, &claims, token::ACCESS_TTL_SECS)
        )
    }

    async fn call(
        app: &Router,
        auth: &str,
        method: &str,
        uri: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", auth)
            .header("content-type", "application/json")
            .body(if method == "GET" {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// Gives a player `n` active days (in the past, so today stays clear).
    async fn active(db: &PgPool, p: Uuid, n: i64) {
        sqlx::query(
            "INSERT INTO activity_days (player_id, day, seconds, interactions)
             SELECT $1, (now() AT TIME ZONE 'utc')::date - g, 900, 5 FROM generate_series(1, $2) g
             ON CONFLICT DO NOTHING",
        )
        .bind(p)
        .bind(n as i32)
        .execute(db)
        .await
        .unwrap();
    }

    /// The dev Caretaker account (`caretaker@dev.commons.local`).
    async fn caretaker(s: &AppState) -> Uuid {
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT p.id FROM players p JOIN accounts a ON a.id = p.account_id WHERE a.email = 'caretaker@dev.commons.local'",
        )
        .fetch_optional(&s.db)
        .await
        .unwrap();
        if let Some(id) = existing {
            return id;
        }
        let name = format!("Caretaker{}", &Uuid::new_v4().simple().to_string()[..6]);
        let made = s
            .store
            .create_player("caretaker@dev.commons.local", &name, 1980, 7, |_, _| {
                Box::pin(async { Ok(()) })
            })
            .await;
        match made {
            Ok(Ok(p)) => Uuid::parse_str(&p.id).unwrap(),
            // Another test made it at the same moment.
            _ => sqlx::query_scalar(
                "SELECT p.id FROM players p JOIN accounts a ON a.id = p.account_id WHERE a.email = 'caretaker@dev.commons.local'",
            )
            .fetch_one(&s.db)
            .await
            .unwrap(),
        }
    }

    /// Ends the proposal's current stage (Caretaker tool) and checks status.
    async fn advance(app: &Router, ct: &str, id: i64, expect: &str) -> Value {
        let (st, r) = call(
            app,
            ct,
            "POST",
            &format!("/api/gov/proposals/{id}/advance"),
            json!({}),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{r}");
        let (_, d) = call(
            app,
            ct,
            "GET",
            &format!("/api/gov/proposals/{id}"),
            Value::Null,
        )
        .await;
        assert_eq!(d["status"], expect, "{d}");
        d
    }

    /// Open proposals left by earlier runs would otherwise linger.
    async fn no_quorum(db: &PgPool, id: i64) {
        sqlx::query("UPDATE proposals SET quorum = 0 WHERE id = $1")
            .bind(id)
            .execute(db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn activity_becomes_tiers_and_zone_reports_add_up() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        let p = player(&s).await;
        assert_eq!(
            gov::refresh_tier(&db, p).await.unwrap(),
            token::TrustTier::Visitor
        );
        // Short visits don't make active days.
        sqlx::query("INSERT INTO activity_days (player_id, day, seconds, interactions) VALUES ($1, current_date - 30, 120, 9)")
            .bind(p)
            .execute(&db)
            .await
            .unwrap();
        active(&db, p, 7).await;
        assert_eq!(
            gov::refresh_tier(&db, p).await.unwrap(),
            token::TrustTier::Resident
        );

        // A zone server reports a minute and two interactions.
        let svc = format!(
            "Bearer {}",
            token::sign(&s.secret, &ServiceClaims { svc: "zone".into() }, 60)
        );
        for _ in 0..2 {
            let (st, _) = call(
                &app,
                &svc,
                "POST",
                "/internal/activity",
                json!({ "rows": [{ "player": p.to_string(), "secs": 60, "interactions": 2 }] }),
            )
            .await;
            assert_eq!(st, StatusCode::OK);
        }
        let (secs, n): (i32, i32) = sqlx::query_as(
            "SELECT seconds, interactions FROM activity_days WHERE player_id = $1 AND day = (now() AT TIME ZONE 'utc')::date",
        )
        .bind(p)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!((secs, n), (120, 4));
        let player_auth = bearer_for(&s, p, "P");
        let (st, _) = call(
            &app,
            &player_auth,
            "POST",
            "/internal/activity",
            json!({ "rows": [] }),
        )
        .await;
        assert_eq!(
            st,
            StatusCode::UNAUTHORIZED,
            "players can't report activity"
        );
    }

    #[tokio::test]
    async fn the_founders_name_the_town_by_ranked_choice() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        let ct = bearer_for(&s, caretaker(&s).await, "Caretaker");
        let mut founders = vec![];
        for i in 0..4 {
            let p = player(&s).await;
            active(&db, p, 3).await;
            founders.push((p, bearer_for(&s, p, &format!("F{i}"))));
        }
        let fresh = player(&s).await;
        let fresh_auth = bearer_for(&s, fresh, "New");

        // Only the Caretaker opens founding votes.
        let (st, _) = call(
            &app,
            &founders[0].1,
            "POST",
            "/api/gov/proposals",
            json!({ "kind": "town_name", "title": "Name the town", "collect": true }),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, r) = call(&app, &ct, "POST", "/api/gov/proposals", json!({ "kind": "town_name", "title": "Name the town", "body": "What should we be called?", "collect": true })).await;
        assert_eq!(st, StatusCode::OK, "{r}");
        let id = r["id"].as_i64().unwrap();
        no_quorum(&db, id).await;

        // Suggestions: founders suggest and support; a newcomer can't.
        let tag = &Uuid::new_v4().simple().to_string()[..5];
        let names = [
            format!("Willowmere{tag}"),
            format!("Lanternfield{tag}"),
            format!("Brookhaven{tag}"),
        ];
        let mut sids = vec![];
        for (k, name) in names.iter().enumerate() {
            let (st, r) = call(
                &app,
                &founders[k].1,
                "POST",
                &format!("/api/gov/proposals/{id}/suggest"),
                json!({ "text": name }),
            )
            .await;
            assert_eq!(st, StatusCode::OK, "{r}");
            sids.push(r["id"].as_i64().unwrap());
        }
        let (st, _) = call(
            &app,
            &founders[0].1,
            "POST",
            &format!("/api/gov/proposals/{id}/suggest"),
            json!({ "text": "Another" }),
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT, "one suggestion each");
        let (st, _) = call(
            &app,
            &fresh_auth,
            "POST",
            &format!("/api/gov/proposals/{id}/suggest"),
            json!({ "text": "Newtown" }),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "founding votes need active days");
        call(
            &app,
            &founders[3].1,
            "POST",
            &format!("/api/gov/proposals/{id}/support/{}", sids[1]),
            json!({}),
        )
        .await;

        // Voting: the best-supported suggestion is listed first.
        let d = advance(&app, &ct, id, "voting").await;
        let options: Vec<String> = serde_json::from_value(d["options"].clone()).unwrap();
        assert_eq!(options[0], names[1]);
        let idx = |n: &str| options.iter().position(|o| o == n).unwrap();
        let (w, l, b) = (idx(&names[0]), idx(&names[1]), idx(&names[2]));
        // First preferences: W 2, L 1, B 1. B's voter ranks L second, and
        // so does one W voter... but W keeps its 2, L gets 2: tie broken by
        // order. Make it decisive: B's voter → L, giving L 2 vs W 2 after
        // B goes; then the fourth ballot decides.
        let ballots = [vec![l, w], vec![w, l], vec![b, l], vec![l]];
        for ((_, auth), ranking) in founders.iter().zip(ballots.iter()) {
            let (st, r) = call(
                &app,
                auth,
                "POST",
                &format!("/api/gov/proposals/{id}/vote"),
                json!({ "ranking": ranking }),
            )
            .await;
            assert_eq!(st, StatusCode::OK, "{r}");
        }
        let (st, _) = call(
            &app,
            &founders[0].1,
            "POST",
            &format!("/api/gov/proposals/{id}/vote"),
            json!({ "ranking": [w] }),
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT, "one vote each");
        let (st, _) = call(
            &app,
            &fresh_auth,
            "POST",
            &format!("/api/gov/proposals/{id}/vote"),
            json!({ "ranking": [w] }),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, _) = call(
            &app,
            &ct,
            "POST",
            &format!("/api/gov/proposals/{id}/vote"),
            json!({ "ranking": [w, w] }),
        )
        .await;
        assert!(
            st == StatusCode::BAD_REQUEST || st == StatusCode::FORBIDDEN,
            "repeated options are refused"
        );

        // Ballots are secret: nothing links a ballot to its voter.
        let cols: Vec<String> = sqlx::query_scalar("SELECT column_name::text FROM information_schema.columns WHERE table_name = 'proposal_ballots'")
            .fetch_all(&db)
            .await
            .unwrap();
        assert!(!cols.iter().any(|c| c.contains("voter")), "{cols:?}");

        let d = advance(&app, &ct, id, "passed").await;
        assert_eq!(d["result"]["winner_text"], names[1].as_str(), "{d}");
        let (_, story) = call(&app, &fresh_auth, "GET", "/api/gov/story", Value::Null).await;
        assert_eq!(story["name"], names[1].as_str());
        assert_eq!(story["me"]["can_vote_founding"], false);
        let (_, ledger) = call(&app, &fresh_auth, "GET", "/api/gov/ledger", Value::Null).await;
        assert!(
            ledger
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["summary"].as_str().unwrap().contains(&names[1]))
        );

        // The ledger can't be rewritten.
        let r = sqlx::query("UPDATE governance_ledger SET summary = 'nothing happened' WHERE id = (SELECT max(id) FROM governance_ledger)")
            .execute(&db)
            .await;
        assert!(r.is_err(), "append-only");
    }

    #[tokio::test]
    async fn rules_need_sixty_percent_and_the_bridge_opens_a_pool() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        let ct = bearer_for(&s, caretaker(&s).await, "Caretaker");
        let mut voters = vec![];
        for i in 0..5 {
            let p = player(&s).await;
            active(&db, p, 8).await;
            voters.push(bearer_for(&s, p, &format!("V{i}")));
        }
        // In the founding phase residents can't propose yet.
        let (st, _) = call(
            &app,
            &voters[0],
            "POST",
            "/api/gov/proposals",
            json!({ "kind": "town_rule", "title": "No running on the plaza" }),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN);

        // A town rule at exactly 60% passes; at 40% it doesn't.
        for (yes, expect) in [(3, "passed"), (2, "failed")] {
            let (_, r) = call(&app, &ct, "POST", "/api/gov/proposals", json!({ "kind": "town_rule", "title": "Quiet hours after midnight", "body": "Be gentle." })).await;
            let id = r["id"].as_i64().unwrap();
            no_quorum(&db, id).await;
            advance(&app, &ct, id, "voting").await;
            for (k, auth) in voters.iter().enumerate() {
                let choice = if k < yes { 0 } else { 1 };
                call(
                    &app,
                    auth,
                    "POST",
                    &format!("/api/gov/proposals/{id}/vote"),
                    json!({ "ranking": [choice] }),
                )
                .await;
            }
            let d = advance(&app, &ct, id, expect).await;
            assert!(
                (d["result"]["detail"]["share"].as_f64().unwrap() - yes as f64 / 5.0).abs() < 1e-6
            );
        }

        // Beyond the bridge: the winner opens a construction pool.
        let (_, r) = call(
            &app,
            &ct,
            "POST",
            "/api/gov/proposals",
            json!({
                "kind": "bridge", "title": "What lies beyond the bridge?",
                "options": ["A lakeside village", "A wild forest", "A market street"],
            }),
        )
        .await;
        let id = r["id"].as_i64().unwrap();
        no_quorum(&db, id).await;
        advance(&app, &ct, id, "voting").await;
        for auth in &voters {
            call(
                &app,
                auth,
                "POST",
                &format!("/api/gov/proposals/{id}/vote"),
                json!({ "ranking": [1, 0] }),
            )
            .await;
        }
        let d = advance(&app, &ct, id, "passed").await;
        assert_eq!(d["result"]["winner_text"], "A wild forest");
        let title: String = sqlx::query_scalar("SELECT title FROM town_goals WHERE key = $1")
            .bind(format!("bridge_{id}"))
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(title, "Build beyond the bridge: A wild forest");
        sqlx::query("DELETE FROM town_goals WHERE key = $1")
            .bind(format!("bridge_{id}"))
            .execute(&db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn reports_reach_the_caretaker_and_mutes_hold() {
        let Some(db) = db().await else { return };
        let s = state(db.clone(), 1000).await;
        let app = app(s.clone());
        let ct = bearer_for(&s, caretaker(&s).await, "Caretaker");
        let (a, b) = (player(&s).await, player(&s).await);
        active(&db, b, 2).await;
        let (aa, ba) = (bearer_for(&s, a, "Ann"), bearer_for(&s, b, "Bob"));
        let (st, _) = call(&app, &aa, "POST", "/api/gov/report", json!({ "target_id": b.to_string(), "target_name": "Bob", "reason": "harassment", "context": "said mean things" })).await;
        assert_eq!(st, StatusCode::OK);
        let (st, _) = call(&app, &aa, "GET", "/api/gov/reports", Value::Null).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "only the Caretaker sees reports");
        let (_, list) = call(&app, &ct, "GET", "/api/gov/reports", Value::Null).await;
        let rep = list
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["target_id"] == b.to_string().as_str())
            .unwrap()
            .clone();
        assert_eq!(rep["reason"], "harassment");
        let rid = rep["id"].as_i64().unwrap();
        let (st, _) = call(
            &app,
            &ct,
            "POST",
            &format!("/api/gov/reports/{rid}/resolve"),
            json!({ "action": "mute_1h" }),
        )
        .await;
        assert_eq!(st, StatusCode::OK);
        assert!(gov::muted_until(&db, b).await.unwrap() > 0);
        // Muted: no comments or proposals for now; votes still count.
        let (_, r) = call(
            &app,
            &ct,
            "POST",
            "/api/gov/proposals",
            json!({ "kind": "event", "title": "Chess night on Fridays" }),
        )
        .await;
        let id = r["id"].as_i64().unwrap();
        let (st, _) = call(
            &app,
            &ba,
            "POST",
            &format!("/api/gov/proposals/{id}/comment"),
            json!({ "text": "yes please" }),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, _) = call(
            &app,
            &aa,
            "POST",
            &format!("/api/gov/proposals/{id}/comment"),
            json!({ "text": "yes please" }),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "commenting needs an active day");
        // Resolving twice is refused; the ledger mentions no names.
        let (st, _) = call(
            &app,
            &ct,
            "POST",
            &format!("/api/gov/reports/{rid}/resolve"),
            json!({ "action": "dismiss" }),
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT);
        let (_, ledger) = call(&app, &aa, "GET", "/api/gov/ledger", Value::Null).await;
        let m = ledger
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["kind"] == "moderation")
            .unwrap();
        assert!(!m["summary"].as_str().unwrap().contains("Bob"));
        sqlx::query("UPDATE proposals SET status = 'withdrawn' WHERE id = $1")
            .bind(id)
            .execute(&db)
            .await
            .unwrap();
    }
}
