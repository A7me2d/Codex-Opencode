import { tr } from './i18n'
/**
 * OpenCode questions.
 *
 * When OpenCode needs a decision it raises a *form*: a titled card with one or
 * more fields. A field either offers a fixed set of options (a choice) or is
 * free text. The server validates the same ids we do, so we only render forms
 * that can actually be answered.
 */
import { asArray, asRecord } from './guards'
import { readText } from './format'

export interface FormOption {
  value: string
  label: string
  description?: string
}

export interface FormField {
  key: string
  title: string
  description?: string
  type: string
  options: FormOption[]
}

export interface OpenCodeForm {
  id: string
  title: string
  fields: FormField[]
}

const formIdPattern = /^frm_[A-Za-z0-9]+$/

function readOptions(value: unknown): FormOption[] {
  return asArray(value).flatMap<FormOption>((option) => {
    const record = asRecord(option)
    const choice = typeof record.value === 'string' ? record.value : typeof record.label === 'string' ? record.label : ''
    if (!choice) return []
    return [{
      value: choice,
      label: typeof record.label === 'string' && record.label ? record.label : choice,
      description: typeof record.description === 'string' && record.description ? record.description : undefined,
    }]
  })
}

function readField(value: unknown, position: number): FormField {
  const field = asRecord(value)
  const options = readOptions(field.options)
  return {
    key: typeof field.key === 'string' && field.key ? field.key : `q${position}`,
    title: readText(field.title ?? field.label ?? field.question) || tr("سؤال {{0}}", [position + 1]),
    description: readText(field.description) || undefined,
    type: typeof field.type === 'string' ? field.type : options.length > 0 ? 'select' : 'string',
    options,
  }
}

function readForm(value: unknown, index: number): OpenCodeForm | null {
  const record = asRecord(value)
  const id = typeof record.id === 'string' ? record.id : ''
  if (!formIdPattern.test(id)) return null

  const fields = asArray(record.fields ?? record.questions ?? record.input).map(readField)
  return {
    id,
    title: readText(record.title) || tr("OpenCode يحتاج إلى توضيح"),
    // Never render an empty card: a question with no field is unanswerable, so
    // fall back to a single free-text answer under the form's own description.
    fields: fields.length > 0
      ? fields
      : [{ key: 'answer', title: readText(record.description) || tr("اكتب ردّك"), type: 'string', options: [] }],
  }
}

/** Every answerable question currently blocking an OpenCode run. */
export function readForms(value: unknown): OpenCodeForm[] {
  return asArray(value).flatMap<OpenCodeForm>((entry, index) => {
    const form = readForm(entry, index)
    return form ? [form] : []
  })
}

/** Boolean questions arrive without options, so offer the two honest answers. */
export function fieldOptions(field: FormField): FormOption[] {
  if (field.options.length > 0) return field.options
  if (field.type === 'boolean') return [{ value: 'true', label: tr("نعم") }, { value: 'false', label: tr("لا") }]
  return []
}
