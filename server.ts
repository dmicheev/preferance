// Кастомный сервер: Next.js и Socket.IO живут на одном порту,
// поэтому друзьям достаточно одного адреса для игры и чата.
import "dotenv/config"

import { createServer } from "node:http"

import next from "next"

import { attachSocketServer } from "./src/server/socket"

const port = Number.parseInt(process.env.PORT ?? "3000", 10)
const hostname = "0.0.0.0"
const dev = process.env.NODE_ENV !== "production"

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

async function main() {
  await app.prepare()

  const server = createServer((request, response) => {
    void handle(request, response)
  })

  const io = attachSocketServer(server)

  server.listen(port, hostname, () => {
    console.log(
      `\n  Преферанс клуб\n  → http://localhost:${port} (${dev ? "dev" : "production"})\n`,
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
}

main().catch((error) => {
  console.error("Сервер не поднялся:", error)
  process.exit(1)
})