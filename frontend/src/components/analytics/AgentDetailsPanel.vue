<template>
  <div class="agent-details-panel">
    <!-- Agent Header -->
    <div class="agent-header">
      <div class="agent-avatar">
        <el-avatar :size="64" :src="agent.avatar">
          <el-icon><UserFilled /></el-icon>
        </el-avatar>
        <div class="status-indicator" :class="agent.status"></div>
      </div>
      <div class="agent-info">
        <h2>{{ agent.name }}</h2>
        <p class="department">{{ agent.department }}</p>
        <div class="contact-info">
          <span>{{ agent.email || 'sarah.johnson@company.com' }}</span>
          <span>{{ agent.phone || '+1 (555) 123-4567' }}</span>
        </div>
      </div>
      <div class="agent-actions">
        <el-button type="primary" @click="sendMessage">
          <el-icon><Message /></el-icon>
          {{ $t('common.message') }}
        </el-button>
        <el-button @click="scheduleCall">
          <el-icon><Phone /></el-icon>
          {{ $t('common.call') }}
        </el-button>
      </div>
    </div>

    <!-- Performance Metrics -->
    <div class="performance-metrics">
      <div class="metric-card">
        <div class="metric-icon">
          <el-icon><Star /></el-icon>
        </div>
        <div class="metric-content">
          <div class="metric-value">{{ agent.rating.toFixed(1) }}</div>
          <div class="metric-label">{{ $t('analytics.rating', 'Rating') }}</div>
          <el-rate
            v-model="agent.rating"
            :max="5"
            :colors="['#f56c6c', '#e6a23c', '#67c23a']"
            :disabled="true"
            size="small"
          />
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon">
          <el-icon><Phone /></el-icon>
        </div>
        <div class="metric-content">
          <div class="metric-value">{{ agent.totalCalls }}</div>
          <div class="metric-label">{{ $t('analytics.totalCalls', 'Total Calls') }}</div>
          <div class="metric-change positive">+12% {{ $t('analytics.thisWeek', 'this week') }}</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon">
          <el-icon><Check /></el-icon>
        </div>
        <div class="metric-content">
          <div class="metric-value">{{ agent.resolutionRate }}%</div>
          <div class="metric-label">{{ $t('analytics.resolutionRate', 'Resolution Rate') }}</div>
          <el-progress
            :percentage="agent.resolutionRate"
            :color="getProgressColor(agent.resolutionRate)"
            :stroke-width="4"
            :show-text="false"
          />
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon">
          <el-icon><Timer /></el-icon>
        </div>
        <div class="metric-content">
          <div class="metric-value">{{ agent.avgHandleTime }}</div>
          <div class="metric-label">{{ $t('analytics.avgHandleTime', 'Avg Handle Time') }}</div>
          <div class="metric-change negative">-8% {{ $t('analytics.thisWeek', 'this week') }}</div>
        </div>
      </div>
    </div>

    <!-- Performance Charts -->
    <div class="performance-charts">
      <div class="chart-section">
        <div class="chart-header">
          <h3>{{ $t('analytics.dailyPerformance', 'Daily Performance') }}</h3>
          <el-radio-group v-model="selectedChartMetric" @change="updateChart">
            <el-radio-button value="calls">{{ $t('analytics.calls', 'Calls') }}</el-radio-button>
            <el-radio-button value="rating">{{ $t('analytics.rating', 'Rating') }}</el-radio-button>
            <el-radio-button value="resolution">{{ $t('analytics.resolution', 'Resolution') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="chart-container">
          <LineChart
            :data="performanceChartData"
            :options="performanceChartOptions"
            height="250px"
          />
        </div>
      </div>

      <div class="chart-section">
        <div class="chart-header">
          <h3>{{ $t('analytics.callCategories', 'Call Categories') }}</h3>
        </div>
        <div class="chart-container">
          <PieChart
            :data="categoryChartData"
            :options="categoryChartOptions"
            height="250px"
          />
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="recent-activity">
      <div class="activity-header">
        <h3>{{ $t('analytics.recentActivity', 'Recent Activity') }}</h3>
        <el-button size="small" type="primary" text @click="viewAllActivity">
          {{ $t('analytics.viewAll', 'View All') }}
        </el-button>
      </div>
      <div class="activity-list">
        <div v-for="activity in recentActivities" :key="activity.id" class="activity-item">
          <div class="activity-icon" :class="activity.type">
            <el-icon>
              <Phone v-if="activity.type === 'call'" />
              <Message v-if="activity.type === 'message'" />
              <Star v-if="activity.type === 'review'" />
              <Timer v-if="activity.type === 'break'" />
            </el-icon>
          </div>
          <div class="activity-content">
            <div class="activity-title">{{ activity.title }}</div>
            <div class="activity-description">{{ activity.description }}</div>
            <div class="activity-time">{{ formatTime(activity.timestamp) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Skills and Certifications -->
    <div class="skills-section">
      <div class="section-header">
        <h3>{{ $t('analytics.skillsAndCertifications', 'Skills & Certifications') }}</h3>
        <el-button size="small" type="primary" text @click="manageSkills">
          {{ $t('analytics.manage', 'Manage') }}
        </el-button>
      </div>
      <div class="skills-grid">
        <div v-for="skill in agentSkills" :key="skill.name" class="skill-item">
          <div class="skill-name">{{ skill.name }}</div>
          <div class="skill-level">
            <el-progress
              :percentage="skill.level"
              :color="getSkillColor(skill.level)"
              :stroke-width="6"
              :show-text="false"
            />
            <span class="skill-percentage">{{ skill.level }}%</span>
          </div>
          <div class="skill-badge" v-if="skill.certified">
            <el-icon><Medal /></el-icon>
            {{ $t('analytics.certified', 'Certified') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Performance Goals -->
    <div class="goals-section">
      <div class="section-header">
        <h3>{{ $t('analytics.performanceGoals', 'Performance Goals') }}</h3>
        <el-button size="small" type="primary" text @click="setGoals">
          {{ $t('analytics.setGoals', 'Set Goals') }}
        </el-button>
      </div>
      <div class="goals-grid">
        <div v-for="goal in performanceGoals" :key="goal.id" class="goal-item">
          <div class="goal-header">
            <div class="goal-title">{{ goal.title }}</div>
            <div class="goal-progress">{{ goal.current }}/{{ goal.target }}</div>
          </div>
          <div class="goal-bar">
            <el-progress
              :percentage="(goal.current / goal.target) * 100"
              :color="getGoalColor(goal.current / goal.target)"
              :stroke-width="8"
              :show-text="false"
            />
          </div>
          <div class="goal-timeline">
            <span class="goal-deadline">{{ $t('analytics.deadline', 'Deadline') }}: {{ goal.deadline }}</span>
            <span class="goal-status" :class="goal.status">{{ $t(`status.${goal.status}`, goal.status) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  UserFilled,
  Message,
  Phone,
  Star,
  Check,
  Timer,
  Medal
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import LineChart from '@/components/charts/LineChart.vue'
import PieChart from '@/components/charts/PieChart.vue'

const { t } = useI18n()

// Props
const props = defineProps<{
  agent: any
  dateRange: [string, string]
}>()

// Emits
const emit = defineEmits(['close'])

// Reactive state
const selectedChartMetric = ref('calls')

// Chart data
const performanceChartData = ref({
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  datasets: [{
    label: 'Calls Handled',
    data: [45, 52, 38, 47, 49, 41, 35],
    borderColor: '#409eff',
    backgroundColor: 'rgba(64, 158, 255, 0.1)',
    tension: 0.4
  }]
})

const performanceChartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false
    }
  },
  scales: {
    y: {
      beginAtZero: true
    }
  }
})

const categoryChartData = ref({
  labels: ['Support', 'Sales', 'Technical', 'Billing', 'Other'],
  datasets: [{
    data: [35, 25, 20, 15, 5],
    backgroundColor: [
      '#409eff',
      '#67c23a',
      '#e6a23c',
      '#f56c6c',
      '#909399'
    ]
  }]
})

const categoryChartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom'
    }
  }
})

