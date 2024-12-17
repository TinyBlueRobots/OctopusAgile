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

let existingChart
const apiRoot = 'https://api.octopus.energy/v1/'

const setRegion = async (region) => {
  if (region) {
    localStorage.setItem('region', region)
  }
}

const getPeriodTo = (periodFrom) => {
  const periodTo = new Date(periodFrom)
  periodTo.setDate(periodTo.getDate() + 1)
  return periodTo
}

const getData = async (path, token) => {
  headers = token ? { Authorization: `Basic ${btoa(token)}` } : {}
  const response = await fetch(path, { headers: headers })
  return response.ok ? await response.json() : null
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

const formatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

const createChartOptions = async (region, periodFrom, consumption) => {
  const rates = await getRates(region, periodFrom)
  const results = rates.reverse()
  const prices = results.map((rate) => rate.value_inc_vat.toFixed(2))
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
  const dates = results.map((rate) => rate.valid_from)
  const times = dates.map((date) => date.slice(11, 16))
  const options = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)'],
    series,
    chart: {
      height: '100%',
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
      curve: 'straight'
    },
    title: {
      text: formatter.format(periodFrom),
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
    }
  }

  return options
}

const renderChart = async (chartElement, periodFromStr, region) => {
  console.log('renderChart', periodFromStr, region)
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
  const chartOptions = await createChartOptions(region, periodFrom, consumption)
  if (!existingChart) {
    existingChart = new ApexCharts(chartElement, chartOptions)
    await existingChart.render()
  } else {
    existingChart.updateOptions(chartOptions)
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

const loadDatePicker = (element) => {
  const periodFrom = new Date()
  if (periodFrom.getHours() >= 16) {
    periodFrom.setDate(periodFrom.getDate() + 1)
  }
  element.value = periodFrom.toISOString().slice(0, 10)
  element.max = element.value
  return element.value
}

const loadRegionSelect = (element) => {
  element.value = localStorage.getItem('region') || 'A'
  // element.dispatchEvent(new Event('change'));
  return element.value
}

const onload = (chartElement, regionElement, datePickerElement) => {
  const periodFrom = loadDatePicker(datePickerElement)
  const region = loadRegionSelect(regionElement)
  renderChart(chartElement, periodFrom, region)
}
