import assert from "node:assert/strict"
import { test } from "node:test"

import { CHAT_MAX_LENGTH } from "../protocol"
import { rankOf, suitOf, type Card } from "./cards"
import type { ScoreEntry, ScoreTable } from "./score"
import { DEFAULT_RULESET } from "./rules"
import type { CompletedTrick, RoundState, Seat } from "./round"
import type {
  GameActionView,
  RoundResultView,
} from "../protocol"
import {
  matchTableTalk,
  TABLE_TALK,
  type RoundKind,
  type TableTalkContext,
} from "./table-talk"

// ---------- фабрики раскладов ----------

function round(partial: Partial<RoundState> = {}): RoundState {
  return {
    seed: 1,
    dealer: 0,
    hands: [[], [], []],
    prikup: [],
    phase: "play",
    bids: [null, null, null],
    turn: null,
    highest: null,
    declarer: null,
    contract: null,
    discard: [],
    prikupAck: [],
    trickAck: [],
    whist: [null, null, null],
    trick: [],
    tricks: [0, 0, 0],
    history: [],
    ...partial,
  }
}

function entry(partial: Partial<ScoreEntry> = {}): ScoreEntry {
  return { pool: 0, mountain: 0, whists: 0, ...partial }
}

function table(entries?: ScoreEntry[], raspasStep = 1): ScoreTable {
  return {
    bullet: 20,
    entries: entries ?? [entry(), entry(), entry()],
    raspasStep,
    rules: DEFAULT_RULESET,
  }
}

function result(partial: Partial<RoundResultView> = {}): RoundResultView {
  return {
    roundNumber: 1,
    dealer: 0,
    outcome: {
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 0,
      tricks: [6, 2, 2],
      whisters: [1],
    },
    bids: [null, null, null],
    prikup: [],
    discard: [],
    whist: [null, null, null],
    trickList: [],
    deltas: [entry(), entry(), entry()],
    table: table(),
    finished: false,
    ...partial,
  }
}

function ctx(partial: Partial<TableTalkContext> = {}): TableTalkContext {
  return {
    roundNumber: 1,
    round: null,
    actions: [],
    result: null,
    table: table(),
    awaitingOneReady: false,
    previousKind: null,
    ...partial,
  }
}

function ids(context: TableTalkContext): string[] {
  return matchTableTalk(context).map((replica) => replica.id)
}

function has(context: TableTalkContext, ...wanted: string[]): void {
  const found = ids(context)
  for (const id of wanted) {
    assert.ok(found.includes(id), `ждём «${id}», найдено: ${found.join(", ") || "ничего"}`)
  }
}

/** Взятка: карты по местам и победитель. */
function trick(cards: [Seat, Card][], winner: Seat): CompletedTrick {
  return { cards: cards.map(([seat, card]) => ({ seat, card })), winner }
}

// ---------- каталог ----------

test("каталог реплик: id уникальны, тексты не пустые и влезают в чат", () => {
  const seen = new Set<string>()
  for (const replica of TABLE_TALK) {
    assert.ok(!seen.has(replica.id), `id ${replica.id} повторяется`)
    seen.add(replica.id)
    assert.ok(replica.text.length > 0, `у ${replica.id} пустой текст`)
    assert.ok(
      replica.text.length <= CHAT_MAX_LENGTH,
      `${replica.id} длиннее лимита чата`,
    )
  }
  assert.ok(TABLE_TALK.length >= 70, "фольклорный список подозрительно сжался")
})

test("пустой расклад не тянет ни одну реплику", () => {
  assert.deepEqual(ids(ctx()), [])
})

// ---------- торговля ----------

test("шесть бубён — обманут, семь бубён — на…ён, бескозырный валет — игры нет", () => {
  has(
    ctx({
      actions: [{ type: "bid", seat: 0, bid: { level: 6, trump: "D" } }],
    }),
    "six-diamonds",
  )
  const seven = ctx({
    actions: [{ type: "bid", seat: 0, bid: { level: 7, trump: "D" } }],
  })
  has(seven, "seven-diamonds", "seven-diamonds-variant")
  assert.ok(!ids(seven).includes("six-diamonds"))
  has(
    ctx({
      actions: [{ type: "bid", seat: 1, bid: { level: 6, trump: "NT" } }],
    }),
    "jack-no-game",
  )
})

