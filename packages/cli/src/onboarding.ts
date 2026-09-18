/**
 * 首次运行引导 —— PRD-M1-008 AC-3
 *
 * 步骤**写死成数据**而不是散在交互代码里，这样冒烟脚本能逐个断言提示出现，
 * 也保证「五分钟从零到第一次对话」这条路径不会被悄悄改长。
 */
import { tr } from '@domi/i18n'
export interface OnboardingStep {
  id: string
  prompt: string
  hint: string
}

export const ONBOARDING_STEPS = (): readonly OnboardingStep[] => [
  {
    id: 'provider',
    prompt: tr('cli.onboard.step1'),
    hint: tr('cli.onboard.step1Hint'),
  },
  {
    id: 'credential',
    prompt: tr('cli.onboard.step2'),
    hint: tr('cli.onboard.step2Hint'),
  },
  {
    id: 'verify',
    prompt: tr('cli.onboard.step3'),
    hint: tr('cli.onboard.step3Hint'),
  },
  {
    id: 'chat',
    prompt: tr('cli.onboard.step4'),
    hint: tr('cli.onboard.step4Hint'),
  },
]

export function formatOnboarding(): string {
  return ONBOARDING_STEPS()
    .map((s) => `${s.prompt}\n  ${s.hint}`)
    .join('\n\n')
}
