interface Props {
  name: string
  dataUrl?: string
  size?: number
}

export function Avatar({ name, dataUrl, size = 40 }: Props): React.JSX.Element {
  if (dataUrl) return <img className="avatar-image" src={dataUrl} alt="" width={size} height={size} />
  return <span className="avatar-fallback" style={{ width: size, height: size }}>{name.trim().slice(0, 1) || '?'}</span>
}
