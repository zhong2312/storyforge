import { AI_MODEL_SCENES, type AIModelRef } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'

export default function SceneBindingSection() {
  const { providerConfigs, sceneBindings, setSceneBinding } = useAIConfigStore()
  const modelChoices = providerConfigs.flatMap(provider => provider.models.map(model => ({
    value: `${provider.id}::${model.id}`,
    label: `${provider.name} / ${model.name}`,
  })))

  return (
    <section className="mb-6 rounded-xl border border-border bg-bg-surface p-5" aria-labelledby="scene-binding-title">
      <h3 id="scene-binding-title" className="text-base font-semibold text-text-primary">场景绑定</h3>
      <p className="mt-1 text-[11px] text-text-muted">为各类 AI 任务选择默认模型。对话框中仍可临时切换。</p>
      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {AI_MODEL_SCENES.map(scene => {
          const binding = sceneBindings[scene.value]
          const value = binding ? `${binding.providerConfigId}::${binding.modelId}` : ''
          return (
            <label key={scene.value} className="block">
              <span className="mb-1 flex items-center justify-between gap-3 text-xs text-text-secondary">
                <span className="font-medium">{scene.label}</span>
                <span className="truncate text-[10px] text-text-muted" title={scene.description}>{scene.description}</span>
              </span>
              <select
                value={value}
                onChange={event => setSceneBinding(scene.value, parseModelRef(event.target.value))}
                className="w-full rounded-md border border-border bg-bg-base px-2.5 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">跟随当前选择</option>
                {modelChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function parseModelRef(value: string): AIModelRef | null {
  if (!value) return null
  const [providerConfigId, modelId] = value.split('::')
  return providerConfigId && modelId ? { providerConfigId, modelId } : null
}
