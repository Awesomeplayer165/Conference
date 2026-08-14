export interface AudioPatternSource {
  track: MediaStreamTrack;
  stop: () => void;
}

export function startAudioPatternSource(): AudioPatternSource {
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  oscillator.frequency.value = 440;
  gain.gain.value = 0.015;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  void context.resume();
  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    oscillator.stop();
    void context.close();
    throw new Error("Harness could not create a display-audio test track");
  }
  if ("contentHint" in track) track.contentHint = "music";
  return {
    track,
    stop: () => {
      track.stop();
      oscillator.stop();
      void context.close();
    },
  };
}
