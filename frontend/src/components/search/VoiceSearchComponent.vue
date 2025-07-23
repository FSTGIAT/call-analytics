<template>
  <div class="voice-search-component">
    <div class="voice-interface">
      <!-- Voice Status Display -->
      <div class="voice-status">
        <div class="status-indicator" :class="statusClass">
          <div class="pulse-ring" v-if="isRecording"></div>
          <el-icon class="status-icon">
            <Microphone v-if="!isRecording && !isProcessing" />
            <Loading v-else-if="isProcessing" />
            <VideoPlay v-else />
          </el-icon>
        </div>
        
        <div class="status-text">
          <h3>{{ statusTitle }}</h3>
          <p>{{ statusMessage }}</p>
        </div>
      </div>

      <!-- Voice Controls -->
      <div class="voice-controls">
        <el-button
          v-if="!isRecording && !isProcessing"
          type="primary"
          size="large"
          @click="startRecording"
          :disabled="!isSupported"
          round
        >
          <el-icon><Microphone /></el-icon>
          {{ $t('search.startRecording', 'Start Recording') }}
        </el-button>
        
        <el-button
          v-else-if="isRecording"
          type="danger"
          size="large"
          @click="stopRecording"
          round
        >
          <el-icon><VideoPause /></el-icon>
          {{ $t('search.stopRecording', 'Stop Recording') }}
        </el-button>
        
        <el-button
          v-else
          type="info"
          size="large"
          loading
          round
        >
          {{ $t('search.processing', 'Processing...') }}
        </el-button>
      </div>

      <!-- Recording Timer -->
      <div class="recording-timer" v-if="isRecording">
        <el-icon><Timer /></el-icon>
        <span>{{ formatTime(recordingTime) }}</span>
      </div>

      <!-- Language Selection -->
      <div class="language-selection">
        <span class="language-label">{{ $t('search.recordingLanguage', 'Recording Language') }}:</span>
        <el-select v-model="selectedLanguage" size="default" style="width: 120px;">
          <el-option value="he" label="עברית" />
          <el-option value="en" label="English" />
          <el-option value="auto" :label="$t('common.auto')" />
        </el-select>
      </div>

      <!-- Live Transcription -->
      <div class="live-transcription" v-if="liveTranscript">
        <div class="transcription-header">
          <el-icon><Document /></el-icon>
          <span>{{ $t('search.liveTranscription', 'Live Transcription') }}</span>
        </div>
        <div class="transcription-content" :dir="selectedLanguage === 'he' ? 'rtl' : 'ltr'">
          <p>{{ liveTranscript }}</p>
          <span v-if="isRecording" class="typing-indicator">...</span>
        </div>
      </div>

      <!-- Error Message -->
      <div class="error-message" v-if="errorMessage">
        <el-alert
          :title="$t('search.voiceError', 'Voice Recognition Error')"
          :description="errorMessage"
          type="error"
          show-icon
          :closable="false"
        />
      </div>

      <!-- Browser Support Warning -->
      <div class="browser-warning" v-if="!isSupported">
        <el-alert
          :title="$t('search.browserNotSupported', 'Browser Not Supported')"
          :description="$t('search.voiceSupportMessage', 'Your browser does not support voice recognition. Please use Chrome, Firefox, or Safari.')"
          type="warning"
          show-icon
          :closable="false"
        />
      </div>
    </div>

    <!-- Voice Search Tips -->
    <div class="voice-tips">
      <h4>{{ $t('search.voiceTips', 'Voice Search Tips') }}</h4>
      <ul>
        <li>{{ $t('search.voiceTip1', 'Speak clearly and at a normal pace') }}</li>
        <li>{{ $t('search.voiceTip2', 'Use natural language like "find calls about billing issues"') }}</li>
        <li>{{ $t('search.voiceTip3', 'Mention specific dates, agents, or call types') }}</li>
        <li>{{ $t('search.voiceTip4', 'You can speak in Hebrew or English') }}</li>
      </ul>
    </div>

    <!-- Action Buttons -->
    <div class="action-buttons">
      <el-button 
        v-if="finalTranscript"
        type="primary" 
        @click="useTranscript"
        :disabled="isProcessing"
      >
        {{ $t('search.useTranscript', 'Use This Transcript') }}
      </el-button>
      
      <el-button 
        v-if="finalTranscript"
        @click="clearTranscript"
        :disabled="isProcessing"
      >
        {{ $t('search.tryAgain', 'Try Again') }}
      </el-button>
      
      <el-button @click="$emit('close')">
        {{ $t('common.close') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  Microphone,
  Loading,
  VideoPlay,
  VideoPause,
  Timer,
  Document
} from '@element-plus/icons-vue'

const { t } = useI18n()

// Emits
const emit = defineEmits(['result', 'close'])

// Reactive state
const isSupported = ref(false)
const isRecording = ref(false)
const isProcessing = ref(false)
const recordingTime = ref(0)
const selectedLanguage = ref('auto')
const liveTranscript = ref('')
const finalTranscript = ref('')
const errorMessage = ref('')

// Recording timer
let recordingTimer: NodeJS.Timeout | null = null
let recordingStartTime = 0

// Speech recognition
let recognition: any = null

// Computed properties
const statusClass = computed(() => ({
  'status-idle': !isRecording.value && !isProcessing.value,
  'status-recording': isRecording.value,
  'status-processing': isProcessing.value
}))

const statusTitle = computed(() => {
  if (isProcessing.value) return t('search.processing')
  if (isRecording.value) return t('search.recording', 'Recording...')
  return t('search.readyToRecord', 'Ready to Record')
})

const statusMessage = computed(() => {
  if (isProcessing.value) return t('search.processingMessage', 'Processing your voice input...')
  if (isRecording.value) return t('search.recordingMessage', 'Speak now, we are listening...')
  return t('search.readyMessage', 'Click the button below to start recording')
})

// Methods
const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const initializeSpeechRecognition = () => {
  // Check for speech recognition support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  
  if (!SpeechRecognition) {
    isSupported.value = false
    return
  }
  
  isSupported.value = true
  recognition = new SpeechRecognition()
  
  // Configure recognition
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  
  // Set language
  const getLanguageCode = (lang: string) => {
    switch (lang) {
      case 'he': return 'he-IL'
      case 'en': return 'en-US'
      case 'auto': return 'he-IL' // Default to Hebrew
      default: return 'he-IL'
    }
  }
  
  recognition.lang = getLanguageCode(selectedLanguage.value)
  
  // Event handlers
  recognition.onstart = () => {
    isRecording.value = true
    recordingStartTime = Date.now()
    startRecordingTimer()
    errorMessage.value = ''
  }
  
  recognition.onresult = (event: any) => {
    let interimTranscript = ''
    let finalTranscriptLocal = ''
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      
      if (event.results[i].isFinal) {
        finalTranscriptLocal += transcript
      } else {
        interimTranscript += transcript
      }
    }
    
    liveTranscript.value = finalTranscriptLocal + interimTranscript
    
    if (finalTranscriptLocal) {
      finalTranscript.value = finalTranscriptLocal.trim()
    }
  }
  
  recognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error)
    
    let errorMsg = ''
    switch (event.error) {
      case 'no-speech':
        errorMsg = t('search.noSpeechError', 'No speech was detected. Please try again.')
        break
      case 'audio-capture':
        errorMsg = t('search.audioError', 'Audio capture failed. Please check your microphone.')
        break
      case 'not-allowed':
        errorMsg = t('search.permissionError', 'Microphone access denied. Please allow microphone access.')
        break
      case 'network':
        errorMsg = t('search.networkError', 'Network error occurred. Please check your connection.')
        break
      default:
        errorMsg = t('search.unknownError', 'An unknown error occurred. Please try again.')
    }
    
    errorMessage.value = errorMsg
    stopRecording()
  }
  
  recognition.onend = () => {
    isRecording.value = false
    stopRecordingTimer()
    
    if (finalTranscript.value) {
      processTranscript()
    }
  }
}

