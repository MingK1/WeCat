interface Props {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'warm' | 'cool'
}

export function Metric({ label, value, detail, tone = 'default' }: Props): React.JSX.Element {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}
