import { randomBytes } from "node:crypto"

// Без визуально неоднозначных символов (0/O, 1/I) — ключ диктуют голосом.
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateGameKey(length = 6): string {
  const bytes = randomBytes(length)
  let key = ""
  for (let index = 0; index < length; index += 1) {
    key += KEY_ALPHABET[bytes[index] % KEY_ALPHABET.length]
  }
  return key
}