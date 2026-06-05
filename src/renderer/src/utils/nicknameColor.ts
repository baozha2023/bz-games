import type { NicknameStyle } from '../../../shared/types'

export type EffectiveTheme = 'light' | 'dark'

const DARK_COLOR_MAX_LUMINANCE = 0.28
const LIGHT_COLOR_MIN_LUMINANCE = 0.72

function normalizeHexColor(color?: string): string | null {
  if (!color || color === 'inherit' || color === 'currentColor') return null
  const trimmed = color.trim()
  const shorthand = /^#([0-9a-f]{3})$/i.exec(trimmed)
  if (shorthand) {
    return `#${shorthand[1].split('').map((value) => value + value).join('')}`
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  return null
}

function getRelativeLuminance(color?: string): number | null {
  const normalized = normalizeHexColor(color)
  if (!normalized) return null
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(normalized.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function getSymmetricColor(color?: string): string | undefined {
  const normalized = normalizeHexColor(color)
  if (!normalized) return color
  const channels = [1, 3, 5].map((start) => 255 - parseInt(normalized.slice(start, start + 2), 16))
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function isNicknameColorAllowedForTheme(color: string | undefined, theme: EffectiveTheme): boolean {
  const luminance = getRelativeLuminance(color)
  if (luminance === null) return true
  if (theme === 'light') return luminance <= DARK_COLOR_MAX_LUMINANCE
  return luminance >= LIGHT_COLOR_MIN_LUMINANCE
}

export function adaptNicknameColorForTheme(color: string | undefined, theme: EffectiveTheme): string | undefined {
  if (isNicknameColorAllowedForTheme(color, theme)) return color
  return getSymmetricColor(color)
}

export function adaptNicknameStyleForTheme(style: NicknameStyle | undefined, theme: EffectiveTheme): NicknameStyle | undefined {
  if (!style) return style
  const adaptedStyle = { ...style }
  adaptedStyle.color = adaptNicknameColorForTheme(style.color, theme) || style.color
  return adaptedStyle
}
