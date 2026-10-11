//! Gardening (spec §7): plant seeds in soil plots, water them, and harvest
//! when ripe; growth runs on real time (`sim::garden`). Plots persist through
//! the economy service, which also moves the seeds and harvest. The zone
//! server keeps a display copy and announces stage changes.

use super::{Instance, Pending, now_ms};
use crate::econ::{CallError, Plot};
use commons_common::config;
use commons_protocol::{ServerMsg, error_code, plot_action};
use commons_sim::TilePos;
use commons_sim::garden::Growth;

/// How often growth is re-evaluated for display.
const GARDEN_TICK_MS: u32 = 2_000;

#[derive(Debug, Clone)]
pub(crate) struct PlotView {
    plant: u32,
    owner_name: String,
    growth: Growth,
    /// (stage, watered) last announced, to send only changes.
    shown: (u8, bool),
}

impl PlotView {
    fn from_plot(p: &Plot) -> Self {
        let growth = Growth {
            stage: p.stage as u8,
            stage_started_ms: p.stage_started_ms,
            watered: p.watered,
        };
        PlotView {
            plant: p.plant as u32,
            owner_name: p.owner_name.clone(),
            growth,
            shown: (u8::MAX, false),
        }
    }
}

fn stage_ms() -> i64 {
    config::growth_stage_ms()
}

impl Instance {
    /// Garden plots belong to a "space": the zone, or the owner's home.
    pub(super) fn space(&self) -> String {
        match &self.owner {
            Some(o) => format!("home:{o}"),
            None => self.zone.id.clone(),
        }
    }

    pub(super) fn load_plots(&self) {
        let (Some(econ), false) = (self.economy.clone(), self.soil.is_empty()) else {
            return;
        };
        let space = self.space();
        self.spawn_call(
            async move {
                loop {
                    match econ.plots(&space).await {
                        Err(CallError::Unavailable) => {
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await
                        }
                        other => return other,
                    }
                }
            },
            |inst, result| match result {
                Ok(plots) => {
                    for p in &plots {
                        inst.plots
                            .insert((p.x as u16, p.y as u16), PlotView::from_plot(p));
                    }
                    tracing::info!(space = %inst.space(), plots = plots.len(), "garden loaded");
                    inst.garden_tick_now();
                }
                Err(e) => tracing::error!(?e, "loading garden failed"),
            },
        );
    }

    fn plot_state(&self, t: TilePos, now_ms: i64) -> ServerMsg {
        let stage_ms = stage_ms();
        match self.plots.get(&t) {
            Some(p) => {
                let g = p.growth.at(now_ms, stage_ms);
                let left = if g.watered {
                    (stage_ms - (now_ms - g.stage_started_ms)).clamp(0, u32::MAX as i64)
                } else {
                    0
                };
                ServerMsg::PlotState {
                    x: t.0,
                    y: t.1,
                    plant: p.plant,
                    stage: g.stage,
                    watered: g.watered,
                    owner: p.owner_name.clone(),
                    stage_left_ms: left as u32,
                }
            }
            None => ServerMsg::PlotState {
                x: t.0,
                y: t.1,
                plant: 0,
                stage: 0,
                watered: false,
                owner: String::new(),
                stage_left_ms: 0,
            },
        }
    }

    pub(super) fn plots_in_cell(&self, cell: u16, now_ms: i64) -> Vec<ServerMsg> {
        self.plots
            .keys()
            .filter(|t| self.cell_of(**t) == cell)
            .map(|t| self.plot_state(*t, now_ms))
            .collect()
    }

    fn broadcast_plot(&mut self, t: TilePos) {
        let msg = self.plot_state(t, now_ms());
        if let Some(p) = self.plots.get_mut(&t)
            && let ServerMsg::PlotState { stage, watered, .. } = &msg
        {
            p.shown = (*stage, *watered);
        }
        self.broadcast(self.cell_of(t), &msg, None);
    }

    fn garden_tick_now(&mut self) {
        let now = now_ms();
        let stage_ms = stage_ms();
        let changed: Vec<TilePos> = self
            .plots
            .iter()
            .filter(|(_, p)| {
                let g = p.growth.at(now, stage_ms);
                (g.stage, g.watered) != p.shown
            })
            .map(|(t, _)| *t)
            .collect();
        for t in changed {
            self.broadcast_plot(t);
        }
    }

    pub(super) fn garden_tick(&mut self, now: u32) {
        if now < self.next_garden_tick {
            return;
        }
        self.next_garden_tick = now + GARDEN_TICK_MS;
        self.garden_tick_now();
    }

    pub(super) fn plot_action(&mut self, id: u32, t: TilePos, action: u8, item: u32, now: u32) {
        if self.moving(id, now) {
            self.avatars.get_mut(&id).unwrap().pending = Some(Pending::Plot {
                x: t.0,
                y: t.1,
                action,
                item,
            });
            return;
        }
        self.do_plot_action(id, t, action, item);
    }

