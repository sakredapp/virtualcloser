'use client'
/**
 * The assistant's name for client components (owner 2026-10-17: a company can
 * rename it, a person can pick their own). The dashboard layout resolves it on
 * the server (lib/assistantNameServer assistantNameFor) and passes it in here;
 * a save calls setAssistantName for an instant change and router.refresh() so
 * server-rendered text follows. Outside the provider the default is used.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ASSISTANT_NAME } from '@/lib/assistantName'

type Ctx = { name: string; setName: (name: string) => void }

const AssistantNameContext = createContext<Ctx>({ name: ASSISTANT_NAME, setName: () => {} })

export function AssistantNameProvider({ name, children }: { name: string; children: React.ReactNode }) {
  const [current, setCurrent] = useState(name || ASSISTANT_NAME)
  // A server refresh brings the saved value back down.
  useEffect(() => { setCurrent(name || ASSISTANT_NAME) }, [name])
  const value = useMemo(() => ({ name: current, setName: (n: string) => setCurrent(n || ASSISTANT_NAME) }), [current])
  return <AssistantNameContext.Provider value={value}>{children}</AssistantNameContext.Provider>
}

/** The name this viewer sees. */
export function useAssistantName(): string {
  return useContext(AssistantNameContext).name
}

/** Show a newly saved name right away (before the server refresh lands). */
export function useSetAssistantName(): (name: string) => void {
  return useContext(AssistantNameContext).setName
}
