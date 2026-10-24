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
@Index('UQ_user_public_id', ['publicId'], { unique: true })
export class UserEntity {
  // 서버 안에서만 쓰는 id(FK, 토큰 sub). 앱에는 publicId 를 보여준다.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  // 앱에 보여주는 회원 식별값(UUID). 가입할 때 정하고 바뀌지 않는다.
  // API 응답의 userId/id 같은 회원 필드와 요청으로 받는 회원 값은 모두 이 값이다.
  @Column({ name: 'public_id', type: 'char', length: 36 })
  publicId!: string;

  // 가입/로그인에 쓴 소셜 계정 종류
  @Column({ type: 'varchar', length: 10 })
  provider!: AuthProvider;

  // 소셜 계정 쪽 회원 식별값. 카카오는 회원번호(숫자), 애플은 sub(문자열)라서 문자열로 저장한다.
  // 탈퇴하면 null. 같은 소셜 계정으로 다시 가입할 수 있다.
  @Column({ name: 'provider_user_id', type: 'varchar', length: 100, nullable: true })
  providerUserId!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 프로필 사진의 R2 키(profile/{uuid}.jpg). null 이면 사진 없음
  @Column({ name: 'profile_image_key', type: 'varchar', length: 100, nullable: true })
  profileImageKey!: string | null;


  // 서비스 안에서 회원을 구별하는 아이디. 화면의 @ 없이 저장한다. 규칙은 user-profile.validation.ts
  // 탈퇴하면 null. 다른 회원이 이 아이디를 다시 쓸 수 있다.
  @Column({ name: 'user_code', type: 'varchar', length: 30, unique: true, nullable: true })
  userCode!: string | null;

  // 사용자가 정한 이름. 중복 가능. 탈퇴하면 빈 문자열이고, 화면에는 withdrawn-user.ts 의 이름으로 보여준다.
  @Column({ type: 'varchar', length: 50 })
  nickname!: string;

  // 탈퇴한 시각. 탈퇴한 회원도 행은 남긴다.
  // 남긴 댓글/편지/우표에서 보낸 사람을 사람마다 구분해야 해서 지우지 않고 개인정보만 비운다.
  @Column({ name: 'withdrawn_at', type: 'datetime', nullable: true })
  withdrawnAt!: Date | null;

  // 마지막으로 발급한 refresh token 의 sha256 해시. 로그아웃하면 null. 기본 조회에서는 빠진다.
  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64, nullable: true, select: false })
  refreshTokenHash!: string | null;

  @OneToMany(() => RecordEntity, (record) => record.user)
  records!: RecordEntity[];
}