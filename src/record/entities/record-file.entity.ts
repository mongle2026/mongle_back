import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FileType } from '../enums/file-type.enum';

@Entity('record_file')
export class RecordFileEntity  {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'record_id', type: 'bigint' })
  recordId!: number;

  @Column({
    name: 'file_type',
    type: 'enum',
    enum: FileType,
  })
  fileType!: FileType;

  @Column({
    name: 'file_size',
    type: 'bigint',
  })
  fileSize!: number;

  @Column({
    name: 'file_data',
    type: 'longblob',
  })
  fileData!: Buffer;

  @Column({
    name: 'mime_type',
    type: 'varchar',
    length: 50,
  })
  mimeType!: string;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
  })
  originalName!: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;
}