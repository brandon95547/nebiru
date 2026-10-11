import { createContext, useContext } from 'react'

/** Lets content inside a page flow ask for its page count to be measured again. */
export const RemeasureContext = createContext<() => void>(() => {})

export function useRemeasure(): () => void {
  return useContext(RemeasureContext)
}

/** The scrolling element that holds the book, used to tell which chapters are near the viewport. */
export const ScrollRootContext = createContext<HTMLElement | null>(null)
