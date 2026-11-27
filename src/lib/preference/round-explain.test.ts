import assert from "node:assert/strict"
import { test } from "node:test"

import { roundCalculation, scoreFormula } from "./round-explain"
import { applyRoundScore, createScoreTable } from "./score"
import type { RoundOutcome } from "./round"
import type { RoundResultView } from "../protocol"

function makeResult(
  table0: ReturnType<typeof createScoreTable>,
  outcome: RoundOutcome,
  roundNumber = 1,
): RoundResultView {
  const scored = applyRoundScore(table0, outcome)
  return {
    roundNumber,
    dealer: 0,
    outcome,
    bids: [null, null, null],
    prikup: [],
    discard: [],
    whist: [null, null, null],
    trickList: [],
    deltas: scored.deltas,
    table: scored.table,
    finished: false,
  }
}

const names = (seat: number) => ["Аня", "Боря", "Вера"][seat] ?? `место ${seat + 1}`

test("сыгранная шестерная: пуля и висты по ставке", () => {
  const result = makeResult(createScoreTable(20), {
    contract: { kind: "game", level: 6, trump: "S" },
    declarer: 1,
    tricks: [3, 6, 1],
    whisters: [0, 2],
  })

  const lines = roundCalculation(result, names)
  assert.ok(
    lines.some((line) => line.includes("Боря сыграл") && line.includes("2 в пулю")),
    `нет записи о пуле: ${lines.join(" | ")}`,
  )
  assert.ok(
    lines.some((line) => line.includes("Аня: 3 взятки × 2 = 6 вистов")),
    `нет вистов Ани: ${lines.join(" | ")}`,
  )
  assert.ok(
    lines.some((line) => line.includes("Вера: 1 взятка × 2 = 2 виста")),
    `нет вистов Веры: ${lines.join(" | ")}`,
  )
})

test("подсад: каждая недобранная взятка по двойной цене", () => {
  const result = makeResult(createScoreTable(20), {
    contract: { kind: "game", level: 8, trump: "H" },
    declarer: 0,
    tricks: [5, 3, 2],
    whisters: [1, 2],
  })

  const lines = roundCalculation(result, names)
  assert.ok(
    lines.some((line) => line.includes("3 × 2 × 6 = 36 на гору")),
    `нет формулы подсада: ${lines.join(" | ")}`,
  )
})

test("одиночный вист: ставка одиночного и игра за пасующего", () => {
  const result = makeResult(createScoreTable(20), {
    contract: { kind: "game", level: 6, trump: "C" },
    declarer: 2,
    tricks: [4, 4, 2],
    whisters: [1],
  })

  const lines = roundCalculation(result, names)
  assert.ok(
    lines.some(
      (line) =>
        line.includes("Боря вистовал один и играл за двоих") &&
        line.includes("8 взяток × 1 = 8 вистов"),
    ),
    `нет записи одиночного виста: ${lines.join(" | ")}`,
  )
  // Норма одиночного вистующего на шестерной — 4 взятки, взято 8: недобора нет.
  assert.ok(!lines.some((line) => line.includes("норма виста")))
})

test("недобор на висте: норма минус взятое — на гору по цене игры", () => {
  const result = makeResult(createScoreTable(20), {
    contract: { kind: "game", level: 7, trump: "D" },
    declarer: 0,
    tricks: [8, 1, 1],
    whisters: [1, 2],
  })

  const lines = roundCalculation(result, names)
  // Норма пары на семерной — 2 взятки, взято 2: недобора нет.
  assert.ok(!lines.some((line) => line.includes("на гору (")), lines.join(" | "))

  const second = makeResult(createScoreTable(20), {
    contract: { kind: "game", level: 7, trump: "D" },
    declarer: 0,
    tricks: [9, 1, 0],
    whisters: [1, 2],
  })
  const secondLines = roundCalculation(second, names)
  assert.ok(
    secondLines.some(
      (line) => line.includes("норма виста — 2 взятки") && line.includes("× 4 = 4 на гору"),
    ),
    `нет записи недобора: ${secondLines.join(" | ")}`,
  )
})

test("мизер: сыгран в пулю, сорван на гору по двойной цене", () => {
  const played = makeResult(createScoreTable(20), {
    contract: { kind: "misere" },
    declarer: 1,
    tricks: [4, 0, 6],
    whisters: [],
  })
  const playedLines = roundCalculation(played, names)
  assert.ok(
    playedLines.some((line) => line.includes("10 в пулю")),
    `нет записи мизера: ${playedLines.join(" | ")}`,
  )

  const broken = makeResult(createScoreTable(20), {
    contract: { kind: "misere" },
    declarer: 1,
    tricks: [4, 1, 5],
    whisters: [],
  })
  const brokenLines = roundCalculation(broken, names)
  assert.ok(
    brokenLines.some((line) => line.includes("1 × 2 × 10 = 20 на гору")),
    `нет записи сорванного мизера: ${brokenLines.join(" | ")}`,
  )
})

test("распасы: по шагу за взятку, дальше дороже", () => {
  const result = makeResult(createScoreTable(20), {
    contract: { kind: "raspas" },
    declarer: null,
    tricks: [2, 8, 0],
    whisters: [],
  })

  const lines = roundCalculation(result, names)
  assert.ok(
    lines.some((line) => line.includes("Боря: 8 взяток × 1 = 8 на гору")),
    `нет записи распасов: ${lines.join(" | ")}`,
  )
  assert.ok(
    lines.some((line) => line.includes("Вера: без взяток — чисто")),
    `нет чистой руки: ${lines.join(" | ")}`,
  )
  assert.ok(
    lines.some((line) => line.includes("цена следующего распаса — 2")),
    `нет дорожания: ${lines.join(" | ")}`,
  )
})

test("формула итога: пуля минус гора плюс висты", () => {
  assert.equal(
    scoreFormula({ pool: 20, mountain: 14, whists: 22 }),
    "пуля 20 − гора 14 + висты 22",
  )
})
