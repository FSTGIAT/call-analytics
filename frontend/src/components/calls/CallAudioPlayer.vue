<template>
  <div class="call-audio-player">
    <!-- Player Header -->
    <div class="player-header">
      <div class="call-info">
        <h4>{{ call.callId }}</h4>
        <p>{{ call.subscriberId }} • {{ formatDateTime(call.startTime) }}</p>
      </div>
      <div class="player-controls">
        <el-button-group size="small">
          <el-tooltip :content="$t('calls.downloadRecording')" placement="top">
            <el-button @click="downloadRecording">
              <el-icon><Download /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="$t('common.share')" placement="top">
            <el-button @click="shareRecording">
              <el-icon><Share /></el-icon>
            </el-button>
          </el-tooltip>
        </el-button-group>
      </div>
    </div>

    <!-- Audio Player -->
    <div class="audio-player-container">
      <div class="audio-player">
        <!-- Mock audio element (in real app would be actual audio) -->
        <audio
          ref="audioRef"
          :src="audioUrl"
          @loadedmetadata="handleLoadedMetadata"
          @timeupdate="handleTimeUpdate"
          @ended="handleEnded"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          preload="metadata"
        ></audio>

        <!-- Player Controls -->
        <div class="player-controls-main">
          <el-button
            :type="isPlaying ? 'danger' : 'primary'"
            circle
            size="large"
            @click="togglePlayPause"
            :loading="isLoading"
          >
            <el-icon v-if="!isLoading">
              <VideoPause v-if="isPlaying" />
              <VideoPlay v-else />
            </el-icon>
          </el-button>

          <div class="time-controls">
            <span class="current-time">{{ formatTime(currentTime) }}</span>
            <el-slider
              v-model="currentTime"
              :max="duration"
              :step="1"
              :show-tooltip="false"
              @change="handleSeek"
              class="progress-slider"
            />
            <span class="total-time">{{ formatTime(duration) }}</span>
          </div>

          <div class="volume-controls">
            <el-button
              type="text"
              @click="toggleMute"
              size="small"
            >
              <el-icon>
                <Mute v-if="isMuted || volume === 0" />
                <VolumeSmall v-else-if="volume < 50" />
                <VolumeLarge v-else />
              </el-icon>
            </el-button>
            <el-slider
              v-model="volume"
              :max="100"
              :step="1"
              :show-tooltip="false"
              @change="handleVolumeChange"
              style="width: 80px;"
            />
          </div>

          <div class="playback-speed">
            <el-select v-model="playbackSpeed" size="small" style="width: 80px;" @change="handleSpeedChange">
              <el-option value="0.5" label="0.5x" />
              <el-option value="0.75" label="0.75x" />
              <el-option value="1" label="1x" />
              <el-option value="1.25" label="1.25x" />
              <el-option value="1.5" label="1.5x" />
              <el-option value="2" label="2x" />
            </el-select>
          </div>
        </div>
      </div>
    </div>

    <!-- Waveform Visualization -->
    <div class="waveform-container" v-if="showWaveform">
      <div class="waveform-header">
        <span>{{ $t('calls.waveform', 'Waveform') }}</span>
        <el-switch
          v-model="showWaveform"
          size="small"
          :active-text="$t('common.show')"
          :inactive-text="$t('common.hide')"
        />
      </div>
      <div class="waveform" ref="waveformRef">
        <!-- Mock waveform visualization -->
        <div class="waveform-bars">
          <div
            v-for="(bar, index) in waveformData"
            :key="index"
            class="waveform-bar"
            :style="{
              height: `${bar.height}%`,
              backgroundColor: getWaveformColor(index)
            }"
            @click="seekToPosition(index)"
          ></div>
        </div>
        <div
          class="waveform-progress"
          :style="{ width: `${progressPercentage}%` }"
        ></div>
      </div>
    </div>

    <!-- Synchronized Transcription -->
    <div class="sync-transcription" v-if="showTranscription">
      <div class="transcription-header">
        <span>{{ $t('calls.synchronizedTranscription', 'Synchronized Transcription') }}</span>
        <el-switch
          v-model="showTranscription"
          size="small"
          :active-text="$t('common.show')"
          :inactive-text="$t('common.hide')"
        />
      </div>
      <div class="transcription-content">
        <el-scrollbar height="200px">
          <div class="transcription-segments">
            <div
              v-for="(segment, index) in transcriptionSegments"
              :key="index"
              class="segment"
              :class="{ 'active': isSegmentActive(segment) }"
              @click="seekToTime(segment.startTime)"
            >
              <div class="segment-time">{{ formatTime(segment.startTime) }}</div>
              <div class="segment-speaker">{{ segment.speaker }}</div>
              <div class="segment-text">{{ segment.text }}</div>
            </div>
          </div>
        </el-scrollbar>
      </div>
    </div>

    <!-- Audio Quality & Metadata -->
    <div class="audio-metadata">
      <el-collapse v-model="expandedSections">
        <el-collapse-item :title="$t('calls.audioInfo', 'Audio Information')" name="info">
          <div class="metadata-grid">
            <div class="metadata-item">
              <span class="label">{{ $t('calls.duration') }}:</span>
              <span class="value">{{ formatTime(duration) }}</span>
            </div>
            <div class="metadata-item">
              <span class="label">{{ $t('calls.quality', 'Quality') }}:</span>
              <span class="value">{{ audioQuality }}</span>
            </div>
            <div class="metadata-item">
              <span class="label">{{ $t('calls.format', 'Format') }}:</span>
              <span class="value">{{ audioFormat }}</span>
            </div>
            <div class="metadata-item">
              <span class="label">{{ $t('calls.size', 'Size') }}:</span>
              <span class="value">{{ audioSize }}</span>
            </div>
            <div class="metadata-item">
              <span class="label">{{ $t('calls.channels', 'Channels') }}:</span>
              <span class="value">{{ audioChannels }}</span>
            </div>
            <div class="metadata-item">
              <span class="label">{{ $t('calls.sampleRate', 'Sample Rate') }}:</span>
              <span class="value">{{ sampleRate }}</span>
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item :title="$t('calls.analysisTools', 'Analysis Tools')" name="analysis">
          <div class="analysis-tools">
            <el-button-group>
              <el-button @click="analyzeAudio">
                <el-icon><DataAnalysis /></el-icon>
                {{ $t('calls.analyzeAudio', 'Analyze Audio') }}
              </el-button>
              <el-button @click="extractKeyMoments">
                <el-icon><Star /></el-icon>
                {{ $t('calls.keyMoments', 'Key Moments') }}
              </el-button>
              <el-button @click="generateSummary">
                <el-icon><Document /></el-icon>
                {{ $t('calls.generateSummary', 'Generate Summary') }}
              </el-button>
            </el-button-group>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- Keyboard Shortcuts Help -->
    <div class="shortcuts-help" v-if="showShortcuts">
      <el-alert
        :title="$t('calls.keyboardShortcuts', 'Keyboard Shortcuts')"
        type="info"
        :closable="false"
      >
        <div class="shortcuts-list">
          <div class="shortcut-item">
            <kbd>Space</kbd> - {{ $t('calls.playPause', 'Play/Pause') }}
          </div>
          <div class="shortcut-item">
            <kbd>←</kbd> / <kbd>→</kbd> - {{ $t('calls.seek', 'Seek 10s') }}
          </div>
          <div class="shortcut-item">
            <kbd>↑</kbd> / <kbd>↓</kbd> - {{ $t('calls.volume', 'Volume') }}
          </div>
          <div class="shortcut-item">
            <kbd>M</kbd> - {{ $t('calls.mute', 'Mute') }}
          </div>
        </div>
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  Download,
  Share,
  VideoPlay,
  VideoPause,
  Mute,
  VolumeSmall,
  VolumeLarge,
  DataAnalysis,
  Star,
  Document
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const { t } = useI18n()

