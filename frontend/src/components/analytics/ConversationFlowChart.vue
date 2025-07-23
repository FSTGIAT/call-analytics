<template>
  <div class="conversation-flow-chart">
    <div class="chart-header">
      <div class="chart-title">
        <h3>{{ $t('analytics.conversationFlow', 'Conversation Flow') }}</h3>
        <p class="chart-description">{{ $t('analytics.conversationFlowDesc', 'Interactive visualization of conversation patterns and agent interactions') }}</p>
      </div>
      <div class="chart-controls">
        <el-select v-model="selectedTimeRange" @change="handleTimeRangeChange" size="small">
          <el-option value="1h" :label="$t('time.lastHour', 'Last Hour')" />
          <el-option value="6h" :label="$t('time.last6Hours', 'Last 6 Hours')" />
          <el-option value="24h" :label="$t('time.last24Hours', 'Last 24 Hours')" />
          <el-option value="7d" :label="$t('time.last7Days', 'Last 7 Days')" />
        </el-select>
        <el-button-group class="view-mode-buttons">
          <el-button 
            :type="viewMode === 'flow' ? 'primary' : ''"
            @click="viewMode = 'flow'"
            size="small"
          >
            <el-icon><Share /></el-icon>
            {{ $t('analytics.flowView', 'Flow View') }}
          </el-button>
          <el-button 
            :type="viewMode === 'network' ? 'primary' : ''"
            @click="viewMode = 'network'"
            size="small"
          >
            <el-icon><Connection /></el-icon>
            {{ $t('analytics.networkView', 'Network View') }}
          </el-button>
        </el-button-group>
        <el-button 
          @click="exportFlow"
          size="small"
          :loading="isExporting"
        >
          <el-icon><Download /></el-icon>
          {{ $t('common.export') }}
        </el-button>
      </div>
    </div>

    <div class="chart-container" ref="chartContainer">
      <!-- Flow View -->
      <div v-if="viewMode === 'flow'" class="flow-view">
        <div class="flow-canvas" ref="flowCanvas"></div>
        <div class="flow-legend">
          <div class="legend-item">
            <div class="legend-color inbound"></div>
            <span>{{ $t('analytics.inboundCalls', 'Inbound Calls') }}</span>
          </div>
          <div class="legend-item">
            <div class="legend-color outbound"></div>
            <span>{{ $t('analytics.outboundCalls', 'Outbound Calls') }}</span>
          </div>
          <div class="legend-item">
            <div class="legend-color transfer"></div>
            <span>{{ $t('analytics.transfers', 'Transfers') }}</span>
          </div>
          <div class="legend-item">
            <div class="legend-color escalation"></div>
            <span>{{ $t('analytics.escalations', 'Escalations') }}</span>
          </div>
        </div>
      </div>

      <!-- Network View -->
      <div v-else class="network-view">
        <div class="network-canvas" ref="networkCanvas"></div>
        <div class="network-controls">
          <el-slider
            v-model="networkZoom"
            :min="0.5"
            :max="3"
            :step="0.1"
            :show-tooltip="false"
            @change="handleZoomChange"
          />
          <span class="zoom-label">{{ Math.round(networkZoom * 100) }}%</span>
        </div>
      </div>
    </div>

    <!-- Flow Statistics -->
    <div class="flow-stats">
      <div class="stat-card">
        <div class="stat-icon">
          <el-icon><Phone /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ flowStats.totalCalls }}</div>
          <div class="stat-label">{{ $t('analytics.totalCalls', 'Total Calls') }}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">
          <el-icon><Switch /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ flowStats.transfers }}</div>
          <div class="stat-label">{{ $t('analytics.transfers', 'Transfers') }}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">
          <el-icon><ArrowUp /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ flowStats.escalations }}</div>
          <div class="stat-label">{{ $t('analytics.escalations', 'Escalations') }}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">
          <el-icon><Timer /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ flowStats.avgDuration }}</div>
          <div class="stat-label">{{ $t('analytics.avgDuration', 'Avg Duration') }}</div>
        </div>
      </div>
    </div>

    <!-- Node Details Panel -->
    <div v-if="selectedNode" class="node-details-panel">
      <div class="panel-header">
        <h4>{{ selectedNode.name }}</h4>
        <el-button @click="selectedNode = null" size="small" text>
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div class="panel-content">
        <div class="detail-item">
          <span class="detail-label">{{ $t('analytics.nodeType', 'Type') }}:</span>
          <span class="detail-value">{{ selectedNode.type }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">{{ $t('analytics.callCount', 'Call Count') }}:</span>
          <span class="detail-value">{{ selectedNode.callCount }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">{{ $t('analytics.avgDuration', 'Avg Duration') }}:</span>
          <span class="detail-value">{{ selectedNode.avgDuration }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">{{ $t('analytics.connections', 'Connections') }}:</span>
          <span class="detail-value">{{ selectedNode.connections }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">{{ $t('analytics.efficiency', 'Efficiency') }}:</span>
          <span class="detail-value">{{ selectedNode.efficiency }}%</span>
        </div>
      </div>
    </div>

    <!-- Loading Overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <p>{{ $t('analytics.loadingFlow', 'Loading conversation flow...') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { ElMessage } from 'element-plus'
import {
  Share,
  Connection,
  Download,
  Phone,
  Switch,
  ArrowUp,
  Timer,
  Close,
  Loading
} from '@element-plus/icons-vue'
import * as d3 from 'd3'

const { t } = useI18n()
const appStore = useAppStore()

// Props
const props = defineProps<{
  dateRange: [string, string]
  refreshInterval?: number
}>()

// Emits
const emit = defineEmits(['nodeClick', 'linkClick'])

// Refs
const chartContainer = ref<HTMLElement>()
const flowCanvas = ref<HTMLElement>()
const networkCanvas = ref<HTMLElement>()

// Reactive state
const selectedTimeRange = ref('24h')
const viewMode = ref<'flow' | 'network'>('flow')
const networkZoom = ref(1)
const isLoading = ref(false)
const isExporting = ref(false)
const selectedNode = ref<any>(null)

// Flow data
const flowData = ref({
  nodes: [
    { id: 'queue', name: 'Call Queue', type: 'queue', x: 100, y: 200, callCount: 1250, avgDuration: '2:30', connections: 5, efficiency: 85 },
    { id: 'agent1', name: 'Agent Sarah', type: 'agent', x: 300, y: 150, callCount: 89, avgDuration: '8:45', connections: 3, efficiency: 92 },
    { id: 'agent2', name: 'Agent David', type: 'agent', x: 300, y: 250, callCount: 76, avgDuration: '7:20', connections: 4, efficiency: 88 },
    { id: 'supervisor', name: 'Supervisor', type: 'supervisor', x: 500, y: 200, callCount: 23, avgDuration: '12:15', connections: 2, efficiency: 95 },
    { id: 'voicemail', name: 'Voicemail', type: 'system', x: 300, y: 350, callCount: 45, avgDuration: '0:00', connections: 1, efficiency: 100 }
  ],
  links: [
    { source: 'queue', target: 'agent1', value: 89, type: 'routing' },
    { source: 'queue', target: 'agent2', value: 76, type: 'routing' },
    { source: 'agent1', target: 'supervisor', value: 12, type: 'escalation' },
    { source: 'agent2', target: 'supervisor', value: 11, type: 'escalation' },
    { source: 'queue', target: 'voicemail', value: 45, type: 'overflow' }
  ]
})

// Flow statistics
const flowStats = ref({
  totalCalls: 1250,
  transfers: 23,
  escalations: 23,
  avgDuration: '6:45'
})

// Computed properties
const isDark = computed(() => appStore.isDark)

// D3 visualization instances
let flowVisualization: any = null
let networkVisualization: any = null

// Methods
const initializeFlowView = () => {
  if (!flowCanvas.value) return

  const container = d3.select(flowCanvas.value)
  container.selectAll('*').remove()

  const width = flowCanvas.value.clientWidth
  const height = 400

  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)

  // Create links
  const links = svg.selectAll('.link')
    .data(flowData.value.links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('x1', (d: any) => {
      const sourceNode = flowData.value.nodes.find(n => n.id === d.source)
      return sourceNode ? sourceNode.x : 0
    })
    .attr('y1', (d: any) => {
      const sourceNode = flowData.value.nodes.find(n => n.id === d.source)
      return sourceNode ? sourceNode.y : 0
    })
    .attr('x2', (d: any) => {
      const targetNode = flowData.value.nodes.find(n => n.id === d.target)
      return targetNode ? targetNode.x : 0
    })
    .attr('y2', (d: any) => {
      const targetNode = flowData.value.nodes.find(n => n.id === d.target)
      return targetNode ? targetNode.y : 0
    })
    .attr('stroke', (d: any) => {
      const colors = {
        routing: '#409eff',
        escalation: '#f56c6c',
        overflow: '#e6a23c',
        transfer: '#67c23a'
      }
      return colors[d.type as keyof typeof colors] || '#909399'
    })
    .attr('stroke-width', (d: any) => Math.max(1, d.value / 20))
    .attr('stroke-opacity', 0.7)

  // Create nodes
  const nodes = svg.selectAll('.node')
    .data(flowData.value.nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', (d: any) => `translate(${d.x}, ${d.y})`)
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      selectedNode.value = d
      emit('nodeClick', d)
    })

  // Node circles
  nodes.append('circle')
    .attr('r', (d: any) => Math.max(15, Math.sqrt(d.callCount) * 2))
    .attr('fill', (d: any) => {
      const colors = {
        queue: '#409eff',
        agent: '#67c23a',
        supervisor: '#f56c6c',
        system: '#909399'
      }
      return colors[d.type as keyof typeof colors] || '#909399'
    })
    .attr('stroke', isDark.value ? '#374151' : '#ffffff')
    .attr('stroke-width', 2)

  // Node labels
  nodes.append('text')
    .text((d: any) => d.name)
    .attr('text-anchor', 'middle')
    .attr('dy', -25)
    .attr('font-size', '12px')
    .attr('font-weight', '600')
    .attr('fill', isDark.value ? '#f3f4f6' : '#374151')

  // Call count labels
  nodes.append('text')
    .text((d: any) => d.callCount)
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('font-size', '10px')
    .attr('font-weight', '500')
    .attr('fill', '#ffffff')

  flowVisualization = { svg, nodes, links }
}

const initializeNetworkView = () => {
  if (!networkCanvas.value) return

  const container = d3.select(networkCanvas.value)
  container.selectAll('*').remove()

  const width = networkCanvas.value.clientWidth
  const height = 400

  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)

  // Create force simulation
  const simulation = d3.forceSimulation(flowData.value.nodes)
    .force('link', d3.forceLink(flowData.value.links).id((d: any) => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))

  // Create links
  const links = svg.selectAll('.link')
    .data(flowData.value.links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke', '#999')
    .attr('stroke-width', (d: any) => Math.max(1, d.value / 20))
    .attr('stroke-opacity', 0.6)

  // Create nodes
  const nodes = svg.selectAll('.node')
    .data(flowData.value.nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d: any) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })
    )
    .on('click', (event, d) => {
      selectedNode.value = d
      emit('nodeClick', d)
    })

  // Node circles
  nodes.append('circle')
    .attr('r', (d: any) => Math.max(15, Math.sqrt(d.callCount) * 2))
    .attr('fill', (d: any) => {
      const colors = {
        queue: '#409eff',
        agent: '#67c23a',
        supervisor: '#f56c6c',
        system: '#909399'
      }
      return colors[d.type as keyof typeof colors] || '#909399'
    })
    .attr('stroke', isDark.value ? '#374151' : '#ffffff')
    .attr('stroke-width', 2)

  // Node labels
  nodes.append('text')
    .text((d: any) => d.name)
    .attr('text-anchor', 'middle')
    .attr('dy', -20)
    .attr('font-size', '12px')
    .attr('font-weight', '600')
    .attr('fill', isDark.value ? '#f3f4f6' : '#374151')

  // Update positions on simulation tick
  simulation.on('tick', () => {
    links
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y)

    nodes
      .attr('transform', (d: any) => `translate(${d.x}, ${d.y})`)
  })

  networkVisualization = { svg, nodes, links, simulation }
}

const handleTimeRangeChange = (range: string) => {
  selectedTimeRange.value = range
  loadFlowData()
}

const handleZoomChange = (zoom: number) => {
  networkZoom.value = zoom
  if (networkVisualization) {
    networkVisualization.svg
      .transition()
      .duration(300)
      .attr('transform', `scale(${zoom})`)
  }
}

const loadFlowData = async () => {
  isLoading.value = true
  
  try {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Update flow statistics based on time range
    const multiplier = selectedTimeRange.value === '1h' ? 0.1 : 
                      selectedTimeRange.value === '6h' ? 0.5 : 
                      selectedTimeRange.value === '24h' ? 1 : 7
    
    flowStats.value = {
      totalCalls: Math.round(1250 * multiplier),
      transfers: Math.round(23 * multiplier),
      escalations: Math.round(23 * multiplier),
      avgDuration: '6:45'
    }
    
    // Re-render visualizations
    if (viewMode.value === 'flow') {
      initializeFlowView()
    } else {
      initializeNetworkView()
    }
    
  } catch (error) {
    console.error('Error loading flow data:', error)
    ElMessage.error(t('analytics.loadFlowError', 'Failed to load conversation flow data'))
  } finally {
    isLoading.value = false
  }
}

const exportFlow = async () => {
  isExporting.value = true
  
  try {
    // Simulate export process
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    ElMessage.success(t('analytics.exportSuccess', 'Flow data exported successfully'))
    
  } catch (error) {
    console.error('Error exporting flow:', error)
    ElMessage.error(t('analytics.exportError', 'Failed to export flow data'))
  } finally {
    isExporting.value = false
  }
}

// Watchers
watch(viewMode, (newMode) => {
  nextTick(() => {
    if (newMode === 'flow') {
      initializeFlowView()
    } else {
      initializeNetworkView()
    }
  })
})

watch(() => props.dateRange, () => {
  loadFlowData()
}, { deep: true })

watch(isDark, () => {
  if (viewMode.value === 'flow') {
    initializeFlowView()
  } else {
    initializeNetworkView()
  }
})

// Lifecycle
onMounted(() => {
  loadFlowData()
  
  // Setup refresh interval
  if (props.refreshInterval) {
    const interval = setInterval(() => {
      loadFlowData()
    }, props.refreshInterval)
    
    onUnmounted(() => {
      clearInterval(interval)
    })
  }
})

onUnmounted(() => {
  if (flowVisualization) {
    flowVisualization.svg.remove()
  }
  if (networkVisualization) {
    networkVisualization.simulation.stop()
    networkVisualization.svg.remove()
  }
})
</script>

<style lang="scss" scoped>
.conversation-flow-chart {
  position: relative;
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);

  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .chart-title {
      h3 {
        margin: 0 0 8px 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }

      .chart-description {
        margin: 0;
        font-size: 14px;
        color: var(--el-text-color-secondary);
      }
    }

    .chart-controls {
      display: flex;
      align-items: center;
      gap: 12px;

      .view-mode-buttons {
        .el-button {
          padding: 8px 12px;
        }
      }
    }
  }

  .chart-container {
    position: relative;
    height: 400px;
    background: var(--el-fill-color-extra-light);
    border-radius: 6px;
    overflow: hidden;

    .flow-view,
    .network-view {
      position: relative;
      height: 100%;
    }

    .flow-canvas,
    .network-canvas {
      width: 100%;
      height: 100%;
    }

    .flow-legend {
      position: absolute;
      top: 16px;
      right: 16px;
      background: var(--el-bg-color);
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      padding: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

      .legend-item {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        &:last-child {
          margin-bottom: 0;
        }

        .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 2px;

          &.inbound {
            background-color: #409eff;
          }

          &.outbound {
            background-color: #67c23a;
          }

          &.transfer {
            background-color: #e6a23c;
          }

          &.escalation {
            background-color: #f56c6c;
          }
        }

        span {
          font-size: 12px;
          color: var(--el-text-color-primary);
        }
      }
    }

    .network-controls {
      position: absolute;
      bottom: 16px;
      left: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--el-bg-color);
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      padding: 8px 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

      .el-slider {
        width: 100px;
      }

      .zoom-label {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        min-width: 40px;
      }
    }
  }

  .flow-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-top: 24px;

    .stat-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: var(--el-fill-color-extra-light);
      border-radius: 6px;
      border: 1px solid var(--el-border-color-lighter);

      .stat-icon {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--el-color-primary-light-9);
        display: flex;
        align-items: center;
        justify-content: center;

        .el-icon {
          font-size: 18px;
          color: var(--el-color-primary);
        }
      }

      .stat-content {
        .stat-value {
          font-size: 20px;
          font-weight: 600;
          color: var(--el-text-color-primary);
          margin-bottom: 4px;
        }

        .stat-label {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
      }
    }
  }

  .node-details-panel {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 280px;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color-light);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    z-index: 100;

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid var(--el-border-color-lighter);

      h4 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }
    }

    .panel-content {
      padding: 16px;

      .detail-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;

        &:last-child {
          margin-bottom: 0;
        }

        .detail-label {
          font-size: 13px;
          color: var(--el-text-color-secondary);
          font-weight: 500;
        }

        .detail-value {
          font-size: 13px;
          color: var(--el-text-color-primary);
          font-weight: 600;
        }
      }
    }
  }

  .loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.9);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;

    .loading-icon {
      font-size: 32px;
      color: var(--el-color-primary);
      margin-bottom: 12px;
      animation: spin 1s linear infinite;
    }

    p {
      font-size: 14px;
      color: var(--el-text-color-secondary);
      margin: 0;
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .conversation-flow-chart {
    padding: 16px;

    .chart-header {
      flex-direction: column;
      gap: 16px;
      align-items: stretch;

      .chart-controls {
        flex-wrap: wrap;
        gap: 8px;
      }
    }

    .chart-container {
      height: 300px;
    }

    .flow-stats {
      grid-template-columns: 1fr;
    }

    .node-details-panel {
      position: static;
      width: 100%;
      margin-top: 16px;
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .conversation-flow-chart {
    .chart-header {
      flex-direction: row-reverse;
    }

    .flow-legend {
      right: auto;
      left: 16px;
    }

    .network-controls {
      left: auto;
      right: 16px;
    }

    .node-details-panel {
      right: auto;
      left: 16px;
    }
  }
}

// Dark mode adjustments
// Dark mode adjustments handled by CSS variables

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>