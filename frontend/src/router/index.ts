import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

// Configure NProgress
NProgress.configure({
  showSpinner: false,
  speed: 500,
  minimum: 0.2
})

// Route definitions - Clean AI Chat Only
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/chat'
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: {
      requiresAuth: false,
      title: 'פלאפון AI - כניסה למערכת'
    }
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('@/views/ChatApp.vue'),
    meta: {
      requiresAuth: true,
      title: 'פלאפון AI - צ\'אט חכם'
    }
  },
  {
    path: '/404',
    name: 'NotFound',
    component: () => import('@/views/error/NotFoundView.vue'),
    meta: {
      requiresAuth: false,
      title: 'עמוד לא נמצא'
    }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/404'
  }
]

// Create router
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})

// Navigation guards
router.beforeEach(async (to, from, next) => {
  NProgress.start()
  
  const authStore = useAuthStore()
  const appStore = useAppStore()
  
  // Set page title
  if (to.meta.title) {
    document.title = `${to.meta.title} - Call Analytics AI Platform`
  }
  
  // Check authentication
  if (to.meta.requiresAuth) {
    if (!authStore.isAuthenticated) {
      // Try to restore auth from localStorage
      await authStore.restoreAuth()
      
      if (!authStore.isAuthenticated) {
        next({
          path: '/login',
          query: { redirect: to.fullPath }
        })
        return
      }
    }
    
    // Check admin permissions
    if (to.meta.adminOnly && !authStore.user?.isAdmin) {
      appStore.showError('Access denied. Admin privileges required.')
      next('/dashboard')
      return
    }
  }
  
  // Redirect authenticated users away from login
  if (to.path === '/login' && authStore.isAuthenticated) {
    next('/dashboard')
    return
  }
  
  next()
})

router.afterEach((to, from) => {
  NProgress.done()
  
  // Update breadcrumbs
  const appStore = useAppStore()
  appStore.updateBreadcrumbs(to)
})

router.onError((error) => {
  NProgress.done()
  console.error('Router error:', error)
  
  const appStore = useAppStore()
  appStore.showError('Navigation error occurred')
})

export default router