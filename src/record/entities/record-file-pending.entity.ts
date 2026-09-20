import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 아직 어떤 레코드에도 붙어 있지 않은 R2 객체를 추적합니다.
 *
 * 행이 생기는 경우는 두 가지입니다.
 * 1. 업로드 URL은 발급했지만 아직 첨부되지 않은 객체 (purgeAfter = 발급 + 1일)
 * 2. 레코드에서 떨어져 나와 R2에서 지워야 하는 객체 (purgeAfter = 지금)
 *
 * 두 경우 모두 "이 객체를 참조하는 record_file 행이 없다"는 뜻이라
 * 정리 크론이 같은 방식으로 처리합니다.
 *
 * 첨부(attachFiles)와 해제(detachFiles)가 모두 레코드 트랜잭션 안에서
 * 이 표를 건드리므로, 트랜잭션이 롤백되면 이 표도 같이 되돌아갑니다.
 * 덕분에 "대기 행이 남아 있다 == 참조하는 레코드가 없다"가 항상 성립합니다.
 */
@Entity('record_file_pending')
export class RecordFilePendingEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Index('UQ_record_file_pending_file_key', { unique: true })
  @Column({ name: 'file_key', type: 'varchar', length: 500 })
  fileKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 50 })
  mimeType!: string;

  @Index('IDX_record_file_pending_purge_after')
  @Column({ name: 'purge_after', type: 'datetime' })
  purgeAfter!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
