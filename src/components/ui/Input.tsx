import type { InputHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
}

export function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id ?? props.name
  return (
    <label className="field" htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <input
        id={inputId}
        className={`field__input ${error ? 'field__input--error' : ''} ${className}`}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <span className="field__error">{error}</span>}
    </label>
  )
}