// Mock data
const recentActivities = ref([
  {
    id: 1,
    type: 'call',
    title: 'Customer Support Call',
    description: 'Resolved billing inquiry for premium customer',
    timestamp: dayjs().subtract(2, 'hour').toDate()
  },
  {
    id: 2,
    type: 'review',
    title: 'Received 5-star Rating',
    description: 'Excellent service and quick resolution',
    timestamp: dayjs().subtract(4, 'hour').toDate()
  },
  {
    id: 3,
    type: 'message',
    title: 'Internal Message',
    description: 'Updated customer escalation procedure',
    timestamp: dayjs().subtract(1, 'day').toDate()
  },
  {
    id: 4,
    type: 'break',
    title: 'Training Session',
    description: 'Completed product knowledge training',
    timestamp: dayjs().subtract(2, 'day').toDate()
  }
])

const agentSkills = ref([
  {
    name: 'Customer Service',
    level: 95,
    certified: true
  },
  {
    name: 'Technical Support',
    level: 88,
    certified: true
  },
  {
    name: 'Sales',
    level: 72,
    certified: false
  },
  {
    name: 'Problem Solving',
    level: 90,
    certified: true
  },
  {
    name: 'Hebrew Language',
    level: 100,
    certified: true
  },
  {
    name: 'Product Knowledge',
    level: 85,
    certified: false
  }
])

