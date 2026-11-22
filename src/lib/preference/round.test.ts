import assert from "node:assert/strict"
import { test } from "node:test"

import type { Card } from "./cards"
import {
  applyAction,
  createRound,
  legalMoves,
  roundOutcome,
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

test("торговля: заказ, два паса, прикуп переходит играющему", () => {
  const state = afterBidding(11)

  assert.equal(state.phase, "declaring")
  assert.equal(state.declarer, 1)
  assert.equal(state.hands[1].length, 12)
  assert.deepEqual(state.highest, { seat: 1, bid: { level: 6, trump: "S" } })
  assert.equal(state.turn, 1)
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
})

test("без козыря в торговле не заказывают", () => {
  const state = createRound({ seed: 23, dealer: 0 })
  assert.match(
    fail(state, { type: "bid", seat: 1, level: 6, trump: "NT" }),
    /Без козыря/,
  )
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

test("прикуп: снос двух карт, рука снова из десяти", () => {
  const state = afterBidding(15)
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
  const state = afterBidding(16)
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
  const state = afterBidding(17)
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
  const state = afterBidding(18)
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
})

test("взятка из трёх карт уходит победителю, он же ходит следующей", () => {
  let state = syntheticPlay({
    hands: [["SA", "HA"], ["S7", "H7"], ["DA", "HQ"]],
  })
  state = ok(state, { type: "play", seat: 1, card: "H7" })
  state = ok(state, { type: "play", seat: 2, card: "HQ" })
  state = ok(state, { type: "play", seat: 0, card: "HA" })

  assert.deepEqual(state.tricks, [1, 0, 0])
  assert.equal(state.history.length, 1)
  assert.equal(state.turn as Seat, 0)
  assert.deepEqual(state.trick, [])
})

test("полная раздача: десять взяток и результат", () => {
  let state = afterBidding(21)
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
  while (state.phase === "play" && guard < 40) {
    guard += 1
    const seat = state.turn
    assert.notEqual(seat, null)
    const legal = legalMoves(state, seat!)
    assert.ok(legal.length > 0, "у игрока должен быть хотя бы один легальный ход")
    state = ok(state, { type: "play", seat: seat!, card: legal[0] })
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
  const state = afterBidding(22)
  const hand = state.hands[1]
  const declared = ok(state, {
    type: "declare",
    seat: 1,
    contract: "game",
    discard: [hand[0] as Card, hand[1] as Card],
  })
  assert.equal(roundOutcome(declared), null)
})