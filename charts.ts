import ApexCharts, { type ApexOptions } from 'apexcharts'
import { getMeterConsumption, getRates, type Consumption, type Rate } from './octopus'

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

const roundToTwoDecimals = (num: number): number => Math.round(num * 100) / 100

const getConsumptionCosts = async (rates: Rate[], meterConsumption: Consumption | null) => {
  const consumptionCosts: { [serial_number: string]: [Date, number][] } = {}
  for (const serial_number in meterConsumption) {
    consumptionCosts[serial_number] = []
    for (const consumption of meterConsumption[serial_number]) {
      const ratesForPeriod =
        rates.find((rate) => rate.periodFrom.getTime() == consumption.periodFrom.getTime())?.price || 0
      consumptionCosts[serial_number].push([consumption.periodTo, consumption.value * ratesForPeriod])
    }
    consumptionCosts[serial_number] = consumptionCosts[serial_number].sort(
      ([periodFrom1, _], [periodFrom2, __]) => periodFrom1.getTime() - periodFrom2.getTime(),
    )
  }
  return Object.keys(consumptionCosts).length ? consumptionCosts : null
}

const createRatesChartOptions = async (region: string, periodFrom: Date, meterConsumption: Consumption | null) => {
  const rates = await getRates(region, periodFrom)
  const prices = rates.map((rate) => roundToTwoDecimals(rate.price))
  const series: ApexAxisChartSeries = [{ name: 'Price per kWh', data: prices }]
  const consumptionCosts = (await getConsumptionCosts(rates, meterConsumption)) || {}
  for (const serial_number in consumptionCosts) {
    const meterConsumptionCosts = [0]
    for (const [_, cost] of consumptionCosts[serial_number]) {
      meterConsumptionCosts.push(roundToTwoDecimals(cost))
    }
    if (meterConsumptionCosts) {
      series.push({
        name: 'Cost',
        data: meterConsumptionCosts,
      })
    }
  }
  if (!Object.keys(consumptionCosts).length) {
    series.push({
      name: 'Meter data not available',
      data: Array(prices.length).fill(0),
    })
  }
  let times = Object.keys(consumptionCosts).length
    ? Object.values(consumptionCosts)[0].map(([periodFrom]) => periodFrom.toISOString().slice(11, 16))
    : rates.map(({ periodFrom }) => periodFrom.toISOString().slice(11, 16))
  times = times[0] === '00:00' ? times : ['00:00', ...times]
  const annotations: ApexAnnotations = { xaxis: [] }
  if (periodFrom.toDateString() === new Date().toDateString()) {
    const currentRate = rates.filter((rate) => rate.periodFrom < new Date())?.pop()
    if (!currentRate) return
    annotations.xaxis?.push({
      x: currentRate.periodFrom.toISOString().slice(11, 16),
      strokeDashArray: 0,
      borderColor: 'azure',
      label: {
        borderColor: 'azure',
        style: {
          fontSize: '14px',
          color: 'azure',
          background: 'rgb(250, 152, 255)',
        },
        text: `${currentRate.price}`,
      },
    })
  }
  const options: ApexOptions = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)'],
    series,
    chart: {
      height: 300,
      type: 'bar',
      zoom: {
        enabled: false,
      },
    },
    legend: {
      show: true,
      showForSingleSeries: true,
      labels: {
        colors: 'azure',
      },
    },
    dataLabels: {
      enabled: false,
    },
    grid: {
      strokeDashArray: 3,
    },
    stroke: {
      curve: 'straight',
      width: 2,
    },
    title: {
      text: Object.keys(consumptionCosts).length ? 'Price & Cost per ½ hour' : 'Price per ½ hour',
      align: 'center',
      style: {
        color: 'azure',
      },
    },
    xaxis: {
      categories: times,
      labels: {
        style: {
          colors: 'azure',
        },
      },
    },
    yaxis: {
      title: {
        text: 'Pence',
        style: {
          color: 'azure',
        },
      },
      labels: {
        style: {
          colors: 'azure',
        },
      },
    },
    annotations,
  }

  return options
}

