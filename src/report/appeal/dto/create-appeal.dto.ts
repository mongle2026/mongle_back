import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const APPEAL_CONTENT_MAX_LENGTH = 500;

// POST /appeal
export class CreateAppealDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: '이의 신청 내용을 적어 주세요.' })
  @MaxLength(APPEAL_CONTENT_MAX_LENGTH)
  content!: string;
}
