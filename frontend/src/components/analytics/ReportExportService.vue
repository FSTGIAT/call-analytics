<template>
  <div class="report-export-service">
    <el-dialog
      v-model="showExportDialog"
      :title="$t('analytics.exportReports', 'Export Reports')"
      width="70%"
      :before-close="handleClose"
      destroy-on-close
    >
      <div class="export-content">
        <!-- Export Type Selection -->
        <div class="export-section">
          <h3>{{ $t('analytics.exportType', 'Export Type') }}</h3>
          <el-radio-group v-model="exportConfig.type" @change="handleTypeChange">
            <el-radio-button value="dashboard">
              <el-icon><Monitor /></el-icon>
              {{ $t('analytics.dashboardReport', 'Dashboard Report') }}
            </el-radio-button>
            <el-radio-button value="analytics">
              <el-icon><TrendCharts /></el-icon>
              {{ $t('analytics.analyticsReport', 'Analytics Report') }}
            </el-radio-button>
            <el-radio-button value="agent">
              <el-icon><UserFilled /></el-icon>
              {{ $t('analytics.agentReport', 'Agent Report') }}
            </el-radio-button>
            <el-radio-button value="conversation">
              <el-icon><ChatDotSquare /></el-icon>
              {{ $t('analytics.conversationReport', 'Conversation Report') }}
            </el-radio-button>
            <el-radio-button value="custom">
              <el-icon><Setting /></el-icon>
              {{ $t('analytics.customReport', 'Custom Report') }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <!-- Report Configuration -->
        <div class="export-section">
          <h3>{{ $t('analytics.reportConfiguration', 'Report Configuration') }}</h3>
          <div class="config-grid">
            <div class="config-item">
              <label>{{ $t('analytics.reportTitle', 'Report Title') }}</label>
              <el-input
                v-model="exportConfig.title"
                :placeholder="$t('analytics.enterReportTitle', 'Enter report title')"
                maxlength="100"
                show-word-limit
              />
            </div>
            <div class="config-item">
              <label>{{ $t('analytics.reportDescription', 'Description') }}</label>
              <el-input
                v-model="exportConfig.description"
                type="textarea"
                :placeholder="$t('analytics.enterDescription', 'Enter report description')"
                maxlength="500"
                show-word-limit
                :rows="3"
              />
            </div>
            <div class="config-item">
              <label>{{ $t('analytics.dateRange', 'Date Range') }}</label>
              <el-date-picker
                v-model="exportConfig.dateRange"
                type="datetimerange"
                :range-separator="$t('common.to')"
                :start-placeholder="$t('analytics.dateFrom')"
                :end-placeholder="$t('analytics.dateTo')"
                format="DD/MM/YYYY HH:mm"
                value-format="YYYY-MM-DD HH:mm:ss"
                style="width: 100%"
              />
            </div>
            <div class="config-item">
              <label>{{ $t('analytics.language', 'Language') }}</label>
              <el-select v-model="exportConfig.language" style="width: 100%">
                <el-option value="he" :label="$t('language.hebrew', 'Hebrew')" />
                <el-option value="en" :label="$t('language.english', 'English')" />
                <el-option value="both" :label="$t('language.both', 'Both Languages')" />
              </el-select>
            </div>
          </div>
        </div>

        <!-- Data Selection -->
        <div class="export-section">
          <h3>{{ $t('analytics.dataSelection', 'Data Selection') }}</h3>
          <div class="data-categories">
            <div class="category-group">
              <h4>{{ $t('analytics.callData', 'Call Data') }}</h4>
              <el-checkbox-group v-model="exportConfig.callData">
                <el-checkbox value="transcriptions">{{ $t('analytics.transcriptions', 'Transcriptions') }}</el-checkbox>
                <el-checkbox value="summaries">{{ $t('analytics.summaries', 'Summaries') }}</el-checkbox>
                <el-checkbox value="sentiment">{{ $t('analytics.sentimentAnalysis', 'Sentiment Analysis') }}</el-checkbox>
                <el-checkbox value="keywords">{{ $t('analytics.keywords', 'Keywords') }}</el-checkbox>
                <el-checkbox value="metadata">{{ $t('analytics.metadata', 'Metadata') }}</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="category-group">
              <h4>{{ $t('analytics.agentData', 'Agent Data') }}</h4>
              <el-checkbox-group v-model="exportConfig.agentData">
                <el-checkbox value="performance">{{ $t('analytics.performance', 'Performance') }}</el-checkbox>
                <el-checkbox value="ratings">{{ $t('analytics.ratings', 'Ratings') }}</el-checkbox>
                <el-checkbox value="skills">{{ $t('analytics.skills', 'Skills') }}</el-checkbox>
                <el-checkbox value="activities">{{ $t('analytics.activities', 'Activities') }}</el-checkbox>
                <el-checkbox value="goals">{{ $t('analytics.goals', 'Goals') }}</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="category-group">
              <h4>{{ $t('analytics.analyticsData', 'Analytics Data') }}</h4>
              <el-checkbox-group v-model="exportConfig.analyticsData">
                <el-checkbox value="kpis">{{ $t('analytics.kpis', 'KPIs') }}</el-checkbox>
                <el-checkbox value="trends">{{ $t('analytics.trends', 'Trends') }}</el-checkbox>
                <el-checkbox value="comparisons">{{ $t('analytics.comparisons', 'Comparisons') }}</el-checkbox>
                <el-checkbox value="forecasts">{{ $t('analytics.forecasts', 'Forecasts') }}</el-checkbox>
                <el-checkbox value="insights">{{ $t('analytics.insights', 'AI Insights') }}</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="category-group">
              <h4>{{ $t('analytics.visualizations', 'Visualizations') }}</h4>
              <el-checkbox-group v-model="exportConfig.visualizations">
                <el-checkbox value="charts">{{ $t('analytics.charts', 'Charts') }}</el-checkbox>
                <el-checkbox value="graphs">{{ $t('analytics.graphs', 'Graphs') }}</el-checkbox>
                <el-checkbox value="heatmaps">{{ $t('analytics.heatmaps', 'Heatmaps') }}</el-checkbox>
                <el-checkbox value="flowDiagrams">{{ $t('analytics.flowDiagrams', 'Flow Diagrams') }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </div>

        <!-- Export Format and Options -->
        <div class="export-section">
          <h3>{{ $t('analytics.exportFormat', 'Export Format') }}</h3>
          <div class="format-options">
            <el-radio-group v-model="exportConfig.format" @change="handleFormatChange">
              <div class="format-grid">
                <el-radio value="pdf" class="format-card">
                  <div class="format-content">
                    <el-icon><Document /></el-icon>
                    <span>PDF Report</span>
                    <div class="format-desc">{{ $t('analytics.pdfDesc', 'Professional report with charts and tables') }}</div>
                  </div>
                </el-radio>
                <el-radio value="excel" class="format-card">
                  <div class="format-content">
                    <el-icon><Files /></el-icon>
                    <span>Excel Workbook</span>
                    <div class="format-desc">{{ $t('analytics.excelDesc', 'Multiple sheets with data and charts') }}</div>
                  </div>
                </el-radio>
                <el-radio value="csv" class="format-card">
                  <div class="format-content">
                    <el-icon><Tickets /></el-icon>
                    <span>CSV Files</span>
                    <div class="format-desc">{{ $t('analytics.csvDesc', 'Raw data in comma-separated format') }}</div>
                  </div>
                </el-radio>
                <el-radio value="json" class="format-card">
                  <div class="format-content">
                    <el-icon><Data /></el-icon>
                    <span>JSON Data</span>
                    <div class="format-desc">{{ $t('analytics.jsonDesc', 'Structured data for API integration') }}</div>
                  </div>
                </el-radio>
                <el-radio value="powerbi" class="format-card">
                  <div class="format-content">
                    <el-icon><PieChart /></el-icon>
                    <span>Power BI</span>
                    <div class="format-desc">{{ $t('analytics.powerbiDesc', 'Interactive dashboard template') }}</div>
                  </div>
                </el-radio>
                <el-radio value="tableau" class="format-card">
                  <div class="format-content">
                    <el-icon><TrendCharts /></el-icon>
                    <span>Tableau</span>
                    <div class="format-desc">{{ $t('analytics.tableauDesc', 'Data source for Tableau visualization') }}</div>
                  </div>
                </el-radio>
              </div>
            </el-radio-group>
          </div>

          <!-- Format-specific Options -->
          <div v-if="exportConfig.format === 'pdf'" class="format-specific-options">
            <h4>{{ $t('analytics.pdfOptions', 'PDF Options') }}</h4>
            <div class="options-grid">
              <el-checkbox v-model="exportConfig.pdfOptions.includeCharts">{{ $t('analytics.includeCharts', 'Include Charts') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.pdfOptions.includeTables">{{ $t('analytics.includeTables', 'Include Tables') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.pdfOptions.includeRawData">{{ $t('analytics.includeRawData', 'Include Raw Data') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.pdfOptions.colorPrint">{{ $t('analytics.colorPrint', 'Color Print') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.pdfOptions.pageNumbers">{{ $t('analytics.pageNumbers', 'Page Numbers') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.pdfOptions.headerFooter">{{ $t('analytics.headerFooter', 'Header/Footer') }}</el-checkbox>
            </div>
            <div class="pdf-template">
              <label>{{ $t('analytics.template', 'Template') }}</label>
              <el-select v-model="exportConfig.pdfOptions.template" style="width: 100%">
                <el-option value="standard" :label="$t('analytics.standardTemplate', 'Standard')" />
                <el-option value="executive" :label="$t('analytics.executiveTemplate', 'Executive Summary')" />
                <el-option value="detailed" :label="$t('analytics.detailedTemplate', 'Detailed Analysis')" />
                <el-option value="custom" :label="$t('analytics.customTemplate', 'Custom')" />
              </el-select>
            </div>
          </div>

          <div v-if="exportConfig.format === 'excel'" class="format-specific-options">
            <h4>{{ $t('analytics.excelOptions', 'Excel Options') }}</h4>
            <div class="options-grid">
              <el-checkbox v-model="exportConfig.excelOptions.separateSheets">{{ $t('analytics.separateSheets', 'Separate Sheets') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.excelOptions.includeCharts">{{ $t('analytics.includeCharts', 'Include Charts') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.excelOptions.autoFilter">{{ $t('analytics.autoFilter', 'Auto Filter') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.excelOptions.freezePanes">{{ $t('analytics.freezePanes', 'Freeze Panes') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.excelOptions.formatting">{{ $t('analytics.formatting', 'Formatting') }}</el-checkbox>
              <el-checkbox v-model="exportConfig.excelOptions.pivotTables">{{ $t('analytics.pivotTables', 'Pivot Tables') }}</el-checkbox>
            </div>
          </div>
        </div>

        <!-- Delivery Options -->
        <div class="export-section">
          <h3>{{ $t('analytics.deliveryOptions', 'Delivery Options') }}</h3>
          <div class="delivery-options">
            <el-radio-group v-model="exportConfig.delivery" @change="handleDeliveryChange">
              <el-radio value="download">
                <el-icon><Download /></el-icon>
                {{ $t('analytics.directDownload', 'Direct Download') }}
              </el-radio>
              <el-radio value="email">
                <el-icon><Message /></el-icon>
                {{ $t('analytics.emailDelivery', 'Email Delivery') }}
              </el-radio>
              <el-radio value="cloud">
                <el-icon><CloudUpload /></el-icon>
                {{ $t('analytics.cloudStorage', 'Cloud Storage') }}
              </el-radio>
              <el-radio value="ftp">
                <el-icon><Upload /></el-icon>
                {{ $t('analytics.ftpUpload', 'FTP Upload') }}
              </el-radio>
            </el-radio-group>

            <div v-if="exportConfig.delivery === 'email'" class="delivery-config">
              <el-input
                v-model="exportConfig.emailConfig.recipients"
                :placeholder="$t('analytics.emailRecipients', 'Email recipients (comma-separated)')"
                type="textarea"
                :rows="2"
              />
              <el-input
                v-model="exportConfig.emailConfig.subject"
                :placeholder="$t('analytics.emailSubject', 'Email subject')"
                style="margin-top: 12px"
              />
              <el-input
                v-model="exportConfig.emailConfig.message"
                :placeholder="$t('analytics.emailMessage', 'Email message')"
                type="textarea"
                :rows="3"
                style="margin-top: 12px"
              />
            </div>

            <div v-if="exportConfig.delivery === 'cloud'" class="delivery-config">
              <el-select v-model="exportConfig.cloudConfig.provider" style="width: 100%">
                <el-option value="aws-s3" label="Amazon S3" />
                <el-option value="azure-blob" label="Azure Blob Storage" />
                <el-option value="google-cloud" label="Google Cloud Storage" />
                <el-option value="dropbox" label="Dropbox" />
                <el-option value="onedrive" label="OneDrive" />
              </el-select>
              <el-input
                v-model="exportConfig.cloudConfig.path"
                :placeholder="$t('analytics.cloudPath', 'Cloud storage path')"
                style="margin-top: 12px"
              />
            </div>

            <div v-if="exportConfig.delivery === 'ftp'" class="delivery-config">
              <el-input
                v-model="exportConfig.ftpConfig.host"
                :placeholder="$t('analytics.ftpHost', 'FTP Host')"
              />
              <el-input
                v-model="exportConfig.ftpConfig.path"
                :placeholder="$t('analytics.ftpPath', 'FTP Path')"
                style="margin-top: 12px"
              />
              <el-input
                v-model="exportConfig.ftpConfig.username"
                :placeholder="$t('analytics.ftpUsername', 'Username')"
                style="margin-top: 12px"
              />
              <el-input
                v-model="exportConfig.ftpConfig.password"
                :placeholder="$t('analytics.ftpPassword', 'Password')"
                type="password"
                style="margin-top: 12px"
              />
            </div>
          </div>
        </div>

        <!-- Scheduling Options -->
        <div class="export-section">
          <h3>{{ $t('analytics.schedulingOptions', 'Scheduling Options') }}</h3>
          <div class="scheduling-options">
            <el-radio-group v-model="exportConfig.schedule" @change="handleScheduleChange">
              <el-radio value="now">{{ $t('analytics.exportNow', 'Export Now') }}</el-radio>
              <el-radio value="scheduled">{{ $t('analytics.scheduledExport', 'Scheduled Export') }}</el-radio>
              <el-radio value="recurring">{{ $t('analytics.recurringExport', 'Recurring Export') }}</el-radio>
            </el-radio-group>

            <div v-if="exportConfig.schedule === 'scheduled'" class="schedule-config">
              <el-date-picker
                v-model="exportConfig.scheduleConfig.datetime"
                type="datetime"
                :placeholder="$t('analytics.scheduleDateTime', 'Schedule date and time')"
                format="DD/MM/YYYY HH:mm"
                value-format="YYYY-MM-DD HH:mm:ss"
                style="width: 100%"
              />
            </div>

            <div v-if="exportConfig.schedule === 'recurring'" class="schedule-config">
              <el-select v-model="exportConfig.scheduleConfig.frequency" style="width: 100%">
                <el-option value="daily" :label="$t('analytics.daily', 'Daily')" />
                <el-option value="weekly" :label="$t('analytics.weekly', 'Weekly')" />
                <el-option value="monthly" :label="$t('analytics.monthly', 'Monthly')" />
                <el-option value="quarterly" :label="$t('analytics.quarterly', 'Quarterly')" />
              </el-select>
              <el-time-picker
                v-model="exportConfig.scheduleConfig.time"
                :placeholder="$t('analytics.scheduleTime', 'Schedule time')"
                format="HH:mm"
                value-format="HH:mm:ss"
                style="width: 100%; margin-top: 12px"
              />
              <el-checkbox v-model="exportConfig.scheduleConfig.weekends" style="margin-top: 12px">
                {{ $t('analytics.includeWeekends', 'Include Weekends') }}
              </el-checkbox>
            </div>
          </div>
        </div>

        <!-- Export Preview -->
        <div class="export-section">
          <h3>{{ $t('analytics.exportPreview', 'Export Preview') }}</h3>
          <div class="preview-container">
            <div class="preview-summary">
              <div class="preview-item">
                <span class="preview-label">{{ $t('analytics.reportType', 'Report Type') }}:</span>
                <span class="preview-value">{{ getReportTypeLabel(exportConfig.type) }}</span>
              </div>
              <div class="preview-item">
                <span class="preview-label">{{ $t('analytics.format', 'Format') }}:</span>
                <span class="preview-value">{{ exportConfig.format.toUpperCase() }}</span>
              </div>
              <div class="preview-item">
                <span class="preview-label">{{ $t('analytics.dataCategories', 'Data Categories') }}:</span>
                <span class="preview-value">{{ getTotalDataCategories() }} {{ $t('analytics.selected', 'selected') }}</span>
              </div>
              <div class="preview-item">
                <span class="preview-label">{{ $t('analytics.estimatedSize', 'Estimated Size') }}:</span>
                <span class="preview-value">{{ estimatedSize }}</span>
              </div>
              <div class="preview-item">
                <span class="preview-label">{{ $t('analytics.processingTime', 'Processing Time') }}:</span>
                <span class="preview-value">{{ estimatedProcessingTime }}</span>
              </div>
            </div>
            
            <div class="preview-warning" v-if="showSizeWarning">
              <el-alert
                :title="$t('analytics.largeSizeWarning', 'Large Export Warning')"
                :description="$t('analytics.largeSizeWarningDesc', 'This export contains a large amount of data and may take several minutes to process.')"
                type="warning"
                show-icon
                :closable="false"
              />
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="handleClose">{{ $t('common.cancel') }}</el-button>
          <el-button @click="saveTemplate" :disabled="!canSaveTemplate">
            <el-icon><Collection /></el-icon>
            {{ $t('analytics.saveTemplate', 'Save Template') }}
          </el-button>
          <el-button type="primary" @click="startExport" :disabled="!canExport" :loading="isExporting">
            <el-icon><Download /></el-icon>
            {{ exportConfig.schedule === 'now' ? $t('analytics.startExport', 'Start Export') : $t('analytics.scheduleExport', 'Schedule Export') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- Export Progress Dialog -->
    <el-dialog
      v-model="showProgressDialog"
      :title="$t('analytics.exportProgress', 'Export Progress')"
      width="50%"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="export-progress">
        <div class="progress-info">
          <div class="progress-title">{{ currentExportJob.title }}</div>
          <div class="progress-status">{{ currentExportJob.status }}</div>
        </div>
        <el-progress
          :percentage="currentExportJob.progress"
          :color="getProgressColor(currentExportJob.progress)"
          :stroke-width="12"
        />
        <div class="progress-details">
          <div class="detail-item">
            <span>{{ $t('analytics.processedRecords', 'Processed Records') }}:</span>
            <span>{{ currentExportJob.processedRecords?.toLocaleString() }}</span>
          </div>
          <div class="detail-item">
            <span>{{ $t('analytics.estimatedCompletion', 'Estimated Completion') }}:</span>
            <span>{{ currentExportJob.estimatedCompletion }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancelExport" type="danger">
            <el-icon><Close /></el-icon>
            {{ $t('common.cancel') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Monitor,
  TrendCharts,
  UserFilled,
  ChatDotSquare,
  Setting,
  Document,
  Files,
  Tickets,
  Data,
  PieChart,
  Download,
  Message,
  CloudUpload,
  Upload,
  Collection,
  Close
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const { t } = useI18n()

// Props
const props = defineProps<{
  visible: boolean
  reportType?: string
  initialData?: any
}>()

// Emits
const emit = defineEmits(['update:visible', 'exportComplete'])

// Reactive state
const showExportDialog = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const showProgressDialog = ref(false)
const isExporting = ref(false)

// Export configuration
const exportConfig = ref({
  type: 'dashboard',
  title: '',
  description: '',
  dateRange: [
    dayjs().subtract(30, 'day').format('YYYY-MM-DD HH:mm:ss'),
    dayjs().format('YYYY-MM-DD HH:mm:ss')
  ],
  language: 'he',
  callData: ['transcriptions', 'summaries', 'sentiment'],
  agentData: ['performance', 'ratings'],
  analyticsData: ['kpis', 'trends'],
  visualizations: ['charts', 'graphs'],
  format: 'pdf',
  pdfOptions: {
    includeCharts: true,
    includeTables: true,
    includeRawData: false,
    colorPrint: true,
    pageNumbers: true,
    headerFooter: true,
    template: 'standard'
  },
  excelOptions: {
    separateSheets: true,
    includeCharts: true,
    autoFilter: true,
    freezePanes: true,
    formatting: true,
    pivotTables: false
  },
  delivery: 'download',
  emailConfig: {
    recipients: '',
    subject: '',
    message: ''
  },
  cloudConfig: {
    provider: 'aws-s3',
    path: ''
  },
  ftpConfig: {
    host: '',
    path: '',
    username: '',
    password: ''
  },
  schedule: 'now',
  scheduleConfig: {
    datetime: null,
    frequency: 'weekly',
    time: '09:00:00',
    weekends: false
  }
})

// Export job tracking
const currentExportJob = ref({
  id: '',
  title: '',
  status: '',
  progress: 0,
  processedRecords: 0,
  estimatedCompletion: ''
})

// Computed properties
const canExport = computed(() => {
  return exportConfig.value.title.trim() !== '' && 
         getTotalDataCategories() > 0 &&
         (exportConfig.value.delivery !== 'email' || exportConfig.value.emailConfig.recipients.trim() !== '')
})

const canSaveTemplate = computed(() => {
  return exportConfig.value.title.trim() !== '' && getTotalDataCategories() > 0
})

const estimatedSize = computed(() => {
  let baseSize = 0
  
  // Calculate based on selected data categories
  const dataCategories = getTotalDataCategories()
  baseSize += dataCategories * 0.5 // 0.5MB per category
  
  // Adjust for format
  if (exportConfig.value.format === 'pdf') {
    baseSize *= 1.5
  } else if (exportConfig.value.format === 'excel') {
    baseSize *= 1.2
  }
  
  // Adjust for visualizations
  if (exportConfig.value.visualizations.length > 0) {
    baseSize *= 1.3
  }
  
  return baseSize < 1 ? `${(baseSize * 1000).toFixed(0)} KB` : `${baseSize.toFixed(1)} MB`
})

const estimatedProcessingTime = computed(() => {
  const dataCategories = getTotalDataCategories()
  let baseTime = dataCategories * 10 // 10 seconds per category
  
  if (exportConfig.value.format === 'pdf') {
    baseTime *= 1.5
  }
  
  if (exportConfig.value.visualizations.length > 0) {
    baseTime += 30
  }
  
  return baseTime < 60 ? `${baseTime} ${t('units.seconds')}` : `${Math.round(baseTime / 60)} ${t('units.minutes')}`
})

const showSizeWarning = computed(() => {
  return getTotalDataCategories() > 8 || 
         (exportConfig.value.format === 'pdf' && exportConfig.value.visualizations.length > 2)
})

// Methods
const handleClose = () => {
  showExportDialog.value = false
}

const handleTypeChange = (type: string) => {
  // Reset data selection based on type
  if (type === 'agent') {
    exportConfig.value.agentData = ['performance', 'ratings', 'skills']
    exportConfig.value.callData = ['summaries']
  } else if (type === 'conversation') {
    exportConfig.value.callData = ['transcriptions', 'summaries', 'sentiment']
    exportConfig.value.agentData = []
  }
  
  // Set default title based on type
  exportConfig.value.title = t(`analytics.${type}ReportTitle`, `${type} Report`)
}

const handleFormatChange = (format: string) => {
  // Generate default filename
  const timestamp = dayjs().format('YYYY-MM-DD')
  const baseName = `${exportConfig.value.type}-report-${timestamp}`
  exportConfig.value.title = baseName
}

const handleDeliveryChange = (delivery: string) => {
  // Clear delivery-specific config when changing delivery method
  if (delivery !== 'email') {
    exportConfig.value.emailConfig = { recipients: '', subject: '', message: '' }
  }
}

const handleScheduleChange = (schedule: string) => {
  // Set default values for scheduling
  if (schedule === 'scheduled') {
    exportConfig.value.scheduleConfig.datetime = dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss')
  }
}

const getTotalDataCategories = (): number => {
  return exportConfig.value.callData.length + 
         exportConfig.value.agentData.length + 
         exportConfig.value.analyticsData.length + 
         exportConfig.value.visualizations.length
}

const getReportTypeLabel = (type: string): string => {
  const labels = {
    dashboard: t('analytics.dashboardReport', 'Dashboard Report'),
    analytics: t('analytics.analyticsReport', 'Analytics Report'),
    agent: t('analytics.agentReport', 'Agent Report'),
    conversation: t('analytics.conversationReport', 'Conversation Report'),
    custom: t('analytics.customReport', 'Custom Report')
  }
  return labels[type as keyof typeof labels] || type
}

const getProgressColor = (progress: number): string => {
  if (progress < 30) return '#f56c6c'
  if (progress < 70) return '#e6a23c'
  return '#67c23a'
}

const startExport = async () => {
  isExporting.value = true
  
  try {
    // Show progress dialog
    showProgressDialog.value = true
    currentExportJob.value = {
      id: `export-${Date.now()}`,
      title: exportConfig.value.title,
      status: t('analytics.initializingExport', 'Initializing export...'),
      progress: 0,
      processedRecords: 0,
      estimatedCompletion: dayjs().add(5, 'minute').format('HH:mm')
    }
    
    // Simulate export process
    await simulateExportProcess()
    
    // Complete export
    showProgressDialog.value = false
    ElMessage.success(t('analytics.exportCompleted', 'Export completed successfully'))
    
    emit('exportComplete', {
      config: exportConfig.value,
      jobId: currentExportJob.value.id
    })
    
    handleClose()
    
  } catch (error) {
    console.error('Export failed:', error)
    showProgressDialog.value = false
    ElMessage.error(t('analytics.exportFailed', 'Export failed'))
  } finally {
    isExporting.value = false
  }
}

const simulateExportProcess = async () => {
  const steps = [
    { status: t('analytics.preparingData', 'Preparing data...'), progress: 20 },
    { status: t('analytics.processingAnalytics', 'Processing analytics...'), progress: 40 },
    { status: t('analytics.generatingVisualizations', 'Generating visualizations...'), progress: 60 },
    { status: t('analytics.formattingReport', 'Formatting report...'), progress: 80 },
    { status: t('analytics.finalizingExport', 'Finalizing export...'), progress: 100 }
  ]
  
  for (const step of steps) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    currentExportJob.value.status = step.status
    currentExportJob.value.progress = step.progress
    currentExportJob.value.processedRecords = Math.floor(step.progress * 100)
  }
}

const cancelExport = async () => {
  try {
    await ElMessageBox.confirm(
      t('analytics.cancelExportConfirm', 'Are you sure you want to cancel the export?'),
      t('analytics.cancelExport', 'Cancel Export'),
      {
        confirmButtonText: t('common.yes'),
        cancelButtonText: t('common.no'),
        type: 'warning'
      }
    )
    
    showProgressDialog.value = false
    isExporting.value = false
    ElMessage.info(t('analytics.exportCancelled', 'Export cancelled'))
    
  } catch {
    // User cancelled the confirmation
  }
}

const saveTemplate = async () => {
  try {
    // Simulate saving template
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    ElMessage.success(t('analytics.templateSaved', 'Export template saved successfully'))
    
  } catch (error) {
    console.error('Failed to save template:', error)
    ElMessage.error(t('analytics.templateSaveFailed', 'Failed to save template'))
  }
}

// Initialize with props
watch(() => props.reportType, (newType) => {
  if (newType) {
    exportConfig.value.type = newType
    handleTypeChange(newType)
  }
}, { immediate: true })

watch(() => props.initialData, (newData) => {
  if (newData) {
    Object.assign(exportConfig.value, newData)
  }
}, { immediate: true })
</script>

<style lang="scss" scoped>
.report-export-service {
  .export-content {
    max-height: 70vh;
    overflow-y: auto;
    padding: 0 4px;
    
    .export-section {
      margin-bottom: 32px;
      
      h3 {
        margin: 0 0 16px 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        padding-bottom: 8px;
        border-bottom: 1px solid var(--el-border-color-lighter);
      }
      
      h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 500;
        color: var(--el-text-color-secondary);
      }
    }
    
    .config-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      
      .config-item {
        label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--el-text-color-primary);
          margin-bottom: 8px;
        }
      }
    }
    
    .data-categories {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      
      .category-group {
        background: var(--el-fill-color-extra-light);
        border-radius: 6px;
        padding: 16px;
        
        .el-checkbox-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
      }
    }
    
    .format-options {
      .format-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        
        .format-card {
          margin: 0;
          
          :deep(.el-radio__input) {
            display: none;
          }
          
          :deep(.el-radio__label) {
            padding: 0;
            width: 100%;
          }
          
          .format-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 20px;
            border: 2px solid var(--el-border-color-light);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            
            &:hover {
              border-color: var(--el-color-primary-light-5);
              background-color: var(--el-color-primary-light-9);
            }
            
            .el-icon {
              font-size: 32px;
              color: var(--el-color-primary);
            }
            
            span {
              font-size: 14px;
              font-weight: 600;
              color: var(--el-text-color-primary);
            }
            
            .format-desc {
              font-size: 12px;
              color: var(--el-text-color-secondary);
              text-align: center;
            }
          }
          
          &.is-checked {
            .format-content {
              border-color: var(--el-color-primary);
              background-color: var(--el-color-primary-light-9);
            }
          }
        }
      }
    }
    
    .format-specific-options {
      margin-top: 20px;
      padding: 16px;
      background: var(--el-fill-color-extra-light);
      border-radius: 6px;
      
      .options-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      
      .pdf-template {
        label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--el-text-color-primary);
          margin-bottom: 8px;
        }
      }
    }
    
    .delivery-options {
      .el-radio-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
        
        .el-radio {
          display: flex;
          align-items: center;
          gap: 8px;
          
          .el-icon {
            font-size: 16px;
          }
        }
      }
      
      .delivery-config {
        padding: 16px;
        background: var(--el-fill-color-extra-light);
        border-radius: 6px;
        margin-top: 16px;
      }
    }
    
    .scheduling-options {
      .el-radio-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
      }
      
      .schedule-config {
        padding: 16px;
        background: var(--el-fill-color-extra-light);
        border-radius: 6px;
        margin-top: 16px;
      }
    }
    
    .preview-container {
      .preview-summary {
        background: var(--el-fill-color-extra-light);
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 16px;
        
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
    }
  }
  
  .export-progress {
    .progress-info {
      margin-bottom: 20px;
      
      .progress-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        margin-bottom: 8px;
      }
      
      .progress-status {
        font-size: 14px;
        color: var(--el-text-color-secondary);
      }
    }
    
    .progress-details {
      margin-top: 20px;
      display: flex;
      justify-content: space-between;
      
      .detail-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        
        span:first-child {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
        
        span:last-child {
          font-size: 14px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }
      }
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .report-export-service {
    .export-content {
      .config-grid {
        grid-template-columns: 1fr;
      }
      
      .data-categories {
        grid-template-columns: 1fr;
      }
      
      .format-options {
        .format-grid {
          grid-template-columns: 1fr;
        }
      }
      
      .format-specific-options {
        .options-grid {
          grid-template-columns: 1fr;
        }
      }
      
      .export-progress {
        .progress-details {
          flex-direction: column;
          gap: 12px;
        }
      }
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .report-export-service {
    .export-content {
      .preview-container {
        .preview-summary {
          .preview-item {
            flex-direction: row-reverse;
          }
        }
      }
    }
    
    .export-progress {
      .progress-details {
        flex-direction: row-reverse;
      }
    }
  }
}
</style>