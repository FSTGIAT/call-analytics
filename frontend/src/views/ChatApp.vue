<template>
  <div class="chat-app">
    <!-- Header -->
    <header class="chat-header">
      <div class="header-content">
        <div class="brand">
          <div class="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="12" fill="url(#gradient)" />
              <path d="M12 20l4-4-4-4v8z" fill="white" />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#667eea" />
                  <stop offset="100%" style="stop-color:#764ba2" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div class="brand-text">
            <h1>פלאפון AI</h1>
            <p>כלי ניתוח נתונים ובינה עסקית</p>
          </div>
        </div>
        
        <div class="user-info">
          <div class="user-badge" :class="{ 'admin': authStore.isAdmin }">
            <div class="user-icon">
              <svg v-if="authStore.isAdmin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 0L10.472 5.528L16 8L10.472 10.472L8 16L5.528 10.472L0 8L5.528 5.528L8 0Z" fill="currentColor"/>
              </svg>
              <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
                <path d="M2 14C2 11.7909 4.79086 10 8 10C11.2091 10 14 11.7909 14 14" stroke="currentColor" stroke-width="1.5" fill="none"/>
              </svg>
            </div>
            <span v-if="authStore.isAdmin">מנהל מערכת</span>
            <span v-else>משתמש</span>
          </div>
          
          <button @click="clearChatHistory" class="clear-button" title="נקה היסטוריית צ'אט">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 6L5 4M5 4L9 8L13 4M5 4V14C5 14.5523 5.44772 15 6 15H12C12.5523 15 13 14.5523 13 14V4M5 4H13M8 1V3M10 1V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          
          <button @click="logout" class="logout-button" title="התנתק מהמערכת">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M11 2H14C14.5523 2 15 2.44772 15 3V15C15 15.5523 14.5523 16 14 16H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M7 6L10 9L7 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 9H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Chat Container -->
    <main class="chat-main">
      <div class="chat-container">
        <!-- Welcome Section (shown when no messages) -->
        <div v-if="messages.length <= 1" class="welcome-section">
          <div class="welcome-content">
            <div class="welcome-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" fill="url(#welcomeGradient)" />
                <path d="M18 28l6-6-6-6v12z" fill="white" />
                <defs>
                  <linearGradient id="welcomeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#667eea" />
                    <stop offset="100%" style="stop-color:#764ba2" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h2>מערכת ניתוח שיחות פלאפון</h2>
            <p v-if="authStore.isAdmin">
              ניתוח נתוני שיחות ותובנות עסקיות לכל הלקוחות במערכת.
            </p>
            <p v-else>
              ניתוח נתוני השיחות שלך ותובנות לשיפור השירות.
            </p>
            
            <div class="example-queries">
              <h3>דוגמאות לשאלות:</h3>
              <div class="example-grid">
                <button 
                  v-for="example in currentExamples" 
                  :key="example.id"
                  @click="selectExample(example.text)"
                  class="example-button"
                >
                  <span class="example-icon">{{ example.icon }}</span>
                  <span class="example-text">{{ example.text }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Messages Area -->
        <div class="messages-container" ref="messagesContainer">
          <div 
            v-for="message in displayMessages" 
            :key="message.id"
            class="message-wrapper"
            :class="{ 'user-message': message.isUser, 'ai-message': !message.isUser }"
          >
            <div class="message">
              <div v-if="!message.isUser" class="message-avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill="url(#avatarGradient)" />
                  <path d="M9 14l3-3-3-3v6z" fill="white" />
                  <defs>
                    <linearGradient id="avatarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#667eea" />
                      <stop offset="100%" style="stop-color:#764ba2" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              
              <div class="message-content">
                <div class="message-text" v-html="formatMessage(message.text)"></div>
                <div class="message-time">{{ formatTime(message.timestamp) }}</div>
              </div>
            </div>
          </div>
          
          <!-- Loading Message -->
          <div v-if="isLoading" class="message-wrapper ai-message">
            <div class="message">
              <div class="message-avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill="url(#loadingGradient)" />
                  <path d="M9 14l3-3-3-3v6z" fill="white" />
                  <defs>
                    <linearGradient id="loadingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#667eea" />
                      <stop offset="100%" style="stop-color:#764ba2" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              
              <div class="message-content loading">
                <div class="typing-animation">
                  <div class="typing-dot"></div>
                  <div class="typing-dot"></div>
                  <div class="typing-dot"></div>
                </div>
                <div class="loading-text">מעבד את בקשתך...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Input Area -->
    <footer class="chat-footer">
      <div class="input-container">
        <div class="input-wrapper">
          <textarea
            v-model="newMessage"
            @keyup.enter="handleEnter"
            @input="adjustTextareaHeight"
            :disabled="isLoading"
            placeholder="שאל שאלה על נתוני השיחות..."
            class="message-input"
            ref="messageInput"
            rows="1"
          />
          
          <button 
            @click="sendMessage"
            :disabled="isLoading || !newMessage.trim()"
            class="send-button"
            :class="{ 'loading': isLoading }"
          >
            <svg v-if="!isLoading" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M2 10l16-8-8 8-8 0z" fill="currentColor" />
              <path d="M10 18l8-8" stroke="currentColor" stroke-width="2" />
            </svg>
            <div v-else class="button-spinner"></div>
          </button>
        </div>
        
        <div class="input-footer">
          <div class="timeout-info" v-if="currentTimeout">
            <span class="timeout-badge">⏱️ {{ Math.round(currentTimeout / 1000) }}s timeout</span>
          </div>
          <div class="powered-by">
            מופעל על ידי DictaLM 2.0 | פלאפון AI Analytics
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { apiUtils } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

interface Message {
  id: number
  text: string
  isUser: boolean
  timestamp: Date
}

interface ExampleQuery {
  id: string
  icon: string
  text: string
}

const authStore = useAuthStore()
const router = useRouter()

// Reactive data
const messages = ref<Message[]>([
  {
    id: 1,
    text: "שלום! אני כלי ניתוח נתונים של פלאפון. איך אוכל לעזור לך היום?",
    isUser: false,
    timestamp: new Date()
  }
])

const newMessage = ref('')
const isLoading = ref(false)
const currentTimeout = ref(0)
const messagesContainer = ref<HTMLElement>()
const messageInput = ref<HTMLTextAreaElement>()
const conversationId = ref<string>('') // Persistent conversation ID

// Example queries for admin users
const adminExamples: ExampleQuery[] = [
  { id: '1', icon: '🏢', text: 'הצג סטטיסטיקות כלל הלקוחות' },
  { id: '2', icon: '📊', text: 'איזה לקוח הכי פעיל השבוע?' },
  { id: '3', icon: '⚠️', text: 'הצג דוח בעיות מכל המערכת' },
  { id: '4', icon: '💹', text: 'נתח מגמות שיחות במערכת' },
  { id: '5', icon: '🔧', text: 'איזה לקוחות זקוקים לתמיכה?' },
  { id: '6', icon: '📈', text: 'סיכום ביצועים של כל הלקוחות' }
]

// Example queries for customer users
const customerExamples: ExampleQuery[] = [
  { id: '1', icon: '📞', text: 'הצג את השיחות שלי' },
  { id: '2', icon: '📊', text: 'כמה שיחות ביצעתי השבוע?' },
  { id: '3', icon: '🕒', text: 'מה משך השיחות שלי?' },
  { id: '4', icon: '📈', text: 'איך משתפר השירות שלי?' },
  { id: '5', icon: '🔍', text: 'יש בעיות בשיחות שלי?' },
  { id: '6', icon: '💬', text: 'סכם את השיחות שלי היום' }
]

// Computed properties
const displayMessages = computed(() => {
  return messages.value.slice(1) // Skip the initial greeting when showing full conversation
})

const currentExamples = computed(() => {
  console.log('Computing examples - isAdmin:', authStore.isAdmin, 'user:', authStore.user)
  return authStore.isAdmin ? adminExamples : customerExamples
})

// Methods
const clearChatHistory = () => {
  // Clear chat messages except the initial greeting
  messages.value = [
    {
      id: 1,
      text: "שלום! אני כלי ניתוח נתונים של פלאפון. איך אוכל לעזור לך היום?",
      isUser: false,
      timestamp: new Date()
    }
  ]
  
  // Generate new conversation ID for fresh start
  conversationId.value = `${authStore.user?.userId || 'user'}-chat-${Date.now()}`
  
  // Clear any cached responses
  if (window.localStorage) {
    window.localStorage.removeItem('chat-cache')
  }
  
  // Force reload user profile to ensure fresh context
  authStore.fetchUserProfile()
  
  ElMessage.success('היסטוריית הצ\'אט נוקתה')
  console.log('Chat history cleared, fresh start with new conversation ID:', conversationId.value)
}

const logout = async () => {
  try {
    await authStore.logout()
    ElMessage.success('התנתקת בהצלחה')
    router.push('/login')
  } catch (error) {
    console.error('Logout error:', error)
    ElMessage.error('שגיאה בהתנתקות')
  }
}

const selectExample = (text: string) => {
  newMessage.value = text
  nextTick(() => {
    if (messageInput.value) {
      messageInput.value.focus()
    }
  })
}

const adjustTextareaHeight = () => {
  if (messageInput.value) {
    messageInput.value.style.height = 'auto'
    messageInput.value.style.height = Math.min(messageInput.value.scrollHeight, 120) + 'px'
  }
}

const handleEnter = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    return // Allow multi-line with Shift+Enter
  }
  event.preventDefault()
  sendMessage()
}

const analyzeComplexity = (text: string): number => {
  const textClean = text.trim()
  const analysisKeywords = ['נתח', 'ניתוח', 'analyze', 'analysis', 'סיכום', 'סכם', 'summary', 'summarize', 'דוח', 'report', 'תובנות', 'insights']
  const hasAnalysisKeyword = analysisKeywords.some(keyword => 
    textClean.toLowerCase().includes(keyword.toLowerCase())
  )
  
  if (hasAnalysisKeyword) return 2.5
  if (textClean.length <= 20) return 1.0
  if (textClean.length <= 100) return 1.5
  return 2.5
}

const calculateTimeout = (complexity: number): number => {
  const baseTimeout = 30000
  if (complexity >= 2.5) return baseTimeout * 3.0
  if (complexity >= 2.0) return baseTimeout * 2.0
  if (complexity >= 1.5) return baseTimeout * 1.5
  return baseTimeout
}

const sendMessage = async () => {
  if (!newMessage.value.trim() || isLoading.value) return

  const userMessage: Message = {
    id: Date.now(),
    text: newMessage.value,
    isUser: true,
    timestamp: new Date()
  }
  
  messages.value.push(userMessage)
  
  const messageText = newMessage.value
  const complexity = analyzeComplexity(messageText)
  currentTimeout.value = calculateTimeout(complexity)
  
  newMessage.value = ''
  isLoading.value = true
  
  // Reset textarea height
  if (messageInput.value) {
    messageInput.value.style.height = 'auto'
  }

  await scrollToBottom()

  try {
    console.log('Sending request:', messageText)
    console.log('Current user context:', authStore.user)
    console.log('Current token:', authStore.token?.substring(0, 20) + '...')
    
    // Use persistent conversation ID or generate one if needed
    if (!conversationId.value) {
      conversationId.value = `${authStore.user?.userId || 'user'}-chat-${Date.now()}`
      console.log('Generated new conversation ID:', conversationId.value)
    }

    const response = await apiUtils.post('/ai/chat', {
      message: messageText,
      conversationId: conversationId.value
    }, {
      adaptiveTimeout: true,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Request-ID': Date.now().toString(),
        'X-Cache-Buster': Date.now().toString()
      }
    })

    console.log('Received full response:', JSON.stringify(response, null, 2))
    console.log('Response data type:', typeof response.data)
    console.log('Response.data content:', response.data)

    // Handle response more robustly
    if (response.success) {
      let responseText = ''
      
      // Try multiple possible response paths
      if (response.data) {
        responseText = response.data.response || 
                      response.data.data?.response || 
                      response.data.content ||
                      (typeof response.data === 'string' ? response.data : '')
      }
      
      // Fallback to top-level response
      if (!responseText) {
        responseText = response.response || response.content || ''
      }
      
      if (responseText && typeof responseText === 'string' && responseText.trim()) {
        const aiMessage: Message = {
          id: Date.now() + 1,
          text: responseText.trim(),
          isUser: false,
          timestamp: new Date()
        }
        messages.value.push(aiMessage)
        console.log('Message added successfully')
      } else {
        console.error('No valid response text found:', response)
        throw new Error('תגובה ריקה מהשרת')
      }
    } else {
      console.error('Response not successful:', response)
      throw new Error(response.error || 'הבקשה נכשלה')
    }
  } catch (error: any) {
    console.error('Chat error:', error)
    
    let errorText = "מתנצל, יש בעיה בעיבוד הבקשה. אנא נסה שוב."
    
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      errorText = `השאילתה לוקחת זמן רב מהצפוי (יותר מ-${Math.round(currentTimeout.value / 1000)} שניות). אנא נסה שוב או פשט את השאלה.`
    } else if (error.message?.includes('Network Error') || error.message?.includes('fetch')) {
      errorText = "בעיית חיבור לשרת. אנא בדוק את החיבור ונסה שוב."
    } else if (error.response?.status === 500) {
      errorText = "שגיאת שרת פנימית. אנא נסה שוב בעוד כמה רגעים."
    } else if (error.message && error.message !== 'Invalid response format from AI') {
      errorText = `שגיאה: ${error.message}`
    }
    
    const errorMessage: Message = {
      id: Date.now() + 1,
      text: errorText,
      isUser: false,
      timestamp: new Date()
    }
    messages.value.push(errorMessage)
    ElMessage.error('שגיאה בעיבוד השאילתה')
  } finally {
    isLoading.value = false
    currentTimeout.value = 0
    await scrollToBottom()
  }
}

