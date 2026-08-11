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
import { computed } from "vue";
import type { CSSProperties } from "vue";
import { normalizeNicknameEffect } from "../../../shared/types";
import type { NicknameStyle } from "../../../shared/types";
import { adaptNicknameStyleForTheme } from "../utils/nicknameColor";
import type { EffectiveTheme } from "../utils/nicknameColor";

const props = withDefaults(
  defineProps<{
    name: string;
    nicknameStyle?: NicknameStyle;
    size?: number | string;
    effectiveTheme?: EffectiveTheme;
  }>(),
  {
    size: 14,
  },
);

const fontMap: Record<NonNullable<NicknameStyle["font"]>, string> = {
  system: "inherit",
  rounded: '"Trebuchet MS", "Microsoft YaHei UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", "SimSun", serif',
  mono: '"Cascadia Mono", "JetBrains Mono", Consolas, monospace',
  fantasy: 'Impact, "Arial Black", "Microsoft YaHei UI", fantasy',
};

const weightMap: Record<NonNullable<NicknameStyle["weight"]>, number> = {
  normal: 500,
  semibold: 650,
  bold: 800,
};

const adaptedStyle = computed(() =>
  props.effectiveTheme
    ? adaptNicknameStyleForTheme(props.nicknameStyle, props.effectiveTheme)
    : props.nicknameStyle,
);

const nicknameStyleVars = computed<CSSProperties>(() => {
  const style = adaptedStyle.value;
  const color = style?.color || "currentColor";
  const gradientStart = style?.gradientStart || color;
  const gradientEnd = style?.gradientEnd || color;
  return {
    "--nickname-color": color,
    "--nickname-gradient-start": gradientStart,
    "--nickname-gradient-end": gradientEnd,
    fontFamily: fontMap[style?.font || "system"],
    fontWeight: weightMap[style?.weight || "normal"],
    fontSize: typeof props.size === "number" ? `${props.size}px` : props.size,
  } as CSSProperties;
});

const activeEffect = computed(() =>
  normalizeNicknameEffect(adaptedStyle.value?.effect),
);
const effectClass = computed(() => `nickname-effect-${activeEffect.value}`);
const showParticles = computed(() => activeEffect.value === "comet");
const showAura = computed(() =>
  [
    "glow",
    "flame",
    "neon",
    "aurora",
    "crystal",
    "heartbeat",
    "hologram",
    "inkflow",
    "eclipse",
  ].includes(activeEffect.value),
);
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
  transform-origin: center;
  will-change: background-position, filter, transform;
}

.nickname-effect-glow .nickname-label {
  animation: nickname-glow-breathe 3.2s ease-in-out infinite;
}

.nickname-effect-neon .nickname-label,
.nickname-effect-flame .nickname-label,
.nickname-effect-aurora .nickname-label,
.nickname-effect-crystal .nickname-label,
.nickname-effect-comet .nickname-label,
.nickname-effect-hologram .nickname-label,
.nickname-effect-inkflow .nickname-label,
.nickname-effect-eclipse .nickname-label {
  color: transparent;
  background: linear-gradient(
    110deg,
    var(--nickname-gradient-start),
    var(--nickname-gradient-end),
    var(--nickname-gradient-start)
  );
  background-size: 260% 100%;
  -webkit-background-clip: text;
  background-clip: text;
}

.nickname-effect-neon .nickname-label {
  background-image: linear-gradient(
    105deg,
    #ffffff 0%,
    var(--nickname-gradient-start) 20%,
    var(--nickname-gradient-end) 50%,
    #ffffff 68%,
    var(--nickname-gradient-start) 100%
  );
  animation: nickname-neon 3.8s ease-in-out infinite;
}

.nickname-effect-flame .nickname-label {
  background-image: linear-gradient(
    180deg,
    #fff6bf 0%,
    #ffd166 30%,
    var(--nickname-gradient-start) 58%,
    var(--nickname-gradient-end) 100%
  );
  filter: drop-shadow(0 0 3px rgba(255, 190, 77, 0.78))
    drop-shadow(0 0 11px rgba(255, 77, 77, 0.52));
  animation: nickname-flame 1.6s ease-in-out infinite alternate;
}

