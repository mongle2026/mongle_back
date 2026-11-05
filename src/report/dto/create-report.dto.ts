import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportReason } from '../enums/report.enum';

// POST /report/{feed|comment|letter|user}/:id
export class CreateReportDto {
  @IsEnum(ReportReason)
  reason!: ReportReason;

  // 신고하면서 적은 내용. 어떤 사유든 적을 수 있고, 비워 보내면 null 로 저장한다.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string;
}
