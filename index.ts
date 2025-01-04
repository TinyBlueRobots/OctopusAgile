import * as charts from './charts.js'
import { getAccountData } from './octopus.js'

const getStorageValue = (key: string) => {
  let value = localStorage.getItem('datastar')
  if (!value) return
  return JSON.parse(value)[key]
}

export const getRegion = () => getStorageValue('region')

export const getAccount = () => getStorageValue('account')

export const getToken = () => getStorageValue('token')

export const signOut = charts.destroy

export const signIn = async (account: string, token: string) => {
  if (account && token) {
    document.body.style.cursor = 'wait'
    const accountData = await getAccountData(account, token)
    document.body.style.cursor = 'default'
    return accountData ? true : false
  }
  return false
}

export const getMaxPeriodFrom = (query?: string) => {
  const queryPeriodFrom = query && new URLSearchParams(query).get('periodfrom')
  if (queryPeriodFrom) {
    return queryPeriodFrom
  }
  const periodFrom = new Date()
  if (periodFrom.getHours() >= 16) {
    periodFrom.setDate(periodFrom.getDate() + 1)
  }
  return periodFrom.toISOString().slice(0, 10)
}

export const setNextDay = (periodFromValue: string, maxPeriodFromValue: string) => {
  const periodFrom = new Date(periodFromValue)
  if (periodFrom < new Date(maxPeriodFromValue)) {
    periodFrom.setDate(periodFrom.getDate() + 1)
    return periodFrom.toISOString().slice(0, 10)
  }
  return periodFromValue
}

export const setPreviousDay = (periodFromValue: string) => {
  const periodFrom = new Date(periodFromValue)
  periodFrom.setDate(periodFrom.getDate() - 1)
  return periodFrom.toISOString().slice(0, 10)
}

const nextRateChange = () => {
  const now = new Date()
  const nextInterval = new Date()
  nextInterval.setSeconds(0)
  nextInterval.setMinutes(now.getMinutes() < 30 ? 30 : 60)
  return nextInterval.getTime() - now.getTime()
}

export const renderCharts = async (region: string, periodFromValue: string, account: string, token: string) => {
  document.body.style.cursor = 'wait'
  const totals = (await charts.render(region, periodFromValue, account, token)) || ''
  window.dispatchEvent(new CustomEvent('totalsupdated', { detail: totals }))
  document.body.style.cursor = 'default'
}

export const onload = (
  ratesChartElement: HTMLElement,
  costChartElement: HTMLElement,
  renderCharts: () => Promise<void>
) => {
  charts.setElements(ratesChartElement, costChartElement)
  renderCharts()
  setTimeout(() => {
    renderCharts()
    setInterval(() => renderCharts(), 1800000)
  }, nextRateChange())
}