const formatMessage = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>')
}

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('he-IL', { 
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

onMounted(() => {
  // Initialize conversation ID when component mounts
  conversationId.value = `${authStore.user?.userId || 'user'}-chat-${Date.now()}`
  console.log('Chat app mounted with conversation ID:', conversationId.value)
  
  scrollToBottom()
  if (messageInput.value) {
    messageInput.value.focus()
  }
})
</script>

<style scoped>
.chat-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
}

/* Header */
.chat-header {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
  padding: 1rem 2rem;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-text h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: #1a202c;
  letter-spacing: -0.025em;
}

.brand-text p {
  margin: 0;
  font-size: 0.875rem;
  color: #64748b;
  font-weight: 500;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.user-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 1.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.9);
  color: #1a202c;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.user-badge:hover {
  background: rgba(255, 255, 255, 1);
  transform: translateY(-1px);
}

.user-badge.admin {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.6);
}

.user-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
  flex-shrink: 0;
}

.user-badge span {
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}

.clear-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border: none;
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.9);
  color: #3b82f6;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  width: 2.5rem;
  height: 2.5rem;
}

.clear-button:hover {
  background: rgba(59, 130, 246, 0.3);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.logout-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border: none;
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.9);
  color: #ef4444;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  width: 2.5rem;
  height: 2.5rem;
}

