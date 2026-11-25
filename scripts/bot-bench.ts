// Разовый прогон бенчмарка уровней: MASTER против двух PLAYER на живых раздачах.
import { DEFAULT_RULESET } from "../src/lib/preference/rules"
import { benchmarkDeal } from "../src/lib/preference/selfplay"
import type { SmartBudgets, SmartContext } from "../src/lib/preference/bot-smart"
import type { Seat } from "../src/lib/preference/round"

const BUDGETS: Partial<Record<"MASTER" | "PLAYER", Partial<SmartBudgets>>> = {
  MASTER: { samples: 24, samplesBid: 16, depth: 3, timeMs: 700 },
  PLAYER: { samples: 10, samplesBid: 10, depth: 2, timeMs: 300 },
}

const ctx: SmartContext = { rules: DEFAULT_RULESET, raspasStep: 1, budgets: BUDGETS }

async function main(): Promise<void> {
  const deals = 8
  const totals = [0, 0, 0]
  for (let index = 0; index < deals; index += 1) {
    const deltas = await benchmarkDeal({
      seed: 1000 + index * 17,
      dealer: (index % 3) as Seat,
      levels: ["MASTER", "PLAYER", "PLAYER"],
      ctx,
    })
    deltas.forEach((delta, seat) => {
      totals[seat] += delta
    })
    console.log(
      `раздача ${index + 1}: мастер ${deltas[0] >= 0 ? "+" : ""}${deltas[0]}, игроки ${deltas[1]} / ${deltas[2]}`,
    )
  }
  console.log(`\nИтог за ${deals} раздач: мастер ${totals[0]}, игроки ${totals[1]} и ${totals[2]}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
