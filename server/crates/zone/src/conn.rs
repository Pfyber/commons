//! One WebSocket client: handshake, then relays decoded messages to its
//! instance and the instance's batched frames back to the socket.

use crate::instance::{Clock, Cmd, ConnId};
use crate::registry::Registry;
use axum::extract::ws::{Message, WebSocket};
use bytes::Bytes;
use commons_common::ratelimit::Bucket;
use commons_common::token::{self, JoinClaims};
use commons_protocol::{
    ClientMsg, PROTOCOL_VERSION, ServerMsg, error_code, push_framed, split_frame,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub const MAX_INBOUND_FRAME: usize = 8 * 1024;
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// Frames buffered toward a client before it is considered too slow.
const OUT_QUEUE: usize = 32;

static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

fn frame_of(msg: &ServerMsg) -> Bytes {
    let mut f = Vec::new();
    push_framed(&mut f, &msg.to_bytes());
    Bytes::from(f)
}

async fn reject(socket: &mut WebSocket, code: u16, message: &str) {
    let _ = socket
        .send(Message::Binary(frame_of(&ServerMsg::Error {
            code,
            message: message.into(),
        })))
        .await;
    let _ = socket.close().await;
}

/// Reads the first frame and expects a single `Hello`.
async fn read_hello(socket: &mut WebSocket) -> Option<ClientMsg> {
    let msg = tokio::time::timeout(HELLO_TIMEOUT, socket.recv())
        .await
        .ok()??
        .ok()?;
    let Message::Binary(data) = msg else {
        return None;
    };
    let first = split_frame(&data).next()?.ok()?;
    ClientMsg::decode(first).ok()
}

/// Gives the player's claim back when the session ends, however it ends.
struct Claim<'a> {
    registry: &'a Registry,
    player: String,
}

impl Drop for Claim<'_> {
    fn drop(&mut self) {
        self.registry.release(&self.player);
    }
}

pub async fn session(mut socket: WebSocket, registry: Arc<Registry>) {
    let Some(ClientMsg::Hello {
        join_token,
        version,
        view_w,
        view_h,
        device,
    }) = read_hello(&mut socket).await
    else {
        return reject(&mut socket, error_code::BAD_MESSAGE, "expected Hello").await;
    };
    if version != PROTOCOL_VERSION {
        return reject(
            &mut socket,
            error_code::VERSION_MISMATCH,
            "please reload: the game was updated",
        )
        .await;
    }
    let claims: JoinClaims = match token::verify(&registry.secret, &join_token) {
        Ok(c) => c,
        Err(e) => return reject(&mut socket, error_code::UNAUTHORIZED, &e.to_string()).await,
    };
    let Some(instance) = registry.instance(&claims.zone, claims.instance, claims.owner.clone())
    else {
        return reject(&mut socket, error_code::UNKNOWN_ZONE, "unknown zone").await;
    };
    if !registry.claim(&claims.sub, device) {
        return reject(&mut socket, error_code::NAME_TAKEN, "someone is already playing under this name").await;
    }
    let _claim = Claim { registry: &registry, player: claims.sub.clone() };

    let conn: ConnId = NEXT_CONN.fetch_add(1, Ordering::Relaxed);
    let player = claims.sub.clone();
    tracing::debug!(conn, %player, zone = %claims.zone, instance = claims.instance, "joined");

    // The instance holds the only strong sender: when it drops the avatar, the
    // channel closes and the writer below ends the session. Pongs go through a
    // weak sender so they never keep a removed connection alive.
    let (out_tx, mut out_rx) = mpsc::channel::<Bytes>(OUT_QUEUE);
    let pong_tx = out_tx.downgrade();
    if instance
        .tx
        .send(Cmd::Join {
            conn,
            claims,
            view: (view_w, view_h),
            out: out_tx,
        })
        .await
        .is_err()
    {
        return;
    }

    let (mut sink, mut stream) = socket.split();
    let writer = async {
        while let Some(frame) = out_rx.recv().await {
            if sink.send(Message::Binary(frame)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    };

    let clock: Clock = instance.clock;
    let inbox = instance.tx.clone();
    let reader = async {
        let start = Instant::now();
        let mut flood = Bucket::new(60.0, 30.0);
        while let Some(Ok(msg)) = stream.next().await {
            let data = match msg {
                Message::Binary(d) => d,
                Message::Close(_) => break,
                _ => continue,
            };
            for raw in split_frame(&data) {
                if !flood.try_take(start.elapsed().as_millis() as u64) {
                    tracing::info!(conn, "inbound flood, disconnecting");
                    return;
                }
                let Ok(msg) = raw.and_then(ClientMsg::decode) else {
                    tracing::debug!(conn, "undecodable message, disconnecting");
                    return;
                };
                if let ClientMsg::Ping { client_t } = msg {
                    // Answered here, not in the tick, so clock sync isn't skewed by batching.
                    if let Some(tx) = pong_tx.upgrade() {
                        let _ = tx.try_send(frame_of(&ServerMsg::Pong {
                            client_t,
                            server_t: clock.now_ms(),
                        }));
                    }
                    continue;
                }
                if inbox.send(Cmd::Msg { conn, msg }).await.is_err() {
                    return;
                }
            }
        }
    };

    tokio::select! {
        _ = writer => {}
        _ = reader => {}
    }
    let _ = instance.tx.send(Cmd::Leave { conn }).await;
    tracing::debug!(conn, %player, "left");
}
