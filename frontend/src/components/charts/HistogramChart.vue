<template>
  <div class="histogram-chart">
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
    mode: 'index' as const,
  },
  plugins: {
    legend: {
      display: false
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
      }
    }
  },
  scales: {
    x: {
      grid: {
        display: false
      },
      ticks: {
        color: isDark.value ? '#9ca3af' : '#6b7280',
        font: {
          size: 11,
          weight: 500
        }
      },
      border: {
        display: false
      }
    },
    y: {
      grid: {
        display: true,
        color: isDark.value ? '#374151' : '#f3f4f6',
        borderColor: isDark.value ? '#4b5563' : '#d1d5db',
      },
      ticks: {
        color: isDark.value ? '#9ca3af' : '#6b7280',
        font: {
          size: 11,
          weight: 500
        }
      },
      border: {
        display: false
      }
    }
  },
  elements: {
    bar: {
      borderRadius: {
        topLeft: 4,
        topRight: 4,
        bottomLeft: 0,
        bottomRight: 0
      },
      borderSkipped: false,
      backgroundColor: (context: any) => {
        const chart = context.chart
        const { ctx, chartArea } = chart
        
        if (!chartArea) {
          return '#409eff'
        }
        
        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top)
        gradient.addColorStop(0, '#409eff')
        gradient.addColorStop(1, '#67c23a')
        
        return gradient
      }
    }
  },
  animation: {
    duration: 750,
    easing: 'easeInOutQuart'
  }
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
    type: 'bar',
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
.histogram-chart {
  position: relative;
  width: 100%;
  
  canvas {
    max-width: 100%;
    height: auto;
  }
}
</style>