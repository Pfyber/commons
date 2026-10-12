# ADR 0009: A dreamier park: secret places and gentle ways to meet

Status: accepted · 2026-10-12

## Why

People come to Commons partly because they're lonely. Meeting a stranger is
hard, and a public square is no place for a heartfelt conversation. This
batch adds:

- ways to signal that you're open to company;
- small physical gestures that need both people;
- prompts that give strangers something to talk about;
- private places for quieter talks;
- moments everyone shares, like a shooting star or a lantern.

## What

- **Nooks** (map objects `nook`). Chat inside a nook is heard only by people
  inside it, and chat from outside doesn't reach in. It's checked on the
  zone server per listener tile. Presence stays visible: words are private,
  not people. The four nooks are:
  - **The Willow Hideaway:** a willow ring in the meadow. One curtain of
    branches is walkable.
  - **The Moss Grotto:** in the Whispering Wood. One "pine" is a passage.
  - **The Little Island:** stepping stones from the pier.
  - **The Heart of the Maze.**

  Entering a nook for the first time counts as a discovery. Inside, the
  screen edges soften and the chat box says who can hear you.
- **Moods** (`SetMood`, carried in `EntityInfo`): a sign before your name.
  The options are open to chat 💬, quiet company 🌙, up for a game ♟, or
  nothing. Your mood is remembered per browser.
- **Together** (`Offer` / `Accept` → `Together`): a hug, a high five or a
  dance. You offer from someone's menu. It only happens if they accept
  within 20 s while standing within 2 tiles. It counts as "sitting with
  someone" for the Caretaker's tasks, and as an interaction for active
  days. Blocked people's offers are never shown.
- **Sky lanterns** (`SkyLantern` → `LanternRise`): a 60-character wish,
  filtered like chat, one per 30 s, refused while muted. It's released at
  the wish-lantern stand on the picnic lawn and seen rising by everyone
  nearby.
- **The campfire circle** on the west field: six log seats. While you sit
  there, a card shows a gentle question. It changes every 4 minutes from the
  clock, so everyone at the fire sees the same one.
- **Stargazing:** picnic blankets and logs are now seats. After dark a
  shooting star falls about every couple of minutes, from the clock, so
  everyone sees the same star. You get a toast when you're sitting or in a
  nook.
- **Messages in bottles** (API, `bottles` table):
  - **Writing:** an anonymous, filtered note of up to 200 characters, three
    a day.
  - **Finding:** one find an hour, picked at random from the oldest
    unfound bottles. Never your own, and never from someone you've blocked
    or who blocked you.
  - **Answering:** the finder can send a thank-you, which reaches the author
    as an anonymous notification, or report the note. A reported note is
    hidden and goes to the Caretaker's queue.
- **New gathering hours:** campfire stories nightly at 20:00 UTC, and
  stargazing on Saturdays at 20:30 UTC.

## Safety

- Every new text path (lanterns, bottles) uses the chat filter and respects
  mutes.
- Bottles are reportable and go to the existing Caretaker queue.
- Offers need explicit acceptance; ignoring one is the default. Blocks
  hide offers and lanterns.
- Nooks keep words private, but not presence. Reports from inside a nook
  work as anywhere else, through the avatar menu.

Protocol is now v5 (moods, offers, lanterns).
