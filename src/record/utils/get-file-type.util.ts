import { BadRequestException } from '@nestjs/common';
import { FileType } from '../enums/file-type.enum';

export function getFileType(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) {
    return FileType.IMAGE;
  }

  if (mimeType.startsWith('audio/')) {
    return FileType.VOICE;
  }

  throw new BadRequestException('지원하지 않는 파일 타입입니다.');
}