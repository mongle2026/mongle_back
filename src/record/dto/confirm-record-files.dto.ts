import { ArrayMaxSize, ArrayMinSize, IsNumber, IsNumberString, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ConfirmFileDto {
  @IsString()
  key!: string;

  @IsString()
  mimeType!: string;

  @IsNumber()
  size!: number;

  @IsString()
  originalName!: string;
}

export class ConfirmRecordFilesDto {
  @IsNumberString()
  userId!: string;

  @ValidateNested({ each: true })
  @Type(() => ConfirmFileDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  files!: ConfirmFileDto[];
}
