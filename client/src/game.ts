// Ties the zone connection, world rendering, avatars, input and HUD together.

import { type Application, type FederatedPointerEvent, Graphics, Sprite, Text } from "pixi.js";
import { Ball } from "./activities/ball";
import { ChessPanel, type GameStateMsg } from "./activities/chess";
import { EaselDisplays, type EaselPanel } from "./activities/easel";
import { JamPanel, beatTime, playNote } from "./activities/jam";
import type { WordPanel } from "./activities/word";
import { Cat } from "./ambient/cat";
import { Caretaker } from "./ambient/caretaker";
import { ATTENDANT, BARTENDER, Clerk, FISHERMAN, LIBRARIAN } from "./ambient/clerk";
import { ArcadePanel, BEAT_MS, BOT as ARCADE_BOT, PLAYING as ARCADE_PLAYING } from "./activities/arcade";
import { PrizePanel } from "./ui/prizes";
import { PoolPanel } from "./activities/pool";
import { CANCELLED, CHOOSING, RpsPicker, beats, pickIcon } from "./activities/rps";
import { Sky } from "./ambient/sky";
import { Campfire } from "./activities/campfire";
import { FOLLOW, type MoodPicker, type OfferCard, STOP_FOLLOW, TOGETHER } from "./activities/together";
import type { BottlesPanel, WishPanel } from "./ui/dream";
import type { WardrobePanel } from "./ui/wardrobe";
import { Critters } from "./ambient/critters";
import type { Soundscape } from "./ambient/sound";
import * as sfx from "./ambient/sfx";
import { Weather } from "./ambient/weather";
import { BigScreen } from "./activities/screen";
import { Ambient } from "./ambient/ambient";
import { DayNight } from "./ambient/daynight";
import type { Economy, Item } from "./economy";
import type { ServerMsg } from "./net/protocol.gen";
import type { Social } from "./social";
import type { Gov } from "./gov";
import type { Town } from "./town";
import type { FriendsPanel } from "./ui/social";
import type { ReportPanel, StoryPanel, TownHallPanel } from "./ui/gov";
import type { GoalPanel, QuarterPanel, RequestsPanel } from "./ui/town";
import { type FoundersPanel, STAGES, type WelcomePanel } from "./ui/welcome";
import { type Welcome, happeningNow } from "./welcome";
import { Grove } from "./world/grove";
import { tier } from "./ui/rarity";
import { CatchShows } from "./world/catchfx";
import { FlopShows } from "./world/flopfx";
import { type CloseReason, ZoneSocket } from "./net/socket";
import type { Homes } from "./homes";
import type { Pets } from "./pets";
import type { Rides } from "./rides";
import type { Goods } from "./goods";
import type { DecoratePanel } from "./ui/exterior";
import { HouseFronts } from "./world/housefronts";
import { CARDS, wrappedTexture } from "./world/goods";
import { EMOTES } from "./world/avatars";
import { rideSpeed } from "./world/vehicles";
import { itemIconUrl } from "./world/items";
import { PetLife, petTitle } from "./ambient/petlife";
import { PET_SOUNDS } from "./world/pets";
import type { Rent } from "./rent";
import type { ApartmentsPanel, PostOfficePanel, StallPanel } from "./ui/homes";
import type { Hud } from "./ui/hud";
import type { DirectoryPanel, ShopPanel } from "./ui/mall";
import type { Minimap } from "./ui/minimap";
import { type ActionMenu, type AlbumPanel, type BagPanel, FishermanPanel, type MarketPanel, Panel, ROD_ITEM, type PlaceBanner, type PlotMenu, type ReelGame, isTyping } from "./ui/panels";
import { Avatar, CAST_SWING_MS, PUMP_MS } from "./world/avatars";
import { Furniture } from "./world/furniture";
import { type MapObject, type ZoneMap, groundAt, nearestWalkable, spot, stepTarget, walkable } from "./world/map";
import { type TileXY, WALK_SPEED_X10, endT, splice, sprintProfile } from "./world/motion";
import { compress, route } from "./world/path";
import { Props } from "./world/props";
import { giftBoxTexture } from "./world/items";
import { TILE } from "./world/art";
import { encodeLook } from "./world/look";
import { Milestones } from "./world/milestones";
import { Scene } from "./world/scene";
import { HALL, type Library, NEW, type Place as BookPlace, wingOfZone, wingZone } from "./library";
import type { BookCardPanel, CataloguePanel, ReaderPanel, ShelfPanel } from "./ui/library";
import type { Calls } from "./calls";
import type { PhonePanel } from "./ui/phone";
import { LibraryRoom } from "./world/libraryroom";

/** Error codes from server/crates/protocol (error_code). */
const ERR = { NO_PATH: 4, RATE_LIMITED: 5, REPLACED: 6, UNAUTHORIZED: 2, VERSION_MISMATCH: 3 };
/** Errors worth showing to the player as-is. */
const TOAST_CODES = new Set([ERR.RATE_LIMITED, 9, 10, 11, 12, 13]);
const FISHING = 2;
/** The Dance Off's AI bot dancer (not a server avatar): an id clear of real ones, and a party look. */
const DANCE_BOT_ID = 0xfffffff7;
const DANCE_BOT_LOOK = encodeLook({ hue: 200, skin: 0, hair: 4, hat: 0, hatHue: 0, style: 5, accessory: 2, outfit: 6 });

/** Protocol `drink::*`. */
const BEER = 1;
const WATER = 2;
const FISH = { CAST: 0, BITE: 1, CAUGHT: 2, ESCAPED: 3, FLOP: 4, HIT: 5 };
/** protocol `fish_event::FLOP_MS`; and the treasure chest (opened for coins). */
const FLOP_MS = 4500;
const TREASURE_ITEM = 113;
/** Casts reach this far from where you stand (server: CAST_RANGE). */
const CAST_RANGE = 2;
/** Matches the server's bite window minus a little latency headroom. */
const REEL_WINDOW_MS = 2300;

/** UI shared across zones (created once in main). */
export interface Ui {
  hud: Hud;
  minimap: Minimap;
  homes: Homes;
  rent: Rent;
  pets: Pets;
  rides: Rides;
  goods: Goods;
  decorate: DecoratePanel;
  postOffice: PostOfficePanel;
  apartments: ApartmentsPanel;
  stall: StallPanel;
  directory: DirectoryPanel;
  shop: ShopPanel;
  eco: Economy;
  bag: BagPanel;
  album: AlbumPanel;
  market: MarketPanel;
  plot: PlotMenu;
  reel: ReelGame;
  place: PlaceBanner;
  menu: ActionMenu;
  social: Social;
  friends: FriendsPanel;
  town: Town;
  quarter: QuarterPanel;
  requests: RequestsPanel;
  goal: GoalPanel;
  easel: EaselPanel;
  word: WordPanel;
  sound: Soundscape;
  gov: Gov;
  townhall: TownHallPanel;
  story: StoryPanel;
  report: ReportPanel;
  welcome: Welcome;
  welcomePanel: WelcomePanel;
  founders: FoundersPanel;
  bottles: BottlesPanel;
  wish: WishPanel;
  offer: OfferCard;
  mood: MoodPicker;
  wardrobe: WardrobePanel;
  library: Library;
  catalogue: CataloguePanel;
  shelf: ShelfPanel;
  bookCard: BookCardPanel;
  reader: ReaderPanel;
  calls: Calls;
  phone: PhonePanel;
}

/** What the Caretaker lets slip about the park's secret places. */
const SECRET_HINTS = [
  "They say the willows in the meadow keep a secret. Try walking right through them.",
  "Ever counted the pines in the Woods? One of them isn't quite a pine.",
  "Those stepping stones by the pier lead somewhere quiet.",
  "Whatever's said at the heart of the maze stays there.",
  "Lie on a picnic blanket after dark and watch for shooting stars.",
  "If you've something kind to say to a stranger, the bottles at the pier will carry it.",
  "Sit by the campfire on the west field. There's always a question to talk about.",
];

/** Secret places: discovery keys by nook name. */
const NOOKS: Record<string, string> = {
  "The Willow Hideaway": "nook_willow",
  "The Moss Grotto": "nook_grotto",
  "The Little Island": "nook_island",
  "The Heart of the Maze": "nook_maze",
};

/** Things to find in the park; remembered per browser. */
const DISCOVERIES: Record<string, string> = {
  old_oak: "The Old Oak. They say it was here long before the town.",
  well: "You make a wish at the well.",
  maze_heart: "You found the heart of the maze 🌿",
  tiny_door: "You knock on the tiny door. Someone very small giggles inside.",
  fairy_ring: "A ring of mushrooms in a hidden clearing. It feels like a secret.",
  nook_willow: "🤫 The Willow Hideaway. The branches close behind you; only people in here can hear you.",
  nook_grotto: "🤫 The Moss Grotto. One of those pines wasn't a pine at all. Only people in here can hear you.",
  nook_island: "🤫 The Little Island. The pond keeps your secrets: only people here can hear you.",
  nook_maze: "🤫 The Heart of the Maze. Whatever you say here stays here.",
};
const WISHES = [
  "The water ripples. Somewhere, something nice is on its way.",
  "A coin glints at the bottom. Someone else wished here too.",
  "The echo says your wish back, a little softer.",
  "A frog surfaces, considers you, and approves.",
  "You feel lighter. Wishes are like that.",
];
const PURRS = [
  "Biscuit purrs and headbutts your hand.",
  "Biscuit rolls over. It's a trap, but a nice one.",
  "Biscuit blinks slowly at you. That's cat for ‘friend’.",
  "Biscuit purrs like a tiny engine.",
];
const FOUND_KEY = "commons.discoveries";
function found(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOUND_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Where this Game is: label for the HUD and, for homes, whose. */
export interface Place {
  label: string;
  owner: string | null;
}

/** Tiles in front of the cottage door where gifts are left (home map). */
const DOORSTEP: TileXY[] = [
  { x: 8, y: 10 },
  { x: 11, y: 10 },
  { x: 7, y: 10 },
  { x: 12, y: 10 },
  { x: 6, y: 10 },
  { x: 13, y: 10 },
];

/** Invisible map objects (areas and named places): never what you tapped. */
const MARKERS = new Set(["spot", "dept", "nook", "grove_slot"]);
/** Objects whose art reaches only a tile above them (rows of bookcases, an aisle apart). */
const LOW_REACH = new Set(["bookcase", "stack_sign"]);

const cheb = (a: TileXY, b: TileXY) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const SITTING = 1;
const SEAT_GROUND = 0xffffffff;
/** Spectators further than this from a table stop following its game. */
const WATCH_RANGE = 12;
/** Names are drawn for the nearest few avatars only, to keep crowds readable. */
const MAX_NAMES = 25;
/** How far ahead a held arrow key plans the walk (twice that on a board). */
const KEY_STEPS = 6;
/** No input for this long and you're away from the keyboard (you doze off). */
const AWAY_AFTER_MS = 60_000;
/** Map objects that are game machines (the server numbers them in map order, as here). */
const CABINET_KINDS = ["arcade_cabinet", "dance_machine", "pinball"];
const KEY_RESEND_MS = 180;
/** Two key presses or taps closer together than this ask for a sprint. */
const SPRINT_ASK_MS = 350;

const KEY_DIRS: Record<string, TileXY> = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 },
};

export class Game {
  readonly scene: Scene;
  /** The fairy ring's clearing, found by walking into it. */
  private fairyRing: TileXY | null;
  private socket: ZoneSocket | null = null;
  private avatars = new Map<number, Avatar>();
  private selfId = 0;
  private keys = new Set<string>();
  private lastKeyDir = "";
  private lastKeySend = 0;
  /** Walks we've predicted and sent, oldest first, awaiting the server's echo. */
  private sentMoves: { x: number; y: number; at: number }[] = [];
  /**
   * Sprinting (outdoors): a direction key pressed twice in quick succession,
   * a tile tapped twice, or tiles tapped one after another quickly. It lasts
   * while the keys are held, or until the walk ends.
   */
  private sprint = false;
  private sprintAt = 0;
  private lastTapAt = 0;
  private keyPressAt: Record<string, number> = {};
  private disposers: (() => void)[] = [];
  private furniture: Furniture;
  private games = new Map<number, GameStateMsg>();
  private chess: ChessPanel;
  private screen: BigScreen | null = null;
  readonly props: Props;
  private hud: Hud;
  private ambient: Ambient;
  private daynight: DayNight;
  readonly milestones: Milestones;
  /** Corner activities, where the map has them. */
  private jam: JamPanel | null = null;
  easels: EaselDisplays | null = null;
  private ball: Ball | null = null;
  private weather: Weather;
  private critters: Critters;
  private cat: Cat | null = null;
  private caretaker: Caretaker | null = null;
  private petLife: PetLife;
  private endingTest = false;
  private houseFronts: HouseFronts | null = null;
  /** Garden plots, watered or not, as last seen (to show a can being used). */
  private wateredSeen = new Map<string, boolean>();
  private clerk: Clerk | null = null;
  /** In the Library's hall or one of its wings. */
  private libraryRoom: LibraryRoom | null = null;
  /** Your three hands while a rock paper scissors match waits on your pick. */
  private rpsPicker = new RpsPicker((pick) => this.socket?.send({ t: "RpsPick", pick }));
  /** The bar's pool table, where the map has one. */
  private pool: PoolPanel | null = null;
  /** The arcade's cabinets and its prize counter, where the map has them. */
  private arcade: ArcadePanel | null = null;
  /** When who's playing at which table was last worked out. */
  private playingCheckAt = 0;
  /** Fish just landed, held up above their anglers. */
  private catches: CatchShows;
  /** Rare fish flopping on the bank, to be hit; and where each angler's line went in. */
  private flops: FlopShows;
  private castAt = new Map<number, TileXY>();
  /** The fisherman on the pier, who buys your catch. */
  private fisherman: FishermanPanel | null = null;
  private prizes: PrizePanel | null = null;
  /** The Dance Off machine: its number, the light-up floor and the scoreboard over it. */
  private dance: { cab: number; floor: MapObject; lights: Graphics; board: Text } | null = null;
  /** Dancing next to you when you take on the AI bot at the Dance Off. */
  private danceBot: Avatar | null = null;
  /** A building we're walking to the door of, to go in once we get there. */
  private entering: { door: TileXY; zone: string } | null = null;
  /** When your own wooziness wears off. */
  private soberTimer = 0;
  private grove: Grove | null = null;
  private caretakerTalkAt = 0;
  private sky: Sky;
  private campfire: Campfire | null = null;
  /** For each tile, the nook it's in (0: none), and their names. */
  private nookOf: Uint8Array;
  private nookNames: string[] = [];
  private inNook = 0;
  /** Whom we walk after, and who walks after us. */
  private following: number | null = null;
  private followers = new Set<number>();
  private followGoal = "";
  private followCheckAt = 0;
  /** The mood we show others, kept across zones and visits. */
  private mood = loadMood();
  private ringCheckAt = 0;

