class RmsCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;
    let sum = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i];
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / channel.length);
    const samples = new Float32Array(channel.length);
    samples.set(channel);
    this.port.postMessage({ rms, buffer: samples.buffer, length: samples.length }, [samples.buffer]);
    return true;
  }
}

registerProcessor('rms-capture-processor', RmsCaptureProcessor);
