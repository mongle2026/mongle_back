// 가입/로그인에 쓴 소셜 계정 종류
export enum AuthProvider {
  KAKAO = 'KAKAO',
  APPLE = 'APPLE',
  // 앱 심사용 계정. 소셜 계정이 아니라 env 의 아이디/비밀번호로 로그인한다 (AuthService.loginForReview)
  REVIEW = 'REVIEW',
}
