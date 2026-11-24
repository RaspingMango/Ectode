// Synthesized audio feedback for native mobile feel without external mp3 dependencies
let audioCtx: AudioContext | null = null;
let soundFeedbackEnabled = true;
let hapticFeedbackEnabled = true;

export interface AudioFeedbackPreferences {
  soundEnabled: boolean;
  hapticEnabled: boolean;
}

export function setAudioPreferences(prefs: Partial<AudioFeedbackPreferences>): void {
  if (typeof prefs.soundEnabled === 'boolean') {
    soundFeedbackEnabled = prefs.soundEnabled;
  }
  if (typeof prefs.hapticEnabled === 'boolean') {
    hapticFeedbackEnabled = prefs.hapticEnabled;
  }
}

export function getAudioPreferences(): AudioFeedbackPreferences {
  return {
    soundEnabled: soundFeedbackEnabled,
    hapticEnabled: hapticFeedbackEnabled,
  };
}

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx && typeof window !== 'undefined') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Play a high-pitched futuristic dual-tone chirp when a QR code is scanned
 */
export function playScanSuccessSound() {
  if (soundFeedbackEnabled) {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        const now = ctx.currentTime;
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now); // A5
        osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.12); // A6

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1320, now + 0.05);
        osc2.frequency.exponentialRampToValueAtTime(2640, now + 0.14);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now + 0.05);
        osc1.stop(now + 0.18);
        osc2.stop(now + 0.18);
      }
    } catch {
      // Ignore audio failures
    }
  }

  // Haptic feedback for mobile (independent of sound setting)
  triggerHaptic([35, 30, 45]);
}

/**
 * Play a subtle soft click for button taps
 */
export function playTapSound() {
  if (soundFeedbackEnabled) {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        const now = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.04);
      }
    } catch {
      // Ignore
    }
  }

  triggerHaptic(12);
}

/**
 * Native Android haptic feedback simulation
 */
export function triggerHaptic(pattern: number | number[] = 15) {
  if (!hapticFeedbackEnabled) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore
  }
}
