// src/database/seed/seed-user-images.ts

import { AppDataSource } from '../data-source';
import { UserEntity } from '../../user/entities/user.entity';

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
    const userCode = `user_${i + 1}`;
    const imageUrl = profileImageUrls[i];

    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await userRepository.update(
      { userCode },
      {
        imageData: buffer,
        imageMimeType: response.headers.get('content-type') ?? 'image/jpeg',
        imageSize: buffer.length,
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