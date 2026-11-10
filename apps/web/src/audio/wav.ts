/** Skalar bufferten på plats så att högsta toppen hamnar på `peak` (linjärt, 0–1). */
export function normalizePeak(buffer: AudioBuffer, peak: number): void {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
  }
  if (max === 0) return;
  const scale = peak / max;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

/** Kodar en AudioBuffer som 16-bitars PCM WAV. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerFrame = channels * 2;
  const dataBytes = frames * bytesPerFrame;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  const data = Array.from({ length: channels }, (_, c) =>
    buffer.getChannelData(c),
  );
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, Math.round(v * 32767), true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
