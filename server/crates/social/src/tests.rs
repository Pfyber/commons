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
    player_born(s, 1990).await
}

async fn player_born(s: &State, birth_year: i32) -> P {
    let name = format!("s{}", &Uuid::new_v4().simple().to_string()[..12]);
    let catalog = s.catalog.clone();
    let p = Store::new(s.db.clone())
        .create_player(
            &format!("{name}@test.local"),
            &name,
            birth_year,
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
        minor: birth_year > 2000,
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

// ---- phone calls -------------------------------------------------------------------

async fn give_phone(s: &State, p: &P) {
    sqlx::query(
        "INSERT INTO inventory (player_id, item_id, qty) VALUES ($1, $2, 1)
         ON CONFLICT (player_id, item_id) DO UPDATE SET qty = 1",
    )
    .bind(p.id)
    .bind(crate::calls::PHONE)
    .execute(&s.db)
    .await
    .unwrap();
}

/// Online, with a socket we can read pushes from.
fn online(s: &State, p: &P) -> tokio::sync::mpsc::Receiver<String> {
    let (tx, rx) = tokio::sync::mpsc::channel(32);
    s.hub.connect(p.id, tx);
    rx
}

fn pushed(rx: &mut tokio::sync::mpsc::Receiver<String>, t: &str) -> Option<Value> {
    while let Ok(m) = rx.try_recv() {
        let v: Value = serde_json::from_str(&m).unwrap();
        if v["t"] == t {
            return Some(v);
        }
    }
    None
}

#[tokio::test]
async fn friends_with_phones_call_and_group_up_but_not_under_16s_yet() {
    let Some(s) = state().await else { return };
    let (a, b, c) = (player(&s).await, player(&s).await, player(&s).await);
    let kid = player_born(&s, 2016).await;
    befriend(&s, &a, &b).await;
    befriend(&s, &a, &c).await;
    befriend(&s, &a, &kid).await;
    let ring = |who: &P, to: &P| {
        let s = s.clone();
        let (tok, id) = (who.token.clone(), to.id.to_string());
        async move {
            call(
                &s,
                "POST",
                "/api/social/call/ring",
                &tok,
                Some(json!({ "id": id })),
            )
            .await
        }
    };

    // No phone, no calls; they need one too, and to be around.
    let (st, r) = ring(&a, &b).await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("no_phone"))
    );
    give_phone(&s, &a).await;
    let (_, r) = ring(&a, &b).await;
    assert_eq!(r["error"], "no_phone", "they need one too");
    give_phone(&s, &b).await;
    let (_, r) = ring(&a, &b).await;
    assert_eq!(r["error"], "offline");
    let _a_rx = online(&s, &a);
    let mut a_rx = online(&s, &a);
    let mut b_rx = online(&s, &b);

    // A rings B: a pass to the call's room, and B's phone rings.
    let (st, r) = ring(&a, &b).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let room = r["call"].as_str().unwrap().to_string();
    assert!(r["token"].as_str().unwrap().split('.').count() == 3);
    assert!(r["url"].as_str().unwrap().starts_with("ws"));
    let rang = pushed(&mut b_rx, "call_ring").expect("B's phone rings");
    assert_eq!(rang["from_name"], a.name.as_str());
    let (st, r) = call(
        &s,
        "POST",
        "/api/social/call/answer",
        &b.token,
        Some(json!({ "call": room, "accept": true })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["members"].as_array().unwrap().len(), 2);
    assert_eq!(
        pushed(&mut a_rx, "call").unwrap()["members"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // B rings C into it: a group call.
    give_phone(&s, &c).await;
    let mut c_rx = online(&s, &c);
    befriend(&s, &b, &c).await;
    let (st, r) = ring(&b, &c).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["call"], room.as_str(), "into the same call");
    assert!(pushed(&mut c_rx, "call_ring").is_some());
    call(
        &s,
        "POST",
        "/api/social/call/answer",
        &c.token,
        Some(json!({ "call": room, "accept": true })),
    )
    .await;
    let (_, now) = call(&s, "GET", "/api/social/call", &a.token, None).await;
    assert_eq!(now["members"].as_array().unwrap().len(), 3);

    // Under 16: not callable while calls for them are off, and they can't
    // switch them on yet.
    give_phone(&s, &kid).await;
    let _kid_rx = online(&s, &kid);
    let (st, r) = ring(&a, &kid).await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("age"))
    );
    assert!(r["message"].as_str().unwrap().contains("under-16s"));
    let (_, contacts) = call(&s, "GET", "/api/social/call/contacts", &a.token, None).await;
    let k = contacts["friends"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["id"] == kid.id.to_string())
        .unwrap()
        .clone();
    assert_eq!(k["callable"], false);
    let (_, mine) = call(&s, "GET", "/api/social/call/contacts", &kid.token, None).await;
    assert_eq!(mine["can_call"], false);
    assert_eq!(mine["switch"], false, "no switch until calls open to them");
    let (st, _) = call(
        &s,
        "POST",
        "/api/social/call/settings",
        &kid.token,
        Some(json!({ "voice_ok": true })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    // Only the host (A, who started it) removes people.
    let remove = |by: &P, who: &P| {
        let s = s.clone();
        let (tok, id) = (by.token.clone(), who.id.to_string());
        async move {
            call(
                &s,
                "POST",
                "/api/social/call/remove",
                &tok,
                Some(json!({ "id": id })),
            )
            .await
        }
    };
    let (st, r) = remove(&b, &c).await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("not_host"))
    );
    let (st, r) = remove(&a, &c).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(pushed(&mut c_rx, "call_removed").is_some(), "C's told");
    let (_, now) = call(&s, "GET", "/api/social/call", &c.token, None).await;
    assert!(now["call"].is_null());
    let (_, now) = call(&s, "GET", "/api/social/call", &b.token, None).await;
    assert_eq!(now["members"].as_array().unwrap().len(), 2);
    assert_eq!(now["host"], a.id.to_string());

    // Hanging up: A leaves, B's alone: over.
    call(&s, "POST", "/api/social/call/leave", &a.token, None).await;
    assert!(pushed(&mut b_rx, "call_ended").is_some());
    let (_, now) = call(&s, "GET", "/api/social/call", &b.token, None).await;
    assert!(now["call"].is_null());

    // B declines a second call from A.
    let (_, r) = ring(&a, &b).await;
    let second = r["call"].as_str().unwrap().to_string();
    call(
        &s,
        "POST",
        "/api/social/call/answer",
        &b.token,
        Some(json!({ "call": second, "accept": false })),
    )
    .await;

    // The call log, newest first.
    let log = |p: &P| {
        let s = s.clone();
        let tok = p.token.clone();
        async move { call(&s, "GET", "/api/social/call/log", &tok, None).await.1["calls"].clone() }
    };
    let names = |line: &Value| -> Vec<String> {
        line["people"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap().to_string())
            .collect()
    };
    let al = log(&a).await;
    assert_eq!(al[0]["status"], "unanswered", "B declined: {al}");
    assert_eq!(names(&al[0]), vec![b.name.clone()]);
    assert_eq!(
        (al[1]["direction"].as_str(), al[1]["status"].as_str()),
        (Some("out"), Some("talked"))
    );
    let mut on = names(&al[1]);
    on.sort();
    let mut want = vec![b.name.clone(), c.name.clone()];
    want.sort();
    assert_eq!(on, want, "everyone who was on it");
    assert!(al[1]["secs"].is_number());
    let bl = log(&b).await;
    assert_eq!(
        (bl[0]["direction"].as_str(), bl[0]["status"].as_str()),
        (Some("in"), Some("declined"))
    );
    assert_eq!(
        (bl[1]["direction"].as_str(), bl[1]["status"].as_str()),
        (Some("in"), Some("talked"))
    );
    let cl = log(&c).await;
    assert_eq!(cl[0]["status"], "removed");
}

