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
          style={{ backgroundColor: '#9a9a9a', animationDelay: `${i * 200}ms` }}
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
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-700">
        {message.text}
      </p>
    )
  }

  // User turns sit in a warm chunky bubble — reads on cream in both intake and territory.
  return (
    <div className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-cream-100 border-[1.5px] border-ink-900 text-ink-900">
      {message.text}
    </div>
  )
}