// Props
const props = defineProps<{
  call: any
}>()

// Emits
const emit = defineEmits(['close'])

// Refs
const audioRef = ref<HTMLAudioElement>()
const waveformRef = ref<HTMLElement>()

// Reactive state
const isLoading = ref(false)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(50)
const isMuted = ref(false)
const playbackSpeed = ref('1')
const showWaveform = ref(true)
const showTranscription = ref(true)
const showShortcuts = ref(false)
const expandedSections = ref(['info'])

// Audio metadata
const audioQuality = ref('HD (48kHz/16bit)')
const audioFormat = ref('MP3')
const audioSize = ref('2.3 MB')
const audioChannels = ref('Stereo')
const sampleRate = ref('48 kHz')

// Mock audio URL (in real app would be actual recording URL)
const audioUrl = ref('/mock-audio/call-recording.mp3')

// Mock waveform data
const waveformData = ref(
  Array.from({ length: 200 }, () => ({
    height: Math.random() * 100 + 20
  }))
)

// Mock transcription segments with timing
const transcriptionSegments = ref([
  {
    startTime: 0,
    endTime: 15,
    speaker: 'Customer',
    text: 'שלום, אני צריך עזרה עם החשבון שלי'
  },
  {
    startTime: 15,
    endTime: 25,
    speaker: 'Agent',
    text: 'שלום! אשמח לעזור לך. מה הבעיה?'
  },
  {
    startTime: 25,
    endTime: 40,
    speaker: 'Customer',
    text: 'לא מצליח להתחבר למערכת מזה כמה ימים'
  },
  {
    startTime: 40,
    endTime: 60,
    speaker: 'Agent',
    text: 'אני מבין. בואו ננסה לפתור את הבעיה יחד'
  }
])

