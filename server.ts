// Кастомный сервер: Next.js и Socket.IO живут на одном порту,
// поэтому друзьям достаточно одного адреса для игры и чата.
// Если рядом лежат certs/cert.pem и certs/key.pem (или заданы HTTPS_CERT /
// HTTPS_KEY) — сервер поднимается по HTTPS: голосу за столом нужен secure context.
import "dotenv/config"

import { existsSync, readFileSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import type { SecureContextOptions } from "node:tls"

import next from "next"

import { attachSocketServer } from "./src/server/socket"

const port = Number.parseInt(process.env.PORT ?? "3000", 10)
const hostname = "0.0.0.0"
const dev = process.env.NODE_ENV !== "production"

/** Самоподписанный сертификат рядом с проектом: есть — слушаем https. */
const tlsFiles = {
  cert: process.env.HTTPS_CERT ?? "certs/cert.pem",
  key: process.env.HTTPS_KEY ?? "certs/key.pem",
}
const tls: SecureContextOptions | null =
  existsSync(tlsFiles.cert) && existsSync(tlsFiles.key)
    ? {
        cert: readFileSync(tlsFiles.cert),
        key: readFileSync(tlsFiles.key),
      }
    : null

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

async function main() {
  await app.prepare()

  // TLS-опции понимает только https.createServer: http молча их игнорирует.
  const server = tls
    ? createHttpsServer(tls, (request, response) => {
        void handle(request, response)
      })
    : createHttpServer((request, response) => {
        void handle(request, response)
      })

  const io = attachSocketServer(server)

  server.listen(port, hostname, () => {
    const scheme = tls ? "https" : "http"
    console.log(
      `\n  Преферанс клуб\n  → ${scheme}://localhost:${port} (${dev ? "dev" : "production"})${
        tls ? "\n  Сертификат самоподписанный — браузер попросит подтвердить." : ""
      }\n`,
    )
  })

  const shutdown = async (signal: string) => {
    console.log(`\n${signal}: закрываю стол…`)
    io.close()
    server.close()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  // Последняя линия обороны: ошибка одного хода не должна гасить все столы.
  // Основные риски уже закрыты try/catch вокруг переходов и обработчиков сокетов.
  process.on("unhandledRejection", (reason) => {
    console.error("[server] необработанный reject:", reason)
  })
  process.on("uncaughtException", (error) => {
    console.error("[server] непойманное исключение:", error)
  })
}

main().catch((error) => {
  console.error("Сервер не поднялся:", error)
  process.exit(1)
})