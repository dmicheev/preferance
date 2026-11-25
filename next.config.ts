import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Играют по внешнему адресу (не только с localhost): иначе dev-сервер
  // блокирует свои ресурсы (/_next/hmr и др.), гидрация не стартует и
  // кнопки на странице «мертвы» — клики уходят нативными GET-сабмитами.
  allowedDevOrigins: ["85.172.105.4"],
  // Стол открыт в интернет: базовые заголовки, чтобы страницу не встраивали
  // в чужой сайт и не нюхали типы ответов. CSP не ставим осознанно —
  // Next с инлайн-скриптами требует nonce-инфраструктуру, пользы сейчас мало.
  async headers() {
    return [
      {
        source: "/:path*{/}?",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