test("пики в торговле молчат, смелая девятка и десятая говорят", () => {
  // «Две пики» теперь про прикуп, а не про торговлю пиками.
  assert.deepEqual(
    ids(ctx({ actions: [{ type: "bid", seat: 0, bid: { level: 6, trump: "S" } }] })),
    [],
  )
  has(
    ctx({ actions: [{ type: "bid", seat: 0, bid: { level: 9, trump: "H" } }] }),
    "orders-near",
    "orders-curious",
    "cry-hearts",
  )
  has(
    ctx({ actions: [{ type: "bid", seat: 0, bid: { level: 10, trump: "C" } }] }),
    "brave-ten",
  )
})

test("мизер в торговле: вобла и сто грамм", () => {
  has(
    ctx({ actions: [{ type: "misere", seat: 2 }] }),
    "seven-vobla",
    "hundred-grams",
  )
})

test("полковник и поручик пасуют на трёх тузах", () => {
  const hand: Card[] = ["SA", "HA", "DA", "HK", "HQ", "HJ", "H10", "H9", "H8", "H7"]
  has(
    ctx({
      actions: [{ type: "pass", seat: 1 }],
      round: round({ phase: "bidding", hands: [[], hand, []] }),
    }),
    "colonel",
    "poruchik",
  )
  // Двух тузов мало: убираем червового туза.
  const twoAces: Card[] = ["SA", "HK", "DA", "HQ", "HJ", "H10", "H9", "H8", "C7", "C8"]
  assert.deepEqual(
    ids(
      ctx({
        actions: [{ type: "pass", seat: 1 }],
        round: round({ phase: "bidding", hands: [[], twoAces, []] }),
      }),
    ),
    [],
  )
})

test("два паса — в прикупе чудеса", () => {
  has(
    ctx({
      actions: [{ type: "pass", seat: 2 }],
      round: round({ phase: "bidding", bids: ["pass", null, "pass"] }),
    }),
    "two-passes",
    "two-passes-sausage",
  )
})

test("третий пас — распасы: сдал, помогай столу", () => {
  has(
    ctx({
      actions: [{ type: "pass", seat: 0 }],
      round: round({
        phase: "play",
        contract: { kind: "raspas" },
        bids: ["pass", "pass", "pass"],
      }),
    }),
    "dealer-helps",
  )
})

// ---------- прикуп и заказ ----------

test("все посмотрели прикуп: карты соседа и дым", () => {
  has(
    ctx({
      actions: [{ type: "prikup-ack", seat: 2 }],
      round: round({
        phase: "declaring",
        declarer: 0,
        prikupAck: [0, 1, 2],
      }),
    }),
    "neighbor-cards",
    "smoke-more",
  )
})

test("хороший прикуп — заложись выше заказанного", () => {
  has(
    ctx({
      actions: [
        {
          type: "declare",
          seat: 0,
          contract: "game",
          level: 7,
          trump: "S",
        },
      ],
      round: round({
        phase: "whist",
        declarer: 0,
        highest: { seat: 0, bid: { level: 6, trump: "S" } },
        contract: { kind: "game", level: 7, trump: "S" },
        discard: ["HK", "H9"],
      }),
    }),
    "prikup-good",
  )
})

test("мизер: хозяйка-семёрка и снесённая взятка", () => {
  const base = {
    actions: [
      { type: "declare", seat: 0, contract: "misere" } as GameActionView,
    ],
    round: round({
      phase: "play",
      declarer: 0,
      contract: { kind: "misere" },
      discard: ["H7", "DA"],
    }),
  }
  has(ctx(base), "hostess", "discard-trick", "discard-trick-seat")
  // Без семёрки и без фигур — молчание.
  assert.deepEqual(
    ids(
      ctx({
        actions: [
          { type: "declare", seat: 0, contract: "misere" },
        ],
        round: round({
          phase: "play",
          declarer: 0,
          contract: { kind: "misere" },
          discard: ["H9", "D9"],
        }),
      }),
    ),
    [],
  )
})

