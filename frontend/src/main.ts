import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

import App from './App.vue'
import router from './router'
import { createI18n } from './locales'
import './styles/main.scss'

// Create Vue app
const app = createApp(App)

// Install plugins
app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.use(createI18n())

// Register all Element Plus icons
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// Global properties
app.config.globalProperties.$ELEMENT = {
  size: 'default',
  zIndex: 3000,
}

// Mount app
app.mount('#app')