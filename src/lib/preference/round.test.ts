import assert from "node:assert/strict"
import { test } from "node:test"

import type { Card } from "./cards"
import { MAX_LEVEL } from "./constants"
import {
  applyAction,
  createRound,
  legalMoves,
  roundOutcome,
  soloWhistController,
  soloWhistPartner,
  trickWinner,
  type RoundAction,
  type RoundState,
  type Seat,
} from "./round"

function ok(state: RoundState, action: RoundAction): RoundState {
  const result = applyAction(state, action)
  if (!result.ok) throw new Error(`неожиданная ошибка: ${result.error}`)
  return result.state
}

function fail(state: RoundState, action: RoundAction): string {
  const result = applyAction(state, action)
  if (result.ok) throw new Error("ожидали ошибку, но действие прошло")
  return result.error
}

function afterBidding(seed: number): RoundState {
  let state = createRound({ seed, dealer: 0 })
  state = ok(state, { type: "bid", seat: 1, level: 6, trump: "S" })
  state = ok(state, { type: "pass", seat: 2 })
  state = ok(state, { type: "pass", seat: 0 })
  return state
}

/** Все трое нажали Ок на открытый прикуп. */
function ackPrikup(state: RoundState): RoundState {
  let open = state
  for (const seat of [2, 1, 0] as Seat[]) {
    open = ok(open, { type: "prikup-ack", seat })
  }
  return open
}

function syntheticPlay(state: Partial<RoundState>): RoundState {
  return {
    ...createRound({ seed: 3, dealer: 0 }),
    phase: "play",
    contract: { kind: "game", level: 6, trump: "S" },
    declarer: 1,
    turn: 1,
    bids: [null, { level: 6, trump: "S" }, "pass"],
    highest: { seat: 1, bid: { level: 6, trump: "S" } },
    trick: [],
    tricks: [0, 0, 0],
    history: [],
    ...state,
  }
}

/** Синтетические распасы: прикуп известен, первая карта прикупа на сукне. */
function syntheticRaspas(state: Partial<RoundState>): RoundState {
  return {
    ...createRound({ seed: 3, dealer: 0 }),
    phase: "play",
    contract: { kind: "raspas" },
    declarer: null,
    turn: 1,
    bids: ["pass", "pass", "pass"],
    prikup: ["HA", "S7"],
    trick: [{ seat: 0, card: "HA", fromPrikup: true }],
    tricks: [0, 0, 0],
    history: [],
    ...state,
  }
}

test("торговля: заказ, два паса, прикуп переходит играющему", () => {
  const state = afterBidding(11)

  assert.equal(state.phase, "declaring")
  assert.equal(state.declarer, 1)
  assert.equal(state.hands[1].length, 12)
  assert.deepEqual(state.highest, { seat: 1, bid: { level: 6, trump: "S" } })
  assert.equal(state.turn, 1)
  assert.deepEqual(state.prikupAck, [], "прикуп открыт, Ок ещё не прозвучали")
})

test("торговля: заказ должен быть строго выше предыдущего", () => {
  let state = createRound({ seed: 12, dealer: 0 })
  state = ok(state, { type: "bid", seat: 1, level: 6, trump: "S" })
  assert.match(fail(state, { type: "bid", seat: 2, level: 6, trump: "S" }), /выше/)

  state = ok(state, { type: "bid", seat: 2, level: 6, trump: "C" })
  assert.match(fail(state, { type: "bid", seat: 0, level: 6, trump: "S" }), /выше/)

  const lower = createRound({ seed: 12, dealer: 0 })
  assert.match(
    fail(lower, { type: "bid", seat: 1, level: 5, trump: "S" }),
    /от 6 до 10/,
  )
})

test("торговля: чужой ход и пас дважды", () => {
  const state = createRound({ seed: 13, dealer: 0 })
  assert.match(fail(state, { type: "pass", seat: 0 }), /не ваш ход/)

  const once = ok(state, { type: "pass", seat: 1 })
  assert.equal(once.turn, 2)
})

test("все спасовали — распасы без козыря", () => {
  let state = createRound({ seed: 14, dealer: 0 })
  state = ok(state, { type: "pass", seat: 1 })
  state = ok(state, { type: "pass", seat: 2 })
  state = ok(state, { type: "pass", seat: 0 })

  assert.equal(state.phase, "play")
  assert.deepEqual(state.contract, { kind: "raspas" })
  assert.equal(state.turn, 1)
  assert.equal(state.declarer, null)
  // Первая взятка уже заходит картой прикупа.
  assert.deepEqual(state.trick, [
    { seat: 0, card: state.prikup[0], fromPrikup: true },
  ])
})

