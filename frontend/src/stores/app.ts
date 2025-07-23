import { defineStore } from 'pinia'
import type { RouteLocationNormalized } from 'vue-router'
import { ElMessage, ElNotification } from 'element-plus'
import { useI18n } from 'vue-i18n'

export interface BreadcrumbItem {
  title: string
  path?: string
  icon?: string
}

export interface ErrorDialog {
  visible: boolean
  message: string
  retryAction?: () => void
}

export interface AppState {
  theme: 'light' | 'dark'
  language: 'en' | 'he'
  loading: boolean
  loadingProgress: number
  sidebarCollapsed: boolean
  breadcrumbs: BreadcrumbItem[]
  errorDialog: ErrorDialog
  lastAction?: () => void
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    theme: 'light',
    language: 'he',
    loading: false,
    loadingProgress: 0,
    sidebarCollapsed: false,
    breadcrumbs: [],
    errorDialog: {
      visible: false,
      message: '',
      retryAction: undefined
    },
    lastAction: undefined
  }),

  getters: {
    isDark: (state) => state.theme === 'dark',
    isRTL: (state) => state.language === 'he',
    isLoading: (state) => state.loading
  },

  actions: {
    // Theme management
    toggleTheme() {
      this.theme = this.theme === 'light' ? 'dark' : 'light'
      this.saveToLocalStorage()
    },

    setTheme(theme: 'light' | 'dark') {
      this.theme = theme
      this.saveToLocalStorage()
    },

    // Language management
    setLanguage(language: 'en' | 'he') {
      this.language = language
      this.saveToLocalStorage()
      
      // Update i18n locale
      const { locale } = useI18n()
      locale.value = language
      
      // Update document attributes
      document.documentElement.setAttribute('lang', language)
      document.documentElement.setAttribute('dir', language === 'he' ? 'rtl' : 'ltr')
    },

    toggleLanguage() {
      this.setLanguage(this.language === 'en' ? 'he' : 'en')
    },

    // Loading management
    startLoading() {
      this.loading = true
      this.loadingProgress = 0
    },

    updateLoadingProgress(progress: number) {
      this.loadingProgress = Math.min(100, Math.max(0, progress))
    },

    stopLoading() {
      this.loading = false
      this.loadingProgress = 0
    },

    // Sidebar management
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
      this.saveToLocalStorage()
    },

    setSidebarCollapsed(collapsed: boolean) {
      this.sidebarCollapsed = collapsed
      this.saveToLocalStorage()
    },

    // Breadcrumbs management
    updateBreadcrumbs(route: RouteLocationNormalized) {
      const breadcrumbs: BreadcrumbItem[] = []
      
      // Add home breadcrumb
      breadcrumbs.push({
        title: 'dashboard.title',
        path: '/dashboard',
        icon: 'House'
      })
      
      // Build breadcrumbs from route hierarchy
      const pathSegments = route.path.split('/').filter(Boolean)
      let currentPath = ''
      
      pathSegments.forEach((segment, index) => {
        currentPath += `/${segment}`
        
        // Skip if this is the dashboard (already added)
        if (currentPath === '/dashboard') return
        
        const matchedRoute = route.matched.find(r => r.path === currentPath)
        if (matchedRoute && matchedRoute.meta.title) {
          breadcrumbs.push({
            title: matchedRoute.meta.title as string,
            path: index === pathSegments.length - 1 ? undefined : currentPath,
            icon: matchedRoute.meta.icon as string
          })
        }
      })
      
      this.breadcrumbs = breadcrumbs
    },

    // Error handling
    showError(message: string, retryAction?: () => void) {
      this.errorDialog = {
        visible: true,
        message,
        retryAction
      }
    },

    setErrorDialog(visible: boolean, message: string, retryAction?: () => void) {
      this.errorDialog = {
        visible,
        message,
        retryAction
      }
    },

    hideErrorDialog() {
      this.errorDialog.visible = false
    },

    setLastAction(action: () => void) {
      this.lastAction = action
    },

    retryLastAction() {
      if (this.lastAction) {
        this.lastAction()
      } else if (this.errorDialog.retryAction) {
        this.errorDialog.retryAction()
      }
    },

    // Notifications
    showSuccess(message: string, title?: string) {
      ElMessage({
        message,
        type: 'success',
        duration: 3000,
        showClose: true
      })
    },

    showWarning(message: string, title?: string) {
      ElMessage({
        message,
        type: 'warning',
        duration: 4000,
        showClose: true
      })
    },

    showInfo(message: string, title?: string) {
      ElMessage({
        message,
        type: 'info',
        duration: 3000,
        showClose: true
      })
    },

    showNotification(title: string, message: string, type: 'success' | 'warning' | 'info' | 'error' = 'info') {
      ElNotification({
        title,
        message,
        type,
        duration: 4000,
        position: this.language === 'he' ? 'top-left' : 'top-right'
      })
    },

    // Persistence
    saveToLocalStorage() {
      try {
        const state = {
          theme: this.theme,
          language: this.language,
          sidebarCollapsed: this.sidebarCollapsed
        }
        localStorage.setItem('app-state', JSON.stringify(state))
      } catch (error) {
        console.error('Failed to save app state:', error)
      }
    },

    loadFromLocalStorage() {
      try {
        const saved = localStorage.getItem('app-state')
        if (saved) {
          const state = JSON.parse(saved)
          this.theme = state.theme || 'light'
          this.language = state.language || 'he'
          this.sidebarCollapsed = state.sidebarCollapsed || false
        }
      } catch (error) {
        console.error('Failed to load app state:', error)
      }
    },

    // Initialization
    async initialize() {
      this.loadFromLocalStorage()
      this.setLanguage(this.language) // Apply language settings
      
      // Set up error handlers
      window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason)
        this.showError('An unexpected error occurred. Please try again.')
      })
      
      window.addEventListener('error', (event) => {
        console.error('Global error:', event.error)
        this.showError('An unexpected error occurred. Please try again.')
      })
    },

    // Utility methods
    formatFileSize(bytes: number): string {
      if (bytes === 0) return '0 Bytes'
      
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    },

    formatDuration(seconds: number): string {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const remainingSeconds = seconds % 60
      
      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
      } else {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
      }
    },

    // Device detection
    isMobile(): boolean {
      return window.innerWidth <= 768
    },

    isTablet(): boolean {
      return window.innerWidth > 768 && window.innerWidth <= 1024
    },

    isDesktop(): boolean {
      return window.innerWidth > 1024
    }
  }
})