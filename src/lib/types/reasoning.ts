export type SignalSource = 'entity_context' | 'heuristic' | 'ai' | 'unknown'

export interface Signal<T = unknown> {
  source: SignalSource
  role: string | null
  glAccountCode: string | null
  confidence: number
  reasoning: string
  metadata?: T
}

export interface EntityContextSignal extends Signal<{ entityContextId: string }> {}
export interface HeuristicSignal extends Signal<{ matchedKeyword: string }> {}
export interface AISignal extends Signal<{ rawResponse?: string }> {}

export interface DecisionResult {
  selected: Signal | null
  allSignals: Signal[]
  confidence: number
  confidenceLabel: 'high' | 'medium' | 'low'
  explanation: string
  uncertaintyReasons: string[]
  source: SignalSource
}

export function toConfidenceLabel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}