test("торговля: 6♥ перебивается бескозыркой, 6БК — семёрной в пиках", () => {
  let state = createRound({ seed: 23, dealer: 0 })
  state = ok(state, { type: "bid", seat: 1, level: 6, trump: "H" })
  state = ok(state, { type: "bid", seat: 2, level: 6, trump: "NT" })
  assert.deepEqual(state.highest, { seat: 2, bid: { level: 6, trump: "NT" } })

  state = ok(state, { type: "bid", seat: 0, level: 7, trump: "S" })
  assert.deepEqual(state.highest, { seat: 0, bid: { level: 7, trump: "S" } })
})

test("прикуп открывают всем: снос нельзя, пока не все нажали Ок", () => {
  const state = afterBidding(30)

  assert.deepEqual(state.prikupAck, [])
  const hand = state.hands[1]
  assert.match(
    fail(state, {
      type: "declare",
      seat: 1,
      contract: "game",
      discard: [hand[0], hand[1]],
    }),
    /посмотрят все/,
  )

  // Ок в любом порядке; дважды — ошибка.
  let open = ok(state, { type: "prikup-ack", seat: 2 })
  open = ok(open, { type: "prikup-ack", seat: 1 })
  assert.match(fail(open, { type: "prikup-ack", seat: 1 }), /уже посмотрел/)
  open = ok(open, { type: "prikup-ack", seat: 0 })
  assert.deepEqual(open.prikupAck, [2, 1, 0])

  const declared = ok(open, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard: [hand[0], hand[1]],
  })
  assert.equal(declared.phase, "whist")
})

test("мизер нельзя объявить поверх заказа выше шестёрки", () => {
  let state = createRound({ seed: 24, dealer: 0 })
  state = ok(state, { type: "bid", seat: 1, level: 7, trump: "H" })
  state = ok(state, { type: "pass", seat: 2 })
  state = ok(state, { type: "pass", seat: 0 })

  assert.equal(state.phase, "declaring")
  const hand = state.hands[1]
  assert.match(
    fail(state, {
      type: "declare",
      seat: 1,
      contract: "misere",
      discard: [hand[0], hand[1]],
    }),
    /только при заказе шестой/,
  )
})

test("после прикупа заказ оставляют или поднимают, но не понижают", () => {
  let state = createRound({ seed: 31, dealer: 0 })
  state = ok(state, { type: "bid", seat: 1, level: 7, trump: "H" })
  state = ok(state, { type: "pass", seat: 2 })
  state = ok(state, { type: "pass", seat: 0 })
  const open = ackPrikup(state)
  const hand = open.hands[1]
  const discard = [hand[0] as Card, hand[1] as Card]

  // Понижение ниже заказанной семёрки — ошибка.
  assert.match(
    fail(open, {
      type: "declare",
      seat: 1,
      contract: "game",
      level: 6,
      trump: "NT",
      discard,
    }),
    /оставляют заказанной или поднимают/,
  )
  // Мусорные значения подъёма отклоняются.
  assert.match(
    fail(open, {
      type: "declare",
      seat: 1,
      contract: "game",
      level: 11,
      trump: "S",
      discard,
    }),
    /Заказ — от/,
  )

  // Оставить заказ: контракт ровно заказанный.
  const kept = ok(open, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard,
  })
  assert.deepEqual(kept.contract, { kind: "game", level: 7, trump: "H" })
  assert.equal(kept.phase, "whist")

  // Поднять той же мастью.
  const raisedSame = ok(open, {
    type: "declare",
    seat: 1,
    contract: "game",
    level: 8,
    trump: "H",
    discard,
  })
  assert.deepEqual(raisedSame.contract, { kind: "game", level: 8, trump: "H" })

  // Поднять уровнем и мастью: семёрка без козыря старше семёрки в червах.
  const raisedOther = ok(open, {
    type: "declare",
    seat: 1,
    contract: "game",
    level: 7,
    trump: "NT",
    discard,
  })
  assert.deepEqual(raisedOther.contract, { kind: "game", level: 7, trump: "NT" })
})

