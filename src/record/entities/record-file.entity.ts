import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FileType } from '../enums/file-type.enum';
import { RecordEntity } from './record.entity';

@Entity('record_file')
export class RecordFileEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'record_id', type: 'bigint' })
  recordId!: number;

  @ManyToOne(() => RecordEntity, (record) => record.files, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'record_id' })
  record!: RecordEntity;

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

  @Column({ name: 'file_key', type: 'varchar', length: 500 })
  fileKey!: string;

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