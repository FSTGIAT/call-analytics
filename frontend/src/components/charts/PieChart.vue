<template>
  <div class="pie-chart">
    <canvas ref="chartCanvas" :style="{ height }"></canvas>
  </div>
</template>

<script setup lang="ts">
import { Chart, registerables } from 'chart.js'
import { useAppStore } from '@/stores/app'

Chart.register(...registerables)

// Props
const props = defineProps<{
  data: any
  options?: any
  height?: string
  doughnut?: boolean
}>()

// Refs
const chartCanvas = ref<HTMLCanvasElement>()
const appStore = useAppStore()

// Chart instance
let chartInstance: Chart | null = null

// Computed properties
const isDark = computed(() => appStore.isDark)

// Default options
const defaultOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
        color: isDark.value ? '#e5e7eb' : '#374151',
        font: {
          size: 12,
          weight: 500
        },
        generateLabels: (chart: Chart) => {
          const data = chart.data
          if (data.labels && data.datasets.length) {
            const dataset = data.datasets[0]
            const backgroundColor = dataset.backgroundColor as string[]
            
            return data.labels.map((label, index) => {
              const value = dataset.data[index] as number
              const total = (dataset.data as number[]).reduce((sum, val) => sum + val, 0)
              const percentage = ((value / total) * 100).toFixed(1)
              
              return {
                text: `${label}: ${percentage}%`,
                fillStyle: backgroundColor[index],
                strokeStyle: backgroundColor[index],
                lineWidth: 0,
                pointStyle: 'circle',
                hidden: false,
                index
              }
            })
          }
          return []
        }
      }
    },
    tooltip: {
      backgroundColor: isDark.value ? '#1f2937' : '#ffffff',
      titleColor: isDark.value ? '#f9fafb' : '#111827',
      bodyColor: isDark.value ? '#d1d5db' : '#374151',
      borderColor: isDark.value ? '#374151' : '#e5e7eb',
      borderWidth: 1,
      cornerRadius: 8,
      displayColors: true,
      usePointStyle: true,
      padding: 12,
      titleFont: {
        size: 13,
        weight: 600
      },
      bodyFont: {
        size: 12,
        weight: 400
      },
      callbacks: {
        label: (context) => {
          const label = context.label || ''
          const value = context.parsed
          const total = (context.dataset.data as number[]).reduce((sum, val) => sum + val, 0)
          const percentage = ((value / total) * 100).toFixed(1)
          return `${label}: ${value} (${percentage}%)`
        }
      }
    }
  },
  elements: {
    arc: {
      borderWidth: 2,
      borderColor: isDark.value ? '#1f2937' : '#ffffff',
      hoverBorderWidth: 3
    }
  },
  animation: {
    duration: 1000,
    easing: 'easeInOutQuart'
  },
  cutout: props.doughnut ? '50%' : 0
}))

// Methods
const createChart = () => {
  if (!chartCanvas.value) return

  const ctx = chartCanvas.value.getContext('2d')
  if (!ctx) return

  // Destroy existing chart
  if (chartInstance) {
    chartInstance.destroy()
  }

  // Merge options
  const mergedOptions = {
    ...defaultOptions.value,
    ...props.options
  }

  // Create new chart
  chartInstance = new Chart(ctx, {
    type: props.doughnut ? 'doughnut' : 'pie',
    data: props.data,
    options: mergedOptions
  })
}

const updateChart = () => {
  if (!chartInstance) return

  chartInstance.data = props.data
  chartInstance.options = {
    ...defaultOptions.value,
    ...props.options
  }
  chartInstance.update('active')
}

const resizeChart = () => {
  if (chartInstance) {
    chartInstance.resize()
  }
}

// Watchers
watch(() => props.data, updateChart, { deep: true })
watch(() => props.options, updateChart, { deep: true })
watch(() => props.doughnut, createChart)
watch(isDark, createChart)

// Lifecycle
onMounted(() => {
  createChart()
  window.addEventListener('resize', resizeChart)
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy()
  }
  window.removeEventListener('resize', resizeChart)
})
</script>

<style lang="scss" scoped>
.pie-chart {
  position: relative;
  width: 100%;
  
  canvas {
    max-width: 100%;
    height: auto;
  }
}
</style>