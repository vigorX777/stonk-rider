type SoundKind = 'ui' | 'gain' | 'loss' | 'land' | 'crash' | 'finish'

export class GameAudio {
  private context: AudioContext | null = null
  private engineOscillator: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private muted = localStorage.getItem('leek-knight-muted') === 'true'

  get isMuted(): boolean {
    return this.muted
  }

  get contextState(): AudioContextState | 'uninitialized' | 'unsupported' {
    if (typeof AudioContext === 'undefined') return 'unsupported'
    return this.context?.state ?? 'uninitialized'
  }

  get engineRunning(): boolean {
    return this.engineOscillator !== null
  }

  async unlock(): Promise<void> {
    if (typeof AudioContext === 'undefined') return
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    if (this.context.state === 'suspended') {
      await Promise.race([
        this.context.resume(),
        new Promise<void>((resolve) => globalThis.setTimeout(resolve, 300)),
      ])
    }
  }

  toggle(): boolean {
    this.muted = !this.muted
    localStorage.setItem('leek-knight-muted', String(this.muted))
    if (this.engineGain && this.context) {
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.055, this.context.currentTime, 0.03)
    }
    return this.muted
  }

  async startEngine(): Promise<void> {
    await this.unlock()
    if (!this.context || this.engineOscillator) return
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    const filter = this.context.createBiquadFilter()
    oscillator.type = 'sawtooth'
    oscillator.frequency.value = 72
    filter.type = 'lowpass'
    filter.frequency.value = 520
    gain.gain.value = this.muted ? 0 : 0.055
    oscillator.connect(filter).connect(gain).connect(this.context.destination)
    oscillator.start()
    this.engineOscillator = oscillator
    this.engineGain = gain
  }

  setEngineSpeed(speed: number): void {
    if (!this.context || !this.engineOscillator || !this.engineGain) return
    const normalized = Math.min(1, Math.abs(speed) / 20)
    this.engineOscillator.frequency.setTargetAtTime(72 + normalized * 150, this.context.currentTime, 0.04)
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.045 + normalized * 0.035, this.context.currentTime, 0.04)
  }

  stopEngine(): void {
    if (!this.engineOscillator) return
    this.engineOscillator.stop()
    this.engineOscillator.disconnect()
    this.engineOscillator = null
    this.engineGain = null
  }

  play(kind: SoundKind, combo?: number): void {
    if (!this.context || this.muted) return
    if (this.context.state === 'suspended') {
      void this.context.resume().then(() => this.play(kind, combo)).catch(() => undefined)
      return
    }
    if (kind === 'gain' || kind === 'loss') {
      this.playCoinSequence(kind, combo ?? 1)
      return
    }
    const presets: Record<SoundKind, [number, number, OscillatorType]> = {
      ui: [340, 0.06, 'sine'], gain: [720, 0.18, 'triangle'], loss: [150, 0.22, 'sawtooth'],
      land: [90, 0.08, 'square'], crash: [58, 0.42, 'sawtooth'], finish: [880, 0.5, 'triangle'],
    }
    const [frequency, duration, type] = presets[kind]
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * (kind === 'finish' ? 1.5 : 0.55)), this.context.currentTime + duration)
    gain.gain.setValueAtTime(0.0001, this.context.currentTime)
    gain.gain.exponentialRampToValueAtTime(kind === 'crash' ? 0.18 : 0.1, this.context.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration)
    oscillator.connect(gain).connect(this.context.destination)
    oscillator.start()
    oscillator.stop(this.context.currentTime + duration)
  }

  playComboBreak(): void {
    if (!this.context || this.muted) return
    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(300, now)
    oscillator.frequency.exponentialRampToValueAtTime(60, now + 0.25)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    oscillator.connect(gain).connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.3)
  }

  private playCoinSequence(kind: 'gain' | 'loss', combo = 1): void {
    if (!this.context) return
    const now = this.context.currentTime
    const baseNotes = kind === 'gain'
      ? [740, 990, 1320, 1760]
      : [260, 190, 140, 92]
    const noteCount = combo >= 7 ? 8 : combo >= 5 ? 6 : combo >= 3 ? 5 : 4
    const octaveShift = combo >= 7 ? 1.5 : combo >= 5 ? 1.25 : combo >= 3 ? 1.12 : 1
    const notes: number[] = []
    for (let index = 0; index < noteCount; index += 1) {
      notes.push(baseNotes[index % baseNotes.length] * octaveShift)
    }
    const interval = combo >= 5 ? 0.035 : 0.045
    notes.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator()
      const gain = this.context!.createGain()
      const start = now + index * interval
      const duration = kind === 'gain' ? 0.2 : 0.26
      oscillator.type = kind === 'gain' ? 'triangle' : 'sawtooth'
      oscillator.frequency.setValueAtTime(frequency, start)
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(40, frequency * (kind === 'gain' ? 1.28 : 0.58)),
        start + duration,
      )
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(kind === 'gain' ? 0.16 : 0.13, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      oscillator.connect(gain).connect(this.context!.destination)
      oscillator.start(start)
      oscillator.stop(start + duration)
    })
    if (combo >= 7) {
      const shimmer = this.context.createOscillator()
      const shimmerGain = this.context.createGain()
      shimmer.type = 'sine'
      shimmer.frequency.setValueAtTime(2200, now)
      shimmer.frequency.linearRampToValueAtTime(2800, now + 0.4)
      shimmerGain.gain.setValueAtTime(0.0001, now)
      shimmerGain.gain.linearRampToValueAtTime(0.06, now + 0.05)
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
      shimmer.connect(shimmerGain).connect(this.context.destination)
      shimmer.start(now)
      shimmer.stop(now + 0.5)
    }
  }
}