test("заявленный в торговле мизер не поднимается и не меняется", () => {
  let state = createRound({ seed: 32, dealer: 0 })
  state = ok(state, { type: "misere", seat: 1 })
  state = ok(state, { type: "pass", seat: 2 })
  state = ok(state, { type: "pass", seat: 0 })
  const open = ackPrikup(state)
  const hand = open.hands[1]
  const discard = [hand[0] as Card, hand[1] as Card]

  // Попытка сыграть игру вместо мизера (в том числе «поднять» до десятной) — ошибка.
  assert.match(
    fail(open, {
      type: "declare",
      seat: 1,
      contract: "game",
      level: MAX_LEVEL,
      trump: "NT",
      discard,
    }),
    /только мизер/,
  )

  const declared = ok(open, {
    type: "declare",
    seat: 1,
    contract: "misere",
    discard,
  })
  assert.deepEqual(declared.contract, { kind: "misere" })
})

test("торговля: мизер заявляют с пустого заказа, он старше всего до девяток включительно", () => {
  let state = createRound({ seed: 25, dealer: 0 })
  state = ok(state, { type: "misere", seat: 1 })
  assert.deepEqual(state.highest, { seat: 1, bid: { kind: "misere" } })

  assert.match(fail(state, { type: "misere", seat: 2 }), /уже заявлен/)
  assert.match(fail(state, { type: "bid", seat: 2, level: 6, trump: "NT" }), /выше/)
  assert.match(fail(state, { type: "bid", seat: 2, level: 7, trump: "S" }), /выше/)
  assert.match(fail(state, { type: "bid", seat: 2, level: 8, trump: "H" }), /выше/)
  assert.match(fail(state, { type: "bid", seat: 2, level: 9, trump: "NT" }), /выше/)
})

test("торговля: мизер можно заявить поверх шестёрки, но не выше", () => {
  let state = createRound({ seed: 26, dealer: 0 })
  state = ok(state, { type: "bid", seat: 1, level: 6, trump: "S" })
  state = ok(state, { type: "misere", seat: 2 })
  assert.deepEqual(state.highest, { seat: 2, bid: { kind: "misere" } })

  const fresh = createRound({ seed: 27, dealer: 0 })
  const seven = ok(fresh, { type: "bid", seat: 1, level: 7, trump: "H" })
  assert.match(fail(seven, { type: "misere", seat: 2 }), /выше шестёрки/)
})

test("мизер из торговли: два паса — прикуп открыт, играть можно только мизер", () => {
  let state = createRound({ seed: 28, dealer: 0 })
  state = ok(state, { type: "misere", seat: 1 })
  state = ok(state, { type: "pass", seat: 2 })
  state = ok(state, { type: "pass", seat: 0 })

  assert.equal(state.phase, "declaring")
  assert.equal(state.declarer, 1)
  assert.equal(state.hands[1].length, 12, "прикуп достаётся играющему")
  assert.deepEqual(state.prikupAck, [])
  assert.deepEqual(state.contract, null)

  // Отказаться от мизера нельзя: игра играется только мизером.
  const hand = state.hands[1]
  const open = ackPrikup(state)
  assert.match(
    fail(open, {
      type: "declare",
      seat: 1,
      contract: "game",
      discard: [hand[0], hand[1]],
    }),
    /только мизер/,
  )

  const declared = ok(open, {
    type: "declare",
    seat: 1,
    contract: "misere",
    discard: [hand[0], hand[1]],
  })
  assert.deepEqual(declared.contract, { kind: "misere" })
  assert.equal(declared.phase, "play")
  assert.equal(declared.turn, 1)
  assert.equal(declared.hands[1].length, 10)
})

test("мизер из торговли перебивается только десятой", () => {
  let state = createRound({ seed: 29, dealer: 0 })
  state = ok(state, { type: "misere", seat: 1 })
  // Девятки мизер не перебивают — ни в масть, ни без козыря.
  assert.match(fail(state, { type: "bid", seat: 2, level: 9, trump: "H" }), /выше предыдущего/)
  assert.match(fail(state, { type: "bid", seat: 2, level: 9, trump: "NT" }), /выше предыдущего/)
  state = ok(state, { type: "bid", seat: 2, level: 10, trump: "S" })
  assert.deepEqual(state.highest, { seat: 2, bid: { level: 10, trump: "S" } })

  state = ok(state, { type: "pass", seat: 0 })
  state = ok(state, { type: "pass", seat: 1 })
  assert.equal(state.phase, "declaring")
  assert.equal(state.declarer, 2)
})

