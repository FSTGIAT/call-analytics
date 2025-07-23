<template>
  <div class="call-details-panel">
    <!-- Call Header -->
    <div class="call-header">
      <div class="call-basic-info">
        <div class="call-id-section">
          <h3 class="call-id">{{ call.callId }}</h3>
          <el-tag 
            :type="getStatusType(call.status)" 
            size="large"
            effect="light"
          >
            {{ $t(`calls.status.${call.status}`) }}
          </el-tag>
        </div>
        <div class="call-metadata">
          <div class="metadata-item">
            <el-icon><User /></el-icon>
            <span class="label">{{ $t('calls.subscriberId') }}:</span>
            <span class="value">{{ call.subscriberId }}</span>
          </div>
          <div class="metadata-item" v-if="call.agentName">
            <el-icon><UserFilled /></el-icon>
            <span class="label">{{ $t('calls.agent') }}:</span>
            <span class="value">{{ call.agentName }}</span>
          </div>
          <div class="metadata-item">
            <el-icon><Clock /></el-icon>
            <span class="label">{{ $t('calls.duration') }}:</span>
            <span class="value duration" :class="getDurationClass(call.duration)">
              {{ formatDuration(call.duration) }}
            </span>
          </div>
          <div class="metadata-item" v-if="call.startTime">
            <el-icon><Calendar /></el-icon>
            <span class="label">{{ $t('calls.startTime', 'Start Time') }}:</span>
            <span class="value">{{ formatDateTime(call.startTime) }}</span>
          </div>
        </div>
      </div>
      
      <div class="call-actions">
        <el-button-group>
          <el-tooltip :content="$t('calls.listen')" placement="top">
            <el-button @click="$emit('listen', call)">
              <el-icon><Microphone /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="$t('calls.downloadRecording')" placement="top">
            <el-button @click="downloadRecording">
              <el-icon><Download /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="$t('common.export')" placement="top">
            <el-button @click="exportCall">
              <el-icon><Share /></el-icon>
            </el-button>
          </el-tooltip>
        </el-button-group>
      </div>
    </div>

    <!-- Real-time Updates -->
    <div v-if="realTime" class="real-time-section">
      <el-alert
        :title="$t('calls.realTimeMode', 'Real-time Mode')"
        type="info"
        :closable="false"
        show-icon
      >
        <template #default>
          {{ $t('calls.realTimeModeDesc', 'This call is being monitored in real-time. Data updates automatically.') }}
        </template>
      </el-alert>
    </div>

    <!-- Call Content Tabs -->
    <div class="call-content">
      <el-tabs v-model="activeTab" type="border-card">
        <!-- Live Transcription -->
        <el-tab-pane :label="$t('calls.transcription')" name="transcription">
          <div class="transcription-panel">
            <div class="transcription-header">
              <div class="header-left">
                <h4>{{ $t('calls.liveTranscription', 'Live Transcription') }}</h4>
                <el-tag v-if="realTime" type="success" size="small" effect="plain">
                  <el-icon class="pulse"><VideoPlay /></el-icon>
                  {{ $t('common.live') }}
                </el-tag>
              </div>
              <div class="header-right">
                <el-select v-model="transcriptionLanguage" size="small" style="width: 120px;">
                  <el-option value="he" label="עברית" />
                  <el-option value="en" label="English" />
                  <el-option value="auto" :label="$t('common.auto')" />
                </el-select>
                <el-button type="text" size="small" @click="copyTranscription">
                  <el-icon><CopyDocument /></el-icon>
                  {{ $t('common.copy') }}
                </el-button>
              </div>
            </div>
            
            <div class="transcription-content">
              <el-scrollbar height="400px">
                <div class="transcription-text" :dir="transcriptionLanguage === 'he' ? 'rtl' : 'ltr'">
                  <div 
                    v-for="(segment, index) in transcriptionSegments" 
                    :key="index"
                    class="transcription-segment"
                    :class="{ 'current': realTime && index === currentSegment }"
                  >
                    <div class="segment-header">
                      <span class="speaker">{{ segment.speaker }}</span>
                      <span class="timestamp">{{ formatTime(segment.timestamp) }}</span>
                      <el-tag 
                        v-if="segment.confidence" 
                        :type="getConfidenceType(segment.confidence)" 
                        size="small"
                        effect="plain"
                      >
                        {{ Math.round(segment.confidence * 100) }}%
                      </el-tag>
                    </div>
                    <div class="segment-text">{{ segment.text }}</div>
                  </div>
                  
                  <!-- Live typing indicator -->
                  <div v-if="realTime && isTyping" class="typing-indicator">
                    <el-icon class="is-loading"><Loading /></el-icon>
                    <span>{{ $t('calls.transcribing', 'Transcribing...') }}</span>
                  </div>
                </div>
              </el-scrollbar>
            </div>
          </div>
        </el-tab-pane>

        <!-- Sentiment Analysis -->
        <el-tab-pane :label="$t('calls.sentiment')" name="sentiment">
          <div class="sentiment-panel">
            <div class="sentiment-overview">
              <div class="sentiment-summary">
                <div class="current-sentiment">
                  <div class="sentiment-icon">
                    <el-icon :class="getSentimentClass(currentSentiment)">
                      <component :is="getSentimentIcon(currentSentiment)" />
                    </el-icon>
                  </div>
                  <div class="sentiment-info">
                    <div class="sentiment-label">{{ $t('calls.currentSentiment', 'Current Sentiment') }}</div>
                    <div class="sentiment-value">{{ $t(`calls.${currentSentiment}`) }}</div>
                    <div class="sentiment-confidence">
                      {{ $t('calls.confidence', 'Confidence') }}: {{ Math.round(sentimentConfidence * 100) }}%
                    </div>
                  </div>
                </div>
                
                <div class="sentiment-trend">
                  <h5>{{ $t('calls.sentimentTrend', 'Sentiment Trend') }}</h5>
                  <div class="trend-chart" ref="sentimentChartRef">
                    <!-- Chart would be rendered here -->
                    <div class="mock-chart">
                      <div 
                        v-for="(point, index) in sentimentTrendData" 
                        :key="index"
                        class="trend-point"
                        :class="point.sentiment"
                        :style="{ left: `${(index / sentimentTrendData.length) * 100}%` }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div class="sentiment-breakdown">
                <h5>{{ $t('calls.sentimentBreakdown', 'Sentiment Breakdown') }}</h5>
                <div class="sentiment-stats">
                  <div class="stat-item positive">
                    <el-icon><CircleCheck /></el-icon>
                    <span class="label">{{ $t('calls.positive') }}</span>
                    <span class="value">{{ sentimentBreakdown.positive }}%</span>
                  </div>
                  <div class="stat-item neutral">
                    <el-icon><Remove /></el-icon>
                    <span class="label">{{ $t('calls.neutral') }}</span>
                    <span class="value">{{ sentimentBreakdown.neutral }}%</span>
                  </div>
                  <div class="stat-item negative">
                    <el-icon><CircleClose /></el-icon>
                    <span class="label">{{ $t('calls.negative') }}</span>
                    <span class="value">{{ sentimentBreakdown.negative }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- AI Insights -->
        <el-tab-pane :label="$t('calls.insights', 'AI Insights')" name="insights">
          <div class="insights-panel">
            <div class="insights-grid">
              <!-- Summary -->
              <el-card class="insight-card">
                <template #header>
                  <div class="card-header">
                    <el-icon><Document /></el-icon>
                    <span>{{ $t('calls.summary') }}</span>
                  </div>
                </template>
                <div class="insight-content">
                  <p class="summary-text">{{ aiInsights.summary }}</p>
                  <div class="summary-tags">
                    <el-tag 
                      v-for="tag in aiInsights.tags" 
                      :key="tag"
                      size="small"
                      effect="plain"
                    >
                      {{ tag }}
                    </el-tag>
                  </div>
                </div>
              </el-card>

              <!-- Key Points -->
              <el-card class="insight-card">
                <template #header>
                  <div class="card-header">
                    <el-icon><Key /></el-icon>
                    <span>{{ $t('calls.keyPoints') }}</span>
                  </div>
                </template>
                <div class="insight-content">
                  <ul class="key-points-list">
                    <li v-for="point in aiInsights.keyPoints" :key="point">
                      {{ point }}
                    </li>
                  </ul>
                </div>
              </el-card>

              <!-- Products Mentioned -->
              <el-card class="insight-card">
                <template #header>
                  <div class="card-header">
                    <el-icon><Box /></el-icon>
                    <span>{{ $t('calls.products') }}</span>
                  </div>
                </template>
                <div class="insight-content">
                  <div class="products-list">
                    <div 
                      v-for="product in aiInsights.products" 
                      :key="product.name"
                      class="product-item"
                    >
                      <span class="product-name">{{ product.name }}</span>
                      <el-tag size="small">{{ product.mentions }}x</el-tag>
                    </div>
                  </div>
                </div>
              </el-card>

              <!-- Resolution Status -->
              <el-card class="insight-card">
                <template #header>
                  <div class="card-header">
                    <el-icon><CircleCheck /></el-icon>
                    <span>{{ $t('calls.resolution') }}</span>
                  </div>
                </template>
                <div class="insight-content">
                  <div class="resolution-status">
                    <div class="status-indicator" :class="aiInsights.resolution.status">
                      <el-icon>
                        <CircleCheck v-if="aiInsights.resolution.status === 'resolved'" />
                        <Clock v-else-if="aiInsights.resolution.status === 'pending'" />
                        <Warning v-else />
                      </el-icon>
                      <span>{{ $t(`calls.${aiInsights.resolution.status}`) }}</span>
                    </div>
                    <p class="resolution-note">{{ aiInsights.resolution.note }}</p>
                  </div>
                </div>
              </el-card>
            </div>
          </div>
        </el-tab-pane>

        <!-- Actions -->
        <el-tab-pane :label="$t('calls.actions', 'Actions')" name="actions">
          <div class="actions-panel">
            <div class="actions-grid">
              <el-card>
                <template #header>
                  <span>{{ $t('calls.quickActions', 'Quick Actions') }}</span>
                </template>
                <div class="quick-actions">
                  <el-button type="primary" @click="escalateCall">
                    <el-icon><Top /></el-icon>
                    {{ $t('calls.escalate', 'Escalate') }}
                  </el-button>
                  <el-button @click="transferCall">
                    <el-icon><Switch /></el-icon>
                    {{ $t('calls.transfer', 'Transfer') }}
                  </el-button>
                  <el-button @click="addNote">
                    <el-icon><EditPen /></el-icon>
                    {{ $t('calls.addNote', 'Add Note') }}
                  </el-button>
                  <el-button @click="scheduleFollowUp">
                    <el-icon><Calendar /></el-icon>
                    {{ $t('calls.scheduleFollowUp', 'Schedule Follow-up') }}
                  </el-button>
                </div>
              </el-card>
              
              <el-card>
                <template #header>
                  <span>{{ $t('calls.callHistory', 'Call History') }}</span>
                </template>
                <div class="call-history">
                  <div 
                    v-for="event in callHistory" 
                    :key="event.id"
                    class="history-item"
                  >
                    <div class="event-time">{{ formatTime(event.timestamp) }}</div>
                    <div class="event-description">{{ event.description }}</div>
                  </div>
                </div>
              </el-card>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  User,
  UserFilled,
  Clock,
  Calendar,
  Microphone,
  Download,
  Share,
  VideoPlay,
  CopyDocument,
  Loading,
  Document,
  Key,
  Box,
  CircleCheck,
  Warning,
  Top,
  Switch,
  EditPen,
  CircleCheck,
  CircleClose,
  Remove
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const { t } = useI18n()

// Props
interface CallData {
  callId: string
  subscriberId: string
  agentName?: string
  duration: number
  status: string
  startTime?: Date
  transcription?: string
  sentiment?: string
  [key: string]: any
}

const props = defineProps<{
  call: CallData
  realTime?: boolean
}>()

// Emits
const emit = defineEmits(['close', 'listen', 'escalate', 'transfer'])

// Reactive state
const activeTab = ref('transcription')
const transcriptionLanguage = ref('auto')
const currentSegment = ref(0)
const isTyping = ref(false)
const currentSentiment = ref(props.call.sentiment || 'neutral')
const sentimentConfidence = ref(0.85)

// Mock data
const transcriptionSegments = ref([
  {
    speaker: 'Customer',
    timestamp: new Date(Date.now() - 300000),
    text: 'שלום, אני צריך עזרה עם החשבון שלי',
    confidence: 0.95
  },
  {
    speaker: 'Agent',
    timestamp: new Date(Date.now() - 280000),
    text: 'שלום! אשמח לעזור לך. מה הבעיה?',
    confidence: 0.92
  },
  {
    speaker: 'Customer',
    timestamp: new Date(Date.now() - 260000),
    text: 'לא מצליח להתחבר למערכת',
    confidence: 0.88
  }
])

const sentimentBreakdown = ref({
  positive: 35,
  neutral: 45,
  negative: 20
})

const sentimentTrendData = ref([
  { sentiment: 'neutral', value: 0.5 },
  { sentiment: 'positive', value: 0.7 },
  { sentiment: 'neutral', value: 0.6 },
  { sentiment: 'negative', value: 0.3 },
  { sentiment: 'positive', value: 0.8 }
])

const aiInsights = ref({
  summary: 'לקוח מתקשה להתחבר למערכת. הנציג מספק פתרון שלב אחר שלב.',
  tags: ['Technical Support', 'Login Issue', 'Account Access'],
  keyPoints: [
    'לקוח לא מצליח להתחבר למערכת',
    'בעיה עם איפוס סיסמה',
    'נציג מדריך שלב אחר שלב',
    'פתרון נמצא בהצלחה'
  ],
  products: [
    { name: 'Online Portal', mentions: 3 },
    { name: 'Mobile App', mentions: 1 }
  ],
  resolution: {
    status: 'resolved',
    note: 'הבעיה נפתרה באמצעות איפוס סיסמה'
  }
})

const callHistory = ref([
  {
    id: 1,
    timestamp: new Date(Date.now() - 300000),
    description: 'Call started'
  },
  {
    id: 2,
    timestamp: new Date(Date.now() - 250000),
    description: 'Customer authentication completed'
  },
  {
    id: 3,
    timestamp: new Date(Date.now() - 200000),
    description: 'Issue identified: Login problem'
  }
])

// Computed properties and methods
const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const formatDateTime = (date: Date): string => {
  return dayjs(date).format('DD/MM/YYYY HH:mm:ss')
}

const formatTime = (date: Date): string => {
  return dayjs(date).format('HH:mm:ss')
}

const getDurationClass = (duration: number): string => {
  if (duration > 1800) return 'long-duration'
  if (duration > 900) return 'medium-duration'
  return 'normal-duration'
}

const getStatusType = (status: string) => {
  switch (status) {
    case 'connected':
      return 'success'
    case 'ringing':
      return 'warning'
    case 'hold':
      return 'info'
    case 'urgent':
      return 'danger'
    default:
      return ''
  }
}

const getSentimentClass = (sentiment: string): string => {
  switch (sentiment) {
    case 'positive':
      return 'sentiment-positive'
    case 'negative':
      return 'sentiment-negative'
    case 'neutral':
      return 'sentiment-neutral'
    default:
      return ''
  }
}

const getSentimentIcon = (sentiment: string) => {
  switch (sentiment) {
    case 'positive':
      return CircleCheck
    case 'negative':
      return CircleClose
    case 'neutral':
      return Remove
    default:
      return Remove
  }
}

const getConfidenceType = (confidence: number) => {
  if (confidence > 0.9) return 'success'
  if (confidence > 0.7) return 'warning'
  return 'danger'
}

// Actions
const copyTranscription = async () => {
  const text = transcriptionSegments.value
    .map(segment => `${segment.speaker}: ${segment.text}`)
    .join('\n')
  
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('common.copied', 'Copied to clipboard'))
  } catch (error) {
    ElMessage.error(t('common.copyError', 'Failed to copy'))
  }
}

