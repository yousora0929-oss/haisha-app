const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I, O は除外（誤読防止）
const DIGITS = '0123456789';

/** 大文字1字＋数字4桁の初期パスワードを生成（例: "K4821"） */
export function generateInitialPassword() {
  const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
  let digits = '';
  for (let i = 0; i < 4; i++) {
    digits += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  }
  return `${letter}${digits}`;
}
