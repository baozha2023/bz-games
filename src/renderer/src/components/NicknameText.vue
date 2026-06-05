<template>
  <span class="nickname-text" :class="effectClass" :style="nicknameStyleVars">
    <span v-if="showAura" class="nickname-aura" aria-hidden="true"></span>
    <span class="nickname-label">{{ name }}</span>
    <span v-if="showParticles" class="nickname-particles" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import type { NicknameStyle } from '../../../shared/types'
import { adaptNicknameStyleForTheme } from '../utils/nicknameColor'
import type { EffectiveTheme } from '../utils/nicknameColor'

const props = withDefaults(defineProps<{
  name: string
  nicknameStyle?: NicknameStyle
  size?: number | string
  effectiveTheme?: EffectiveTheme
}>(), {
  size: 14,
})

const fontMap: Record<NonNullable<NicknameStyle['font']>, string> = {
  system: 'inherit',
  rounded: '"Trebuchet MS", "Microsoft YaHei UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", "SimSun", serif',
  mono: '"Cascadia Mono", "JetBrains Mono", Consolas, monospace',
  fantasy: 'Impact, "Arial Black", "Microsoft YaHei UI", fantasy',
}

const weightMap: Record<NonNullable<NicknameStyle['weight']>, number> = {
  normal: 500,
  semibold: 650,
  bold: 800,
}

const adaptedStyle = computed(() => props.effectiveTheme ? adaptNicknameStyleForTheme(props.nicknameStyle, props.effectiveTheme) : props.nicknameStyle)

const nicknameStyleVars = computed<CSSProperties>(() => {
  const style = adaptedStyle.value
  const color = style?.color || 'currentColor'
  const gradientStart = style?.gradientStart || color
  const gradientEnd = style?.gradientEnd || color
  return {
    '--nickname-color': color,
    '--nickname-gradient-start': gradientStart,
    '--nickname-gradient-end': gradientEnd,
    fontFamily: fontMap[style?.font || 'system'],
    fontWeight: weightMap[style?.weight || 'normal'],
    fontSize: typeof props.size === 'number' ? `${props.size}px` : props.size,
  } as CSSProperties
})

const effectClass = computed(() => `nickname-effect-${adaptedStyle.value?.effect || 'none'}`)
const showParticles = computed(() => ['sparkle', 'stardust', 'comet'].includes(adaptedStyle.value?.effect || ''))
const showAura = computed(() => ['aurora', 'crystal', 'heartbeat'].includes(adaptedStyle.value?.effect || ''))
</script>

<style scoped>
.nickname-text {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  line-height: 1.25;
  color: var(--nickname-color);
  isolation: isolate;
  vertical-align: baseline;
  transform: translateZ(0);
}

