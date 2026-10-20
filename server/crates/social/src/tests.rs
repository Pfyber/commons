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
        style: 0,
        tier: TrustTier::Visitor,
        minor: false,
        muted_until: 0,
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
async fn gifts_go_wrapped_with_a_card() {
    let Some(s) = state().await else { return };
    let (a, b) = (player(&s).await, player(&s).await);
    befriend(&s, &a, &b).await;
    // From the Gift Shop: one wrapping paper and one card.
    let (wrap, card) = (
        s.catalog.by_key("starry_wrap").unwrap().clone(),
        s.catalog.by_key("birthday_card").unwrap().clone(),
    );
    commons_api::economy::apply_tx(
        &s.db,
        &s.catalog,
        a.id,
        &[
            Op {
                item: wrap.id,
                delta: 1,
            },
            Op {
                item: card.id,
                delta: 1,
            },
        ],
        "test",
        &format!("{}:wrap", a.id),
    )
    .await
    .unwrap();
    let send = |key: &str, wrap: i32, card: i32| json!({ "to": b.id.to_string(), "item": 200, "qty": 1, "note": "Happy birthday!", "key": key, "wrap": wrap, "card": card });
    // Not wrapping paper.
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/gift",
        &a.token,
        Some(send("w0", 200, 0)),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, r) = call(
        &s,
        "POST",
        "/api/social/gift",
        &a.token,
        Some(send("w1", wrap.id, card.id)),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    // Used up: the next one goes plain.
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/gift",
        &a.token,
        Some(send("w2", wrap.id, 0)),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "no wrapping left");
    let (_, gifts) = call(&s, "GET", "/api/social/gifts", &b.token, None).await;
    let g = &gifts[0];
    assert_eq!(
        (g["wrap"].clone(), g["card"].clone(), g["note"].clone()),
        (
            wrap.meta["code"].clone(),
            card.meta["code"].clone(),
            json!("Happy birthday!")
        )
    );
}

/// A lot nobody lives on, picked at random so tests running at the same
/// time don't reach for the same one.
async fn free_lot(s: &State) -> String {
    let taken: Vec<String> = sqlx::query_scalar("SELECT plot FROM leases WHERE state <> 'ended'")
        .fetch_all(&s.db)
        .await
        .unwrap();
    let free: Vec<String> = commons_sim::city::city_home_lots()
        .into_iter()
        .filter(|l| !taken.contains(l))
        .collect();
    assert!(!free.is_empty(), "a free lot for the test");
    free[(Uuid::new_v4().as_u128() % free.len() as u128) as usize].clone()
}

/// Gives `p` a home straight in the table (homes are scarce, so tests give
/// them back with `move_out`).
async fn give_home(s: &State, p: &P) -> String {
    loop {
        let lot = free_lot(s).await;
        let done = sqlx::query(
            "INSERT INTO leases (kind, plot, player_id, tier, paid_until)
             VALUES ('home', $1, $2, 1, now() + interval '7 days') ON CONFLICT DO NOTHING",
        )
        .bind(&lot)
        .bind(p.id)
        .execute(&s.db)
        .await
        .unwrap()
        .rows_affected();
        if done == 1 {
            return lot;
        }
    }
}