.nickname-effect-aurora .nickname-label {
  background-image: linear-gradient(
    105deg,
    #8ef6e4,
    var(--nickname-gradient-start),
    #c084fc,
    var(--nickname-gradient-end),
    #8ef6e4
  );
  animation: nickname-shimmer 5.2s ease-in-out infinite;
  filter: drop-shadow(0 0 7px rgba(125, 249, 255, 0.34));
}

.nickname-effect-crystal .nickname-label {
  background-image: linear-gradient(
    112deg,
    var(--nickname-gradient-start) 0%,
    color-mix(in srgb, var(--nickname-gradient-start) 34%, #ffffff) 22%,
    #ffffff 31%,
    color-mix(in srgb, var(--nickname-gradient-end) 58%, #ffffff) 42%,
    var(--nickname-gradient-end) 66%,
    var(--nickname-gradient-start) 100%
  );
  animation: nickname-crystal 4.5s ease-in-out infinite;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.35))
    drop-shadow(
      0 0 8px color-mix(in srgb, var(--nickname-gradient-end) 35%, transparent)
    );
}

.nickname-effect-comet .nickname-label {
  background-image: linear-gradient(
    95deg,
    var(--nickname-color),
    var(--nickname-gradient-start),
    #ffffff,
    var(--nickname-gradient-end),
    var(--nickname-color)
  );
  animation: nickname-comet-text 2.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  filter: drop-shadow(
    0 0 7px color-mix(in srgb, var(--nickname-gradient-end) 45%, transparent)
  );
}

.nickname-effect-heartbeat .nickname-label {
  animation: nickname-heartbeat 2.2s ease-in-out infinite;
}

.nickname-effect-hologram .nickname-label {
  background-image: linear-gradient(
    96deg,
    #67e8f9,
    var(--nickname-gradient-start),
    #f0abfc,
    var(--nickname-gradient-end),
    #67e8f9
  );
  animation: nickname-hologram 3.4s steps(1, end) infinite;
  filter: drop-shadow(-0.06em 0 rgba(34, 211, 238, 0.72))
    drop-shadow(0.06em 0 rgba(244, 114, 182, 0.62));
}

.nickname-effect-inkflow .nickname-label {
  background-image:
    radial-gradient(
      circle at 18% 48%,
      color-mix(in srgb, var(--nickname-gradient-start) 82%, #111827),
      transparent 34%
    ),
    linear-gradient(
      104deg,
      var(--nickname-color),
      var(--nickname-gradient-start),
      color-mix(in srgb, var(--nickname-gradient-end) 72%, #111827),
      var(--nickname-color)
    );
  background-size:
    180% 180%,
    240% 100%;
  animation: nickname-inkflow 5.8s cubic-bezier(0.45, 0, 0.2, 1) infinite
    alternate;
  filter: drop-shadow(
      0 0.08em 0 color-mix(in srgb, var(--nickname-color) 34%, transparent)
    )
    drop-shadow(
      0 0 0.35em
        color-mix(in srgb, var(--nickname-gradient-start) 18%, transparent)
    );
}

.nickname-effect-eclipse .nickname-label {
  background-image: linear-gradient(
    100deg,
    var(--nickname-gradient-start) 0%,
    var(--nickname-color) 34%,
    #ffffff 48%,
    var(--nickname-gradient-end) 58%,
    var(--nickname-color) 100%
  );
  background-size: 300% 100%;
  animation: nickname-eclipse-text 4.8s ease-in-out infinite;
  filter: drop-shadow(
    0 0 0.32em color-mix(in srgb, var(--nickname-gradient-end) 46%, transparent)
  );
}

.nickname-aura {
  position: absolute;
  inset: -0.38em -0.65em;
  z-index: 0;
  border-radius: 999px;
  pointer-events: none;
  opacity: 0.76;
  filter: blur(9px);
  transform-origin: center;
  will-change: opacity, transform;
}

.nickname-effect-glow .nickname-aura {
  inset: -0.42em -0.62em;
  background: radial-gradient(
    ellipse,
    color-mix(in srgb, var(--nickname-color) 46%, transparent),
    transparent 68%
  );
  filter: blur(7px);
  animation: nickname-glow-aura 3.2s ease-in-out infinite;
}

.nickname-effect-flame .nickname-aura {
  inset: -0.7em -0.55em -0.18em;
  background:
    radial-gradient(
      ellipse at 28% 82%,
      color-mix(in srgb, var(--nickname-gradient-start) 58%, transparent),
      transparent 46%
    ),
    radial-gradient(
      ellipse at 72% 76%,
      color-mix(in srgb, var(--nickname-gradient-end) 52%, transparent),
      transparent 48%
    );
  filter: blur(8px);
  animation: nickname-flame-aura 1.6s ease-in-out infinite alternate;
}

.nickname-effect-neon .nickname-aura {
  inset: -0.34em -0.58em;
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--nickname-gradient-start) 48%, transparent),
    transparent 42%,
    color-mix(in srgb, var(--nickname-gradient-end) 52%, transparent)
  );
  filter: blur(8px);
  animation: nickname-neon-aura 3.8s ease-in-out infinite;
}