const performanceGoals = ref([
  {
    id: 1,
    title: 'Monthly Call Target',
    current: 180,
    target: 200,
    deadline: '2024-01-31',
    status: 'on-track'
  },
  {
    id: 2,
    title: 'Customer Satisfaction',
    current: 4.8,
    target: 4.5,
    deadline: '2024-01-31',
    status: 'achieved'
  },
  {
    id: 3,
    title: 'Resolution Rate',
    current: 85,
    target: 90,
    deadline: '2024-01-31',
    status: 'behind'
  }
])

// Methods
const updateChart = () => {
  const datasets = {
    calls: {
      label: 'Calls Handled',
      data: [45, 52, 38, 47, 49, 41, 35],
      borderColor: '#409eff',
      backgroundColor: 'rgba(64, 158, 255, 0.1)'
    },
    rating: {
      label: 'Average Rating',
      data: [4.2, 4.5, 4.1, 4.6, 4.8, 4.3, 4.7],
      borderColor: '#67c23a',
      backgroundColor: 'rgba(103, 194, 58, 0.1)'
    },
    resolution: {
      label: 'Resolution Rate (%)',
      data: [88, 92, 85, 90, 94, 87, 91],
      borderColor: '#e6a23c',
      backgroundColor: 'rgba(230, 162, 60, 0.1)'
    }
  }

  performanceChartData.value = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [datasets[selectedChartMetric.value as keyof typeof datasets]]
  }
}

const sendMessage = () => {
  ElMessage.success(t('analytics.messageSent', 'Message sent to {name}', { name: props.agent.name }))
}

const scheduleCall = () => {
  ElMessage.info(t('analytics.callScheduled', 'Call scheduled with {name}', { name: props.agent.name }))
}

const viewAllActivity = () => {
  ElMessage.info(t('analytics.viewingAllActivity', 'Viewing all activity for {name}', { name: props.agent.name }))
}

const manageSkills = () => {
  ElMessage.info(t('analytics.managingSkills', 'Managing skills for {name}', { name: props.agent.name }))
}

const setGoals = () => {
  ElMessage.info(t('analytics.settingGoals', 'Setting goals for {name}', { name: props.agent.name }))
}

const formatTime = (timestamp: Date): string => {
  return dayjs(timestamp).fromNow()
}

const getProgressColor = (value: number): string => {
  if (value >= 90) return '#67c23a'
  if (value >= 70) return '#e6a23c'
  return '#f56c6c'
}

const getSkillColor = (level: number): string => {
  if (level >= 90) return '#67c23a'
  if (level >= 70) return '#409eff'
  return '#e6a23c'
}

const getGoalColor = (progress: number): string => {
  if (progress >= 1) return '#67c23a'
  if (progress >= 0.8) return '#409eff'
  if (progress >= 0.5) return '#e6a23c'
  return '#f56c6c'
}
</script>

