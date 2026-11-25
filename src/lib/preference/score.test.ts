import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_RULESET } from "./rules"
import type { Ruleset } from "./rules"
import {
  applyRoundScore,
  createScoreTable,
  finalStandings,
  gameValue,
  isBulletClosed,
  whistRate,
  whistShortfall,
} from "./score"
import type { RoundOutcome, Seat } from "./round"

function outcome(partial: RoundOutcome): RoundOutcome {
  return partial
}

test("стоимость игр и вистов", () => {
  assert.deepEqual(
    [6, 7, 8, 9, 10].map((level) => gameValue(level, DEFAULT_RULESET)),
    [2, 4, 6, 8, 10],
  )
  assert.equal(whistRate(6, 2, DEFAULT_RULESET), 2)
  assert.equal(whistRate(6, 1, DEFAULT_RULESET), 1)
  assert.equal(whistRate(8, 2, DEFAULT_RULESET), 1)
  assert.equal(whistRate(8, 1, DEFAULT_RULESET), 1)
})

test("шестерная выполнена: пуля играющему, висты вистующим", () => {
  const table = createScoreTable(20)
  const result = applyRoundScore(
    table,
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      tricks: [2, 7, 1],
      whisters: [0, 2],
    }),
  )

  assert.deepEqual(
    result.table.entries.map((entry) => entry.pool),
    [0, 2, 0],
  )
  assert.deepEqual(
    result.table.entries.map((entry) => entry.whists),
    [4, 0, 2],
  )
  assert.deepEqual(
    result.deltas.map((entry) => entry.whists),
    [4, 0, 2],
  )
})

test("подсад: двойная стоимость за каждую недобранную взятку", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 7, trump: "H" },
      declarer: 0,
      tricks: [5, 3, 2],
      whisters: [1],
    }),
  )

  // (7 - 5) * 2 * 4 = 16
  assert.equal(result.table.entries[0].mountain, 16)
  assert.equal(result.table.entries[0].pool, 0)
  // Одиночный вист: вистующий играл за двоих — 3 взятки на своей руке
  // и 2 на руке пасующего, все в его вистах.
  assert.equal(result.table.entries[1].whists, 5)
})

test("одиночный вист: вистующий пишет висты за взятки с обеих рук", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      // Играющий взял 3; на руках вистующего (место 2) и пасующего (место 0) — 7.
      tricks: [3, 3, 4],
      whisters: [2],
    }),
  )
  // Ставка одиночного виста на шестерной — 1 вист за взятку: 7 × 1.
  assert.equal(result.table.entries[2].whists, 7)
})

test("недобор на висте: шестерная — 4 на двоих, недобор каждому", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      tricks: [1, 7, 2],
      whisters: [0, 2],
    }),
  )
  // Норма пары — 4 на двоих: вместе 3, недобор 1 пишут оба по цене игры.
  assert.equal(result.table.entries[0].mountain, 2)
  assert.equal(result.table.entries[2].mountain, 2, "норму не закрыли вместе — недобору каждый")
  // Висты считаются как раньше: 1 × 2 и 2 × 2.
  assert.deepEqual(
    result.table.entries.map((entry) => entry.whists),
    [2, 0, 4],
  )
})

test("недобор на висте: шестерная — пара взяла 4, никто не пишет", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      tricks: [1, 6, 3],
      whisters: [0, 2],
    }),
  )
  // Вместе ровно 4: даже 1 взятка на руке одного — недобора нет никому.
  assert.equal(result.table.entries[0].mountain, 0)
  assert.equal(result.table.entries[2].mountain, 0, "норму закрыл партнёр")
  assert.deepEqual(
    result.table.entries.map((entry) => entry.whists),
    [2, 0, 6],
  )
})

test("недобор на висте: одиночка на шестерной отвечает за 4 взятки", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      // Вистующий играл за двоих: 2 на руке пасующего + 1 своя = 3 из 4 нужных.
      tricks: [2, 7, 1],
      whisters: [2],
    }),
  )
  assert.equal(result.table.entries[2].mountain, 2)
})

test("недобор на висте: 7 и 8 — строго 2 на двоих, недобор каждому", () => {
  const made = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 8, trump: "C" },
      declarer: 0,
      // Все 2 взятки у одного вистующего — на двоих достаточно.
      tricks: [8, 2, 0],
      whisters: [1, 2],
    }),
  )
  assert.equal(made.table.entries[1].mountain, 0)
  assert.equal(made.table.entries[2].mountain, 0)

  const short = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 7, trump: "H" },
      declarer: 0,
      tricks: [8, 1, 0],
      whisters: [1, 2],
    }),
  )
  // Вместе 1 из 2: каждая недобранная — каждому по полной цене семёрной.
  assert.equal(short.table.entries[1].mountain, 4)
  assert.equal(short.table.entries[2].mountain, 4)
})