test("прикуп: снос двух карт, рука снова из десяти", () => {
  const state = ackPrikup(afterBidding(15))
  const hand = state.hands[1]
  const next = ok(state, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard: [hand[0], hand[1]],
  })

  assert.equal(next.hands[1].length, 10)
  assert.deepEqual(next.discard, [hand[0], hand[1]])
  assert.equal(next.phase, "whist")
  assert.deepEqual(next.contract, { kind: "game", level: 6, trump: "S" })
})

test("прикуп: снос проверяется", () => {
  const state = ackPrikup(afterBidding(16))
  const hand = state.hands[1]
  assert.match(
    fail(state, { type: "declare", seat: 1, contract: "game", discard: [hand[0]] }),
    /две карты/,
  )
  assert.match(
    fail(state, {
      type: "declare",
      seat: 1,
      contract: "game",
      discard: [hand[0], hand[0]],
    }),
    /повторяются/,
  )
  const foreign = state.hands[0][0]
  assert.match(
    fail(state, {
      type: "declare",
      seat: 1,
      contract: "game",
      discard: [hand[0], foreign],
    }),
    /нет в руке/,
  )
})

test("мизер: без вистов сразу игра", () => {
  const state = ackPrikup(afterBidding(17))
  const hand = state.hands[1]
  const next = ok(state, {
    type: "declare",
    seat: 1,
    contract: "misere",
    discard: [hand[0], hand[1]],
  })

  assert.deepEqual(next.contract, { kind: "misere" })
  assert.equal(next.phase, "play")
  assert.equal(next.turn, 1)
})

test("висты: играющий не вистует, оба решения ведут в игру", () => {
  const state = ackPrikup(afterBidding(18))
  const hand = state.hands[1]
  const declared = ok(state, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard: [hand[0], hand[1]],
  })

  assert.match(fail(declared, { type: "whist", seat: 1, whist: true }), /не вистует/)

  const one = ok(declared, { type: "whist", seat: 2, whist: true })
  assert.equal(one.phase, "whist")
  assert.equal(one.turn, 0)

  const both = ok(one, { type: "whist", seat: 0, whist: false })
  assert.equal(both.phase, "play")
  assert.equal(both.turn, 1)
  assert.match(
    fail(both, { type: "whist", seat: 0, whist: true }),
    /не время вистовать/,
  )
})

test("одиночный вист: вистующий определён, при двух вистах или двух пасах — нет", () => {
  // Вистует место 2, пасует место 0 — вистующий 2, ведёт руку 0.
  const solo = syntheticPlay({ whist: [false, null, true] })
  assert.equal(soloWhistController(solo), 2)
  assert.equal(soloWhistPartner(solo, 2), 0)

  assert.equal(soloWhistController(syntheticPlay({ whist: [true, null, true] })), null)
  assert.equal(soloWhistController(syntheticPlay({ whist: [false, null, false] })), null)
  assert.equal(soloWhistController(syntheticPlay({ contract: { kind: "misere" }, whist: [false, null, true] })), null)
})

test("одиночный вист: вистующий ходит за себя и за пасующего, пасующий не играет", () => {
  const hands = [["HA", "HK"], ["S7"], ["DA", "DK"]] as Card[][]

  // Ход за пасующим: его рукой распоряжается вистующий.
  const partnerTurn = syntheticPlay({
    whist: [false, null, true],
    turn: 0,
    hands,
  })
  assert.match(
    fail(partnerTurn, { type: "play", seat: 0, card: "HA" }),
    /делает вистующий/,
  )
  const forPartner = ok(partnerTurn, { type: "play", seat: 2, card: "HA" })
  assert.deepEqual(forPartner.hands[0], ["HK"])
  assert.deepEqual(forPartner.trick, [{ seat: 0, card: "HA" }])
  assert.equal(forPartner.turn, 1)

  // Ход вистующего за себя — из своей руки, как обычно.
  const ownTurn = syntheticPlay({
    whist: [false, null, true],
    turn: 2,
    hands,
  })
  const own = ok(ownTurn, { type: "play", seat: 2, card: "DA" })
  assert.deepEqual(own.hands[2], ["DK"])
  assert.deepEqual(own.trick, [{ seat: 2, card: "DA" }])

  // Пасующий не действует на чужих ходах, вистующий — на ходе играющего.
  assert.match(
    fail(ownTurn, { type: "play", seat: 0, card: "HA" }),
    /не ваш ход/,
  )
  const declarerTurn = syntheticPlay({
    whist: [false, null, true],
    turn: 1,
    hands,
  })
  assert.match(
    fail(declarerTurn, { type: "play", seat: 2, card: "DA" }),
    /не ваш ход/,
  )
})

