export type SoundKind = 'deal' | 'chip' | 'flip' | 'fold' | 'win' | 'lose';

let sharedContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedContext === null) sharedContext = new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

function tone(
  frequency: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  delay = 0,
): void {
  const audio = context();
  if (audio === null) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(gain, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

/** 程序化带通噪声（发牌/翻牌的纸张声），用 LCG 保证不依赖 Math.random。 */
function rustle(duration: number, gain: number, center: number): void {
  const audio = context();
  if (audio === null) return;
  const length = Math.floor(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = center;
  filter.Q.value = 0.8;
  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(gain, audio.currentTime);
  envelope.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(audio.destination);
  source.start();
}

/** 零素材、零网络请求的牌桌音效。 */
export function playSound(kind: SoundKind, enabled: boolean): void {
  if (!enabled) return;
  switch (kind) {
    case 'deal':
      rustle(0.12, 0.09, 2400);
      break;
    case 'chip':
      tone(880, 0.06, 'triangle', 0.045);
      tone(1320, 0.05, 'triangle', 0.03, 0.045);
      break;
    case 'flip':
      rustle(0.16, 0.08, 1700);
      break;
    case 'fold':
      tone(220, 0.12, 'sine', 0.035);
      break;
    case 'win':
      tone(523, 0.16, 'sine', 0.05);
      tone(659, 0.16, 'sine', 0.05, 0.12);
      tone(784, 0.24, 'sine', 0.06, 0.24);
      break;
    case 'lose':
      tone(330, 0.16, 'sine', 0.04);
      tone(247, 0.26, 'sine', 0.04, 0.13);
      break;
  }
}