// ---- clubs ---------------------------------------------------------------------------

#[tokio::test]
async fn a_club_is_rented_shared_paid_for_together_and_handed_on() {
    let Some(s) = state().await else { return };
    let (a, b, c) = (player(&s).await, player(&s).await, player(&s).await);
    let tag = &a.name[1..7];
    let post = |p: &P, path: String, body: Value| {
        let s = s.clone();
        let tok = p.token.clone();
        async move { call(&s, "POST", &path, &tok, Some(body)).await }
    };
    let get = |p: &P, path: String| {
        let s = s.clone();
        let tok = p.token.clone();
        async move { call(&s, "GET", &path, &tok, None).await }
    };

    // Founding rents the room: the first week's rent (25) from the founder,
    // through the treasury.
    let before = coins(&s, &a).await;
    let name = format!("Owls {tag}");
    let (st, r) = post(
        &a,
        "/api/social/clubs/found".into(),
        json!({ "name": name, "crest": "🦉", "color": "#3f7a8a" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let id = r["id"].as_str().unwrap().to_string();
    assert_eq!(coins(&s, &a).await, before - 25);
    let (_, d) = get(&a, format!("/api/social/clubs/{id}")).await;
    assert_eq!(
        (d["role"].as_str(), d["treasury"].as_i64()),
        (Some("owner"), Some(0))
    );
    assert_eq!(d["room"]["state"], "active");
    assert_eq!(
        d["badge"], true,
        "your first club's crest goes by your name"
    );
    let (st, r) = post(
        &c,
        "/api/social/clubs/found".into(),
        json!({ "name": name.to_uppercase(), "crest": "🦊", "color": "#c8553d" }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("name_taken"))
    );

    // Invites go to friends only; members can't invite.
    let invite = |by: &P, to: &P| {
        post(
            by,
            format!("/api/social/clubs/{id}/invite"),
            json!({ "id": to.id.to_string() }),
        )
    };
    let (st, _) = invite(&a, &b).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "not friends yet");
    befriend(&s, &a, &b).await;
    let (st, r) = invite(&a, &b).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, mine) = get(&b, "/api/social/clubs".into()).await;
    assert_eq!(mine["invites"][0]["name"], name.as_str());
    let (st, _) = post(
        &b,
        format!("/api/social/clubs/{id}/answer"),
        json!({ "accept": true }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    befriend(&s, &b, &c).await;
    let (st, r) = invite(&b, &c).await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("not_staff"))
    );

    // B chips in; the board.
    let (st, r) = post(
        &b,
        format!("/api/social/clubs/{id}/donate"),
        json!({ "coins": 40, "key": "d1" }),
    )
    .await;
    assert_eq!(
        (st, r["treasury"].as_i64()),
        (StatusCode::OK, Some(40)),
        "{r}"
    );
    post(
        &b,
        format!("/api/social/clubs/{id}/donate"),
        json!({ "coins": 40, "key": "d1" }),
    )
    .await;
    let (_, d) = get(&a, format!("/api/social/clubs/{id}")).await;
    assert_eq!(d["treasury"], 40, "the same press twice gives once");
    let (_, p1) = post(
        &a,
        format!("/api/social/clubs/{id}/post"),
        json!({ "text": "Welcome, owls!" }),
    )
    .await;
    let (st, _) = post(
        &b,
        format!("/api/social/clubs/{id}/posts/{}/delete", p1["id"]),
        json!({}),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN, "not B's post");
    let (_, d) = get(&b, format!("/api/social/clubs/{id}")).await;
    assert_eq!(d["posts"][0]["text"], "Welcome, owls!");
    assert_eq!(d["members"].as_array().unwrap().len(), 2);

    // The badge by B's name, and room access: members only.
    let (_, badges) = get(
        &c,
        format!("/api/social/clubs/badges?names={},{}", b.name, c.name),
    )
    .await;
    assert_eq!(badges[&b.name]["crest"], "🦉");
    assert!(badges.get(&c.name).is_none());
    let svc = service(&s);
    let (st, room) = call(
        &s,
        "GET",
        &format!("/internal/club_room?player={}&club={id}", b.id),
        &svc,
        None,
    )
    .await;
    assert_eq!(
        (st, room["name"].as_str()),
        (StatusCode::OK, Some(name.as_str()))
    );
    let (st, _) = call(
        &s,
        "GET",
        &format!("/internal/club_room?player={}&club={id}", c.id),
        &svc,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    // A bigger room: the difference this week (60 - 25 = 35) from the treasury.
    let (st, r) = post(
        &a,
        format!("/api/social/clubs/{id}/room"),
        json!({ "tier": 2 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, d) = get(&a, format!("/api/social/clubs/{id}")).await;
    assert_eq!(
        (d["treasury"].as_i64(), d["cap"].as_i64()),
        (Some(5), Some(30))
    );

    // Rent comes due and the treasury can't pay: grace, and the owner hears.
    sqlx::query("UPDATE leases SET paid_until = now() - interval '1 second' WHERE club_id = $1::uuid AND state <> 'ended'")
        .bind(&id)
        .execute(&s.db)
        .await
        .unwrap();
    crate::rent::sweep(&s).await.unwrap();
    let (_, d) = get(&a, format!("/api/social/clubs/{id}")).await;
    assert_eq!(d["room"]["state"], "grace");
    let (_, n) = call(&s, "GET", "/api/social/notifications", &a.token, None).await;
    let due = n
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["kind"] == "rent_due")
        .expect("told");
    assert_eq!(due["body"]["club"], name.as_str());
    let (st, _) = post(&a, format!("/api/social/clubs/{id}/pay"), json!({})).await;
    assert_eq!(st, StatusCode::CONFLICT, "still not enough");
    post(
        &b,
        format!("/api/social/clubs/{id}/donate"),
        json!({ "coins": 60, "key": "d2" }),
    )
    .await;
    let (st, r) = post(&b, format!("/api/social/clubs/{id}/pay"), json!({})).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "members don't pay: {r}");
    let (st, r) = post(&a, format!("/api/social/clubs/{id}/pay"), json!({})).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["room"]["state"], "active");

    // The owner can't walk away from members: hand it over first. The lease
    // goes into B's name; when the last member leaves, the club closes.
    let (st, _) = post(&a, format!("/api/social/clubs/{id}/leave"), json!({})).await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _) = post(
        &a,
        format!("/api/social/clubs/{id}/role"),
        json!({ "id": b.id.to_string(), "role": "owner" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let holder: Uuid = sqlx::query_scalar(
        "SELECT player_id FROM leases WHERE club_id = $1::uuid AND state <> 'ended'",
    )
    .bind(&id)
    .fetch_one(&s.db)
    .await
    .unwrap();
    assert_eq!(holder, b.id);
    let (st, _) = post(&a, format!("/api/social/clubs/{id}/leave"), json!({})).await;
    assert_eq!(st, StatusCode::OK);
    let (_, r) = post(&b, format!("/api/social/clubs/{id}/leave"), json!({})).await;
    assert_eq!(r["closed"], true);
    let open: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM leases WHERE club_id = $1::uuid AND state <> 'ended'",
    )
    .bind(&id)
    .fetch_one(&s.db)
    .await
    .unwrap();
    assert_eq!(open, 0, "its room is given up");
    let (st, _) = get(&b, format!("/api/social/clubs/{id}")).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

// ---- club life (C2) -------------------------------------------------------------

/// `p` is in club `club`'s room, as a zone would report it.
fn in_room(s: &State, p: &P, club: &str) {
    s.hub.set_location(
        p.id,
        crate::hub::Location {
            zone: "clubroom".into(),
            instance: 1,
            owner: Some(club.to_string()),
            label: "Club room".into(),
        },
        true,
        chrono::Utc::now().timestamp_millis(),
    );
}

async fn kinds(s: &Arc<State>, p: &P) -> Vec<String> {
    let (_, n) = call(s, "GET", "/api/social/notifications", &p.token, None).await;
    n.as_array()
        .unwrap()
        .iter()
        .map(|x| x["kind"].as_str().unwrap().to_string())
        .collect()
}

async fn grant(s: &State, p: &P, item: i32, n: i32, reason: &str, key: &str) {
    let mut tx = s.db.begin().await.unwrap();
    commons_api::economy::apply(
        &mut tx,
        &s.catalog,
        p.id,
        &[commons_api::economy::Op { item, delta: n }],
        reason,
        key,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn a_club_meets_up_reaches_its_goals_calls_together_and_keeps_its_furniture_straight() {
    let Some(s) = state().await else { return };
    let (a, b) = (player(&s).await, player(&s).await);
    let tag = &a.name[1..7];
    let post = |p: &P, path: String, body: Value| {
        let s = s.clone();
        let tok = p.token.clone();
        async move { call(&s, "POST", &path, &tok, Some(body)).await }
    };
    let (_, r) = post(
        &a,
        "/api/social/clubs/found".into(),
        json!({ "name": format!("Larks {tag}"), "crest": "🌻", "color": "#e9b949" }),
    )
    .await;
    let id = r["id"].as_str().unwrap().to_string();
    let club = Uuid::parse_str(&id).unwrap();
    befriend(&s, &a, &b).await;
    post(
        &a,
        format!("/api/social/clubs/{id}/invite"),
        json!({ "id": b.id.to_string() }),
    )
    .await;
    post(
        &b,
        format!("/api/social/clubs/{id}/answer"),
        json!({ "accept": true }),
    )
    .await;

    // The meetup: staff set it. Started five minutes ago (UTC).
    let now = chrono::Utc::now();
    let start = now - chrono::Duration::minutes(5);
    let dow = chrono::Datelike::weekday(&start).num_days_from_monday() as i16;
    let minute = (chrono::Timelike::hour(&start) * 60 + chrono::Timelike::minute(&start)) as i16;
    let (st, _) = post(
        &b,
        format!("/api/social/clubs/{id}/meetup"),
        json!({ "dow": dow, "minute": minute }),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN, "members don't set it");
    let (st, r) = post(
        &a,
        format!("/api/social/clubs/{id}/meetup"),
        json!({ "dow": dow, "minute": minute }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(r["meetup"]["live_until"].is_i64(), "it's on now: {r}");

    // Both in the room for ten minutes: the start notice and the reward, once.
    in_room(&s, &a, &id);
    in_room(&s, &b, &id);
    let (ca, cb) = (coins(&s, &a).await, coins(&s, &b).await);
    crate::clublife::sweep_clubs(&s, now, 4, Some(club))
        .await
        .unwrap();
    assert_eq!(coins(&s, &a).await, ca, "not yet: four minutes");
    crate::clublife::sweep_clubs(&s, now, 6, Some(club))
        .await
        .unwrap();
    crate::clublife::sweep_clubs(&s, now, 6, Some(club))
        .await
        .unwrap();
    assert_eq!(coins(&s, &a).await, ca + 20);
    assert_eq!(coins(&s, &b).await, cb + 20, "once each");
    let k = kinds(&s, &b).await;
    assert_eq!(k.iter().filter(|k| *k == "club_meetup_now").count(), 1);
    assert!(k.contains(&"club_meetup_reward".to_string()));

    // Goals: the meetup one is reached (two came); 32 member-minutes so far.
    let treasury = |s: Arc<State>| async move {
        sqlx::query_scalar::<_, i32>("SELECT treasury FROM clubs WHERE id = $1")
            .bind(club)
            .fetch_one(&s.db)
            .await
            .unwrap()
    };
    assert_eq!(treasury(s.clone()).await, 15);
    // Time together (120 minutes), fish (15) and a week's rent in gifts.
    crate::clublife::sweep_clubs(&s, now, 44, Some(club))
        .await
        .unwrap();
    for i in 0..15 {
        grant(&s, &a, 100, 1, "fishing", &format!("fish:{tag}:{i}")).await;
    }
    post(
        &b,
        format!("/api/social/clubs/{id}/donate"),
        json!({ "coins": 25, "key": "g" }),
    )
    .await;
    crate::clublife::sweep_clubs(&s, now, 1, Some(club))
        .await
        .unwrap();
    crate::clublife::sweep_clubs(&s, now, 1, Some(club))
        .await
        .unwrap();
    assert_eq!(
        treasury(s.clone()).await,
        15 + 15 + 10 + 25 + 10,
        "each goal paid once"
    );
    let (_, d) = call(
        &s,
        "GET",
        &format!("/api/social/clubs/{id}"),
        &a.token,
        None,
    )
    .await;
    let goals = d["life"]["goals"].as_array().unwrap();
    assert!(goals.iter().all(|g| g["done"] == true), "{goals:?}");
    assert_eq!(d["life"]["meetup"]["came"].as_array().unwrap().len(), 2);

    // The club call: everyone online with a phone is rung.
    give_phone(&s, &a).await;
    let (st, _) = post(&a, format!("/api/social/clubs/{id}/call"), json!({})).await;
    assert_eq!(st, StatusCode::CONFLICT, "nobody who can pick up");
    give_phone(&s, &b).await;
    let mut rx = online(&s, &b);
    let (st, r) = post(&a, format!("/api/social/clubs/{id}/call"), json!({})).await;
    assert_eq!((st, r["rung"].as_i64()), (StatusCode::OK, Some(1)), "{r}");
    assert!(pushed(&mut rx, "call_ring").is_some());
    call(
        &s,
        "POST",
        "/api/social/call/leave",
        &a.token,
        Some(json!({})),
    )
    .await;

    // Furniture B lent the room goes back to B when B leaves.
    sqlx::query(
        "INSERT INTO club_objects (club_id, x, y, item_id, placed_by) VALUES ($1, 5, 5, 400, $2)",
    )
    .bind(club)
    .bind(b.id)
    .execute(&s.db)
    .await
    .unwrap();
    let have = |s: Arc<State>, p: Uuid| async move {
        sqlx::query_scalar::<_, i32>("SELECT coalesce(sum(qty), 0)::int FROM inventory WHERE player_id = $1 AND item_id = 400")
            .bind(p)
            .fetch_one(&s.db)
            .await
            .unwrap()
    };
    let before = have(s.clone(), b.id).await;
    post(&b, format!("/api/social/clubs/{id}/leave"), json!({})).await;
    assert_eq!(have(s.clone(), b.id).await, before + 1);
    // And A's, when the club closes and the room is given up.
    sqlx::query(
        "INSERT INTO club_objects (club_id, x, y, item_id, placed_by) VALUES ($1, 6, 5, 400, $2)",
    )
    .bind(club)
    .bind(a.id)
    .execute(&s.db)
    .await
    .unwrap();
    let before = have(s.clone(), a.id).await;
    post(&a, format!("/api/social/clubs/{id}/leave"), json!({})).await;
    assert_eq!(have(s.clone(), a.id).await, before + 1);
}

// ---- clubs in the town (C3) --------------------------------------------------------

#[tokio::test]
async fn clubhouses_events_for_everyone_and_the_clubs_of_the_week() {
    let Some(s) = state().await else { return };
    let (a, b, c, d) = (
        player(&s).await,
        player(&s).await,
        player(&s).await,
        player(&s).await,
    );
    let tag = &a.name[1..7];
    let post = |p: &P, path: String, body: Value| {
        let s = s.clone();
        let tok = p.token.clone();
        async move { call(&s, "POST", &path, &tok, Some(body)).await }
    };
    let (_, r) = post(
        &a,
        "/api/social/clubs/found".into(),
        json!({ "name": format!("Owls {tag}"), "crest": "🦉", "color": "#3f7a8a" }),
    )
    .await;
    let id = r["id"].as_str().unwrap().to_string();
    let club = Uuid::parse_str(&id).unwrap();
    befriend(&s, &a, &b).await;
    post(
        &a,
        format!("/api/social/clubs/{id}/invite"),
        json!({ "id": b.id.to_string() }),
    )
    .await;
    post(
        &b,
        format!("/api/social/clubs/{id}/answer"),
        json!({ "accept": true }),
    )
    .await;

    // A clubhouse on a free lot: 120 a week, the difference this week (95).
    let (_, lots) = call(&s, "GET", "/api/social/clubs/lots", &a.token, None).await;
    let lot = lots["lots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["club"].is_null())
        .expect("a free lot")["lot"]
        .as_str()
        .unwrap()
        .to_string();
    let (st, r) = post(
        &a,
        format!("/api/social/clubs/{id}/room"),
        json!({ "tier": 3 }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("pick_lot"))
    );
    let (st, _) = post(
        &a,
        format!("/api/social/clubs/{id}/room"),
        json!({ "tier": 3, "lot": "lot:99_99" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    post(
        &b,
        format!("/api/social/clubs/{id}/donate"),
        json!({ "coins": 95, "key": "h" }),
    )
    .await;
    let (st, r) = post(
        &a,
        format!("/api/social/clubs/{id}/room"),
        json!({ "tier": 3, "lot": lot }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["room"]["plot"], lot.as_str());
    let (_, lots) = call(&s, "GET", "/api/social/clubs/lots", &d.token, None).await;
    let here = lots["lots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["lot"] == lot.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        here["club"]["name"],
        format!("Owls {tag}"),
        "everyone sees whose clubhouse it is"
    );
    // Nobody else can have it.
    let (_, r) = post(
        &c,
        "/api/social/clubs/found".into(),
        json!({ "name": format!("Foxes {tag}"), "crest": "🦊", "color": "#c8553d" }),
    )
    .await;
    let other = r["id"].as_str().unwrap().to_string();
    sqlx::query("UPDATE clubs SET treasury = 500 WHERE id = $1::uuid")
        .bind(&other)
        .execute(&s.db)
        .await
        .unwrap();
    let (st, r) = post(
        &c,
        format!("/api/social/clubs/{other}/room"),
        json!({ "tier": 3, "lot": lot }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("lot_taken"))
    );

    // Events: staff plan them, at public places or the club's own lot.
    let soon = chrono::Utc::now() + chrono::Duration::minutes(10);
    let plan = |p: &P, place: &str, title: &str| {
        post(
            p,
            format!("/api/social/clubs/{id}/events"),
            json!({ "title": title, "place": place, "starts_at": soon.timestamp(), "hours": 1 }),
        )
    };
    let (st, _) = plan(&b, "stage", "Owl night").await;
    assert_eq!(st, StatusCode::FORBIDDEN, "members don't plan events");
    let (st, r) = plan(&a, "the moon", "Owl night").await;
    assert_eq!(
        (st, r["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("bad_place"))
    );
    let (st, r) = plan(&a, "stage", "Owl night").await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let event = r["id"].as_i64().unwrap();
    let (st, _) = plan(&a, &lot, "Open house").await;
    assert_eq!(st, StatusCode::OK, "at the club's own lot");
    // Anyone can go: D isn't in the club, nor anyone's friend.
    let (st, r) = post(
        &d,
        format!("/api/social/events/{event}/rsvp"),
        json!({ "going": true }),
    )
    .await;
    assert_eq!(
        (st, r["going"].as_i64()),
        (StatusCode::OK, Some(2)),
        "the planner and D"
    );
    let (_, ev) = call(&s, "GET", "/api/social/events", &d.token, None).await;
    let mine = ev["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == event)
        .unwrap()
        .clone();
    assert_eq!(
        (mine["me"].as_bool(), mine["place_name"].as_str()),
        (Some(true), Some("the Fairground bandstand"))
    );
    assert_eq!(
        mine["friends"].as_array().unwrap().len(),
        0,
        "only friends' names"
    );

    // Reminded 15 minutes before; at the start, those going and the members.
    let now = chrono::Utc::now();
    crate::clubtown::event_tick(&s, now).await.unwrap();
    crate::clubtown::event_tick(&s, now).await.unwrap();
    let k = kinds(&s, &d).await;
    assert_eq!(k.iter().filter(|k| *k == "club_event_soon").count(), 1);
    crate::clubtown::event_tick(&s, now + chrono::Duration::minutes(11))
        .await
        .unwrap();
    crate::clubtown::event_tick(&s, now + chrono::Duration::minutes(12))
        .await
        .unwrap();
    assert_eq!(
        kinds(&s, &d)
            .await
            .iter()
            .filter(|k| *k == "club_event_now")
            .count(),
        1
    );
    assert!(
        kinds(&s, &b).await.contains(&"club_event_now".to_string()),
        "members hear too"
    );
    // Calling one off tells those going.
    let (_, ev) = call(&s, "GET", "/api/social/events", &d.token, None).await;
    let house = ev["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["title"] == "Open house")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    post(
        &d,
        format!("/api/social/events/{house}/rsvp"),
        json!({ "going": true }),
    )
    .await;
    let (st, _) = post(
        &a,
        format!("/api/social/clubs/{id}/events/{house}/cancel"),
        json!({}),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(
        kinds(&s, &d)
            .await
            .contains(&"club_event_cancelled".to_string())
    );

    // The clubs of the week: a week of its own (far off), where only this
    // club has points; paid once.
    let fake_now =
        chrono::Utc::now() + chrono::Duration::days(7 * (500 + (a.id.as_u128() % 5000) as i64));
    let last_week = crate::clublife::week_of(fake_now) - chrono::Duration::days(7);
    sqlx::query("INSERT INTO club_goals_done (club_id, week, goal) VALUES ($1, $2, 'fish')")
        .bind(club)
        .bind(last_week)
        .execute(&s.db)
        .await
        .unwrap();
    let before: i32 = sqlx::query_scalar("SELECT treasury FROM clubs WHERE id = $1")
        .bind(club)
        .fetch_one(&s.db)
        .await
        .unwrap();
    assert_eq!(
        crate::clubtown::award_last_week(&s, fake_now)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        crate::clubtown::award_last_week(&s, fake_now)
            .await
            .unwrap(),
        0,
        "once"
    );
    let after: i32 = sqlx::query_scalar("SELECT treasury FROM clubs WHERE id = $1")
        .bind(club)
        .fetch_one(&s.db)
        .await
        .unwrap();
    assert_eq!(after, before + 30, "first place");
    assert!(kinds(&s, &a).await.contains(&"club_award".to_string()));
    let (st, lb) = call(&s, "GET", "/api/social/clubs/leaderboard", &a.token, None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(
        lb["standings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["mine"] == true),
        "{lb}"
    );

    // Back down to a room upstairs: the lot is free again.
    let (st, r) = post(
        &a,
        format!("/api/social/clubs/{id}/room"),
        json!({ "tier": 1 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, lots) = call(&s, "GET", "/api/social/clubs/lots", &d.token, None).await;
    assert!(
        lots["lots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|l| l["lot"] == lot.as_str())
            .unwrap()["club"]
            .is_null()
    );
    for (p, club) in [(&b, &id), (&a, &id), (&c, &other)] {
        post(p, format!("/api/social/clubs/{club}/leave"), json!({})).await;
    }
}
