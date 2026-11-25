// Самопартия ботов: драйвер для бенчмарков уровней и интеграционных тестов.
// Крутит движок поверх chooseActionSmart: все три места играют ботами.

import { PLAYER_COUNT } from "./constants"
import type { BotLevel } from "./bot"
import { chooseActionSmart, type SmartContext } from "./bot-smart"
import {
  applyAction,
  createRound,
  nextSeat,
  roundOutcome,
  soloWhistController,
  soloWhistPartner,
  type RoundOutcome,
  type RoundState,
  type Seat,
} from "./round"
import {
  applyRoundScore,
  createScoreTable,
  finalStandings,
  isBulletClosed,
  type ScoreTable,
  type Standing,
} from "./score"

/** Дельты одной раздачи по местам: пуля − гора + висты. */
export type DealDeltas = number[]

async function playDeal(
  seed: number,
  dealer: Seat,
  levels: [BotLevel, BotLevel, BotLevel],
  ctx: SmartContext,
): Promise<{ round: RoundState; outcome: RoundOutcome | null }> {
  let round: RoundState = createRound({ seed, dealer })
  let guard = 0
  while (round.phase !== "scored" && guard < 400) {
    guard += 1
    // Ок на прикуп и Ок на взятку в самопартии жмут мгновенно за всех.
    if (round.phase === "declaring" && round.prikupAck.length < PLAYER_COUNT) {
      const pending = ([0, 1, 2] as Seat[]).find((seat) => !round.prikupAck.includes(seat))
      const result = applyAction(round, { type: "prikup-ack", seat: pending! })
      if (!result.ok) throw new Error(`прикуп-Ок не применился: ${result.error}`)
      round = result.state
      continue
    }
    if (round.phase === "play" && round.turn === null) {
      const pending = ([0, 1, 2] as Seat[]).find((seat) => !round.trickAck.includes(seat))
      const result = applyAction(round, { type: "trick-ack", seat: pending! })
      if (!result.ok) throw new Error(`взятка-Ок не применилась: ${result.error}`)
      round = result.state
      continue
    }
    const turn = round.turn
    if (turn === null) throw new Error("ход без места — движение остановилось")

    // Одиночный вист: на ходе пасующий, но решает вистующий — карта берётся
    // из руки пасующего, а действие подаётся от имени вистующего.
    const controller = soloWhistController(round)
    const acting =
      controller !== null && turn === soloWhistPartner(round, controller)
        ? controller
        : turn
    const action = await chooseActionSmart(round, turn, levels[acting], ctx)
    const submitted =
      action.type === "play" && acting !== turn ? { ...action, seat: acting } : action
    const result = applyAction(round, submitted)
    if (!result.ok) {
      throw new Error(
        `бот ${turn} (${levels[turn]}) сыграл незаконно: ${result.error} ← ${JSON.stringify(action)}`,
      )
    }
    round = result.state
  }
  if (round.phase !== "scored") throw new Error("раздача не доигралась: превышен предохранитель")
  return { round, outcome: roundOutcome(round) }
}

/**
 * Одна раздача ботов. Возвращает очковые дельты по местам — база для
 * бенчмарка «кто кого»: MASTER против PLAYER на одних и тех же раздачах.
 */
export async function benchmarkDeal(params: {
  seed: number
  dealer: Seat
  levels: [BotLevel, BotLevel, BotLevel]
  ctx: SmartContext
}): Promise<DealDeltas> {
  const { outcome } = await playDeal(params.seed, params.dealer, params.levels, params.ctx)
  if (!outcome) throw new Error("раздача без результата")
  const { deltas } = applyRoundScore(createScoreTable(1000, params.ctx.rules), outcome)
  return deltas.map((delta) => delta.pool - delta.mountain + delta.whists)
}

/** Полная партия до закрытия пули: возвращает итоговые места. */
export async function playSession(params: {
  seedBase: number
  dealer: Seat
  bullet: number
  levels: [BotLevel, BotLevel, BotLevel]
  ctx: SmartContext
  maxRounds?: number
}): Promise<Standing[]> {
  let table: ScoreTable = createScoreTable(params.bullet, params.ctx.rules)
  let dealer = params.dealer
  let seed = params.seedBase
  let rounds = 0

  while (!isBulletClosed(table) && rounds < (params.maxRounds ?? 40)) {
    const { outcome } = await playDeal(seed, dealer, params.levels, params.ctx)
    if (!outcome) break
    table = applyRoundScore(table, outcome).table
    dealer = nextSeat(dealer)
    seed += 1
    rounds += 1
  }
  return finalStandings(table)
}
