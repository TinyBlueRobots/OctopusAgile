import ApexCharts from 'apexcharts'
import { getMeterConsumption, getRates, type Consumption, type RegionUnitRate } from './octopus'

let ratesChartInstance: ApexCharts | null
let costChartInstance: ApexCharts | null
let ratesChartElement: HTMLElement
let costChartElement: HTMLElement

export const setElements = (ratesChart: HTMLElement, costChart: HTMLElement) => {
  ratesChartElement = ratesChart
  costChartElement = costChart
}

export const destroy = () => {
  ratesChartInstance && ratesChartInstance.destroy()
  costChartInstance && costChartInstance.destroy()
  ratesChartInstance = null
  costChartInstance = null
}

const times = (() => {
  const times = []
  for (let i = 0; i <= 48; i++) {
    let hour = Math.floor(i / 2)
    hour = hour === 24 ? 0 : hour
    const minute = i % 2 ? '30' : '00'
    times.push(`${hour.toString().padStart(2, '0')}:${minute}`)
  }
  return times
})()

const roundToTwoDecimals = (num: number): number => Math.round(num * 100) / 100

const getConsumptionCosts = async (rates: RegionUnitRate[], meterConsumption: Consumption | null) => {
  const ratesMap: { [key: string]: number } = {}
  const consumptionCosts: Consumption = {}
  for (const rate of rates) {
    ratesMap[rate.valid_from] = rate.value_inc_vat
  }
  for (const serial_number in meterConsumption) {
    consumptionCosts[serial_number] = {}
    for (const [period, kwh] of Object.entries(meterConsumption[serial_number])) {
      const ratesForPeriod = ratesMap[period] || 0
      consumptionCosts[serial_number][period] = kwh * ratesForPeriod
    }
  }
  return Object.keys(consumptionCosts).length ? consumptionCosts : null
}

const createRatesChartOptions = async (region: string, periodFrom: Date, consumption: Consumption | null) => {
  const rates = await getRates(region, periodFrom).then((rates) => rates.reverse())
  const prices = rates.map((rate) => roundToTwoDecimals(rate.value_inc_vat))
  const series: ApexAxisChartSeries = [{ name: 'Price', data: prices }]
  const consumptionCosts = (await getConsumptionCosts(rates, consumption)) || {}
  for (const serial_number in consumptionCosts) {
    const meterConsumptionCosts = []
    for (const consumptionCost of Object.values(consumptionCosts[serial_number])) {
      meterConsumptionCosts.push(roundToTwoDecimals(consumptionCost))
    }
    meterConsumptionCosts.push(0)
    meterConsumptionCosts.reverse()
    if (meterConsumptionCosts) {
      series.push({
        name: 'Cost',
        data: meterConsumptionCosts
      })
    }
  }
  let totalCost = 0
  let totalKwh = 0
  const averageKwhCost = [0]
  for (const serial_number in consumption) {
    for (const [period, kwh] of Object.entries(consumption[serial_number]).reverse().slice(0, 48)) {
      const rate = rates.find((rate) => rate.valid_from == period)?.value_inc_vat || 0
      totalCost = totalCost + kwh * rate
      totalKwh = totalKwh + kwh
      averageKwhCost.push(totalCost / totalKwh)
    }
    series.push({
      name: 'Cost per KwH',
      data: averageKwhCost.map(roundToTwoDecimals)
    })
  }
  if (!Object.keys(consumptionCosts).length) {
    series.push({
      name: 'Meter data not available',
      data: Array(prices.length).fill(0)
    })
  }
  const annotations: ApexAnnotations = { xaxis: [] }
  if (periodFrom.toDateString() === new Date().toDateString()) {
    const nextRateTime = rates.find((rate) => new Date(rate.valid_from) > new Date())
    if (!nextRateTime) return
    const currentRate = rates[rates.indexOf(nextRateTime) - 1]
    annotations.xaxis?.push({
      x: currentRate.valid_from.slice(11, 16),
      strokeDashArray: 0,
      borderColor: 'azure',
      label: {
        borderColor: 'azure',
        style: {
          fontSize: '14px',
          color: 'azure',
          background: 'rgb(250, 152, 255)'
        },
        text: currentRate.value_inc_vat.toString()
      }
    })
  }
  const options: ApexCharts.ApexOptions = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)', 'rgb(88, 64, 255)'],
    series,
    chart: {
      height: 300,
      type: 'line',
      zoom: {
        enabled: false
      }
    },
    legend: {
      show: true,
      showForSingleSeries: true,
      labels: {
        colors: 'azure'
      }
    },
    dataLabels: {
      enabled: false
    },
    grid: {
      strokeDashArray: 3
    },
    stroke: {
      curve: 'straight',
      width: 2
    },
    title: {
      text: Object.keys(consumptionCosts).length ? 'Price & Cost per ½ hour' : 'Price per ½ hour',
      align: 'center',
      style: {
        color: 'azure'
      }
    },
    xaxis: {
      categories: times,
      labels: {
        style: {
          colors: 'azure'
        }
      }
    },
    yaxis: {
      title: {
        text: 'Price',
        style: {
          color: 'azure'
        }
      },
      labels: {
        style: {
          colors: 'azure'
        }
      }
    },
    annotations
  }

  return options
}

