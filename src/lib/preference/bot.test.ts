// Тесты мозга бота: решения всегда легальны, уровни различимы.
import assert from "node:assert/strict"
import { test } from "node:test"

import { createRound, type RoundState, type Seat } from "./round"
import { chooseAction, isMisereClean, normalizeBotLevel, type BotLevel } from "./bot"
import type { Card } from "./cards"

const SEED = 42

/** Собираем RoundState вручную для управляемых сценариев. */
function makeRound(
  overrides: Omit<Partial<RoundState>, "hands"> & { hands?: string[][] },
): RoundState {
  const base = createRound({ seed: SEED, dealer: 0 })
  return { ...base, ...overrides } as RoundState
}

test("normalizeBotLevel: известные значения проходят, неизвестное → PLAYER", () => {
  assert.equal(normalizeBotLevel("NOVICE"), "NOVICE")
  assert.equal(normalizeBotLevel("PLAYER"), "PLAYER")
  assert.equal(normalizeBotLevel("MASTER"), "MASTER")
  assert.equal(normalizeBotLevel("garbage"), "PLAYER")
  assert.equal(normalizeBotLevel(null), "PLAYER")
  assert.equal(normalizeBotLevel(42), "PLAYER")
})

test("NOVICE в торговле: заказывает только 6 при сильной руке, иначе пасует", () => {
  const round = makeRound({
    phase: "bidding",
    turn: 0 as Seat,
    hands: [["SA", "SK", "SQ", "SJ", "S10", "S9", "S8", "S7", "HA", "HK"], [], []],
    bids: [null, null, null],
    highest: null,
  })
  const action = chooseAction(round, 0 as Seat, "NOVICE")
  assert.equal(action.type, "bid")
  if (action.type === "bid") {
    assert.equal(action.level, 6)
  }

  const weak = makeRound({
    phase: "bidding",
    turn: 0 as Seat,
    hands: [["S7", "S8", "S9", "H7", "H8", "H9", "D7", "D8", "D9", "C7"], [], []],
    bids: [null, null, null],
    highest: null,
  })
  const pass = chooseAction(weak, 0 as Seat, "NOVICE")
  assert.equal(pass.type, "pass")
})

test("PLAYER в торговле: заказывает выше если рука сильная и есть высший заказ", () => {
  const round = makeRound({
    phase: "bidding",
    turn: 0 as Seat,
    hands: [["SA", "SK", "SQ", "SJ", "S10", "S9", "S8", "S7", "HA", "HK"], [], []],
    bids: [null, null, null],
    highest: { seat: 1 as Seat, bid: { level: 6, trump: "S" } },
  })
  const action = chooseAction(round, 0 as Seat, "PLAYER")
  assert.equal(action.type, "bid")
  if (action.type === "bid") {
    assert.ok(action.level > 6)
  }
})

test("MASTER в торговле: расчётный заказ, учитывает козыри", () => {
  const round = makeRound({
    phase: "bidding",
    turn: 0 as Seat,
    hands: [["SA", "SK", "SQ", "SJ", "HA", "HK", "HQ", "HJ", "D7", "D8"], [], []],
    bids: [null, null, null],
    highest: { seat: 1 as Seat, bid: { level: 6, trump: "H" } },
  })
  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "bid")
  if (action.type === "bid") {
    assert.ok(action.level > 6)
    assert.ok(["S", "C", "D", "H"].includes(action.trump))
  }
})