test("прикуп с тузом — жил бы в Сочи; две пики в прикупе", () => {
  has(
    ctx({
      actions: [{ type: "declare", seat: 0, contract: "game" }],
      round: round({
        phase: "whist",
        declarer: 0,
        prikup: ["SA", "HK"],
        contract: { kind: "game", level: 6, trump: "S" },
      }),
    }),
    "sochi",
  )
  // Прикуп без туза — Сочи отменяется.
  assert.ok(!ids(ctx({
    actions: [{ type: "declare", seat: 0, contract: "game" }],
    round: round({
      phase: "whist",
      declarer: 0,
      prikup: ["HK", "HQ"],
      contract: { kind: "game", level: 6, trump: "S" },
    }),
  })).includes("sochi"))
  has(
    ctx({
      actions: [{ type: "declare", seat: 0, contract: "game" }],
      round: round({
        phase: "whist",
        declarer: 0,
        prikup: ["S7", "SA"],
        contract: { kind: "game", level: 6, trump: "S" },
      }),
    }),
    "two-spades",
    "two-spades-prikup",
  )
  // Одна пика и без туза — молчание.
  assert.deepEqual(
    ids(
      ctx({
        actions: [{ type: "declare", seat: 0, contract: "game" }],
        round: round({
          phase: "whist",
          declarer: 0,
          prikup: ["S7", "HK"],
          contract: { kind: "game", level: 6, trump: "S" },
        }),
      }),
    ),
    [],
  )
})

test("козыри четыре—на—четыре", () => {
  const spades: Card[] = ["S7", "S8", "S9", "S10", "HK", "HQ", "HJ", "H10", "H9", "H8"]
  const clubs: Card[] = ["SA", "SK", "SQ", "SJ", "DA", "DK", "DQ", "DJ", "D10", "D9"]
  has(
    ctx({
      actions: [{ type: "declare", seat: 0, contract: "game" }],
      round: round({
        phase: "whist",
        declarer: 0,
        contract: { kind: "game", level: 7, trump: "S" },
        hands: [[], spades, clubs],
      }),
    }),
    "four-four-story",
    "four-four-layout",
  )
})

// ---------- вист ----------

function whistContext(level: number, whist: (boolean | null)[], actions: GameActionView[]) {
  return ctx({
    actions,
    round: round({
      phase: "play",
      declarer: 0,
      contract: { kind: "game", level, trump: "S" },
      whist,
    }),
  })
}

test("нет хода — не вистуй; партнёр вистует — тоже не вистуй", () => {
  has(
    whistContext(6, [null, false, null], [{ type: "whist", seat: 1, whist: false }]),
    "no-lead-no-whist",
  )
  has(
    whistContext(
      6,
      [null, false, true],
      [{ type: "whist", seat: 1, whist: false }],
    ),
    "no-lead-no-whist",
    "no-tricks-no-whist",
  )
})

test("девятерная: вистуют женихи, попы и начальник станции Армавир", () => {
  has(
    whistContext(9, [null, true, null], [{ type: "whist", seat: 1, whist: true }]),
    "whist-nine-grooms",
    "whist-nine-priests",
    "whist-nine-armavir",
  )
})

test("парный вист без жадности и одиночный вист втёмную", () => {
  has(
    whistContext(6, [null, true, true], [{ type: "whist", seat: 2, whist: true }]),
    "whist-no-greed",
  )
  has(
    whistContext(6, [null, true, false], [{ type: "whist", seat: 2, whist: false }]),
    "lay-cards",
    "dark-invite",
  )
})

// ---------- ходы и взятки ----------

test("хода нет — ходи с бубей", () => {
  has(
    ctx({
      actions: [{ type: "card", seat: 1, card: "D10" }],
      round: round({
        declarer: 0,
        contract: { kind: "game", level: 6, trump: "S" },
        trick: [{ seat: 1, card: "D10" }],
      }),
    }),
    "lead-diamonds",
  )
})

test("под игрока — с семака, под вистующего — с тузующего", () => {
  const defenderSeven = ctx({
    actions: [{ type: "card", seat: 1, card: "C7" }],
    round: round({
      declarer: 0,
      contract: { kind: "game", level: 6, trump: "S" },
      trick: [{ seat: 1, card: "C7" }],
    }),
  })
  has(
    defenderSeven,
    "lead-seven-ace",
    "lead-seven-ace-short",
    "lead-short-suit",
    "lead-seven-ace-full",
  )
  assert.ok(!ids(defenderSeven).includes("lead-long-suit"))

  has(
    ctx({
      actions: [{ type: "card", seat: 0, card: "SA" }],
      round: round({
        declarer: 0,
        contract: { kind: "game", level: 6, trump: "S" },
        trick: [{ seat: 0, card: "SA" }],
      }),
    }),
    "lead-seven-ace",
    "lead-long-suit",
    "lead-seven-ace-full",
  )
})

