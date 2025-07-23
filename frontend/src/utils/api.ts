import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import router from '@/router'

// API response interface
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  timestamp?: string
}

// Request interceptor config
interface RequestConfig extends AxiosRequestConfig {
  skipAuth?: boolean
  skipErrorHandler?: boolean
  showLoading?: boolean
  adaptiveTimeout?: boolean
}

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Ultra-simple query complexity analyzer (mirrors backend logic)
const analyzeQueryComplexity = (text: string): number => {
  const textClean = text.trim()
  
  // Check for analysis keywords in Hebrew/English
  const analysisKeywords = ['נתח', 'ניתוח', 'analyze', 'analysis', 'סיכום', 'סכם', 'summary', 'summarize', 'דוח', 'report', 'תובנות', 'insights']
  const hasAnalysisKeyword = analysisKeywords.some(keyword => 
    textClean.toLowerCase().includes(keyword.toLowerCase())
  )
  
  if (hasAnalysisKeyword) {
    return 2.5 // Analysis requests are always complex
  }
  
  // Simple approach: just use length for non-analysis queries
  // Simple queries: greetings, short questions
  if (textClean.length <= 20) {
    return 1.0
  }
  
  // Medium queries: longer questions, some detail
  if (textClean.length <= 100) {
    return 1.5
  }
  
  // Complex queries: long detailed requests
  return 2.5
}

// Calculate adaptive timeout based on complexity
const calculateAdaptiveTimeout = (complexityScore: number): number => {
  const baseTimeout = 30000 // 30s base timeout (increased from 15s)
  
  if (complexityScore >= 2.5) {
    return Math.floor(baseTimeout * 3.0) // 90s for very complex
  } else if (complexityScore >= 2.0) {
    return Math.floor(baseTimeout * 2.0) // 60s for complex
  } else if (complexityScore >= 1.5) {
    return Math.floor(baseTimeout * 1.5) // 45s for moderate
  } else {
    return baseTimeout // 30s for simple
  }
}

// Request interceptor
api.interceptors.request.use(
  (config: RequestConfig) => {
    const authStore = useAuthStore()
    const appStore = useAppStore()

    // Add auth token if available and not skipped
    if (!config.skipAuth && authStore.token) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${authStore.token}`
    }

    // Add customer context headers if available
    if (authStore.customerContext) {
      config.headers = config.headers || {}
      config.headers['X-Customer-ID'] = authStore.customerContext.customerId
      config.headers['X-Customer-Tier'] = authStore.customerContext.tier
    }

    // Add language header
    config.headers = config.headers || {}
    config.headers['Accept-Language'] = appStore.language

    // Apply adaptive timeout for AI chat requests
    if (config.adaptiveTimeout && config.data?.message) {
      const complexity = analyzeQueryComplexity(config.data.message)
      const adaptiveTimeout = calculateAdaptiveTimeout(complexity)
      config.timeout = adaptiveTimeout
      console.log(`🧠 Frontend adaptive timeout: ${adaptiveTimeout}ms (complexity: ${complexity.toFixed(2)})`)
    }

    // Show loading if requested
    if (config.showLoading) {
      appStore.startLoading()
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response: AxiosResponse) => {
    const appStore = useAppStore()
    
    // Hide loading
    if (appStore.loading) {
      appStore.stopLoading()
    }

    // Transform response to our ApiResponse format
    const apiResponse: ApiResponse = {
      success: true,
      data: response.data,
      timestamp: new Date().toISOString()
    }

    return apiResponse as any
  },
  async (error) => {
    const authStore = useAuthStore()
    const appStore = useAppStore()

    // Hide loading
    if (appStore.loading) {
      appStore.stopLoading()
    }

    const config = error.config as RequestConfig

    // Handle different error types
    if (error.response) {
      const { status, data } = error.response
      
      switch (status) {
        case 401:
          // Unauthorized - try to refresh token
          if (!config.skipAuth && authStore.refreshToken) {
            try {
              await authStore.refreshAuthToken()
              // Retry the original request
              return api(config)
            } catch (refreshError) {
              // Refresh failed, redirect to login
              authStore.clearAuthData()
              router.push('/login')
              ElMessage.error('Session expired. Please login again.')
            }
          } else {
            authStore.clearAuthData()
            router.push('/login')
            ElMessage.error('Please login to continue.')
          }
          break

        case 403:
          ElMessage.error('Access denied. You do not have permission to perform this action.')
          break

        case 404:
          if (!config.skipErrorHandler) {
            ElMessage.error('Resource not found.')
          }
          break

        case 429:
          ElMessage.error('Too many requests. Please wait a moment and try again.')
          break

        case 500:
          ElMessage.error('Server error. Please try again later.')
          break

        case 503:
          ElMessage.error('Service temporarily unavailable. Please try again later.')
          break

        default:
          if (!config.skipErrorHandler) {
            const errorMessage = data?.message || data?.error || 'An unexpected error occurred.'
            ElMessage.error(errorMessage)
          }
      }

      // Return error response in our format
      return Promise.resolve({
        success: false,
        error: data?.message || data?.error || 'Request failed',
        data: data,
        timestamp: new Date().toISOString()
      } as ApiResponse)
    } else if (error.request) {
      // Network error
      if (!config.skipErrorHandler) {
        ElMessage.error('Network error. Please check your connection and try again.')
      }
      
      return Promise.resolve({
        success: false,
        error: 'Network error',
        timestamp: new Date().toISOString()
      } as ApiResponse)
    } else {
      // Other error
      if (!config.skipErrorHandler) {
        ElMessage.error('An unexpected error occurred.')
      }
      
      return Promise.resolve({
        success: false,
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      } as ApiResponse)
    }
  }
)

// Utility functions
export const apiUtils = {
  // GET request
  get: <T = any>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> => {
    return api.get(url, config)
  },

  // POST request
  post: <T = any>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> => {
    // Ensure proper header merging for cache control
    const mergedConfig = {
      ...config,
      headers: {
        ...config?.headers
      }
    }
    return api.post(url, data, mergedConfig)
  },

  // PUT request
  put: <T = any>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> => {
    return api.put(url, data, config)
  },

  // PATCH request
  patch: <T = any>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> => {
    return api.patch(url, data, config)
  },

  // DELETE request
  delete: <T = any>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> => {
    return api.delete(url, config)
  },

  // Upload file
  upload: <T = any>(url: string, file: File, config?: RequestConfig): Promise<ApiResponse<T>> => {
    const formData = new FormData()
    formData.append('file', file)

    return api.post(url, formData, {
      ...config,
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  },

  // Download file
  download: async (url: string, filename?: string, config?: RequestConfig): Promise<void> => {
    const response = await api.get(url, {
      ...config,
      responseType: 'blob'
    })

    if (response.success && response.data) {
      const blob = new Blob([response.data])
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename || 'download'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
    }
  }
}

// Export both the axios instance and utility functions
export { api }
export default apiUtils