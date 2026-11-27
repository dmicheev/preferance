"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useSyncExternalStore, type FormEvent } from "react"

import { Candle } from "@/components/candle"
import { readNickname, rememberNickname } from "@/lib/nickname-store"
import { DEFAULT_RULESET, type Ruleset } from "@/lib/preference/rules"
import { NICKNAME_MAX_LENGTH } from "@/lib/protocol"
import {
  BULLET_OPTIONS,
  GAME_KEY_LENGTH,
  ROUNDS_OPTIONS,
  isReservedNickname,
  normalizeGameKey,
  normalizeNickname,
} from "@/lib/validation"

import { RulesDialog, RulesTrigger } from "./rules-dialog"

const ROUNDS_LABEL: Record<string, string> = {
  "10": "10",
  "20": "20",
  "30": "30",
  null: "∞",
}

const subscribeNothing = () => () => {}

export function Hall() {
  const router = useRouter()

  // Ник из прошлого визита читаем без эффектов: сервер отдаёт пустую строку,
  // клиент подхватывает сохранённое значение (печенье) после гидратации.
  const storedNickname = useSyncExternalStore(
    subscribeNothing,
    readNickname,
    () => "",
  )
  const [nicknameEdit, setNicknameEdit] = useState<string | null>(null)
  const [joinNicknameEdit, setJoinNicknameEdit] = useState<string | null>(null)
  const nickname = nicknameEdit ?? storedNickname
  const joinNickname = joinNicknameEdit ?? storedNickname

  const [bullet, setBullet] = useState<number>(20)
  const [rounds, setRounds] = useState<number | null>(20)
  const [spectators, setSpectators] = useState(false)
  const [rules, setRules] = useState<Ruleset>(DEFAULT_RULESET)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [joinKey, setJoinKey] = useState("")
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const remember = (value: string) => {
    rememberNickname(value)
  }

  const createTable = async (event: FormEvent<HTMLFormElement>) => {
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
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: value,
          variant: "LENINGRADKA",
          bullet,
          roundsLimit: rounds,
          allowSpectators: spectators,
          rules,
        }),
      })

      const data = (await response.json().catch(() => null)) as {
        key?: string
        error?: string
      } | null

      if (!response.ok || !data?.key) {
        setError(data?.error ?? "Стол не открылся, попробуй ещё раз")
        return
      }

      remember(value)
      router.push(`/g/${data.key}`)
    } catch {
      setError("Сеть подвела — попробуй ещё раз")
    } finally {
      setBusy(false)
    }
  }

  const joinTable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const key = normalizeGameKey(joinKey)
    const value = normalizeNickname(joinNickname).trim()

    if (key.length !== GAME_KEY_LENGTH) {
      setJoinError("Ключ стола — 6 символов")
      return
    }
    if (value.length < 2) {
      setJoinError("Ник — минимум 2 символа")
      return
    }
    if (isReservedNickname(value)) {
      setJoinError("Ник «Компьютер…» занят за ботами")
      return
    }

    setJoinBusy(true)
    setJoinError(null)

    try {
      const response = await fetch(`/api/games/${key}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: value }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        setJoinError(data?.error ?? "Не получилось подключиться")
        return
      }

      remember(value)
      router.push(`/g/${key}`)
    } catch {
      setJoinError("Сеть подвела — попробуй ещё раз")
    } finally {
      setJoinBusy(false)
    }
  }

  return (
    <main className="hall">
      <header className="hall__head">
        <p className="hall__eyebrow">вечерний преферанс</p>
        <h1 className="hall__title">Преферанс клуб</h1>
        <p className="hall__lead">
          Трое за зелёным сукном, свечи по краям и сдающий по кругу. Накрой
          стол и брось друзьям ссылку с ключом.
        </p>
        <div className="hall__candles" aria-hidden="true">
          <Candle size="sm" delay={0.6} />
          <Candle size="lg" delay={1.3} />
          <Candle delay={2.4} />
          <Candle size="lg" delay={0.9} />
          <Candle size="sm" delay={2.1} />
        </div>
      </header>

      <div className="hall__grid">
        <section className="panel">
          <h2 className="panel__title">Накрыть стол</h2>
          <p className="panel__hint">
            Ленинградка · трое за столом, четвёртым сдаёт по кругу
          </p>

          {error ? <p className="form-error">{error}</p> : null}

          <form onSubmit={createTable}>
            <label className="field">
              <span className="field__label">Как тебя звать</span>
              <input
                className="input"
                value={nickname}
                onChange={(event) => setNicknameEdit(event.target.value)}
                maxLength={NICKNAME_MAX_LENGTH}
                placeholder="Богдан"
                required
              />
            </label>

            <div className="field">
              <span className="field__label">Пуля</span>
              <div className="segmented" role="group" aria-label="Размер пули">
                {BULLET_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="segmented__option"
                    data-active={bullet === option}
                    onClick={() => setBullet(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field__label">Лимит раздач</span>
              <div className="segmented" role="group" aria-label="Лимит раздач">
                {ROUNDS_OPTIONS.map((option) => (
                  <button
                    key={String(option)}
                    type="button"
                    className="segmented__option"
                    data-active={rounds === option}
                    onClick={() => setRounds(option)}
                  >
                    {ROUNDS_LABEL[String(option)]}
                  </button>
                ))}
              </div>
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={spectators}
                onChange={(event) => setSpectators(event.target.checked)}
              />
              <span className="switch__box" />
              <span className="switch__text">
                <b>Пускать зрителей</b>
                <span>пригодятся, чтобы подглядывать за друзьями</span>
              </span>
            </label>

            <RulesTrigger rules={rules} onOpen={() => setRulesOpen(true)} />

            <button className="button" type="submit" disabled={busy}>
              {busy ? "Накрываем…" : "Накрыть стол и получить ключ"}
            </button>
          </form>

          {/* Диалог вне формы: Enter в полях очков не должен накрывать стол */}
          <RulesDialog
            open={rulesOpen}
            rules={rules}
            onOpenChange={setRulesOpen}
            onApply={setRules}
          />
        </section>

        <section className="panel">
          <h2 className="panel__title">Войти по ключу</h2>
          <p className="panel__hint">
            Друг прислал ссылку или продиктовал шесть символов
          </p>

          {joinError ? <p className="form-error">{joinError}</p> : null}

          <form onSubmit={joinTable}>
            <label className="field">
              <span className="field__label">Ключ стола</span>
              <input
                className="input input--key"
                value={joinKey}
                onChange={(event) =>
                  setJoinKey(normalizeGameKey(event.target.value))
                }
                maxLength={GAME_KEY_LENGTH}
                placeholder="K7M2QX"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span className="field__label">Как тебя звать</span>
              <input
                className="input"
                value={joinNickname}
                onChange={(event) => setJoinNicknameEdit(event.target.value)}
                maxLength={NICKNAME_MAX_LENGTH}
                placeholder="Марина"
              />
            </label>

            <button className="button button--ghost" type="submit" disabled={joinBusy}>
              {joinBusy ? "Заходим…" : "Сесть за стол"}
            </button>
          </form>
        </section>

        <section className="panel panel--wide">
          <h2 className="panel__title">История партий</h2>
          <p className="panel__hint">
            каждая закрытая партия под спудом: торговля, снос, все взятки и расчёт
            любой раздачи
          </p>
          <Link className="button button--ghost" href="/history">
            Открыть историю
          </Link>
        </section>
      </div>

      <footer className="hall__foot">
        <span>Ленинградка</span>
        <span>3 за столом + сдающий</span>
        <span>текстовый чат</span>
        <span>голос — следом</span>
      </footer>
    </main>
  )
}