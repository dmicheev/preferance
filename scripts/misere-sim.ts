// Черновая симуляция: сколько мизеров происходит на N раздач и как они доигрываются.
import { applyAction, createRound, roundOutcome, type RoundState, type Seat } from "../src/lib/preference/round"
import { chooseAction, type BotLevel } from "../src/lib/preference/bot"

function playRound(seed: number, dealer: Seat, level: BotLevel): RoundState {
  let state = createRound({ seed, dealer })
  let guard = 0
  while (state.phase !== "scored" && guard < 2000) {
    guard += 1
    if (state.phase === "bidding") {
      // В торговле действует только тот, чей ход — как в реальном планировщике.
      const actor = state.turn
      if (actor === null) throw new Error(`seed ${seed}: торговля без хода`)
      const result = applyAction(state, chooseAction(state, actor, level))
      if (!result.ok) throw new Error(`seed ${seed}: ${result.error}`)
      state = result.state
      continue
    }
    // Прикуп и взятки смотрят все трое: тикаем все места, нелегальное молчим.
    let progressed = false
    for (const seat of [0, 1, 2] as Seat[]) {
      const action = chooseAction(state, seat, level)
      const result = applyAction(state, action)
      if (result.ok) {
        state = result.state
        progressed = true
      }
    }
    if (!progressed) {
      throw new Error(`seed ${seed}: застряли на ${state.phase}`)
    }
  }
  return state
}

for (const level of ["PLAYER", "MASTER"] as BotLevel[]) {
  const rounds = 3000
  const counts = { game: 0, misere: 0, raspas: 0 }
  const misereTricks: number[] = []
  let walked = 0
  const levels: Record<number, number> = {}
  for (let seed = 1; seed <= rounds; seed += 1) {
    const state = playRound(seed, ((seed - 1) % 3) as Seat, level)
    const outcome = roundOutcome(state)
    if (!outcome) continue
    counts[outcome.contract.kind] += 1
    if (outcome.contract.kind === "game") {
      levels[outcome.contract.level] = (levels[outcome.contract.level] ?? 0) + 1
    }
    if (outcome.contract.kind === "misere" && outcome.declarer !== null) {
      const taken = outcome.tricks[outcome.declarer]
      misereTricks.push(taken)
      if (taken === 0) walked += 1
    }
  }
  const avg = misereTricks.length
    ? (misereTricks.reduce((a, b) => a + b, 0) / misereTricks.length).toFixed(2)
    : "—"
  const histogram = [6, 7, 8, 9, 10]
    .map((n) => `${n}: ${levels[n] ?? 0}`)
    .join(" ")
  console.log(
    `${level}: игр ${counts.game} (${histogram}), мизеров ${counts.misere}, распасов ${counts.raspas}` +
      (counts.misere
        ? ` · мизер без взяток ${walked}/${counts.misere}, среднее взяток играющего ${avg}`
        : ""),
  )
}