const downloadRecording = () => {
  ElMessage.info(t('calls.downloadStarted', 'Download started'))
}

const exportCall = () => {
  ElMessage.info(t('calls.exportStarted', 'Export started'))
}

const escalateCall = () => {
  emit('escalate', props.call)
}

const transferCall = () => {
  emit('transfer', props.call)
}

const addNote = async () => {
  try {
    const { value } = await ElMessageBox.prompt(
      t('calls.addNotePrompt', 'Enter your note:'),
      t('calls.addNote'),
      {
        confirmButtonText: t('common.save'),
        cancelButtonText: t('common.cancel'),
        inputType: 'textarea'
      }
    )
    
    if (value) {
      ElMessage.success(t('calls.noteSaved', 'Note saved'))
      // Add to call history
      callHistory.value.push({
        id: Date.now(),
        timestamp: new Date(),
        description: `Note added: ${value.substring(0, 50)}...`
      })
    }
  } catch (error) {
    // User cancelled
  }
}

const scheduleFollowUp = () => {
  ElMessage.info(t('calls.followUpScheduled', 'Follow-up scheduled'))
}

// Real-time simulation
const simulateRealTimeUpdates = () => {
  if (!props.realTime) return
  
  setInterval(() => {
    // Simulate typing
    isTyping.value = Math.random() > 0.8
    
    // Simulate new transcription segment
    if (Math.random() > 0.9) {
      const speakers = ['Customer', 'Agent']
      transcriptionSegments.value.push({
        speaker: speakers[Math.floor(Math.random() * speakers.length)],
        timestamp: new Date(),
        text: 'Real-time transcription update...',
        confidence: 0.7 + Math.random() * 0.3
      })
      currentSegment.value = transcriptionSegments.value.length - 1
    }
    
    // Update sentiment
    if (Math.random() > 0.95) {
      const sentiments = ['positive', 'negative', 'neutral']
      currentSentiment.value = sentiments[Math.floor(Math.random() * sentiments.length)]
      sentimentConfidence.value = 0.6 + Math.random() * 0.4
    }
  }, 3000)
}