const startRecording = () => {
  if (!recognition) return
  
  try {
    // Update language if changed
    const getLanguageCode = (lang: string) => {
      switch (lang) {
        case 'he': return 'he-IL'
        case 'en': return 'en-US'
        case 'auto': return 'he-IL'
        default: return 'he-IL'
      }
    }
    
    recognition.lang = getLanguageCode(selectedLanguage.value)
    
    // Clear previous results
    liveTranscript.value = ''
    finalTranscript.value = ''
    errorMessage.value = ''
    recordingTime.value = 0
    
    recognition.start()
  } catch (error) {
    console.error('Failed to start recording:', error)
    errorMessage.value = t('search.startRecordingError', 'Failed to start recording. Please try again.')
  }
}

const stopRecording = () => {
  if (recognition && isRecording.value) {
    recognition.stop()
  }
}

const startRecordingTimer = () => {
  recordingTimer = setInterval(() => {
    recordingTime.value = Math.floor((Date.now() - recordingStartTime) / 1000)
    
    // Auto-stop after 60 seconds
    if (recordingTime.value >= 60) {
      stopRecording()
      ElMessage.warning(t('search.recordingTimeout', 'Recording stopped after 60 seconds'))
    }
  }, 1000)
}

const stopRecordingTimer = () => {
  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }
}

const processTranscript = async () => {
  if (!finalTranscript.value) return
  
  isProcessing.value = true
  
  try {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // In a real app, this would send the transcript to a processing service
    // For now, we'll just clean up the transcript
    const cleanedTranscript = finalTranscript.value
      .replace(/\s+/g, ' ')
      .trim()
    
    finalTranscript.value = cleanedTranscript
    
    ElMessage.success(t('search.transcriptionComplete', 'Transcription completed'))
  } catch (error) {
    console.error('Failed to process transcript:', error)
    errorMessage.value = t('search.processingError', 'Failed to process transcript. Please try again.')
  } finally {
    isProcessing.value = false
  }
}

const useTranscript = () => {
  if (finalTranscript.value) {
    emit('result', finalTranscript.value)
  }
}

