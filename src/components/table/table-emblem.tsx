export function TableEmblem({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.9"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="54" />
      <circle cx="60" cy="60" r="45" />
      <path d="M60 12 108 60 60 108 12 60Z" />
      <path d="M60 33 87 60 60 87 33 60Z" />
      <circle cx="60" cy="60" r="9" />
      <path d="M60 45v30M45 60h30" opacity="0.5" />
    </svg>
  )
}