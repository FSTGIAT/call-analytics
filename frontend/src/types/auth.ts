export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user' | 'agent'
  isAdmin: boolean
  permissions?: string[]
  avatar?: string
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
  preferences?: {
    language: 'en' | 'he'
    theme: 'light' | 'dark'
    notifications: boolean
    timezone: string
  }
}

export interface LoginCredentials {
  email: string
  password: string
  remember?: boolean
}

export interface CustomerContext {
  customerId: string
  subscriberIds: string[]
  tier: 'basic' | 'premium' | 'enterprise'
}

export interface AuthResponse {
  user: User
  token: string
  refreshToken: string
  customerContext: CustomerContext
  expiresIn: number
}

export interface AuthError {
  code: string
  message: string
  details?: any
}