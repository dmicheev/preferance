"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { settingsSummary } from "@/lib/format"
import { rulesetSummary } from "@/lib/preference/score"
import { NICKNAME_MAX_LENGTH, type GameSettingsView } from "@/lib/protocol"
import { isReservedNickname, normalizeNickname } from "@/lib/validation"

type JoinVeilProps = {
  gameKey: string
  settings: GameSettingsView
  seatsTaken: number
}

export function JoinVeil({ gameKey, settings, seatsTaken }: JoinVeilProps) {
  const router = useRouter()
  const [nickname, setNickname] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = normalizeNickname(nickname).trim()
    if (value.length < 2) {
      setError("Ник — минимум 2 символа")
      return
    }
    if (isReservedNickname(value)) {
      setError("Ник «Компьютер…» занят за ботами")
      return
    }

    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`/api/games/${gameKey}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: value }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        setError(data?.error ?? "Не получилось сесть за стол")
        return
      }

      window.localStorage.setItem("pf:nickname", value)
      router.refresh()
    } catch {
      setError("Сеть подвела — попробуй ещё раз")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="veil">
      <div className="veil__card panel">
        <h2 className="panel__title">Сесть за стол {gameKey}</h2>
        <p className="panel__hint">
          {settingsSummary(settings)} · за столом {seatsTaken} из{" "}
          {settings.maxPlayers}
        </p>

        <ul className="hint-list">
          <li>{rulesetSummary(settings.rules)}</li>
          <li>ключ стола — это и есть вход, паролей нет</li>
          <li>ник — твоя личность: по нему же копится статистика</li>
          <li>трое за столом, четвёртым сдаёт по кругу</li>
        </ul>

        {error ? <p className="form-error">{error}</p> : null}

        <form onSubmit={submit}>
          <label className="field">
            <span className="field__label">Как тебя звать</span>
            <input
              className="input"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={NICKNAME_MAX_LENGTH}
              placeholder="Богдан"
              autoFocus
              required
            />
          </label>

          <button className="button" type="submit" disabled={busy}>
            {busy ? "Садимся…" : "Сесть за стол"}
          </button>
        </form>
      </div>
    </div>
  )
}