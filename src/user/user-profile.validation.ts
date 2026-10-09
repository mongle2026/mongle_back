import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

// 아이디(userCode): 서비스 안에서 회원을 구별하는 값. 영문, 숫자, _ 로 5~12자. 다른 사람과 중복 불가.
// 대소문자는 입력한 그대로 저장하고, DB 콜레이션이 대소문자를 구분하지 않아 중복 검사는 구분 없이 된다.
export const USER_CODE_PATTERN = /^[A-Za-z0-9_]{5,12}$/;
export const USER_CODE_RULE_MESSAGE =
  '아이디는 영문, 숫자, _ 로 5~12자여야 합니다.';

// 닉네임: 띄어쓰기 없이 2~8자. 중복 가능.
export const NICKNAME_RULE_MESSAGE = '닉네임은 띄어쓰기 없이 2~8자여야 합니다.';

// 화면에서 붙는 @ 는 저장하지 않는다
export const normalizeUserCode = (userCode: string) =>
  userCode.trim().replace(/^@+/, '');

export function IsUserCode() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeUserCode(value) : value,
    ),
    IsString(),
    Matches(USER_CODE_PATTERN, { message: USER_CODE_RULE_MESSAGE }),
  );
}

export function IsNickname() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    Length(2, 8, { message: NICKNAME_RULE_MESSAGE }),
    Matches(/^\S+$/, { message: NICKNAME_RULE_MESSAGE }),
  );
}
