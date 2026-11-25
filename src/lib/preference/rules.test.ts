import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoundOutcome, Seat } from "./round"
import {
  DEFAULT_RULESET,
  isCustomRuleset,
  normalizeRuleset,
  type Ruleset,
} from "./rules"
import { applyRoundScore, createScoreTable, rulesetSummary } from "./score"

function outcome(partial: RoundOutcome): RoundOutcome {
  return partial
}

test("пресет по умолчанию: игры 2/4/6/8/10, мизер 10, висты 2/1", () => {
  assert.deepEqual(DEFAULT_RULESET.gameValues, { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 })
  assert.equal(DEFAULT_RULESET.misereValue, 10)
  assert.equal(DEFAULT_RULESET.whistRateSix, 2)
  assert.equal(DEFAULT_RULESET.whistRateHigh, 1)
  assert.equal(isCustomRuleset(DEFAULT_RULESET), false)
})

test("normalizeRuleset: ключи из JSON-строк и пропуски", () => {
  const rules = normalizeRuleset({
    gameValues: { "6": 3, 7: 5 },
    misereValue: "12",
  })
  assert.equal(rules.gameValues[6], 3)
  assert.equal(rules.gameValues[7], 5)
  assert.equal(rules.gameValues[8], DEFAULT_RULESET.gameValues[8])
  assert.equal(rules.misereValue, 12)
  assert.equal(isCustomRuleset(rules), true)
})

test("normalizeRuleset: мусор и крайние значения", () => {
  const rules = normalizeRuleset({
    gameValues: { 6: 0, 7: -5, 8: "abc", 9: 999, 10: null },
    shortfallFactor: 50,
    raspasGrowth: -3,
    misereValue: undefined,
  })
  assert.equal(rules.gameValues[6], 1, "минимум 1")
  assert.equal(rules.gameValues[7], 1)
  assert.equal(rules.gameValues[8], DEFAULT_RULESET.gameValues[8])
  assert.equal(rules.gameValues[9], 100, "максимум 100")
  assert.equal(rules.gameValues[10], DEFAULT_RULESET.gameValues[10])
  assert.equal(rules.shortfallFactor, 10, "недобор ограничен 10")
  assert.equal(rules.raspasGrowth, 1, "рост распасов не меньше 1")
  assert.equal(rules.misereValue, DEFAULT_RULESET.misereValue)

  assert.deepEqual(normalizeRuleset(null), normalizeRuleset(DEFAULT_RULESET))
  assert.deepEqual(normalizeRuleset("ерунда"), normalizeRuleset(DEFAULT_RULESET))
  assert.deepEqual(normalizeRuleset([1, 2]), normalizeRuleset(DEFAULT_RULESET))
})

test("свои цифры меняют расчёт пули и вистов", () => {
  const rules: Ruleset = normalizeRuleset({
    gameValues: { 6: 3, 7: 6, 8: 9, 9: 12, 10: 15 },
    whistRateSix: 3,
    whistRateHigh: 2,
    singleWhistRate: 2,
    shortfallFactor: 3,
    misereValue: 20,
    raspasBase: 2,
    raspasGrowth: 2,
  })

  const made = applyRoundScore(
    createScoreTable(30, rules),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      tricks: [1, 8, 1],
      whisters: [0, 2],
    }),
  )
  assert.equal(made.table.entries[1].pool, 3, "шестерная по своей цене")
  assert.equal(made.table.entries[0].whists, 3, "вист по 3 за взятку")
  assert.equal(made.table.entries[2].whists, 3)

  const single = applyRoundScore(
    createScoreTable(30, rules),
    outcome({
      contract: { kind: "game", level: 6, trump: "S" },
      declarer: 1,
      tricks: [2, 6, 2],
      whisters: [0] as Seat[],
    }),
  )
  assert.equal(single.table.entries[0].whists, 8, "один вистующий — за себя и за пасующего: 4 взятки с двух рук по своей ставке")

  const failed = applyRoundScore(
    createScoreTable(30, rules),
    outcome({
      contract: { kind: "game", level: 8, trump: "H" },
      declarer: 0,
      tricks: [6, 2, 2],
      whisters: [],
    }),
  )
  assert.equal(failed.table.entries[0].mountain, 2 * 3 * 9, "недобор по своему множителю")

  const misere = applyRoundScore(
    createScoreTable(30, rules),
    outcome({
      contract: { kind: "misere" },
      declarer: 2,
      tricks: [5, 5, 0],
      whisters: [],
    }),
  )
  assert.equal(misere.table.entries[2].pool, 20)

  const raspas = applyRoundScore(
    createScoreTable(30, rules),
    outcome({
      contract: { kind: "raspas" },
      declarer: null,
      tricks: [4, 3, 3],
      whisters: [],
    }),
  )
  assert.deepEqual(
    raspas.table.entries.map((entry) => entry.mountain),
    [8, 6, 6],
  )
  assert.equal(raspas.table.raspasStep, 4, "2 + рост 2")
})

test("строка правил для интерфейса", () => {
  assert.equal(
    rulesetSummary(DEFAULT_RULESET),
    "игры 2/4/6/8/10 · мизер 10 · висты 2/1",
  )
})