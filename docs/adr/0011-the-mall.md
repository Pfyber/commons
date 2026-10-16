# ADR 0011: The Commons Mall

Status: accepted · 2026-10-16

A shopping mall on the Market block: one big walkable floor behind a
front door on the square, with a food court in the middle, a walking loop
around it and departments along the outside. It's NPC-run, prices are in
coins, and it's built to give people more reasons to be in the same place
(browse together, try things on, sit at the food court, walk pets) rather
than to sell as much as possible.

## Placement

- **Market Hall:** the building on the Market's north side holds the mall
  on the ground floor and the eight apartments above (the city plan's
  "apartments above market shops"). Two doors on the square: the mall's in
  the middle, the apartments' to the west.
- **Interior:** its own zone, `mall`, about two blocks of floor (96 × 80
  tiles), bigger than the building's footprint. Shared: everyone inside
  sees everyone. One copy until crowd instancing (city step C8), then the
  same rule as the Market.
- **Doors:** in through the front door; out through the same door onto
  the square. `arrive` (ADR 0010, C3) is generalised: a home's owner, or a
  public door (`place:mall`).

## Layout

The food court is an open atrium in the middle with café tables and
benches. A four-tile walking loop runs round it. Shops line the outside of
the loop, related ones side by side:

```
 Seeds & garden | Tools | Furniture | Home exterior
 ---------------+------------------------------+---------------
                |   loop                        |  Clothing
   Vehicles     |      FOOD COURT (atrium)      |
   (test track) |                               |  Skins
                |   loop                        |
 ---------------+------------------------------+---------------
 Pets | Gift shop | Pop-up · entrance · directory | Toys | Music
```

The seasonal pop-up and the directory map are in the entrance hall.

## Decisions

| Question | Decision |
|---|---|
| Free looks | Today's styles stay free at the Tailor. The mall sells new outfits, hats, accessories and skins; fitting rooms and the mirror let you try before buying. |
| Protocol | The bigger look and visible vehicles and pets need protocol v7. It ships with the Clothing/Skins step on its own, not tied to the zone-per-block work. |
| Real money | None. Items carry `account_bound`, enforced (no stalls, gifts or selling back) from the start, so nothing changes if that's ever used. |
| Player shops | The mall never sells what players produce (fish, plants, junk, crafted things): items are tagged by source and a test keeps player-made items out of every mall catalog. |
| Tools | Cosmetic for now (a nicer rod, a watering can you're seen holding). Effects on catches or growth would need economy balancing. |
| Vehicles | Skates ×1.3, scooter ×1.5, bike ×1.8 walking speed, anywhere outdoors in the city. Off at every door. A ride-along: someone following you keeps up because following uses your speed. |
| Pets | **Pets belong to a house** (not apartments: they need a garden). A pet lives at home, waits in the yard, and wants **a walk every day**: take it out and it follows you around the city, visible to everyone; pets greet each other and their walkers can say hi. No punishment for missed days (spec: no streaks): an unwalked pet just waits by the door looking hopeful. Moving out takes the pet with you to the next house. |
| Market cart | Stays as the place to *sell* fish and harvests; buying seeds and furniture moves to the mall. |
| Food | Social only: sit at a food court table and share a snack (an emote). No food items. |
| Home exterior | Facades, fences, yard decor and postbox styles, saved per house and drawn for everyone; a later step. |
| Order | Before city step C5 (transit). |
| Prices | A coin sink next to rent: furniture 50–150, clothing 30–200, vehicles 150–400, pets 100–250; fish sell for 5–20, a Cottage is 15 a week. |

## Milestones

| Step | What | Playable because |
|---|---|---|
| **M1** ✓ | Market Hall with the mall door; the interior: entrance hall with directory map and pop-up stand, food court tables and benches, the loop, storefronts with signs (shops "opening soon"); in and out by the front door. | A new place; nothing else changes. |
| **M2** ✓ | Departments from data (`assets/mall/departments.json`: type, layout, catalog); displays on shelves, racks and in model rooms; inspect and quick-buy at a display, or browse at the counter. Opens Furniture and Seeds & garden. | Buying goes through the economy ledger; other shops stay "opening soon". |
| **M3** | Weekly stock rotation (shared deterministic choice per department and week), limited stock, the seasonal pop-up from an event calendar, "new this week" signs. | Same shop, changing. |
| **M4** | Owned cosmetics, protocol v7 (extended look, vehicle, pet), Clothing and Skins with fitting rooms and a mirror, `account_bound` enforcement. | Free looks keep working. |
| **M5** | Pets: adopt at the Pets shop (needs a house), the pet at home, daily walks, pets meeting. | Optional. |
| **M6** | Vehicles: equip from the bag or hotbar, speed outdoors, dismount at doors, the test track. | Walking is unchanged. |
| **M7** | Tools, Music, Gift shop (wrapping and cards for doorstep gifts), Toys & games, Home exterior. | One shop at a time. |
| **M8** | Shopkeepers, music and lighting per department, a crowded-mall bot test. | Polish. |

## Data model

- `assets/mall/departments.json`: departments with key, name, unit (which
  storefront), type (`shelves`, `racks`, `showroom`, `track`, `popup`),
  catalog pool (item, weight), display slots, limited items.
- Item `meta`: `price`, `dept`, `source` (`npc` or `player`),
  `account_bound`, `speed` (vehicles), `slot` (cosmetics), `pet`.
- `mall_stock(rotation, dept, item_id, remaining)` for limited items only;
  what's on show is computed from the week and the department.
- `player_cosmetics`, `player_equipped`, `pets(owner, kind, name,
  last_walk)`, `lot_exterior(plot, slot, item_id)`.
