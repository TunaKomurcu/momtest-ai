import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// No credentials are passed here — the SDK's default provider chain picks
// up the EC2 instance role via IMDS in production, or the local `aws`
// CLI/profile config in development. Never hardcode keys in this module.
const REGION = process.env.AWS_REGION ?? 'eu-central-1'
const BUCKET = process.env.S3_BUCKET_NAME ?? 'momtest-ai-storage-820140266422'

const UPLOAD_PREFIX = 'uploads/audio/'
const REPORT_PREFIX = 'exports/reports/'

const s3 = new S3Client({ region: REGION })

// Keys are caller-supplied (e.g. derived from an interview/report id) —
// restrict to a safe character set so they can't escape their prefix or
// collide with unrelated bucket paths.
const SAFE_KEY = /^[a-zA-Z0-9!_.*'()/-]+$/

function resolveKey(prefix: string, key: string): string {
  if (!key || key.includes('..') || key.startsWith('/') || !SAFE_KEY.test(key)) {
    throw new Error(`Invalid S3 object key: ${key}`)
  }
  return `${prefix}${key}`
}

/**
 * Pre-signed PUT URL for a client to upload interview audio/transcript
 * directly to S3 (uploads/audio/), bypassing the app server. The object is
 * auto-deleted after 48h by the bucket's lifecycle rule — treat this as
 * temporary staging, not durable storage.
 */
export async function getAudioUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: resolveKey(UPLOAD_PREFIX, key),
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds })
}

/**
 * Pre-signed GET URL for a client to download a generated analysis report
 * (exports/reports/) without routing the file through the app server.
 */
export async function getReportDownloadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: resolveKey(REPORT_PREFIX, key),
  })
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds })
}
