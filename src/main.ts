import { Session } from './controller/session';
import { BrowserStore, requestPersistence } from './controller/storage';
import { VoiceController } from './controller/voice';
import { SynthSpeaker } from './voice/speaker';
import { AutoEngine, type EngineMode } from './voice/autoEngine';
import { WebSpeechEngine, webSpeechSupported } from './voice/speechEngine';
import { VoskEngine } from './voice/voskEngine';
import { mountApp } from './ui/app';
import { mountVoiceUI } from './ui/voiceui';

const VOICE_KEY = 'voice-poker-table/voice';

interface VoicePrefs { lang: string; speakBack: boolean; wakeWord: boolean; micOn: boolean; engine: EngineMode }

function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_KEY) ?? '{}') as Partial<VoicePrefs>;
    return {
      lang: raw.lang ?? navigator.language ?? 'en-US',
      speakBack: raw.speakBack ?? true,
      wakeWord: raw.wakeWord ?? true,
      micOn: raw.micOn ?? true,
      engine: raw.engine ?? 'auto',
    };
  } catch {
    return { lang: 'en-US', speakBack: true, wakeWord: true, micOn: true, engine: 'auto' };
  }
}

function savePrefs(patch: Partial<VoicePrefs>): void {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify({ ...loadVoicePrefs(), ...patch }));
  } catch { /* preference just won't persist */ }
}

async function boot(): Promise<void> {
  const session = await Session.open(new BrowserStore());
  const prefs = loadVoicePrefs();
  const online = webSpeechSupported() ? new WebSpeechEngine(prefs.lang) : null;
  const offline = VoskEngine.supported() ? new VoskEngine() : null;
  const ref: { voice: VoiceController | null } = { voice: null };
  const engine = online || offline
    ? new AutoEngine(online, offline, prefs.engine, () => ref.voice?.setEngineMode('offline'))
    : null;
  const speaker = SynthSpeaker.supported() ? new SynthSpeaker() : null;
  const voice = new VoiceController(session, engine, speaker, {
    lang: prefs.lang,
    speakBack: prefs.speakBack,
    wakeWord: prefs.wakeWord,
    engineMode: prefs.engine,
    onSettingsChange: (p) => savePrefs(p),
    onMicChoice: (on) => savePrefs({ micOn: on }),
  });
  ref.voice = voice;
  const voiceUi = mountVoiceUI(voice);
  mountApp(document.getElementById('app')!, session, voice, voiceUi);
  void requestPersistence();

  // Listening is the default: say "table ..." with no button. Browsers may need one tap first.
  if (engine && prefs.micOn) {
    voice.enable();
    const resume = () => {
      if (loadVoicePrefs().micOn && !voice.snapshot().listening && !voice.snapshot().enabled) voice.enable();
    };
    document.addEventListener('pointerdown', resume, { once: true });
  }
  // Dev-only handle so the flow can be exercised without a microphone.
  if (import.meta.env.DEV) Object.assign(window, { __voice: voice, __vosk: offline });
}
void boot();

/** Keep the shared table device awake while the page is visible. */
async function holdScreenAwake(): Promise<void> {
  try {
    if (document.visibilityState === 'visible' && 'wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch {
    /* denied or unsupported: screen may dim, app still works */
  }
}
void holdScreenAwake();
document.addEventListener('visibilitychange', () => void holdScreenAwake());
