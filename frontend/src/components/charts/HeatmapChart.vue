<template>
  <div class="heatmap-chart">
    <div class="heatmap-container" ref="heatmapContainer" :style="{ height }">
      <div class="heatmap-grid">
        <!-- Y-axis labels (Days of week) -->
        <div class="y-axis">
          <div class="y-label" v-for="day in weekDays" :key="day">{{ day }}</div>
        </div>
        
        <!-- Heatmap cells -->
        <div class="heatmap-cells">
          <!-- X-axis labels (Hours) -->
          <div class="x-axis">
            <div class="x-label" v-for="hour in hours" :key="hour">{{ hour }}</div>
          </div>
          
          <!-- Data cells -->
          <div class="cells-grid">
            <div
              v-for="(cell, index) in processedData"
              :key="index"
              class="cell"
              :class="getCellClass(cell.value)"
              :style="getCellStyle(cell.value)"
              @mouseenter="showTooltip($event, cell)"
              @mouseleave="hideTooltip"
            >
              <span class="cell-value" v-if="showValues">{{ cell.value }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Color Scale Legend -->
      <div class="color-scale">
        <div class="scale-label">{{ $t('analytics.callVolume', 'Call Volume') }}</div>
        <div class="scale-bar">
          <div class="scale-gradient"></div>
          <div class="scale-labels">
            <span class="scale-min">{{ minValue }}</span>
            <span class="scale-max">{{ maxValue }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Tooltip -->
    <div 
      ref="tooltip" 
      class="heatmap-tooltip"
      :style="tooltipStyle"
      v-show="showTooltipFlag"
    >
      <div class="tooltip-content">
        <div class="tooltip-title">{{ tooltipData.title }}</div>
        <div class="tooltip-body">{{ tooltipData.body }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'

const { t } = useI18n()
const appStore = useAppStore()

// Props
const props = defineProps<{
  data: {
    data: Array<{ x: number; y: number; v: number }>
  }
  options?: any
  height?: string
  showValues?: boolean
}>()

// Refs
const heatmapContainer = ref<HTMLElement>()
const tooltip = ref<HTMLElement>()

// Reactive state
const showTooltipFlag = ref(false)
const tooltipData = ref({ title: '', body: '' })
const tooltipStyle = ref({ left: '0px', top: '0px' })

// Computed properties
const isDark = computed(() => appStore.isDark)

const weekDays = computed(() => [
  t('time.sunday', 'Sun'),
  t('time.monday', 'Mon'),
  t('time.tuesday', 'Tue'),
  t('time.wednesday', 'Wed'),
  t('time.thursday', 'Thu'),
  t('time.friday', 'Fri'),
  t('time.saturday', 'Sat')
])

const hours = computed(() => {
  const hours = []
  for (let i = 0; i < 24; i++) {
    hours.push(i.toString().padStart(2, '0'))
  }
  return hours
})

const processedData = computed(() => {
  if (!props.data?.data) return []
  
  // Create a 7x24 grid (7 days, 24 hours)
  const grid = Array(7 * 24).fill(0)
  
  // Fill grid with data
  props.data.data.forEach(item => {
    const index = item.y * 24 + item.x
    if (index >= 0 && index < grid.length) {
      grid[index] = item.v
    }
  })
  
  return grid.map((value, index) => ({
    x: index % 24,
    y: Math.floor(index / 24),
    value
  }))
})

const minValue = computed(() => {
  if (!props.data?.data?.length) return 0
  return Math.min(...props.data.data.map(d => d.v))
})

const maxValue = computed(() => {
  if (!props.data?.data?.length) return 100
  return Math.max(...props.data.data.map(d => d.v))
})

const colorScale = computed(() => {
  const baseColors = isDark.value 
    ? ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1']
    : ['#f8fafc', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155']
  
  return baseColors
})

// Methods
const normalizeValue = (value: number): number => {
  if (maxValue.value === minValue.value) return 0
  return (value - minValue.value) / (maxValue.value - minValue.value)
}

const getCellClass = (value: number): string => {
  const normalized = normalizeValue(value)
  const intensity = Math.floor(normalized * 6)
  return `intensity-${Math.max(0, Math.min(6, intensity))}`
}

const getCellStyle = (value: number): Record<string, string> => {
  const normalized = normalizeValue(value)
  const intensity = Math.floor(normalized * (colorScale.value.length - 1))
  const color = colorScale.value[Math.max(0, Math.min(colorScale.value.length - 1, intensity))]
  
  return {
    backgroundColor: color,
    color: normalized > 0.5 ? '#ffffff' : isDark.value ? '#f1f5f9' : '#334155'
  }
}

const showTooltip = (event: MouseEvent, cell: { x: number; y: number; value: number }) => {
  const dayName = weekDays.value[cell.y]
  const hour = cell.x.toString().padStart(2, '0')
  
  tooltipData.value = {
    title: `${dayName} ${hour}:00`,
    body: `${t('analytics.callVolume')}: ${cell.value}`
  }
  
  const rect = (event.target as HTMLElement).getBoundingClientRect()
  const containerRect = heatmapContainer.value?.getBoundingClientRect()
  
  if (containerRect) {
    tooltipStyle.value = {
      left: `${rect.left - containerRect.left + rect.width / 2}px`,
      top: `${rect.top - containerRect.top - 40}px`
    }
  }
  
  showTooltipFlag.value = true
}

const hideTooltip = () => {
  showTooltipFlag.value = false
}

// Watchers
watch(() => props.data, () => {
  // Data updated, chart will re-render automatically
}, { deep: true })
</script>

<style lang="scss" scoped>
.heatmap-chart {
  position: relative;
  width: 100%;
  
  .heatmap-container {
    position: relative;
    width: 100%;
    padding: 20px;
  }
  
  .heatmap-grid {
    display: flex;
    gap: 8px;
    
    .y-axis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      width: 40px;
      
      .y-label {
        font-size: 11px;
        color: var(--el-text-color-secondary);
        text-align: right;
        line-height: 1;
        font-weight: 500;
      }
    }
    
    .heatmap-cells {
      flex: 1;
      
      .x-axis {
        display: grid;
        grid-template-columns: repeat(24, 1fr);
        gap: 1px;
        margin-bottom: 4px;
        
        .x-label {
          font-size: 10px;
          color: var(--el-text-color-secondary);
          text-align: center;
          font-weight: 500;
        }
      }
      
      .cells-grid {
        display: grid;
        grid-template-columns: repeat(24, 1fr);
        grid-template-rows: repeat(7, 1fr);
        gap: 1px;
        
        .cell {
          aspect-ratio: 1;
          border-radius: 2px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--el-border-color-lighter);
          
          &:hover {
            transform: scale(1.1);
            border-color: var(--el-color-primary);
            z-index: 10;
            position: relative;
          }
          
          .cell-value {
            font-size: 9px;
            font-weight: 600;
            pointer-events: none;
          }
          
          // Intensity classes
          &.intensity-0 {
            background-color: var(--el-fill-color-extra-light);
          }
          
          &.intensity-1 {
            background-color: var(--el-color-primary-light-8);
          }
          
          &.intensity-2 {
            background-color: var(--el-color-primary-light-6);
          }
          
          &.intensity-3 {
            background-color: var(--el-color-primary-light-4);
          }
          
          &.intensity-4 {
            background-color: var(--el-color-primary-light-2);
          }
          
          &.intensity-5 {
            background-color: var(--el-color-primary);
          }
          
          &.intensity-6 {
            background-color: var(--el-color-primary-dark-2);
          }
        }
      }
    }
  }
  
  .color-scale {
    margin-top: 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    
    .scale-label {
      font-size: 12px;
      color: var(--el-text-color-secondary);
      font-weight: 500;
      white-space: nowrap;
    }
    
    .scale-bar {
      flex: 1;
      max-width: 200px;
      
      .scale-gradient {
        height: 8px;
        border-radius: 4px;
        background: linear-gradient(
          to right,
          var(--el-fill-color-extra-light) 0%,
          var(--el-color-primary-light-6) 25%,
          var(--el-color-primary-light-3) 50%,
          var(--el-color-primary) 75%,
          var(--el-color-primary-dark-2) 100%
        );
        margin-bottom: 4px;
      }
      
      .scale-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--el-text-color-placeholder);
        
        .scale-min,
        .scale-max {
          font-weight: 500;
        }
      }
    }
  }
  
  .heatmap-tooltip {
    position: absolute;
    background-color: var(--el-bg-color);
    border: 1px solid var(--el-border-color-light);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: 8px 12px;
    pointer-events: none;
    z-index: 1000;
    transform: translateX(-50%);
    
    .tooltip-content {
      .tooltip-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        margin-bottom: 2px;
      }
      
      .tooltip-body {
        font-size: 11px;
        color: var(--el-text-color-secondary);
      }
    }
    
    &::before {
      content: '';
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 5px solid var(--el-border-color-light);
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .heatmap-chart {
    .heatmap-grid {
      .y-axis {
        width: 30px;
        
        .y-label {
          font-size: 10px;
        }
      }
      
      .heatmap-cells {
        .x-axis {
          .x-label {
            font-size: 8px;
          }
        }
        
        .cells-grid {
          .cell {
            .cell-value {
              font-size: 8px;
            }
          }
        }
      }
    }
    
    .color-scale {
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
      
      .scale-bar {
        max-width: none;
      }
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .heatmap-chart {
    .heatmap-grid {
      flex-direction: row-reverse;
      
      .y-axis {
        .y-label {
          text-align: left;
        }
      }
    }
    
    .color-scale {
      flex-direction: row-reverse;
    }
  }
}

// Dark mode adjustments
// Dark mode adjustments handled by CSS variables
</style>