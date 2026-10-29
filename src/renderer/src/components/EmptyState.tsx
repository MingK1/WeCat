import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon: Icon, title, description, action }: Props): React.JSX.Element {
  return (
    <div className="empty-state">
      <Icon size={32} strokeWidth={1.5} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <button className="button primary" onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}