test("недобор на висте: девятная — 1 на двоих, десятая — без требования", () => {
  const nine = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 9, trump: "S" },
      declarer: 0,
      tricks: [9, 1, 0],
      whisters: [1, 2],
    }),
  )
  // Единственную взятку взял первый — на двоих достаточно.
  assert.equal(nine.table.entries[1].mountain, 0)
  assert.equal(nine.table.entries[2].mountain, 0)

  const empty = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 9, trump: "D" },
      declarer: 0,
      tricks: [10, 0, 0],
      whisters: [1, 2],
    }),
  )
  // Ни одной на двоих: каждому по полной цене девятной.
  assert.equal(empty.table.entries[1].mountain, 8)
  assert.equal(empty.table.entries[2].mountain, 8)

  const ten = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 10, trump: "S" },
      declarer: 0,
      tricks: [10, 0, 0],
      whisters: [1, 2],
    }),
  )
  assert.equal(ten.table.entries[1].mountain, 0, "десятая без требования")
  assert.equal(ten.table.entries[2].mountain, 0)
})

test("недобор на бескозырке: норма по порядку игры, цена — по стоимости БК", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 6, trump: "NT" },
      declarer: 1,
      tricks: [1, 8, 1],
      whisters: [0, 2],
    }),
  )
  // Норма как на шестёрной — 4 на двоих (вместе 2, недобор 2 каждому);
  // цена недобора — как семёрной (4): 2 × 4 = 8.
  assert.equal(result.table.entries[0].mountain, 8)
  assert.equal(result.table.entries[2].mountain, 8)
})

test("нормы виста: таблица недобора", () => {
  assert.deepEqual(whistShortfall(6, [2, 2]), [0, 0], "норма пары: 4 на двоих")
  assert.deepEqual(whistShortfall(6, [1, 3]), [0, 0], "вместе 4 — никто не пишет, даже при 1 взятке")
  assert.deepEqual(whistShortfall(6, [0, 4]), [0, 0], "норму закрыл партнёр")
  assert.deepEqual(whistShortfall(6, [1, 2]), [1, 1], "вместе 3 — недобору каждый")
  assert.deepEqual(whistShortfall(6, [3]), [1])
  assert.deepEqual(whistShortfall(7, [2, 0]), [0, 0], "на двоих достаточно")
  assert.deepEqual(whistShortfall(8, [1, 0]), [1, 1], "недобор пишется каждому")
  assert.deepEqual(whistShortfall(8, [2]), [0])
  assert.deepEqual(whistShortfall(9, [1, 0]), [0, 0])
  assert.deepEqual(whistShortfall(9, [0]), [1])
  assert.deepEqual(whistShortfall(10, [0, 0]), [0, 0], "десятая без требования")
})

test("мизер: чистая пуля или двойной штраф за взятки", () => {
  const clean = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "misere" },
      declarer: 2,
      tricks: [4, 6, 0],
      whisters: [],
    }),
  )
  assert.equal(clean.table.entries[2].pool, 10)
  assert.equal(clean.table.entries[2].mountain, 0)

  const dirty = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "misere" },
      declarer: 2,
      tricks: [4, 4, 2],
      whisters: [],
    }),
  )
  assert.equal(dirty.table.entries[2].mountain, 40)
  assert.equal(dirty.table.entries[2].pool, 0)
})

test("распасы дорожают от раза к разу", () => {
  const first = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "raspas" },
      declarer: null,
      tricks: [4, 3, 3],
      whisters: [],
    }),
  )
  assert.deepEqual(
    first.table.entries.map((entry) => entry.mountain),
    [4, 3, 3],
  )
  assert.equal(first.table.raspasStep, 2)

  const second = applyRoundScore(
    first.table,
    outcome({
      contract: { kind: "raspas" },
      declarer: null,
      tricks: [2, 4, 4],
      whisters: [],
    }),
  )
  assert.deepEqual(
    second.table.entries.map((entry) => entry.mountain),
    [8, 11, 11],
  )
  assert.equal(second.table.raspasStep, 3)
})

test("игра сбрасывает цену распасов обратно", () => {
  const raspas = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "raspas" },
      declarer: null,
      tricks: [1, 5, 4],
      whisters: [],
    }),
  )
  const game = applyRoundScore(
    raspas.table,
    outcome({
      contract: { kind: "game", level: 6, trump: "NT" },
      declarer: 0,
      tricks: [6, 2, 2],
      whisters: [1, 2],
    }),
  )
  assert.equal(game.table.raspasStep, 1)
})

