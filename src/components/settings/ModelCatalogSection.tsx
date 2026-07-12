import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'
import { PROVIDER_OPTIONS } from './provider-options'

export default function ModelCatalogSection() {
  const {
    providerConfigs,
    activeModelRef,
    addProviderConfig,
    removeProviderConfig,
    selectModel,
    addModel,
    removeModel,
    renameProviderConfig,
    renameModel,
  } = useAIConfigStore()
  const dialog = useDialog()
  const promptName = async (title: string, current: string, apply: (value: string) => void) => {
    const value = await dialog.prompt({ title, defaultValue: current })
    if (value?.trim()) apply(value.trim())
  }

  const handleAddModel = async (providerId: string) => {
    const model = await dialog.prompt({ title: '添加模型', placeholder: '输入 API 模型名，如 deepseek-chat' })
    if (model?.trim()) addModel(providerId, model.trim())
  }

  const handleRemoveProvider = async (id: string, name: string) => {
    if (providerConfigs.length <= 1) return
    const confirmed = await dialog.confirm({ title: `删除供应商「${name}」？`, message: '引用该供应商的场景绑定会恢复为默认模型。', tone: 'danger' })
    if (confirmed) removeProviderConfig(id)
  }

  return (
    <div className="mb-5 border-b border-border/60 pb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-text-primary">供应商与模型目录</h4>
          <p className="mt-0.5 text-[11px] text-text-muted">可添加多个供应商，并为每个供应商登记多个模型。</p>
        </div>
        <button
          type="button"
          onClick={() => addProviderConfig('custom')}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent/50 hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" />供应商
        </button>
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-bg-base/40">
        {providerConfigs.map(provider => (
          <div key={provider.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => selectModel({ providerConfigId: provider.id, modelId: provider.models[0].id })}
                className={`min-w-0 flex-1 text-left text-xs font-medium ${activeModelRef.providerConfigId === provider.id ? 'text-accent' : 'text-text-primary'}`}
              >
                <span className="block truncate">{provider.name}</span>
                <span className="mt-0.5 block text-[10px] font-normal text-text-muted">
                  {PROVIDER_OPTIONS.find(option => option.value === provider.provider)?.label ?? provider.provider}
                </span>
              </button>
              <button type="button" title="重命名供应商" onClick={() => { void promptName('重命名供应商', provider.name, value => renameProviderConfig(provider.id, value)) }} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="删除供应商" disabled={providerConfigs.length <= 1} onClick={() => { void handleRemoveProvider(provider.id, provider.name) }} className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {provider.models.map(model => {
                const selected = activeModelRef.providerConfigId === provider.id && activeModelRef.modelId === model.id
                return (
                  <span key={model.id} className={`flex items-center overflow-hidden rounded border text-[11px] ${selected ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-bg-surface text-text-secondary'}`}>
                    <button type="button" onClick={() => selectModel({ providerConfigId: provider.id, modelId: model.id })} className="max-w-48 truncate px-2 py-1" title={model.model}>{model.name}</button>
                    <button type="button" title="重命名模型" onClick={() => { void promptName('模型显示名称', model.name, value => renameModel(provider.id, model.id, value)) }} className="p-1 opacity-60 hover:opacity-100"><Pencil className="h-3 w-3" /></button>
                    <button type="button" title="删除模型" disabled={provider.models.length <= 1} onClick={() => removeModel(provider.id, model.id)} className="p-1 opacity-60 hover:text-red-400 hover:opacity-100 disabled:opacity-20"><X className="h-3 w-3" /></button>
                  </span>
                )
              })}
              <button type="button" title="给此供应商添加模型" onClick={() => { void handleAddModel(provider.id) }} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
