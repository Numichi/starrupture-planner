# Data sources and missing data

The sources of the game data (`public/data/`), the missing data, and the rule for what may go into
the data files. **Only this document (and the other `.md` files) names the sources:** the data files,
the code and the UI never mention a source.

## 1. Sources

| Source | Used for | When |
|---|---|---|
| MetaForge – metaforge.app/starrupture | **primary source**: buildings (power, cost, inputs, unlock), recipes (per-cycle quantities and cycle time), mines, icons | October–November 2026 |
| Steam community guide (0.1.3) | the values of the Sulfur Extractor (its MetaForge page did not arrive; marked "NOT VERIFIED" in the YAML) | October 2026 |
| StarRupture wiki | the purity multipliers of the Ore Excavator (v.1) (Impure / Normal / Pure: ×0.5 / ×1 / ×2) | October 2026 |
| the user (measured in the game) | the per-purity rates of the Ore Excavator v.2: Impure 180, Normal 300, Pure 480 /min (the multiplier is not ×0.5 / ×2 here) | November 2026 |

MetaForge gives recipes per cycle ("x2 / 3 s"); in the data everything is items/min
(`amount × 60 / seconds`), and the comment keeps the original cycle data.

## 2. Rule: what may go into the data

- **Certain data only.** On a conflict, the existing data (from the primary source) wins.
- **No data from other sources is mixed into the recipes.** When only the per-cycle quantities of a
  recipe are known and not its cycle time, the recipe goes in as `perCycle` (see `CONFIGURATION.md`),
  without a rate: the factory computes with 0, the UI shows ⚠ "no data".
- **Manual entry:** until there is data, the user can enter the cycle time in the project (side panel
  › Missing data, or the factory editor). The project JSON stores it (`settings.cycleTimes`, export /
  import), and it applies only until the data gives a certain rate.
- **No new items or recipes are brought in** from the differing recipes of another source (it would
  make debugging harder).

## 3. Missing data (the recipe is known, its cycle time is not)

MetaForge gives no rate for these recipes. The ingredients and the quantities are in the data as
MetaForge gives them (`perCycle`).

| Recipe | Building | Per cycle (MetaForge) |
|---|---|---|
| Heat Shield | Mega Press | Epoxy ×2, Aerogel ×2, Uberfilament ×1, Reinforced Frame ×1 → Heat Shield ×2 |
| Scaffolding | Constructorizer | Uberfilament ×1, Reinforced Frame ×2, Goethite Lattice ×1, Plastic Dust ×1 → ×1 |
| Anti-Radiation Covers | Constructorizer | Reinforced Housing ×2, Reinforced Frame ×1, Pseudorubber Insulator ×1, Epoxy ×2 → ×1 |
| Nanosyringe | Constructorizer | Hardening Agent ×1, Applicator ×2, Nanofiber ×4, Substance #FHS-135-493 ×1 → ×1 |
| RTSC | Constructorizer | Anti-Radiation Covers ×1, Heat Shield ×2, Aerogel ×2, Pseudorubber Insulator ×1 → ×1 |
| Ion Thrusters | Constructorizer | Valve ×1, Heat Shield ×1, Pressure Tank ×1, Rocket Fuel ×1 → ×1 |

### For information: the cycle times of another site

**starrupturecalculator.com** (November 2026) gives cycle times for these products, but **with
different ingredients and quantities** (possibly another game version or another recipe), so they
were not added to the data. If you want to enter them manually (Missing data), these numbers can
serve as a starting point, at your own risk:

| Product | Cycle time on that site | Note |
|---|---|---|
| Heat Shield | 12 s | there: Epoxy ×3, Aerogel ×2, Ceramics ×3, Titanoferrite Ingot ×2 → ×2 |
| Scaffolding | 12 s | there: Calcite Sheets, Reinforced Frame, Plastic Dust, Nanofiber |
| Anti-Radiation Covers | 15 s | there ×2 output, Plastic is one of the ingredients |
| Nanosyringe | 12 s | there: Nanofiber ×2, Applicator ×2, Lens ×2, Substance ×1 |
| RTSC | 15 s | there: Superconductor, Plastic, Aerogel, Electromagnet |
| Ion Thrusters | 1 s | suspiciously short (the others are 12–20 s) |

## 4. Items that take no part in production

- **Quartz Ore**: needed only for building upgrades (Development Station). It is added (name, image),
  but it has no recipe and no mine, and it is no recipe's input.
- **Data Point**: broken parts found in alien test analysis. Used only for unlocks (Recipe Station,
  Development Station); neither producible nor an input. So it is not added as an item, it only
  appears in the unlock-cost comments.

## 5. Updating

When new data arrives (e.g. MetaForge pages): follow the steps of the `add-game-data` skill. When a
`perCycle` recipe gets its cycle time, it becomes `input` / `output` (items/min) and `perCycle` is
deleted; from then on the users' manual values no longer apply (the Missing data section lists them
as "data available", and they can be deleted).
