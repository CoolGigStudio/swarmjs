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

/**
 * Resample PCM audio from one sample rate to another using Sox
 */
export function resamplePCM(
  inputBuffer: BufferLike,
  inputRate: number,
  outputRate: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
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
    ]);

    let outputBuffer = Buffer.alloc(0);
    process.stdout.on('data', (chunk) => {
      outputBuffer = Buffer.concat([outputBuffer, chunk]);
    });

    process.stdout.on('end', () => resolve(outputBuffer));
    process.stderr.on('data', (err) =>
      console.error('Sox error:', err.toString())
    );
    process.on('error', reject);

    process.stdin.write(inputBuffer);
    process.stdin.end();
  });
}
