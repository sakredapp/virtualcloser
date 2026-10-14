/**
 * Company logo marks drawn as vectors, copied exactly from each company's own
 * brand source. Pure data, no React, so tests and any surface can read it.
 *
 * pinnacle: ~/pinnacle-life-group/components/brand/logo.tsx (MARK_PATH), the
 * peak mark beside the PINNACLE / LIFE GROUP lockup. One path, filled with
 * the current text colour, even-odd fill.
 */
import type { PhoneMarkKey } from './phoneVersions'

export type BrandMark = {
  viewBox: string
  path: string
  /** The words set beside the mark: the name, then the smaller line under it. */
  lockup: [string, string]
  /** What a screen reader says for the whole lockup. */
  label: string
}

export const PINNACLE_MARK_PATH =
  'M 368.167 1 L 367.367 1 184.167 368.150 L 0.968 735.301 1.567 735.900 L 2.167 736.500 131.430 736.500 L 260.693 736.500 262.517 735 L 264.341 733.500 359.782 542.250 L 455.222 351 455.863 351 L 456.504 351 513.751 465.500 L 570.999 580 479.467 580 L 387.936 580 384.472 581.447 L 381.009 582.894 362.429 620.197 L 343.848 657.500 520.088 657.753 L 696.328 658.006 696.719 657.614 L 697.111 657.223 576.843 416.684 L 456.574 176.145 455.745 176.658 L 454.916 177.170 335.575 415.835 L 216.235 654.500 214.277 656.261 L 212.319 658.022 169.619 657.761 L 126.919 657.500 247.563 416 L 368.206 174.500 379.067 196.169 L 389.927 217.837 390.931 218.457 L 391.934 219.077 413.019 176.914 L 434.104 134.752 433.426 131.626 L 432.748 128.500 400.857 64.750 L 368.967 1 368.167 1'

export const BRAND_MARKS: Record<PhoneMarkKey, BrandMark> = {
  pinnacle: {
    viewBox: '0 0 698 737',
    path: PINNACLE_MARK_PATH,
    lockup: ['PINNACLE', 'LIFE GROUP'],
    label: 'Pinnacle Life Group',
  },
}
