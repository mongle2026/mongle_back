import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RecordEntity } from '../../record/entities/record.entity';
import { AuthProvider } from '../enums/auth-provider.enum';

@Entity('user')
// 같은 소셜 계정으로는 한 번만 가입할 수 있다
@Index('UQ_user_provider_user_id', ['provider', 'providerUserId'], {
  unique: true,
})
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  // 가입/로그인에 쓴 소셜 계정 종류
  @Column({ type: 'varchar', length: 10 })
  provider!: AuthProvider;

  // 소셜 계정 쪽 회원 식별값. 카카오는 회원번호(숫자), 애플은 sub(문자열)라서 문자열로 저장한다.
  @Column({ name: 'provider_user_id', type: 'varchar', length: 100 })
  providerUserId!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 프로필 사진의 R2 키(profile/{uuid}.jpg). null 이면 사진 없음
  @Column({ name: 'profile_image_key', type: 'varchar', length: 100, nullable: true })
  profileImageKey!: string | null;


  // 서비스 안에서 회원을 구별하는 아이디. 화면의 @ 없이 저장한다. 규칙은 user-profile.validation.ts
  @Column({ name: 'user_code', type: 'varchar', length: 30, unique: true })
  userCode!: string;

  // 사용자가 정한 이름. 중복 가능.
  @Column({ type: 'varchar', length: 50 })
  nickname!: string;

  // 마지막으로 발급한 refresh token 의 sha256 해시. 로그아웃하면 null. 기본 조회에서는 빠진다.
  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64, nullable: true, select: false })
  refreshTokenHash!: string | null;

  @OneToMany(() => RecordEntity, (record) => record.user)
  records!: RecordEntity[];
}