.nickname-label {
  position: relative;
  z-index: 2;
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nickname-effect-glow .nickname-label {
  text-shadow: 0 0 1px color-mix(in srgb, var(--nickname-color) 88%, #fff), 0 0 8px color-mix(in srgb, var(--nickname-color) 58%, transparent), 0 0 18px color-mix(in srgb, var(--nickname-color) 42%, transparent);
}

.nickname-effect-neon .nickname-label,
.nickname-effect-rainbow .nickname-label,
.nickname-effect-flame .nickname-label,
.nickname-effect-aurora .nickname-label,
.nickname-effect-crystal .nickname-label,
.nickname-effect-comet .nickname-label,
.nickname-effect-stardust .nickname-label {
  color: transparent;
  background: linear-gradient(110deg, var(--nickname-gradient-start), var(--nickname-gradient-end), var(--nickname-gradient-start));
  background-size: 260% 100%;
  -webkit-background-clip: text;
  background-clip: text;
}

.nickname-effect-neon .nickname-label {
  animation: nickname-shimmer 3s linear infinite;
  filter: drop-shadow(0 0 2px color-mix(in srgb, var(--nickname-gradient-start) 70%, transparent)) drop-shadow(0 0 8px color-mix(in srgb, var(--nickname-gradient-end) 54%, transparent));
}

.nickname-effect-rainbow .nickname-label {
  background-image: linear-gradient(92deg, #ff4d6d, #ffb703, #7bd88f, #4cc9f0, #8b5cf6, #ff4d6d);
  animation: nickname-shimmer 3.6s linear infinite;
  filter: saturate(1.22) drop-shadow(0 0 5px rgba(139, 92, 246, 0.42));
}

.nickname-effect-flame .nickname-label {
  background-image: linear-gradient(180deg, #fff6bf 0%, #ffd166 30%, var(--nickname-gradient-start) 58%, var(--nickname-gradient-end) 100%);
  filter: drop-shadow(0 0 3px rgba(255, 190, 77, 0.78)) drop-shadow(0 0 11px rgba(255, 77, 77, 0.52));
  animation: nickname-flame 1.6s ease-in-out infinite alternate;
}

.nickname-effect-sparkle .nickname-label {
  text-shadow: 0 0 7px color-mix(in srgb, var(--nickname-color) 48%, transparent), 0 0 13px color-mix(in srgb, var(--nickname-color) 36%, transparent);
}

.nickname-effect-aurora .nickname-label {
  background-image: linear-gradient(105deg, #8ef6e4, var(--nickname-gradient-start), #c084fc, var(--nickname-gradient-end), #8ef6e4);
  animation: nickname-shimmer 5.2s ease-in-out infinite;
  filter: drop-shadow(0 0 7px rgba(125, 249, 255, 0.34));
}

.nickname-effect-crystal .nickname-label {
  background-image: linear-gradient(112deg, #ffffff 0%, var(--nickname-gradient-start) 18%, #ffffff 34%, var(--nickname-gradient-end) 58%, #dbeafe 75%, var(--nickname-gradient-start) 100%);
  animation: nickname-crystal 4.5s ease-in-out infinite;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.35)) drop-shadow(0 0 8px color-mix(in srgb, var(--nickname-gradient-end) 35%, transparent));
}

.nickname-effect-comet .nickname-label {
  background-image: linear-gradient(95deg, var(--nickname-color), var(--nickname-gradient-start), #ffffff, var(--nickname-gradient-end), var(--nickname-color));
  animation: nickname-comet-text 2.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--nickname-gradient-end) 45%, transparent));
}

.nickname-effect-stardust .nickname-label {
  background-image: linear-gradient(90deg, var(--nickname-gradient-start), #fff7c2, var(--nickname-gradient-end), #ffffff, var(--nickname-gradient-start));
  animation: nickname-shimmer 4.2s linear infinite;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--nickname-gradient-start) 42%, transparent));
}

.nickname-effect-heartbeat .nickname-label {
  text-shadow: 0 0 4px color-mix(in srgb, var(--nickname-color) 42%, transparent), 0 0 12px color-mix(in srgb, var(--nickname-color) 42%, transparent);
  animation: nickname-heartbeat 2.2s ease-in-out infinite;
}

.nickname-aura {
  position: absolute;
  inset: -0.38em -0.65em;
  z-index: 0;
  border-radius: 999px;
  pointer-events: none;
  opacity: 0.76;
  filter: blur(9px);
}

.nickname-effect-aurora .nickname-aura {
  background: conic-gradient(from 120deg, transparent, color-mix(in srgb, var(--nickname-gradient-start) 42%, transparent), color-mix(in srgb, var(--nickname-gradient-end) 45%, transparent), transparent);
  animation: nickname-aura-drift 5.5s ease-in-out infinite alternate;
}

.nickname-effect-crystal .nickname-aura {
  background: radial-gradient(circle at 25% 50%, rgba(255, 255, 255, 0.5), transparent 32%), radial-gradient(circle at 78% 42%, color-mix(in srgb, var(--nickname-gradient-end) 40%, transparent), transparent 36%);
  filter: blur(6px);
}

.nickname-effect-heartbeat .nickname-aura {
  background: radial-gradient(circle, color-mix(in srgb, var(--nickname-color) 42%, transparent), transparent 62%);
  animation: nickname-heartbeat-aura 2.2s ease-in-out infinite;
}

.nickname-particles {
  position: absolute;
  inset: -0.72em -1em;
  pointer-events: none;
  z-index: 1;
}

