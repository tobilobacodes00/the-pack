import { color } from '@/lib/theme'

export type ChatMessage = {
  id?: string
  role: 'user' | 'alpha'
  text: string
  isThinking?: boolean
}

interface Props {
  message: ChatMessage
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: '#555', animationDelay: `${i * 200}ms` }}
        />
      ))}
    </div>
  )
}

export function MessageBubble({ message }: Props) {
  const isAlpha = message.role === 'alpha'

  if (isAlpha) {
    // Alpha replies read as plain prose — no bubble, no caption.
    return message.isThinking ? (
      <ThinkingDots />
    ) : (
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: '#c8c8c8' }}
      >
        {message.text}
      </p>
    )
  }

  // User turns sit in a bordered bubble.
  return (
    <div
      className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
      style={{ backgroundColor: color.surface, border: '1px solid #262626', color: '#f0f0f0' }}
    >
      {message.text}
    </div>
  )
}
