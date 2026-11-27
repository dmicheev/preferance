// Одноразовый сид: доигрывает партию ботами и пишет её в историю через
// те же saveRoundRecord / saveGameOutcome, что и боевой сервер сокетов.
// Запуск: node --import tsx scripts/seed-history.ts

import "dotenv/config"

import { prisma } from "../src/lib/db"
import { createGame, saveGameOutcome, saveRoundRecord, upsertUserByNickname } from "../src/lib/game-service"
import type { RoundResultView } from "../src/lib/protocol"
import { PLAYER_COUNT } from "../src/lib/preference/constants"
import { chooseActionSmart, type SmartContext } from "../src/lib/preference/bot-smart"
import type { BotLevel } from "../src/lib/preference/bot"
import {
  applyAction,
  createRound,
  nextSeat,
  roundOutcome,
  soloWhistController,
  soloWhistPartner,
  type RoundState,
  type Seat,
} from "../src/lib/preference/round"
import { applyRoundScore, createScoreTable, finalStandings, isBulletClosed, type ScoreTable } from "../src/lib/preference/score"

async function playDeal(
  seed: number,
  dealer: Seat,
  levels: [BotLevel, BotLevel, BotLevel],
  ctx: SmartContext,
): Promise<RoundState> {
  let round: RoundState = createRound({ seed, dealer })
  let guard = 0
  while (round.phase !== "scored" && guard < 400) {
    guard += 1
    if (round.phase === "declaring" && round.prikupAck.length < PLAYER_COUNT) {
      const pending = ([0, 1, 2] as Seat[]).find((seat) => !round.prikupAck.includes(seat))
      const result = applyAction(round, { type: "prikup-ack", seat: pending! })
      if (!result.ok) throw new Error(result.error)
      round = result.state
      continue
    }
    if (round.phase === "play" && round.turn === null) {
      const pending = ([0, 1, 2] as Seat[]).find((seat) => !round.trickAck.includes(seat))
      const result = applyAction(round, { type: "trick-ack", seat: pending! })
      if (!result.ok) throw new Error(result.error)
      round = result.state
      continue
    }
    const turn = round.turn
    if (turn === null) throw new Error("ход без места")
    const controller = soloWhistController(round)
    const acting =
      controller !== null && turn === soloWhistPartner(round, controller)
        ? controller
        : turn
    const action = await chooseActionSmart(round, turn, levels[acting], ctx)
    const submitted =
      action.type === "play" && acting !== turn ? { ...action, seat: acting } : action
    const result = applyAction(round, submitted)
    if (!result.ok) throw new Error(result.error)
    round = result.state
  }
  return round
}

async function main() {
  // SEED_KEY=AB12CD — доиграть существующий стол (созданный, например, из браузера),
  // иначе создаём новый со своими ботами.
  const reuseKey = process.env.SEED_KEY
  let key: string
  let userIdBySeat: [string, string, string]

  if (reuseKey) {
    const game = await prisma.game.findUnique({
      where: { key: reuseKey },
      include: { players: { orderBy: { seat: "asc" } } },
    })
    if (!game) throw new Error(`стол ${reuseKey} не нашёлся`)
    if (game.status === "FINISHED") throw new Error("стол уже закрыт")
    // Досаживаем ботов на свободные места, чтобы сесть за столом втроём.
    for (const seat of [0, 1, 2]) {
      if (game.players.some((player) => player.seat === seat)) continue
      const nickname = seat === 0 ? "Архиватор" : seat === 1 ? "Бот Лёва" : "Бот Соня"
      const user = await upsertUserByNickname(nickname)
      await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          userId: user.id,
          seat,
          isHost: seat === 0 && game.players.length === 0,
          isBot: seat !== 0,
          botLevel: "PLAYER",
        },
      })
    }
    const refreshed = await prisma.game.findUniqueOrThrow({
      where: { key: reuseKey },
      include: { players: { orderBy: { seat: "asc" } } },
    })
    key = refreshed.key
    userIdBySeat = [refreshed.players[0].userId, refreshed.players[1].userId, refreshed.players[2].userId]
  } else {
    const host = await upsertUserByNickname("Архиватор")
    const created = await createGame(
      { variant: "LENINGRADKA", bullet: 20, roundsLimit: null, allowSpectators: true },
      host.id,
    )
    key = created.key
    const row = await prisma.game.findUniqueOrThrow({ where: { key }, select: { id: true } })
    const bots: string[] = []
    for (const seat of [1, 2]) {
      const user = await upsertUserByNickname(seat === 1 ? "Бот Лёва" : "Бот Соня")
      await prisma.gamePlayer.create({
        data: { gameId: row.id, userId: user.id, seat, isBot: true, botLevel: "PLAYER" },
      })
      bots.push(user.id)
    }
    userIdBySeat = [host.id, bots[0], bots[1]]
  }

  const ctx: SmartContext = { rules: (await import("../src/lib/preference/rules")).DEFAULT_RULESET, raspasStep: 1 }
  let table: ScoreTable = createScoreTable(20, ctx.rules)
  let dealer: Seat = 0
  let seed = 424242
  let rounds = 0

  while (!isBulletClosed(table) && rounds < 12) {
    const round = await playDeal(seed, dealer, ["PLAYER", "PLAYER", "PLAYER"], ctx)
    const outcome = roundOutcome(round)
    if (!outcome) throw new Error("раздача без итога")
    const scored = applyRoundScore(table, outcome)
    table = scored.table
    rounds += 1

    const result: RoundResultView = {
      roundNumber: rounds,
      dealer: round.dealer,
      outcome,
      bids: [...round.bids],
      prikup: [...round.prikup],
      discard: [...round.discard],
      whist: [...round.whist],
      trickList: round.history.map((entry) => ({
        cards: entry.cards.map((card) => ({ ...card })),
        winner: entry.winner,
      })),
      deltas: scored.deltas,
      table: scored.table,
      finished: isBulletClosed(table),
    }
    await saveRoundRecord(key, result)
    console.log(`раздача ${rounds} записана: ${outcome.contract.kind}`)
    dealer = nextSeat(dealer)
    seed += 1
  }

  const standings = finalStandings(table).map((entry) => ({
    userId: userIdBySeat[entry.seat],
    place: entry.place,
    score: entry.score,
  }))
  await saveGameOutcome(key, standings)
  console.log(`партия ${key} закрыта: ${rounds} раздач`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
