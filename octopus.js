const regionMap = {
  A: 'Eastern England',
  B: 'East Midlands',
  C: 'London',
  D: 'North Wales, Merseyside and Cheshire',
  E: 'West Midlands',
  F: 'North East England',
  G: 'North West England',
  H: 'Southern England',
  J: 'South East England',
  K: 'South Wales',
  L: 'South West England',
  M: 'Yorkshire',
  N: 'Southern Scotland',
  P: 'Northern Scotland'
}

let ratesChartInstance
let usageChartInstance
const apiCache = {}
const apiRoot = 'https://api.octopus.energy/v1/'

const getPeriodTo = (periodFrom) => {
  const periodTo = new Date(periodFrom)
  periodTo.setDate(periodTo.getDate() + 1)
  return periodTo
}

const getData = async (path, token) => {
  if (apiCache[path]) {
    return apiCache[path]
  }
  headers = token ? { Authorization: `Basic ${btoa(token)}` } : {}
  const response = await fetch(path, { headers: headers })
  if (response.ok) {
    apiCache[path] = await response.json()
    return apiCache[path]
  }
}

const getConsumption = async (account, token, periodFrom) => {
  const period_to = getPeriodTo(periodFrom)
  const accountData = await getData(`${apiRoot}accounts/${account}/`, token)
  if (!accountData) return null
  const meterPoints = accountData.properties
    .flatMap((property) => property.electricity_meter_points)
    .filter((point) => !point.is_export)
  const meterConsumption = {}
  for (const meterPoint of meterPoints) {
    for (const meter of meterPoint.meters) {
      const consumptionData = await getData(
        `${apiRoot}electricity-meter-points/${meterPoint.mpan}/meters/${
          meter.serial_number
        }/consumption?period_from=${periodFrom.toISOString()}&period_to=${period_to.toISOString()}`,
        token
      )
      if (consumptionData && consumptionData.results.length) {
        meterConsumption[meter.serial_number] = {}
        for (const { consumption, interval_start } of consumptionData.results) {
          meterConsumption[meter.serial_number][interval_start] = consumption
        }
      }
    }
  }
  return meterConsumption
}

const getRates = async (region, periodFrom) => {
  const periodTo = getPeriodTo(periodFrom)
  const tariffs = await getData(`${apiRoot}products/`)
  const agileTariffDataHref = tariffs.results
    .find(
      (tariff) =>
        tariff.display_name === 'Agile Octopus' &&
        tariff.brand === 'OCTOPUS_ENERGY'
    )
    .links.find((link) => link.rel === 'self').href
  const tariffData = await getData(agileTariffDataHref)
  const regionUnitRatesHref =
    tariffData.single_register_electricity_tariffs[
      `_${region}`
    ].direct_debit_monthly.links.find(
      (link) => link.rel === 'standard_unit_rates'
    ).href +
    `?period_from=${periodFrom.toISOString()}&period_to=${periodTo.toISOString()}`
  const regionUnitRates = await getData(regionUnitRatesHref)
  return regionUnitRates.results.map(({ valid_from, value_inc_vat }) => ({
    valid_from,
    value_inc_vat
  }))
}

const getConsumptionCosts = async (rates, consumption) => {
  const ratesMap = {}
  for (const rate of Object.values(rates)) {
    ratesMap[rate.valid_from] = rate.value_inc_vat
  }
  for (const serial_number of Object.keys(consumption)) {
    for (const [period, kwh] of Object.entries(consumption[serial_number])) {
      const ratesForPeriod = ratesMap[period]
      if (ratesForPeriod) {
        consumption[serial_number][period] = kwh * ratesForPeriod
      }
    }
  }
  return consumption
}

const createRatesChartOptions = async (region, periodFrom, consumption) => {
  const rates = await getRates(region, periodFrom).then((rates) =>
    rates.reverse()
  )
  const prices = rates.map((rate) => rate.value_inc_vat.toFixed(2))
  const series = [{ name: 'Price', data: prices }]
  consumption = consumption ? await getConsumptionCosts(rates, consumption) : {}
  for (const serial_number of Object.keys(consumption)) {
    const consumptionCosts = Object.values(consumption[serial_number]).reverse()
    if (consumptionCosts.length) {
      series.push({
        name: `Meter ${serial_number}`,
        data: consumptionCosts.map((cost) => cost.toFixed(2))
      })
    }
  }
  if (!Object.keys(consumption).length) {
    series.push({
      name: 'Meter data not available',
      data: Array(prices.length).fill(0)
    })
  }
  const times = rates.map((rate) => rate.valid_from.slice(11, 16))
  let annotations = { xaxis: [] }
  if (periodFrom.toDateString() === new Date().toDateString()) {
    const nextRateTime = rates.find(
      (rate) => new Date(rate.valid_from) > new Date()
    )
    const currentRate = rates[rates.indexOf(nextRateTime) - 1]
    annotations = {
      xaxis: [
        {
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
        }
      ]
    }
  }
  const options = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)'],
    series,
    chart: {
      height: '100%',
      type: 'line',
      zoom: {
        enabled: true
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
      text: periodFrom.toDateString(),
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
      labels: {
        style: {
          colors: 'azure'
        }
      }
    },
    annotations: annotations
  }

  return options
}

const renderRatesChart = async (chartElement, periodFromStr, region) => {
  const periodFrom = new Date(periodFromStr)
  document.body.style.cursor = 'wait'
  let consumption
  if (localStorage.getItem('account')) {
    consumption = await getConsumption(
      localStorage.getItem('account'),
      localStorage.getItem('token'),
      periodFrom
    )
  }
  const chartOptions = await createRatesChartOptions(
    region,
    periodFrom,
    consumption
  )
  if (!ratesChartInstance) {
    ratesChartInstance = new ApexCharts(chartElement, chartOptions)
    await ratesChartInstance.render()
  } else {
    ratesChartInstance.updateOptions(chartOptions)
  }
  document.body.style.cursor = 'default'
}

const signOut = async () => {
  localStorage.removeItem('account')
  localStorage.removeItem('token')
}

const signIn = async (account, token) => {
  if (account && token) {
    localStorage.setItem('account', account)
    localStorage.setItem('token', token)
    return true
  }
  return false
}

const getSignedIn = () => {
  return localStorage.getItem('account') && localStorage.getItem('token')
}

const loadPeriodFrom = (element) => {
  const periodFrom = new Date()
  if (periodFrom.getHours() >= 16) {
    periodFrom.setDate(periodFrom.getDate() + 1)
  }
  element.value = periodFrom.toISOString().slice(0, 10)
  element.max = element.value
  return element.value
}

const loadRegion = (element) => {
  element.value = localStorage.getItem('region') || 'A'
  return element.value
}

const setRegion = async (region) => {
  if (region) {
    localStorage.setItem('region', region)
  }
}

const onload = (chartElement, regionElement, datePickerElement) => {
  const periodFrom = loadPeriodFrom(datePickerElement)
  const region = loadRegion(regionElement)
  renderRatesChart(chartElement, periodFrom, region)
  const nextInterval = (() => {
    const now = new Date()
    const nextInterval = new Date()
    nextInterval.setSeconds(0)
    nextInterval.setMinutes(now.getMinutes() < 30 ? 30 : 60)
    return nextInterval - now
  })()
  setTimeout(() => {
    const periodFrom = datePickerElement.value
    const region = regionElement.value
    renderRatesChart(chartElement, periodFrom, region)
    setInterval(() => {
      const periodFrom = datePickerElement.value
      const region = regionElement.value
      renderRatesChart(chartElement, periodFrom, region)
    }, 1800000)
  }, nextInterval)
}
