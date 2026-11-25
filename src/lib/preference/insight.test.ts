// Тесты легальных знаний бота: пул неизвестных карт, ренонсы, геометрия раздачи.
import assert from "node:assert/strict"
import { test } from "node:test"

import { FULL_DECK, type Suit } from "./cards"
import {
  applyAction,
  createRound,
  legalMoves,
  type RoundState,
  type Seat,
} from "./round"
import {
  dealGeometry,
  geometryConsistent,
  sampleDeals,
  unseenCards,
  voidSuits,
} from "./insight"

const SEED = 42

function bidToSix(round: RoundState): RoundState {
  let state = round
  // Торговля: 0 заявляет 6♠, 1 и 2 пасуют → играющий 0.
  for (const action of [
    { type: "bid", seat: 0 as Seat, level: 6, trump: "S" },
    { type: "pass", seat: 1 as Seat },
    { type: "pass", seat: 2 as Seat },
  ]) {
    const result = applyAction(state, action as never)
    assert.ok(result.ok, `действие не применилось: ${"error" in result ? result.error : ""}`)
    state = result.state
  }
  return state
}

test("unseenCards: в торговле невидимы 22 карты (две руки и прикуп)", () => {
  const round = createRound({ seed: SEED, dealer: 0 })
  const unseen = unseenCards(round, 0)
  assert.equal(unseen.length, 22)
  // Ни одна невидимая карта не в нашей руке.
  for (const card of unseen) assert.ok(!round.hands[0].includes(card))
})

test("unseenCards: после открытия прикупа невидимы ровно чужие руки минус вышедшее", () => {
  // Сдаёт место 2: первым говорит место 0.
  const round = bidToSix(createRound({ seed: SEED, dealer: 2 }))
  // Прикуп открыт и уже в руке играющего; сноса ещё нет.
  assert.equal(round.hands[0].length, 12)
  const unseen = unseenCards(round, 1)
  // 32 − 10 у нас − 12 у играющего (рука с прикупом) = 10? Нет: прикуп публичен,
  // значит невидимы руки обоих соперников минус известный прикуп: 10 + (12 − 2) = 20.
  assert.equal(unseen.length, 20)
  for (const card of unseen) {
    assert.ok(!round.hands[1].includes(card), `своя карта не может быть невидимой: ${card}`)
    assert.ok(!round.prikup.includes(card), `прикуп не должен быть невидимым: ${card}`)
  }
})

test("voidSuits: кто не пошёл в масть — у того её нет", () => {
  const round = {
    ...createRound({ seed: SEED, dealer: 0 }),
    history: [
      {
        cards: [
          { seat: 0 as Seat, card: "S7" },
          { seat: 1 as Seat, card: "H7" },
          { seat: 2 as Seat, card: "S8" },
        ],
        winner: 2 as Seat,
      },
    ],
    trick: [],
  } as unknown as RoundState

  const voids = voidSuits(round)
  assert.ok(voids.get(1 as Seat)?.has("S"), "первый не пошёл в пики — ренонс")
  assert.ok(!voids.get(2 as Seat)?.has("S"), "третий пошёл в масть")
  assert.ok(!voids.get(0 as Seat)?.has("S"))
})

test("dealGeometry: в торговле прикуп скрыт и входит в пул", () => {
  const round = createRound({ seed: SEED, dealer: 0 })
  const geometry = dealGeometry(round, 0)
  assert.ok(geometryConsistent(geometry))
  assert.equal(geometry.prikupCount, 2)
  assert.equal(geometry.unknown.length, 22)
  assert.deepEqual(geometry.counts, [10, 10])
})

test("dealGeometry: недискарднутый прикуп точно в руке играющего", () => {
  let state = bidToSix(createRound({ seed: SEED, dealer: 2 }))
  // Играющий (0) смотрит прикуп, защитники тоже; снос ещё не сделан.
  for (const seat of [0, 1, 2] as Seat[]) {
    const result = applyAction(state, { type: "prikup-ack", seat })
    assert.ok(result.ok)
    state = result.state
  }
  const geometry = dealGeometry(state, 1)
  const fixed = geometry.fixed[0 as Seat] ?? []
  // Из двух карт прикупа обе пока в руке играющего (сноса не было).
  assert.equal(fixed.length, 2)
  for (const card of state.prikup) assert.ok(fixed.includes(card))
  assert.ok(geometryConsistent(geometry))
})

/** Все спасовали — распасы. */
function allPass(round: RoundState): RoundState {
  let state = round
  for (const action of [
    { type: "pass", seat: 1 as Seat },
    { type: "pass", seat: 2 as Seat },
    { type: "pass", seat: 0 as Seat },
  ]) {
    const result = applyAction(state, action as never)
    assert.ok(result.ok, `пас не применился: ${"error" in result ? result.error : ""}`)
    state = result.state
  }
  return state
}

