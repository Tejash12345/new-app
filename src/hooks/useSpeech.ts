import { useCallback, useEffect, useState } from 'react'
import { speech, type SpeechState } from '../lib/speak'

/**
 * React binding for the shared TTS controller. Reflects live play/pause state
 * and stops any speech when the using component unmounts.
 */
export function useSpeech() {
  const [state, setState] = useState<SpeechState>(speech.state)

  useEffect(() => speech.subscribe(setState), [])
  useEffect(() => () => speech.stop(), [])

  return {
    state,
    isPlaying: state === 'playing',
    isPaused: state === 'paused',
    isIdle: state === 'idle',
    canControl: speech.canControl,
    play: useCallback((text: string, lang?: string) => speech.play(text, lang), []),
    pause: useCallback(() => speech.pause(), []),
    resume: useCallback(() => speech.resume(), []),
    stop: useCallback(() => speech.stop(), []),
  }
}
