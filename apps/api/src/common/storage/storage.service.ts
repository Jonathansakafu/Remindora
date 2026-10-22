import { DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { hmacSha256, safeEqual } from '@remindora/auth';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { ENV, KEYS, type Keys, type ServerEnv } from '../../config';

/**
 * Attachment storage. Uses S3-compatible object storage when configured
 * (AWS S3, R2, MinIO). Otherwise falls back to a local directory with
 * HMAC-signed, expiring URLs served by the API — same flow, no cloud needed in dev.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;
  private readonly localRoot = resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? '../../.local-infra/uploads');

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(KEYS) private readonly keys: Keys,
  ) {
    this.s3 =
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? new S3Client({
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
            credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
          })
        : null;
  }

  get driver(): 's3' | 'local' {
    return this.s3 ? 's3' : 'local';
  }

  private sign(key: string, op: 'put' | 'get', exp: number) {
    return hmacSha256(this.keys.encryption, `${op}:${key}:${exp}`);
  }

  verifyLocal(key: string, op: 'put' | 'get', exp: number, sig: string): boolean {
    return exp > Date.now() && safeEqual(this.sign(key, op, exp), sig);
  }

  async uploadUrl(attachmentId: string, key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }> {
    if (this.s3) {
      const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 600 });
      return { url, headers: { 'Content-Type': contentType } };
    }
    const exp = Date.now() + 600_000;
    return { url: `${this.env.API_PUBLIC_URL}/attachments/${attachmentId}/blob?exp=${exp}&sig=${this.sign(key, 'put', exp)}`, headers: { 'Content-Type': contentType } };
  }

  async downloadUrl(attachmentId: string, key: string, fileName: string): Promise<string> {
    if (this.s3) {
      return getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"` }),
        { expiresIn: 300 },
      );
    }
    const exp = Date.now() + 300_000;
    return `${this.env.API_PUBLIC_URL}/attachments/${attachmentId}/blob?exp=${exp}&sig=${this.sign(key, 'get', exp)}`;
  }

  /** Size of the stored object, or null if it was never uploaded. */
  async size(key: string): Promise<number | null> {
    if (this.s3) {
      try {
        const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
        return head.ContentLength ?? null;
      } catch {
        return null;
      }
    }
    const path = this.localPath(key);
    return existsSync(path) ? statSync(path).size : null;
  }

  async remove(key: string) {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key })).catch(() => undefined);
      return;
    }
    const path = this.localPath(key);
    if (existsSync(path)) unlinkSync(path);
  }

  localPath(key: string) {
    const path = resolve(join(this.localRoot, key));
    if (!path.startsWith(this.localRoot)) throw new Error('Invalid storage key');
    return path;
  }

  async writeLocal(key: string, body: Readable, maxBytes: number) {
    const path = this.localPath(key);
    mkdirSync(dirname(path), { recursive: true });
    let total = 0;
    body.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) body.destroy(new Error('File too large'));
    });
    await pipeline(body, createWriteStream(path));
    return total;
  }

  readLocal(key: string) {
    return createReadStream(this.localPath(key));
  }
}