  constructor(
    private app: Application,
    map: ZoneMap,
    readonly zoneId: string,
    readonly place: Place,
    private ui: Ui,
    private labels: HTMLElement,
    private events: {
      onWelcome(): void;
      onDisconnect(reason: CloseReason): void;
      onTravel(zone: string): void;
      /** Knock on someone's home: visit them if they've invited you. */
      onVisit(owner: string): void;
    },
  ) {
    this.hud = ui.hud;
    this.scene = new Scene(app, map);
    ui.minimap.setMap(map);
    this.fairyRing = spot(map, "fairy_ring");
    this.props = new Props(this.scene, map, ui.eco);
    ui.bag.placeable = zoneId === "home" && place.owner === ui.social.selfId;
    this.furniture = new Furniture(map);
    const screenObj = map.objects.find((o) => o.kind === "big_screen");
    if (screenObj) {
      this.screen = new BigScreen(screenObj);
      this.scene.sorted.addChild(this.screen.sprite);
    }
    // Indoors (the mall, the bar, the arcade, the library): the lights are
    // on, no weather, no birds, no wheels, no sprinting; the arcade is lit by neon.
    const indoors = zoneId === "mall" || zoneId === "bar" || zoneId === "arcade" || zoneId.startsWith("library");
    this.ambient = new Ambient(this.scene, map, indoors);
    this.daynight = new DayNight(app, this.scene, map, indoors, zoneId === "arcade");
    this.milestones = new Milestones(this.scene, map, (x, y, s) => this.daynight.addLight(x, y, s), app.stage);
    if (zoneId === "city") {
      ui.town
        .loadGoal()
        .then((g) => this.milestones.apply(g.reached))
        .catch(() => {});
    }
    this.setupCorners(map);
    this.weather = new Weather(app, this.scene, map, indoors);
    this.catches = new CatchShows(this.scene);
    this.flops = new FlopShows(this.scene);
    this.critters = new Critters(app, this.scene, map);
    if (zoneId === "city") {
      this.cat = new Cat(map);
      if (this.cat.active) this.scene.sorted.addChild(this.cat.sprite);
      const grove = new Grove(map, this.scene.sorted);
      if (grove.active) this.grove = grove;
      if (map.objects.some((o) => o.kind === "founders_stone")) this.caretaker = new Caretaker(map, this.scene, labels);
    }
    this.petLife = new PetLife(
      this.scene,
      map,
      ui.pets,
      ui.eco,
      {
        self: () => this.self,
        avatars: () => this.avatars.values(),
        toast: (t, ms) => this.hud.toast(t, ms),
        refreshLook: () => this.refreshLook(),
      },
      zoneId === "city",
    );
    if (zoneId === "city") void ui.pets.load().catch(() => {});
    // Through a door, you get off what you ride (it waits for you outside);
    // a test ride ends when you leave the mall.
    const rides = ui.rides;
    if ((zoneId !== "city" && rides.riding) || (zoneId !== "mall" && rides.testRide)) {
      const was = rides.riding ? rides.item(rides.ride)?.name : null;
      void rides
        .set(0)
        .then(() => {
          this.refreshLook();
          if (was) this.hud.toast(`You hop off the ${was.toLowerCase()} at the door. It'll be waiting when you're back outside.`, 4000);
        })
        .catch(() => {});
    }
    this.showRideButton();
    this.showToys();
    if (zoneId === "city") {
      this.houseFronts = new HouseFronts(this.scene, map, ui.goods);
      void ui.goods.loadHouses().catch(() => {});
    }
    // In through your own front door: a pet out with you is home.
    if (zoneId === "home" && place.owner === ui.social.selfId && ui.pets.mine?.out) void this.petLife.bringHome().catch(() => {});
    // The fisherman stands still on his spot (a one-tile "counter" just below it).
    const fisher = map.objects.find((o) => o.kind === "fisherman");
    if (fisher) {
      this.clerk = new Clerk(map, { ...fisher, x: fisher.x - 1, y: fisher.y + 1, w: 3, h: 1 }, this.scene, labels, FISHERMAN);
      this.fisherman = new FishermanPanel(ui.eco, (coins, best) => {
        this.clerk?.say(coins >= 8 ? `Now that's a catch! ${coins} coins for you.` : `${coins} coins, as promised. Thanks!`);
        this.hud.toast(`🎣 Sold to the fisherman: +${coins} coins (best: ${best.name})`, 3500);
      }, () => {
        this.clerk?.say("She's a beauty. Fish'll practically jump onto that hook!");
        this.hud.toast("🎣 You bought the Angler's Rod! Fish bite sooner and you get an extra swing.", 4500);
      });
    }
    const bar = map.objects.find((o) => o.kind === "bar_counter");
    if (bar) this.clerk = new Clerk(map, bar, this.scene, labels, BARTENDER);
    // What you read shows in your hands; books stay in the library unless
    // they're borrowed.
    // On a call: the phone at your ear, for everyone to see.
    ui.calls.onCalling = (on) => {
      this.socket?.send({ t: "Calling", on });
      this.self?.setCalling(on);
    };
    ui.reader.onRead = (b) => {
      this.socket?.send({ t: "Reading", book: b?.id ?? 0 });
      this.self?.setReading(b?.id ?? 0);
    };
    if (!zoneId.startsWith("library") && ui.reader.open && !ui.library.isBorrowed(ui.reader.bookId)) {
      ui.reader.hide();
      this.hud.toast("📚 Library books stay in the library unless you borrow them. Tap Borrow on a book's card to take it with you.", 6000);
    }
    if (zoneId === HALL || wingOfZone(zoneId)) {
      this.libraryRoom = new LibraryRoom(this.scene, map, zoneId, ui.library);
      const desk = map.objects.find((o) => o.kind === "circulation_desk");
      if (desk) this.clerk = new Clerk(map, desk, this.scene, labels, LIBRARIAN);
    }
    const prizeCounter = map.objects.find((o) => o.kind === "prize_counter");
    if (prizeCounter) {
      this.clerk = new Clerk(map, prizeCounter, this.scene, labels, ATTENDANT);
      this.prizes = new PrizePanel(ui.eco, (name) => {
        this.clerk?.say(`One ${name}, all yours! Looks great.`);
        this.hud.toast(`🎟️ You got the ${name}! It's in your bag.`, 4000);
      });
    }
    const cabinets = map.objects.filter((o) => CABINET_KINDS.includes(o.kind));
    if (cabinets.length) {
      this.arcade = new ArcadePanel(
        cabinets.map((o) => o.label ?? "Arcade"),
        () => this.selfId,
        (id) => this.avatars.get(id)?.info.name ?? "someone",
        (m) => this.socket?.send(m),
        () => this.socket?.clock.now() ?? 0,
        () => ui.sound.muted,
      );
      const machine = map.objects.find((o) => o.kind === "dance_machine");
      const floor = map.objects.find((o) => o.kind === "dance_floor");
      if (machine && floor) {
        const lights = new Graphics();
        lights.zIndex = floor.y * TILE + 2;
        this.scene.sorted.addChild(lights);
        const board = new Text({ text: "", style: { fontFamily: "ui-monospace, monospace", fontSize: 9, fontWeight: "bold", fill: 0xfff1b0, stroke: { color: 0x05030c, width: 3 }, align: "center" } });
        board.anchor.set(0.5, 1);
        board.resolution = 4;
        board.position.set((machine.x + machine.w / 2) * TILE, machine.y * TILE - 50);
        board.zIndex = 1e6;
        this.scene.sorted.addChild(board);
        this.dance = { cab: cabinets.indexOf(machine), floor, lights, board };
      }
    }
    if (map.objects.some((o) => o.kind === "pool_table")) {
      this.pool = new PoolPanel(
        () => this.selfId,
        (id) => this.avatars.get(id)?.info.name ?? "someone",
        (m) => this.socket?.send(m),
      );
    }
    this.sky = new Sky(app, this.scene, () => this.onShootingStar());
    const fire = map.objects.find((o) => o.kind === "campfire");
    if (fire) {
      this.campfire = new Campfire({ x: fire.x, y: fire.y });
      this.sky.glowLayer.addChild(this.campfire.flames);
    }
    this.nookOf = new Uint8Array(map.width * map.height);
    map.objects
      .filter((o) => o.kind === "nook")
      .forEach((o, i) => {
        this.nookNames.push(o.label ?? "");
        for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) this.nookOf[y * map.width + x] = i + 1;
      });
    // Founders: trees in the grove and a leaf by their names.
    this.disposers.push(ui.welcome.onChange(() => this.applyFounders()));
    this.applyFounders();
    void ui.welcome.loadFounders().catch(() => {});
    this.chess = new ChessPanel(document.body, () => this.selfId, {
      move: (table, uci) => this.socket?.send({ t: "GameMove", table, uci }),
      close: () => this.chess.hide(),
      nameOf: (id) => this.avatars.get(id)?.info.name ?? "someone",
    });
    this.bindInput();
    const tick = () => this.update();
    app.ticker.add(tick);
    this.disposers.push(() => app.ticker.remove(tick));
  }

  connect(serverUrl: string, joinToken: string) {
    // One connection at a time: a second would show you twice, and the zone
    // would then drop the first as "signed in elsewhere".
    this.socket?.close();
    this.clearAvatars();
    this.socket = new ZoneSocket(serverUrl, joinToken, this.scene.viewTiles(), (m) => this.handle(m), (r) => {
      this.socket = null;
      this.events.onDisconnect(r);
    });
  }

  /** The player's tile, rounded (null before the welcome). */
  get position(): TileXY | null {
    const a = this.self;
    return a ? { x: Math.round(a.pos.x), y: Math.round(a.pos.y) } : null;
  }

  private get self(): Avatar | undefined {
    return this.avatars.get(this.selfId);
  }

  private clearAvatars() {
    for (const a of this.avatars.values()) a.destroy();
    this.avatars.clear();
    this.selfId = 0;
  }

  private upsert(info: Extract<ServerMsg, { t: "Spawn" }>["entity"], now: number) {
    const existing = this.avatars.get(info.id);
    // Our own avatar is predicted locally; server snapshots of it (e.g. in a
    // CellEnter after crossing a cell) would only pull it back in time.
    if (existing && info.id === this.selfId) return;
    if (existing) existing.apply(info, now);
    else {
      const a = new Avatar(info, this.scene, this.labels, info.id === this.selfId, now);
      a.setAway(info.away);
      a.setFounder(this.ui.welcome.founderNamed(info.name)?.no ?? null);
      this.avatars.set(info.id, a);
    }
  }

  private applyFounders() {
    this.grove?.setFounders(this.ui.welcome.founders);
    for (const a of this.avatars.values()) a.setFounder(this.ui.welcome.founderNamed(a.info.name)?.no ?? null);
  }

  /** Ties `panel` to a place: it closes once you walk away from it. */
  private near<P extends Panel>(panel: P, at: { x: number; y: number }, range = 5): P {
    panel.anchor = { x: at.x, y: at.y, range };
    return panel;
  }

  /** Closes a place's panel when you've walked off (not while walking there). */
  private closeIfWalkedAway() {
    const p = Panel.open;
    const self = this.self;
    if (!p?.anchor || !self) return;
    const a = p.anchor;
    const here = { x: Math.round(self.pos.x), y: Math.round(self.pos.y) };
    if (cheb(self.destination, a) > a.range && cheb(here, a) > a.range) p.hide();
  }

  /** A house's door: yours (go in), someone's (knock), or free (move in). */
  private tapHouse(lot: string) {
    const self = this.self;
    const door = spot(this.scene.map, `door:${lot}`);
    if (!self || !door) return;
    if (cheb(self.destination, door) > 3) this.moveTo(door, true);
    const homes = this.ui.homes;
    const r = homes.resident(lot);
    const menu = this.near(this.ui.menu, door, 6);
    if (homes.mine === lot) {
      const pet = this.ui.pets.mine;
      const actions: [string, () => void][] = [["Go inside", () => this.events.onTravel("home")]];
      actions.push(["Decorate outside 🎨", () => this.near(this.ui.decorate, door, 6).show()]);
      if (pet?.out) actions.push([`Bring ${pet.name} home`, () => void this.petLife.bringHome().catch(() => {})]);
      else if (pet) actions.push([`Take ${pet.name} for a walk 🐾`, () => void this.petLife.takeOut().catch(() => {})]);
      menu.showWith("Your home", "", actions);
    } else if (r) {
      menu.showWith(`${r.name}'s home`, "Friends can come in when they're invited.", [["Knock", () => this.events.onVisit(r.owner)]]);
    } else if (homes.mine) {
      menu.showWith("A free house", "Someone new could make it their home.", []);
    } else {
      const t = homes.cottage;
      const price = t ? `A ${t.name}, ${t.rent} coins a week (you can move up to a bigger house later).` : "";
      menu.showWith("A free house", `A garden, a postbox and a front door of your own. ${price}`, [
        [
          "Move in 🏡",
          () =>
            void homes
              .claim(lot)
              .then(() => void this.ui.rent.load().catch(() => {}))
              .then(() => this.hud.toast("🏡 Welcome home! Tap your door to go inside. It's on your map now.", 6000))
              .catch((e) => this.hud.toast(e instanceof Error ? e.message : "That didn't work.", 4000)),
        ],
      ]);
    }
  }

  /** Walks to the nearest free house's door; false if none is free. */
  findHome(): boolean {
    const self = this.self;
    if (!self) return false;
    let best: { lot: string; d: number } | null = null;
    for (const o of this.scene.map.objects) {
      if (o.kind !== "house" || !o.label || this.ui.homes.resident(o.label)) continue;
      const d = Math.hypot(o.x - self.pos.x, o.y - self.pos.y);
      if (!best || d < best.d) best = { lot: o.label, d };
    }
    if (!best) return false;
    return this.walkToSpot(`door:${best.lot}`);
  }

  /** Walks to a named place on this map ("pier", "grove"…); false if it isn't here. */
  walkToSpot(key: string): boolean {
    const t = spot(this.scene.map, key);
    if (!t) return false;
    this.walkTo(t);
    return true;
  }

  /** Walks to (near) `t`, e.g. where the Caretaker's tasks point. */
  walkTo(t: TileXY) {
    const spot = nearestWalkable(this.scene.map, t.x, t.y, 3);
    if (spot) this.moveTo(spot, true);
  }

  /** Tapping the Caretaker opens their panel. */
  private tapCaretaker(sx: number, sy: number): boolean {
    if (!this.caretaker) return false;
    const x = (sx - this.scene.world.position.x) / this.scene.scale / TILE;
    const y = (sy - this.scene.world.position.y) / this.scene.scale / TILE;
    if (!this.caretaker.hit(x, y)) return false;
    const self = this.self;
    if (self && cheb(self.destination, this.caretaker.pos) > 3) this.walkTo(this.caretaker.avatar.destination);
    // Anchored where they stand now: their walks can be long.
    const at = this.caretaker.pos;
    this.near(this.ui.welcomePanel, { x: Math.round(at.x), y: Math.round(at.y) }, 6).show();
    return true;
  }

  // ---- the library ----------------------------------------------------------

  /** The Library's doors, desk, bookcases and signs. */
  private tapLibrary(obj: MapObject): boolean {
    const self = this.self;
    const ui = this.ui;
    if (!self) return false;
    const front = { x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h };
    switch (obj.kind) {
      case "library":
        this.enter(front, HALL);
        return true;
      case "library_exit":
        this.events.onTravel("city");
        return true;
      case "wing_exit":
        this.events.onTravel(HALL);
        return true;
      case "wing_door":
        if (obj.label) this.enter({ x: obj.x + 1, y: obj.y + 1 }, obj.label);
        return true;
      case "circulation_desk":
      case "card_catalogue": {
        if (cheb(self.destination, front) > 2) this.walkTo(front);
        if (obj.kind === "circulation_desk") this.clerk?.chat();
        this.near(ui.catalogue, front, 8).show();
        return true;
      }
      case "new_arrivals":
        if (cheb(self.destination, front) > 2) this.walkTo(front);
        this.near(ui.shelf, front, 5).openCase(NEW, 0);
        return true;
      case "bookcase": {
        const room = this.libraryRoom;
        if (!room?.wing) return false;
        this.openBookcase(room.wing, Number(obj.label), null);
        return true;
      }
      case "stack_sign": {
        const text = this.libraryRoom?.signText(obj);
        this.hud.toast(`🔖 ${text ?? "Reading the sign…"}`, 5000);
        return true;
      }
    }
    return false;
  }

  /** Walks up to bookcase `n` of this wing and looks at it close up. */
  private openBookcase(wing: string, n: number, mark: number | null) {
    const room = this.libraryRoom;
    const o = room?.caseObj(n);
    const self = this.self;
    if (!room || !o || !self) return;
    const at = room.front(o, self.destination);
    if (cheb(self.destination, at) > 0) this.walkTo(at);
    this.near(this.ui.shelf, at, 3).openCase(wing, n, mark);
  }

  /** Browsing along a row from the shelf panel. */
  libraryBrowse(wing: string, n: number) {
    if (this.libraryRoom?.wing !== wing) return;
    this.openBookcase(wing, n, null);
  }

  /** How many bookcases a wing has (here: as on the map). */
  libraryCases(wing: string): number {
    return this.libraryRoom?.wing === wing ? this.libraryRoom.caseCount : 0;
  }

  /** "Show me": to the book's wing, up to its bookcase, the spine glowing. */
  libraryShowMe(at: BookPlace, id: number, title: string) {
    const lib = this.ui.library;
    const zone = at.wing === NEW ? HALL : wingZone(at.wing);
    lib.showing = { ...at, id, title };
    if (zone !== this.zoneId) {
      // Through the hall's door for that wing (the hall's own, from a wing).
      this.events.onTravel(zone);
      return;
    }
    this.libraryArrived();
  }

  /** Carries out a "Show me" once we're in the right room and standing. */
  private libraryArrived() {
    const lib = this.ui.library;
    const s = lib.showing;
    const room = this.libraryRoom;
    if (!s || !room || !this.self) return;
    const zone = s.wing === NEW ? HALL : wingZone(s.wing);
    if (zone !== this.zoneId) return;
    lib.showing = null;
    if (s.wing === NEW) {
      const shelf = this.scene.map.objects.find((o) => o.kind === "new_arrivals");
      if (!shelf) return;
      const front = { x: shelf.x + Math.floor(shelf.w / 2), y: shelf.y + shelf.h };
      this.walkTo(front);
      this.near(this.ui.shelf, front, 5).openCase(NEW, 0);
      return;
    }
    if (s.slot === null) return; // just going to the wing
    this.openBookcase(s.wing, s.case, s.slot);
    room.glowAt(s.case, s.slot);
    this.hud.toast(`📍 ${s.title}: bookcase ${s.case + 1}, shelf ${Math.floor(s.slot / 20) + 1}`, 5000);
  }

  /** Tapping the clerk: a word of help, and the racks open. */
  private tapClerk(sx: number, sy: number): boolean {
    if (!this.clerk) return false;
    const x = (sx - this.scene.world.position.x) / this.scene.scale / TILE;
    const y = (sy - this.scene.world.position.y) / this.scene.scale / TILE;
    if (!this.clerk.hit(x, y)) return false;
    this.clerk.chat();
    const map = this.scene.map;
    const bar = map.objects.find((o) => o.kind === "bar_counter");
    if (bar) this.openBar(bar);
    const prizes = map.objects.find((o) => o.kind === "prize_counter");
    if (prizes && this.prizes) this.near(this.prizes, { x: prizes.x + Math.floor(prizes.w / 2), y: prizes.y + prizes.h }, 6).show();
    const fisher = map.objects.find((o) => o.kind === "fisherman");
    if (fisher && this.fisherman) this.openFisherman(fisher);
    const desk = map.objects.find((o) => o.kind === "circulation_desk");
    if (desk) this.near(this.ui.catalogue, { x: desk.x + Math.floor(desk.w / 2), y: desk.y + desk.h }, 8).show();
    return true;
  }

  /**
   * Everyone in a game at a cabinet or the pool table faces it and looks
   * busy at it (and doesn't doze off, however long they think).
   */
  private markPlayers() {
    const at = new Map<number, { x: number; y: number; kind: "arcade" | "pool" }>();
    const map = this.scene.map;
    if (this.arcade) {
      map.objects
        .filter((o) => CABINET_KINDS.includes(o.kind))
        .forEach((o, cab) => {
          const st = this.arcade?.stateOf(cab);
          if (st?.status !== ARCADE_PLAYING) return;
          for (const id of [st.a, st.b]) at.set(id, { x: o.x + o.w / 2 - 0.5, y: o.y + o.h / 2, kind: "arcade" });
        });
    }
    const table = map.objects.find((o) => o.kind === "pool_table");
    if (table && this.pool) for (const id of this.pool.players) at.set(id, { x: table.x + table.w / 2 - 0.5, y: table.y + table.h / 2, kind: "pool" });
    for (const [id, a] of this.avatars) a.setPlaying(at.get(id) ?? null);
  }

  /** Walk up to the fisherman and see what he'll give for your catch. */
  private openFisherman(spot: MapObject) {
    const self = this.self;
    const at = { x: spot.x, y: spot.y };
    if (self && cheb(self.destination, at) > 2) {
      const near = nearestWalkable(this.scene.map, at.x + 1, at.y, 2);
      if (near) this.moveTo(near, true);
    }
    void this.ui.eco.loadAlbum().catch(() => {});
    this.near(this.fisherman!, at, 5).show();
  }

  /** The bartender's menu: a beer, or a glass of water to sober up. */
  private openBar(counter: MapObject) {
    const self = this.self;
    const front = { x: counter.x + Math.floor(counter.w / 2), y: counter.y + counter.h };
    if (self && cheb(self.destination, front) > 3) {
      const spot = nearestWalkable(this.scene.map, front.x, front.y, 2);
      if (spot) this.moveTo(spot, true);
    }
    const order = (kind: number, line: string) => {
      this.socket?.send({ t: "Drink", kind });
      this.clerk?.say(line);
    };
    this.near(this.ui.menu, front, 6).showWith("Bartender 🍺", "The Mossy Mug", [
      ["🍺 A beer · 5 coins", () => order(BEER, "One cold one, coming up!")],
      ["💧 A glass of water · free", () => order(WATER, "Here you go. Sip slowly.")],
    ]);
  }

  /** A drink took effect: `ms` of wooziness (0: sober again). */
  private onWoozy(id: number, ms: number) {
    const a = this.avatars.get(id);
    a?.setWoozy(ms);
    a?.flash(ms ? "🍺" : "💧");
    if (id !== this.selfId) return;
    window.clearTimeout(this.soberTimer);
    document.body.classList.toggle("woozy", ms > 0);
    if (ms) {
      this.hud.toast("🍺 Cheers! The room's gone a little wobbly…", 4000);
      this.soberTimer = window.setTimeout(() => document.body.classList.remove("woozy"), ms);
    } else {
      this.hud.toast("💧 Ahh. Much better.", 2500);
    }
  }

  /** Walks to a building's door and goes in on arrival (or at once if already there). */
  private enter(door: TileXY, zone: string) {
    const self = this.self;
    if (!self) return;
    if (cheb(self.destination, door) <= 1 && !self.moving) {
      this.events.onTravel(zone);
      return;
    }
    const spot = nearestWalkable(this.scene.map, door.x, door.y, 2);
    if (!spot) return;
    this.moveTo(spot, true);
    this.entering = { door: spot, zone };
  }

  /** Goes in once we've walked up to the door we're entering. */
  private checkEntering() {
    const e = this.entering;
    const self = this.self;
    if (!e || !self) return;
    if (self.destination.x !== e.door.x || self.destination.y !== e.door.y) {
      this.entering = null; // walked somewhere else instead
      return;
    }
    if (self.moving) return;
    this.entering = null;
    this.events.onTravel(e.zone);
  }

  /** The Caretaker says something now and then when you're close by. */
  private caretakerChat(now: number) {
    const self = this.self;
    const c = this.caretaker;
    if (!self || !c || now < this.caretakerTalkAt) return;
    if (Math.hypot(self.pos.x - c.pos.x, self.pos.y - c.pos.y) > 3.5) return;
    this.caretakerTalkAt = now + 40_000;
    const w = this.ui.welcome;
    const s = w.status;
    const gathering = happeningNow(Date.now());
    let lines: string[];
    if (gathering) lines = [`${gathering.title}! Stay a while.`, "It's nice when everyone comes by, isn't it?"];
    else if (!s) lines = ["Hello! Lovely day for it."];
    else if (s.founder) lines = [`Your ${STAGES[s.founder.stage]} is doing nicely, Founder #${s.founder.no}.`, "The grove fills up a little every day.", "Have you met Biscuit? Mind the tail.", "Lovely day for the garden."];
    else if (w.done === 3 && s.season.open) lines = ["You've done all three! Tap me and we'll plant your seedling."];
    else if (!s.tasks.fish) lines = ["Hello there! Tap me if you'd like a little something to do.", "The fish are biting by the pier today."];
    else if (!s.tasks.plant) lines = ["The garden could use a seed or two. You've got some in your bag!"];
    else lines = ["A bench is nicer with two. Or try a game of chess: the Park Elder is always up for one."];
    // Now and then, a hint about the park's secrets instead.
    if (s && (s.founder || w.done === 3) && Math.random() < 0.5) lines = SECRET_HINTS;
    c.say(lines[Math.floor(Math.random() * lines.length)]);
  }

  /** Re-checks the Caretaker's tasks soon after something that may finish one. */
  private taskMaybeDone(delay = 1200) {
    const w = this.ui.welcome;
    if (w.status?.founder || (w.status && w.done === 3)) return;
    window.setTimeout(() => void w.load().catch(() => {}), delay);
  }

  // ---- following -------------------------------------------------------------

  /** Friends: start right away (their client accepts). Others: they're asked. */
  private askToFollow(id: number, name: string, friend: boolean) {
    this.socket?.send({ t: "Offer", to: id, kind: FOLLOW });
    this.hud.toast(friend ? `👣 Following ${name}…` : `👣 You asked ${name} if you can follow them.`, 3000);
  }

  private followStarted(a: number, b: number) {
    const name = (id: number) => this.avatars.get(id)?.info.name ?? "someone";
    if (a === this.selfId || b === this.selfId) sfx.follow();
    if (a === this.selfId) {
      this.following = b;
      this.followGoal = "";
      this.hud.setFollow(`👣 Following ${name(b)}`, "Stop", () => this.stopFollowing(true));
      this.hud.toast(`👣 You're following ${name(b)}. Walk anywhere yourself to stop.`, 4000);
    } else if (b === this.selfId) {
      this.followers.add(a);
      this.showFollowers();
      this.hud.toast(`👣 ${name(a)} is following you`, 3500);
    }
  }

  /** The other side stopped (they let go, or stopped following us). */
  private followEnded(from: number, name: string) {
    if (this.following === from) {
      this.following = null;
      this.hud.setFollow(null);
    this.hud.setRide(null);
      this.showFollowers();
      this.hud.toast(`👣 ${name} let you go off on your own.`, 3000);
    }
    if (this.followers.delete(from)) {
      this.showFollowers();
      this.hud.toast(`👣 ${name} stopped following you.`, 3000);
    }
  }

  /** Stops following; `tell` lets the other person know. */
  private stopFollowing(tell: boolean) {
    const id = this.following;
    if (id === null) return;
    this.following = null;
    this.hud.setFollow(null);
    this.showFollowers();
    if (tell) this.socket?.send({ t: "Offer", to: id, kind: STOP_FOLLOW });
  }

  /** "Ana follows you · Let go", when nobody's being followed by us. */
  private showFollowers() {
    if (this.following !== null) return;
    const names = [...this.followers].map((id) => this.avatars.get(id)?.info.name).filter(Boolean);
    if (!names.length) return this.hud.setFollow(null);
    const who = names.length === 1 ? `${names[0]} is` : `${names.length} people are`;
    this.hud.setFollow(`👣 ${who} following you`, "Let go", () => {
      for (const id of this.followers) this.socket?.send({ t: "Offer", to: id, kind: STOP_FOLLOW });
      this.followers.clear();
      this.hud.setFollow(null);
    });
  }

  /** Walks after the person we follow; sits beside them when they sit. */
  private followStep() {
    const self = this.self;
    const them = this.following === null ? undefined : this.avatars.get(this.following);
    if (!self || !them) {
      const name = them?.info.name;
      this.stopFollowing(false);
      this.hud.toast(name ? `👣 You lost sight of ${name}.` : "👣 You lost sight of them.", 3000);
      return;
    }
    const goal = them.destination;
    if (them.state === SITTING && !them.moving) {
      // Already sitting beside them: stay put.
      if (self.state === SITTING && cheb(self.destination, goal) <= 1) return;
      // Sit next to them if there's a free seat beside theirs.
      const taken = new Set([...this.avatars.values()].filter((a) => a.state === SITTING).map((a) => `${a.destination.x},${a.destination.y}`));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const seat = this.furniture.seats.get(this.furniture.idAt({ x: goal.x + dx, y: goal.y + dy }));
        if (!seat || taken.has(`${seat.tile.x},${seat.tile.y}`) || self.state === SITTING) continue;
        const key = `sit:${seat.id}`;
        if (this.followGoal !== key) {
          this.followGoal = key;
          this.sitAt(seat.id);
        }
        return;
      }
    }
    // Otherwise stand right beside where they're going, on the side nearest us.
    if (cheb(self.destination, goal) <= 1 && this.followGoal !== "") return;
    let best: TileXY | null = null;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const t = { x: goal.x + dx, y: goal.y + dy };
        if (!walkable(this.scene.map, t.x, t.y)) continue;
        const d = Math.hypot(t.x - self.pos.x, t.y - self.pos.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    if (!best) return;
    const key = `${best.x},${best.y}`;
    if (key === this.followGoal && self.moving) return;
    if (best.x === self.destination.x && best.y === self.destination.y) return;
    this.followGoal = key;
    this.moveTo(best, false);
  }

  // ---- being together -------------------------------------------------------

  /** Shows others how you'd like company (`mood::*`); remembered. */
  setMood(mood: number) {
    this.mood = mood;
    try {
      localStorage.setItem("commons.mood", String(mood));
    } catch {
      // storage unavailable
    }
    this.socket?.send({ t: "SetMood", mood });
    this.self?.setMood(mood);
  }

  get currentMood() {
    return this.mood;
  }

  private offer(to: number, kind: number, name: string) {
    const self = this.self;
    const them = this.avatars.get(to);
    if (!self || !them || !this.socket) return;
    if (cheb(self.destination, { x: Math.round(them.pos.x), y: Math.round(them.pos.y) }) > 2) {
      const spot = nearestWalkable(this.scene.map, Math.round(them.pos.x) + 1, Math.round(them.pos.y), 2);
      if (spot) this.moveTo(spot, true);
      // Offer once we're there.
      window.setTimeout(() => this.socket?.send({ t: "Offer", to, kind }), 1800);
    } else {
      this.socket.send({ t: "Offer", to, kind });
    }
    this.hud.toast(`${TOGETHER[kind].icon} You offered ${name} ${TOGETHER[kind].verb}…`, 3000);
  }

  private together(a: number, b: number, kind: number) {
    if (kind === FOLLOW) return this.followStarted(a, b);
    const t = TOGETHER[kind];
    if (!t) return;
    const pa = this.avatars.get(a);
    const pb = this.avatars.get(b);
    for (const p of [pa, pb]) {
      if (!p) continue;
      if (kind === 3) p.emote(4);
      else p.flash(t.icon);
    }
    // They turn to each other and really hug, or slap hands.
    if (pa && pb && (kind === 1 || kind === 2)) {
      const how = kind === 1 ? "hug" : "five";
      pa.together(how, () => (this.avatars.has(b) ? pb.pos : null));
      pb.together(how, () => (this.avatars.has(a) ? pa.pos : null));
    }
    const vol = Math.max(this.nearbyVolume(a), this.nearbyVolume(b));
    if (kind === 1) sfx.hug(vol);
    else if (kind === 2) sfx.highFive(vol, 450);
    else if (kind === 3) sfx.danceRiff(vol);
    if (kind === 1) window.setTimeout(() => [pa, pb].forEach((p) => p?.flash("💞")), 900);
    const other = a === this.selfId ? pb : b === this.selfId ? pa : null;
    if (other) this.hud.toast(`${t.icon} You and ${other.info.name} ${t.done}${kind === 1 ? " 💞" : "!"}`, 3500);
  }

  /**
   * Rock paper scissors: while choosing, the two face each other and the
   * players get their picker; at the reveal everyone nearby sees them pump
   * their fists three times, show their hands, and who won.
   */
  private onRps(m: Extract<ServerMsg, { t: "Rps" }>) {
    const pa = this.avatars.get(m.a);
    const pb = this.avatars.get(m.b);
    const mine = m.a === this.selfId || m.b === this.selfId;
    if (pa && pb) {
      pa.faceToward(pb.pos.x);
      pb.faceToward(pa.pos.x);
    }
    if (m.phase === CHOOSING) {
      for (const p of [pa, pb]) p?.flash("🤔");
      const other = m.a === this.selfId ? pb : pa;
      if (mine) this.rpsPicker.show(other?.info.name ?? "someone", () => m.endsT - (this.socket?.clock.now() ?? m.endsT));
      return;
    }
    if (mine) this.rpsPicker.hide();
    if (m.phase === CANCELLED) {
      if (mine) this.hud.toast("✊ The game was called off.");
      return;
    }
    const now = performance.now();
    pa?.pumpFist(now);
    pb?.pumpFist(now);
    // "Rock… paper… scissors!": a thump with each pump.
    const rpsVol = mine ? 1 : Math.max(this.nearbyVolume(m.a), this.nearbyVolume(m.b));
    for (let i = 0; i < 3; i++) sfx.fistPump(rpsVol, (PUMP_MS / 3) * i);
    window.setTimeout(() => {
      this.avatars.get(m.a)?.flash(pickIcon(m.aPick));
      this.avatars.get(m.b)?.flash(pickIcon(m.bPick));
    }, PUMP_MS);
    window.setTimeout(() => {
      const winner = beats(m.aPick, m.bPick) ? m.a : beats(m.bPick, m.aPick) ? m.b : 0;
      if (winner) this.avatars.get(winner)?.say("🏆 Wins!");
      if (!mine) return;
      sfx.rpsResult(winner === this.selfId ? "win" : winner ? "lose" : "draw");
      const [me, them] = m.a === this.selfId ? [m.aPick, m.bPick] : [m.bPick, m.aPick];
      const text =
        !me && !them
          ? "🤷 Nobody picked in time."
          : winner === this.selfId
            ? `🏆 You win! ${pickIcon(me)} beats ${pickIcon(them)}`
            : winner
              ? `You lose: ${pickIcon(them)} beats ${pickIcon(me)}`
              : `A draw: ${pickIcon(me)} and ${pickIcon(them)}`;
      this.hud.toast(text, 4000);
    }, PUMP_MS + 900);
  }

  /**
   * The Dance Off, as seen from the room: while a dance is on, the floor in
   * front of the machine lights up on the beat (brighter under whoever just
   * scored), the dancers dance, and a scoreboard over the machine shows who's
   * ahead; after, who won.
   */
  private danceFloor(serverNow: number) {
    const d = this.dance;
    if (!d || !this.arcade) return;
    const st = this.arcade.stateOf(d.cab);
    const g = d.lights.clear();
    const name = (id: number) => (id === ARCADE_BOT ? "AI bot" : (this.avatars.get(id)?.info.name ?? "someone"));
    // The AI bot dances on the floor beside you while you take it on.
    const botDancing = st?.status === ARCADE_PLAYING && st.b === ARCADE_BOT;
    if (botDancing && !this.danceBot && st) {
      // On the second pad, beside yours (the server puts you on the first).
      const you = this.avatars.get(st.a);
      const x = d.floor.x + 2;
      const info = { id: DANCE_BOT_ID, name: "AI bot 🤖", look: DANCE_BOT_LOOK, x, y: d.floor.y, state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, style: 0, pet: 0, vehicle: 0, tool: 0, reading: 0, calling: false };
      this.danceBot = new Avatar(info, this.scene, this.labels, false, serverNow);
      this.danceBot.markNpc();
      if (you) this.danceBot.faceToward(you.pos.x);
    } else if (!botDancing && this.danceBot) {
      this.danceBot.destroy();
      this.danceBot = null;
    }
    if (this.danceBot) {
      this.danceBot.keepDancing(300);
      this.danceBot.update(serverNow, performance.now());
    }
    if (!st || st.status === 0 || st.status === 4) {
      d.board.text = "";
      return;
    }
    const data = st.data;
    const [sa, sb] = [data[5], data[6]];
    if (st.status !== ARCADE_PLAYING) {
      const winner = st.status === 2 ? st.a : st.status === 3 ? st.b : 0;
      d.board.text = winner ? `🏆 ${name(winner)} won the Dance Off!\n${sa} – ${sb}` : `A draw! ${sa} – ${sb}`;
      return;
    }
    const start = data[1] * 65536 + data[2];
    const beat = (serverNow - start) / BEAT_MS;
    const crown = (mine: number, theirs: number) => (mine > theirs ? "👑 " : "");
    d.board.text = beat < 0 ? `💃 Dance Off starting… ${Math.ceil(-beat * BEAT_MS / 1000)}` : `${crown(sa, sb)}${name(st.a)} ${sa}  –  ${sb} ${name(st.b)}${sb > sa ? " 👑" : ""}`;
    if (beat < 0) return;
    // The floor: each tile its own colour, changing on every beat, pulsing.
    const pulse = Math.max(0, 1 - (beat - Math.floor(beat)) * 2);
    const colors = [0xff4fa3, 0x3fe0ff, 0xffe14f, 0x5fe08a, 0xb07bff];
    for (let i = 0; i < d.floor.w; i++) {
      const c = colors[(i + Math.floor(beat)) % colors.length];
      const x = (d.floor.x + i) * TILE;
      const y = d.floor.y * TILE;
      g.rect(x + 2, y + 2, TILE - 4, TILE - 4).fill({ color: c, alpha: 0.25 + pulse * 0.45 });
      g.rect(x + 8, y + 8, TILE - 16, TILE - 16).fill({ color: 0xffffff, alpha: pulse * 0.25 });
    }
    for (const id of [st.a, st.b]) this.avatars.get(id)?.keepDancing(300);
  }

  /** New clothes (saved already): show them, and tell the zone to show them to everyone. */
  changeLook(look: number, style: number) {
    const self = this.self;
    if (self) {
      self.info = { ...self.info, look, style };
      self.flash("✨");
    }
    this.socket?.send({ t: "SetLook", look });
  }

  /** How fast we'll go on `path` (the server decides; this is its rule). */
  private predictSpeed(path: TileXY[]): number {
    const v = this.self?.info.vehicle ?? 0;
    const speed = rideSpeed(v);
    if (!speed) return WALK_SPEED_X10;
    if (this.zoneId === "city") return speed;
    const map = this.scene.map;
    const track = map.ground_legend.indexOf("track");
    return track >= 0 && path.slice(1).every((t) => map.ground[t.y * map.width + t.x] === track) ? speed : WALK_SPEED_X10;
  }

  /** The toys button on the bar, if you own any. */
  showToys() {
    const toys = this.ui.goods.owned("toy");
    this.hud.setToys(toys.length ? itemIconUrl(toys[0].key, toys[0].kind) : null);
  }

  /** Pick a toy to play with (everyone nearby sees). */
  pickToy() {
    const toys = this.ui.goods.owned("toy");
    if (toys.length === 1) return this.emote(toys[0].meta.code ?? 0);
    const at = this.self?.destination ?? { x: 0, y: 0 };
    this.near(this.ui.menu, at, 6).showWith(
      "Play",
      "",
      toys.map((it) => [`${EMOTES[it.meta.code ?? 0]?.icon ?? ""} ${it.name}`, () => this.emote(it.meta.code ?? 0)] as [string, () => void]),
    );
  }

  /** What else the bag offers for an item: use a tool, play a toy, where things go. */
  bagExtra(it: Item): HTMLElement | null {
    const tip = (t: string) => {
      const s = document.createElement("span");
      s.className = "hint";
      s.textContent = t;
      return s;
    };
    const btn = (label: string, run: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "small";
      b.textContent = label;
      b.onclick = run;
      return b;
    };
    switch (it.kind) {
      case "tool": {
        // The Angler's Rod works on its own (fish bite sooner); the others are looks.
        if (!it.meta.tool) return tip("Fish bite sooner with it");
        const tool = this.self?.info.tool ?? 0;
        const code = it.meta.code ?? 0;
        const using = it.meta.tool === "can" ? tool >> 4 === code : (tool & 0xf) === code;
        return btn(using ? "Put away" : "Use", () =>
          void this.ui.goods
            .useTool(it, using)
            .then(() => {
              this.refreshLook();
              this.ui.bag.hide();
              this.hud.toast(using ? `Back to the plain ${it.meta.tool === "can" ? "watering can" : "rod"}.` : `${it.name}: in your hands when you ${it.meta.tool === "can" ? "water" : "fish"}.`, 3500);
            })
            .catch((e) => this.hud.toast(e instanceof Error ? e.message : "That didn't work.", 3500)),
        );
      }
      case "toy":
        return btn("Play", () => {
          this.ui.bag.hide();
          this.emote(it.meta.code ?? 0);
        });
      case "instrument":
        return tip("Play it at the bandstand");
      case "wrap":
      case "card":
        return tip("Choose it when you give a gift");
      case "exterior":
        return tip("Put it up at your front door");
    }
    return null;
  }

  /** The ride button: in the city, if you own something to ride. */
  showRideButton() {
    const rides = this.ui.rides;
    const owned = rides.owned();
    if (this.zoneId !== "city" || !owned.length) return this.hud.setRide(null);
    const it = (rides.riding && rides.item(rides.ride)) || owned[owned.length - 1];
    this.hud.setRide({ icon: itemIconUrl(it.key, it.kind), name: it.name.toLowerCase(), on: rides.riding });
  }

  /** The ride button: get off, or on (choosing, if there's more than one). */
  toggleRide() {
    const rides = this.ui.rides;
    if (rides.riding) return void this.rideOn(null);
    const owned = rides.owned();
    if (owned.length === 1) return void this.rideOn(owned[0]);
    const at = this.self?.destination ?? { x: 0, y: 0 };
    this.near(this.ui.menu, at, 6).showWith(
      "Ride",
      "",
      owned.map((it) => [it.name, () => void this.rideOn(it)] as [string, () => void]),
    );
  }

  /** Gets on something of yours (outdoors only), or off with null. */
  async rideOn(it: Item | null) {
    if (it && this.zoneId !== "city") return this.hud.toast("Vehicles are for outdoors: ride once you're back outside.", 3500);
    try {
      await this.ui.rides.set(it?.id ?? 0);
      this.refreshLook();
      this.showRideButton();
      if (it) this.hud.toast(`${it.name}: off you go! Faster anywhere outdoors; you'll hop off at doors.`, 3500);
    } catch (e) {
      this.hud.toast(e instanceof Error ? e.message : "That didn't work.", 3500);
    }
  }

  /** A test ride round the Vehicles shop's track. */
  async testRide(item: number) {
    try {
      await this.ui.rides.set(item, true);
      this.refreshLook();
      this.walkToSpot("track");
      this.hud.toast(`🛼 Test ride! Tap along the track to go round. Walk off it to hand the ${this.ui.eco.name(item).toLowerCase()} back.`, 5000);
    } catch (e) {
      this.hud.toast(e instanceof Error ? e.message : "That didn't work.", 3500);
    }
  }

  /** A test ride ends when you leave the Vehicles shop. */
  private checkTestRide() {
    const self = this.self;
    if (!self || this.zoneId !== "mall" || !this.ui.rides.testRide || this.endingTest) return;
    const shop = this.scene.map.objects.find((o) => o.kind === "dept" && o.label === "vehicles");
    const p = self.pos;
    if (shop && p.x >= shop.x && p.x < shop.x + shop.w && p.y >= shop.y && p.y < shop.y + shop.h) return;
    this.endingTest = true;
    void this.ui.rides
      .set(0)
      .then(() => {
        this.refreshLook();
        this.hud.toast("You hand the test ride back. Like it? It's on the display by the door.", 3500);
      })
      .catch(() => {})
      .finally(() => (this.endingTest = false));
  }

  /** Asks the zone to show us as saved (after taking a pet out or home). */
  refreshLook() {
    const self = this.self;
    if (self) this.socket?.send({ t: "SetLook", look: self.info.look });
  }

  /** Tapping a pet: yours (a walk, home), or someone else's (a pat). */
  private tapPet(sx: number, sy: number): boolean {
    const x = (sx - this.scene.world.position.x) / this.scene.scale / TILE;
    const y = (sy - this.scene.world.position.y) / this.scene.scale / TILE;
    const ui = this.ui;
    const self = this.self;
    const fail = (e: unknown) => this.hud.toast(e instanceof Error ? e.message : "That didn't work.", 4000);
    const sound = (item: number) => {
      const s = PET_SOUNDS[(ui.eco.items.get(item)?.meta.code ?? 1) & 0xff] ?? [];
      return s[Math.floor(Math.random() * s.length)] ?? "";
    };
    const yard = this.petLife.yardPetAt(x, y);
    if (yard) {
      const at = { x: Math.floor(x), y: Math.floor(y) };
      const mine = yard.owner === ui.social.selfId;
      this.petLife.patYard(yard.owner);
      if (!mine) {
        this.hud.toast(`🐾 You pat ${petTitle(ui.eco, yard, false)}. ${sound(yard.item)}`, 3500);
        return true;
      }
      if (self && cheb(self.destination, at) > 2) this.walkTo(at);
      const note = yard.walked_today ? `Had a walk today. ${yard.walks} walks together.` : `Hoping for a walk! ${yard.walks ? `${yard.walks} walks together so far.` : "Your first one together?"}`;
      this.near(ui.menu, at, 6).showWith(petTitle(ui.eco, yard, true), note, [["Take for a walk 🐾", () => void this.petLife.takeOut().catch(fail)]]);
      return true;
    }
    const walker = this.petLife.walkerAt(x, y);
    if (!walker?.pet) return false;
    const pet = ui.pets.ofName(walker.info.name);
    walker.pet.greet(performance.now());
    if (walker !== self) {
      this.hud.toast(`🐾 You pat ${pet ? petTitle(ui.eco, pet, false) : "the pet"}. ${pet ? sound(pet.item) : ""}`, 3500);
      // A heart for its walker to see.
      this.socket?.send({ t: "Emote", emote: 7 });
      return true;
    }
    const mins = Math.floor((Date.now() - ui.pets.outSince) / 60_000);
    const plot = ui.pets.mine?.plot;
    const actions: [string, () => void][] = [];
    if (plot && this.zoneId === "city") actions.push(["Walk home", () => void this.walkToSpot(`door:${plot}`)]);
    actions.push(["Bring home now", () => void this.petLife.bringHome().catch(fail)]);
    const note = ui.pets.outSince ? `Out together for ${mins < 1 ? "a minute" : `${mins} min`}. Back at your door, they're home.` : "Out for a walk with you.";
    this.near(ui.menu, walker.destination, 6).showWith(pet ? petTitle(ui.eco, pet, true) : "Your pet", note, actions);
    return true;
  }

  /** Sends a wish up on a sky lantern. */
  releaseLantern(text: string) {
    this.socket?.send({ t: "SkyLantern", text });
  }

  private onShootingStar() {
    const self = this.self;
    if (!self) return;
    // Noticed when you're looking up: lying on a blanket, sitting out, or in a nook.
    if (self.state === SITTING || this.inNook) this.hud.toast("🌠 A shooting star! Make a wish.", 4000);
  }

  /** Entering or leaving a nook: chat stays inside it. */
  private checkNook(pos: TileXY) {
    const map = this.scene.map;
    const n = this.nookOf[Math.round(pos.y) * map.width + Math.round(pos.x)] ?? 0;
    if (n === this.inNook) return;
    this.inNook = n;
    document.body.classList.toggle("in-nook", n > 0);
    if (!n) {
      this.hud.setChatHint(null);
      return;
    }
    const name = this.nookNames[n - 1];
    this.hud.setChatHint(`🤫 ${name}: only people here can hear you`);
    const key = NOOKS[name];
    if (key && !found().has(key)) this.discover(key, DISCOVERIES[key]);
    else this.hud.toast(`🤫 ${name}`, 2500);
  }

  private remove(id: number) {
    if (id === this.selfId) return;
    if (this.followers.delete(id)) this.showFollowers();
    this.avatars.get(id)?.destroy();
    this.avatars.delete(id);
  }

  private handle(m: ServerMsg) {
    const now = this.socket?.clock.now() ?? 0;
    switch (m.t) {
      case "Welcome":
        this.selfId = m.selfId;
        this.hud.setPlace(this.place.label || this.scene.map.name, m.instance);
        if (this.isOwnHome) void this.loadGifts();
        if (this.mood) this.socket?.send({ t: "SetMood", mood: this.mood });
        this.clerk?.hello();
        // Still reading as you came through the door.
        if (this.ui.reader.bookId) this.socket?.send({ t: "Reading", book: this.ui.reader.bookId });
        if (this.ui.calls.live) this.socket?.send({ t: "Calling", on: true });
        this.events.onWelcome();
        break;
      case "CellEnter":
        for (const e of m.entities) this.upsert(e, now);
        break;
      case "CellLeave":
        for (const id of m.ids) this.remove(id);
        break;
      case "Spawn":
        this.upsert(m.entity, now);
        break;
      case "Despawn":
        this.remove(m.id);
        break;
      case "MoveStart": {
        const a = this.avatars.get(m.id);
        if (!a) break;
        if (m.id === this.selfId) {
          // The server confirming a walk we predicted: keep the local timing
          // (unless it says we go at another pace: on wheels, or keeping up).
          // Held arrow keys send a new stretch before the last one's echo is
          // back, so match any walk still in flight, not just the latest one
          // (taking an older echo as a correction snapped us back and forth).
          const end = m.path[m.path.length - 1];
          // (Same speed, and both breaking into a sprint or neither: a sprint's start
          // can differ by a few ms without anyone seeing it.)
          const samePace = a.currentMotion?.speedX10 === m.speedX10 && !(a.currentMotion?.sprintIn ?? 0) === !m.sprintIn;
          const i = this.sentMoves.findIndex((s) => s.x === end.x && s.y === end.y);
          if (i >= 0) {
            this.sentMoves.splice(0, i + 1);
            if (samePace) break;
          }
          const dest = a.destination;
          if (end.x === dest.x && end.y === dest.y && samePace) break;
        }
        a.setMotion({ path: m.path, t0: m.t0, speedX10: m.speedX10, sprintIn: m.sprintIn }, now);
        break;
      }
      case "Snap":
        this.avatars.get(m.id)?.snap({ x: m.x, y: m.y });
        break;
      case "AwayChanged":
        this.avatars.get(m.id)?.setAway(m.away);
        break;
      case "ReadingShown":
        this.avatars.get(m.id)?.setReading(m.book);
        break;
      case "CallingShown":
        this.avatars.get(m.id)?.setCalling(m.on);
        break;
      case "EmoteShown":
        this.avatars.get(m.id)?.emote(m.emote);
        sfx.emoteSound(m.emote, this.nearbyVolume(m.id) * 0.8);
        break;
      case "ChatBubble": {
        const a = this.avatars.get(m.id);
        if (!a || this.ui.social.isBlockedName(a.info.name)) break;
        a.say(m.text);
        this.hud.addChat(a.info.name, m.text, m.id === this.selfId);
        break;
      }
      case "StateChange": {
        const a = this.avatars.get(m.id);
        if (!a) break;
        a.setState(m.state, { x: m.x, y: m.y });
        // Walking off mid-cast ends fishing without a FishEvent.
        if (m.state !== FISHING) this.props.reelIn(m.id);
        if (m.id === this.selfId) this.onSelfState(m.state, { x: m.x, y: m.y });
        break;
      }
      case "GameState":
        this.games.set(m.table, m);
        if (this.chess.open) this.chess.update(m);
        break;
      case "ScreenState":
        this.screen?.setState(m);
        break;
      case "FishEvent":
        this.onFish(m);
        break;
      case "PlotState": {
        const info = { plant: m.plant, stage: m.stage, watered: m.watered, owner: m.owner, stageLeftMs: m.stageLeftMs };
        // Just watered: whoever's next to it is holding their can.
        const key = `${m.x},${m.y}`;
        if (m.watered && this.wateredSeen.get(key) === false) {
          let best: Avatar | null = null;
          let bd = 1.8;
          for (const a of this.avatars.values()) {
            const d = Math.hypot(a.pos.x - m.x, a.pos.y - m.y);
            if (d < bd) [best, bd] = [a, d];
          }
          best?.showCan(performance.now());
        }
        this.wateredSeen.set(key, m.watered);
        this.props.setPlot(m.x, m.y, info);
        this.ui.plot.update(m.x, m.y, info);
        break;
      }
      case "ObjectUpdate":
        this.props.setObject(m.x, m.y, m.item);
        break;
      case "Granted":
        this.ui.eco.setTotal(m.item, m.total, m.first);
        if (m.added > 0) {
          const name = this.ui.eco.name(m.item);
          this.hud.toast(`+${m.added} ${name}${m.first ? " · new in your album!" : ""}`, 3500);
        }
        break;
      case "Error":
        if (m.code === ERR.NO_PATH) this.hud.toast("Can't get there from here.");
        else if (TOAST_CODES.has(m.code)) this.hud.toast(m.message.charAt(0).toUpperCase() + m.message.slice(1) + ".");
        else if (m.code !== ERR.REPLACED && m.code !== ERR.UNAUTHORIZED && m.code !== ERR.VERSION_MISMATCH) {
          console.warn("server error", m.code, m.message);
        }
        break;
      case "Pong":
        break;
      case "JamNote": {
        const self = this.self;
        const who = this.avatars.get(m.id);
        if (!self || !who || !this.socket) break;
        const when = beatTime(m.beat, this.socket.clock.now());
        const vol = Math.max(0, 1 - Math.hypot(who.pos.x - self.pos.x, who.pos.y - self.pos.y) / 14);
        if (when !== null) playNote(m.instrument, m.pitch, when, vol);
        who.flash(m.instrument === 2 ? "🥁" : "♪");
        break;
      }
      case "Painted":
        this.ui.easel.remote(m.easel, m.cell, m.color);
        break;
      case "MoodShown":
        this.avatars.get(m.id)?.setMood(m.mood);
        break;
      case "LookChanged": {
        const a = this.avatars.get(m.id);
        if (!a) break;
        const clothes = a.info.look !== m.look || a.info.style !== m.style;
        // Our own clothes are shown already; a pet coming along is news.
        if (m.id === this.selfId) {
          a.info = { ...a.info, pet: m.pet, vehicle: m.vehicle, tool: m.tool };
          break;
        }
        a.info = { ...a.info, look: m.look, style: m.style, pet: m.pet, vehicle: m.vehicle, tool: m.tool };
        if (clothes) a.flash("✨");
        // Someone took a pet out: know its name.
        if (m.pet && !this.ui.pets.ofName(a.info.name)?.out) void this.ui.pets.load().catch(() => {});
        break;
      }
      case "Offered": {
        const from = this.avatars.get(m.from);
        if (!from || this.ui.social.isBlockedName(from.info.name)) break;
        if (m.kind === STOP_FOLLOW) {
          this.followEnded(m.from, from.info.name);
          break;
        }
        // Friends may follow you without asking.
        if (m.kind === FOLLOW && this.ui.social.friendByName(from.info.name)) {
          this.socket?.send({ t: "Accept", from: m.from, kind: m.kind });
          break;
        }
        sfx.asked();
        this.ui.offer.show(from.info.name, m.kind, () => this.socket?.send({ t: "Accept", from: m.from, kind: m.kind }));
        break;
      }
      case "Together":
        this.together(m.a, m.b, m.kind);
        break;
      case "Rps":
        this.onRps(m);
        break;
      case "Woozy":
        this.onWoozy(m.id, m.ms);
        break;
      case "PoolState":
        this.pool?.onState(m);
        break;
      case "PoolShot":
        this.pool?.onShot(m.by, m.vx, m.vy, m.shot);
        break;
      case "PoolAim":
        this.pool?.onAim(m.by, m.angle, m.pull);
        break;
      case "ArcadeState":
        this.arcade?.onState(m);
        break;
      case "LanternRise": {
        const who = this.avatars.get(m.id);
        if (who && this.ui.social.isBlockedName(who.info.name)) break;
        this.sky.release(m.x, m.y, performance.now());
        who?.say(`🏮 ${m.text}`);
        break;
      }
      case "Ball": {
        const scored = this.ball?.apply(m);
        const self = this.self;
        if (scored && self && this.ball && Math.abs(this.ball.at(this.socket?.clock.now() ?? 0).x - self.pos.x) < 24) {
          this.hud.toast(`⚽ Goal! West ${this.ball.left} – ${this.ball.right} East`, 3000);
        }
        break;
      }
    }
  }

  // ---- corner activities ---------------------------------------------------

  private setupCorners(map: ZoneMap) {
    if (map.objects.some((o) => o.kind === "bandstand")) {
      this.jam = new JamPanel({
        serverNow: () => this.socket?.clock.now() ?? 0,
        send: (instrument, pitch, beat) => this.socket?.send({ t: "JamNote", instrument, pitch, beat }),
        sparkle: () => this.self?.flash("♪"),
        owned: () => this.ui.goods.instruments(),
      });
      this.disposers.push(() => this.jam?.destroy());
    }
    const easels = map.objects.find((o) => o.kind === "easels");
    if (easels) {
      // Each easel's canvas sits at (i * 32 + 8, 6) in the easels' texture,
      // which starts 30px above the footprint.
      this.easels = new EaselDisplays(easels.w, (i, s) => {
        s.position.set(easels.x * TILE + i * 32 + 8, easels.y * TILE - 30 + 6);
        s.zIndex = (easels.y + easels.h) * TILE - 0.5;
        this.scene.sorted.addChild(s);
      });
      for (let i = 0; i < easels.w; i++) {
        this.ui.town
          .easel(i)
          .then((e) => this.easels?.set(i, e.cells))
          .catch(() => {});
      }
    }
    if (map.objects.filter((o) => o.kind === "goal").length === 2) {
      this.ball = new Ball();
      this.scene.sorted.addChild(this.ball.sprite);
    }
  }

  /** Shows a discovery; the first time, counts it. */
  private discover(key: string, text: string) {
    const f = found();
    const fresh = !f.has(key);
    f.add(key);
    try {
      localStorage.setItem(FOUND_KEY, JSON.stringify([...f]));
    } catch {
      // storage unavailable
    }
    const total = Object.keys(DISCOVERIES).length;
    this.hud.toast(fresh ? `✨ ${text} (Discovery ${f.size} of ${total})` : text, 5500);
  }

  /** Petting Biscuit. */
  private tapCat(sx: number, sy: number): boolean {
    if (!this.cat?.active) return false;
    const x = (sx - this.scene.world.position.x) / this.scene.scale / TILE;
    const y = (sy - this.scene.world.position.y) / this.scene.scale / TILE;
    if (!this.cat.hit(x, y)) return false;
    this.cat.hearts = performance.now() + 1500;
    this.hud.toast(`🐈 ${PURRS[Math.floor(Math.random() * PURRS.length)]}`, 3500);
    return true;
  }

  /** Live easel stroke to people nearby. */
  sendPaint(easel: number, cell: number, color: number) {
    this.socket?.send({ t: "Paint", easel, cell, color });
  }

  /** Tapping the ball: run through it, which kicks it on. */
  private tapBall(sx: number, sy: number): boolean {
    const self = this.self;
    if (!this.ball?.seen || !self || !this.socket) return false;
    const b = this.ball.at(this.socket.clock.now());
    const p = this.scene.tileToScreen(b.x, b.y);
    if (Math.hypot(p.x - sx, p.y - (sy + 6)) > 22) return false;
    const fx = self.pos.x + 0.5;
    const fy = self.pos.y + 0.5;
    const len = Math.hypot(b.x - fx, b.y - fy) || 1;
    const tx = Math.floor(b.x + ((b.x - fx) / len) * 2);
    const ty = Math.floor(b.y + ((b.y - fy) / len) * 2);
    const target = nearestWalkable(this.scene.map, tx, ty, 2);
    if (target) this.moveTo(target, true);
    return true;
  }

  // ---- input -------------------------------------------------------------

  /**
   * Starts walking immediately using the same pathfinding and splice rules as
   * the server, then tells the server. Its MoveStart echo is ignored when it
   * agrees with the prediction.
   */
  private moveTo(t: TileXY, marker: boolean) {
    const self = this.self;
    if (!this.socket || !self) return;
    // A little woozy: now and then you end up a step off where you meant.
    if (self.woozy && Math.random() < 0.5) {
      const off = { x: t.x + Math.round(Math.random() * 2 - 1), y: t.y + Math.round(Math.random() * 2 - 1) };
      if (walkable(this.scene.map, off.x, off.y)) t = off;
    }
    const now = this.socket.clock.now();
    // Walking off stands us up; the server does the same on MoveTo.
    if (self.state === SITTING) {
      self.setState(0, self.standTile ?? self.destination);
      this.hud.setSitting(false);
    }
    const cur = self.currentMotion;
    const sp = cur ? splice(cur, now) : null;
    const walkingOn = !!cur && now < endT(cur);
    // A fresh walk from standing still is a walk again, unless it was just asked to be a sprint.
    if (!walkingOn && performance.now() - this.sprintAt > SPRINT_ASK_MS) this.sprint = false;
    let start: TileXY;
    let t0 = now;
    if (sp) {
      start = sp.next;
      t0 = sp.tPrev;
    } else {
      start = cur && now <= cur.t0 ? cur.path[0] : self.destination;
    }
    const full = route(this.scene.map, start, t);
    if (!full) {
      this.hud.toast("Can't get there from here.");
      return;
    }
    if (sp) full.unshift(sp.prev);
    // On wheels where they apply; on foot outdoors, a sprint if asked for
    // (the server works it out the same way).
    const ridden = this.predictSpeed(full);
    const pace =
      ridden !== WALK_SPEED_X10
        ? { speedX10: ridden, sprintIn: 0 }
        : this.sprint && this.zoneId === "city"
          ? sprintProfile(sp ? cur : null, t0, now)
          : { speedX10: WALK_SPEED_X10, sprintIn: 0 };
    if (full.length >= 2) self.setMotion({ path: compress(full), t0, ...pace }, now);
    const wall = performance.now();
    this.sentMoves = this.sentMoves.filter((s) => wall - s.at < 3000);
    this.sentMoves.push({ x: t.x, y: t.y, at: wall });
    this.socket.send({ t: "MoveTo", x: t.x, y: t.y, sprint: this.sprint });
    if (marker) this.scene.showTarget(t);
  }

  private bindInput() {
    // Away from the keyboard: a minute with no key, click, touch, scroll or
    // even a mouse move (tabbed out counts), and everyone sees you doze off.
    let lastInput = performance.now();
    let away = false;
    const active = () => {
      lastInput = performance.now();
      if (away) {
        away = false;
        this.socket?.send({ t: "Away", away: false });
      }
    };
    const awayCheck = window.setInterval(() => {
      if (!away && performance.now() - lastInput > AWAY_AFTER_MS) {
        away = true;
        this.socket?.send({ t: "Away", away: true });
      }
    }, 2000);
    for (const ev of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) window.addEventListener(ev, active, { passive: true });
    this.disposers.push(() => {
      window.clearInterval(awayCheck);
      for (const ev of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) window.removeEventListener(ev, active);
    });

    // Two fingers pinch the world to zoom.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; from: number } | null = null;
    let pinchedAt = 0;
    const spread = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const touchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) pinch = { dist: Math.max(20, spread()), from: this.scene.zoomLevel };
    };
    const touchMove = (e: PointerEvent) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      if (pinch && touches.size >= 2) {
        this.scene.pinch(pinch.from, spread() / pinch.dist);
        pinchedAt = performance.now();
      }
    };
    const touchUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (pinch && touches.size < 2) {
        pinch = null;
        pinchedAt = performance.now();
        this.scene.pinchEnd();
      }
    };
    const surface = this.app.canvas;
    surface.addEventListener("pointerdown", touchDown);
    window.addEventListener("pointermove", touchMove);
    window.addEventListener("pointerup", touchUp);
    window.addEventListener("pointercancel", touchUp);
    // And on touch screens, zoom buttons too.
    const zoomPad = document.createElement("div");
    zoomPad.className = "zoom-pad";
    for (const [label, dir, name] of [["+", 1, "Zoom in"], ["−", -1, "Zoom out"]] as [string, number, string][]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-label", name);
      b.onclick = () => this.scene.zoomBy(dir);
      zoomPad.append(b);
    }
    document.body.append(zoomPad);
    this.disposers.push(() => {
      surface.removeEventListener("pointerdown", touchDown);
      window.removeEventListener("pointermove", touchMove);
      window.removeEventListener("pointerup", touchUp);
      window.removeEventListener("pointercancel", touchUp);
      zoomPad.remove();
    });

    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    const tap = (e: FederatedPointerEvent) => {
      // A pinch isn't a tap.
      if (touches.size > 1 || performance.now() - pinchedAt < 350) return;
      // Your fish flopping on the bank: hit it.
      const wx = (e.global.x - this.scene.world.position.x) / this.scene.scale;
      const wy = (e.global.y - this.scene.world.position.y) / this.scene.scale;
      if (this.flops.hits(this.selfId, wx, wy)) {
        this.socket?.send({ t: "FishHit" });
        return;
      }
      const t = this.scene.screenToTile(e.global.x, e.global.y);
      if (this.tapBall(e.global.x, e.global.y)) return;
      if (this.tapPet(e.global.x, e.global.y)) return;
      if (this.tapCat(e.global.x, e.global.y)) return;
      if (this.tapCaretaker(e.global.x, e.global.y)) return;
      if (this.tapClerk(e.global.x, e.global.y)) return;
      if (this.tapAvatar(e.global.x, e.global.y)) return;
      // Taking your own steps ends following someone.
      if (this.following !== null) this.stopFollowing(true);
      if (this.tapGift(t)) return;
      if (this.tapCollect(t)) return;
      const id = this.furniture.idAt(t);
      const seat = this.furniture.seats.get(id);
      if (seat) return this.sitAt(seat.id);
      const table = this.furniture.tables.get(id);
      if (table) return this.watchTable(table.id);
      const target = nearestWalkable(this.scene.map, t.x, t.y, 2);
      // Tapping twice, or tile after tile in quick succession: sprint there.
      const wall = performance.now();
      if (wall - this.lastTapAt < SPRINT_ASK_MS) this.askSprint();
      this.lastTapAt = wall;
      if (target) this.moveTo(target, true);
    };
    stage.on("pointertap", tap);
    this.disposers.push(() => stage.off("pointertap", tap));

    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (this.jam?.open) this.jam.hide();
        else if (!Panel.closeCurrent()) this.ui.place.hide();
        return;
      }
      if (isTyping(e)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        this.hud.focusChat();
        return;
      }
      if (/^[1-8]$/.test(e.key)) {
        this.emote(Number(e.key));
        return;
      }
      if (KEY_DIRS[e.code]) {
        e.preventDefault();
        // The same way twice in quick succession: sprint.
        if (!e.repeat) {
          const d = KEY_DIRS[e.code];
          const way = `${d.x},${d.y}`;
          const wall = performance.now();
          if (wall - (this.keyPressAt[way] ?? -Infinity) < SPRINT_ASK_MS) {
            this.askSprint();
            this.lastKeyDir = ""; // re-plan the walk at once, at a run
          }
          this.keyPressAt[way] = wall;
        }
        this.keys.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    const resize = () => this.scene.resize();
    // The mouse wheel zooms (a trackpad's many small scrolls add up to a step).
    let wheel = 0;
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) < 60) return;
      this.scene.zoomBy(wheel < 0 ? 1 : -1);
      wheel = 0;
    };
    const canvas = this.app.canvas;
    canvas.addEventListener("wheel", zoom, { passive: false });
    this.disposers.push(() => canvas.removeEventListener("wheel", zoom));
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    this.disposers.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
    });
  }

  // ---- people & gifts ---------------------------------------------------------

  private get isOwnHome(): boolean {
    return this.zoneId === "home" && this.place.owner === this.ui.social.selfId;
  }

  /** Tapping another avatar: befriend, message or block them. */
  private tapAvatar(sx: number, sy: number): boolean {
    for (const a of this.avatars.values()) {
      if (a.info.id === this.selfId) continue;
      const b = a.sprite.getBounds();
      if (sx < b.minX || sx > b.maxX || sy < b.minY || sy > b.maxY) continue;
      const social = this.ui.social;
      const name = a.info.name;
      const friend = social.friendByName(name);
      const say = (p: Promise<string | void>) => p.then((t) => t && this.hud.toast(t)).catch((e) => this.hud.toast(e?.message ?? "That didn't work."));
      const actions: [string, () => void][] = friend
        ? [["Message", () => this.ui.friends.chatWith(friend)]]
        : [["Add friend", () => void say(social.request(name))]];
      const them = a.info.id;
      // Reading something: see what, and open the same book.
      if (a.reading) actions.unshift(["📖 What are they reading?", () => this.ui.bookCard.showBook(a.reading, null)]);
      if (this.following === them) actions.unshift(["👣 Stop following", () => this.stopFollowing(true)]);
      else actions.unshift([friend ? "👣 Follow" : "👣 Ask to follow", () => this.askToFollow(them, name, !!friend)]);
      for (const [kind, t] of Object.entries(TOGETHER)) {
        actions.push([`${t.icon} ${t.offer}`, () => this.offer(a.info.id, Number(kind), name)]);
      }
      actions.push(["Report", () => this.ui.report.openFor(name)]);
      actions.push(["Block", () => confirm(`Block ${name}? You won't see their chat, and they can't contact you.`) && void say(social.block(name).then(() => `Blocked ${name}.`))]);
      this.near(this.ui.menu, this.self?.destination ?? { x: 0, y: 0 }, 6).showWith(name, friend ? (friend.level >= 2 ? "Close friend" : "Friend") : "", actions);
      return true;
    }
    return false;
  }

  private gifts = new Map<string, { sprite: Sprite; tile: TileXY; id: string; card: number; note: string; from: string }>();

  /** Gifts waiting on your doorstep (spec §8.1). */
  private async loadGifts() {
    const gifts = await this.ui.social.gifts().catch(() => []);
    for (const g of this.gifts.values()) g.sprite.destroy();
    this.gifts.clear();
    gifts.slice(0, DOORSTEP.length).forEach((g, i) => {
      const tile = DOORSTEP[i];
      const sprite = new Sprite(g.wrap ? wrappedTexture(g.wrap) : giftBoxTexture());
      sprite.anchor.set(0.5, 1);
      sprite.position.set(tile.x * TILE + TILE / 2, tile.y * TILE + TILE - 2);
      sprite.zIndex = tile.y * TILE + TILE - 2;
      this.scene.sorted.addChild(sprite);
      this.gifts.set(`${tile.x},${tile.y}`, { sprite, tile, id: g.id, card: g.card, note: g.note, from: g.from_name });
    });
    if (gifts.length) this.hud.toast(`${gifts.length === 1 ? "A gift is" : `${gifts.length} gifts are`} waiting on your doorstep 🎁`, 4000);
  }

  private tapGift(t: TileXY): boolean {
    const g = this.gifts.get(`${t.x},${t.y}`);
    if (!g) return false;
    this.ui.social
      .openGift(g.id)
      .then((r) => {
        const [item, qty] = r.applied.added[0] ?? [0, 0];
        this.hud.toast(`🎁 ${qty} ${this.ui.eco.name(item)} from ${r.from_name}`, 4000);
        // A card with it: read it.
        const card = CARDS[g.card];
        if (card || g.note) {
          const title = card ? `${card.icon} ${card.title} from ${g.from}` : `A note from ${g.from}`;
          this.near(this.ui.menu, g.tile, 6).showWith(title, g.note ? `“${g.note}”` : "No words needed.", []);
        }
        return this.ui.eco.load();
      })
      .catch((e) => this.hud.toast(e?.message ?? "That didn't work."))
      .finally(() => void this.loadGifts());
    return true;
  }

  // ---- collecting: fishing, gardens, market, homes ---------------------------

  /** Handles taps on M3 things; returns true if the tap was used. */
  private tapCollect(t: TileXY): boolean {
    const map = this.scene.map;
    const self = this.self;
    if (!self) return false;
    const ui = this.ui;
    if (ui.place.item) {
      this.socket?.send({ t: "Place", item: ui.place.item.id, x: t.x, y: t.y });
      ui.place.hide();
      return true;
    }
    const placed = this.props.objectAt(t.x, t.y);
    if (placed && this.zoneId === "home") {
      this.near(ui.menu, t).showWith(ui.eco.name(placed), "", [["Pick up", () => this.socket?.send({ t: "Pickup", x: t.x, y: t.y })]]);
      return true;
    }
    const tree = this.grove?.at(t);
    if (tree) {
      const f = tree.founder;
      this.hud.toast(f ? `🌳 ${f.name}'s ${STAGES[f.stage]} · Founder #${f.no} · planted ${new Date(f.planted_at * 1000).toLocaleDateString()}` : "🌱 A spot waiting for a founder's seedling. Ask the Caretaker.", 5000);
      return true;
    }
    // Map objects: the drawn art reaches a couple of tiles above the footprint.
    const obj = map.objects.find((o) => !MARKERS.has(o.kind) && t.x >= o.x && t.x < o.x + o.w && t.y >= o.y - (LOW_REACH.has(o.kind) ? 1 : 2) && t.y < o.y + o.h);
    if (obj?.kind === "market_cart") {
      const spot = this.furniture.approach({ x: obj.x, y: obj.y + 1 }, self.destination) ?? { x: obj.x, y: obj.y + 1 };
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) this.moveTo(spot, true);
      this.near(ui.market, obj).show();
      return true;
    }
    if (obj && (obj.kind === "town_hall" || obj.kind === "story_board")) {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) {
        const spot = nearestWalkable(map, obj.x + Math.floor(obj.w / 2), obj.y + obj.h, 2);
        if (spot) this.moveTo(spot, true);
      }
      const at = { x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h };
      if (obj.kind === "town_hall") void this.near(ui.townhall, at, 8).openAt({ kind: "list" });
      else this.near(ui.story, at).show();
      return true;
    }
    if (obj && (obj.kind === "lantern_stand" || obj.kind === "bottles" || obj.kind === "campfire")) {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 2) {
        const spot = nearestWalkable(map, obj.x, obj.y + 1, 2);
        if (spot) this.moveTo(spot, true);
      }
      if (obj.kind === "lantern_stand") this.near(ui.wish, obj).show();
      else if (obj.kind === "bottles") this.near(ui.bottles, obj).show();
      else this.hud.toast("🔥 Sit on a log to join the circle. There's always something to talk about.", 4500);
      return true;
    }
    if (obj && (obj.kind === "tailor" || obj.kind === "wardrobe")) {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 2) {
        const spot = nearestWalkable(map, obj.x + Math.floor(obj.w / 2), obj.y + obj.h, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(ui.wardrobe, { x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h }).openAs(obj.label ?? "Changing room");
      return true;
    }
    // The bar: in through the door; inside, the counter, the pool table, the fire.
    if (obj?.kind === "bar") {
      this.enter({ x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h }, "bar");
      return true;
    }
    if (obj?.kind === "bar_exit") {
      this.events.onTravel("city");
      return true;
    }
    if (obj && (obj.kind === "bar_counter" || obj.kind === "bottle_shelf")) {
      this.clerk?.chat();
      const counter = map.objects.find((o) => o.kind === "bar_counter");
      if (counter) this.openBar(counter);
      return true;
    }
    if (obj?.kind === "pool_table" && this.pool) {
      const front = { x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h };
      if (cheb(self.destination, front) > 3) {
        const spot = nearestWalkable(map, front.x, front.y, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(this.pool, front, 7).show();
      return true;
    }
    // The arcade: in through the doors; inside, the cabinets and the prizes.
    if (obj?.kind === "arcade_hall") {
      this.enter({ x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h }, "arcade");
      return true;
    }
    if (obj && this.tapLibrary(obj)) return true;
    if (obj?.kind === "arcade_exit") {
      this.events.onTravel("city");
      return true;
    }
    if (obj?.kind === "dance_floor" && this.arcade && this.dance) {
      this.moveTo({ x: t.x, y: t.y }, true);
      this.near(this.arcade, t, 5).openCab(this.dance.cab);
      return true;
    }
    if (obj && CABINET_KINDS.includes(obj.kind) && this.arcade) {
      const cab = map.objects.filter((o) => CABINET_KINDS.includes(o.kind)).indexOf(obj);
      // Cabinets are played from the front; the pinball machine from its left end.
      const front = obj.kind === "pinball" ? { x: obj.x - 1, y: obj.y + Math.floor(obj.h / 2) } : { x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h };
      if (cheb(self.destination, front) > 1) {
        const spot = nearestWalkable(map, front.x, front.y, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(this.arcade, front, 5).openCab(cab);
      return true;
    }
    if (obj?.kind === "prize_counter" && this.prizes) {
      this.clerk?.chat();
      const front = { x: obj.x + Math.floor(obj.w / 2), y: obj.y + obj.h };
      if (cheb(self.destination, front) > 3) {
        const spot = nearestWalkable(map, front.x, front.y, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(this.prizes, front, 6).show();
      return true;
    }
    if (obj?.kind === "claw_machine") {
      const lines = ["🧸 The claw grabs a plushie… and drops it. So close!", "🧸 The claw wobbles over the duck… nope.", "🧸 Almost had the frog that time."];
      this.hud.toast(lines[Math.floor(Math.random() * lines.length)], 3000);
      return true;
    }
    if (obj?.kind === "fireplace") {
      this.hud.toast("🔥 The fire crackles. It's warm and smells of pine.", 3500);
      return true;
    }
    if (obj?.kind === "founders_stone") {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) {
        const spot = nearestWalkable(map, obj.x + 1, obj.y + 1, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(ui.founders, obj).show();
      return true;
    }
    if (obj && obj.kind === "signpost") {
      this.hud.toast(`🪧 ${obj.label ?? ""}`, 6000);
      return true;
    }
    if (obj && obj.kind in DISCOVERIES) {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) {
        const spot = nearestWalkable(map, obj.x + Math.floor(obj.w / 2), obj.y + obj.h, 2);
        if (spot) this.moveTo(spot, true);
      }
      const extra = obj.kind === "well" ? ` ${WISHES[Math.floor(Math.random() * WISHES.length)]}` : "";
      this.discover(obj.kind, DISCOVERIES[obj.kind] + extra);
      return true;
    }
    if (obj && ["bandstand", "easels", "arcade"].includes(obj.kind)) {
      // Walk up to it (you need to be close to play), and open it.
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 2) {
        const spot = nearestWalkable(map, Math.min(Math.max(t.x, obj.x), obj.x + obj.w - 1), obj.y + obj.h, 2);
        if (spot) this.moveTo(spot, true);
      }
      if (obj.kind === "bandstand") this.jam?.show();
      else if (obj.kind === "easels") void this.near(ui.easel, obj).openFor(Math.min(obj.w - 1, Math.max(0, t.x - obj.x)));
      else this.near(ui.word, obj).show();
      return true;
    }
    if (obj && (obj.kind.startsWith("board_") || obj.kind === "notice_board" || obj.kind === "fountain")) {
      // Walk over if it's far, and open its panel straight away.
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 4) {
        const spot = nearestWalkable(map, obj.x + Math.floor(obj.w / 2), obj.y + obj.h, 2);
        if (spot) this.moveTo(spot, true);
      }
      if (obj.kind === "notice_board") this.near(ui.requests, obj).show();
      else if (obj.kind === "fountain") this.near(ui.goal, obj, 7).show();
      else void this.near(ui.quarter, obj).openFor(obj.kind.slice("board_".length));
      return true;
    }
    if (obj && (obj.kind === "house" || obj.kind === "postbox") && obj.label) {
      this.tapHouse(obj.label);
      return true;
    }
    if (obj && (obj.kind === "apartments" || obj.kind === "stall")) {
      const front = spot(map, obj.kind === "stall" ? (obj.label ?? "") : "apartments");
      if (front && cheb(self.destination, front) > 3) this.moveTo(front, true);
      const at = front ?? { x: obj.x, y: obj.y };
      if (obj.kind === "stall" && obj.label) this.near(ui.stall, at, 6).openFor(obj.label);
      else this.near(ui.apartments, at, 8).show();
      return true;
    }
    // The mall: in by the Market Hall's door, out the same way.
    if (obj?.kind === "mall_entrance") {
      this.events.onTravel("mall");
      return true;
    }
    if (obj?.kind === "mall_exit") {
      this.events.onTravel("city");
      return true;
    }
    if (obj?.kind === "mall_directory") {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) {
        const spot = nearestWalkable(map, obj.x, obj.y + 1, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(ui.directory, { x: obj.x, y: obj.y + 1 }, 8).show();
      return true;
    }
    if (obj && (obj.kind === "fitting_room" || obj.kind === "mirror") && obj.label) {
      // Try things on before buying (only you see it until you wear it out).
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 2) {
        const spot = nearestWalkable(map, obj.x + 1, obj.y + obj.h, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(ui.wardrobe, { x: obj.x + 1, y: obj.y + obj.h }, 6).openFitting(obj.label, obj.kind === "mirror" ? "The mirror" : "Fitting room");
      return true;
    }
    if (obj && (obj.kind === "display" || obj.kind === "shelf" || obj.kind === "mannequin" || obj.kind === "pet_pen") && obj.label) {
      // Walk up to it and look: what it is, what it costs, buy it.
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 2) {
        const spot = nearestWalkable(map, obj.x, obj.y + 1, 2);
        if (spot) this.moveTo(spot, true);
      }
      const [dept, slot] = obj.label.split(":");
      this.near(ui.shop, { x: obj.x, y: obj.y }, 5).openItem(dept, Number(slot));
      return true;
    }
    const shopAt = obj?.kind === "counter" ? map.objects.find((d) => d.kind === "dept" && obj.x >= d.x && obj.x < d.x + d.w && obj.y >= d.y && obj.y < d.y + d.h) : undefined;
    if (obj && shopAt?.label && ui.shop.isOpen(shopAt.label)) {
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 2) {
        const spot = nearestWalkable(map, obj.x + 1, obj.y + 1, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(ui.shop, { x: obj.x + 1, y: obj.y }, 6).openDept(shopAt.label);
      return true;
    }
    if (obj?.kind === "popup") {
      // The pop-up stand: this season's things.
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) {
        const spot = nearestWalkable(map, obj.x + 2, obj.y + obj.h + 1, 2);
        if (spot) this.moveTo(spot, true);
      }
      this.near(ui.shop, { x: obj.x + 2, y: obj.y + obj.h }, 7).openDept("popup");
      return true;
    }
    if (obj && (obj.kind === "counter" || obj.kind === "shopfront")) {
      this.hud.toast(`🛍️ ${obj.label ?? ""}`, 4000);
      return true;
    }
    if (obj?.kind === "post_office") {
      const door = spot(map, "post_office");
      if (door && cheb(self.destination, door) > 3) this.moveTo(door, true);
      this.near(ui.postOffice, door ?? { x: obj.x, y: obj.y }, 8).show();
      return true;
    }
    if (obj?.kind === "homes_gate") {
      this.events.onTravel("home");
      return true;
    }
    if (obj?.kind === "city_gate") {
      this.events.onTravel("city");
      return true;
    }
    const ground = groundAt(map, t.x, t.y);
    if (ground === "water") {
      this.fish(t);
      return true;
    }
    if (ground === "soil") {
      this.near(ui.plot, t, 4).showFor(t.x, t.y, this.props.plotAt(t.x, t.y));
      return true;
    }
    return false;
  }

  /** Walks within reach of the water if needed, then casts. */
  private fish(target: TileXY) {
    const self = this.self;
    if (!self || !this.socket) return;
    if (self.state === FISHING) return;
    if (cheb(self.destination, target) > CAST_RANGE || !walkable(this.scene.map, self.destination.x, self.destination.y)) {
      const spot = this.castSpot(target, self.destination);
      if (!spot) return this.hud.toast("Find a spot on the shore.");
      this.moveTo(spot, true);
    }
    this.socket.send({ t: "FishCast", x: target.x, y: target.y });
  }

  /** The walkable tile within casting range of `target` nearest to `from`. */
  private castSpot(target: TileXY, from: TileXY): TileXY | null {
    let best: TileXY | null = null;
    let bestD = Infinity;
    for (let dy = -CAST_RANGE; dy <= CAST_RANGE; dy++) {
      for (let dx = -CAST_RANGE; dx <= CAST_RANGE; dx++) {
        const c = { x: target.x + dx, y: target.y + dy };
        if (!walkable(this.scene.map, c.x, c.y)) continue;
        const d = Math.hypot(c.x - from.x, c.y - from.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  private onFish(m: Extract<ServerMsg, { t: "FishEvent" }>) {
    const isSelf = m.id === this.selfId;
    const vol = this.nearbyVolume(m.id);
    switch (m.kind) {
      case FISH.CAST:
        this.castAt.set(m.id, { x: m.x, y: m.y });
        this.props.cast(m.id, { x: m.x, y: m.y });
        this.avatars.get(m.id)?.castLine({ x: m.x, y: m.y }, performance.now());
        sfx.splash(vol, CAST_SWING_MS);
        break;
      case FISH.BITE:
        this.props.bite(m.id);
        this.avatars.get(m.id)?.bite(performance.now());
        if (isSelf) {
          sfx.nibble();
          // How hard the fight is depends on what's on the hook.
          const rarity = this.ui.eco.items.get(m.item)?.rarity ?? 0;
          const rod = this.ui.eco.qty(ROD_ITEM) > 0;
          this.ui.reel.play(REEL_WINDOW_MS, (quality) => this.socket?.send({ t: "FishReel", quality }), rarity, rod);
        }
        break;
      case FISH.FLOP: {
        // Out it comes, onto the bank beside the angler, flopping: hit it!
        this.props.reelIn(m.id);
        this.avatars.get(m.id)?.reelIn(performance.now());
        const fish = this.ui.eco.items.get(m.item);
        const water = this.castAt.get(m.id) ?? { x: m.x, y: m.y };
        // Rare: 3 hits; epic: 4; legendary and mythical: 5 (the server's flop_toughness).
        const need = [3, 3, 3, 4, 5, 5][fish?.rarity ?? 2] ?? 5;
        this.flops.start(m.id, water, { x: m.x, y: m.y }, fish?.key ?? "minnow", fish?.rarity ?? 2, FLOP_MS, isSelf, need);
        sfx.flop(vol);
        if (isSelf) {
          this.ui.reel.stop();
          this.hud.toast(`🐟 It's out, and flopping! Tap it ${need} times in 4.5 seconds (it hops away each time) or it jumps back in!`, 4000);
        }
        break;
      }
      case FISH.HIT:
        this.flops.hit(m.id, m.item, { x: m.x, y: m.y });
        sfx.whack(vol, m.item);
        break;
      case FISH.CAUGHT: {
        this.flops.remove(m.id);
        this.props.reelIn(m.id);
        this.avatars.get(m.id)?.reelIn(performance.now());
        const caught = this.ui.eco.items.get(m.item);
        const rarity = caught?.rarity ?? 0;
        const t = tier(rarity);
        sfx.landed(vol, rarity);
        // Out of the water and up above the angler's head, for all to see.
        const angler = m.id;
        this.catches.start(
          { x: m.x, y: m.y },
          () => {
            const a = this.avatars.get(angler);
            return a ? { x: a.pos.x * TILE + TILE / 2, y: a.pos.y * TILE + TILE - 4 - 34 } : null;
          },
          caught?.key ?? "minnow",
          caught?.name ?? "A fish",
          rarity,
          caught?.kind ?? "fish",
        );
        if (isSelf && rarity >= 4) {
          // A legendary or mythical catch lights up the whole screen.
          const flash = document.createElement("div");
          flash.className = `catch-flash tier-${rarity}`;
          flash.style.setProperty("--tier", t.color);
          document.body.appendChild(flash);
          window.setTimeout(() => flash.remove(), 2600);
        }
        const sparkle = (caught?.rarity ?? 0) >= 3 ? "✨" : "🎣";
        if (isSelf) {
          this.ui.reel.stop();
          this.taskMaybeDone();
          if (m.item === TREASURE_ITEM) this.hud.toast("💰 A treasure chest! You prise it open: +50 coins!", 5000);
          else this.hud.toast(`${sparkle} ${t.name} catch: ${this.ui.eco.name(m.item)}! (worth ${caught?.meta.sell ?? 0} coins to the fisherman)`, (caught?.rarity ?? 0) >= 3 ? 5000 : 3000);
        }
        break;
      }
      case FISH.ESCAPED:
        if (this.flops.has(m.id)) {
          // Back into the water it goes.
          this.flops.escape(m.id);
          sfx.splash(vol, 450);
        }
        this.props.reelIn(m.id);
        this.avatars.get(m.id)?.reelIn(performance.now());
        if (isSelf) {
          sfx.gotAway();
          this.ui.reel.stop();
          this.hud.toast("It got away…");
        }
        break;
    }
  }

  /** How loud someone's sounds are to you: full for your own, fading out over a dozen tiles. */
  private nearbyVolume(id: number): number {
    if (id === this.selfId) return 1;
    const a = this.avatars.get(id);
    const self = this.self;
    if (!a || !self) return 0;
    const d = Math.hypot(a.pos.x - self.pos.x, a.pos.y - self.pos.y);
    return Math.max(0, 1 - d / 12) * 0.6;
  }

  /** Garden action from the plot menu: walk next to the plot, then act. */
  plotAction(x: number, y: number, action: number, item: number) {
    const self = this.self;
    if (!self || !this.socket) return;
    if (cheb(self.destination, { x, y }) > 1) {
      const spot = this.furniture.approach({ x, y }, self.destination) ?? { x, y };
      this.moveTo(spot, true);
    }
    this.socket.send({ t: "PlotAction", x, y, action, item });
    this.taskMaybeDone(3000);
  }

  // ---- sitting & tables ---------------------------------------------------

  /** Walks next to a bench and sits on it (the server applies Sit on arrival). */
  private sitAt(seatId: number) {
    const self = this.self;
    const seat = this.furniture.seats.get(seatId);
    if (!self || !seat || !this.socket) return;
    if (self.state === SITTING && self.destination.x === seat.tile.x && self.destination.y === seat.tile.y) return;
    const from = self.state === SITTING ? (self.standTile ?? self.destination) : self.destination;
    const spot = this.furniture.approach(seat.tile, from);
    if (!spot) return;
    if (spot.x !== from.x || spot.y !== from.y || self.state === SITTING) this.moveTo(spot, true);
    this.socket.send({ t: "Sit", seat: seatId });
    if (seat.table) this.chess.show(seat.table.id, this.games.get(seat.table.id));
  }

  private watchTable(tableId: number) {
    const table = this.furniture.tables.get(tableId)!;
    const self = this.self;
    if (self && Math.hypot(self.pos.x - table.tile.x, self.pos.y - table.tile.y) > WATCH_RANGE) {
      this.hud.toast("Walk closer to watch the game.");
      return;
    }
    this.chess.show(tableId, this.games.get(tableId));
  }

  private onSelfState(state: number, at: TileXY) {
    this.hud.setSitting(state === SITTING);
    const seat = this.furniture.seats.get(this.furniture.idAt(at));
    if (state === SITTING && seat?.table) this.chess.show(seat.table.id, this.games.get(seat.table.id));
  }

  toggleSit() {
    const self = this.self;
    if (!self || !this.socket) return;
    if (self.state === SITTING) this.socket.send({ t: "Stand" });
    else if (!self.moving) this.socket.send({ t: "Sit", seat: SEAT_GROUND });
  }

  emote(id: number) {
    this.socket?.send({ t: "Emote", emote: id });
  }

  chat(text: string) {
    this.socket?.send({ t: "ChatSay", text });
  }

  /** A double tap or key press: sprint from here (outdoors, on foot). */
  private askSprint() {
    this.sprint = true;
    this.sprintAt = performance.now();
  }

  /** Keyboard walking: short segments ahead, re-sent while keys are held. */
  private keyboardMove(wallNow: number) {
    const self = this.self;
    if (this.keys.size > 0 && this.following !== null) this.stopFollowing(true);
    if (!self || this.keys.size === 0) {
      // Keys released: stop at the tile we're walking into instead of
      // finishing the look-ahead segment.
      if (self && this.lastKeyDir && this.socket) {
        const m = self.currentMotion;
        const sp = m ? splice(m, this.socket.clock.now()) : null;
        if (sp) this.moveTo(sp.next, false);
        this.sprint = false;
      }
      this.lastKeyDir = "";
      return;
    }
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      dx += KEY_DIRS[k].x;
      dy += KEY_DIRS[k].y;
    }
    dx = Math.sign(dx);
    dy = Math.sign(dy);
    if (dx === 0 && dy === 0) return;
    const dirKey = `${dx},${dy}`;
    const dest = self.destination;
    const remaining = Math.hypot(dest.x - self.pos.x, dest.y - self.pos.y);
    // On wheels we cover ground faster, so plan further ahead.
    const steps = self.info.vehicle ? KEY_STEPS * 2 : KEY_STEPS;
    // Turning answers at once; going straight, the next stretch is planned
    // well before this one runs out, so the walk never eases off.
    const turned = dirKey !== this.lastKeyDir;
    const due = turned || remaining < steps / 2;
    if (!due || (!turned && wallNow - this.lastKeySend < KEY_RESEND_MS)) return;
    // Plan from exactly where the new stretch will start (the tile we're
    // stepping into, as moveTo splices it), so the walk goes dead straight
    // the way the keys point instead of cutting back toward another line.
    const now = this.socket?.clock.now() ?? 0;
    const cur = self.currentMotion;
    const sp = cur ? splice(cur, now) : null;
    const from = sp ? sp.next : cur && now <= cur.t0 ? cur.path[0] : self.destination;
    const target =
      stepTarget(this.scene.map, from, dx, dy, steps) ??
      (dx && dy ? stepTarget(this.scene.map, from, dx, 0, steps) ?? stepTarget(this.scene.map, from, 0, dy, steps) : null);
    if (!target) return;
    this.lastKeyDir = dirKey;
    this.lastKeySend = wallNow;
    this.moveTo(target, false);
  }

  // ---- frame -------------------------------------------------------------

  private update() {
    const wallNow = performance.now();
    const serverNow = this.socket?.clock.now() ?? 0;
    this.keyboardMove(wallNow);

    // Move the camera first so every label is placed against this frame's view.
    const self = this.self;
    if (self) {
      self.update(serverNow, wallNow);
      this.scene.follow(self.pos);
      this.ui.minimap.update(self.pos, self.moving ? self.destination : null, wallNow);
    }
    for (const a of this.avatars.values()) a.update(serverNow, wallNow);

    if (self) {
      const others = [...this.avatars.values()].filter((a) => a !== self);
      others.sort((a, b) => dist2(a.pos, self.pos) - dist2(b.pos, self.pos));
      // Nearest first; a name that would overlap a nearer one waits its turn.
      const shown = [self.nameBox()];
      others.forEach((a, i) => {
        const box = a.nameBox();
        a.showName = i < MAX_NAMES && !shown.some((b) => Math.abs(b.y - box.y) < 15 && b.x0 < box.x1 + 4 && box.x0 < b.x1 + 4);
        if (a.showName) shown.push(box);
      });
      this.hud.setNearby(this.avatars.size);
    }
    this.scene.update();
    this.props.update(wallNow, (id) => this.avatars.get(id)?.rodTip ?? null);
    this.ambient.update(this.app.ticker.deltaMS, wallNow);
    this.daynight.update();
    this.milestones.update(wallNow, this.daynight.dark);
    this.ball?.update(serverNow);
    const hour = this.daynight.hour();
    this.weather.update(wallNow, hour);
    this.critters.update(wallNow, this.daynight.dark);
    this.cat?.update(Date.now());
    this.petLife.update(wallNow);
    if (this.caretaker) {
      this.caretaker.update(Date.now(), wallNow);
      this.caretakerChat(wallNow);
    }
    this.clerk?.update(Date.now(), wallNow);
    if (this.libraryRoom) {
      this.libraryRoom.update(performance.now());
      this.libraryArrived();
    }
    this.danceFloor(serverNow);
    this.checkEntering();
    this.sky.update(wallNow, this.daynight.dark > 0.5);
    if (this.following !== null && wallNow > this.followCheckAt) {
      this.followCheckAt = wallNow + 350;
      this.followStep();
    }
    if (this.campfire) {
      const at = this.campfire.at;
      this.campfire.update(wallNow, !!self && self.state === SITTING && Math.hypot(self.pos.x - at.x, self.pos.y - at.y) <= 3);
    }
    if (wallNow > this.ringCheckAt) {
      this.ringCheckAt = wallNow + 400;
      // The fairy ring is found by walking into the hidden clearing.
      if (self && this.fairyRing && Math.hypot(self.pos.x - this.fairyRing.x, self.pos.y - this.fairyRing.y) < 1.6 && !found().has("fairy_ring")) {
        this.discover("fairy_ring", DISCOVERIES.fairy_ring);
      }
      if (self) this.checkNook(self.pos);
      this.checkTestRide();
      this.closeIfWalkedAway();
    }
    this.ui.sound.update(wallNow, { dark: this.daynight.dark, weather: this.weather.kind });
    this.catches.update(wallNow);
    this.flops.update(wallNow);
    if (wallNow > this.playingCheckAt) {
      this.playingCheckAt = wallNow + 300;
      this.markPlayers();
    }
    sfx.skate.update(!!self?.riding, wallNow);
    // The jam pads go away when you walk off from the bandstand.
    if (this.jam?.open && self) {
      const b = this.scene.map.objects.find((o) => o.kind === "bandstand");
      if (b && cheb({ x: Math.round(self.pos.x), y: Math.round(self.pos.y) }, { x: b.x + 2, y: b.y + 1 }) > 7) this.jam.hide();
    }
    if (this.screen && self) {
      const c = this.screen.center;
      this.screen.update(serverNow, Math.abs(c.x - self.pos.x) < 30 && Math.abs(c.y - self.pos.y) < 20);
    }
    // Stop following a game once we've wandered off.
    if (this.chess.open && self) {
      const t = this.furniture.tables.get(this.chess.table);
      if (t && Math.hypot(self.pos.x - t.tile.x, self.pos.y - t.tile.y) > WATCH_RANGE) this.chess.hide();
    }
  }

  destroy() {
    this.socket?.close();
    this.clearAvatars();
    for (const d of this.disposers) d();
    this.chess.el.remove();
    this.daynight.destroy();
    this.milestones.destroy();
    this.weather.destroy();
    this.critters.destroy();
    this.caretaker?.destroy();
    this.petLife.destroy();
    this.houseFronts?.destroy();
    this.ui.decorate.hide();
    this.clerk?.destroy();
    this.libraryRoom?.destroy();
    this.ui.shelf.hide();
    this.ui.bookCard.hide();
    this.ui.catalogue.hide();
    this.rpsPicker.destroy();
    this.pool?.destroy();
    this.arcade?.destroy();
    this.fisherman?.destroy();
    this.catches.destroy();
    this.flops.destroy();
    this.danceBot?.destroy();
    this.prizes?.destroy();
    document.body.classList.remove("woozy");
    window.clearTimeout(this.soberTimer);
    this.campfire?.destroy();
    this.sky.destroy();
    this.ui.offer.hide();
    this.hud.setFollow(null);
    document.body.classList.remove("in-nook");
    this.hud.setChatHint(null);
    for (const p of [this.ui.bottles, this.ui.wish]) p.hide();
    for (const p of [this.ui.welcomePanel, this.ui.founders]) p.hide();
    for (const p of [this.ui.plot, this.ui.menu, this.ui.market, this.ui.easel, this.ui.word, this.ui.townhall, this.ui.story]) p.hide();
    this.ui.reel.stop();
    this.ui.place.hide();
    this.ui.minimap.setMap(null);
    this.app.stage.removeChild(this.scene.world);
    this.scene.destroy();
  }
}

function dist2(a: TileXY, b: TileXY) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function loadMood(): number {
  try {
    return Number(localStorage.getItem("commons.mood") ?? 0) || 0;
  } catch {
    return 0;
  }
}
