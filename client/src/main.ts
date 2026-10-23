import { Application } from "pixi.js";
import cityUrl from "../../assets/maps/city.json?url";
import homeUrl from "../../assets/maps/home.json?url";
import mallUrl from "../../assets/maps/mall.json?url";
import barUrl from "../../assets/maps/bar.json?url";
import arcadeUrl from "../../assets/maps/arcade.json?url";
import libraryUrl from "../../assets/maps/library.json?url";
import libChildrenUrl from "../../assets/maps/library_children.json?url";
import libLitUrl from "../../assets/maps/library_lit.json?url";
import libWorldUrl from "../../assets/maps/library_world.json?url";
import libHistoryUrl from "../../assets/maps/library_history.json?url";
import libSocietyUrl from "../../assets/maps/library_society.json?url";
import libScienceUrl from "../../assets/maps/library_science.json?url";
import libArtsUrl from "../../assets/maps/library_arts.json?url";
import libReferenceUrl from "../../assets/maps/library_reference.json?url";
import clubHallUrl from "../../assets/maps/club_hall.json?url";
import clubRoomUrl from "../../assets/maps/clubroom.json?url";
import concertHallUrl from "../../assets/maps/concert_hall.json?url";
import casinoUrl from "../../assets/maps/casino.json?url";
import bowlingUrl from "../../assets/maps/bowling.json?url";
import { Economy } from "./economy";
import { Game, type Ui } from "./game";
import { Homes } from "./homes";
import { Rent } from "./rent";
import { ApiError, Auth, type Destination } from "./net/api";
import type { CloseReason } from "./net/socket";
import { Shop } from "./shop";
import { Pets } from "./pets";
import { Rides } from "./rides";
import { Goods } from "./goods";
import { DecoratePanel } from "./ui/exterior";
import { Social } from "./social";
import { Town } from "./town";
import { Gov } from "./gov";
import { CityMapPanel } from "./ui/citymap";
import { ReportPanel, StoryPanel, TownHallPanel } from "./ui/gov";
import { ApartmentsPanel, PostOfficePanel, StallPanel, YardPanel } from "./ui/homes";
import { DirectoryPanel, ShopPanel } from "./ui/mall";
import { Minimap } from "./ui/minimap";
import { FoundersPanel, WelcomePanel } from "./ui/welcome";
import { BottlesPanel, WishPanel } from "./ui/dream";
import { WardrobePanel } from "./ui/wardrobe";
import { HALL, Library, wingOfZone } from "./library";
import { BookCardPanel, CataloguePanel, type LibraryHost, MyBooksPanel, ReaderPanel, ShelfPanel } from "./ui/library";
import { Calls, PHONE } from "./calls";
import { IncomingCall, PhonePanel } from "./ui/phone";
import { Clubs } from "./clubs";
import { ClubsPanel } from "./ui/clubs";
import { Concert } from "./concert";
import { ConcertPanel } from "./ui/concert";
import { MetroPanel, playRide, stationsOf } from "./ui/metro";
import { BlackjackPanel, CagePanel, Casino, RoulettePanel, SlotsPanel, Tables } from "./ui/casino";
import { MOODS, MoodPicker, OfferCard } from "./activities/together";
import { GATHERINGS, Welcome, nextOccurrence } from "./welcome";
import { Soundscape } from "./ambient/sound";
import { Hud } from "./ui/hud";
import { LOGIN_NOTICE, signIn } from "./ui/login";
import { ActionMenu, AlbumPanel, BagPanel, MarketPanel, PlaceBanner, PlotMenu, ReelGame } from "./ui/panels";
import { FriendsPanel, NotificationsPanel } from "./ui/social";
import { GoalPanel, QuarterPanel, RequestsPanel } from "./ui/town";
import { EaselPanel } from "./activities/easel";
import { WordPanel } from "./activities/word";
import { type ZoneMap, spot } from "./world/map";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/600.css";
import "@fontsource/pixelify-sans/700.css";
import silkscreen400 from "@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2?url";
import silkscreen700 from "@fontsource/silkscreen/files/silkscreen-latin-700-normal.woff2?url";
import "./styles.css";

