import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, GraphChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([BarChart, GraphChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

interface Props {
  option: EChartsCoreOption
  height?: number
  ariaLabel: string
  onSelect?: (id: string) => void
}

export function Chart({ option, height = 260, ariaLabel, onSelect }: Props): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!element.current) return
    const chart = echarts.init(element.current, undefined, { renderer: 'canvas' })
    chart.setOption(option)
    chart.on('click', (event) => {
      const data = event.data as { id?: string } | undefined
      if (data?.id) onSelectRef.current?.(data.id)
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element.current)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [option])

  return <div ref={element} className="chart" style={{ height }} role="img" aria-label={ariaLabel} />
}