.nickname-particles span {
  position: absolute;
  width: 0.2em;
  height: 0.2em;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0.18em #fff, 0 0 0.56em var(--nickname-color);
  animation: nickname-particle 2.2s ease-in-out infinite;
}

.nickname-particles span:nth-child(1) {
  left: 8%;
  top: 10%;
}

.nickname-particles span:nth-child(2) {
  right: 12%;
  top: 18%;
  animation-delay: 0.35s;
}

.nickname-particles span:nth-child(3) {
  left: 24%;
  bottom: 4%;
  animation-delay: 0.7s;
}

.nickname-particles span:nth-child(4) {
  right: 26%;
  bottom: 12%;
  animation-delay: 1.05s;
}

.nickname-particles span:nth-child(5) {
  left: 48%;
  top: 0;
  animation-delay: 1.32s;
}

.nickname-particles span:nth-child(6) {
  right: 4%;
  bottom: 2%;
  animation-delay: 1.58s;
}

.nickname-effect-stardust .nickname-particles span {
  clip-path: polygon(50% 0%, 62% 36%, 100% 50%, 62% 64%, 50% 100%, 38% 64%, 0% 50%, 38% 36%);
  border-radius: 0;
  background: #fff7c2;
  box-shadow: 0 0 0.25em #fff7c2, 0 0 0.75em var(--nickname-gradient-start);
}

.nickname-effect-comet .nickname-particles span {
  width: 0.68em;
  height: 0.14em;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, #ffffff, var(--nickname-gradient-end));
  box-shadow: 0 0 0.45em var(--nickname-gradient-end);
  animation: nickname-comet-particle 2.7s ease-in-out infinite;
}

@keyframes nickname-shimmer {
  0% { background-position: 0% 50%; }
  100% { background-position: 260% 50%; }
}

@keyframes nickname-flame {
  0% { filter: drop-shadow(0 0 3px rgba(255, 190, 77, 0.64)) drop-shadow(0 0 9px rgba(255, 77, 77, 0.36)); transform: translateY(0) skewX(-0.4deg); }
  100% { filter: drop-shadow(0 -1px 7px rgba(255, 198, 77, 0.82)) drop-shadow(0 -2px 16px rgba(255, 77, 77, 0.62)); transform: translateY(-1px) skewX(0.4deg); }
}

@keyframes nickname-particle {
  0%, 100% { opacity: 0.16; transform: translateY(0) scale(0.64) rotate(0deg); }
  50% { opacity: 1; transform: translateY(-0.56em) scale(1.14) rotate(90deg); }
}

@keyframes nickname-aura-drift {
  0% { transform: translateX(-0.12em) rotate(-5deg) scale(0.96); }
  100% { transform: translateX(0.12em) rotate(5deg) scale(1.04); }
}

@keyframes nickname-crystal {
  0%, 100% { background-position: 0% 50%; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--nickname-gradient-start) 26%, transparent)); }
  50% { background-position: 180% 50%; filter: drop-shadow(0 0 10px color-mix(in srgb, var(--nickname-gradient-end) 48%, transparent)); }
}

@keyframes nickname-comet-text {
  0% { background-position: 0% 50%; }
  58% { background-position: 260% 50%; }
  100% { background-position: 260% 50%; }
}

@keyframes nickname-comet-particle {
  0% { opacity: 0; transform: translateX(-0.8em) translateY(0.22em) rotate(-12deg); }
  18% { opacity: 1; }
  62% { opacity: 0.82; transform: translateX(1.8em) translateY(-0.28em) rotate(-12deg); }
  100% { opacity: 0; transform: translateX(1.8em) translateY(-0.28em) rotate(-12deg); }
}

@keyframes nickname-heartbeat {
  0%, 100% { transform: scale(1); }
  12% { transform: scale(1.035); }
  24% { transform: scale(1); }
  36% { transform: scale(1.02); }
  48% { transform: scale(1); }
}

@keyframes nickname-heartbeat-aura {
  0%, 100% { opacity: 0.28; transform: scale(0.9); }
  14% { opacity: 0.78; transform: scale(1.05); }
  30% { opacity: 0.32; transform: scale(0.94); }
  42% { opacity: 0.58; transform: scale(1.02); }
  56% { opacity: 0.26; transform: scale(0.94); }
}
</style>