const MAP_URLS: Record<string, string> = {
  city: cityUrl,
  home: homeUrl,
  mall: mallUrl,
  bar: barUrl,
  arcade: arcadeUrl,
  library: libraryUrl,
  library_children: libChildrenUrl,
  library_lit: libLitUrl,
  library_world: libWorldUrl,
  library_history: libHistoryUrl,
  library_society: libSocietyUrl,
  library_science: libScienceUrl,
  library_arts: libArtsUrl,
  library_reference: libReferenceUrl,
  club_hall: clubHallUrl,
  clubroom: clubRoomUrl,
  bowling: bowlingUrl,
  concert_hall: concertHallUrl,
  casino: casinoUrl,
};
const ERR_REPLACED = 6;
const ERR_VERSION = 3;
const ERR_NAME_TAKEN = 14;

// Numbers and $ (prices, coins, counts) in Silkscreen: its blocky digits read
// clearly at small sizes, where Pixelify's 5 looks like an S. Only those
// characters come from it ("Commons Digits" leads the UI font, see styles.css).
for (const [url, weight] of [[silkscreen400, "400"], [silkscreen700, "700"]]) {
  const face = new FontFace("Commons Digits", `url(${url}) format("woff2")`, { weight, unicodeRange: "U+0024, U+0030-0039" });
  document.fonts.add(face);
  void face.load().catch(() => {});
}

const overlay = document.getElementById("overlay")!;

function showOverlay(title: string, text: string, action?: { label: string; run: () => void }) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  card.append(h, p);
  if (action) {
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = action.label;
    b.onclick = action.run;
    card.append(b);
  }
  overlay.replaceChildren(card);
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
  overlay.replaceChildren();
}

const maps = new Map<string, ZoneMap>();
async function loadMap(zone: string): Promise<ZoneMap> {
  let m = maps.get(zone);
  if (!m) {
    m = (await fetch(MAP_URLS[zone]).then((r) => r.json())) as ZoneMap;
    maps.set(zone, m);
  }
  // Each visit gets its own copy: placed furniture edits the collision layer.
  return structuredClone(m);
}

