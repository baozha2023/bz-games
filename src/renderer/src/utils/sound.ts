export function playAchievementSound() {
  try {
    const AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Steam-like sound: A "pop" followed by a rising chime

    // 1. The "Pop" (short burst)
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.frequency.setValueAtTime(150, now);
    popOsc.frequency.exponentialRampToValueAtTime(0.01, now + 0.1);
    popGain.gain.setValueAtTime(0.2, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    popOsc.connect(popGain);
    popGain.connect(ctx.destination);
    popOsc.start(now);
    popOsc.stop(now + 0.1);

    // 2. The "Chime" (C Major 7th Arpeggio)
    // C5, E5, G5, B5
    const notes = [
      { freq: 523.25, start: 0.0, dur: 0.6 },
      { freq: 659.25, start: 0.05, dur: 0.6 },
      { freq: 783.99, start: 0.1, dur: 0.6 },
      { freq: 987.77, start: 0.15, dur: 0.8 }, // B5
    ];

    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      // Envelope
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.1, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + note.start + note.dur,
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.1);
    });
  } catch (e) {
    console.error("Failed to play achievement sound", e);
  }
}
