/**
 * Voice Processor - AudioWorkletProcessor
 *
 * 负责从麦克风采集音频，重采样到 16kHz，并按固定块大小（约 300ms = 4800 samples）
 * 发送给主线程，主线程再通过 Tauri invoke 传给 Rust 后端。
 *
 * 注意：此文件必须是独立 JS 文件，不能被打包进模块系统。
 * 放置在 public/ 目录，通过 audioWorklet.addModule('/voice-processor.js') 加载。
 */

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SIZE = 4800; // 300ms @ 16kHz

class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferLen = 0;
    this._inputSampleRate = sampleRate; // 全局 AudioWorkletGlobalScope 变量
    this._ratio = this._inputSampleRate / TARGET_SAMPLE_RATE;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    // 取第一个通道（单声道），如果有多通道取平均
    let channelData;
    if (input.length === 1) {
      channelData = input[0];
    } else {
      // 多通道降混为单声道
      const len = input[0].length;
      channelData = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        let sum = 0;
        for (let ch = 0; ch < input.length; ch++) {
          sum += input[ch][i];
        }
        channelData[i] = sum / input.length;
      }
    }

    // 重采样到 16kHz（线性插值）
    let resampled;
    if (this._ratio === 1.0) {
      resampled = channelData;
    } else {
      const outputLen = Math.floor(channelData.length / this._ratio);
      resampled = new Float32Array(outputLen);
      for (let i = 0; i < outputLen; i++) {
        const srcIndex = i * this._ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const frac = srcIndex - srcIndexFloor;
        if (srcIndexFloor + 1 < channelData.length) {
          resampled[i] =
            channelData[srcIndexFloor] * (1 - frac) +
            channelData[srcIndexFloor + 1] * frac;
        } else {
          resampled[i] = channelData[srcIndexFloor] || 0;
        }
      }
    }

    // 累积到 buffer
    for (let i = 0; i < resampled.length; i++) {
      this._buffer.push(resampled[i]);
    }
    this._bufferLen += resampled.length;

    // 按 CHUNK_SIZE 分块发送
    while (this._bufferLen >= CHUNK_SIZE) {
      const chunk = new Float32Array(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) {
        chunk[i] = this._buffer[i];
      }
      // 移除已发送部分
      this._buffer.splice(0, CHUNK_SIZE);
      this._bufferLen -= CHUNK_SIZE;

      // 转换为小端字节（与 Rust 端 f32::from_le_bytes 对应）
      const byteBuffer = new ArrayBuffer(chunk.byteLength);
      const view = new DataView(byteBuffer);
      for (let i = 0; i < chunk.length; i++) {
        view.setFloat32(i * 4, chunk[i], true); // little-endian
      }

      // 通过 MessagePort 发送到主线程（Transferable，零拷贝）
      this.port.postMessage(byteBuffer, [byteBuffer]);
    }

    return true;
  }
}

registerProcessor('voice-processor', VoiceProcessor);