test("пуля не переполняется: лишние очки сгорают", () => {
  const table = createScoreTable(20)
  table.entries[0].pool = 18
  const result = applyRoundScore(
    table,
    outcome({
      contract: { kind: "game", level: 7, trump: "S" },
      declarer: 0,
      tricks: [7, 2, 1],
      whisters: [1, 2],
    }),
  )
  assert.equal(result.table.entries[0].pool, 20)
  assert.equal(result.deltas[0].pool, 2)
  assert.equal(table.entries[0].pool, 18, "исходная таблица не меняется")
})

test("пуля закрыта, когда все дошли до bullet", () => {
  const table = createScoreTable(10)
  assert.equal(isBulletClosed(table), false)
  table.entries.forEach((entry) => {
    entry.pool = 10
  })
  assert.equal(isBulletClosed(table), true)
})

test("итоги по местам считаются по одному разу", () => {
  const result = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 10, trump: "NT" },
      declarer: 0,
      tricks: [10, 0, 0],
      whisters: [1, 2] as Seat[],
    }),
  )
  assert.deepEqual(
    result.table.entries.map((entry) => entry.whists),
    [0, 0, 0],
  )
})

test("бескозырка дороже: 6БК платит как семёрная, 10БК не выше десятной", () => {
  const six = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 6, trump: "NT" },
      declarer: 1,
      tricks: [2, 7, 1],
      whisters: [0, 2],
    }),
  )
  // 6БК = семёрная: 4 в пулю, висты по ставке 7–10 (по 1 за взятку).
  assert.deepEqual(
    six.table.entries.map((entry) => entry.pool),
    [0, 4, 0],
  )
  assert.deepEqual(
    six.table.entries.map((entry) => entry.whists),
    [2, 0, 1],
  )

  const top = applyRoundScore(
    createScoreTable(20),
    outcome({
      contract: { kind: "game", level: 10, trump: "NT" },
      declarer: 2,
      tricks: [0, 0, 10],
      whisters: [],
    }),
  )
  assert.equal(top.table.entries[2].pool, 10, "10БК считается десятной")
})

test("кастомные цифры: цена игр, вистов и подсада берётся из Ruleset", () => {
  const custom: Ruleset = {
    ...DEFAULT_RULESET,
    gameValues: { 6: 5, 7: 7, 8: 9, 9: 11, 10: 13 },
    misereValue: 4,
    whistRateSix: 3,
    singleWhistRate: 2,
    shortfallFactor: 3,
    raspasBase: 2,
    raspasGrowth: 2,
  }
  assert.equal(gameValue(6, custom), 5)

  const won = applyRoundScore(
    createScoreTable(20, custom),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      tricks: [2, 6, 2],
      whisters: [0],
    }),
  )
  assert.equal(won.table.entries[1].pool, 5)
  assert.equal(
    won.table.entries[0].whists,
    (2 + 2) * 2,
    "одиночный вист: взятки с обеих рук по ставке вистующего",
  )

  const fell = applyRoundScore(
    createScoreTable(20, custom),
    outcome({
      contract: { kind: "game", level: 7, trump: "H" },
      declarer: 2,
      tricks: [4, 3, 4],
      whisters: [],
    }),
  )
  assert.equal(fell.table.entries[2].mountain, (7 - 4) * 3 * 7)

  const ras = applyRoundScore(
    createScoreTable(20, custom),
    outcome({
      contract: { kind: "raspas" },
      declarer: null,
      tricks: [1, 1, 1],
      whisters: [],
    }),
  )
  assert.deepEqual(
    ras.table.entries.map((entry) => entry.mountain),
    [2, 2, 2],
  )
})

test("итог партии: места по «пуля − гора + висты»", () => {
  const table = createScoreTable(20)
  table.entries[0] = { pool: 20, mountain: 2, whists: 0 }
  table.entries[1] = { pool: 20, mountain: 0, whists: 14 }
  table.entries[2] = { pool: 12, mountain: 0, whists: 10 }

  // seat 0: 18, seat 1: 34, seat 2: 22 — места по убыванию счёта.
  assert.deepEqual(finalStandings(table), [
    { seat: 1, place: 1, score: 34 },
    { seat: 2, place: 2, score: 22 },
    { seat: 0, place: 3, score: 18 },
  ])
})

test("ничья: выше место у игрока с меньшей горой", () => {
  const table = createScoreTable(20)
  table.entries[0] = { pool: 20, mountain: 4, whists: 2 }
  table.entries[1] = { pool: 20, mountain: 2, whists: 0 }
  table.entries[2] = { pool: 10, mountain: 0, whists: 0 }

  // seat 0 и seat 1 по 18 очков; у seat 1 гора меньше — он выше.
  assert.deepEqual(finalStandings(table), [
    { seat: 1, place: 1, score: 18 },
    { seat: 0, place: 2, score: 18 },
    { seat: 2, place: 3, score: 10 },
  ])
})