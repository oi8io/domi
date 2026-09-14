/**
 * 首次运行引导 —— PRD-M1-008 AC-3
 *
 * 步骤**写死成数据**而不是散在交互代码里，这样冒烟脚本能逐个断言提示出现，
 * 也保证「五分钟从零到第一次对话」这条路径不会被悄悄改长。
 */
export interface OnboardingStep {
  id: string
  prompt: string
  hint: string
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'provider',
    prompt: '第 1 步 / 共 4 步：选一个模型供应商',
    hint: 'anthropic · openai · google · openai-compatible（本地模型走最后一个）',
  },
  {
    id: 'credential',
    prompt: '第 2 步 / 共 4 步：填入 API Key',
    hint: '也可以直接设环境变量后重启，key 不会被写进事件流或日志',
  },
  {
    id: 'verify',
    prompt: '第 3 步 / 共 4 步：校验连通性',
    hint: '发一个最小请求确认 key 和网络都通，失败会告诉你是哪一环',
  },
  {
    id: 'chat',
    prompt: '第 4 步 / 共 4 步：开始对话',
    hint: '试试「读一下 README 并总结三句话」',
  },
]

export function formatOnboarding(): string {
  return ONBOARDING_STEPS.map((s) => `${s.prompt}\n  ${s.hint}`).join('\n\n')
}