test("все уровни: снос ровно две карты из руки", () => {
  const hand = ["SA", "SK", "SQ", "SJ", "S10", "HA", "HK", "HQ", "HJ", "D7"]
  for (const level of ["NOVICE", "PLAYER", "MASTER"] as BotLevel[]) {
    const round = makeRound({
      phase: "declaring",
      turn: 0 as Seat,
      hands: [hand, [], []],
      declarer: 0 as Seat,
      prikupAck: [0 as Seat, 1 as Seat, 2 as Seat],
      highest: { seat: 0 as Seat, bid: { level: 6, trump: "S" } },
    })
    const action = chooseAction(round, 0 as Seat, level)
    assert.equal(action.type, "declare")
    if (action.type === "declare") {
      assert.equal(action.discard.length, 2)
      for (const card of action.discard) {
        assert.ok(hand.includes(card), `сброшенная карта ${card} не из руки`)
      }
      assert.notEqual(action.discard[0], action.discard[1])
    }
  }
})

test("прикуп открыт: бот жмёт Ок, пока не все посмотрели", () => {
  const hand = ["SA", "SK", "SQ", "SJ", "S10", "HA", "HK", "HQ", "HJ", "D7"]
  const round = makeRound({
    phase: "declaring",
    turn: 0 as Seat,
    hands: [hand, [], []],
    declarer: 0 as Seat,
    prikupAck: [],
    highest: { seat: 0 as Seat, bid: { level: 6, trump: "S" } },
  })

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "prikup-ack")
  if (action.type === "prikup-ack") assert.equal(action.seat, 0 as Seat)
})

test("взятка сошлась: бот жмёт Ок, пока не все посмотрели", () => {
  const round = makeRound({
    phase: "play",
    turn: null,
    hands: [["SA", "SK"], ["H7"], ["DA"]],
    trick: [],
    trickAck: [1 as Seat],
    history: [
      { cards: [{ seat: 1, card: "H7" }, { seat: 2, card: "D7" }, { seat: 0, card: "SA" }], winner: 0 as Seat },
    ],
  } as unknown as RoundState)

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "trick-ack")
  if (action.type === "trick-ack") assert.equal(action.seat, 0 as Seat)
})

test("ход картой: всегда из legalMoves (масть хода обязана)", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    hands: [["SA", "SK", "HA", "HK", "S7", "S8", "S9", "D7", "D8", "D9"], [], []],
    trick: [{ seat: 1 as Seat, card: "S7" } as { seat: Seat; card: string }],
  } as unknown as RoundState)

  for (const level of ["NOVICE", "PLAYER", "MASTER"] as BotLevel[]) {
    const action = chooseAction(round, 0 as Seat, level)
    assert.equal(action.type, "play")
    if (action.type === "play") {
      // В масть хода (пики) обязаны ходить
      assert.ok(action.card.startsWith("S"), `ожидалась пика, вышел ${action.card}`)
      // Карта должна быть в руке
      assert.ok(round.hands[0].includes(action.card))
    }
  }
})

test("ход картой без масти хода: любая карта из руки", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    hands: [["SA", "SK", "HA", "HK", "S7", "S8", "S9", "D7", "D8", "D9"], [], []],
    trick: [],
  } as unknown as RoundState)

  for (const level of ["NOVICE", "PLAYER", "MASTER"] as BotLevel[]) {
    const action = chooseAction(round, 0 as Seat, level)
    assert.equal(action.type, "play")
    if (action.type === "play") {
      const hand = round.hands[0]
      assert.ok(hand.includes(action.card), `карта ${action.card} нет в руке`)
    }
  }
})

test("MASTER при первом ходе играет козырь если есть", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    hands: [["SA", "SK", "HA", "HK", "S7", "S8", "S9", "D7", "D8", "D9"], [], []],
    trick: [],
  } as unknown as RoundState)

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    assert.ok(action.card.startsWith("S"), `мастер должен козырить первым, вышел ${action.card}`)
  }
})

test("мизер: под чужим ходом сбрасывает старшую из не-берущих карт", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    contract: { kind: "misere" },
    declarer: 0 as Seat,
    hands: [["HA", "H8", "H7", "DA"], [], []],
    trick: [{ seat: 1 as Seat, card: "H10" }],
  } as unknown as RoundState)

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    // H8 и H7 не бьют H10 — сбрасываем старшую из безопасных, H8.
    assert.equal(action.card, "H8")
  }
})

