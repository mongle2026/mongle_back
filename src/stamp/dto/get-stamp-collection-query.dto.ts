import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class GetStampCollectionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;
}
