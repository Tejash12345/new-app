import { useCallback, useEffect, useState } from 'react'
import { speech, type SpeechState } from '../lib/speak'

/**
 * React binding for the shared TTS controller. Reflects live play/pause state
 * and stops any speech when the using component unmounts.
 */
export function useSpeech() {
  const [state, setState] = useState<SpeechState>(speech.state)
  // true when the device has no TTS voice for the language just requested (silent)
  const [noVoice, setNoVoice] = useState(false)

  useEffect(() => speech.subscribe(setState), [])
  useEffect(() => speech.onNoVoice(() => setNoVoice(true)), [])
  useEffect(() => () => speech.stop(), [])

  return {
    state,
    isPlaying: state === 'playing',
    isPaused: state === 'paused',
    isIdle: state === 'idle',
    canControl: speech.canControl,
    noVoice,
    play: useCallback((text: string, lang?: string) => {
      setNoVoice(false)
      speech.play(text, lang)
    }, []),
    pause: useCallback(() => speech.pause(), []),
    resume: useCallback(() => speech.resume(), []),
    stop: useCallback(() => { setNoVoice(false); speech.stop() }, []),
  }
}
