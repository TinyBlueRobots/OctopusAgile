let ratesChartInstance
let costChartInstance
let ratesChartElement
let costChartElement
const apiCache = {}
const apiRoot = 'https://api.octopus.energy/v1/'

const times = (() => {
  const times = []
  for (let i = 0; i <= 48; i++) {
    hour = Math.floor(i / 2)
    hour = hour === 24 ? 0 : hour
    const minute = i % 2 ? '30' : '00'
    times.push(`${hour.toString().padStart(2, '0')}:${minute}`)
  }
  return times
})()

const getStorageValue = (key) => {
  let value = localStorage.getItem('datastar')
  if (!value) return
  return JSON.parse(value)[key]
}

const getRegion = () => getStorageValue('region')

const getAccount = () => getStorageValue('account')

const getToken = () => getStorageValue('token')

const getPeriodTo = (periodFrom) => {
  const periodTo = new Date(periodFrom)
  periodTo.setDate(periodTo.getDate() + 1)
  return periodTo
}

const getData = async (path, token) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Basic ${btoa(token)}`
  }
  const cacheKey = `${path} ${JSON.stringify(headers)}`
  if (apiCache[cacheKey]) {
    return apiCache[cacheKey]
  }
  const response = await fetch(path, { headers: headers })
  if (response.ok) {
    if (Object.keys(apiCache).length >= 10) {
      delete apiCache[Object.keys(apiCache)[0]]
    }
    apiCache[cacheKey] = await response.json()
    return apiCache[cacheKey]
  }
}

const getAccountData = async (account, token) => await getData(`${apiRoot}accounts/${account}/`, token)

const getConsumption = async (account, token, periodFrom) => {
  const periodTo = getPeriodTo(periodFrom)
  const accountData = await getAccountData(account, token)
  if (!accountData) return null
  const meterPoints = accountData.properties
    .flatMap((property) => property.electricity_meter_points)
    .filter((point) => !point.is_export)
  const meterConsumption = {}
  const meters = meterPoints.flatMap((point) =>
    point.meters.map((meter) => ({ mpan: point.mpan, serialNumber: meter.serial_number }))
  )
  await Promise.all(
    meters.map(async ({ mpan, serialNumber }) => {
      const meterData = await getData(
        `${apiRoot}electricity-meter-points/${mpan}/meters/${serialNumber}/consumption?period_from=${periodFrom.toISOString()}&period_to=${periodTo.toISOString()}`,
        token
      )
      if (meterData && meterData.results.length) {
        meterConsumption[serialNumber] = {}
        for (const { consumption, interval_end } of meterData.results) {
          meterConsumption[serialNumber][interval_end] = consumption
        }
      }
    })
  )
  return Object.keys(meterConsumption).length ? meterConsumption : null
}

const getRates = async (region, periodFrom) => {
  const periodTo = getPeriodTo(periodFrom)
  const tariffs = await getData(`${apiRoot}products/`)
  const agileTariffDataHref = tariffs.results
    .find((tariff) => tariff.display_name === 'Agile Octopus' && tariff.brand === 'OCTOPUS_ENERGY')
    .links.find((link) => link.rel === 'self').href
  const tariffData = await getData(agileTariffDataHref)
  const regionUnitRatesHref =
    tariffData.single_register_electricity_tariffs[`_${region}`].direct_debit_monthly.links.find(
      (link) => link.rel === 'standard_unit_rates'
    ).href + `?period_from=${periodFrom.toISOString()}&period_to=${periodTo.toISOString()}`
  const regionUnitRates = await getData(regionUnitRatesHref)
  return regionUnitRates.results.map(({ valid_from, value_inc_vat }) => ({
    valid_from,
    value_inc_vat
  }))
}

const getConsumptionCosts = async (rates, consumption) => {
  const ratesMap = {}
  const consumptionCosts = {}
  for (const rate of rates) {
    ratesMap[rate.valid_from] = rate.value_inc_vat
  }
  for (const serial_number in consumption) {
    consumptionCosts[serial_number] = {}
    for (const [period, kwh] of Object.entries(consumption[serial_number])) {
      const ratesForPeriod = ratesMap[period] || 0
      consumptionCosts[serial_number][period] = kwh * ratesForPeriod
    }
  }
  return Object.keys(consumptionCosts).length ? consumptionCosts : null
}

const createRatesChartOptions = async (region, periodFrom, consumption) => {
  const rates = await getRates(region, periodFrom).then((rates) => rates.reverse())
  const prices = rates.map((rate) => rate.value_inc_vat.toFixed(2))
  const series = [{ name: 'Price', data: prices }]
  const consumptionCosts = (await getConsumptionCosts(rates, consumption)) || {}
  for (const serial_number in consumptionCosts) {
    const meterConsumptionCosts = []
    for (const consumptionCost of Object.values(consumptionCosts[serial_number])) {
      meterConsumptionCosts.push(consumptionCost.toFixed(2))
    }
    meterConsumptionCosts.push(0)
    meterConsumptionCosts.reverse()
    if (meterConsumptionCosts) {
      series.push({
        name: `Meter ${serial_number}`,
        data: meterConsumptionCosts
      })
    }
  }
  if (!Object.keys(consumptionCosts).length) {
    series.push({
      name: 'Meter data not available',
      data: Array(prices.length).fill(0)
    })
  }
  const annotations = { xaxis: [] }
  if (periodFrom.toDateString() === new Date().toDateString()) {
    const nextRateTime = rates.find((rate) => new Date(rate.valid_from) > new Date())
    const currentRate = rates[rates.indexOf(nextRateTime) - 1]
    annotations.xaxis.push({
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
        text: currentRate.value_inc_vat
      }
    })
  }
  const options = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)'],
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

const renderRatesChart = async (region, periodFrom) => {
  document.body.style.cursor = 'wait'
  let consumption
  const account = getAccount()
  if (account) {
    consumption = await getConsumption(account, getToken(), periodFrom)
  }
  const chartOptions = await createRatesChartOptions(region, periodFrom, consumption)
  if (!ratesChartInstance) {
    ratesChartInstance = new ApexCharts(ratesChartElement, chartOptions)
    await ratesChartInstance.render()
  } else {
    ratesChartInstance.updateOptions(chartOptions)
  }
  document.body.style.cursor = 'default'
}

const createCostChartOptions = async (region, periodFrom, consumption) => {
  const rates = await getRates(region, periodFrom).then((rates) => rates.reverse())
  const consumptionCosts = (await getConsumptionCosts(rates, consumption)) || {}
  const series = []
  const costs = []
  const kwhs = []
  for (const serial_number in consumptionCosts) {
    for (const cost of Object.values(consumptionCosts[serial_number]).reverse().slice(0, 48)) {
      const currentCost = costs[costs.length - 1] || 0
      costs.push(cost + currentCost)
    }
    const costInPounds = costs[costs.length - 1] / 100
    series.push({
      name: `Meter ${serial_number} : £${costInPounds.toFixed(2)}`,
      data: costs.map((cost) => (cost / 100).toFixed(2))
    })
    for (const serial_number in consumption) {
      for (const kwh of Object.values(consumption[serial_number]).reverse().slice(0, 48)) {
        const currentKwh = kwhs[kwhs.length - 1] || 0
        kwhs.push(kwh + currentKwh)
      }
      series.push({
        name: `Meter ${serial_number} : ${kwhs[kwhs.length - 1].toFixed(2)} kWh`,
        data: kwhs.map((kwh) => kwh.toFixed(2))
      })
    }
  }
  const costTimes = times.slice(1)
  const options = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)'],
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

const renderCostChart = async (region, periodFrom) => {
  document.body.style.cursor = 'wait'
  let consumption
  const account = getAccount()
  if (account) {
    consumption = await getConsumption(account, getToken(), periodFrom)
  }
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

const signOut = () => {
  ratesChartInstance && ratesChartInstance.destroy()
  costChartInstance && costChartInstance.destroy()
  ratesChartInstance = null
  costChartInstance = null
}

const signIn = async (account, token) => {
  if (account && token) {
    document.body.style.cursor = 'wait'
    const accountData = await getAccountData(account, token)
    document.body.style.cursor = 'default'
    return accountData ? true : false
  }
  return false
}

const setInitialPeriodFrom = (periodFromElement) => {
  const periodFrom = new Date()
  if (periodFrom.getHours() >= 16) {
    periodFrom.setDate(periodFrom.getDate() + 1)
  }
  periodFromElement.value = periodFromElement.max = periodFrom.toISOString().slice(0, 10)
}

const setNextDay = (periodFromElement) => {
  const periodFrom = new Date(periodFromElement.value)
  if (periodFrom < new Date(periodFromElement.max)) {
    periodFrom.setDate(periodFrom.getDate() + 1)
    return periodFrom.toISOString().slice(0, 10)
  }
  return periodFromElement.value
}

const setPreviousDay = (periodFromValue) => {
  const periodFrom = new Date(periodFromValue)
  periodFrom.setDate(periodFrom.getDate() - 1)
  return periodFrom.toISOString().slice(0, 10)
}

const renderCharts = async (region, periodFrom) => {
  await Promise.all([renderRatesChart(region, new Date(periodFrom)), renderCostChart(region, new Date(periodFrom))])
}

const nextRateChange = () => {
  const now = new Date()
  const nextInterval = new Date()
  nextInterval.setSeconds(0)
  nextInterval.setMinutes(now.getMinutes() < 30 ? 30 : 60)
  return nextInterval - now
}

const onload = async (ratesChartElementValue, costChartElementValue, periodFromElement, region) => {
  ratesChartElement = ratesChartElementValue
  costChartElement = costChartElementValue
  renderCharts(region, periodFromElement.value)
  setTimeout(() => {
    renderCharts(region, periodFromElement.value)
    setInterval(() => {
      renderCharts(region, periodFromElement.value)
    }, 1800000)
  }, nextRateChange())
}
