<template>
  <div class="login-view">
    <div class="login-container">
      <div class="login-card">
        <div class="brand-section">
          <div class="logo">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="24" fill="url(#loginGradient)" />
              <path d="M24 40l8-8-8-8v16z" fill="white" />
              <defs>
                <linearGradient id="loginGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#667eea" />
                  <stop offset="100%" style="stop-color:#764ba2" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1>פלאפון AI</h1>
          <p>כלי ניתוח נתונים ובינה עסקית</p>
        </div>

        <div class="login-form">
          <!-- Login Type Toggle -->
          <div class="login-type-toggle">
            <button 
              type="button"
              :class="['toggle-btn', { active: !isAdminMode }]"
              @click="setLoginMode(false)"
              :disabled="loading"
            >
              כניסת לקוח
            </button>
            <button 
              type="button"
              :class="['toggle-btn', { active: isAdminMode }]"
              @click="setLoginMode(true)"
              :disabled="loading"
            >
              כניסת מנהל
            </button>
          </div>

          <!-- Demo Credentials Helper -->
          <div class="demo-info" v-if="!isAdminMode">
            <p><strong>פרטי כניסה לדמו:</strong></p>
            <p>אימייל: demo@callanalytics.com</p>
            <p>סיסמה: demo123456</p>
          </div>

          <!-- Admin Credentials Helper -->
          <div class="demo-info admin-info" v-if="isAdminMode">
            <p><strong>פרטי כניסת מנהל:</strong></p>
            <p>אנא פנה למנהל המערכת לקבלת פרטי הכניסה</p>
          </div>
          
          <!-- Regular Login Fields -->
          <template v-if="!isAdminMode">
            <div class="form-group">
              <input 
                type="email" 
                placeholder="כתובת אימייל" 
                v-model="email" 
                :disabled="loading"
                class="login-input"
              />
            </div>
            
            <div class="form-group">
              <input 
                type="password" 
                placeholder="סיסמה" 
                v-model="password" 
                :disabled="loading"
                @keyup.enter="login"
                class="login-input"
              />
            </div>
          </template>

          <!-- Admin Login Fields -->
          <template v-if="isAdminMode">
            <div class="form-group">
              <input 
                type="text" 
                placeholder="שם משתמש מנהל" 
                v-model="adminUsername" 
                :disabled="loading"
                class="login-input"
              />
            </div>
            
            <div class="form-group">
              <input 
                type="password" 
                placeholder="סיסמת מנהל" 
                v-model="adminPassword" 
                :disabled="loading"
                class="login-input"
              />
            </div>

            <div class="form-group">
              <input 
                type="password" 
                placeholder="מפתח מנהל מערכת" 
                v-model="adminKey" 
                :disabled="loading"
                @keyup.enter="adminLogin"
                class="login-input"
              />
            </div>
          </template>
          
          <button @click="isAdminMode ? adminLogin() : login()" class="login-button" :disabled="loading">
            <span v-if="!loading">{{ isAdminMode ? 'התחבר כמנהל' : 'היכנס למערכת' }}</span>
            <div v-else class="login-spinner">
              <div class="spinner"></div>
              <span>מתחבר...</span>
            </div>
          </button>
          
          <!-- Quick Demo Login -->
          <button v-if="!isAdminMode" @click="demoLogin" class="demo-button" :disabled="loading">
            כניסה מהירה לדמו
          </button>

          <!-- Quick Admin Login -->
          <button v-if="isAdminMode" @click="demoAdminLogin" class="demo-button admin-demo" :disabled="loading">
            כניסת מנהל מהירה
          </button>
          
          <div v-if="error" class="error-message">
            {{ error }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

// Regular login fields
const email = ref('')
const password = ref('')

// Admin login fields
const adminUsername = ref('')
const adminPassword = ref('')
const adminKey = ref('')

// Common state
const loading = ref(false)
const error = ref('')
const isAdminMode = ref(false)

// Set login mode
const setLoginMode = (adminMode: boolean) => {
  isAdminMode.value = adminMode
  error.value = ''
  
  // Clear all fields when switching modes
  email.value = ''
  password.value = ''
  adminUsername.value = ''
  adminPassword.value = ''
  adminKey.value = ''
}

// Regular login
const login = async () => {
  if (!email.value || !password.value) {
    error.value = 'אנא הזן אימייל וסיסמה'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const success = await authStore.login({
      email: email.value,
      password: password.value
    })

    if (success) {
      ElMessage.success('התחברת בהצלחה!')
      router.push('/chat')
    } else {
      error.value = 'פרטי התחברות שגויים'
    }
  } catch (err: any) {
    error.value = err.message || 'ההתחברות נכשלה'
    ElMessage.error('ההתחברות נכשלה')
  } finally {
    loading.value = false
  }
}

// Admin login
const adminLogin = async () => {
  if (!adminUsername.value || !adminPassword.value || !adminKey.value) {
    error.value = 'אנא מלא את כל השדות הנדרשים לכניסת מנהל'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const success = await authStore.adminLogin({
      username: adminUsername.value,
      password: adminPassword.value,
      adminKey: adminKey.value
    })

    if (success) {
      ElMessage.success('התחברת כמנהל בהצלחה!')
      router.push('/chat')
    } else {
      error.value = 'פרטי התחברות מנהל שגויים'
    }
  } catch (err: any) {
    error.value = err.message || 'כניסת מנהל נכשלה'
    ElMessage.error('כניסת מנהל נכשלה')
  } finally {
    loading.value = false
  }
}

// Quick demo login
const demoLogin = () => {
  email.value = 'demo@callanalytics.com'
  password.value = 'demo123456'
  login()
}

// Quick admin demo login
const demoAdminLogin = () => {
  adminUsername.value = 'admin'
  // Admin credentials are managed via AWS Secrets Manager
  // Remove hardcoded values for security
  adminLogin()
}
</script>

<style scoped>
.login-view {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  padding: 1rem;
}

.login-container {
  width: 100%;
  max-width: 420px;
}

.login-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 1.5rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.brand-section {
  text-align: center;
  padding: 2.5rem 2rem 1.5rem 2rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.logo {
  margin-bottom: 1rem;
  display: flex;
  justify-content: center;
}

.brand-section h1 {
  margin: 0 0 0.5rem 0;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.brand-section p {
  margin: 0;
  font-size: 1rem;
  opacity: 0.9;
  font-weight: 500;
}

.login-form {
  padding: 2rem;
}

.login-type-toggle {
  display: flex;
  background: #f8fafc;
  border-radius: 0.75rem;
  padding: 0.25rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e2e8f0;
}

.toggle-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: #64748b;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
}

.toggle-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.toggle-btn:hover:not(.active):not(:disabled) {
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
}

.toggle-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.demo-info {
  background: rgba(102, 126, 234, 0.1);
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 0.75rem;
  padding: 1rem;
  margin-bottom: 1.5rem;
  text-align: center;
}

.demo-info.admin-info {
  background: rgba(168, 85, 247, 0.1);
  border: 1px solid rgba(168, 85, 247, 0.2);
}

.demo-info p {
  margin: 0.25rem 0;
  font-size: 0.875rem;
  color: #374151;
}

.demo-info strong {
  color: #1f2937;
}

.form-group {
  margin-bottom: 1.25rem;
}

.login-input {
  width: 100%;
  padding: 1rem;
  border: 2px solid #e2e8f0;
  border-radius: 0.75rem;
  font-size: 1rem;
  transition: all 0.2s ease;
  background: white;
  box-sizing: border-box;
}

.login-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.login-input:disabled {
  background: #f8fafc;
  color: #9ca3af;
  cursor: not-allowed;
}

.login-button {
  width: 100%;
  padding: 1rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.login-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.login-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.login-spinner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.spinner {
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

.demo-button {
  width: 100%;
  padding: 0.875rem;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.demo-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
}

.demo-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.demo-button.admin-demo {
  background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
}

.demo-button.admin-demo:hover:not(:disabled) {
  box-shadow: 0 8px 25px rgba(168, 85, 247, 0.4);
}

.error-message {
  color: #ef4444;
  text-align: center;
  margin-top: 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  background: rgba(239, 68, 68, 0.1);
  padding: 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

/* Responsive Design */
@media (max-width: 480px) {
  .login-view {
    padding: 0.5rem;
  }
  
  .brand-section {
    padding: 2rem 1.5rem 1rem 1.5rem;
  }
  
  .brand-section h1 {
    font-size: 1.75rem;
  }
  
  .login-form {
    padding: 1.5rem;
  }
}
</style>