// Lifecycle
onMounted(() => {
  if (props.realTime) {
    simulateRealTimeUpdates()
  }
})
</script>

<style lang="scss" scoped>
.call-details-panel {
  .call-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--el-border-color-light);
    margin-bottom: 20px;
    
    .call-basic-info {
      flex: 1;
      
      .call-id-section {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 16px;
        
        .call-id {
          font-size: 24px;
          font-weight: 600;
          color: var(--el-color-primary);
          margin: 0;
        }
      }
      
      .call-metadata {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        
        .metadata-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          
          .el-icon {
            color: var(--el-text-color-secondary);
          }
          
          .label {
            color: var(--el-text-color-secondary);
            font-weight: 500;
          }
          
          .value {
            color: var(--el-text-color-primary);
            
            &.duration {
              font-family: $font-family-monospace;
              font-weight: 600;
              
              &.long-duration {
                color: var(--el-color-danger);
              }
              
              &.medium-duration {
                color: var(--el-color-warning);
              }
              
              &.normal-duration {
                color: var(--el-color-success);
              }
            }
          }
        }
      }
    }
  }
  
  .real-time-section {
    margin-bottom: 20px;
  }
  
  .call-content {
    .transcription-panel {
      .transcription-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        
        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          
          h4 {
            margin: 0;
            color: var(--el-text-color-primary);
          }
        }
        
        .header-right {
          display: flex;
          gap: 8px;
          align-items: center;
        }
      }
      
      .transcription-content {
        .transcription-text {
          .transcription-segment {
            padding: 12px;
            border-left: 3px solid transparent;
            margin-bottom: 8px;
            border-radius: 4px;
            transition: all 0.3s ease;
            
            &.current {
              border-left-color: var(--el-color-primary);
              background-color: var(--el-color-primary-light-9);
            }
            
            .segment-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
              
              .speaker {
                font-weight: 600;
                color: var(--el-color-primary);
              }
              
              .timestamp {
                font-size: 12px;
                color: var(--el-text-color-secondary);
                font-family: $font-family-monospace;
              }
            }
            
            .segment-text {
              color: var(--el-text-color-primary);
              line-height: 1.6;
            }
          }
          
          .typing-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px;
            color: var(--el-text-color-secondary);
            font-style: italic;
          }
        }
      }
    }
    
    .sentiment-panel {
      .sentiment-overview {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        margin-bottom: 24px;
        
        .sentiment-summary {
          .current-sentiment {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 24px;
            
            .sentiment-icon {
              width: 48px;
              height: 48px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              
              .el-icon {
                font-size: 24px;
                
                &.sentiment-positive {
                  color: var(--el-color-success);
                }
                
                &.sentiment-negative {
                  color: var(--el-color-danger);
                }
                
                &.sentiment-neutral {
                  color: var(--el-color-info);
                }
              }
            }
            
            .sentiment-info {
              .sentiment-label {
                font-size: 12px;
                color: var(--el-text-color-secondary);
                margin-bottom: 4px;
              }
              
              .sentiment-value {
                font-size: 18px;
                font-weight: 600;
                color: var(--el-text-color-primary);
                margin-bottom: 4px;
              }
              
              .sentiment-confidence {
                font-size: 12px;
                color: var(--el-text-color-secondary);
              }
            }
          }
          
          .sentiment-trend {
            h5 {
              margin-bottom: 12px;
              color: var(--el-text-color-primary);
            }
            
            .trend-chart {
              height: 60px;
              position: relative;
              background-color: var(--el-fill-color-lighter);
              border-radius: 4px;
              
              .mock-chart {
                position: relative;
                height: 100%;
                
                .trend-point {
                  position: absolute;
                  top: 50%;
                  width: 8px;
                  height: 8px;
                  border-radius: 50%;
                  transform: translateY(-50%);
                  
                  &.positive {
                    background-color: var(--el-color-success);
                  }
                  
                  &.negative {
                    background-color: var(--el-color-danger);
                  }
                  
                  &.neutral {
                    background-color: var(--el-color-info);
                  }
                }
              }
            }
          }
        }
        
        .sentiment-breakdown {
          h5 {
            margin-bottom: 16px;
            color: var(--el-text-color-primary);
          }
          
          .sentiment-stats {
            .stat-item {
              display: flex;
              align-items: center;
              gap: 12px;
              margin-bottom: 12px;
              
              .el-icon {
                font-size: 20px;
              }
              
              .label {
                flex: 1;
                color: var(--el-text-color-primary);
              }
              
              .value {
                font-weight: 600;
                color: var(--el-text-color-primary);
              }
              
              &.positive .el-icon {
                color: var(--el-color-success);
              }
              
              &.negative .el-icon {
                color: var(--el-color-danger);
              }
              
              &.neutral .el-icon {
                color: var(--el-color-info);
              }
            }
          }
        }
      }
    }
    
    .insights-panel {
      .insights-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
        
        .insight-card {
          .card-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            color: var(--el-text-color-primary);
          }
          
          .insight-content {
            .summary-text {
              margin-bottom: 12px;
              line-height: 1.6;
              color: var(--el-text-color-primary);
            }
            
            .summary-tags {
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
            }
            
            .key-points-list {
              margin: 0;
              padding-left: 20px;
              
              li {
                margin-bottom: 8px;
                color: var(--el-text-color-primary);
                line-height: 1.5;
              }
            }
            
            .products-list {
              .product-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid var(--el-border-color-lighter);
                
                &:last-child {
                  border-bottom: none;
                }
                
                .product-name {
                  color: var(--el-text-color-primary);
                }
              }
            }
            
            .resolution-status {
              .status-indicator {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
                
                &.resolved {
                  color: var(--el-color-success);
                }
                
                &.pending {
                  color: var(--el-color-warning);
                }
                
                &.unresolved {
                  color: var(--el-color-danger);
                }
              }
              
              .resolution-note {
                margin: 0;
                color: var(--el-text-color-secondary);
                font-size: 14px;
                line-height: 1.5;
              }
            }
          }
        }
      }
    }
    
    .actions-panel {
      .actions-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        
        .quick-actions {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
        }
        
        .call-history {
          max-height: 300px;
          overflow-y: auto;
          
          .history-item {
            padding: 8px 0;
            border-bottom: 1px solid var(--el-border-color-lighter);
            
            &:last-child {
              border-bottom: none;
            }
            
            .event-time {
              font-size: 12px;
              color: var(--el-text-color-secondary);
              font-family: $font-family-monospace;
              margin-bottom: 4px;
            }
            
            .event-description {
              color: var(--el-text-color-primary);
              font-size: 14px;
            }
          }
        }
      }
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .call-details-panel {
    .call-header {
      flex-direction: column;
      gap: 16px;
    }
    
    .call-metadata {
      grid-template-columns: 1fr !important;
    }
    
    .sentiment-overview {
      grid-template-columns: 1fr !important;
    }
    
    .insights-grid {
      grid-template-columns: 1fr !important;
    }
    
    .actions-grid {
      grid-template-columns: 1fr !important;
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .call-details-panel {
    .transcription-segment {
      border-left: none;
      border-right: 3px solid transparent;
      
      &.current {
        border-right-color: var(--el-color-primary);
      }
    }
    
    .key-points-list {
      padding-left: 0;
      padding-right: 20px;
    }
  }
}

// Animations
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.pulse {
  animation: pulse 2s infinite;
}
</style>