.nickname-effect-aurora .nickname-aura {
  background: conic-gradient(
    from 120deg,
    transparent,
    color-mix(in srgb, var(--nickname-gradient-start) 42%, transparent),
    color-mix(in srgb, var(--nickname-gradient-end) 45%, transparent),
    transparent
  );
  animation: nickname-aura-drift 5.5s ease-in-out infinite alternate;
}

.nickname-effect-crystal .nickname-aura {
  background:
    radial-gradient(
      circle at 25% 50%,
      rgba(255, 255, 255, 0.5),
      transparent 32%
    ),
    radial-gradient(
      circle at 78% 42%,
      color-mix(in srgb, var(--nickname-gradient-end) 40%, transparent),
      transparent 36%
    );
  filter: blur(6px);
  animation: nickname-crystal-aura 4.5s ease-in-out infinite;
}

.nickname-effect-heartbeat .nickname-aura {
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--nickname-color) 42%, transparent),
    transparent 62%
  );
  animation: nickname-heartbeat-aura 2.2s ease-in-out infinite;
}

.nickname-effect-hologram .nickname-aura {
  inset: -0.24em -0.45em;
  border-radius: 0.18em;
  background: repeating-linear-gradient(
    0deg,
    transparent 0 0.12em,
    color-mix(in srgb, var(--nickname-gradient-start) 18%, transparent) 0.13em
      0.16em
  );
  filter: none;
  opacity: 0.48;
  animation: nickname-hologram-scan 2.8s linear infinite;
}

.nickname-effect-inkflow .nickname-aura {
  inset: -0.42em -0.6em;
  background:
    radial-gradient(
      ellipse at 22% 55%,
      color-mix(in srgb, var(--nickname-gradient-start) 34%, transparent),
      transparent 42%
    ),
    radial-gradient(
      ellipse at 78% 44%,
      color-mix(in srgb, var(--nickname-gradient-end) 26%, transparent),
      transparent 38%
    );
  filter: blur(8px) saturate(0.8);
  animation: nickname-ink-aura 5.8s ease-in-out infinite alternate;
}

.nickname-effect-eclipse .nickname-aura {
  inset: -0.52em -0.78em;
  background:
    radial-gradient(
      ellipse at 50% 50%,
      transparent 38%,
      color-mix(in srgb, var(--nickname-gradient-start) 56%, transparent) 44%,
      color-mix(in srgb, var(--nickname-gradient-end) 64%, transparent) 49%,
      transparent 58%
    ),
    radial-gradient(
      ellipse at 66% 44%,
      rgba(255, 255, 255, 0.42),
      transparent 24%
    );
  filter: blur(3px);
  animation: nickname-eclipse-aura 4.8s ease-in-out infinite;
}

.nickname-particles {
  position: absolute;
  inset: -0.72em -1em;
  pointer-events: none;
  z-index: 1;
}

