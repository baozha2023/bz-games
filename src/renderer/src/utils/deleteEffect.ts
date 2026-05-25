const FRAGMENT_COLORS = [
  '#4a90d9', '#5cb85c', '#f0ad4e', '#d9534f', '#9b59b6',
  '#3498db', '#1abc9c', '#e74c3c', '#f39c12', '#2ecc71',
  '#e91e63', '#00bcd4', '#ff5722', '#795548', '#607d8b',
]

function randomColor(): string {
  return FRAGMENT_COLORS[Math.floor(Math.random() * FRAGMENT_COLORS.length)]
}

export function playShatterEffect(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect()
  const { left, top, width, height } = rect

  element.style.transition = 'none'
  element.animate(
    [
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      { transform: 'translate(0, -3px) rotate(1.5deg)', opacity: 0.85, offset: 0.12 },
      { transform: 'translate(0, 0) rotate(-1.5deg)', opacity: 0.85, offset: 0.25 },
      { transform: 'translate(0, -2px) rotate(0.8deg)', opacity: 0.6, offset: 0.4 },
      { transform: 'translate(0, 8px) rotate(0deg) scale(0.85)', opacity: 0 },
    ],
    { duration: 1200, easing: 'ease-in', fill: 'forwards' },
  )

  const overlay = document.createElement('div')
  overlay.style.cssText = `
    position: fixed;
    left: ${left}px;
    top: ${top}px;
    width: ${width}px;
    height: ${height}px;
    z-index: 9999;
    pointer-events: none;
    overflow: visible;
  `
  document.body.appendChild(overlay)

  const fragmentCount = 100 + Math.floor(Math.random() * 40)

  for (let i = 0; i < fragmentCount; i++) {
    const frag = document.createElement('div')
    const size = 2 + Math.random() * 6
    const x = Math.random() * width
    const y = Math.random() * height
    const color = randomColor()

    frag.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${Math.random() > 0.5 ? '2px' : '0'};
    `

    overlay.appendChild(frag)

    const angle = Math.random() * Math.PI * 2
    const distance = 80 + Math.random() * 280
    const dx = Math.cos(angle) * distance
    const dy = Math.sin(angle) * distance - 50
    const rotation = (Math.random() - 0.5) * 1200
    const duration = 2400 + Math.random() * 1200

    frag.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.2}px, ${dy * 0.2}px) rotate(${rotation * 0.2}deg) scale(0.8)`, opacity: 0.9, offset: 0.15 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) rotate(${rotation * 0.5}deg) scale(0.5)`, opacity: 0.6, offset: 0.4 },
        { transform: `translate(${dx}px, ${dy + 120}px) rotate(${rotation}deg) scale(0.15)`, opacity: 0 },
      ],
      {
        duration,
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        fill: 'forwards',
      },
    )
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      overlay.remove()
      resolve()
    }, 4000)
  })
}