.logout-button:hover {
  background: rgba(255, 87, 87, 0.3);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 87, 87, 0.3);
}

.logout-button svg {
  transition: transform 0.2s ease;
}

.logout-button:hover svg {
  transform: translateX(2px);
}

/* Main Chat Area */
.chat-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.chat-container {
  flex: 1;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px); /* Account for header and footer */
}

/* Welcome Section */
.welcome-section {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.welcome-content {
  text-align: center;
  max-width: 600px;
}

.welcome-icon {
  margin-bottom: 1.5rem;
  display: flex;
  justify-content: center;
}

.welcome-content h2 {
  margin: 0 0 1rem 0;
  font-size: 2rem;
  font-weight: 700;
  color: #1a202c;
  line-height: 1.2;
}

.welcome-content > p {
  margin: 0 0 2rem 0;
  font-size: 1.125rem;
  color: #64748b;
  line-height: 1.6;
}

.example-queries h3 {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #374151;
}

.example-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
}

.example-button {
  padding: 1rem;
  border: 2px solid #e2e8f0;
  border-radius: 0.75rem;
  background: white;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-align: right;
}

.example-button:hover {
  border-color: #667eea;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.15);
}

.example-icon {
  font-size: 1.25rem;
}

.example-text {
  font-weight: 500;
  color: #374151;
}

