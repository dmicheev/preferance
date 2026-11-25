// Тесты умного бота: решение по EV на ручных раскладах с точной
// 32-карточной бухгалтерией, детерминизм и служебные фазы.
import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_RULESET, type Ruleset } from "./rules"
import { chooseActionSmart, type SmartBudgets, type SmartContext } from "./bot-smart"
import { createRound, type RoundState, type Seat, type TrickCard } from "./round"

const rules: Ruleset = DEFAULT_RULESET

/** Ускоренные бюджеты: тесты не должны ждать секунд. */
const FAST: Partial<Record<"NOVICE" | "PLAYER" | "MASTER", Partial<SmartBudgets>>> = {
  NOVICE: { samples: 8, samplesBid: 8, depth: 2, timeMs: 250 },
  PLAYER: { samples: 12, samplesBid: 16, depth: 3, timeMs: 700 },
  MASTER: { samples: 12, samplesBid: 16, depth: 3, timeMs: 700 },
}

const ctx: SmartContext = { rules, raspasStep: 1, budgets: FAST }

function smart(round: RoundState, seat: Seat, level: "NOVICE" | "PLAYER" | "MASTER") {
  return chooseActionSmart(round, seat, level, ctx)
}

/** Взятка из трёх карт по местам 0,1,2 с победителем — старшей картой масти хода. */
function trick(cards: [string, string, string], winner: Seat) {
  const seats: Seat[] = [0, 1, 2]
  const played: TrickCard[] = cards.map((card, index) => ({ seat: seats[index], card: card as never }))
  return { cards: played, winner }
}

/* ---------- распасы: не тратить туз там, где хватает девятки ---------- */

const RASPAS_ROUND = {
  ...createRound({ seed: 5, dealer: 0 }),
  phase: "play",
  contract: { kind: "raspas" },
  declarer: null,
  turn: 0 as Seat,
  hands: [
    ["SA", "S9", "H7", "H8", "H9", "D7", "D8", "C7", "C8", "C9"],
    ["S8", "S10", "SJ", "H10", "HJ", "D9", "D10", "C10", "CJ"],
    ["SQ", "SK", "HQ", "HK", "HA", "DJ", "DQ", "DK", "CQ", "CK"],
  ],
  prikup: ["DA", "CA"], // прикуп распасов скрыт навсегда (limbo)
  discard: [],
  trick: [{ seat: 1 as Seat, card: "S7" }],
  history: [],
  tricks: [0, 0, 0],
  trickAck: [],
  whist: [null, null, null],
} as unknown as RoundState

test("распасы: отдаётся под старшую, а не берёт тузом — считая до конца раздачи", async () => {
  // Предпоследняя взятка: у seat2 черви кончились (сыгран H10), у seat1 HK/DA.
  // H7 под H10 → мои взятки 0; HA берёт себе и заставляет выйти S7 → 2 взятки горы.
  const round = {
    ...createRound({ seed: 11, dealer: 1 }),
    phase: "play",
    contract: { kind: "raspas" },
    declarer: null,
    turn: 0 as Seat,
    hands: [
      ["HA", "H7"],
      ["HK", "DA"],
      ["H8"],
    ],
    prikup: ["C7", "C8"], // limbo
    discard: [],
    trick: [{ seat: 2 as Seat, card: "H10" }],
    history: [
      trick(["SA", "S7", "S8"], 0 as Seat),
      trick(["S9", "S10", "SJ"], 2 as Seat),
      trick(["D7", "D8", "D9"], 2 as Seat),
      trick(["D10", "DJ", "DQ"], 2 as Seat),
      trick(["H9", "HJ", "HQ"], 2 as Seat),
      trick(["C9", "C10", "CJ"], 2 as Seat),
      trick(["CQ", "CK", "CA"], 2 as Seat),
      trick(["SQ", "SK", "DK"], 2 as Seat),
    ],
    tricks: [1, 0, 7],
    trickAck: [],
    whist: [null, null, null],
  } as unknown as RoundState

  const action = await smart(round, 0 as Seat, "PLAYER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    assert.equal(action.card, "H7", `ожидалась H7 (отдаться), сыграна ${action.card}`)
  }
})

test("решения детерминированы: одинаковый вызов — одинаковый ход", async () => {
  const first = await smart(RASPAS_ROUND, 0 as Seat, "MASTER")
  const second = await smart(RASPAS_ROUND, 0 as Seat, "MASTER")
  assert.deepEqual(first, second)
})

/* ---------- мизер: играющий уклоняется от взятки ---------- */

