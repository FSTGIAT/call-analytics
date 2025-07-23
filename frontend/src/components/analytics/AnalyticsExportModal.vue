<template>
  <div class="analytics-export-modal">
    <div class="export-form">
      <!-- Export Format Selection -->
      <div class="form-section">
        <label class="section-title">{{ $t('analytics.exportFormat', 'Export Format') }}</label>
        <el-radio-group v-model="exportConfig.format" @change="handleFormatChange">
          <el-radio value="csv">
            <el-icon><Document /></el-icon>
            <span>CSV</span>
            <el-tag size="small" type="info">{{ $t('analytics.recommended', 'Recommended') }}</el-tag>
          </el-radio>
          <el-radio value="xlsx">
            <el-icon><Files /></el-icon>
            <span>Excel (XLSX)</span>
          </el-radio>
          <el-radio value="json">
            <el-icon><Tickets /></el-icon>
            <span>JSON</span>
          </el-radio>
          <el-radio value="pdf">
            <el-icon><Printer /></el-icon>
            <span>PDF Report</span>
          </el-radio>
        </el-radio-group>
      </div>

      <!-- Data Selection -->
      <div class="form-section">
        <label class="section-title">{{ $t('analytics.dataToExport', 'Data to Export') }}</label>
        <el-checkbox-group v-model="exportConfig.dataTypes">
          <el-checkbox value="kpi">
            <el-icon><TrendCharts /></el-icon>
            {{ $t('analytics.kpiMetrics', 'KPI Metrics') }}
          </el-checkbox>
          <el-checkbox value="callVolume">
            <el-icon><Phone /></el-icon>
            {{ $t('analytics.callVolumeData', 'Call Volume Data') }}
          </el-checkbox>
          <el-checkbox value="sentiment">
            <el-icon><CircleCheck /></el-icon>
            {{ $t('analytics.sentimentData', 'Sentiment Analysis') }}
          </el-checkbox>
          <el-checkbox value="agents">
            <el-icon><UserFilled /></el-icon>
            {{ $t('analytics.agentPerformance', 'Agent Performance') }}
          </el-checkbox>
          <el-checkbox value="callTypes">
            <el-icon><Grid /></el-icon>
            {{ $t('analytics.callTypeBreakdown', 'Call Type Breakdown') }}
          </el-checkbox>
          <el-checkbox value="duration">
            <el-icon><Timer /></el-icon>
            {{ $t('analytics.durationAnalysis', 'Duration Analysis') }}
          </el-checkbox>
          <el-checkbox value="peakHours">
            <el-icon><Calendar /></el-icon>
            {{ $t('analytics.peakHoursData', 'Peak Hours Data') }}
          </el-checkbox>
        </el-checkbox-group>
      </div>

      <!-- Date Range (if different from current) -->
      <div class="form-section">
        <label class="section-title">{{ $t('analytics.dateRange', 'Date Range') }}</label>
        <div class="date-range-section">
          <el-switch
            v-model="useCustomDateRange"
            :active-text="$t('analytics.customRange', 'Custom Range')"
            :inactive-text="$t('analytics.currentRange', 'Current Range')"
          />
          <div class="current-range" v-if="!useCustomDateRange">
            <el-tag type="info">
              {{ formatDateRange(dateRange) }}
            </el-tag>
          </div>
          <el-date-picker
            v-else
            v-model="exportConfig.customDateRange"
            type="datetimerange"
            :range-separator="$t('common.to')"
            :start-placeholder="$t('analytics.dateFrom')"
            :end-placeholder="$t('analytics.dateTo')"
            format="DD/MM/YYYY"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </div>
      </div>

      <!-- Export Options -->
      <div class="form-section">
        <label class="section-title">{{ $t('analytics.exportOptions', 'Export Options') }}</label>
        <div class="options-grid">
          <el-checkbox 
            v-model="exportConfig.includeCharts" 
            :disabled="exportConfig.format === 'csv' || exportConfig.format === 'json'"
          >
            {{ $t('analytics.includeCharts', 'Include Charts') }}
          </el-checkbox>
          <el-checkbox v-model="exportConfig.includeMetadata">
            {{ $t('analytics.includeMetadata', 'Include Metadata') }}
          </el-checkbox>
          <el-checkbox v-model="exportConfig.compressData">
            {{ $t('analytics.compressData', 'Compress Data') }}
          </el-checkbox>
          <el-checkbox v-model="exportConfig.includeInsights">
            {{ $t('analytics.includeInsights', 'Include AI Insights') }}
          </el-checkbox>
        </div>
      </div>

      <!-- Advanced Options -->
      <div class="form-section">
        <el-collapse v-model="expandedSections">
          <el-collapse-item :title="$t('analytics.advancedOptions', 'Advanced Options')" name="advanced">
            <div class="advanced-options">
              <!-- File Naming -->
              <div class="option-group">
                <label class="option-label">{{ $t('analytics.fileName', 'File Name') }}</label>
                <el-input
                  v-model="exportConfig.fileName"
                  :placeholder="$t('analytics.fileNamePlaceholder', 'Enter custom file name')"
                  size="small"
                >
                  <template #suffix>
                    <span class="file-extension">.{{ exportConfig.format }}</span>
                  </template>
                </el-input>
              </div>

              <!-- Email Delivery -->
              <div class="option-group">
                <label class="option-label">{{ $t('analytics.emailDelivery', 'Email Delivery') }}</label>
                <el-switch
                  v-model="exportConfig.emailDelivery"
                  :active-text="$t('analytics.sendEmail', 'Send to Email')"
                  :inactive-text="$t('analytics.downloadDirect', 'Download Direct')"
                />
                <el-input
                  v-if="exportConfig.emailDelivery"
                  v-model="exportConfig.emailAddress"
                  :placeholder="$t('analytics.emailAddress', 'Email Address')"
                  size="small"
                  style="margin-top: 8px"
                />
              </div>

              <!-- Scheduled Export -->
              <div class="option-group">
                <label class="option-label">{{ $t('analytics.scheduledExport', 'Scheduled Export') }}</label>
                <el-switch
                  v-model="exportConfig.scheduled"
                  :active-text="$t('analytics.scheduleExport', 'Schedule Export')"
                  :inactive-text="$t('analytics.oneTime', 'One-time Export')"
                />
                <div v-if="exportConfig.scheduled" class="schedule-options">
                  <el-select
                    v-model="exportConfig.scheduleFrequency"
                    :placeholder="$t('analytics.frequency', 'Frequency')"
                    size="small"
                    style="width: 100%; margin-top: 8px"
                  >
                    <el-option value="daily" :label="$t('analytics.daily', 'Daily')" />
                    <el-option value="weekly" :label="$t('analytics.weekly', 'Weekly')" />
                    <el-option value="monthly" :label="$t('analytics.monthly', 'Monthly')" />
                  </el-select>
                </div>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>

      <!-- Preview Section -->
      <div class="form-section">
        <label class="section-title">{{ $t('analytics.exportPreview', 'Export Preview') }}</label>
        <div class="preview-section">
          <div class="preview-info">
            <div class="preview-item">
              <span class="preview-label">{{ $t('analytics.format', 'Format') }}:</span>
              <span class="preview-value">{{ exportConfig.format.toUpperCase() }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">{{ $t('analytics.dataTypes', 'Data Types') }}:</span>
              <span class="preview-value">{{ exportConfig.dataTypes.length }} {{ $t('analytics.selected', 'selected') }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">{{ $t('analytics.estimatedSize', 'Estimated Size') }}:</span>
              <span class="preview-value">{{ estimatedFileSize }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">{{ $t('analytics.processingTime', 'Processing Time') }}:</span>
              <span class="preview-value">{{ estimatedProcessingTime }}</span>
            </div>
          </div>
          
          <div class="preview-warning" v-if="showWarning">
            <el-alert
              :title="$t('analytics.exportWarning', 'Large Export Warning')"
              :description="$t('analytics.exportWarningDesc', 'This export may take several minutes to process due to the large amount of data selected.')"
              type="warning"
              show-icon
              :closable="false"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="modal-actions">
      <el-button @click="$emit('close')">
        {{ $t('common.cancel') }}
      </el-button>
      <el-button 
        type="primary" 
        @click="startExport"
        :disabled="!canExport"
        :loading="isExporting"
      >
        <el-icon><Download /></el-icon>
        {{ exportConfig.scheduled ? $t('analytics.scheduleExport') : $t('analytics.startExport', 'Start Export') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  Document,
  Files,
  Tickets,
  Printer,
  TrendCharts,
  Phone,
  CircleCheck,
  UserFilled,
  Grid,
  Timer,
  Calendar,
  Download
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const { t } = useI18n()

// Props
const props = defineProps<{
  dateRange: [string, string]
}>()

// Emits
const emit = defineEmits(['export', 'close'])

// Reactive state
const isExporting = ref(false)
const useCustomDateRange = ref(false)
const expandedSections = ref<string[]>([])

const exportConfig = ref({
  format: 'csv',
  dataTypes: ['kpi', 'callVolume', 'sentiment'],
  customDateRange: null as [string, string] | null,
  includeCharts: false,
  includeMetadata: true,
  compressData: false,
  includeInsights: false,
  fileName: '',
  emailDelivery: false,
  emailAddress: '',
  scheduled: false,
  scheduleFrequency: 'daily'
})

// Computed properties
const canExport = computed(() => {
  return exportConfig.value.dataTypes.length > 0 && 
         (!exportConfig.value.emailDelivery || exportConfig.value.emailAddress)
})

const estimatedFileSize = computed(() => {
  let baseSize = 0
  
  // Base size per data type
  const sizeMap = {
    kpi: 0.1,
    callVolume: 2.5,
    sentiment: 1.2,
    agents: 0.8,
    callTypes: 0.5,
    duration: 1.8,
    peakHours: 3.2
  }
  
  exportConfig.value.dataTypes.forEach(type => {
    baseSize += sizeMap[type as keyof typeof sizeMap] || 0
  })
  
  // Adjust for format
  if (exportConfig.value.format === 'xlsx') {
    baseSize *= 1.5
  } else if (exportConfig.value.format === 'pdf') {
    baseSize *= 2.0
  }
  
  // Adjust for charts
  if (exportConfig.value.includeCharts) {
    baseSize *= 1.8
  }
  
  if (baseSize < 1) {
    return `${Math.round(baseSize * 1000)} KB`
  } else {
    return `${baseSize.toFixed(1)} MB`
  }
})

const estimatedProcessingTime = computed(() => {
  const dataTypeCount = exportConfig.value.dataTypes.length
  let baseTime = dataTypeCount * 2 // 2 seconds per data type
  
  if (exportConfig.value.format === 'pdf') {
    baseTime *= 2
  }
  
  if (exportConfig.value.includeCharts) {
    baseTime += 5
  }
  
  if (baseTime < 60) {
    return `${baseTime} ${t('units.seconds')}`
  } else {
    return `${Math.round(baseTime / 60)} ${t('units.minutes')}`
  }
})

const showWarning = computed(() => {
  return exportConfig.value.dataTypes.length > 4 || 
         exportConfig.value.format === 'pdf' && exportConfig.value.includeCharts
})

// Methods
const formatDateRange = (range: [string, string]): string => {
  const start = dayjs(range[0]).format('DD/MM/YYYY')
  const end = dayjs(range[1]).format('DD/MM/YYYY')
  return `${start} - ${end}`
}

const handleFormatChange = (format: string) => {
  // Adjust options based on format
  if (format === 'csv' || format === 'json') {
    exportConfig.value.includeCharts = false
  }
  
  // Generate default filename
  const timestamp = dayjs().format('YYYY-MM-DD')
  const baseName = `analytics-export-${timestamp}`
  exportConfig.value.fileName = baseName
}

const startExport = async () => {
  isExporting.value = true
  
  try {
    // Prepare export data
    const exportData = {
      ...exportConfig.value,
      dateRange: useCustomDateRange.value ? exportConfig.value.customDateRange : props.dateRange
    }
    
    // Simulate export process
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    emit('export', exportConfig.value.format, exportData)
    
    ElMessage.success(
      exportConfig.value.scheduled 
        ? t('analytics.exportScheduled', 'Export scheduled successfully')
        : t('analytics.exportStarted', 'Export started successfully')
    )
    
  } catch (error) {
    ElMessage.error(t('analytics.exportError', 'Export failed'))
  } finally {
    isExporting.value = false
  }
}

// Initialize default filename
onMounted(() => {
  handleFormatChange(exportConfig.value.format)
})
</script>

<style lang="scss" scoped>
.analytics-export-modal {
  .export-form {
    .form-section {
      margin-bottom: 24px;
      
      .section-title {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        margin-bottom: 12px;
      }
      
      .el-radio-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        
        .el-radio {
          margin-right: 0;
          margin-bottom: 0;
          padding: 12px;
          border: 1px solid var(--el-border-color-light);
          border-radius: 6px;
          transition: all 0.2s ease;
          
          &:hover {
            border-color: var(--el-color-primary-light-5);
            background-color: var(--el-color-primary-light-9);
          }
          
          &.is-checked {
            border-color: var(--el-color-primary);
            background-color: var(--el-color-primary-light-9);
          }
          
          :deep(.el-radio__label) {
            display: flex;
            align-items: center;
            gap: 8px;
            
            .el-icon {
              font-size: 16px;
            }
          }
        }
      }
      
      .el-checkbox-group {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 8px;
        
        .el-checkbox {
          :deep(.el-checkbox__label) {
            display: flex;
            align-items: center;
            gap: 6px;
            
            .el-icon {
              font-size: 14px;
            }
          }
        }
      }
      
      .date-range-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        
        .current-range {
          display: flex;
          align-items: center;
        }
      }
      
      .options-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      
      .advanced-options {
        display: flex;
        flex-direction: column;
        gap: 16px;
        
        .option-group {
          .option-label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: var(--el-text-color-primary);
            margin-bottom: 6px;
          }
          
          .file-extension {
            color: var(--el-text-color-placeholder);
            font-size: 12px;
          }
          
          .schedule-options {
            margin-top: 8px;
          }
        }
      }
      
      .preview-section {
        .preview-info {
          background-color: var(--el-fill-color-light);
          border-radius: 6px;
          padding: 16px;
          margin-bottom: 12px;
          
          .preview-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            
            &:last-child {
              margin-bottom: 0;
            }
            
            .preview-label {
              font-size: 13px;
              color: var(--el-text-color-secondary);
            }
            
            .preview-value {
              font-size: 13px;
              font-weight: 500;
              color: var(--el-text-color-primary);
            }
          }
        }
        
        .preview-warning {
          margin-top: 12px;
        }
      }
    }
  }
  
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 20px;
    border-top: 1px solid var(--el-border-color-light);
    margin-top: 24px;
  }
}

// Mobile adjustments
@include mobile-only {
  .analytics-export-modal {
    .export-form {
      .form-section {
        .el-checkbox-group {
          grid-template-columns: 1fr;
        }
        
        .options-grid {
          grid-template-columns: 1fr;
        }
      }
    }
    
    .modal-actions {
      flex-direction: column;
      
      .el-button {
        width: 100%;
      }
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .analytics-export-modal {
    .export-form {
      .form-section {
        .el-radio-group {
          .el-radio {
            :deep(.el-radio__label) {
              flex-direction: row-reverse;
            }
          }
        }
        
        .el-checkbox-group {
          .el-checkbox {
            :deep(.el-checkbox__label) {
              flex-direction: row-reverse;
            }
          }
        }
      }
    }
    
    .modal-actions {
      justify-content: flex-start;
    }
  }
}

// Dark mode adjustments handled by CSS variables
</style>