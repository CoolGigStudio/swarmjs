import { spawn } from 'child_process';

type BufferLike = Buffer | Uint8Array;

/**
 * Decode µ-law (G.711) audio to PCM 16-bit LE
 */
export function decodeMuLaw(muLawBuffer: BufferLike): Buffer {
  const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    let muLawSample = muLawBuffer[i];
    let sign = muLawSample & 0x80 ? -1 : 1;
    let exponent = (muLawSample >> 4) & 0x07;
    let mantissa = muLawSample & 0x0f;
    let pcmSample =
      sign * ((0x21 << exponent) + (mantissa << (exponent + 3)) - 33);
    pcmBuffer.writeInt16LE(pcmSample, i * 2);
  }
  return pcmBuffer;
}

/**
 * Encode PCM 16-bit LE to µ-law (G.711)
 */
export function encodeMuLaw(pcmBuffer: BufferLike): Buffer {
  const muLawBuffer = Buffer.alloc(pcmBuffer.length / 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    let pcmSample = (pcmBuffer as Buffer).readInt16LE(i * 2);
    let sign = pcmSample < 0 ? 0x80 : 0x00;
    let magnitude = Math.abs(pcmSample);
    let exponent = 7;
    for (let j = 0; j < 8; j++) {
      if (magnitude <= 0x1f << j) {
        exponent = j;
        break;
      }
    }
    let mantissa = (magnitude >> (exponent + 3)) & 0x0f;
    muLawBuffer[i] = ~(sign | (exponent << 4) | mantissa);
  }
  return muLawBuffer;
}

export function isBufferSilent(buffer: BufferLike): boolean {
  // Lowering the threshold to detect more speech
  const threshold = 25; // Reduced from 50

  // Only check a sample of the buffer for performance
  const samplingRate = 4; // Check every 4th sample
  let totalSamples = 0;
  let silentSamples = 0;

  for (let i = 0; i < buffer.length; i += 2 * samplingRate) {
    totalSamples++;
    const sample = Math.abs((buffer as Buffer).readInt16LE(i));
    if (sample <= threshold) {
      silentSamples++;
    }
  }

  // Consider it silent if 90% of samples are below threshold
  return silentSamples / totalSamples > 0.9;
}

export function resamplePCM(
  inputBuffer: BufferLike,
  inputRate: number,
  outputRate: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!inputBuffer || inputBuffer.length < 2) {
      return resolve(Buffer.alloc(0));
    }

    if (isBufferSilent(inputBuffer)) {
      return resolve(Buffer.alloc(inputBuffer.length));
    }

    const process = spawn('sox', [
      '-t',
      'raw',
      '-r',
      inputRate.toString(),
      '-b',
      '16',
      '-c',
      '1',
      '-e',
      'signed-integer',
      '-',
      '-t',
      'raw',
      '-r',
      outputRate.toString(),
      '-b',
      '16',
      '-c',
      '1',
      '-e',
      'signed-integer',
      '-',
      'gain',
      '-3', // Just apply a simple gain reduction
    ]);

    let outputBuffer = Buffer.alloc(0);

    process.stdout.on('data', (chunk) => {
      outputBuffer = Buffer.concat([outputBuffer, chunk]);
    });

    process.stdout.on('end', () => resolve(outputBuffer));

    process.stderr.on('data', (err) => {
      const errorMsg = err.toString();
      // Only log actual errors, not warnings
      if (
        !errorMsg.includes('sox: Not enough input filenames specified') &&
        !errorMsg.includes('WARN rate') &&
        !errorMsg.includes('WARN dither')
      ) {
        console.error('Sox error:', errorMsg);
      }
    });

    process.on('error', (err) => {
      console.error('Sox process error:', err);
      reject(err);
    });

    process.stdin.write(inputBuffer);
    process.stdin.end();
  });
}