test("восьмёрка — враг играющего на мизере", () => {
  has(
    ctx({
      actions: [{ type: "card", seat: 0, card: "H8" }],
      round: round({
        declarer: 0,
        contract: { kind: "misere" },
        trick: [{ seat: 1, card: "H10" }, { seat: 0, card: "H8" }],
      }),
    }),
    "enemy-eight",
  )
})

test("третья дама: уважай и побитого валета", () => {
  const context = ctx({
    actions: [{ type: "trick", winner: 0 }],
    round: round({
      declarer: 0,
      contract: { kind: "game", level: 6, trump: "S" },
      history: [
        trick(
          [
            [1, "H8"],
            [2, "HJ"],
            [0, "HQ"],
          ],
          0,
        ),
      ],
    }),
  })
  has(context, "third-queen", "queens-third", "jack-not-figure")
})

test("две дамы подряд бьются и своя, и чужая", () => {
  has(
    ctx({
      actions: [{ type: "trick", winner: 2 }],
      round: round({
        declarer: 0,
        contract: { kind: "game", level: 6, trump: "S" },
        history: [
          trick(
            [
              [1, "D7"],
              [2, "DQ"],
              [0, "D9"],
            ],
            2,
          ),
          trick(
            [
              [2, "HQ"],
              [0, "H9"],
              [1, "H8"],
            ],
            2,
          ),
        ],
      }),
    }),
    "queen-any-side",
    "queen-any-side-variant",
  )
})

test("слабо стукнешь — не возьмёшь: восьмёрка взяла взятку", () => {
  has(
    ctx({
      actions: [{ type: "trick", winner: 1 }],
      round: round({
        declarer: 0,
        contract: { kind: "game", level: 6, trump: "S" },
        history: [
          trick(
            [
              [1, "H8"],
              [2, "D7"],
              [0, "C9"],
            ],
            1,
          ),
        ],
      }),
    }),
    "weak-knock",
  )
})

test("прорезали тузом и прикрыли фигуры, козырь в козырницах", () => {
  has(
    ctx({
      actions: [{ type: "trick", winner: 2 }],
      round: round({
        declarer: 0,
        contract: { kind: "game", level: 7, trump: "C" },
        history: [
          trick(
            [
              [1, "H10"],
              [2, "HA"],
              [0, "HQ"],
            ],
            2,
          ),
        ],
      }),
    }),
    "cut-with-high",
    "jack-queen-ace",
  )
  has(
    ctx({
      actions: [{ type: "trick", winner: 0 }],
      round: round({
        declarer: 0,
        contract: { kind: "game", level: 7, trump: "S" },
        history: [
          trick(
            [
              [1, "H10"],
              [2, "HK"],
              [0, "S7"],
            ],
            0,
          ),
        ],
      }),
    }),
    "trump-in-sleeve",
  )
})

// ---------- расчёт раздачи ----------

test("подсады: одна взятка — ошибки, две — без сноса, три и больше — враги", () => {
  const podsat = (taken: number) =>
    ctx({
      result: result({
        outcome: {
          contract: { kind: "game", level: 8, trump: "S" },
          declarer: 0,
          tricks: [taken, 5, 10 - taken - 5] as [number, number, number],
          whisters: [1],
        },
      }),
    })
  has(podsat(7), "mistakes-happen", "sit-and-fight")
  has(podsat(6), "no-discard-top-two", "sit-and-fight")
  has(podsat(5), "table-enemies", "worst-enemies", "sit-and-fight")
  assert.ok(!ids(podsat(8)).includes("mistakes-happen"))
  assert.ok(!ids(podsat(8)).includes("sit-and-fight"))
})

