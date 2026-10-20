/** Spoken feedback. The controller ignores the mic while this is busy so it can't hear itself. */
export interface Speaker {
  speak(text: string): void;
  readonly busy: boolean;
}

export class SynthSpeaker implements Speaker {
  private until = 0;

  static supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get busy(): boolean {
    return Date.now() < this.until;
  }

  speak(text: string): void {
    if (!SynthSpeaker.supported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    // Block the mic while we talk. onend shortens this; the estimate covers browsers that never fire it.
    this.until = Date.now() + Math.min(15_000, 700 + text.length * 80);
    const done = () => { this.until = Date.now() + 500; };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  }
}