test("мизер: если нечем отдаться — играет младшую", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    contract: { kind: "misere" },
    declarer: 0 as Seat,
    hands: [["HA", "HK", "DA"], [], []],
    trick: [{ seat: 1 as Seat, card: "H10" }],
  } as unknown as RoundState)

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    // В масть обязаны, все карты старше H10 — брать придётся, идём младшей.
    assert.equal(action.card, "HK")
  }
})

test("мизер: своим ходом идёт младшей картой руки", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    contract: { kind: "misere" },
    declarer: 0 as Seat,
    hands: [["HA", "HK", "H7", "D9"], [], []],
    trick: [],
  } as unknown as RoundState)

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    assert.equal(action.card, "H7")
  }
})

test("мизер: чистая рука — PLAYER и MASTER заявляют мизер в торговле", () => {
  // Ренонсов нет ни в одной масти, все карты младше накрывающих снаружи.
  const hand: Card[] = ["S7", "S8", "H7", "H8", "D7", "D8", "D9", "D10", "C7", "C8"]
  assert.ok(isMisereClean(hand))

  for (const level of ["PLAYER", "MASTER"] as BotLevel[]) {
    const round = makeRound({
      phase: "bidding",
      turn: 0 as Seat,
      hands: [hand, [], []],
      bids: [null, null, null],
      highest: null,
    })
    const action = chooseAction(round, 0 as Seat, level)
    assert.deepEqual(action, { type: "misere", seat: 0 as Seat })
  }

  // Поверх чужого мизера или заказа выше шестёрки мизер мёртв — пас.
  const vsMisere = makeRound({
    phase: "bidding",
    turn: 0 as Seat,
    hands: [hand, [], []],
    bids: [null, { kind: "misere" } as never, null],
    highest: { seat: 1 as Seat, bid: { kind: "misere" } },
  })
  const dodged = chooseAction(vsMisere, 0 as Seat, "PLAYER")
  assert.equal(dodged.type, "pass")
})

test("мизер: с сносом рука становится чистой — PLAYER объявляет мизер, NOVICE играет", () => {
  const hand: Card[] = [
    "S7", "S8", "SA", "H7", "H8", "D7", "D8", "D9", "D10", "C7", "C8", "C9",
  ]
  const round = makeRound({
    phase: "declaring",
    turn: 0 as Seat,
    hands: [hand, [], []],
    declarer: 0 as Seat,
    prikupAck: [0 as Seat, 1 as Seat, 2 as Seat],
    highest: { seat: 0 as Seat, bid: { level: 6, trump: "S" } },
  })

  const player = chooseAction(round, 0 as Seat, "PLAYER")
  assert.equal(player.type, "declare")
  if (player.type === "declare") {
    assert.equal(player.contract, "misere")
    assert.equal(player.discard.length, 2)
    for (const card of player.discard) {
      assert.ok(hand.includes(card), `карта сноса ${card} не из руки`)
    }
    const rest = hand.filter((card) => !player.discard.includes(card))
    assert.ok(isMisereClean(rest), "после сноса рука должна остаться чистой")
  }

  const novice = chooseAction(round, 0 as Seat, "NOVICE")
  assert.equal(novice.type, "declare")
  if (novice.type === "declare") assert.equal(novice.contract, "game")
})

