import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';

dotenv.config();

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID, // e.g., "my-gcp-project-id"
  keyFilename: process.env.GCP_KEYFILE, // e.g., "./service-account.json"
});
const bucketName = process.env.GCP_BUCKET_NAME;

export async function uploadAudioToStorage(
  audioBuffer: Buffer,
  filename: string
): Promise<string> {
  if (!bucketName) {
    throw new Error('GCP_BUCKET_NAME is not set');
  }
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(filename);

  // Upload the audio file. For small files, setting resumable to false is fine.
  await file.save(audioBuffer, {
    metadata: { contentType: 'audio/mpeg' },
    resumable: false,
  });

  // Construct and return the public URL.
  return `https://storage.googleapis.com/${bucketName}/${filename}`;
}

(async () => {
  // Create a dummy file content (as if it were an MP3 file)
  const dummyContent = Buffer.from('This is a debug message');
  const filename = `call-demo-${Date.now()}.mp3`;
  try {
    const url = await uploadAudioToStorage(dummyContent, filename);
    console.log('File uploaded to:', url);
  } catch (error) {
    console.error('Upload test failed:', error);
  }
})();
