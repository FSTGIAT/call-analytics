<template>
  <div class="search-result-card">
    <el-card class="result-card" :class="getResultCardClass(result)" shadow="hover">
      <!-- Card Header -->
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-link 
              type="primary" 
              @click="$emit('viewDetails', result)"
              :underline="false"
              class="call-id"
            >
              {{ result.callId }}
            </el-link>
            <div class="relevance-indicator">
              <el-progress 
                type="circle" 
                :percentage="Math.round(result.relevanceScore * 100)"
                :width="32"
                :stroke-width="4"
                :show-text="false"
                :color="getRelevanceColor(result.relevanceScore)"
              />
              <span class="relevance-text">{{ Math.round(result.relevanceScore * 100) }}%</span>
            </div>
          </div>
          
          <div class="header-right">
            <el-dropdown @command="handleCardAction" trigger="click">
              <el-button type="text" class="action-button">
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="view">
                    <el-icon><View /></el-icon>
                    {{ $t('calls.viewDetails') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="play">
                    <el-icon><Microphone /></el-icon>
                    {{ $t('calls.playAudio') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="share">
                    <el-icon><Share /></el-icon>
                    {{ $t('common.share') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="export">
                    <el-icon><Download /></el-icon>
                    {{ $t('common.export') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="similar" divided>
                    <el-icon><Connection /></el-icon>
                    {{ $t('search.findSimilar') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </template>

      <!-- Card Content -->
      <div class="card-content">
        <!-- Call Metadata -->
        <div class="call-metadata">
          <div class="metadata-grid">
            <div class="metadata-item">
              <el-icon><User /></el-icon>
              <div class="metadata-content">
                <span class="metadata-label">{{ $t('calls.subscriberId') }}</span>
                <span class="metadata-value">{{ result.subscriberId }}</span>
              </div>
            </div>
            
            <div class="metadata-item">
              <el-icon><UserFilled /></el-icon>
              <div class="metadata-content">
                <span class="metadata-label">{{ $t('calls.agent') }}</span>
                <span class="metadata-value">{{ result.agent.name }}</span>
              </div>
            </div>
            
            <div class="metadata-item">
              <el-icon><Calendar /></el-icon>
              <div class="metadata-content">
                <span class="metadata-label">{{ $t('calls.callDate') }}</span>
                <span class="metadata-value">{{ formatDate(result.callDate) }}</span>
              </div>
            </div>
            
            <div class="metadata-item">
              <el-icon><Timer /></el-icon>
              <div class="metadata-content">
                <span class="metadata-label">{{ $t('calls.duration') }}</span>
                <span class="metadata-value">{{ formatDuration(result.duration) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Call Tags -->
        <div class="call-tags">
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
          
          <el-tag 
            v-if="result.language"
            size="small"
            effect="plain"
            type="info"
          >
            {{ result.language.toUpperCase() }}
          </el-tag>
          
          <el-tag 
            :type="result.resolved ? 'success' : 'warning'"
            size="small"
            effect="plain"
          >
            <el-icon>
              <CircleCheck v-if="result.resolved" />
              <Warning v-else />
            </el-icon>
            {{ result.resolved ? $t('calls.resolved') : $t('calls.unresolved') }}
          </el-tag>
        </div>

        <!-- AI Summary Preview -->
        <div class="summary-preview" v-if="result.summary">
          <div class="summary-header">
            <el-icon><MagicStick /></el-icon>
            <span>{{ $t('calls.aiSummary') }}</span>
          </div>
          <div class="summary-text">
            {{ truncateSummary(result.summary, 120) }}
            <el-button 
              v-if="result.summary.length > 120"
              type="text" 
              size="small"
              @click="showFullSummary = !showFullSummary"
            >
              {{ showFullSummary ? $t('search.showLess') : $t('search.showMore') }}
            </el-button>
          </div>
          <div v-if="showFullSummary" class="summary-full">
            {{ result.summary }}
          </div>
        </div>

        <!-- Search Highlights -->
        <div class="search-highlights" v-if="result.highlights && result.highlights.length > 0">
          <div class="highlights-header">
            <el-icon><Search /></el-icon>
            <span>{{ $t('search.highlights', 'Highlights') }}</span>
          </div>
          <div class="highlights-list">
            <div 
              v-for="(highlight, index) in result.highlights.slice(0, 2)" 
              :key="index"
              class="highlight-snippet"
              v-html="formatHighlight(highlight)"
            ></div>
            <el-button 
              v-if="result.highlights.length > 2"
              type="text" 
              size="small"
              class="show-more-highlights"
              @click="$emit('viewDetails', result)"
            >
              +{{ result.highlights.length - 2 }} {{ $t('common.more') }}
            </el-button>
          </div>
        </div>

        <!-- Products -->
        <div class="products-section" v-if="result.products && result.products.length > 0">
          <div class="products-header">
            <el-icon><Box /></el-icon>
            <span>{{ $t('calls.products') }}</span>
          </div>
          <div class="products-list">
            <el-tag 
              v-for="product in result.products.slice(0, 3)" 
              :key="product"
              size="small"
              effect="light"
              type="info"
            >
              {{ product }}
            </el-tag>
            <el-tag 
              v-if="result.products.length > 3"
              size="small"
              effect="plain"
              type="info"
            >
              +{{ result.products.length - 3 }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- Card Footer -->
      <template #footer>
        <div class="card-footer">
          <div class="footer-actions">
            <el-button size="small" @click="$emit('viewDetails', result)">
              <el-icon><View /></el-icon>
              {{ $t('calls.viewDetails') }}
            </el-button>
            <el-button size="small" @click="$emit('playAudio', result)">
              <el-icon><Microphone /></el-icon>
              {{ $t('calls.listen') }}
            </el-button>
          </div>
          
          <div class="footer-meta">
            <el-button 
              type="text" 
              size="small" 
              @click="toggleSave"
              :class="{ 'is-saved': isSaved }"
            >
              <el-icon>
                <StarFilled v-if="isSaved" />
                <Star v-else />
              </el-icon>
            </el-button>
          </div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  MoreFilled,
  View,
  Microphone,
  Share,
  Download,
  Connection,
  User,
  UserFilled,
  Calendar,
  Timer,
  CircleCheck,
  Warning,
  MagicStick,
  Search,
  Box,
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
const showFullSummary = ref(false)
const isSaved = ref(false)

// Methods
const formatDate = (date: Date): string => {
  return dayjs(date).format('DD/MM/YY')
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m`
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

const truncateSummary = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

const formatHighlight = (highlight: string): string => {
  return highlight.replace(
    new RegExp(`(${props.searchQuery})`, 'gi'),
    '<mark>$1</mark>'
  )
}

const handleCardAction = (command: string) => {
  switch (command) {
    case 'view':
      emit('viewDetails', props.result)
      break
    case 'play':
      emit('playAudio', props.result)
      break
    case 'share':
      shareResult()
      break
    case 'export':
      exportResult()
      break
    case 'similar':
      findSimilar()
      break
  }
}

const shareResult = () => {
  const link = `${window.location.origin}/calls/${props.result.callId}`
  navigator.clipboard.writeText(link)
  ElMessage.success(t('search.linkCopied', 'Link copied to clipboard'))
}

const exportResult = () => {
  ElMessage.info(t('search.exportStarted', 'Export started'))
}

const findSimilar = () => {
  ElMessage.info(t('search.findingSimilar', 'Finding similar calls'))
}

const toggleSave = () => {
  isSaved.value = !isSaved.value
  ElMessage.success(
    isSaved.value 
      ? t('search.resultSaved', 'Result saved to list')
      : t('search.resultRemoved', 'Result removed from list')
  )
}
</script>

<style lang="scss" scoped>
.search-result-card {
  height: 100%;
  
  .result-card {
    height: 100%;
    display: flex;
    flex-direction: column;
    transition: all 0.3s ease;
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    }
    
    &.high-relevance {
      border: 2px solid var(--el-color-success-light-5);
      
      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, var(--el-color-success), var(--el-color-success-light-3));
        border-radius: 4px 4px 0 0;
      }
    }
    
    &.negative-sentiment {
      border-left: 4px solid var(--el-color-warning);
    }
    
    &.unresolved {
      background: linear-gradient(135deg, 
        var(--el-bg-color) 0%, 
        var(--el-color-danger-light-9) 100%
      );
    }
    
    :deep(.el-card__header) {
      padding: 16px;
      border-bottom: 1px solid var(--el-border-color-lighter);
    }
    
    :deep(.el-card__body) {
      padding: 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    :deep(.el-card__footer) {
      padding: 12px 16px;
      border-top: 1px solid var(--el-border-color-lighter);
      background-color: var(--el-fill-color-extra-light);
    }
    
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      
      .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        
        .call-id {
          font-size: 16px;
          font-weight: 600;
        }
        
        .relevance-indicator {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          
          .relevance-text {
            position: absolute;
            font-size: 10px;
            font-weight: 600;
            color: var(--el-text-color-primary);
          }
        }
      }
      
      .header-right {
        .action-button {
          color: var(--el-text-color-secondary);
          
          &:hover {
            color: var(--el-color-primary);
          }
        }
      }
    }
    
    .card-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
      
      .call-metadata {
        .metadata-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          
          .metadata-item {
            display: flex;
            align-items: center;
            gap: 8px;
            
            .el-icon {
              color: var(--el-text-color-secondary);
              font-size: 14px;
              flex-shrink: 0;
            }
            
            .metadata-content {
              display: flex;
              flex-direction: column;
              min-width: 0;
              
              .metadata-label {
                font-size: 11px;
                color: var(--el-text-color-placeholder);
                line-height: 1;
              }
              
              .metadata-value {
                font-size: 13px;
                color: var(--el-text-color-primary);
                font-weight: 500;
                line-height: 1.2;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
            }
          }
        }
      }
      
      .call-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      
      .summary-preview {
        .summary-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }
        
        .summary-text {
          font-size: 13px;
          line-height: 1.4;
          color: var(--el-text-color-secondary);
        }
        
        .summary-full {
          margin-top: 8px;
          padding: 8px;
          background-color: var(--el-fill-color-light);
          border-radius: 4px;
          font-size: 13px;
          line-height: 1.4;
        }
      }
      
      .search-highlights {
        .highlights-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }
        
        .highlights-list {
          .highlight-snippet {
            background-color: var(--el-fill-color-light);
            padding: 6px 8px;
            border-radius: 4px;
            margin-bottom: 4px;
            font-size: 12px;
            line-height: 1.3;
            
            :deep(mark) {
              background-color: var(--el-color-primary-light-7);
              color: var(--el-color-primary);
              padding: 1px 3px;
              border-radius: 2px;
              font-weight: 600;
            }
          }
          
          .show-more-highlights {
            font-size: 11px;
            padding: 2px 6px;
          }
        }
      }
      
      .products-section {
        .products-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }
        
        .products-list {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
      }
    }
    
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      
      .footer-actions {
        display: flex;
        gap: 8px;
      }
      
      .footer-meta {
        .is-saved {
          color: var(--el-color-warning);
        }
      }
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .search-result-card {
    .metadata-grid {
      grid-template-columns: 1fr !important;
      gap: 8px !important;
    }
    
    .card-footer {
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
      
      .footer-actions {
        justify-content: center;
      }
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .search-result-card {
    .result-card {
      &.negative-sentiment {
        border-left: 1px solid var(--el-border-color-light);
        border-right: 4px solid var(--el-color-warning);
      }
    }
  }
}

// Dark mode adjustments
// Dark mode adjustments handled by CSS variables
</style>