    pub(super) fn do_plot_action(&mut self, id: u32, t: TilePos, action: u8, item: u32) {
        if !self.soil.contains(&t) {
            return self.error(id, error_code::BAD_MESSAGE, "that's not a garden plot");
        }
        let a = &self.avatars[&id];
        if self.owner.as_ref().is_some_and(|o| *o != a.player_id) {
            return self.error(id, error_code::NOT_ALLOWED, "this isn't your garden");
        }
        let d = (a.tile.0 as i32 - t.0 as i32)
            .abs()
            .max((a.tile.1 as i32 - t.1 as i32).abs());
        if d > 1 {
            return self.error(id, error_code::TOO_FAR, "walk next to the plot");
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(
                id,
                error_code::UNAVAILABLE,
                "the garden is resting; try again soon",
            );
        };
        if !self.busy.insert(t) {
            return;
        }
        let (space, player) = (self.space(), a.player_id.clone());
        let ripe = self
            .plots
            .get(&t)
            .map(|p| p.growth.at(now_ms(), stage_ms()).ripe());
        match action {
            plot_action::PLANT if self.plots.contains_key(&t) => {
                self.busy.remove(&t);
                self.error(
                    id,
                    error_code::NOT_ALLOWED,
                    "something is already growing there",
                );
            }
            plot_action::PLANT => {
                let key = self.next_key("plant");
                self.spawn_call(
                    async move { econ.plant(&space, t.0, t.1, &player, item, &key).await },
                    move |inst, r| {
                        inst.busy.remove(&t);
                        match r {
                            Ok(res) => {
                                if let Some(p) = &res.plot {
                                    inst.plots.insert(t, PlotView::from_plot(p));
                                    inst.broadcast_plot(t);
                                }
                                inst.send_granted(id, &res.applied);
                            }
                            Err(e) => inst.economy_error(id, e),
                        }
                    },
                );
            }
            plot_action::WATER => match ripe {
                None => {
                    self.busy.remove(&t);
                    self.error(id, error_code::NOT_ALLOWED, "plant a seed first");
                }
                Some(true) => {
                    self.busy.remove(&t);
                    self.error(id, error_code::NOT_ALLOWED, "it's ready to pick");
                }
                Some(false) => {
                    self.spawn_call(
                        async move { econ.water(&space, t.0, t.1).await },
                        move |inst, r| {
                            inst.busy.remove(&t);
                            match r {
                                Ok(Some(p)) => {
                                    inst.plots.insert(t, PlotView::from_plot(&p));
                                    inst.broadcast_plot(t);
                                }
                                Ok(None) => {}
                                Err(e) => inst.economy_error(id, e),
                            }
                        },
                    );
                }
            },
            plot_action::HARVEST if ripe == Some(true) => {
                let key = self.next_key("harvest");
                self.spawn_call(
                    async move { econ.harvest(&space, t.0, t.1, &player, &key).await },
                    move |inst, r| {
                        inst.busy.remove(&t);
                        match r {
                            Ok(res) => {
                                inst.plots.remove(&t);
                                inst.broadcast_plot(t);
                                inst.send_granted(id, &res.applied);
                            }
                            Err(e) => inst.economy_error(id, e),
                        }
                    },
                );
            }
            plot_action::HARVEST => {
                self.busy.remove(&t);
                self.error(id, error_code::NOT_ALLOWED, "it isn't ready yet");
            }
            _ => {
                self.busy.remove(&t);
                self.error(id, error_code::BAD_MESSAGE, "unknown garden action");
            }
        }
    }

    pub(super) fn economy_error(&mut self, id: u32, e: CallError) {
        if !self.avatars.contains_key(&id) {
            return;
        }
        match e {
            CallError::Rejected(msg) => self.error(id, error_code::NOT_ALLOWED, &msg),
            CallError::Unavailable => self.error(
                id,
                error_code::UNAVAILABLE,
                "that didn't go through; please try again",
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use commons_protocol::{ClientMsg, ServerMsg, error_code, plot_action};

    #[test]
    fn plot_actions_are_validated() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "gardener", (20, 12));
        place(&mut inst, 1, (8, 8));
        // Not soil.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::PlotAction {
                x: 8,
                y: 9,
                action: plot_action::PLANT,
                item: 200,
            },
        });
        // Soil but too far.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::PlotAction {
                x: 2,
                y: 2,
                action: plot_action::PLANT,
                item: 200,
            },
        });
        // Adjacent, but nothing to water.
        place(&mut inst, 1, (3, 3));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::PlotAction {
                x: 2,
                y: 2,
                action: plot_action::WATER,
                item: 0,
            },
        });
        inst.flush();
        a.pump();
        let codes: Vec<u16> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::Error { code, .. } => Some(*code),
                _ => None,
            })
            .collect();
        assert_eq!(
            codes,
            vec![
                error_code::BAD_MESSAGE,
                error_code::TOO_FAR,
                error_code::NOT_ALLOWED
            ]
        );
        assert!(inst.busy.is_empty());
    }
}
