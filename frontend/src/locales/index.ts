import { createI18n as createVueI18n } from 'vue-i18n'
import enMessages from './en.json'
import heMessages from './he.json'

export const SUPPORTED_LOCALES = ['en', 'he'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

export const DEFAULT_LOCALE: SupportedLocale = 'he'

// Create i18n instance
export function createI18n() {
  return createVueI18n({
    legacy: false,
    locale: DEFAULT_LOCALE,
    fallbackLocale: 'en',
    messages: {
      en: enMessages,
      he: heMessages
    },
    numberFormats: {
      en: {
        currency: {
          style: 'currency',
          currency: 'USD'
        },
        decimal: {
          style: 'decimal',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      },
      he: {
        currency: {
          style: 'currency',
          currency: 'ILS'
        },
        decimal: {
          style: 'decimal',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      }
    },
    datetimeFormats: {
      en: {
        short: {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        },
        long: {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
          hour: 'numeric',
          minute: 'numeric'
        }
      },
      he: {
        short: {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        },
        long: {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
          hour: 'numeric',
          minute: 'numeric'
        }
      }
    }
  })
}

// Locale utilities
export function isRTL(locale: string): boolean {
  return locale === 'he'
}

export function getLocaleDirection(locale: string): 'ltr' | 'rtl' {
  return isRTL(locale) ? 'rtl' : 'ltr'
}

export function getLocaleName(locale: string): string {
  const names: Record<string, string> = {
    en: 'English',
    he: 'עברית'
  }
  return names[locale] || locale
}