test("мизер: радость в дом или трамвай уехал", () => {
  const misere = (taken: number) =>
    ctx({
      result: result({
        outcome: {
          contract: { kind: "misere" } as const,
          declarer: 0,
          tricks: [taken, 4, 6] as [number, number, number],
          whisters: [],
        },
      }),
    })
  has(misere(0), "misere-joy")
  has(misere(1), "not-preferansist", "misere-tram")
})

test("распасы: всё дадут — карта не лошадь", () => {
  const raspas = ctx({
    result: result({
      outcome: {
        contract: { kind: "raspas" } as const,
        declarer: null,
        tricks: [2, 5, 3] as [number, number, number],
        whisters: [],
      },
    }),
  })
  has(raspas, "luck-by-morning", "luck-nicotine", "grab-yours")
})

test("распасы дорожают — пора перестать думать", () => {
  has(ctx({ table: table(undefined, 3), result: result() }), "think-an-hour")
  assert.deepEqual(ids(ctx({ table: table(undefined, 2), result: result() })), [])
})

test("лидер отрывается, гора растёт, пуля догоняет гору", () => {
  has(
    ctx({
      result: result(),
      table: table([entry({ pool: 20 }), entry({ pool: 0 }), entry({ pool: 0 })]),
    }),
    "dont-win-always",
    "high-class",
  )
  has(
    ctx({
      result: result(),
      table: table([entry({ mountain: 20 }), entry(), entry()]),
    }),
    "no-money",
    "no-money-short",
  )
  has(
    ctx({
      result: result({
        deltas: [entry({ mountain: 4 }), entry(), entry()],
      }),
    }),
    "smart-mountain",
    "no-alpinist",
  )
  has(
    ctx({
      result: result({
        deltas: [entry({ mountain: 6 }), entry(), entry()],
      }),
    }),
    "unlucky-love",
    "keep-calm",
  )
  has(
    ctx({
      result: result(),
      table: table([entry({ pool: 12, mountain: 10 }), entry(), entry()]),
    }),
    "bullet-dream",
  )
})

test("партия закрыта — преферанс дарит интересных друзей", () => {
  has(ctx({ result: result({ finished: true }) }), "interesting-friends")
})

test("первый ремиз на первой же раздаче — золото", () => {
  has(
    ctx({
      roundNumber: 1,
      result: result({
        outcome: {
          contract: { kind: "game", level: 6, trump: "S" },
          declarer: 0,
          tricks: [4, 3, 3] as [number, number, number],
          whisters: [1, 2],
        },
      }),
    }),
    "first-remise",
  )
})

// ---------- пауза и память стола ----------

test("пуля не свидание: ждём одного", () => {
  has(ctx({ awaitingOneReady: true }), "not-a-date", "not-a-date-start")
})

test("мизера ходят парами: помним прошлую раздачу", () => {
  const afterMisere: TableTalkContext = ctx({
    actions: [{ type: "misere", seat: 1 }],
    previousKind: "misere" as RoundKind,
  })
  has(afterMisere, "misere-pairs")
  assert.ok(!ids(ctx({ actions: [{ type: "misere", seat: 1 }] })).includes("misere-pairs"))
})

// ---------- раздача ----------

test("первая раздача: пятого под стол; дальше — сначала сдай", () => {
  has(
    ctx({ roundNumber: 1, actions: [{ type: "deal", roundNumber: 1, dealer: 0 }] }),
    "fifth-under-table",
  )
  assert.ok(
    !ids(
      ctx({ roundNumber: 3, actions: [{ type: "deal", roundNumber: 3, dealer: 0 }] }),
    ).includes("fifth-under-table"),
  )
  has(
    ctx({ roundNumber: 3, actions: [{ type: "deal", roundNumber: 3, dealer: 0 }] }),
    "deal-then-smoke",
  )
})

// ---------- мелочи ----------

test("карты из одной масти складываются в расклады без падений", () => {
  const context = ctx({
    round: round({
      declarer: 0,
      contract: { kind: "game", level: 6, trump: "NT" },
      history: [
        trick(
          [
            [1, "SA"],
            [2, "SK"],
            [0, "SQ"],
          ],
          1,
        ),
      ],
    }),
    actions: [{ type: "trick", winner: 1 }],
  })
  // Туз взял в масть хода, под ним лежала дама.
  has(context, "cut-with-high", "jack-queen-ace")
  assert.ok(suitOf("SA") === "S" && rankOf("SA") === "A")
})