async function main() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const auth = new Auth();
  const resumed = new URLSearchParams(location.search).has("login") ? false : await auth.resume();
  if (!resumed) await signIn(overlay, auth);

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: "#6f8d62", // hedge green around maps smaller than the screen
    antialias: false,
    roundPixels: true, // keep sprites on whole device pixels
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById("stage")!.appendChild(app.canvas);

  let game: Game | null = null;
  const eco = new Economy(auth);
  const social = new Social(auth, auth.player!.id);
  const town = new Town(auth);
  const sound = new Soundscape();
  const gov = new Gov(auth);
  const townhall = new TownHallPanel(gov);
  const welcome = new Welcome(auth);
  const welcomePanel = new WelcomePanel(
    welcome,
    (spot) => walkToSpot(spot),
    (no) => hud.toast(`🌱 Founder #${no}! Your seedling is in the Founders' Grove, in the Park just north of the Market.`, 7000),
  );
  /** Walks to a named place in the city (going back to the city first if away). */
  const walkToSpot = (spot: string) => {
    if ((game as Game | null)?.walkToSpot(spot)) return;
    void travel({ zone: "city" }).then(() => window.setTimeout(() => (game as Game | null)?.walkToSpot(spot), 1500));
  };
  const place = new PlaceBanner(() => place.hide());
  const friendActions = {
    join: (f: { id: string }) => void travel({ friend: f.id }),
    visit: (f: { id: string }) => void travel({ zone: "home", owner: f.id }),
    visitId: (id: string) => void travel({ zone: "home", owner: id }),
    goHome: () => void travel({ zone: "home" }),
  };
  const hud = new Hud(document.getElementById("hud")!, {
    onChat: (text) => game?.chat(text),
    onEmote: (id) => game?.emote(id),
    onSit: () => game?.toggleSit(),
    onRide: () => game?.toggleRide(),
    onToys: () => game?.pickToy(),
    onBag: () => ui.bag.toggle(),
    onAlbum: () => ui.album.toggle(),
    onFriends: () => (ui.friends.open ? ui.friends.hide() : ui.friends.showList()),
    onNotifications: () => notifications.toggle(),
    onSound: () => sound.toggle(),
    onTasks: () => welcomePanel.show(),
    onMap: () => cityMap.toggle(),
    onBooks: () => myBooks.toggle(),
    onPhone: () => phone.toggle(),
    onClubs: () => (clubsPanel.open ? clubsPanel.hide() : clubsPanel.showList()),
    onMood: () => {
      moodPicker.setCurrent((game as Game | null)?.currentMood ?? 0);
      moodPicker.toggle();
    },
  });
  const homes = new Homes(auth);
  const rent = new Rent(auth);
  rent.onChange(() => {
    homes.cottage = rent.tiers("home")[0] ?? null;
    // Rent, stall sales and moving out all change coins or the bag.
    void eco.load().catch(() => {});
  });
  const cityMap = new CityMapPanel({
    where: () => {
      const g = game as Game | null;
      const here = g?.position;
      if (!g?.scene.map.streets || !here) return null;
      const home = homes.mine ? spot(g.scene.map, `door:${homes.mine}`) : null;
      return { map: g.scene.map, here, home };
    },
    walk: (t) => (game as Game | null)?.walkTo(t),
    toCity: () => void travel({ zone: "city" }),
  });
  const minimap = new Minimap(document.getElementById("hud")!, () => cityMap.toggle());
  homes.onChange(() => minimap.setHome(homes.mine));
  const rentHost = {
    walkToSpot: (s: string) => void (game as Game | null)?.walkToSpot(s),
    findHome: () => (game as Game | null)?.findHome() ?? false,
    goInside: () => void travel({ zone: "home" }),
    toast: (t: string) => hud.toast(t, 4500),
  };
  const postOffice = new PostOfficePanel(homes, rent, rentHost);
  const apartments = new ApartmentsPanel(homes, rent, rentHost);
  const stall = new StallPanel(rent, eco, rentHost);
  const shop = new Shop(auth, eco);
  const pets = new Pets(auth);
  const rides = new Rides(auth, eco);
  const goods = new Goods(auth, eco);
  const shopPanel = new ShopPanel(
    shop,
    eco,
    (dept, item) => ui.wardrobe.openFitting(dept, dept === "skins" ? "The mirror" : "Fitting room", item),
    () => (pets.mine ? "have_pet" : !rent.home ? "no_house" : rent.home.kind === "apartment" ? "apartment" : "ok"),
    (name) => {
      void pets.load().catch(() => {});
      hud.toast(`🐾 Welcome to the family, ${name}! They've gone ahead to wait in your yard. Walk home and take them out.`, 6500);
    },
    (item) => void (game as Game | null)?.testRide(item),
  );
  const directory = new DirectoryPanel({
    where: () => {
      const g = game as Game | null;
      const here = g?.position;
      return g && here ? { map: g.scene.map, here } : null;
    },
    walk: (t) => (game as Game | null)?.walkTo(t),
    newThisWeek: () => shop.newThisWeek().map((f) => ({ dept: f.dept, items: f.items.map((i) => eco.name(i)) })),
    endsAt: () => shop.endsAt,
  });
  const showMood = (m: number) => hud.setMood(m ? (MOODS.find((x) => x.id === m)?.icon ?? "💬") : "💬", m > 0);
  const moodPicker = new MoodPicker((m) => {
    game?.setMood(m);
    showMood(m);
    if (m) hud.toast(`${MOODS.find((x) => x.id === m)?.icon} Others now see you're ${MOODS.find((x) => x.id === m)?.label.toLowerCase()}.`, 3500);
  });
  hud.setMuted(sound.muted);
  const library = new Library(auth);
  const libraryHost: LibraryHost = {
    showMe: (at, id, title) => (game as Game | null)?.libraryShowMe(at, id, title),
    browse: (wing, n) => (game as Game | null)?.libraryBrowse(wing, n),
    cases: (wing) => (game as Game | null)?.libraryCases(wing) ?? 0,
  };
  const bookCard = new BookCardPanel(library, libraryHost);
  const reader = new ReaderPanel(library);
  bookCard.reader = reader;
  const myBooks = new MyBooksPanel(library, reader);
  const calls = new Calls(auth, social);
  calls.onToast = (t) => hud.toast(t, 4500);
  calls.soundMuted = () => sound.muted;
  const phone = new PhonePanel(calls);
  new IncomingCall(calls);
  const showPhone = () => hud.setPhone(eco.qty(PHONE) > 0 || calls.live, calls.live);
  calls.onChange(showPhone);
  eco.onChange(showPhone);
  const clubs = new Clubs(auth, social);
  const clubsPanel = new ClubsPanel(clubs, social, eco, {
    goToRoom: (id) => void travel({ zone: "clubroom", owner: id }),
    inRoom: () => {
      const g = game as Game | null;
      return g?.zoneId === "clubroom" ? (g.place.owner ?? null) : null;
    },
    toast: (t) => hud.toast(t, 4500),
    hasPhone: () => eco.qty(PHONE) > 0,
    callClub: (id) => calls.callClub(id),
    walkToSpot: (s) => walkToSpot(s),
  });
  // The clubhouses on the city's club lots (C3).
  void clubs.loadLots().catch(() => {});
  clubs.onToast = (t) => hud.toast(t, 6000);
  const casino = new Casino(auth);
  casino.onPlayed = () => void eco.load().catch(() => {});
  // The shared tables: live from the server; big wins told to the whole floor.
  const tables = new Tables(auth, auth.player!.id, social);
  tables.onCheer = (t) => hud.toast(t, 5000);
  tables.onCoins = () => void eco.load().catch(() => {});
  const concert = new Concert(auth, auth.player!.id, social);
  concert.onToast = (t) => hud.toast(t, 5000);
  const concertPanel = new ConcertPanel(concert, {
    walkOnStage: () => void (game as Game | null)?.walkToSpot("stage_spot"),
    toast: (t) => hud.toast(t, 4500),
  });
  // A meetup's reward (and anything else the gateway says changed your coins).
  social.onPush((m) => m.t === "coins" && void eco.load().catch(() => {}));
  // The 🛡 button lights up while an invite waits or a club's rent is due.
  clubs.onChange(() => hud.setClubs(clubs.invites.length > 0 || clubs.mine.some((c) => c.room?.state === "grace")));
  void clubs.load().catch(() => {});
  // Still on a call from before a reload: back onto it.
  void calls.resume().catch(() => {});
  library.onLoans((l) => {
    hud.setBooks(l.length);
    // Brought back while reading it away from the Library: it goes back too.
    const g = game as Game | null;
    if (reader.open && g && !g.zoneId.startsWith("library") && !library.isBorrowed(reader.bookId)) reader.hide();
  });
  void library.loadLoans().catch(() => {});
  const ui: Ui = {
    eco,
    hud,
    minimap,
    homes,
    rent,
    pets,
    rides,
    goods,
    decorate: new DecoratePanel(goods, homes),
    postOffice,
    apartments,
    stall,
    directory,
    shop: shopPanel,
    bag: new BagPanel(
      eco,
      (item) => {
        ui.bag.hide();
        place.show(item);
      },
      (item) => {
        ui.bag.hide();
        void (game as Game | null)?.rideOn(rides.ride === item.meta.code ? null : item);
      },
      (item) => rides.ride === item.meta.code,
      (item) => (game as Game | null)?.bagExtra(item) ?? null,
      () => (game as Game | null)?.openCrate(),
    ),
    album: new AlbumPanel(eco),
    market: new MarketPanel(eco),
    plot: new PlotMenu(eco, (x, y, action, item) => game?.plotAction(x, y, action, item)),
    reel: new ReelGame(),
    place,
    menu: new ActionMenu(),
    social,
    friends: new FriendsPanel(social, eco, friendActions),
    town,
    quarter: new QuarterPanel(town),
    requests: new RequestsPanel(town, eco),
    goal: new GoalPanel(town, eco, (g) => {
      game?.milestones.apply(g.reached);
      hud.toast(`The town reached “${g.title}”! 🎉`, 6000);
    }),
    easel: new EaselPanel(town, {
      sendPaint: (e, c, col) => game?.sendPaint(e, c, col),
      displays: () => game?.easels ?? null,
    }),
    word: new WordPanel(town, () => void eco.load().catch(() => {})),
    sound,
    gov,
    townhall,
    story: new StoryPanel(gov, (id) => void townhall.openAt({ kind: "proposal", id })),
    report: new ReportPanel(gov),
    welcome,
    welcomePanel,
    founders: new FoundersPanel(welcome, () => auth.player?.display_name ?? ""),
    bottles: new BottlesPanel(auth),
    wish: new WishPanel((text) => game?.releaseLantern(text)),
    offer: new OfferCard(),
    mood: moodPicker,
    wardrobe: new WardrobePanel(
      () => ({ look: auth.player?.look ?? 0, style: auth.player?.style ?? 0 }),
      async (look, style) => {
        await auth.saveLook(look, style);
        (game as Game | null)?.changeLook(look, style);
        hud.toast("✨ Looking good!", 3000);
      },
      eco,
      shop,
    ),
    library,
    bookCard,
    shelf: new ShelfPanel(library, bookCard, libraryHost),
    catalogue: new CataloguePanel(library, bookCard, libraryHost),
    reader,
    calls,
    phone,
    clubs,
    clubsPanel,
    concert,
    concertPanel,
    yard: new YardPanel(rent, eco, rentHost),
    casino,
    slots: new SlotsPanel(casino),
    roulette: new RoulettePanel(casino, tables),
    blackjack: new BlackjackPanel(casino, tables),
    cage: new CagePanel(casino),
    metro: new MetroPanel({
      map: () => {
        const g = game as Game | null;
        return g?.zoneId === "city" ? g.scene.map : null;
      },
      ride: (to) => (game as Game | null)?.rideMetro(to.key),
    }),
  };
  ui.catalogue.reader = reader;
  // The Caretaker's tasks chip, until you're a founder (or the season closes).
  welcome.onChange(() => {
    const s = welcome.status;
    if (!s || s.founder || (!s.season.open && welcome.done < 3)) return hud.setTasks(null);
    hud.setTasks(welcome.done === 3 ? "🌱 Plant your seedling!" : `🌿 Caretaker's tasks ${welcome.done}/3`);
  });
  const notifications = new NotificationsPanel(social, {
    ...friendActions,
    clubInvited: (id) => clubs.invites.some((i) => i.id === id),
    goToClubRoom: (id) => void travel({ zone: "clubroom", owner: id }),
    walkToSpot: (s) => walkToSpot(s),
    answerClub: (id, accept) =>
      void clubs
        .answer(id, accept)
        .then((r) => r.joined && hud.toast(`🛡 Welcome to ${clubs.club(id)?.name ?? "the club"}!`, 4000))
        .catch((e) => hud.toast(e instanceof ApiError ? e.message : "That didn't work.", 4000)),
  });
  eco.onChange(() => hud.setCoins(eco.coins));
  social.onChange(() => hud.setBadge(social.unreadCount));
  social.onToast = (t) => hud.toast(t, 4000);
  await Promise.all([eco.load().catch(() => {}), social.start().catch(() => {}), homes.load().catch(() => {}), rent.load().catch(() => {}), pets.load().catch(() => {}), rides.load().catch(() => {})]);
  eco.onChange(() => {
    (game as Game | null)?.showRideButton();
    (game as Game | null)?.showToys();
  });

  let dest: Destination = { zone: "city" };
  let retry = 0;
  /** Joins `dest`; on failure either retries (connection trouble) or throws (refused). */
  const enter = async (refusalThrows = false) => {
    try {
      const ticket = await auth.join(dest);
      const map = await loadMap(ticket.zone_id);
      // In the mall, put what's on show onto the displays before drawing.
      if (ticket.zone_id === "mall") {
        await shop.load().catch(() => {});
        shop.dress(map);
        // Once a week, a nudge about what's new.
        const seen = (() => {
          try {
            return localStorage.getItem("commons.mallRotation");
          } catch {
            return null;
          }
        })();
        const fresh = shop.newThisWeek().flatMap((f) => f.items.map((i) => eco.name(i)));
        if (seen !== String(shop.rotation) && fresh.length) {
          window.setTimeout(() => hud.toast(`🛍️ New at the mall this week: ${fresh.slice(0, 4).join(", ")}${fresh.length > 4 ? "…" : ""}`, 6000), 1500);
          try {
            localStorage.setItem("commons.mallRotation", String(shop.rotation));
          } catch {
            // storage unavailable
          }
        }
      }
      // In a club room, its banner shows the club's crest and colour.
      if (ticket.zone_id === "clubroom" && ticket.owner) {
        if (!clubs.club(ticket.owner)) await clubs.load().catch(() => {});
        const c = clubs.club(ticket.owner);
        for (const o of map.objects) {
          if (o.kind !== "club_banner" || !c) continue;
          o.label = c.name;
          o.sign = c.crest;
          o.color = c.color;
        }
      }
      const placeInfo = { label: ticket.label, owner: ticket.owner };
      if (!game || game.zoneId !== ticket.zone_id || game.place.owner !== placeInfo.owner) {
        game?.destroy();
        game = new Game(app, map, ticket.zone_id, placeInfo, ui, document.getElementById("labels")!, {
          onWelcome: () => (retry = 0),
          onDisconnect,
          // Out of a door into the city: you come out of that door (a
          // house, or a public place: the mall, the bar, the arcade, the
          // library). Out of a library wing, you're back at its door in the hall.
          onTravel: (z, given) => {
            const from = game as Game | null;
            // The metro: a short ride underground, then up the stairs at the station.
            if (given?.startsWith("place:metro_") && from) {
              const key = given.slice("place:".length);
              const to = stationsOf(from.scene.map).find((s) => s.key === key);
              const ride = playRide(to?.name ?? "the next station");
              void Promise.all([travel({ zone: z, arrive: given }), ride.arrived]).finally(() => ride.done());
              return;
            }
            // Out of a club's room whose clubhouse stands on a lot: out of its door, in the city.
            const lot = from?.zoneId === "clubroom" && from.place.owner ? clubs.lotOf(from.place.owner) : null;
            if (z === "club_hall" && lot) return void travel({ zone: "city", arrive: `place:${lot}` });
            const place = from && ["mall", "bar", "arcade", HALL, "club_hall", "bowling", "concert_hall", "casino"].includes(from.zoneId) ? `place:${from.zoneId}` : undefined;
            const arrive =
              (z === HALL && from && wingOfZone(from.zoneId)) || (z === "club_hall" && from?.zoneId === "clubroom")
                ? `place:${from.zoneId}`
                : z !== "city"
                  ? undefined
                  : from?.zoneId === "home"
                    ? (from.place.owner ?? "home")
                    : place;
            void travel({ zone: z, arrive });
          },
          onVisit: (owner) => void travel({ zone: "home", owner }),
        });
        if (import.meta.env.DEV) (window as unknown as { __commons: Game }).__commons = game;
      }
      // A friend's location becomes the place to reconnect to.
      dest = { zone: ticket.zone_id, owner: ticket.owner ?? undefined };
      game.connect(ticket.server_url, ticket.join_token);
      hideOverlay();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.signOut();
        location.reload();
        return;
      }
      if (refusalThrows && e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      scheduleRetry();
    }
  };
  let travelling = false;
  const travel = async (to: Destination) => {
    // A second tap on a door while we're already on our way is ignored.
    if (travelling) return;
    travelling = true;
    const previous = dest;
    dest = to;
    document.body.classList.add("fading");
    await new Promise((r) => setTimeout(r, 250));
    try {
      await enter(true);
    } catch (e) {
      dest = previous;
      hud.toast(e instanceof ApiError ? e.message : "You can't go there right now.", 4000);
    } finally {
      document.body.classList.remove("fading");
      travelling = false;
    }
  };
  const scheduleRetry = () => {
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    showOverlay("Reconnecting…", "Lost the connection to the park. Trying again shortly.");
    window.setTimeout(() => void enter(), delay);
  };
  const onDisconnect = (reason: CloseReason) => {
    if (reason?.code === ERR_REPLACED) {
      showOverlay("You joined from somewhere else", "Commons is open in another tab or device.", {
        label: "Play here instead",
        run: () => void enter(),
      });
    } else if (reason?.code === ERR_NAME_TAKEN) {
      // Someone's already playing under this name: back to the login, to pick another.
      const name = auth.player?.display_name ?? "That name";
      auth.signOut();
      try {
        sessionStorage.setItem(LOGIN_NOTICE, `${name} is already playing right now. Pick another name to play as someone else.`);
      } catch {
        // storage unavailable: the login screen just won't say why
      }
      location.reload();
    } else if (reason?.code === ERR_VERSION) {
      showOverlay("Commons was updated", "Reload to get the latest version.", { label: "Reload", run: () => location.reload() });
    } else {
      scheduleRetry();
    }
  };

  const status = await welcome.load().catch(() => null);
  await enter();
  showMood((game as Game | null)?.currentMood ?? 0);
  // First visit: the Caretaker says hello. Afterwards, keep the tasks fresh
  // (sitting together is reported by the zone about once a minute).
  if (status && !status.founder) {
    let met = false;
    try {
      met = localStorage.getItem("commons.metCaretaker") === "1";
      localStorage.setItem("commons.metCaretaker", "1");
    } catch {
      // storage unavailable
    }
    if (!met) window.setTimeout(() => welcomePanel.show(), 1500);
  }
  window.setInterval(() => {
    const s = welcome.status;
    if (s && !s.founder && welcome.done < 3) void welcome.load().catch(() => {});
  }, 20_000);
  // Gathering hours: a nudge when one is about to start, or has just begun.
  const nudged = new Set<string>();
  const gatherings = () => {
    const now = Date.now();
    for (const g of GATHERINGS) {
      const { start } = nextOccurrence(g, now);
      const key = `${g.key}:${start}`;
      if (nudged.has(key)) continue;
      if (start - now <= 10 * 60_000 && now - start <= 15 * 60_000) {
        nudged.add(key);
        hud.toast(start > now ? `🌆 ${g.title} starts in ${Math.ceil((start - now) / 60_000)} min, at ${g.where}.` : `🌆 ${g.title} has begun, at ${g.where}. Come along!`, 7000);
      }
    }
  };
  window.setTimeout(gatherings, 9000);
  window.setInterval(gatherings, 60_000);
  // A gentle nudge when there's a vote you can take part in.
  gov
    .loadStory()
    .then((s) => {
      const me = s.me;
      if (!me) return;
      const open = s.open.find((o) => !me.voted.includes(o.id) && (o.status === "voting" || o.status === "collecting"));
      if (open && (me.can_vote_founding || me.can_vote)) {
        hud.toast(`🗳 ${open.status === "voting" ? "A town vote is open" : "The town is collecting ideas"}: “${open.title}”. Visit the Town Hall.`, 7000);
      }
    })
    .catch(() => {});
  // A small daily gift, no streaks (spec §8.3).
  eco
    .daily()
    .then((g) => g && hud.toast(`A little gift for today: ${g.qty}× ${eco.name(g.item)} 🌱`, 5000))
    .catch(() => {});
}

main().catch((e) => {
  console.error(e);
  showOverlay("Couldn't start Commons", String(e?.message ?? e));
});
