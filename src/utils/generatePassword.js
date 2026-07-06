const PASSWORD_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

/** 担当者の初期ログインパスワード（英字1文字 + 数字4桁、例: A1234） */
export function generateInitialMemberPassword() {
  const letter = PASSWORD_LETTERS[randomInt(PASSWORD_LETTERS.length)];
  const digits = String(randomInt(10000)).padStart(4, '0');
  return `${letter}${digits}`;
}