test("мизер: отдаёт семёрку под десятку, а не берёт тузом", async () => {
  // Все карты известны по elimination: сэмплирование вырождается в точный поиск.
  const round = {
    ...createRound({ seed: 6, dealer: 0 }),
    phase: "play",
    contract: { kind: "misere" },
    declarer: 0 as Seat,
    turn: 0 as Seat,
    hands: [
      ["HA", "H7", "D9"],
      ["S9", "SJ", "HK"],
      ["C7", "CJ"],
    ],
    prikup: ["D9", "HK"],
    discard: ["HK", "HQ"],
    trick: [{ seat: 2 as Seat, card: "H10" }],
    history: [
      trick(["SA", "S7", "S8"], 0 as Seat),
      trick(["SK", "SQ", "S10"], 0 as Seat),
      trick(["H8", "H9", "HJ"], 2 as Seat),
      trick(["DA", "D7", "D10"], 0 as Seat),
      trick(["DJ", "DQ", "DK"], 0 as Seat),
      trick(["C8", "C9", "C10"], 2 as Seat),
      trick(["CQ", "CK", "CA"], 2 as Seat),
    ],
    tricks: [4, 0, 3],
    trickAck: [],
    whist: [null, null, null],
  } as unknown as RoundState

  const action = await smart(round, 0 as Seat, "PLAYER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    assert.equal(action.card, "H7", `играющий должен отдаться H7, сыграл ${action.card}`)
  }
})

/* ---------- торговля: сила руки видна в EV ---------- */

test("торговля: монстр заказывает игру в своей масти", async () => {
  const round = {
    ...createRound({ seed: 7, dealer: 0 }),
    phase: "bidding",
    turn: 0 as Seat,
    bids: [null, null, null],
    highest: null,
    hands: [["SA", "SK", "SQ", "SJ", "S10", "S9", "S8", "S7", "HA", "HK"], [], []],
  } as unknown as RoundState

  const action = await smart(round, 0 as Seat, "PLAYER")
  assert.equal(action.type, "bid")
  if (action.type === "bid") {
    assert.equal(action.trump, "S")
    assert.ok(action.level >= 6 && action.level <= 10, `уровень ${action.level} вне границ`)
  }
})

test("торговля: пустая рука пасует — распас дешевле подсада", async () => {
  const round = {
    ...createRound({ seed: 8, dealer: 0 }),
    phase: "bidding",
    turn: 0 as Seat,
    bids: [null, null, null],
    highest: null,
    hands: [["S7", "S8", "H7", "H8", "D7", "D8", "DA", "DK", "C7", "C8"], [], []],
  } as unknown as RoundState

  const action = await smart(round, 0 as Seat, "PLAYER")
  assert.equal(action.type, "pass")
})

/* ---------- вист: решает ожидание в очках, а не порог на пальцах ---------- */

const WHIST_DECLARER = ["SK", "SQ", "S9", "DA", "DK", "DQ", "CA", "CK", "HQ", "HJ"]

function whistRound(myHand: string[], partnerHand: string[]): RoundState {
  // Играющий 0 заказал 6♠; мы (место 1) решаем вист.
  // Бухгалтерия: руки 30 карт + снос {S8, CJ} = 32; прикуп {SK, SQ} в руке играющего.
  return {
    ...createRound({ seed: 9, dealer: 2 }),
    phase: "whist",
    contract: { kind: "game", level: 6, trump: "S" },
    declarer: 0 as Seat,
    turn: 1 as Seat,
    bids: [{ level: 6, trump: "S" }, null, "pass"],
    highest: { seat: 0 as Seat, bid: { level: 6, trump: "S" } },
    hands: [WHIST_DECLARER, myHand, partnerHand],
    prikup: ["SK", "SQ"],
    discard: ["S8", "CJ"],
    trick: [],
    history: [],
    tricks: [0, 0, 0],
    trickAck: [],
    whist: [null, null, null],
  } as unknown as RoundState
}

test("вист: три козыря и тузы — вистую", async () => {
  const strong = whistRound(
    ["SA", "S10", "SJ", "HA", "HK", "D10", "D9", "C10", "C9", "C7"],
    ["S7", "H7", "H8", "H9", "H10", "D7", "D8", "DJ", "C8", "CQ"],
  )
  const action = await smart(strong, 1 as Seat, "PLAYER")
  assert.equal(action.type, "whist")
  if (action.type === "whist") assert.equal(action.whist, true)
})

test("вист: мелкий козырь, но рука пасующего сильная — вистую и играю за двоих", async () => {
  const weak = whistRound(
    ["S7", "D7", "D8", "D10", "H7", "H8", "C7", "C8", "C9", "H9"],
    ["SA", "S10", "SJ", "HA", "HK", "H10", "D9", "DJ", "C10", "CQ"],
  )
  const action = await smart(weak, 1 as Seat, "PLAYER")
  // Одиночный вист: вистующий ходит за себя и за пасующего, поэтому
  // слабая своя рука вместе с сильной рукой пасующего стоит вистования.
  assert.equal(action.type, "whist")
  if (action.type === "whist") assert.equal(action.whist, true)
})

/* ---------- служебные фазы без поиска ---------- */

test("Ок на прикуп отдаётся без поиска", async () => {
  const ack = {
    ...createRound({ seed: 10, dealer: 0 }),
    phase: "declaring",
    turn: 0 as Seat,
    declarer: 0 as Seat,
    prikupAck: [],
    hands: [["SA", "SK"], [], []],
  } as unknown as RoundState
  const action = await smart(ack, 0 as Seat, "MASTER")
  assert.equal(action.type, "prikup-ack")
})
