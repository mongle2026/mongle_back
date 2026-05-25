import { PartialType } from '@nestjs/mapped-types';
import { CreateLetterDto } from './create-letter.dto';

export class UpdateLetterDto extends PartialType(CreateLetterDto) {}