// Computed properties
const progressPercentage = computed(() => {
  return duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
})

// Methods
const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const formatDateTime = (date: Date): string => {
  return dayjs(date).format('DD/MM/YYYY HH:mm')
}

const togglePlayPause = () => {
  if (!audioRef.value) return
  
  if (isPlaying.value) {
    audioRef.value.pause()
  } else {
    audioRef.value.play()
  }
}

const handleSeek = (value: number) => {
  if (!audioRef.value) return
  audioRef.value.currentTime = value
}

const handleVolumeChange = (value: number) => {
  if (!audioRef.value) return
  audioRef.value.volume = value / 100
  isMuted.value = value === 0
}

const handleSpeedChange = (value: string) => {
  if (!audioRef.value) return
  audioRef.value.playbackRate = parseFloat(value)
}

const toggleMute = () => {
  if (!audioRef.value) return
  
  if (isMuted.value) {
    audioRef.value.volume = volume.value / 100
    isMuted.value = false
  } else {
    audioRef.value.volume = 0
    isMuted.value = true
  }
}

const handleLoadedMetadata = () => {
  if (!audioRef.value) return
  duration.value = audioRef.value.duration
  
  // Set initial volume
  audioRef.value.volume = volume.value / 100
}

const handleTimeUpdate = () => {
  if (!audioRef.value) return
  currentTime.value = audioRef.value.currentTime
}

const handleEnded = () => {
  isPlaying.value = false
  currentTime.value = 0
}

const seekToPosition = (barIndex: number) => {
  const percentage = barIndex / waveformData.value.length
  const newTime = percentage * duration.value
  handleSeek(newTime)
}

const seekToTime = (time: number) => {
  handleSeek(time)
}

const isSegmentActive = (segment: any): boolean => {
  return currentTime.value >= segment.startTime && currentTime.value <= segment.endTime
}

const getWaveformColor = (index: number): string => {
  const percentage = index / waveformData.value.length
  const currentPercentage = progressPercentage.value / 100
  
  if (percentage <= currentPercentage) {
    return 'var(--el-color-primary)'
  }
  return 'var(--el-border-color-light)'
}

const downloadRecording = () => {
  // In real app, would trigger actual download
  ElMessage.success(t('calls.downloadStarted'))
}

const shareRecording = () => {
  // In real app, would open share dialog
  ElMessage.info(t('calls.shareLink', 'Share link copied'))
}

const analyzeAudio = () => {
  ElMessage.info(t('calls.analysisStarted', 'Audio analysis started'))
}

const extractKeyMoments = () => {
  ElMessage.info(t('calls.extractingMoments', 'Extracting key moments'))
}

const generateSummary = () => {
  ElMessage.info(t('calls.generatingSummary', 'Generating audio summary'))
}

// Keyboard shortcuts
const handleKeyboard = (event: KeyboardEvent) => {
  if (!audioRef.value) return
  
  switch (event.code) {
    case 'Space':
      event.preventDefault()
      togglePlayPause()
      break
    case 'ArrowLeft':
      event.preventDefault()
      handleSeek(Math.max(0, currentTime.value - 10))
      break
    case 'ArrowRight':
      event.preventDefault()
      handleSeek(Math.min(duration.value, currentTime.value + 10))
      break
    case 'ArrowUp':
      event.preventDefault()
      volume.value = Math.min(100, volume.value + 10)
      handleVolumeChange(volume.value)
      break
    case 'ArrowDown':
      event.preventDefault()
      volume.value = Math.max(0, volume.value - 10)
      handleVolumeChange(volume.value)
      break
    case 'KeyM':
      event.preventDefault()
      toggleMute()
      break
  }
}

// Lifecycle
onMounted(() => {
  // Simulate loading audio metadata
  setTimeout(() => {
    duration.value = 180 // 3 minutes mock duration
  }, 500)
  
  // Add keyboard event listeners
  document.addEventListener('keydown', handleKeyboard)
  
  // Show shortcuts help initially
  setTimeout(() => {
    showShortcuts.value = true
    setTimeout(() => {
      showShortcuts.value = false
    }, 5000)
  }, 1000)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyboard)
})
</script>

