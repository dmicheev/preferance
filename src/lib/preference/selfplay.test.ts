// Интеграционный тест умного бота: живые раздачи доигрываются без нарушений,
// и бенчмарк «MASTER против PLAYER» на одних и тех же раздачах.
import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_RULESET } from "./rules"
import { benchmarkDeal, playSession } from "./selfplay"
import type { SmartBudgets, SmartContext } from "./bot-smart"
import type { Seat } from "./round"

const BUDGETS: Partial<Record<"MASTER" | "PLAYER" | "NOVICE", Partial<SmartBudgets>>> = {
  MASTER: { samples: 24, samplesBid: 16, depth: 3, timeMs: 700 },
  PLAYER: { samples: 10, samplesBid: 10, depth: 2, timeMs: 300 },
  NOVICE: { samples: 8, samplesBid: 8, depth: 2, timeMs: 200 },
}

const ctx: SmartContext = { rules: DEFAULT_RULESET, raspasStep: 1, budgets: BUDGETS }

test("самопартия: партия новичков доигрывается до закрытия пули", async () => {
  const standings = await playSession({
    seedBase: 7,
    dealer: 0 as Seat,
    bullet: 2,
    levels: ["NOVICE", "NOVICE", "NOVICE"],
    ctx,
    maxRounds: 12,
  })
  assert.equal(standings.length, 3)
  for (const standing of standings) {
    assert.ok(Number.isFinite(standing.score))
  }
})

test("самопартия: мастер, игрок и новичок доигрывают партию до пули", async () => {
  const standings = await playSession({
    seedBase: 23,
    dealer: 1 as Seat,
    bullet: 4,
    levels: ["MASTER", "PLAYER", "NOVICE"],
    ctx,
    maxRounds: 16,
  })
  assert.equal(standings.length, 3)
})

test(
  "бенчмарк: MASTER обыгрывает двух PLAYER на одинаковых раздачах",
  { timeout: 300_000 },
  async () => {
    const deals = 8
    let master = 0
    let playerOne = 0
    let playerTwo = 0
    for (let index = 0; index < deals; index += 1) {
      const deltas = await benchmarkDeal({
        seed: 1000 + index * 17,
        dealer: (index % 3) as Seat,
        levels: ["MASTER", "PLAYER", "PLAYER"],
        ctx,
      })
      master += deltas[0]
      playerOne += deltas[1]
      playerTwo += deltas[2]
    }
    assert.ok(
      master > playerOne && master > playerTwo,
      `мастер (${master}) должен обыграть игроков (${playerOne}, ${playerTwo})`,
    )
  },
)