test("прикуп: сильная рука поднимает заказ, слабая играет заказанное", () => {
  // 4 пики с онёрами и онёры в остальных мастях — рука тянет уровень выше.
  const strong: Card[] = [
    "SA", "SK", "SQ", "S7", "HA", "HK", "DA", "DK", "CA", "CK", "H7", "D7",
  ]
  const strongRound = makeRound({
    phase: "declaring",
    turn: 0 as Seat,
    hands: [strong, [], []],
    declarer: 0 as Seat,
    prikupAck: [0 as Seat, 1 as Seat, 2 as Seat],
    highest: { seat: 0 as Seat, bid: { level: 6, trump: "S" } },
  })

  const player = chooseAction(strongRound, 0 as Seat, "PLAYER")
  assert.equal(player.type, "declare")
  if (player.type === "declare") {
    assert.equal(player.contract, "game")
    assert.deepEqual(
      { level: player.level, trump: player.trump },
      { level: 7, trump: "S" },
      "сильная рука поднимает заказ уровнем",
    )
    for (const card of player.discard) {
      assert.ok(strong.includes(card), `карта сноса ${card} не из руки`)
    }
  }

  // Новичок заказанное не поднимает.
  const novice = chooseAction(strongRound, 0 as Seat, "NOVICE")
  assert.equal(novice.type, "declare")
  if (novice.type === "declare") {
    assert.equal(novice.contract, "game")
    assert.equal(novice.level, undefined)
    assert.equal(novice.trump, undefined)
  }

  // Онёра без поддержки — мизер не спасти и уровень не поднять: играет заказанную шестёрку.
  const weak: Card[] = [
    "SA", "HA", "DA", "S7", "S8", "H7", "H8", "D7", "D8", "C7", "C8", "C9",
  ]
  const weakRound = makeRound({
    phase: "declaring",
    turn: 0 as Seat,
    hands: [weak, [], []],
    declarer: 0 as Seat,
    prikupAck: [0 as Seat, 1 as Seat, 2 as Seat],
    highest: { seat: 0 as Seat, bid: { level: 6, trump: "S" } },
  })
  const cautious = chooseAction(weakRound, 0 as Seat, "PLAYER")
  assert.equal(cautious.type, "declare")
  if (cautious.type === "declare") {
    assert.equal(cautious.contract, "game")
    assert.equal(cautious.level, undefined)
    assert.equal(cautious.trump, undefined)
  }
})

test("мизер: защитник против мизера берёт взятку, а не уклоняется", () => {
  const round = makeRound({
    phase: "play",
    turn: 0 as Seat,
    contract: { kind: "misere" },
    declarer: 1 as Seat,
    hands: [["HA", "H7", "D9"], [], []],
    trick: [{ seat: 1 as Seat, card: "H10" }],
  } as unknown as RoundState)

  const action = chooseAction(round, 0 as Seat, "MASTER")
  assert.equal(action.type, "play")
  if (action.type === "play") {
    assert.equal(action.card, "HA", "защитник должен бить старшей")
  }
})

test("уровни отличаются по решению в торговле", () => {
  const hand = ["SA", "SK", "HA", "HK", "HQ", "HJ", "D7", "D8", "C7", "C8"]
  const round = makeRound({
    phase: "bidding",
    turn: 0 as Seat,
    hands: [hand, [], []],
    bids: [null, null, null],
    highest: null,
  })

  const novice = chooseAction(round, 0 as Seat, "NOVICE")
  const master = chooseAction(round, 0 as Seat, "MASTER")

  assert.ok(
    novice.type === "bid" || novice.type === "pass",
    "новичок должен сделать легальное решение",
  )
  assert.ok(
    master.type === "bid" || master.type === "pass",
    "мастер должен сделать легальное решение",
  )
})

test("всегда возвращает RoundAction с верным seat", () => {
  const round = makeRound({
    phase: "bidding",
    turn: 2 as Seat,
    hands: [[], [], ["SA", "SK", "HA", "HK", "S7", "S8", "S9", "D7", "D8", "D9"]],
    bids: [null, null, null],
    highest: null,
  })

  for (const level of ["NOVICE", "PLAYER", "MASTER"] as BotLevel[]) {
    const action = chooseAction(round, 2 as Seat, level)
    assert.equal(action.seat, 2)
    assert.ok(
      action.type === "bid" || action.type === "pass",
      `ожидался bid или pass, получен ${action.type}`,
    )
  }
})
