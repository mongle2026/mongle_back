import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
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

  // 레코드가 만들어지기 전에 업로드 URL을 발급하므로 키에 recordId를 넣지 않는다.
  // 예전 키(records/{userId}/{recordId}/...)는 DB에 통째로 저장돼 있어 그대로 동작한다.
  buildRecordImageKey(userId: number, mimeType: string) {
    const ext = this.resolveExtension(mimeType);
    return `records/${userId}/${randomUUID()}.${ext}`;
  }

  // 사진을 바꿀 때마다 새 키를 쓴다. 같은 주소의 내용이 바뀌지 않아서 캐시를 무효화할 필요가 없다.
  // 가입 전에도 올릴 수 있도록 키에 userId 를 넣지 않는다.
  buildProfileImageKey() {
    return `profile/${randomUUID()}.jpg`;
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

  // 올라가 있는 객체의 크기(byte). 없으면 null
  async getObjectSize(key: string): Promise<number | null> {
    try {
      const { ContentLength } = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return ContentLength ?? 0;
    } catch (error) {
      // HEAD 는 응답 본문이 없어서 상태 코드로 확인한다
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;

      if (status === 404) {
        return null;
      }

      throw error;
    }
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getPublicUrl(key: string) {
    return `${this.publicUrl}/${key}`;
  }

  // 프로필 사진이 없으면 null
  getProfileImageUrl(profileImageKey: string | null): string | null {
    return profileImageKey ? this.getPublicUrl(profileImageKey) : null;
  }
}
