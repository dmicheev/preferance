import assert from "node:assert/strict"
import { test } from "node:test"

import {
  FULL_DECK,
  SUITS,
  TRUMPS,
  beats,
  cardStrength,
  formatCard,
  isCard,
  rankOf,
  suitOf,
} from "./cards"
import { TRUMP_ORDER } from "./cards"

test("колода: 32 уникальные карты", () => {
  assert.equal(FULL_DECK.length, 32)
  assert.equal(new Set(FULL_DECK).size, 32)
  for (const suit of SUITS) {
    assert.equal(FULL_DECK.filter((card) => suitOf(card) === suit).length, 8)
  }
})

test("разбор карты: масть и ранг", () => {
  assert.equal(suitOf("SA"), "S")
  assert.equal(rankOf("SA"), "A")
  assert.equal(suitOf("D10"), "D")
  assert.equal(rankOf("D10"), "10")
  assert.equal(formatCard("HQ"), "дама червей")
})

test("isCard отсекает мусор", () => {
  assert.equal(isCard("SA"), true)
  assert.equal(isCard("S1"), false)
  assert.equal(isCard("XS7"), false)
  assert.equal(isCard(42), false)
})

test("масти по старшинству: пики → трефы → бубны → черви → без козыря", () => {
  const order = TRUMPS.map((trump) => TRUMP_ORDER[trump])
  assert.deepEqual(order, [0, 1, 2, 3, 4])
  assert.deepEqual([...TRUMPS], ["S", "C", "D", "H", "NT"])
})

test("козырь старше масти хода, масть хода старше сброса", () => {
  assert.equal(cardStrength("S7", "D", "S") > cardStrength("DA", "D", "S"), true)
  assert.equal(cardStrength("D7", "D", "S") > cardStrength("HA", "D", "S"), true)
  assert.equal(beats("S7", "DA", "D", "S"), true)
  assert.equal(beats("HA", "DA", "D", "NT"), false)
  assert.equal(beats("DA", "D10", "D", "NT"), true)
})