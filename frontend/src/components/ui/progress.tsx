import * as React from "react"

type ProgressProps = {
  value?: number
  max?: number
  indeterminate?: boolean
  className?: string
}

export function Progress({ value = 0, max = 100, indeterminate = false, className = "" }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className={`relative h-2 w-full overflow-hidden rounded bg-muted ${className}`}>
      <div
        className={
          indeterminate
            ? "absolute left-0 top-0 h-full w-1/3 animate-[progress-indeterminate_1.2s_infinite] bg-primary"
            : "h-full bg-primary"
        }
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  )
}