async fn move_out(s: &State, ps: &[&P]) {
    for p in ps {
        sqlx::query("DELETE FROM leases WHERE player_id = $1")
            .bind(p.id)
            .execute(&s.db)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn homes_are_claimed_once_and_lead_home() {
    let Some(s) = state().await else { return };
    let (a, b) = (player(&s).await, player(&s).await);
    let svc = service(&s);
    let home_of = |p: &P| format!("/internal/home?player={}", p.id);
    assert_eq!(
        call(&s, "GET", &home_of(&a), &svc, None).await.0,
        StatusCode::NOT_FOUND
    );
    // A real lot, free: a moves in.
    let lot = free_lot(&s).await;
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/homes/claim",
        &a.token,
        Some(json!({ "lot": lot })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, body) = call(&s, "GET", &home_of(&a), &svc, None).await;
    assert_eq!(
        (st, body["lot"].as_str()),
        (StatusCode::OK, Some(lot.as_str()))
    );
    // Taken, and nobody gets two; made-up lots don't exist.
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/homes/claim",
        &b.token,
        Some(json!({ "lot": lot })),
    )
    .await;
    assert_eq!(
        (st, body["error"].as_str()),
        (StatusCode::CONFLICT, Some("taken"))
    );
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/homes/claim",
        &a.token,
        Some(json!({ "lot": "b0_0:1" })),
    )
    .await;
    assert_eq!(
        (st, body["error"].as_str()),
        (StatusCode::CONFLICT, Some("has_home"))
    );
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/homes/claim",
        &b.token,
        Some(json!({ "lot": "b3_3:0" })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    // The list shows who lives where, and which one is yours.
    let (_, body) = call(&s, "GET", "/api/social/homes", &a.token, None).await;
    assert_eq!(body["mine"].as_str(), Some(lot.as_str()));
    assert_eq!(body["total"], 168);
    assert!(
        body["lots"]
            .as_array()
            .unwrap()
            .iter()
            .any(|l| l["lot"] == lot.as_str() && l["name"] == a.name.as_str())
    );
    // Visiting someone needs them to have a home at all.
    let to_b = format!("/internal/can_visit?guest={}&owner={}", a.id, b.id);
    let (st, body) = call(&s, "GET", &to_b, &svc, None).await;
    assert_eq!(
        (st, body["error"].as_str()),
        (StatusCode::NOT_FOUND, Some("no_home"))
    );
    move_out(&s, &[&a, &b]).await;
}

#[tokio::test]
async fn visiting_and_joining_friends() {
    let Some(s) = state().await else { return };
    let (a, b, stranger) = (player(&s).await, player(&s).await, player(&s).await);
    befriend(&s, &a, &b).await;
    give_home(&s, &a).await;
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
    move_out(&s, &[&a]).await;
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

async fn coins(s: &State, p: &P) -> i32 {
    sqlx::query_scalar(
        "SELECT coalesce((SELECT qty FROM inventory WHERE player_id = $1 AND item_id = 1), 0)",
    )
    .bind(p.id)
    .fetch_one(&s.db)
    .await
    .unwrap()
}

async fn lease_state(s: &State, p: &P, slot: &str) -> Option<String> {
    sqlx::query_scalar(
        "SELECT state FROM leases WHERE player_id = $1 AND slot = $2 ORDER BY id DESC LIMIT 1",
    )
    .bind(p.id)
    .bind(slot)
    .fetch_optional(&s.db)
    .await
    .unwrap()
}

async fn make_due(s: &State, p: &P) {
    sqlx::query(
        "UPDATE leases SET paid_until = now() - interval '1 second' WHERE player_id = $1 AND state <> 'ended'",
    )
    .bind(p.id)
    .execute(&s.db)
    .await
    .unwrap();
}

#[tokio::test]
async fn rent_renews_then_grace_then_release_returns_everything() {
    let Some(s) = state().await else { return };
    let a = player(&s).await;
    let lot = free_lot(&s).await;
    // Moving in pays the first week of a Cottage (15 of the welcome 100).
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/homes/claim",
        &a.token,
        Some(json!({ "lot": lot })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(coins(&s, &a).await, 85);
    // Upgrading to a House pays the difference for this week.
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/rent/tier",
        &a.token,
        Some(json!({ "slot": "home", "tier": 2 })),
    )
    .await;
    assert_eq!(
        (st, body["tier_name"].as_str()),
        (StatusCode::OK, Some("House"))
    );
    assert_eq!(coins(&s, &a).await, 60);
    // A week on: the sweep renews at the House rate.
    make_due(&s, &a).await;
    crate::rent::sweep(&s).await.unwrap();
    assert_eq!(coins(&s, &a).await, 20);
    assert_eq!(lease_state(&s, &a, "home").await.as_deref(), Some("active"));
    // Furniture inside, and not enough coins next week: grace, with a notice.
    sqlx::query(
        "INSERT INTO home_objects (owner_id, x, y, item_id) VALUES ($1, 3, 3, (SELECT min(id) FROM items WHERE kind = 'furniture'))",
    )
    .bind(a.id)
    .execute(&s.db)
    .await
    .unwrap();
    make_due(&s, &a).await;
    crate::rent::sweep(&s).await.unwrap();
    assert_eq!(lease_state(&s, &a, "home").await.as_deref(), Some("grace"));
    assert_eq!(coins(&s, &a).await, 20, "nothing taken when it can't pay");
    let (_, notes) = call(&s, "GET", "/api/social/notifications", &a.token, None).await;
    assert!(notes.to_string().contains("rent_due"), "{notes}");
    // Paying now can't work either, and no tier changes while unpaid.
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/rent/pay",
        &a.token,
        Some(json!({ "slot": "home" })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/rent/tier",
        &a.token,
        Some(json!({ "slot": "home", "tier": 1 })),
    )
    .await;
    assert_eq!(
        (st, body["error"].as_str()),
        (StatusCode::CONFLICT, Some("unpaid"))
    );
    // Grace runs out: the lease ends, the furniture comes back to the bag.
    sqlx::query(
        "UPDATE leases SET grace_until = now() - interval '1 second' WHERE player_id = $1 AND state = 'grace'",
    )
    .bind(a.id)
    .execute(&s.db)
    .await
    .unwrap();
    crate::rent::sweep(&s).await.unwrap();
    assert_eq!(lease_state(&s, &a, "home").await.as_deref(), Some("ended"));
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM home_objects WHERE owner_id = $1")
        .bind(a.id)
        .fetch_one(&s.db)
        .await
        .unwrap();
    assert_eq!(left, 0);
    let furniture: i64 = sqlx::query_scalar(
        "SELECT coalesce(sum(i.qty), 0)::bigint FROM inventory i JOIN items t ON t.id = i.item_id
         WHERE i.player_id = $1 AND t.kind = 'furniture'",
    )
    .bind(a.id)
    .fetch_one(&s.db)
    .await
    .unwrap();
    assert_eq!(furniture, 1, "the furniture is back in the bag");
    let svc = service(&s);
    let (st, _) = call(
        &s,
        "GET",
        &format!("/internal/home?player={}", a.id),
        &svc,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND, "no lease, no home");
    move_out(&s, &[&a]).await;
}

#[tokio::test]
async fn stalls_sell_from_one_bag_to_another() {
    let Some(s) = state().await else { return };
    let (a, b) = (player(&s).await, player(&s).await);
    // A free stall (there are only six).
    let taken: Vec<String> =
        sqlx::query_scalar("SELECT plot FROM leases WHERE state <> 'ended' AND kind = 'stall'")
            .fetch_all(&s.db)
            .await
            .unwrap();
    let Some(stall) = (1..=6)
        .map(|i| format!("stall:{i}"))
        .find(|p| !taken.contains(p))
    else {
        return;
    };
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/stalls/claim",
        &a.token,
        Some(json!({ "stall": stall })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(coins(&s, &a).await, 90);
    // Two of the welcome seeds (item 200) at 7 coins each.
    let (st, body) = call(
        &s,
        "POST",
        "/api/social/stalls/put",
        &a.token,
        Some(json!({ "item": 200, "qty": 2, "price": 7, "key": "k1" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body}");
    let (_, list) = call(&s, "GET", "/api/social/stalls", &b.token, None).await;
    let mine = list["stalls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["stall"] == stall.as_str())
        .unwrap()
        .clone();
    let id = mine["goods"][0]["id"].as_i64().unwrap();
    assert_eq!(mine["goods"][0]["qty"], 2);
    // Not your own; B buys one; the same key twice doesn't buy twice.
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/stalls/buy",
        &a.token,
        Some(json!({ "id": id, "qty": 1, "key": "x" })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    for _ in 0..2 {
        let (st, body) = call(
            &s,
            "POST",
            "/api/social/stalls/buy",
            &b.token,
            Some(json!({ "id": id, "qty": 1, "key": "buy1" })),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{body}");
    }
    assert_eq!(coins(&s, &b).await, 93);
    assert_eq!(coins(&s, &a).await, 97);
    let seeds = |p: &P| {
        sqlx::query_scalar::<_, i32>(
            "SELECT coalesce((SELECT qty FROM inventory WHERE player_id = $1 AND item_id = 200), 0)",
        )
        .bind(p.id)
    };
    assert_eq!(seeds(&b).fetch_one(&s.db).await.unwrap(), 4);
    assert_eq!(seeds(&a).fetch_one(&s.db).await.unwrap(), 1);
    // A takes the last one back off the stall.
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/stalls/take",
        &a.token,
        Some(json!({ "id": id })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(seeds(&a).fetch_one(&s.db).await.unwrap(), 2);
    let (_, notes) = call(&s, "GET", "/api/social/notifications", &a.token, None).await;
    assert!(notes.to_string().contains("stall_sale"), "{notes}");
    move_out(&s, &[&a, &b]).await;
}
