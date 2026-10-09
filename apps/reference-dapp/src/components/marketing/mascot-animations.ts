// SPDX-License-Identifier: AGPL-3.0-only
// Transform only the supplied character. No path, color or facial edits.
export type MascotState = 'idle' | 'jump' | 'look' | 'travel' | 'celebrate';

export function characterMotion(state: Exclude<MascotState, 'idle' | 'travel'>, compact: boolean) {
  const height = compact ? 22 : 42;
  const frames: Record<typeof state, Keyframe[]> = {
    jump: [
      { transform: 'translateY(0) rotate(0) scale(1,1)', offset: 0 },
      { transform: 'translateY(4px) rotate(-5deg) scale(1.12,.84)', offset: .17 },
      { transform: `translateY(-${height}px) rotate(11deg) scale(.91,1.09)`, offset: .45 },
      { transform: `translateY(-${height * .7}px) rotate(-5deg) scale(.98,1.02)`, offset: .62 },
      { transform: 'translateY(3px) rotate(2deg) scale(1.14,.83)', offset: .8 },
      { transform: 'translateY(-3px) rotate(-2deg) scale(.97,1.03)', offset: .9 },
      { transform: 'translateY(0) rotate(0) scale(1,1)', offset: 1 },
    ],
    look: [
      { transform: 'rotate(0) translateX(0)', offset: 0 },
      { transform: 'rotate(-9deg) translateX(-3px)', offset: .25 },
      { transform: 'rotate(-9deg) translateX(-3px)', offset: .55 },
      { transform: 'rotate(5deg) translateX(2px)', offset: .78 },
      { transform: 'rotate(0) translateX(0)', offset: 1 },
    ],
    celebrate: [
      { transform: 'translateY(0) rotate(0) scale(1)', offset: 0 },
      { transform: 'translateY(3px) rotate(-8deg) scale(1.1,.88)', offset: .15 },
      { transform: `translateY(-${height * .7}px) rotate(18deg) scale(.95,1.05)`, offset: .37 },
      { transform: 'translateY(2px) rotate(-10deg) scale(1.1,.9)', offset: .58 },
      { transform: `translateY(-${height * .35}px) rotate(7deg) scale(.97,1.03)`, offset: .77 },
      { transform: 'translateY(0) rotate(0) scale(1)', offset: 1 },
    ],
  };
  return { frames: frames[state], duration: (state === 'celebrate' ? 1250 : state === 'look' ? 1100 : 1050) * (compact ? .8 : 1) };
}
