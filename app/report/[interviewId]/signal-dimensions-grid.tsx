'use client'

import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type SignalLevel = 'strong' | 'medium' | 'weak' | 'negative'

interface SignalDimensionsGridProps {
  problemEvidence: SignalLevel | undefined
  urgency: SignalLevel | undefined
  workaroundEvidence: SignalLevel | undefined
  budgetOrCommitment: SignalLevel | undefined
}

// ── Meta ─────────────────────────────────────────────────────────────────────

const LEVEL_META: Record<
  SignalLevel,
  { label: string; bar: string; text: string; bg: string; border: string; width: string }
> = {
  strong: {
    label: 'Güçlü',
    bar: 'bg-emerald-500',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    width: 'w-full',
  },
  medium: {
    label: 'Orta',
    bar: 'bg-amber-400',
    text: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
    width: 'w-2/3',
  },
  weak: {
    label: 'Zayıf',
    bar: 'bg-orange-500',
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    width: 'w-1/3',
  },
  negative: {
    label: 'Negatif',
    bar: 'bg-destructive',
    text: 'text-destructive',
    bg: 'bg-destructive/10',
    border: 'border-destructive/30',
    width: 'w-1/4',
  },
}

const DIMENSIONS: Array<{ key: keyof SignalDimensionsGridProps; label: string }> = [
  { key: 'problemEvidence',    label: 'Problem Kanıtı'    },
  { key: 'urgency',            label: 'Aciliyet'          },
  { key: 'workaroundEvidence', label: 'Geçici Çözüm'      },
  { key: 'budgetOrCommitment', label: 'Bütçe / Bağlılık'  },
]

// ── Component ────────────────────────────────────────────────────────────────

export function SignalDimensionsGrid({
  problemEvidence,
  urgency,
  workaroundEvidence,
  budgetOrCommitment,
}: SignalDimensionsGridProps) {
  const values: Record<keyof SignalDimensionsGridProps, SignalLevel | undefined> = {
    problemEvidence,
    urgency,
    workaroundEvidence,
    budgetOrCommitment,
  }

  return (
    <div className="bg-card rounded-xl border p-4">
      <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">
        Sinyal Boyutları
      </p>
      <div className="space-y-3">
        {DIMENSIONS.map(({ key, label }) => {
          const level = values[key]
          const meta = level ? LEVEL_META[level] : null

          return (
            <div key={key} className="flex items-center gap-3">
              {/* Dimension label */}
              <span className="text-muted-foreground w-36 shrink-0 text-xs">
                {label}
              </span>

              {/* Bar track */}
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                {meta && (
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full transition-all',
                      meta.bar,
                      meta.width
                    )}
                  />
                )}
              </div>

              {/* Level badge */}
              <span
                className={cn(
                  'w-14 rounded-md border px-2 py-0.5 text-center text-xs font-medium',
                  meta ? cn(meta.bg, meta.text, meta.border) : 'text-muted-foreground'
                )}
              >
                {meta ? meta.label : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