/* Messages */
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
  scroll-behavior: smooth;
  max-height: calc(100vh - 200px); /* Ensure scrollable area */
  min-height: 300px;
}

.message-wrapper {
  margin-bottom: 1.5rem;
  display: flex;
  align-items: flex-start;
}

.message-wrapper.user-message {
  justify-content: flex-end;
}

.message-wrapper.ai-message {
  justify-content: flex-start;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  max-width: 70%;
}

.user-message .message {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
  margin-top: 0.25rem;
}

.message-content {
  background: white;
  border-radius: 1rem;
  padding: 1rem 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border: 1px solid #e2e8f0;
}

.user-message .message-content {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.message-content.loading {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.message-text {
  line-height: 1.6;
  font-size: 0.95rem;
  direction: auto;
  unicode-bidi: plaintext;
  margin-bottom: 0.5rem;
}

.message-time {
  font-size: 0.75rem;
  opacity: 0.7;
  text-align: right;
}

/* Typing Animation */
.typing-animation {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.typing-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #667eea;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-dot:nth-child(1) { animation-delay: -0.32s; }
.typing-dot:nth-child(2) { animation-delay: -0.16s; }
.typing-dot:nth-child(3) { animation-delay: 0s; }

@keyframes typing {
  0%, 80%, 100% { 
    transform: scale(0.8); 
    opacity: 0.5; 
  }
  40% { 
    transform: scale(1.2); 
    opacity: 1; 
  }
}

.loading-text {
  font-size: 0.875rem;
  color: #64748b;
  font-style: italic;
}

/* Footer Input */
.chat-footer {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(226, 232, 240, 0.8);
  padding: 1.5rem 2rem;
}

.input-container {
  max-width: 1200px;
  margin: 0 auto;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  background: white;
  border: 2px solid #e2e8f0;
  border-radius: 1rem;
  padding: 0.75rem;
  transition: border-color 0.2s ease;
}

.input-wrapper:focus-within {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.message-input {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
}

.message-input::placeholder {
  color: #9ca3af;
}

.send-button {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border: none;
  border-radius: 0.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.button-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.75rem;
  padding: 0 0.5rem;
}

.timeout-info {
  display: flex;
  align-items: center;
}

.timeout-badge {
  font-size: 0.75rem;
  color: #667eea;
  background: rgba(102, 126, 234, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 0.5rem;
  font-weight: 500;
}

.powered-by {
  font-size: 0.75rem;
  color: #9ca3af;
  font-weight: 500;
}

/* Responsive Design */
@media (max-width: 768px) {
  .chat-header {
    padding: 1rem;
  }
  
  .header-content {
    flex-direction: column;
    gap: 1rem;
  }
  
  .brand-text h1 {
    font-size: 1.25rem;
  }
  
  .welcome-content h2 {
    font-size: 1.5rem;
  }
  
  .example-grid {
    grid-template-columns: 1fr;
  }
  
  .messages-container {
    padding: 1rem;
  }
  
  .message {
    max-width: 85%;
  }
  
  .chat-footer {
    padding: 1rem;
  }
  
  .input-footer {
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }
}

@media (max-width: 480px) {
  .message {
    max-width: 95%;
  }
  
  .message-content {
    padding: 0.75rem 1rem;
  }
}
</style>