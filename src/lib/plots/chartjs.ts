/**
 * Chart.js, loaded on first use and registered with only the pieces the
 * plot types need, so documents without plots never download it.
 */

import type { Chart as ChartType } from 'chart.js'

let chartPromise: Promise<typeof ChartType> | null = null

export function loadChart(): Promise<typeof ChartType> {
  if (!chartPromise) {
    chartPromise = import('chart.js').then((lib) => {
      lib.Chart.register(
        lib.LineController,
        lib.BarController,
        lib.RadarController,
        lib.ScatterController,
        lib.LineElement,
        lib.PointElement,
        lib.BarElement,
        lib.LinearScale,
        lib.LogarithmicScale,
        lib.CategoryScale,
        lib.RadialLinearScale,
        lib.Tooltip,
        lib.Filler,
      )
      return lib.Chart
    })
  }
  return chartPromise
}
