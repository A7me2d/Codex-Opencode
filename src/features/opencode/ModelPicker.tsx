import { useId } from 'react'
import { tr } from '../../lib/i18n'
import { OpenCodeModelPicker } from '../../components/ui/OpenCodeModelPicker'
import type { ModelInfo } from '../../lib/types'

export interface ModelPickerProps {
  models: ModelInfo[]
  selected: string
  onSelect: (id: string) => void
  disabled?: boolean
}

export function ModelPicker({ models, selected, onSelect, disabled = false }: ModelPickerProps) {
  const id = useId()
  return <OpenCodeModelPicker id={id} models={models.filter(model => model.tools)} value={selected} onChange={onSelect} disabled={disabled} label={tr('موديل OpenCode')} placeholder={tr('اختر موديلًا')} />
}