const renderRatesChart = async (region: string, periodFrom: Date, account?: string, token?: string) => {
  document.body.style.cursor = 'wait'
  const consumption = account && token ? await getMeterConsumption(account, token, periodFrom) : null
  const chartOptions = await createRatesChartOptions(region, periodFrom, consumption)
  if (!ratesChartInstance) {
    ratesChartInstance = new ApexCharts(ratesChartElement, chartOptions)
    await ratesChartInstance.render()
  } else {
    ratesChartInstance.updateOptions(chartOptions)
  }
  document.body.style.cursor = 'default'
}

const createCostChartOptions = async (region: string, periodFrom: Date, consumption: Consumption) => {
  const rates = await getRates(region, periodFrom).then((rates) => rates.reverse())
  const consumptionCosts = (await getConsumptionCosts(rates, consumption)) || {}
  const series: ApexAxisChartSeries = []
  const costs: number[] = []
  const kwhs: number[] = []
  for (const serial_number in consumptionCosts) {
    for (const cost of Object.values(consumptionCosts[serial_number]).reverse().slice(0, 48)) {
      const currentCost = costs[costs.length - 1] || 0
      costs.push(cost + currentCost)
    }
    const costInPounds = costs[costs.length - 1] / 100
    series.push({
      name: `Cost : £${costInPounds.toFixed(2)}`,
      data: costs.map((cost) => roundToTwoDecimals(cost / 100))
    })
    for (const serial_number in consumption) {
      for (const kwh of Object.values(consumption[serial_number]).reverse().slice(0, 48)) {
        const currentKwh = kwhs[kwhs.length - 1] || 0
        kwhs.push(kwh + currentKwh)
      }
      series.push({
        name: `KwH : ${kwhs[kwhs.length - 1].toFixed(2)}`,
        data: kwhs.map(roundToTwoDecimals)
      })
    }
  }
  const costTimes = times.slice(1)
  const options = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)', 'rgb(88, 64, 255)'],
    series,
    chart: {
      height: 300,
      type: 'bar',
      zoom: {
        enabled: false
      }
    },
    legend: {
      show: true,
      showForSingleSeries: true,
      labels: {
        colors: 'azure'
      }
    },
    dataLabels: {
      enabled: false
    },
    grid: {
      strokeDashArray: 3
    },
    stroke: {
      curve: 'straight',
      width: 2
    },
    title: {
      text: 'Total Cost & KwH',
      align: 'center',
      style: {
        color: 'azure'
      }
    },
    xaxis: {
      categories: costTimes,
      labels: {
        style: {
          colors: 'azure'
        }
      }
    },
    yaxis: [
      {
        title: {
          text: 'Cost',
          style: {
            color: 'azure'
          }
        },
        axisBorder: {
          show: true,
          color: 'rgb(250, 152, 255)'
        },
        labels: {
          style: {
            colors: 'azure'
          }
        }
      },
      {
        opposite: true,
        title: {
          text: 'KwH',
          style: {
            color: 'azure'
          }
        },
        axisBorder: {
          show: true,
          color: 'rgb(16, 195, 149)'
        },
        labels: {
          style: {
            colors: 'azure'
          }
        }
      }
    ]
  }

  return options
}

const renderCostChart = async (region: string, periodFrom: Date, account?: string, token?: string) => {
  document.body.style.cursor = 'wait'
  const consumption = account && token ? await getMeterConsumption(account, token, periodFrom) : null
  if (!consumption) {
    costChartInstance && costChartInstance.destroy()
    costChartInstance = null
    document.body.style.cursor = 'default'
    return
  }
  const chartOptions = Object.keys(consumption).length
    ? await createCostChartOptions(region, periodFrom, consumption)
    : {}
  if (!costChartInstance) {
    costChartInstance = new ApexCharts(costChartElement, chartOptions)
    await costChartInstance.render()
  } else {
    costChartInstance.updateOptions(chartOptions)
  }
  document.body.style.cursor = 'default'
}

export const render = async (region: string, periodFromValue: string, account?: string, token?: string) => {
  await Promise.all([
    renderRatesChart(region, new Date(periodFromValue), account, token),
    renderCostChart(region, new Date(periodFromValue), account, token)
  ])
}
