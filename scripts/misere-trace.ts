// Разбор одного мизера: рука после сноса и все взятки по картам.
import { applyAction, createRound, type Seat } from "../src/lib/preference/round"
import { chooseAction, type BotLevel } from "../src/lib/preference/bot"

function playRoundFull(seed: number, dealer: Seat, level: BotLevel) {
  let state = createRound({ seed, dealer })
  let declaredMisereHand: string[] | null = null
  let guard = 0
  while (state.phase !== "scored" && guard < 2000) {
    guard += 1
    let progressed = false
    for (const seat of [0, 1, 2] as Seat[]) {
      const action = chooseAction(state, seat, level)
      if (
        action.type === "declare" &&
        action.contract === "misere" &&
        state.declarer === seat
      ) {
        declaredMisereHand = state.hands[seat].filter((c) => !action.discard.includes(c))
      }
      const result = applyAction(state, action)
      if (result.ok) {
        state = result.state
        progressed = true
      }
    }
    if (!progressed) throw new Error(`seed ${seed}: застряли на ${state.phase}`)
  }
  return { state, declaredMisereHand }
}

const seed = Number(process.argv[2] ?? 277)
const level = (process.argv[3] ?? "MASTER") as BotLevel
const { state, declaredMisereHand } = playRoundFull(seed, ((seed - 1) % 3) as Seat, level)

console.log(`мизер: рука играющего после сноса:`)
console.log("  ", declaredMisereHand?.sort().join(" "))
console.log(`взятки (ход → 2-й → 3-й, победитель):`)
for (const trick of state.history) {
  const cards = trick.cards.map((item) => `${item.card}@${item.seat}`).join(" → ")
  console.log(`  ${cards} · взял ${trick.winner}`)
}
console.log(`взятки по местам: ${state.tricks.join("/")}`)