test("распасы: первая карта прикупа открыта, вторая ещё скрыта", () => {
  const round = allPass(createRound({ seed: SEED, dealer: 0 }))
  const unseen = unseenCards(round, 0)
  assert.ok(
    !unseen.includes(round.prikup[0]),
    "заходящая карта прикупа видна всем",
  )
  assert.ok(unseen.includes(round.prikup[1]), "вторая карта прикупа ещё скрыта")

  const geometry = dealGeometry(round, 0)
  assert.ok(geometryConsistent(geometry))
  assert.deepEqual(
    geometry.limbo,
    [round.prikup[1]],
    "скрытая карта прикупа не у кого не лежит",
  )
  assert.equal(geometry.unknown.length, 20, "пул ровно покрывает чужие руки")
})

test("распасы: вторая карта прикупа открывается после первой взятки", () => {
  let round = allPass(createRound({ seed: SEED, dealer: 0 }))
  // Доигрываем первую взятку докладами от первой руки.
  while (round.turn !== null) {
    const seat = round.turn
    const legal = legalMoves(round, seat)
    const result = applyAction(round, { type: "play", seat, card: legal[0] })
    assert.ok(result.ok)
    round = result.state
  }
  for (const seat of [0, 1, 2] as Seat[]) {
    const result = applyAction(round, { type: "trick-ack", seat })
    assert.ok(result.ok)
    round = result.state
  }

  const unseen = unseenCards(round, 0)
  assert.ok(
    !unseen.includes(round.prikup[1]),
    "вторая карта прикупа открыта в момент своей взятки",
  )
  const geometry = dealGeometry(round, 0)
  assert.deepEqual(geometry.limbo, [], "скрытого прикупа больше нет")
})

test("sampleDeals: размеры рук, ренонсы и фиксированный прикуп соблюдаются", () => {
  // Взгляд защитника (место 2): прикуп {S10, HQ} в руке играющего 0,
  // снос {DA, DK}; партнёр 1 — без бубён (ренонс). Итого 32 листа.
  const round = {
    ...createRound({ seed: SEED, dealer: 0 }),
    phase: "play",
    contract: { kind: "game", level: 6, trump: "S" },
    declarer: 0 as Seat,
    hands: [
      ["SA", "SK", "SQ", "SJ", "HA", "HK", "HQ", "S10", "CA", "CK"],
      ["S7", "S8", "H7", "H8", "C7", "C8", "C9", "C10", "CJ", "CQ"],
      ["S9", "H9", "H10", "HJ", "D7", "D8", "D9", "D10", "DJ", "DQ"],
    ],
    prikup: ["S10", "HQ"],
    discard: ["DA", "DK"],
    trick: [],
    history: [],
    tricks: [0, 0, 0],
    trickAck: [],
    whist: [null, true, true],
    turn: 0 as Seat,
  } as unknown as RoundState

  const geometry = dealGeometry(round, 2 as Seat)
  assert.ok(geometryConsistent(geometry))
  // Недискарднутый прикуп точно в руке играющего.
  assert.equal((geometry.fixed[0 as Seat] ?? []).length, 2)

  let rngState = 12345
  const rng = (): number => {
    rngState = (rngState * 1103515245 + 12345) % 2147483648
    return rngState / 2147483648
  }
  const voids = new Map<Seat, Set<Suit>>([
    [0 as Seat, new Set<Suit>()],
    [1 as Seat, new Set<Suit>(["D"])],
    [2 as Seat, new Set<Suit>()],
  ])
  const deals = sampleDeals(geometry, voids, rng, 40)
  assert.ok(deals.length > 0, "сэмплы должны найтись")
  for (const deal of deals) {
    const [handDeclarer, handPartner] = deal.hands
    assert.equal(handDeclarer.length, 10)
    assert.equal(handPartner.length, 10)
    for (const card of handPartner) {
      assert.ok(!card.startsWith("D"), `ренонс нарушен: ${card}`)
    }
    // Играющему достались недискарднутые карты прикупа.
    for (const card of round.prikup) {
      assert.ok(handDeclarer.includes(card), `${card} из прикупа не у играющего`)
    }
    // Карты сэмпла не пересекаются с нашей рукой.
    for (const card of [...handDeclarer, ...handPartner]) {
      assert.ok(!round.hands[2].includes(card))
    }
  }
})

test("sampleDeals: сэмплы не теряют и не дублируют карты", () => {
  const round = createRound({ seed: SEED, dealer: 0 })
  const geometry = dealGeometry(round, 2)
  let rngState = 777
  const rng = (): number => {
    rngState = (rngState * 48271) % 2147483647
    return rngState / 2147483647
  }
  const deals = sampleDeals(geometry, voidSuits(round), rng, 25)
  const all = FULL_DECK.slice()
  for (const deal of deals) {
    const union = new Set([...round.hands[2], ...deal.hands[0], ...deal.hands[1], ...deal.prikup])
    assert.equal(union.size, 32, "сэмпл должен покрывать всю колоду вместе с нашей рукой")
    for (const card of all) assert.ok(union.has(card))
  }
})