<style lang="scss" scoped>
.agent-details-panel {
  padding: 24px;

  .agent-header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    .agent-avatar {
      position: relative;

      .status-indicator {
        position: absolute;
        bottom: 4px;
        right: 4px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--el-bg-color);

        &.online {
          background-color: #67c23a;
        }

        &.busy {
          background-color: #e6a23c;
        }

        &.offline {
          background-color: #909399;
        }
      }
    }

    .agent-info {
      flex: 1;

      h2 {
        margin: 0 0 8px 0;
        font-size: 24px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }

      .department {
        margin: 0 0 12px 0;
        font-size: 16px;
        color: var(--el-text-color-secondary);
      }

      .contact-info {
        display: flex;
        flex-direction: column;
        gap: 4px;

        span {
          font-size: 14px;
          color: var(--el-text-color-regular);
        }
      }
    }

    .agent-actions {
      display: flex;
      gap: 12px;
    }
  }

  .performance-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 32px;

    .metric-card {
      background: var(--el-fill-color-extra-light);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 16px;

      .metric-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: var(--el-color-primary-light-9);
        display: flex;
        align-items: center;
        justify-content: center;

        .el-icon {
          font-size: 24px;
          color: var(--el-color-primary);
        }
      }

      .metric-content {
        flex: 1;

        .metric-value {
          font-size: 24px;
          font-weight: 600;
          color: var(--el-text-color-primary);
          margin-bottom: 4px;
        }

        .metric-label {
          font-size: 14px;
          color: var(--el-text-color-secondary);
          margin-bottom: 8px;
        }

        .metric-change {
          font-size: 12px;
          font-weight: 500;

          &.positive {
            color: #67c23a;
          }

          &.negative {
            color: #f56c6c;
          }
        }
      }
    }
  }

  .performance-charts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;

    .chart-section {
      background: var(--el-fill-color-extra-light);
      border-radius: 8px;
      padding: 20px;

      .chart-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;

        h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--el-text-color-primary);
        }
      }

      .chart-container {
        height: 250px;
      }
    }
  }

  .recent-activity {
    margin-bottom: 32px;

    .activity-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;

      h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }
    }

    .activity-list {
      display: flex;
      flex-direction: column;
      gap: 12px;

      .activity-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        background: var(--el-fill-color-extra-light);
        border-radius: 8px;

        .activity-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          &.call {
            background: var(--el-color-primary-light-9);
            color: var(--el-color-primary);
          }

          &.message {
            background: var(--el-color-success-light-9);
            color: var(--el-color-success);
          }

          &.review {
            background: var(--el-color-warning-light-9);
            color: var(--el-color-warning);
          }

          &.break {
            background: var(--el-color-info-light-9);
            color: var(--el-color-info);
          }
        }

        .activity-content {
          flex: 1;

          .activity-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--el-text-color-primary);
            margin-bottom: 4px;
          }

          .activity-description {
            font-size: 13px;
            color: var(--el-text-color-secondary);
            margin-bottom: 8px;
          }

          .activity-time {
            font-size: 12px;
            color: var(--el-text-color-placeholder);
          }
        }
      }
    }
  }

  .skills-section,
  .goals-section {
    margin-bottom: 32px;

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;

      h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }
    }

    .skills-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;

      .skill-item {
        background: var(--el-fill-color-extra-light);
        border-radius: 8px;
        padding: 16px;

        .skill-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--el-text-color-primary);
          margin-bottom: 8px;
        }

        .skill-level {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;

          .skill-percentage {
            font-size: 12px;
            color: var(--el-text-color-secondary);
            min-width: 35px;
          }
        }

        .skill-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--el-color-success);
          font-weight: 500;
        }
      }
    }

    .goals-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;

      .goal-item {
        background: var(--el-fill-color-extra-light);
        border-radius: 8px;
        padding: 16px;

        .goal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;

          .goal-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--el-text-color-primary);
          }

          .goal-progress {
            font-size: 14px;
            color: var(--el-text-color-secondary);
          }
        }

        .goal-bar {
          margin-bottom: 8px;
        }

        .goal-timeline {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;

          .goal-deadline {
            color: var(--el-text-color-secondary);
          }

          .goal-status {
            font-weight: 500;

            &.on-track {
              color: var(--el-color-primary);
            }

            &.achieved {
              color: var(--el-color-success);
            }

            &.behind {
              color: var(--el-color-danger);
            }
          }
        }
      }
    }
  }
}

// Mobile adjustments
@include mobile-only {
  .agent-details-panel {
    padding: 16px;

    .agent-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;

      .agent-actions {
        width: 100%;
        justify-content: stretch;

        .el-button {
          flex: 1;
        }
      }
    }

    .performance-metrics {
      grid-template-columns: 1fr;
    }

    .performance-charts {
      grid-template-columns: 1fr;
    }

    .skills-grid {
      grid-template-columns: 1fr;
    }
  }
}

// RTL adjustments
[dir="rtl"] {
  .agent-details-panel {
    .agent-header {
      flex-direction: row-reverse;
    }

    .activity-item {
      flex-direction: row-reverse;
    }

    .goal-header {
      flex-direction: row-reverse;
    }
  }
}
</style>