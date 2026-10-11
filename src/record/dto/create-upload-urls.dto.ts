import { ArrayMaxSize, ArrayMinSize, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class UploadFileDto {
  @IsString()
  mimeType!: string;
}

export class CreateUploadUrlsDto {
  @ValidateNested({ each: true })
  @Type(() => UploadFileDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  files!: UploadFileDto[];
}
