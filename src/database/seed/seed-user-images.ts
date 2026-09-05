// src/database/seed/seed-user-images.ts

import { AppDataSource } from '../data-source';
import { UserEntity } from '../../user/entities/user.entity';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const profileImageUrls = [
  'https://i.pravatar.cc/300?img=1',
  'https://i.pravatar.cc/300?img=2',
  'https://i.pravatar.cc/300?img=3',
  'https://i.pravatar.cc/300?img=4',
  'https://i.pravatar.cc/300?img=5',
  'https://i.pravatar.cc/300?img=6',
  'https://i.pravatar.cc/300?img=7',
  'https://i.pravatar.cc/300?img=8',
  'https://i.pravatar.cc/300?img=9',
  'https://i.pravatar.cc/300?img=10',
  'https://i.pravatar.cc/300?img=11',
  'https://i.pravatar.cc/300?img=12',
];

async function seedUserImages() {
  await AppDataSource.initialize();

  const userRepository = AppDataSource.getRepository(UserEntity);

  for (let i = 0; i < profileImageUrls.length; i++) {
    const userCode = `user_${String(i + 1).padStart(3, '0')}`;
    const imageUrl = profileImageUrls[i];

    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const user = await userRepository.findOne({ where: { userCode } });

    if (!user) {
      console.log(`${userCode} 사용자를 찾을 수 없어 건너뜁니다.`);
      continue;
    }

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: `profile/${user.id}.jpg`,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );

    await userRepository.update(
      { userCode },
      {
        imageMimeType: 'image/jpeg',
        imageUpdatedAt: new Date(),
      },
    );

    console.log(`${userCode} 이미지 저장 완료`);
  }

  await AppDataSource.destroy();
}

seedUserImages().catch(async error => {
  console.error(error);

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }

  process.exit(1);
});