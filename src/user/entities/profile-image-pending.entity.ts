import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 아직 어떤 회원에게도 붙어 있지 않은 프로필 사진(R2 객체)을 추적한다.
 *
 * 가입 화면에서 사진을 고르자마자 올리므로, 업로드 URL 을 발급할 때는 회원이 없을 수 있다.
 * 그래서 record_file_pending 과 달리 user_id 가 없다.
 *
 * 가입(또는 사진 변경)할 때 이 행을 지우고 user.profile_image_key 에 키를 넣는다.
 * 쓰이지 않고 purge_after 가 지난 행은 정리 크론이 R2 객체와 함께 지운다.
 */
@Entity('profile_image_pending')
export class ProfileImagePendingEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Index('UQ_profile_image_pending_file_key', { unique: true })
  @Column({ name: 'file_key', type: 'varchar', length: 100 })
  fileKey!: string;

  @Index('IDX_profile_image_pending_purge_after')
  @Column({ name: 'purge_after', type: 'datetime' })
  purgeAfter!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
