import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');

    this.bucket = this.configService.get<string>('R2_BUCKET_NAME')!;
    this.publicUrl = this.configService
      .get<string>('R2_PUBLIC_URL')!
      .replace(/\/$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.configService.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>(
          'R2_SECRET_ACCESS_KEY',
        )!,
      },
    });
  }

  resolveExtension(mimeType: string): string {
    const ext = EXTENSION_BY_MIME_TYPE[mimeType];

    if (!ext) {
      throw new Error(`지원하지 않는 이미지 형식입니다: ${mimeType}`);
    }

    return ext;
  }

  buildRecordImageKey(userId: number, recordId: number, mimeType: string) {
    const ext = this.resolveExtension(mimeType);
    return `records/${userId}/${recordId}/${randomUUID()}.${ext}`;
  }

  buildProfileImageKey(userId: number) {
    return `profile/${userId}.jpg`;
  }

  async createPresignedPutUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
  ) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getPublicUrl(key: string) {
    return `${this.publicUrl}/${key}`;
  }

  getProfileImageUrl(
    userId: number,
    imageMimeType: string | null,
    imageUpdatedAt: Date | null,
  ): string | null {
    if (!imageMimeType) {
      return null;
    }

    const version = imageUpdatedAt ? imageUpdatedAt.getTime() : 0;

    return `${this.getPublicUrl(this.buildProfileImageKey(userId))}?v=${version}`;
  }
}
