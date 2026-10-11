import { api } from '../api'
import type { IllustrationResult, IllustrationService } from './types'

/** The illustration service backed by ComfyUI, through the Nebiru server. */
export const remoteIllustration: IllustrationService = {
  generate: (request) => api.post<IllustrationResult>('/illustrations', request),
}