test("ходы: в масть обязаны, без масти — любая карта", () => {
  const state = syntheticPlay({
    trick: [{ seat: 1, card: "H7" }],
    turn: 2,
    hands: [["SA", "HA"], ["S7", "C7"], ["DA", "HQ"]],
  })
  assert.deepEqual(legalMoves(state, 2), ["HQ"])

  const voidHearts = syntheticPlay({
    trick: [{ seat: 1, card: "H7" }],
    turn: 2,
    hands: [["SA"], ["S7"], ["DA", "C7"]],
  })
  assert.deepEqual(voidHearts.hands[2], ["DA", "C7"])
  assert.deepEqual(legalMoves(voidHearts, 2).sort(), ["C7", "DA"])
  assert.match(
    fail(voidHearts, { type: "play", seat: 2, card: "S8" }),
    /нет в руке/,
  )
})

test("ходы: не в очередь и не в масть отклоняются", () => {
  const state = syntheticPlay({
    trick: [{ seat: 1, card: "H7" }],
    turn: 2,
    hands: [["SA", "HA"], ["S7"], ["DA", "HQ"]],
  })
  assert.match(fail(state, { type: "play", seat: 0, card: "HA" }), /не ваш ход/)
  assert.match(
    fail(state, { type: "play", seat: 2, card: "DA" }),
    /ходить в масть/,
  )
})

test("распасы: карта прикупа задаёт масть хода", () => {
  const state = syntheticRaspas({
    trick: [{ seat: 0, card: "HA", fromPrikup: true }],
    turn: 1,
    hands: [["SA"], ["H7", "S8"], ["C7"]],
  })
  assert.deepEqual(legalMoves(state, 1), ["H7"], "черва есть — ходим в черву")

  const voidHearts = syntheticRaspas({
    trick: [{ seat: 0, card: "HA", fromPrikup: true }],
    turn: 2,
    hands: [["SA"], ["H7", "S8"], ["C7"]],
  })
  assert.deepEqual(
    legalMoves(voidHearts, 2),
    ["C7"],
    "нет червы — любая карта",
  )
})

test("распасы: первая взятка из четырёх карт, прикуп не берёт", () => {
  let state = syntheticRaspas({
    trick: [{ seat: 0, card: "HA", fromPrikup: true }],
    turn: 1,
    hands: [["SA"], ["H7"], ["HQ"]],
  })
  state = ok(state, { type: "play", seat: 1, card: "H7" })
  state = ok(state, { type: "play", seat: 2, card: "HQ" })
  state = ok(state, { type: "play", seat: 0, card: "SA" })

  // HA прикупа старше всех, но взятку берёт старшая из карт игроков.
  assert.equal(state.history[0].winner, 2)
  assert.deepEqual(state.tricks, [0, 0, 1])
  assert.equal(state.history[0].cards.length, 4)
  assert.equal(state.turn, null, "взятка на сукне до Ок")
})

test("распасы: вторая взятка заходит второй картой прикупа, дальше — победитель", () => {
  let state = syntheticRaspas({
    prikup: ["HA", "S7"],
    trick: [{ seat: 0, card: "S7", fromPrikup: true }],
    history: [
      {
        cards: [
          { seat: 0, card: "HA", fromPrikup: true },
          { seat: 1, card: "H7" },
          { seat: 2, card: "HQ" },
          { seat: 0, card: "SA" },
        ],
        winner: 2,
      },
    ],
    tricks: [0, 0, 1],
    hands: [["C8"], ["S8"], ["S9"]],
  })
  state = ok(state, { type: "play", seat: 1, card: "S8" })
  state = ok(state, { type: "play", seat: 2, card: "S9" })
  state = ok(state, { type: "play", seat: 0, card: "C8" })
  assert.equal(state.history[1].winner, 2)

  state = ok(state, { type: "trick-ack", seat: 0 })
  state = ok(state, { type: "trick-ack", seat: 1 })
  state = ok(state, { type: "trick-ack", seat: 2 })

  // Прикупные взятки кончились: третья заходит картой победителя второй.
  assert.deepEqual(state.trick, [])
  assert.equal(state.turn, 2)
})

