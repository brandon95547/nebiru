import { create } from 'zustand'
import { api } from './api'
import { placeholderIllustration } from './illustration/placeholder'
import { remoteIllustration } from './illustration/remote'
import type { IllustrationService } from './illustration/types'
import { placeholderText } from './text/placeholder'
import { remoteText } from './text/remote'
import type { TextService } from './text/types'

/**
 * The one place the app obtains its AI services. Screens call `services.text`
 * and `services.illustration` and never a concrete implementation.
 *
 * Each service is live when the Nebiru server reports it ready (DeepSeek for
 * text, ComfyUI for illustration) and a built-in stand-in otherwise, so the
 * two switch independently.
 */
export interface Services {
  text: TextService
  illustration: IllustrationService
}

export const services: Services = {
  text: placeholderText,
  illustration: placeholderIllustration,
}

export interface ServiceState {
  /** True when the real model is behind this service. */
  live: boolean
  /** Why it is not live, or a warning about it when it is. */
  detail: string
}

interface ServiceStatus {
  /** False until the first check has finished or been given up on, so the app can wait for it. */
  settled: boolean
  text: ServiceState
  illustration: ServiceState
}

const SERVER_DOWN = 'The Nebiru server is not running.'
/** How long startup waits for the server before carrying on with stand-ins. */
const STARTUP_WAIT_MS = 1500

export const useServiceStatus = create<ServiceStatus>()(() => ({
  settled: false,
  text: { live: false, detail: SERVER_DOWN },
  illustration: { live: false, detail: SERVER_DOWN },
}))

interface WireStatus {
  text: { available: boolean; detail: string }
  illustration: { available: boolean; detail: string }
}

/** Ask the server which services are ready and switch to them. Safe to call again at any time. */
export async function connectServices(): Promise<void> {
  let status: WireStatus | null = null
  try {
    status = await api.get<WireStatus>('/status')
  } catch {
    // No server: both services stay on their stand-ins.
  }
  const text = { live: status?.text.available ?? false, detail: status?.text.detail ?? SERVER_DOWN }
  const illustration = {
    live: status?.illustration.available ?? false,
    detail: status?.illustration.detail ?? SERVER_DOWN,
  }
  services.text = text.live ? remoteText : placeholderText
  services.illustration = illustration.live ? remoteIllustration : placeholderIllustration
  useServiceStatus.setState({ settled: true, text, illustration })
}

/** Connect at startup, and again whenever the user comes back to the tab. */
export function startServices(): void {
  void connectServices()
  window.setTimeout(() => useServiceStatus.setState({ settled: true }), STARTUP_WAIT_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void connectServices()
  })
}
