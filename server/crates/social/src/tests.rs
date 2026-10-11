//! Social gateway integration tests on a real Postgres (`TEST_DATABASE_URL`,
//! default the local `commons_test` database); skipped when unreachable.

use crate::{State, routes};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use commons_api::economy::{Catalog, Op, WELCOME, apply};
use commons_api::store::Store;
use commons_common::token::{self, AccessClaims, ServiceClaims, TrustTier};
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

async fn state() -> Option<Arc<State>> {
    let url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://commons:commons@localhost:5432/commons_test".into());
    let db = match commons_api::connect(&url, 5).await {
        Ok(db) => db,
        Err(e) => {
            eprintln!("skipping database test: {e:#}");
            return None;
        }
    };
    let catalog = Arc::new(Catalog::load(&db).await.unwrap());
    Some(Arc::new(State::new(db, b"test-secret".to_vec(), catalog)))
}

struct P {
    id: Uuid,
    name: String,
    token: String,
}

async fn player(s: &State) -> P {
    let name = format!("s{}", &Uuid::new_v4().simple().to_string()[..12]);
    let catalog = s.catalog.clone();
    let p = Store::new(s.db.clone())
        .create_player(
            &format!("{name}@test.local"),
            &name,
            1990,
            1,
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
    let claims = AccessClaims {
        sub: p.id.clone(),
        name: name.clone(),
        look: 1,
        tier: TrustTier::Visitor,
        minor: false,
    };
    P {
        id: Uuid::parse_str(&p.id).unwrap(),
        name,
        token: token::sign(&s.secret, &claims, 600),
    }
}

async fn call(
    s: &Arc<State>,
    method: &str,
    path: &str,
    auth: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {auth}"))
        .body(body.map_or(Body::empty(), |b| Body::from(b.to_string())))
        .unwrap();
    let resp = routes::routes()
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
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn service(s: &State) -> String {
    token::sign(&s.secret, &ServiceClaims { svc: "test".into() }, 60)
}

async fn befriend(s: &Arc<State>, a: &P, b: &P) {
    let (_, r) = call(
        s,
        "POST",
        "/api/social/request",
        &a.token,
        Some(json!({ "name": b.name })),
    )
    .await;
    assert_eq!(r["status"], "sent");
    let (st, _) = call(
        s,
        "POST",
        "/api/social/respond",
        &b.token,
        Some(json!({ "id": a.id.to_string(), "accept": true })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn requests_accept_and_auto_accept() {
    let Some(s) = state().await else { return };
    let (a, b, c) = (player(&s).await, player(&s).await, player(&s).await);
    befriend(&s, &a, &b).await;
    let (_, f) = call(&s, "GET", "/api/social/friends", &a.token, None).await;
    assert_eq!(f["friends"][0]["name"], b.name.as_str());
    assert_eq!(f["friends"][0]["level"], 1);

    // Asking someone who already asked you makes you friends straight away.
    call(
        &s,
        "POST",
        "/api/social/request",
        &c.token,
        Some(json!({ "name": a.name })),
    )
    .await;
    let (_, r) = call(
        &s,
        "POST",
        "/api/social/request",
        &a.token,
        Some(json!({ "name": c.name })),
    )
    .await;
    assert_eq!(r["status"], "friends");

    let (_, n) = call(&s, "GET", "/api/social/notifications", &b.token, None).await;
    assert_eq!(n[0]["kind"], "friend_request");
    let (_, n) = call(&s, "GET", "/api/social/notifications", &c.token, None).await;
    assert_eq!(n[0]["kind"], "friend_accepted");
}

#[tokio::test]
async fn gifts_move_items_and_earn_close_friendship() {
    let Some(s) = state().await else { return };
    let (a, b) = (player(&s).await, player(&s).await);
    // Strangers can't gift.
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/gift",
        &a.token,
        Some(json!({ "to": b.id.to_string(), "item": 200, "qty": 1, "key": "x" })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    befriend(&s, &a, &b).await;
    for k in ["g1", "g2", "g3", "g3"] {
        let (st, r) = call(&s, "POST", "/api/social/gift", &a.token, Some(json!({ "to": b.id.to_string(), "item": 200, "qty": 1, "note": "for you", "key": k }))).await;
        assert_eq!(st, StatusCode::OK, "{r}");
    }
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/gift",
        &a.token,
        Some(json!({ "to": b.id.to_string(), "item": 200, "qty": 1, "key": "g4" })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "no seeds left to give");

    let (_, gifts) = call(&s, "GET", "/api/social/gifts", &b.token, None).await;
    assert_eq!(
        gifts.as_array().unwrap().len(),
        3,
        "the retried key didn't make a 4th gift"
    );
    let id = gifts[0]["id"].as_str().unwrap().to_string();
    let (st, r) = call(
        &s,
        "POST",
        &format!("/api/social/gifts/{id}/open"),
        &b.token,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(
        r["applied"]["totals"][0],
        json!([200, 4]),
        "3 welcome seeds + 1 gift"
    );
    let (st, _) = call(
        &s,
        "POST",
        &format!("/api/social/gifts/{id}/open"),
        &b.token,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "opened only once");

    let (_, f) = call(&s, "GET", "/api/social/friends", &b.token, None).await;
    assert_eq!(
        (
            f["friends"][0]["level"].clone(),
            f["friends"][0]["points"].clone()
        ),
        (json!(2), json!(30))
    );
    let (_, n) = call(&s, "GET", "/api/social/notifications", &a.token, None).await;
    assert!(
        n.as_array()
            .unwrap()
            .iter()
            .any(|x| x["kind"] == "close_friend")
    );
}

#[tokio::test]
async fn visiting_and_joining_friends() {
    let Some(s) = state().await else { return };
    let (a, b, stranger) = (player(&s).await, player(&s).await, player(&s).await);
    befriend(&s, &a, &b).await;
    let svc = service(&s);
    let can_visit =
        |guest: &P, owner: &P| format!("/internal/can_visit?guest={}&owner={}", guest.id, owner.id);

    assert_eq!(
        call(&s, "GET", &can_visit(&a, &a), &svc, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&s, "GET", &can_visit(&b, &a), &svc, None).await.0,
        StatusCode::FORBIDDEN,
        "friends need an invite"
    );
    call(
        &s,
        "POST",
        "/api/social/invite",
        &a.token,
        Some(json!({ "id": b.id.to_string() })),
    )
    .await;
    assert_eq!(
        call(&s, "GET", &can_visit(&b, &a), &svc, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&s, "GET", &can_visit(&stranger, &a), &svc, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // Join friend: offline → 404; online in the park → the park instance.
    let locate = format!("/internal/locate?player={}&friend={}", b.id, a.id);
    assert_eq!(
        call(&s, "GET", &locate, &svc, None).await.0,
        StatusCode::NOT_FOUND
    );
    let (tx, _rx) = tokio::sync::mpsc::channel(8);
    s.hub.connect(a.id, tx);
    let report = |present: bool| json!({ "player": a.id.to_string(), "zone": "founders_park", "zone_name": "Founders' Park", "instance": 2, "owner": null, "present": present, "at_ms": 1 });
    call(&s, "POST", "/internal/presence", &svc, Some(report(true))).await;
    let (st, loc) = call(&s, "GET", &locate, &svc, None).await;
    assert_eq!(
        (st, loc["instance"].clone(), loc["label"].clone()),
        (StatusCode::OK, json!(2), json!("Founders' Park · 2"))
    );
    let strangers = format!("/internal/locate?player={}&friend={}", stranger.id, a.id);
    assert_eq!(
        call(&s, "GET", &strangers, &svc, None).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn blocking_ends_friendship_and_contact() {
    let Some(s) = state().await else { return };
    let (a, b) = (player(&s).await, player(&s).await);
    befriend(&s, &a, &b).await;
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/dm",
        &b.token,
        Some(json!({ "to": a.id.to_string(), "text": "hello!" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (_, h) = call(
        &s,
        "GET",
        &format!("/api/social/dm/{}", b.id),
        &a.token,
        None,
    )
    .await;
    assert_eq!(h[0]["text"], "hello!");

    call(
        &s,
        "POST",
        "/api/social/block",
        &a.token,
        Some(json!({ "name": b.name })),
    )
    .await;
    let (_, f) = call(&s, "GET", "/api/social/friends", &a.token, None).await;
    assert_eq!(f["friends"].as_array().unwrap().len(), 0);
    assert_eq!(f["blocked"][0]["name"], b.name.as_str());
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/dm",
        &b.token,
        Some(json!({ "to": a.id.to_string(), "text": "hi?" })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/request",
        &b.token,
        Some(json!({ "name": a.name })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}