<style lang="scss" scoped>
.call-audio-player {
  .player-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--el-border-color-light);
    
    .call-info {
      h4 {
        margin: 0 0 4px 0;
        color: var(--el-color-primary);
        font-size: 18px;
        font-weight: 600;
      }
      
      p {
        margin: 0;
        color: var(--el-text-color-secondary);
        font-size: 14px;
      }
    }
  }
  
  .audio-player-container {
    margin-bottom: 24px;
    
    .audio-player {
      background-color: var(--el-fill-color-extra-light);
      border-radius: 12px;
      padding: 24px;
      
      .player-controls-main {
        display: flex;
        align-items: center;
        gap: 20px;
        
        .time-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          
          .current-time,
          .total-time {
            font-family: $font-family-monospace;
            font-size: 14px;
            color: var(--el-text-color-primary);
            min-width: 40px;
          }
          
          .progress-slider {
            flex: 1;
            margin: 0 8px;
          }
        }
        
        .volume-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .playback-speed {
          display: flex;
          align-items: center;
        }
      }
    }
  }
  
  .waveform-container {
    margin-bottom: 24px;
    
    .waveform-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      
      span {
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
    }
    
    .waveform {
      position: relative;
      height: 80px;
      background-color: var(--el-fill-color-light);
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      
      .waveform-bars {
        display: flex;
        align-items: end;
        height: 100%;
        gap: 1px;
        
        .waveform-bar {
          flex: 1;
          min-height: 4px;
          transition: all 0.2s ease;
          
          &:hover {
            opacity: 0.8;
          }
        }
      }
      
      .waveform-progress {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        background: linear-gradient(
          90deg,
          var(--el-color-primary-light-3) 0%,
          var(--el-color-primary) 100%
        );
        pointer-events: none;
        transition: width 0.1s ease;
      }
    }
  }
  
  .sync-transcription {
    margin-bottom: 24px;
    
    .transcription-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      
      span {
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
    }
    
    .transcription-content {
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      
      .transcription-segments {
        .segment {
          padding: 12px 16px;
          border-bottom: 1px solid var(--el-border-color-lighter);
          cursor: pointer;
          transition: all 0.2s ease;
          
          &:last-child {
            border-bottom: none;
          }
          
          &:hover {
            background-color: var(--el-fill-color-light);
          }
          
          &.active {
            background-color: var(--el-color-primary-light-9);
            border-left: 3px solid var(--el-color-primary);
          }
          
          .segment-time {
            font-size: 12px;
            color: var(--el-text-color-secondary);
            font-family: $font-family-monospace;
            margin-bottom: 4px;
          }
          
          .segment-speaker {
            font-weight: 600;
            color: var(--el-color-primary);
            font-size: 13px;
            margin-bottom: 4px;
          }
          
          .segment-text {
            color: var(--el-text-color-primary);
            line-height: 1.5;
          }
        }
      }
    }
  }
  
  .audio-metadata {
    margin-bottom: 24px;
    
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      
      .metadata-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        
        .label {
          color: var(--el-text-color-secondary);
          font-weight: 500;
        }
        
        .value {
          color: var(--el-text-color-primary);
          font-family: $font-family-monospace;
        }
      }
    }
    
    .analysis-tools {
      .el-button-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
    }
  }
  
  .shortcuts-help {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    max-width: 300px;
    
    .shortcuts-list {
      display: grid;
      gap: 8px;
      
      .shortcut-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        
        kbd {
          background-color: var(--el-fill-color-dark);
          color: var(--el-text-color-primary);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: $font-family-monospace;
          font-size: 11px;
          min-width: 20px;
          text-align: center;
        }
      }
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .call-audio-player {
    .player-controls-main {
      flex-direction: column;
      gap: 16px;
      
      .time-controls {
        width: 100%;
      }
      
      .volume-controls,
      .playback-speed {
        width: 100%;
        justify-content: center;
      }
    }
    
    .metadata-grid {
      grid-template-columns: 1fr !important;
    }
    
    .shortcuts-help {
      position: relative;
      top: auto;
      right: auto;
      max-width: none;
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .call-audio-player {
    .segment.active {
      border-left: none;
      border-right: 3px solid var(--el-color-primary);
    }
    
    .shortcuts-help {
      right: auto;
      left: 20px;
    }
  }
}

// Dark mode adjustments
// Dark mode adjustments handled by CSS variables
</style>