const clearTranscript = () => {
  liveTranscript.value = ''
  finalTranscript.value = ''
  errorMessage.value = ''
  recordingTime.value = 0
}

// Lifecycle
onMounted(() => {
  initializeSpeechRecognition()
})

onUnmounted(() => {
  if (recognition) {
    recognition.stop()
  }
  stopRecordingTimer()
})

// Watch language changes
watch(selectedLanguage, () => {
  if (recognition && !isRecording.value) {
    const getLanguageCode = (lang: string) => {
      switch (lang) {
        case 'he': return 'he-IL'
        case 'en': return 'en-US'
        case 'auto': return 'he-IL'
        default: return 'he-IL'
      }
    }
    
    recognition.lang = getLanguageCode(selectedLanguage.value)
  }
})
</script>

<style lang="scss" scoped>
.voice-search-component {
  .voice-interface {
    text-align: center;
    margin-bottom: 32px;
    
    .voice-status {
      margin-bottom: 32px;
      
      .status-indicator {
        position: relative;
        width: 120px;
        height: 120px;
        margin: 0 auto 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        
        &.status-idle {
          background-color: var(--el-color-info-light-8);
          border: 3px solid var(--el-color-info-light-5);
        }
        
        &.status-recording {
          background-color: var(--el-color-danger-light-8);
          border: 3px solid var(--el-color-danger);
          animation: pulse 2s infinite;
        }
        
        &.status-processing {
          background-color: var(--el-color-primary-light-8);
          border: 3px solid var(--el-color-primary);
        }
        
        .pulse-ring {
          position: absolute;
          width: 140px;
          height: 140px;
          border: 3px solid var(--el-color-danger);
          border-radius: 50%;
          animation: pulse-ring 2s infinite;
        }
        
        .status-icon {
          font-size: 48px;
          color: var(--el-text-color-primary);
        }
      }
      
      .status-text {
        h3 {
          margin: 0 0 8px 0;
          font-size: 20px;
          color: var(--el-text-color-primary);
        }
        
        p {
          margin: 0;
          font-size: 14px;
          color: var(--el-text-color-secondary);
        }
      }
    }
    
    .voice-controls {
      margin-bottom: 24px;
      
      .el-button {
        padding: 16px 32px;
        font-size: 16px;
      }
    }
    
    .recording-timer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
      font-size: 18px;
      font-weight: 600;
      color: var(--el-color-danger);
      font-family: $font-family-monospace;
    }
    
    .language-selection {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 24px;
      
      .language-label {
        font-size: 14px;
        color: var(--el-text-color-secondary);
      }
    }
    
    .live-transcription {
      margin-bottom: 24px;
      
      .transcription-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 12px;
        font-size: 14px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      
      .transcription-content {
        background-color: var(--el-fill-color-light);
        border: 1px solid var(--el-border-color-light);
        border-radius: 8px;
        padding: 16px;
        min-height: 80px;
        text-align: left;
        
        p {
          margin: 0;
          font-size: 16px;
          line-height: 1.6;
          color: var(--el-text-color-primary);
        }
        
        .typing-indicator {
          color: var(--el-color-primary);
          font-weight: 600;
          animation: blink 1s infinite;
        }
      }
    }
    
    .error-message,
    .browser-warning {
      margin-bottom: 24px;
    }
  }
  
  .voice-tips {
    margin-bottom: 24px;
    padding: 16px;
    background-color: var(--el-fill-color-extra-light);
    border-radius: 8px;
    
    h4 {
      margin: 0 0 12px 0;
      font-size: 16px;
      color: var(--el-text-color-primary);
    }
    
    ul {
      margin: 0;
      padding-left: 20px;
      
      li {
        margin-bottom: 8px;
        font-size: 14px;
        color: var(--el-text-color-secondary);
        line-height: 1.4;
        
        &:last-child {
          margin-bottom: 0;
        }
      }
    }
  }
  
  .action-buttons {
    display: flex;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }
}

// Mobile adjustments
@include mobile-only {
  .voice-search-component {
    .voice-interface {
      .voice-status {
        .status-indicator {
          width: 100px;
          height: 100px;
          
          .pulse-ring {
            width: 120px;
            height: 120px;
          }
          
          .status-icon {
            font-size: 36px;
          }
        }
      }
      
      .voice-controls {
        .el-button {
          padding: 12px 24px;
          font-size: 14px;
        }
      }
      
      .language-selection {
        flex-direction: column;
        gap: 8px;
      }
    }
    
    .action-buttons {
      flex-direction: column;
      
      .el-button {
        width: 100%;
      }
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .voice-search-component {
    .voice-tips {
      ul {
        padding-left: 0;
        padding-right: 20px;
      }
    }
    
    .transcription-content {
      text-align: right;
    }
  }
}

// Animations
@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1.2);
    opacity: 0;
  }
}

@keyframes blink {
  0%, 50% {
    opacity: 1;
  }
  51%, 100% {
    opacity: 0;
  }
}

// Dark mode adjustments
// Dark mode adjustments handled by CSS variables
</style>