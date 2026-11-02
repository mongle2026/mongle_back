// src/database/seed/seed-default-profile-images.ts

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  DEFAULT_PROFILE_IMAGE_COUNT,
  getDefaultProfileImageKey,
} from '../../user/default-profile-image';

// 모든 회원이 함께 쓰는 기본 프로필 사진을 R2 에 올린다. 버킷마다, 버전마다 한 번 실행한다.
// 사진을 바꿀 때는 default-profile-images 폴더의 파일을 바꾸고 default-profile-image.ts 의 버전을 올린 뒤 실행한다
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function seedDefaultProfileImages() {
  for (let no = 1; no <= DEFAULT_PROFILE_IMAGE_COUNT; no++) {
    const body = await readFile(
      join(__dirname, 'default-profile-images', `profile_${no}.png`),
    );

    const key = getDefaultProfileImageKey(no);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: 'image/png',
      }),
    );

    console.log(`${key} 업로드 완료`);
  }
}

seedDefaultProfileImages().catch((error) => {
  console.error(error);
  process.exit(1);
});
