<template>
  <div class="search-result-item">
    <el-card class="result-card" :class="getResultCardClass(result)">
      <!-- Result Header -->
      <div class="result-header">
        <div class="result-basic-info">
          <div class="call-id-section">
            <el-link 
              type="primary" 
              @click="$emit('viewDetails', result)"
              :underline="false"
              class="call-id-link"
            >
              {{ result.callId }}
            </el-link>
            <el-tag 
              :type="getCallTypeType(result.callType)" 
              size="small"
              effect="light"
            >
              {{ $t(`calls.${result.callType}`) }}
            </el-tag>
            <el-tag 
              :type="getSentimentType(result.sentiment)" 
              size="small"
              effect="plain"
            >
              <el-icon>
                <component :is="getSentimentIcon(result.sentiment)" />
              </el-icon>
              {{ $t(`calls.${result.sentiment}`) }}
            </el-tag>
          </div>
          
          <div class="result-metadata">
            <div class="metadata-row">
              <div class="metadata-item">
                <el-icon><User /></el-icon>
                <span>{{ result.subscriberId }}</span>
              </div>
              <div class="metadata-item">
                <el-icon><UserFilled /></el-icon>
                <span>{{ result.agent.name }}</span>
              </div>
              <div class="metadata-item">
                <el-icon><Calendar /></el-icon>
                <span>{{ formatDateTime(result.callDate) }}</span>
              </div>
              <div class="metadata-item">
                <el-icon><Timer /></el-icon>
                <span>{{ formatDuration(result.duration) }}</span>
              </div>
              <div class="metadata-item" v-if="result.language">
                <el-icon><ChatDotRound /></el-icon>
                <span>{{ result.language.toUpperCase() }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="result-actions">
          <div class="relevance-score">
            <span class="score-label">{{ $t('search.relevance') }}</span>
            <el-progress 
              :percentage="Math.round(result.relevanceScore * 100)" 
              :stroke-width="6"
              :show-text="false"
              :color="getRelevanceColor(result.relevanceScore)"
            />
            <span class="score-value">{{ Math.round(result.relevanceScore * 100) }}%</span>
          </div>
          
          <el-button-group size="small">
            <el-tooltip :content="$t('calls.viewDetails')" placement="top">
              <el-button @click="$emit('viewDetails', result)">
                <el-icon><View /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="$t('calls.playAudio')" placement="top">
              <el-button @click="$emit('playAudio', result)">
                <el-icon><Microphone /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="$t('common.share')" placement="top">
              <el-button @click="shareResult">
                <el-icon><Share /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="$t('common.export')" placement="top">
              <el-button @click="exportResult">
                <el-icon><Download /></el-icon>
              </el-button>
            </el-tooltip>
          </el-button-group>
        </div>
      </div>

      <!-- Search Highlights -->
      <div class="search-highlights" v-if="result.highlights && result.highlights.length > 0">
        <div class="highlights-header">
          <el-icon><Search /></el-icon>
          <span>{{ $t('search.matchingText', 'Matching Text') }}</span>
        </div>
        <div class="highlights-content">
          <div 
            v-for="(highlight, index) in result.highlights.slice(0, 3)" 
            :key="index"
            class="highlight-item"
            v-html="formatHighlight(highlight)"
          ></div>
          <el-button 
            v-if="result.highlights.length > 3"
            type="text" 
            size="small"
            @click="showAllHighlights = !showAllHighlights"
          >
            {{ showAllHighlights ? $t('search.showLess') : $t('search.showMore') }}
            ({{ result.highlights.length - 3 }} {{ $t('common.more') }})
          </el-button>
        </div>
      </div>

      <!-- AI Summary -->
      <div class="ai-summary" v-if="result.summary">
        <div class="summary-header">
          <el-icon><MagicStick /></el-icon>
          <span>{{ $t('calls.aiSummary', 'AI Summary') }}</span>
          <el-tag size="small" type="info" effect="plain">
            {{ searchType === 'semantic' ? 'Semantic' : searchType === 'keyword' ? 'Keyword' : 'Hybrid' }}
          </el-tag>
        </div>
        <div class="summary-content">
          <p class="summary-text">{{ result.summary }}</p>
        </div>
      </div>

      <!-- Products Mentioned -->
      <div class="products-section" v-if="result.products && result.products.length > 0">
        <div class="products-header">
          <el-icon><Box /></el-icon>
          <span>{{ $t('calls.products') }}</span>
        </div>
        <div class="products-tags">
          <el-tag 
            v-for="product in result.products" 
            :key="product"
            size="small"
            effect="light"
            type="info"
          >
            {{ product }}
          </el-tag>
        </div>
      </div>

      <!-- Result Footer -->
      <div class="result-footer">
        <div class="footer-left">
          <div class="resolution-status">
            <el-icon :class="getResolutionClass(result.resolved)">
              <CircleCheck v-if="result.resolved" />
              <Warning v-else />
            </el-icon>
            <span>{{ result.resolved ? $t('calls.resolved') : $t('calls.unresolved') }}</span>
          </div>
          
          <div class="transcription-preview" v-if="showTranscriptionPreview">
            <el-button type="text" size="small" @click="toggleTranscription">
              <el-icon><Document /></el-icon>
              {{ showFullTranscription ? $t('common.hide') : $t('calls.viewTranscription', 'View Transcription') }}
            </el-button>
          </div>
        </div>
        
        <div class="footer-right">
          <div class="quick-actions">
            <el-button 
              type="text" 
              size="small" 
              @click="saveToList"
              :icon="bookmarkIcon"
            >
              {{ $t('search.saveResult', 'Save') }}
            </el-button>
            <el-button 
              type="text" 
              size="small" 
              @click="findSimilar"
            >
              <el-icon><Connection /></el-icon>
              {{ $t('search.findSimilar', 'Find Similar') }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- Full Transcription -->
      <div class="full-transcription" v-if="showFullTranscription">
        <el-divider />
        <div class="transcription-header">
          <span>{{ $t('calls.fullTranscription', 'Full Transcription') }}</span>
          <div class="transcription-actions">
            <el-button type="text" size="small" @click="copyTranscription">
              <el-icon><CopyDocument /></el-icon>
              {{ $t('common.copy') }}
            </el-button>
            <el-button type="text" size="small" @click="translateTranscription" v-if="result.language !== 'en'">
              <el-icon><Refresh /></el-icon>
              {{ $t('search.translate', 'Translate') }}
            </el-button>
          </div>
        </div>
        <div class="transcription-content" :dir="result.language === 'he' ? 'rtl' : 'ltr'">
          <p>{{ result.transcription }}</p>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  User,
  UserFilled,
  Calendar,
  Timer,
  ChatDotRound,
  View,
  Microphone,
  Share,
  Download,
  Search,
  MagicStick,
  Box,
  CircleCheck,
  Warning,
  Document,
  Connection,
  CopyDocument,
  Refresh,
  Star,
  StarFilled,
  CircleClose,
  Remove
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const { t } = useI18n()

// Props
interface SearchResult {
  id: string
  callId: string
  subscriberId: string
  callDate: Date
  duration: number
  callType: string
  sentiment: string
  agent: { id: string; name: string }
  transcription: string
  summary: string
  relevanceScore: number
  highlights: string[]
  products: string[]
  resolved: boolean
  language: string
}

const props = defineProps<{
  result: SearchResult
  searchQuery: string
  searchType: 'semantic' | 'keyword' | 'hybrid'
}>()

// Emits
const emit = defineEmits(['viewDetails', 'playAudio'])

// Reactive state
const showAllHighlights = ref(false)
const showTranscriptionPreview = ref(true)
const showFullTranscription = ref(false)
const isSaved = ref(false)

// Computed properties
const bookmarkIcon = computed(() => isSaved.value ? StarFilled : Star)

// Methods
const formatDateTime = (date: Date): string => {
  return dayjs(date).format('DD/MM/YYYY HH:mm')
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const getResultCardClass = (result: SearchResult): string => {
  const classes = []
  if (result.relevanceScore > 0.8) classes.push('high-relevance')
  if (result.sentiment === 'negative') classes.push('negative-sentiment')
  if (!result.resolved) classes.push('unresolved')
  return classes.join(' ')
}

const getCallTypeType = (callType: string) => {
  const typeMap: Record<string, string> = {
    support: 'info',
    sales: 'success',
    billing: 'warning',
    technical: 'primary',
    complaint: 'danger',
    inquiry: ''
  }
  return typeMap[callType] || ''
}

const getSentimentType = (sentiment: string) => {
  switch (sentiment) {
    case 'positive':
      return 'success'
    case 'negative':
      return 'danger'
    case 'neutral':
      return 'info'
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

const getRelevanceColor = (score: number): string => {
  if (score > 0.8) return '#67c23a'
  if (score > 0.6) return '#e6a23c'
  if (score > 0.4) return '#f56c6c'
  return '#909399'
}

const getResolutionClass = (resolved: boolean): string => {
  return resolved ? 'resolution-resolved' : 'resolution-unresolved'
}

const formatHighlight = (highlight: string): string => {
  // In a real app, this would properly highlight search terms
  return highlight.replace(
    new RegExp(`(${props.searchQuery})`, 'gi'),
    '<mark>$1</mark>'
  )
}

const shareResult = () => {
  // Copy link to clipboard
  const link = `${window.location.origin}/calls/${props.result.callId}`
  navigator.clipboard.writeText(link)
  ElMessage.success(t('search.linkCopied', 'Link copied to clipboard'))
}

const exportResult = () => {
  ElMessage.info(t('search.exportStarted', 'Export started'))
}

const toggleTranscription = () => {
  showFullTranscription.value = !showFullTranscription.value
}

const copyTranscription = async () => {
  try {
    await navigator.clipboard.writeText(props.result.transcription)
    ElMessage.success(t('common.copied', 'Copied to clipboard'))
  } catch (error) {
    ElMessage.error(t('common.copyError', 'Failed to copy'))
  }
}

const translateTranscription = () => {
  ElMessage.info(t('search.translating', 'Translation started'))
}

const saveToList = () => {
  isSaved.value = !isSaved.value
  ElMessage.success(
    isSaved.value 
      ? t('search.resultSaved', 'Result saved to list')
      : t('search.resultRemoved', 'Result removed from list')
  )
}

const findSimilar = () => {
  ElMessage.info(t('search.findingSimilar', 'Finding similar calls'))
}
</script>

<style lang="scss" scoped>
.search-result-item {
  .result-card {
    transition: all 0.3s ease;
    border: 1px solid var(--el-border-color-light);
    
    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border-color: var(--el-color-primary-light-5);
    }
    
    &.high-relevance {
      border-left: 4px solid var(--el-color-success);
    }
    
    &.negative-sentiment {
      border-left: 4px solid var(--el-color-warning);
    }
    
    &.unresolved {
      background-color: var(--el-color-danger-light-9);
    }
    
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      
      .result-basic-info {
        flex: 1;
        
        .call-id-section {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
          flex-wrap: wrap;
          
          .call-id-link {
            font-size: 16px;
            font-weight: 600;
          }
        }
        
        .result-metadata {
          .metadata-row {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            
            .metadata-item {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 13px;
              color: var(--el-text-color-secondary);
              
              .el-icon {
                font-size: 14px;
              }
            }
          }
        }
      }
      
      .result-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 12px;
        
        .relevance-score {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          
          .score-label {
            color: var(--el-text-color-secondary);
          }
          
          .el-progress {
            width: 60px;
          }
          
          .score-value {
            font-weight: 600;
            color: var(--el-text-color-primary);
          }
        }
      }
    }
    
    .search-highlights {
      margin-bottom: 16px;
      
      .highlights-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      
      .highlights-content {
        .highlight-item {
          background-color: var(--el-fill-color-light);
          padding: 8px 12px;
          border-radius: 6px;
          margin-bottom: 6px;
          font-size: 14px;
          line-height: 1.5;
          
          :deep(mark) {
            background-color: var(--el-color-primary-light-7);
            color: var(--el-color-primary);
            padding: 2px 4px;
            border-radius: 3px;
            font-weight: 600;
          }
        }
      }
    }
    
    .ai-summary {
      margin-bottom: 16px;
      
      .summary-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      
      .summary-content {
        .summary-text {
          background-color: var(--el-color-primary-light-9);
          padding: 12px;
          border-radius: 6px;
          border-left: 3px solid var(--el-color-primary);
          margin: 0;
          line-height: 1.6;
          font-size: 14px;
        }
      }
    }
    
    .products-section {
      margin-bottom: 16px;
      
      .products-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      
      .products-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
    }
    
    .result-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid var(--el-border-color-lighter);
      
      .footer-left {
        display: flex;
        align-items: center;
        gap: 16px;
        
        .resolution-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          
          .el-icon {
            &.resolution-resolved {
              color: var(--el-color-success);
            }
            
            &.resolution-unresolved {
              color: var(--el-color-warning);
            }
          }
        }
      }
      
      .footer-right {
        .quick-actions {
          display: flex;
          gap: 8px;
        }
      }
    }
    
    .full-transcription {
      .transcription-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        font-weight: 500;
        color: var(--el-text-color-primary);
        
        .transcription-actions {
          display: flex;
          gap: 8px;
        }
      }
      
      .transcription-content {
        background-color: var(--el-fill-color-extra-light);
        padding: 16px;
        border-radius: 6px;
        line-height: 1.8;
        font-size: 14px;
        
        p {
          margin: 0;
        }
      }
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .search-result-item {
    .result-header {
      flex-direction: column;
      gap: 12px;
      
      .result-actions {
        align-self: stretch;
        
        .relevance-score {
          justify-content: space-between;
        }
      }
    }
    
    .metadata-row {
      flex-direction: column !important;
      gap: 8px !important;
    }
    
    .result-footer {
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
      
      .footer-left,
      .footer-right {
        justify-content: center;
      }
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .search-result-item {
    .result-card {
      &.high-relevance,
      &.negative-sentiment {
        border-left: 1px solid var(--el-border-color-light);
        border-right: 4px solid;
      }
      
      &.high-relevance {
        border-right-color: var(--el-color-success);
      }
      
      &.negative-sentiment {
        border-right-color: var(--el-color-warning);
      }
    }
    
    .summary-text {
      border-left: none;
      border-right: 3px solid var(--el-color-primary);
    }
  }
}

// Dark mode adjustments
// Dark mode adjustments handled by CSS variables
</style>