.nickname-particles span {
  --particle-scale: 1;
  position: absolute;
  width: 0.68em;
  height: 0.14em;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent,
    #ffffff,
    var(--nickname-gradient-end)
  );
  box-shadow: 0 0 0.45em var(--nickname-gradient-end);
  animation: nickname-comet-particle 2.7s ease-in-out infinite;
  opacity: 0;
}

.nickname-particles span:nth-child(1) {
  left: 8%;
  top: 10%;
}

.nickname-particles span:nth-child(2) {
  right: 12%;
  top: 18%;
  animation-delay: 0.35s;
  --particle-scale: 0.72;
}

.nickname-particles span:nth-child(3) {
  left: 24%;
  bottom: 4%;
  animation-delay: 0.7s;
  --particle-scale: 0.48;
}

.nickname-particles span:nth-child(4) {
  right: 26%;
  bottom: 12%;
  animation-delay: 1.05s;
  --particle-scale: 0.82;
}

.nickname-particles span:nth-child(5) {
  left: 48%;
  top: 0;
  animation-delay: 1.32s;
  --particle-scale: 0.55;
}

.nickname-particles span:nth-child(6) {
  right: 4%;
  bottom: 2%;
  animation-delay: 1.58s;
  --particle-scale: 0.38;
}

@keyframes nickname-glow-breathe {
  0%,
  100% {
    filter: brightness(0.98);
    opacity: 0.94;
  }
  50% {
    filter: brightness(1.12);
    opacity: 1;
  }
}

@keyframes nickname-glow-aura {
  0%,
  100% {
    opacity: 0.26;
    transform: scale(0.9);
  }
  50% {
    opacity: 0.68;
    transform: scale(1.06);
  }
}

@keyframes nickname-shimmer {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 260% 50%;
  }
}

@keyframes nickname-neon {
  0%,
  100% {
    background-position: 0% 50%;
    filter: drop-shadow(
        0 0 0.08em
          color-mix(in srgb, var(--nickname-gradient-start) 82%, transparent)
      )
      drop-shadow(
        0 0 0.42em
          color-mix(in srgb, var(--nickname-gradient-end) 52%, transparent)
      );
  }
  50% {
    background-position: 240% 50%;
    filter: drop-shadow(0 0 0.12em rgba(255, 255, 255, 0.82))
      drop-shadow(
        0 0 0.58em
          color-mix(in srgb, var(--nickname-gradient-start) 62%, transparent)
      );
  }
}

@keyframes nickname-neon-aura {
  0%,
  100% {
    opacity: 0.34;
    transform: scaleX(0.92);
  }
  50% {
    opacity: 0.72;
    transform: scaleX(1.04);
  }
}

@keyframes nickname-flame {
  0% {
    filter: drop-shadow(0 0 3px rgba(255, 190, 77, 0.64))
      drop-shadow(0 0 9px rgba(255, 77, 77, 0.36));
    transform: translateY(0) skewX(-0.4deg);
  }
  100% {
    filter: drop-shadow(0 -1px 7px rgba(255, 198, 77, 0.82))
      drop-shadow(0 -2px 16px rgba(255, 77, 77, 0.62));
    transform: translateY(-1px) skewX(0.4deg);
  }
}

@keyframes nickname-flame-aura {
  0% {
    opacity: 0.28;
    transform: translateY(0.08em) scaleX(0.94) scaleY(0.9);
  }
  100% {
    opacity: 0.62;
    transform: translateY(-0.08em) scaleX(1.03) scaleY(1.12);
  }
}

@keyframes nickname-aura-drift {
  0% {
    transform: translateX(-0.12em) rotate(-5deg) scale(0.96);
  }
  100% {
    transform: translateX(0.12em) rotate(5deg) scale(1.04);
  }
}

@keyframes nickname-crystal {
  0%,
  100% {
    background-position: 0% 50%;
    filter: drop-shadow(
      0 0 4px
        color-mix(in srgb, var(--nickname-gradient-start) 26%, transparent)
    );
  }
  50% {
    background-position: 180% 50%;
    filter: drop-shadow(
      0 0 10px color-mix(in srgb, var(--nickname-gradient-end) 48%, transparent)
    );
  }
}

