import { IsNumber, IsString, MaxLength, Min } from 'class-validator';

/**
 * 업로드가 끝난 객체를 레코드에 첨부할 때 보내는 정보입니다.
 *
 * mimeType은 업로드 URL을 발급할 때 서명에 박아 두었으므로
 * 서버가 record_file_pending에 저장해 둔 값을 씁니다.
 */
export class RecordFileDto {
  @IsString()
  @MaxLength(500)
  key!: string;

  @IsNumber()
  @Min(0)
  size!: number;

  @IsString()
  @MaxLength(255)
  originalName!: string;
}
