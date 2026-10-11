import { placeholderIllustration } from './illustration/placeholder'
import type { IllustrationService } from './illustration/types'
import { placeholderText } from './text/placeholder'
import type { TextService } from './text/types'

/**
 * The one place the app obtains its AI services. Screens import `services`
 * and never a concrete implementation, so connecting the backend (DeepSeek
 * for text, ComfyUI for illustration) is a change to this file alone.
 */
export interface Services {
  /** placeholder: built-in stand-ins. live: real models behind the backend. */
  mode: 'placeholder' | 'live'
  text: TextService
  illustration: IllustrationService
}

export const services: Services = {
  mode: 'placeholder',
  text: placeholderText,
  illustration: placeholderIllustration,
}
