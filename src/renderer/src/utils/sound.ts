export function playAchievementSound() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    
    // Create a pleasant "achievement unlock" sound (major triad arpeggio)
    // C5 (523.25), E5 (659.25), G5 (783.99), C6 (1046.50)
    const notes = [
      { freq: 523.25, start: 0.0, end: 0.1 },
      { freq: 659.25, start: 0.05, end: 0.15 },
      { freq: 783.99, start: 0.1, end: 0.3 },
      { freq: 1046.50, start: 0.15, end: 0.6 }
    ]; 
    
    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine'; // Sine wave is smooth
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      
      // Envelope
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.1, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.end);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + note.start);
      osc.stop(now + note.start + note.end + 0.1);
    });
  } catch (e) {
    console.error('Failed to play achievement sound', e);
  }
}