const renderRatesChart = async (region: string, periodFrom: Date, account?: string, token?: string) => {
  const consumption = account && token ? await getMeterConsumption(account, token, periodFrom) : null
  const chartOptions = await createRatesChartOptions(region, periodFrom, consumption)
  const priceData =
    (chartOptions &&
      (chartOptions.series as ApexAxisChartSeries)
        .find((series) => series.name === 'Price per kWh')
        ?.data.map((price) => price as number)) ||
    []
  const averageKwhPrice = (priceData.reduce((acc, price) => acc + price, 0) / priceData.length).toFixed(2)
  if (!ratesChartInstance) {
    ratesChartInstance = new ApexCharts(ratesChartElement, chartOptions)
    await ratesChartInstance.render()
  } else {
    ratesChartInstance.updateOptions(chartOptions)
  }
  return averageKwhPrice
}

const createCostChartOptions = async (region: string, periodFrom: Date, consumption: Consumption) => {
  const rates = await getRates(region, periodFrom)
  const consumptionCosts = (await getConsumptionCosts(rates, consumption)) || {}
  const series: ApexAxisChartSeries = []
  const costs: number[] = []
  const kwhs: number[] = []
  for (const serial_number in consumptionCosts) {
    for (const [_, cost] of consumptionCosts[serial_number]) {
      const currentCost = costs[costs.length - 1] || 0
      costs.push(cost + currentCost)
    }
    const costInPounds = costs[costs.length - 1] / 100
    series.push({
      name: 'Cost',
      data: costs.map((cost) => roundToTwoDecimals(cost / 100)),
    })
    for (const serial_number in consumption) {
      for (const value of consumption[serial_number]) {
        const currentKwh = kwhs[kwhs.length - 1] || 0
        kwhs.push(value.value + currentKwh)
      }
      series.push({
        name: 'kWh',
        data: kwhs.map(roundToTwoDecimals),
      })
    }
  }
  const times = rates.map(({ periodFrom }) => periodFrom.toISOString().slice(11, 16))
  const options: ApexOptions = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)', 'rgb(88, 64, 255)'],
    series,
    chart: {
      height: 300,
      type: 'bar',
      zoom: {
        enabled: false,
      },
    },
    legend: {
      show: true,
      showForSingleSeries: true,
      labels: {
        colors: 'azure',
      },
    },
    dataLabels: {
      enabled: false,
    },
    grid: {
      strokeDashArray: 3,
    },
    stroke: {
      curve: 'straight',
      width: 2,
    },
    title: {
      text: 'Total Cost & kWh',
      align: 'center',
      style: {
        color: 'azure',
      },
    },
    xaxis: {
      categories: times,
      labels: {
        style: {
          colors: 'azure',
        },
      },
    },
    yaxis: [
      {
        title: {
          text: 'Pounds',
          style: {
            color: 'azure',
          },
        },
        axisBorder: {
          show: true,
          color: 'rgb(250, 152, 255)',
        },
        labels: {
          style: {
            colors: 'azure',
          },
        },
      },
      {
        opposite: true,
        title: {
          text: 'kWh',
          style: {
            color: 'azure',
          },
        },
        axisBorder: {
          show: true,
          color: 'rgb(16, 195, 149)',
        },
        labels: {
          style: {
            colors: 'azure',
          },
        },
      },
    ],
  }

  return options
}

const renderCostChart = async (region: string, periodFrom: Date, account?: string, token?: string) => {
  const consumption = account && token ? await getMeterConsumption(account, token, periodFrom) : null
  if (!consumption) {
    costChartInstance && costChartInstance.destroy()
    costChartInstance = null
    return
  }
  const chartOptions = await createCostChartOptions(region, periodFrom, consumption)
  if (!costChartInstance) {
    costChartInstance = new ApexCharts(costChartElement, chartOptions)
    await costChartInstance.render()
  } else {
    costChartInstance.updateOptions(chartOptions)
  }
  const kwhData = (chartOptions.series as ApexAxisChartSeries).find((series) => series.name === 'kWh')?.data as number[]
  const totalKwh = kwhData[kwhData.length - 1]
  const costData = (chartOptions.series as ApexAxisChartSeries).find((series) => series.name === 'Cost')
    ?.data as number[]
  const totalCost = costData[costData.length - 1]
  const averageKwhCost = ((totalCost / totalKwh) * 100).toFixed(2)
  return { averageKwhCost, totalCost: totalCost.toFixed(2), totalKwh }
}

export const render = async (region: string, periodFromValue: string, account?: string, token?: string) => {
  const averageKwhPrice = await renderRatesChart(region, new Date(periodFromValue), account, token)
  const totals = await renderCostChart(region, new Date(periodFromValue), account, token)
  return { averageKwhPrice, ...totals }
}
