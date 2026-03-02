import lamejs from 'lamejs';

/**
 * Convert a WebM/Opus audio Blob to an MP3 Blob.
 *
 * Pipeline:
 *   1. Read the Blob as an ArrayBuffer
 *   2. Decode to PCM using AudioContext.decodeAudioData()
 *   3. Convert Float32 samples to Int16 (PCM)
 *   4. Encode to MP3 using lamejs
 *   5. Return an MP3 Blob
 */
export async function convertWebmToMp3(webmBlob: Blob): Promise<Blob> {
  const arrayBuffer = await webmBlob.arrayBuffer();

  const audioCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    await audioCtx.close();
  }

  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  const leftInt16 = float32ToInt16(leftChannel);
  const rightInt16 = rightChannel ? float32ToInt16(rightChannel) : undefined;

  const channels = rightInt16 ? 2 : 1;
  const kbps = 128;
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);

  const mp3Chunks: Int8Array[] = [];
  const sampleBlockSize = 1152;

  for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
    const leftBlock = leftInt16.subarray(i, i + sampleBlockSize);
    const rightBlock = rightInt16?.subarray(i, i + sampleBlockSize);

    let mp3buf: Int8Array;
    if (channels === 2 && rightBlock) {
      mp3buf = encoder.encodeBuffer(leftBlock, rightBlock);
    } else {
      mp3buf = encoder.encodeBuffer(leftBlock);
    }
    if (mp3buf.length > 0) {
      mp3Chunks.push(mp3buf);
    }
  }

  const tail = encoder.flush();
  if (tail.length > 0) {
    mp3Chunks.push(tail);
  }

  const blobParts: BlobPart[] = mp3Chunks.map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });
  return new Blob(blobParts, { type: 'audio/mpeg' });
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}
