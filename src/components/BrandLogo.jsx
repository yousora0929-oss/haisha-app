import { APP_BRAND_NAME } from '../constants/brand.js';

const HORIZONTAL_LIGHT = '/brand/logo-horizontal.svg';
const HORIZONTAL_DARK = '/brand/logo-horizontal-dark.svg';
const ICON = '/brand/icon.svg';
const ICON_LIGHT = '/brand/icon-light.svg';

/**
 * tone
 * - light: 明るい背景の横長ロゴ
 * - dark: 暗い背景の横長ロゴ（文字が白）
 * - auto: テーマに合わせて横長を切り替え。className は外側の枠（高さ・表示切替）
 * - icon: 高さ32px以下・狭い画面。暗い背景では白地のマーク
 */
export default function BrandLogo({ tone = 'auto', className = '', alt = APP_BRAND_NAME }) {
  if (tone === 'light') {
    return <img src={HORIZONTAL_LIGHT} alt={alt} className={className} />;
  }
  if (tone === 'dark') {
    return <img src={HORIZONTAL_DARK} alt={alt} className={className} />;
  }
  if (tone === 'icon') {
    return (
      <span className={`shrink-0 ${className}`}>
        <img src={ICON} alt={alt} className="h-full w-full dark:hidden" />
        <img src={ICON_LIGHT} alt="" aria-hidden="true" className="hidden h-full w-full dark:block" />
      </span>
    );
  }
  return (
    <span className={`aspect-[411/64] min-w-0 max-w-full shrink-0 ${className}`}>
      <img src={HORIZONTAL_LIGHT} alt={alt} className="h-full w-full max-w-full object-contain dark:hidden" />
      <img src={HORIZONTAL_DARK} alt="" aria-hidden="true" className="hidden h-full w-full max-w-full object-contain dark:block" />
    </span>
  );
}