test("взятку берёт старший козырь, иначе старшая карта масти хода", () => {
  assert.equal(
    trickWinner(
      [
        { seat: 0, card: "D10" },
        { seat: 1, card: "S7" },
        { seat: 2, card: "DA" },
      ],
      "S",
    ),
    1,
  )
  assert.equal(
    trickWinner(
      [
        { seat: 0, card: "D10" },
        { seat: 1, card: "S7" },
        { seat: 2, card: "DA" },
      ],
      "NT",
    ),
    2,
  )
  assert.equal(
    trickWinner(
      [
        { seat: 0, card: "HA", fromPrikup: true },
        { seat: 1, card: "H7" },
        { seat: 2, card: "HQ" },
      ],
      "NT",
    ),
    2,
    "заходящая карта прикупа не берёт взятку",
  )
})

test("взятка из трёх карт остаётся на столе до Ок, потом ходит победитель", () => {
  let state = syntheticPlay({
    hands: [["SA", "HA"], ["S7", "H7"], ["DA", "HQ"]],
  })
  state = ok(state, { type: "play", seat: 1, card: "H7" })
  state = ok(state, { type: "play", seat: 2, card: "HQ" })
  state = ok(state, { type: "play", seat: 0, card: "HA" })

  assert.deepEqual(state.tricks, [1, 0, 0])
  assert.equal(state.history.length, 1)
  assert.equal(state.turn, null, "ход закрыт, пока взятку не посмотрели")
  assert.deepEqual(state.trickAck, [])

  // Ок в любом порядке, повтор отклоняется, ход раньше всех Ок закрыт.
  state = ok(state, { type: "trick-ack", seat: 2 })
  assert.match(fail(state, { type: "trick-ack", seat: 2 }), /уже посмотрел/)
  assert.match(
    fail(state, { type: "play", seat: 0, card: "SA" }),
    /смотрят собранную взятку/,
  )
  state = ok(state, { type: "trick-ack", seat: 1 })
  state = ok(state, { type: "trick-ack", seat: 0 })

  assert.equal(state.turn as Seat, 0, "последний Ок передаёт ход победителю")
  assert.match(fail(state, { type: "trick-ack", seat: 2 }), /уже все посмотрели/)
  assert.deepEqual(state.trick, [])
})

test("полная раздача: десять взяток и результат", () => {
  let state = ackPrikup(afterBidding(21))
  const hand = state.hands[1]
  state = ok(state, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard: [hand[0], hand[1]],
  })
  state = ok(state, { type: "whist", seat: 2, whist: true })
  state = ok(state, { type: "whist", seat: 0, whist: false })

  let guard = 0
  while (state.phase === "play" && guard < 300) {
    guard += 1
    // Взятка сошлась: Ок жмут все, потом победитель ходит.
    if (state.turn === null) {
      for (const seat of [0, 1, 2] as Seat[]) {
        if (!state.trickAck.includes(seat)) {
          state = ok(state, { type: "trick-ack", seat })
        }
      }
      continue
    }
    const seat = state.turn
    // Одиночный вист: на ходе пасующий — карту кладёт вистующий (место 2).
    const controller = soloWhistController(state)
    const acting =
      controller !== null && seat === soloWhistPartner(state, controller)
        ? controller
        : seat
    const legal = legalMoves(state, seat)
    assert.ok(legal.length > 0, "у игрока должен быть хотя бы один легальный ход")
    state = ok(state, { type: "play", seat: acting, card: legal[0] })
  }

  assert.equal(state.phase, "scored")
  assert.equal(state.history.length, 10)
  assert.equal(
    state.tricks.reduce((sum, value) => sum + value, 0),
    10,
  )
  assert.deepEqual(
    state.hands.map((cards) => cards.length),
    [0, 0, 0],
  )

  const outcome = roundOutcome(state)
  assert.ok(outcome)
  assert.deepEqual(outcome.whisters, [2] as Seat[])
  assert.equal(outcome.declarer as Seat, 1)
  assert.equal(outcome.tricks.reduce((sum, value) => sum + value, 0), 10)
})

test("до конца раздачи действия не принимаются", () => {
  const state = ackPrikup(afterBidding(22))
  const hand = state.hands[1]
  const declared = ok(state, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard: [hand[0] as Card, hand[1] as Card],
  })
  assert.equal(roundOutcome(declared), null)
})