@keyframes nickname-crystal-aura {
  0%,
  100% {
    opacity: 0.24;
    transform: scale(0.92) rotate(-1deg);
  }
  50% {
    opacity: 0.58;
    transform: scale(1.04) rotate(1deg);
  }
}

@keyframes nickname-comet-text {
  0% {
    background-position: 0% 50%;
  }
  58% {
    background-position: 260% 50%;
  }
  100% {
    background-position: 260% 50%;
  }
}

@keyframes nickname-comet-particle {
  0% {
    opacity: 0;
    transform: translateX(-0.8em) translateY(0.22em) rotate(-12deg)
      scale(calc(var(--particle-scale) * 0.45));
  }
  18% {
    opacity: 1;
  }
  62% {
    opacity: 0.82;
    transform: translateX(1.8em) translateY(-0.28em) rotate(-12deg)
      scale(var(--particle-scale));
  }
  100% {
    opacity: 0;
    transform: translateX(1.8em) translateY(-0.28em) rotate(-12deg)
      scale(calc(var(--particle-scale) * 0.65));
  }
}

@keyframes nickname-heartbeat {
  0%,
  100% {
    transform: scale(1);
  }
  12% {
    transform: scale(1.035);
  }
  24% {
    transform: scale(1);
  }
  36% {
    transform: scale(1.02);
  }
  48% {
    transform: scale(1);
  }
}

@keyframes nickname-heartbeat-aura {
  0%,
  100% {
    opacity: 0.28;
    transform: scale(0.9);
  }
  14% {
    opacity: 0.78;
    transform: scale(1.05);
  }
  30% {
    opacity: 0.32;
    transform: scale(0.94);
  }
  42% {
    opacity: 0.58;
    transform: scale(1.02);
  }
  56% {
    opacity: 0.26;
    transform: scale(0.94);
  }
}

@keyframes nickname-hologram {
  0%,
  84%,
  100% {
    background-position: 0% 50%;
    transform: translate(0);
  }
  86% {
    background-position: 80% 50%;
    transform: translateX(-0.035em);
  }
  88% {
    background-position: 150% 50%;
    transform: translateX(0.045em);
  }
  90% {
    background-position: 220% 50%;
    transform: translate(0);
  }
}

@keyframes nickname-hologram-scan {
  0% {
    transform: translateY(-0.18em);
    opacity: 0.26;
  }
  50% {
    opacity: 0.58;
  }
  100% {
    transform: translateY(0.18em);
    opacity: 0.26;
  }
}

@keyframes nickname-inkflow {
  0% {
    background-position:
      10% 45%,
      0% 50%;
    filter: blur(0) saturate(0.88);
  }
  52% {
    background-position:
      78% 56%,
      120% 50%;
    filter: blur(0.012em) saturate(1.08);
  }
  100% {
    background-position:
      22% 48%,
      240% 50%;
    filter: blur(0) saturate(0.92);
  }
}

@keyframes nickname-ink-aura {
  0% {
    opacity: 0.24;
    transform: translateX(-0.12em) scaleX(0.9);
  }
  55% {
    opacity: 0.56;
    transform: translateX(0.1em) scaleX(1.04);
  }
  100% {
    opacity: 0.32;
    transform: translateX(-0.04em) scaleX(0.96);
  }
}

@keyframes nickname-eclipse-text {
  0%,
  18% {
    background-position: 0% 50%;
  }
  72%,
  100% {
    background-position: 300% 50%;
  }
}

@keyframes nickname-eclipse-aura {
  0%,
  100% {
    opacity: 0.28;
    transform: scaleX(0.9);
  }
  45% {
    opacity: 0.82;
    transform: scaleX(1.04);
  }
  58% {
    opacity: 0.5;
    transform: scaleX(0.96);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nickname-label,
  .nickname-aura,
  .nickname-particles span {
    animation: none !important;
  }
}
</style>
