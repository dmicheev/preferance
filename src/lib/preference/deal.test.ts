import assert from "node:assert/strict"
import { test } from "node:test"

import { dealCards, mulberry32, shuffle } from "./deal"

test("одинаковое зерно — одинаковая раздача", () => {
  assert.deepEqual(dealCards(1234), dealCards(1234))
  assert.notDeepEqual(dealCards(1234), dealCards(1235))
})

test("раздача: по 10 карт и 2 в прикуп, все 32 карты на месте", () => {
  const deal = dealCards(7)
  assert.deepEqual(
    deal.hands.map((hand) => hand.length),
    [10, 10, 10],
  )
  assert.equal(deal.prikup.length, 2)

  const all = [...deal.hands.flat(), ...deal.prikup]
  assert.equal(all.length, 32)
  assert.equal(new Set(all).size, 32)
})

test("перемешивание не трогает исходный массив", () => {
  const source = [1, 2, 3, 4, 5]
  const shuffled = shuffle(source, mulberry32(9))
  assert.deepEqual(source, [1, 2, 3, 4, 5])
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4, 5])
})