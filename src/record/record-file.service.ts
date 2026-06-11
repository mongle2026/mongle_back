import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RecordFileEntity } from './entities/record-file.entity';

@Injectable()
export class RecordFileService {
  constructor(private readonly dataSource: DataSource) {}

  async getFileById(id: number) {
    return this.dataSource
      .getRepository(RecordFileEntity)
      .createQueryBuilder('file')
      .addSelect('file.fileData')
      .where('file.id = :id', { id })
      .getOne();
  }
}