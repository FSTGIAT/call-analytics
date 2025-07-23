import { defineStore } from 'pinia'
import { api } from '@/utils/api'
import type { User, LoginCredentials, AuthResponse } from '@/types/auth'

export interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  loading: boolean
  customerContext: {
    customerId: string
    subscriberIds: string[]
    tier: 'basic' | 'premium' | 'enterprise'
  } | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
    loading: false,
    customerContext: null
  }),

  getters: {
    isAdmin: (state): boolean => {
      console.log('isAdmin getter - user:', state.user, 'role:', state.user?.role, 'isAdmin:', state.user?.isAdmin)
      return state.user?.role === 'admin' || state.user?.isAdmin === true
    },
    
    hasPermission: (state) => (permission: string): boolean => {
      if (!state.user) return false
      if (state.user.role === 'admin') return true
      return state.user.permissions?.includes(permission) || false
    },

    userName: (state): string => {
      return state.user?.name || state.user?.email || 'User'
    },

    isLoading: (state): boolean => state.loading
  },

  actions: {
    // Login
    async login(credentials: LoginCredentials): Promise<boolean> {
      this.loading = true
      
      try {
        const response = await api.post<AuthResponse>('/auth/login', credentials)
        
        if (response.success && response.data) {
          await this.setAuthData(response.data)
          return true
        } else {
          throw new Error(response.error || 'Login failed')
        }
      } catch (error) {
        console.error('Login error:', error)
        throw error
      } finally {
        this.loading = false
      }
    },

    // Admin Login
    async adminLogin(credentials: { username: string; password: string; adminKey: string }): Promise<boolean> {
      this.loading = true
      
      try {
        const response = await api.post<AuthResponse>('/auth/admin/login', credentials)
        console.log('Admin login response:', response)
        
        if (response.success && response.data) {
          // Ensure admin properties are set correctly
          if (response.data.user) {
            response.data.user.role = 'admin'
            response.data.user.isAdmin = true
            console.log('Setting user as admin:', response.data.user)
          }
          
          await this.setAuthData(response.data)
          console.log('Admin login successful, isAdmin:', this.isAdmin)
          return true
        } else {
          throw new Error(response.error || 'Admin login failed')
        }
      } catch (error) {
        console.error('Admin login error:', error)
        throw error
      } finally {
        this.loading = false
      }
    },

    // Logout
    async logout(): Promise<void> {
      this.loading = true
      
      try {
        if (this.token) {
          await api.post('/auth/logout', {}, {
            headers: { Authorization: `Bearer ${this.token}` }
          })
        }
      } catch (error) {
        console.error('Logout error:', error)
      } finally {
        this.clearAuthData()
        this.loading = false
      }
    },

    // Refresh token
    async refreshAuthToken(): Promise<boolean> {
      if (!this.refreshToken) {
        return false
      }

      try {
        const response = await api.post<AuthResponse>('/auth/refresh', {
          refreshToken: this.refreshToken
        })

        if (response.success && response.data) {
          await this.setAuthData(response.data)
          return true
        } else {
          this.clearAuthData()
          return false
        }
      } catch (error) {
        console.error('Token refresh error:', error)
        this.clearAuthData()
        return false
      }
    },

    // Set authentication data
    async setAuthData(authData: AuthResponse): Promise<void> {
      console.log('setAuthData called with:', authData)
      this.user = authData.user
      this.token = authData.token
      this.refreshToken = authData.refreshToken
      this.customerContext = authData.customerContext
      this.isAuthenticated = true
      
      console.log('After setting user:', this.user, 'isAdmin should be:', this.isAdmin)

      // Save to localStorage
      this.saveToLocalStorage()

      // Set API default headers
      api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`

      // Get user profile to ensure data is complete (skip for admin)
      if (this.user?.role !== 'admin') {
        await this.fetchUserProfile()
      }
      
      console.log('After fetchUserProfile, user:', this.user, 'isAdmin:', this.isAdmin)
    },

    // Clear authentication data
    clearAuthData(): void {
      this.user = null
      this.token = null
      this.refreshToken = null
      this.customerContext = null
      this.isAuthenticated = false

      // Clear localStorage
      this.removeFromLocalStorage()

      // Clear API headers
      delete api.defaults.headers.common['Authorization']
    },

    // Fetch user profile
    async fetchUserProfile(): Promise<void> {
      if (!this.token) return

      try {
        const response = await api.get<User>('/auth/profile')
        console.log('fetchUserProfile response:', response)
        
        if (response.success && response.data) {
          console.log('Profile data received:', response.data)
          this.user = response.data
          this.saveToLocalStorage()
        }
      } catch (error) {
        console.error('Failed to fetch user profile:', error)
      }
    },

    // Update user profile
    async updateProfile(profileData: Partial<User>): Promise<boolean> {
      if (!this.token || !this.user) return false

      try {
        const response = await api.put<User>('/auth/profile', profileData)
        
        if (response.success && response.data) {
          this.user = { ...this.user, ...response.data }
          this.saveToLocalStorage()
          return true
        }
        
        return false
      } catch (error) {
        console.error('Profile update error:', error)
        throw error
      }
    },

    // Change password
    async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
      if (!this.token) return false

      try {
        const response = await api.post('/auth/change-password', {
          currentPassword,
          newPassword
        })
        
        return response.success
      } catch (error) {
        console.error('Password change error:', error)
        throw error
      }
    },

    // Save to localStorage
    saveToLocalStorage(): void {
      try {
        const authData = {
          user: this.user,
          token: this.token,
          refreshToken: this.refreshToken,
          customerContext: this.customerContext,
          isAuthenticated: this.isAuthenticated
        }
        
        localStorage.setItem('auth-data', JSON.stringify(authData))
      } catch (error) {
        console.error('Failed to save auth data:', error)
      }
    },

    // Load from localStorage
    loadFromLocalStorage(): boolean {
      try {
        const saved = localStorage.getItem('auth-data')
        
        if (saved) {
          const authData = JSON.parse(saved)
          
          this.user = authData.user
          this.token = authData.token
          this.refreshToken = authData.refreshToken
          this.customerContext = authData.customerContext
          this.isAuthenticated = authData.isAuthenticated

          // Set API headers if token exists
          if (this.token) {
            api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`
          }

          return true
        }
      } catch (error) {
        console.error('Failed to load auth data:', error)
        this.removeFromLocalStorage()
      }
      
      return false
    },

    // Remove from localStorage
    removeFromLocalStorage(): void {
      try {
        localStorage.removeItem('auth-data')
      } catch (error) {
        console.error('Failed to remove auth data:', error)
      }
    },

    // Restore authentication from localStorage
    async restoreAuth(): Promise<boolean> {
      if (this.loadFromLocalStorage()) {
        // Try to refresh token to verify it's still valid
        if (await this.refreshAuthToken()) {
          return true
        } else {
          // Token is invalid, clear auth data
          this.clearAuthData()
        }
      }
      
      return false
    },

    // Check if user has specific customer access
    hasCustomerAccess(customerId: string): boolean {
      if (!this.customerContext) return false
      if (this.isAdmin) return true
      return this.customerContext.customerId === customerId
    },

    // Check if user has subscriber access
    hasSubscriberAccess(subscriberId: string): boolean {
      if (!this.customerContext) return false
      if (this.isAdmin) return true
      return this.customerContext.subscriberIds.includes(subscriberId)
    },

    // Get customer tier
    getCustomerTier(): string {
      return this.customerContext?.tier || 'basic'
    },

    // Initialize auth store
    async initialize(): Promise<void> {
      // Try to restore authentication
      await this.restoreAuth()

      // Set up token refresh interval
      if (this.token) {
        this.setupTokenRefresh()
      }
    },

    // Setup automatic token refresh
    setupTokenRefresh(): void {
      // Refresh token every 50 minutes (tokens typically expire in 1 hour)
      setInterval(async () => {
        if (this.isAuthenticated && this.refreshToken) {
          await this.refreshAuthToken()
        }
      }, 50 * 60 * 1000) // 50 minutes
    },

    // Validate session
    async validateSession(): Promise<boolean> {
      if (!this.token) return false

      try {
        const response = await api.get('/auth/validate')
        return response.success
      } catch (error) {
        console.error('Session validation error:', error)
        return false
      }
    }
  }
})