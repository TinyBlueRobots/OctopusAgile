import { main } from 'bun'
import * as charts from './charts.js'
import { getAccountData } from './octopus.js'

const getStorageValue = (key: string) => {
  let value = localStorage.getItem('datastar')
  if (!value) return
  return JSON.parse(value)[key]
}

export const getRegion = () => getStorageValue('region')

const getAccount = () => getStorageValue('account')

const getToken = () => getStorageValue('token')

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

export const getMaxPeriodFrom = () => {
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

export const renderCharts = (region: string, periodFromValue: string) =>
  charts.render(region, periodFromValue, getAccount(), getToken())

export const dispatchRenderCharts = (mainElement: HTMLElement) => mainElement.dispatchEvent(new Event('render-charts'))

export const onload = (mainElement: HTMLElement, ratesChartElement: HTMLElement, costChartElement: HTMLElement) => {
  charts.setElements(ratesChartElement, costChartElement)
  dispatchRenderCharts(mainElement)
  setTimeout(() => {
    dispatchRenderCharts(mainElement)
    setInterval(() => dispatchRenderCharts(mainElement), 1800000)
  }, nextRateChange())
}
